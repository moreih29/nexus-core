import type { SpecDocument } from "../types.js";
import { loadClaudeAgentRules } from "../load-data.js";
import { renderMarkdownWithFrontmatter } from "./markdown.js";

const CLAUDE_AGENT_RULES = loadClaudeAgentRules();

function resolveClaudeModel(document: SpecDocument): string | null {
  const modelTier = document.frontmatter.model_tier;
  if (typeof modelTier !== "string") {
    return null;
  }
  return CLAUDE_AGENT_RULES.model_tier[modelTier] ?? null;
}

function collectClaudeDisallowedTools(document: SpecDocument): string[] {
  const capabilities = Array.isArray(document.frontmatter.capabilities)
    ? document.frontmatter.capabilities
    : [];

  const tools = new Set<string>();
  for (const capability of capabilities) {
    if (typeof capability !== "string") continue;
    for (const tool of CLAUDE_AGENT_RULES.capability_disallowed_tools[capability] ?? []) {
      tools.add(tool);
    }
  }

  return [...tools];
}

export function renderClaudeDocument(
  document: SpecDocument,
  expandedBody: string,
): string {
  if (document.kind === "agent") {
    const frontmatter: Record<string, unknown> = {
      description: document.description,
    };

    const model = resolveClaudeModel(document);
    if (model) {
      frontmatter.model = model;
    }

    const disallowedTools = collectClaudeDisallowedTools(document);
    if (disallowedTools.length > 0) {
      frontmatter.disallowedTools = disallowedTools;
    }

    return renderMarkdownWithFrontmatter(frontmatter, expandedBody);
  }

  const frontmatter: Record<string, unknown> = {
    description: document.description,
  };

  if (Array.isArray(document.frontmatter.triggers)) {
    frontmatter.triggers = document.frontmatter.triggers;
  }

  return renderMarkdownWithFrontmatter(frontmatter, expandedBody);
}

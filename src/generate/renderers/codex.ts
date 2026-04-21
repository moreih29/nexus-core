import type { SpecDocument } from "../types.js";
import { loadCodexAgentRules } from "../load-data.js";
import { renderMarkdownWithFrontmatter } from "./markdown.js";

const CODEX_AGENT_RULES = loadCodexAgentRules();

function escapeTomlMultiline(input: string): string {
  return input.replaceAll('"""', '\\"\\"\\"');
}

function resolveCodexModel(document: SpecDocument): string | null {
  const modelTier = document.frontmatter.model_tier;
  if (typeof modelTier !== "string") {
    return null;
  }
  return CODEX_AGENT_RULES.model_tier[modelTier] ?? null;
}

function collectCodexSandboxMode(document: SpecDocument): string | null {
  const capabilities = Array.isArray(document.frontmatter.capabilities)
    ? document.frontmatter.capabilities
    : [];

  let sandboxMode: string | null = null;
  for (const capability of capabilities) {
    if (typeof capability !== "string") continue;
    const configured = CODEX_AGENT_RULES.capability_sandbox_mode[capability];
    if (configured) {
      sandboxMode = configured;
    }
  }

  return sandboxMode;
}

function collectCodexDisabledTools(document: SpecDocument): string[] {
  const capabilities = Array.isArray(document.frontmatter.capabilities)
    ? document.frontmatter.capabilities
    : [];

  const disabledTools = new Set<string>();
  for (const capability of capabilities) {
    if (typeof capability !== "string") continue;
    for (const tool of CODEX_AGENT_RULES.capability_disabled_tools[capability] ?? []) {
      if (tool) disabledTools.add(tool);
    }
  }

  return [...disabledTools];
}

export function renderCodexDocument(
  document: SpecDocument,
  expandedBody: string,
): string {
  if (document.kind === "skill") {
    const frontmatter: Record<string, unknown> = {
      description: document.description,
    };

    if (Array.isArray(document.frontmatter.triggers)) {
      frontmatter.triggers = document.frontmatter.triggers;
    }

    return renderMarkdownWithFrontmatter(frontmatter, expandedBody);
  }

  const lines = [
    `name = ${JSON.stringify(document.id)}`,
    `description = ${JSON.stringify(document.description)}`,
    'developer_instructions = """',
    escapeTomlMultiline(expandedBody.trimEnd()),
    '"""',
  ];

  const model = resolveCodexModel(document);
  if (model) {
    lines.push(`model = ${JSON.stringify(model)}`);
  }

  const sandboxMode = collectCodexSandboxMode(document);
  if (sandboxMode) {
    lines.push(`sandbox_mode = ${JSON.stringify(sandboxMode)}`);
  }

  const disabledTools = collectCodexDisabledTools(document);
  if (disabledTools.length > 0) {
    lines.push("");
    lines.push("[mcp_servers.nx]");
    lines.push(`command = ${JSON.stringify(CODEX_AGENT_RULES.nx_mcp_server.command)}`);
    lines.push(
      `disabled_tools = [${disabledTools.map((tool) => JSON.stringify(tool)).join(", ")}]`,
    );
  }

  lines.push("");

  return lines.join("\n");
}

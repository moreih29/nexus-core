import { loadOpencodeAgentRules } from "../load-data.js";
import type { SpecDocument } from "../types.js";
import { renderMarkdownWithFrontmatter } from "./markdown.js";

const OPENCODE_AGENT_RULES = loadOpencodeAgentRules();

function escapeTemplateString(input: string): string {
  return input
    .replaceAll("\\", "\\\\")
    .replaceAll("`", "\\`")
    .replaceAll("${", "\\${");
}

function toIdentifier(id: string): string {
  return id.replace(/[^a-zA-Z0-9_$]/g, "_");
}

function resolveOpencodeModel(document: SpecDocument): string | null {
  const modelTier = document.frontmatter.model_tier;
  if (typeof modelTier !== "string") {
    return null;
  }
  return OPENCODE_AGENT_RULES.model_tier[modelTier] ?? null;
}

function collectOpencodePermissions(
  document: SpecDocument,
): Record<string, string> {
  const capabilities = Array.isArray(document.frontmatter.capabilities)
    ? document.frontmatter.capabilities
    : [];
  const permissions: Record<string, string> = {};

  for (const capability of capabilities) {
    if (typeof capability !== "string") continue;
    Object.assign(
      permissions,
      OPENCODE_AGENT_RULES.capability_permissions[capability] ?? {},
    );
  }

  return permissions;
}

export function renderOpencodeDocument(
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

  const identifier = toIdentifier(document.id);
  const lines = [
    `export const ${identifier} = {`,
    `  id: ${JSON.stringify(document.id)},`,
    `  name: ${JSON.stringify(document.name)},`,
    `  description: ${JSON.stringify(document.description)},`,
  ];

  const model = resolveOpencodeModel(document);
  if (model) {
    lines.push(`  model: ${JSON.stringify(model)},`);
  }

  const permissions = collectOpencodePermissions(document);
  const permissionEntries = Object.entries(permissions);
  if (permissionEntries.length > 0) {
    lines.push("  permission: {");
    for (const [key, value] of permissionEntries) {
      lines.push(`    ${key}: ${JSON.stringify(value)},`);
    }
    lines.push("  },");
  }

  if (document.id === "lead") {
    lines.push(`  mode: "primary",`);
  }

  lines.push(`  system: \`${escapeTemplateString(expandedBody.trimEnd())}\`,`);
  lines.push(`} as const;`, "");
  return lines.join("\n");
}

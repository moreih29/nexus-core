import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { AssetKind, SpecDocument } from "./types.js";

const SPEC_ROOT = new URL("../../spec/", import.meta.url);

function parseFrontmatter(
  raw: string,
  sourcePath: string,
): { frontmatter: Record<string, unknown>; body: string } {
  if (!raw.startsWith("---\n")) {
    throw new Error(`Missing frontmatter in ${sourcePath}`);
  }

  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) {
    throw new Error(`Unterminated frontmatter in ${sourcePath}`);
  }

  const frontmatterRaw = raw.slice(4, end);
  const body = raw.slice(end + 5).replace(/^\n/, "");
  return {
    frontmatter: parseYaml(frontmatterRaw) as Record<string, unknown>,
    body,
  };
}

function loadKind(kind: AssetKind): SpecDocument[] {
  const dir = new URL(`${kind}s/`, SPEC_ROOT);
  const absoluteDir = dir.pathname;
  const results: SpecDocument[] = [];

  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const sourcePath = join(absoluteDir, entry.name, "body.md");
    const raw = readFileSync(sourcePath, "utf8");
    const { frontmatter, body } = parseFrontmatter(raw, sourcePath);

    const id = String(frontmatter.id ?? entry.name);
    const name = String(frontmatter.name ?? id);
    const description = String(frontmatter.description ?? "");

    results.push({
      kind,
      id,
      name,
      description,
      frontmatter,
      body,
      sourcePath,
    });
  }

  return results.sort((a, b) => a.id.localeCompare(b.id));
}

export function loadSpecDocuments(): SpecDocument[] {
  return [...loadKind("agent"), ...loadKind("skill")];
}

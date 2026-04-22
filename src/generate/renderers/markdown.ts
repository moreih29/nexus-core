import { stringify } from "yaml";

export function renderMarkdownWithFrontmatter(
  frontmatter: Record<string, unknown>,
  body: string,
): string {
  const serialized = stringify(frontmatter).trimEnd();
  return `---\n${serialized}\n---\n${body.endsWith("\n") ? body : `${body}\n`}`;
}

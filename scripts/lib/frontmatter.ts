import { parse as parseYaml } from 'yaml';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

export interface ParsedFrontmatter {
  /** parsed YAML object */
  data: Record<string, unknown>;
  /** body content (after closing ---) */
  content: string;
  /** 1-based line number where frontmatter YAML starts (after opening ---) */
  frontmatterStartLine: number;
  /** 1-based line number where body content starts (after closing ---) */
  contentStartLine: number;
}

/**
 * Parses a markdown file with optional YAML frontmatter.
 *
 * Format:
 *   ---
 *   {frontmatter YAML}
 *   ---
 *   {body content}
 *
 * If no frontmatter is present, returns {data: {}, content: source, frontmatterStartLine: 0, contentStartLine: 1}.
 *
 * Line numbers are 1-based to match editor conventions.
 */
export function parseFrontmatter(source: string): ParsedFrontmatter {
  const match = source.match(FRONTMATTER_RE);
  if (!match) {
    return {
      data: {},
      content: source,
      frontmatterStartLine: 0,
      contentStartLine: 1,
    };
  }

  const frontmatterText = match[1];
  const body = match[2];
  const parsed = parseYaml(frontmatterText);

  // Opening '---' is line 1, frontmatter YAML starts at line 2
  const frontmatterStartLine = 2;
  // Count lines in frontmatter text + 2 (opening --- and closing ---)
  const frontmatterLineCount = frontmatterText.split('\n').length;
  const contentStartLine = frontmatterStartLine + frontmatterLineCount + 1; // +1 for closing ---

  return {
    data: (parsed ?? {}) as Record<string, unknown>,
    content: body,
    frontmatterStartLine,
    contentStartLine,
  };
}

/**
 * Reverse: translates a line number within the frontmatter YAML (1-based, as reported
 * by a YAML parser operating on the frontmatter text alone) back to the line in the
 * original source file.
 */
export function frontmatterLineToSourceLine(
  parsed: ParsedFrontmatter,
  frontmatterLine: number
): number {
  if (parsed.frontmatterStartLine === 0) {
    throw new Error('Source has no frontmatter');
  }
  return parsed.frontmatterStartLine + frontmatterLine - 1;
}

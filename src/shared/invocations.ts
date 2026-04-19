/**
 * src/shared/invocations.ts
 *
 * expandInvocation — cross-harness invocation template expansion.
 *
 * Resolves {{template_name key=value ...}} placeholders in agent/skill body.md
 * to harness-native call syntax as defined in assets/tools/tool-name-map.yml
 * invocations section.
 *
 * Supported templates (4):
 *   {{subagent_spawn target_role=<role> prompt=<text> [name=<label>]}}
 *   {{skill_activation skill=<name> [mode=<mode>]}}
 *   {{task_register label=<text> state=<text>}}
 *   {{user_question question=<text> options=<json-array>}}
 */

export type Harness = "claude" | "opencode" | "codex";

export interface InvocationTemplate {
  args: string[];
  templates: Record<Harness, string>;
}

export interface InvocationsMap {
  [name: string]: InvocationTemplate;
}

/**
 * Parse a {{...}} invocation call string into its template name and key=value args.
 *
 * Format: {{template_name key1=value1 key2=value2 ...}}
 * Values may be:
 *   - double-quoted strings: "..."
 *   - bracket-balanced arrays: [...]
 *   - brace-balanced objects: {...}
 *   - plain non-whitespace tokens
 *
 * Returns null if the format is invalid.
 */
export function parseInvocationCall(call: string): {
  name: string;
  args: Record<string, string>;
} | null {
  // call is the content inside {{ }}
  const trimmed = call.trim();
  if (!trimmed) return null;

  // Extract template name (first token)
  const firstSpace = trimmed.indexOf(" ");
  const name = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  const rest = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();

  const args: Record<string, string> = {};

  if (rest) {
    // Manual tokenizer: scan for key=<value> pairs where <value> may contain
    // nested brackets/braces or quoted strings.
    let i = 0;
    while (i < rest.length) {
      // Skip whitespace
      while (i < rest.length && /\s/.test(rest[i]!)) i++;
      if (i >= rest.length) break;

      // Read key (word chars up to '=')
      const keyStart = i;
      while (i < rest.length && /\w/.test(rest[i]!)) i++;
      if (i >= rest.length || rest[i] !== "=") {
        // Not a valid key=value pair — skip this token
        while (i < rest.length && !/\s/.test(rest[i]!)) i++;
        continue;
      }
      const key = rest.slice(keyStart, i);
      i++; // consume '='

      if (i >= rest.length) break;

      // Read value: dispatch on first character
      let value = "";
      const ch = rest[i]!;

      if (ch === '"') {
        // Quoted string — scan to closing unescaped quote
        i++; // consume opening quote
        const start = i;
        while (i < rest.length) {
          if (rest[i] === "\\" && i + 1 < rest.length) {
            i += 2; // skip escape sequence
          } else if (rest[i] === '"') {
            break;
          } else {
            i++;
          }
        }
        value = rest.slice(start, i).replace(/\\"/g, '"');
        if (i < rest.length) i++; // consume closing quote
      } else if (ch === "[" || ch === "{") {
        // Bracket/brace balanced scan
        const open = ch;
        const close = open === "[" ? "]" : "}";
        let depth = 0;
        const start = i;
        while (i < rest.length) {
          const c = rest[i]!;
          if (c === '"') {
            // Skip quoted section inside array/object
            i++;
            while (i < rest.length) {
              if (rest[i] === "\\" && i + 1 < rest.length) {
                i += 2;
              } else if (rest[i] === '"') {
                i++;
                break;
              } else {
                i++;
              }
            }
            continue;
          }
          if (c === open) depth++;
          else if (c === close) {
            depth--;
            if (depth === 0) {
              i++; // consume closing bracket
              break;
            }
          }
          i++;
        }
        value = rest.slice(start, i);
      } else {
        // Plain non-whitespace token
        const start = i;
        while (i < rest.length && !/\s/.test(rest[i]!)) i++;
        value = rest.slice(start, i);
      }

      if (key) args[key] = value;
    }
  }

  return { name, args };
}

/**
 * Apply a single invocation template for the given harness.
 *
 * Substitutes {placeholder} tokens in the template string with arg values.
 * Optional args (those not in the args map) are omitted along with their
 * surrounding delimiters when absent.
 *
 * Returns the harness-native syntax string, or an error comment if the
 * template name is unknown or a required arg is missing.
 */
export function applyTemplate(
  templateStr: string,
  args: Record<string, string>,
  templateDef: InvocationTemplate,
): string {
  let result = templateStr;

  // Replace all {key} tokens with their values
  for (const [key, value] of Object.entries(args)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }

  // Remove any remaining optional placeholders that have no value
  // Pattern: `, "description": "{name}"` or similar — strip the whole field segment
  // We handle this by removing ", key: "{remaining_token}"" patterns
  result = result.replace(/,?\s*\w+:\s*"\{[^}]+\}"/g, "");
  // Also handle ", description: {name}" without quotes (less common but defensive)
  result = result.replace(/,?\s*\w+:\s*\{[^}]+\}/g, "");

  return result;
}

/**
 * Expand a single {{...}} invocation expression to harness-native syntax.
 *
 * @param expression  The content inside {{ }}, e.g. "subagent_spawn target_role=engineer prompt=Fix the bug"
 * @param harness     Target harness: "claude" | "opencode" | "codex"
 * @param invocations Parsed invocations map from tool-name-map.yml
 *
 * Returns the expanded string, or a comment if unknown/invalid.
 */
export function expandInvocationExpression(
  expression: string,
  harness: Harness,
  invocations: InvocationsMap,
): string {
  const parsed = parseInvocationCall(expression);
  if (!parsed) {
    return `/* [nexus] invalid invocation: ${expression.trim()} */`;
  }

  const def = invocations[parsed.name];
  if (!def) {
    return `/* [nexus] unknown invocation: ${parsed.name} */`;
  }

  const templateStr = def.templates[harness];
  if (!templateStr) {
    return `/* [nexus] no template for harness ${harness}: ${parsed.name} */`;
  }

  return applyTemplate(templateStr, parsed.args, def);
}

/**
 * Expand all {{...}} invocation placeholders in a body string.
 *
 * Uses a balance-counter scanner so that nested `{}` inside argument values
 * (e.g. options=[{label: "Set up"}]) are correctly included in the match.
 *
 * @param input       Raw body.md content (may contain multiple {{}} blocks)
 * @param harness     Target harness
 * @param invocations Parsed invocations map
 *
 * Returns the body with all {{}} templates replaced by harness-native syntax.
 */
export function expandInvocations(
  input: string,
  harness: Harness,
  invocations: InvocationsMap,
): string {
  let result = "";
  let i = 0;

  while (i < input.length) {
    // Find the next '{{'
    const openIdx = input.indexOf("{{", i);
    if (openIdx === -1) {
      result += input.slice(i);
      break;
    }

    // Append text before the '{{'
    result += input.slice(i, openIdx);
    i = openIdx + 2; // move past '{{'

    // Scan forward with brace depth to find the matching '}}'
    // We start after '{{', depth tracks inner '{' vs '}'
    let depth = 0;
    let innerStart = i;
    let found = false;

    while (i < input.length) {
      if (input[i] === "{") {
        depth++;
        i++;
      } else if (input[i] === "}") {
        if (depth === 0 && input[i + 1] === "}") {
          // Found the closing '}}'
          const inner = input.slice(innerStart, i);
          result += expandInvocationExpression(inner, harness, invocations);
          i += 2; // consume '}}'
          found = true;
          break;
        } else if (depth > 0) {
          depth--;
          i++;
        } else {
          // Single '}' with no matching depth — treat as literal
          i++;
        }
      } else {
        i++;
      }
    }

    if (!found) {
      // No closing '}}' — treat the '{{' as literal text
      result += "{{" + input.slice(innerStart, i);
    }
  }

  return result;
}

import type { ParsedMacro } from "../types.js";

function parseMacroParams(
  raw: string,
): Record<string, string | { heredoc: string }> {
  const source = raw.trim();
  const params: Record<string, string | { heredoc: string }> = {};
  let index = 0;

  while (index < source.length) {
    while (index < source.length && /\s/.test(source.charAt(index))) index += 1;
    if (index >= source.length) break;

    const keyStart = index;
    while (index < source.length && /\w/.test(source.charAt(index))) index += 1;
    const key = source.slice(keyStart, index);

    if (!key) {
      throw new Error(`Expected parameter key at offset ${index}`);
    }
    if (source[index] !== "=") {
      throw new Error(`Expected "=" after parameter "${key}"`);
    }
    index += 1;

    if (source[index] === '"') {
      let value = "";
      index += 1;
      while (index < source.length && source[index] !== '"') {
        if (source[index] === "\\" && index + 1 < source.length) {
          value += source[index + 1];
          index += 2;
          continue;
        }
        value += source[index];
        index += 1;
      }
      if (source[index] !== '"') {
        throw new Error(`Unterminated string for parameter "${key}"`);
      }
      index += 1;
      params[key] = value;
      continue;
    }

    if (source[index] === "[" || source[index] === "{") {
      const open = source.charAt(index);
      const close = open === "[" ? "]" : "}";
      let depth = 1;
      const start = index;
      index += 1;
      while (index < source.length && depth > 0) {
        if (source[index] === '"') {
          index += 1;
          while (index < source.length && source[index] !== '"') {
            if (source[index] === "\\" && index + 1 < source.length) {
              index += 2;
            } else {
              index += 1;
            }
          }
          index += 1;
          continue;
        }

        if (source[index] === open) {
          depth += 1;
        } else if (source[index] === close) {
          depth -= 1;
        }
        index += 1;
      }
      params[key] = source.slice(start, index);
      continue;
    }

    if (source[index] === ">" && source[index + 1] === ">") {
      index += 2;
      const start = index;
      while (index < source.length && /\w/.test(source.charAt(index))) {
        index += 1;
      }
      params[key] = { heredoc: source.slice(start, index) };
      continue;
    }

    const start = index;
    while (index < source.length && !/\s/.test(source.charAt(index))) {
      index += 1;
    }
    params[key] = source.slice(start, index);
  }

  return params;
}

export function parseMacroExpression(expression: string): ParsedMacro {
  const trimmed = expression.trim();
  if (!trimmed) {
    throw new Error("Empty macro expression");
  }

  const firstSpace = trimmed.indexOf(" ");
  if (firstSpace === -1) {
    return { id: trimmed, params: {} };
  }

  return {
    id: trimmed.slice(0, firstSpace),
    params: parseMacroParams(trimmed.slice(firstSpace + 1)),
  };
}

export function expandMacroExpressions(
  input: string,
  replacer: (macro: ParsedMacro) => string,
): string {
  let result = "";
  let index = 0;

  while (index < input.length) {
    const openIndex = input.indexOf("{{", index);
    if (openIndex === -1) {
      result += input.slice(index);
      break;
    }

    result += input.slice(index, openIndex);
    index = openIndex + 2;
    const innerStart = index;
    let depth = 0;
    let found = false;

    while (index < input.length) {
      if (input[index] === "{") {
        depth += 1;
        index += 1;
        continue;
      }

      if (input[index] === "}") {
        if (depth === 0 && input[index + 1] === "}") {
          const inner = input.slice(innerStart, index);
          result += replacer(parseMacroExpression(inner));
          index += 2;
          found = true;
          break;
        }
        if (depth > 0) {
          depth -= 1;
        }
      }

      index += 1;
    }

    if (!found) {
      throw new Error(`Unterminated macro starting at offset ${openIndex}`);
    }
  }

  return result;
}

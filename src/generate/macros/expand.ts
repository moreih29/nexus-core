import type { Harness, InvocationSchema, ParsedMacro } from "../types.js";
import { expandMacroExpressions } from "./parse.js";
import { validateMacro } from "./validate.js";

function stringifyParam(value: string | { heredoc: string }): string {
  if (typeof value === "string") {
    return value;
  }
  return `>>${value.heredoc}`;
}

function normalizeMacroParams(
  macro: ParsedMacro,
  config: Record<string, unknown>,
): Record<string, string> {
  const params: Record<string, string> = {};

  for (const [key, value] of Object.entries(macro.params)) {
    params[key] = stringifyParam(value);
  }

  const aliases =
    typeof config.role_aliases === "object" && config.role_aliases !== null
      ? (config.role_aliases as Record<string, string>)
      : {};

  if (params.target_role) {
    params.target_role = aliases[params.target_role] ?? params.target_role;
  }

  if (
    !params.name &&
    config.name_fallback === "target_role" &&
    params.target_role
  ) {
    params.name = params.target_role;
  }

  return params;
}

function applyTemplate(
  template: string,
  params: Record<string, string>,
): string {
  let result = template;

  for (const [key, value] of Object.entries(params)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }

  result = result.replace(/,?\s*\w+:\s*"\{[^}]+\}"/g, "");
  result = result.replace(/,?\s*\w+:\s*\{[^}]+\}/g, "");
  return result;
}

export function expandMacrosForHarness(
  body: string,
  _harness: Harness,
  catalog: Map<string, InvocationSchema>,
  invocationMap: Record<string, Record<string, unknown>>,
): string {
  return expandMacroExpressions(body, (macro) => {
    validateMacro(macro, catalog);
    const config = invocationMap[macro.id] ?? {};
    const template = config.template;
    if (typeof template !== "string" || template.length === 0) {
      throw new Error(`Missing template for macro "${macro.id}"`);
    }
    const params = normalizeMacroParams(macro, config);
    return applyTemplate(template, params);
  });
}

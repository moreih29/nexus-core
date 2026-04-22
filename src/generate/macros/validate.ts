import type { InvocationSchema, ParsedMacro } from "../types.js";

export function validateMacro(
  macro: ParsedMacro,
  catalog: Map<string, InvocationSchema>,
): void {
  const schema = catalog.get(macro.id);
  if (!schema) {
    throw new Error(`Unknown macro "${macro.id}"`);
  }

  for (const [name, config] of Object.entries(schema.params)) {
    if (config.required && !(name in macro.params)) {
      throw new Error(
        `Macro "${macro.id}" is missing required param "${name}"`,
      );
    }
  }

  for (const [name, value] of Object.entries(macro.params)) {
    const config = schema.params[name];
    if (!config) {
      throw new Error(`Macro "${macro.id}" has unsupported param "${name}"`);
    }

    if (config.type === "enum" && typeof value === "string") {
      if (!config.values?.includes(value)) {
        throw new Error(
          `Macro "${macro.id}" param "${name}" must be one of ${config.values?.join(", ")}`,
        );
      }
    }
  }
}

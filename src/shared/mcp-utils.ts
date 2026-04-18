import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function textResult(obj: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(obj, null, 2) }],
  };
}

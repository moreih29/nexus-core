import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type NxToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  group?: string;
};

type BivariantToolHandler<TArgs> = {
  bivarianceHack(args: TArgs): CallToolResult | Promise<CallToolResult>;
}["bivarianceHack"];

type LooseToolRegistrar = {
  registerTool(
    name: string,
    config: {
      description: string;
      inputSchema: Record<string, unknown>;
    },
    handler: unknown,
  ): void;
};

export type NxToolHandler<TArgs = unknown> = BivariantToolHandler<TArgs>;

export type NxToolBinding<TArgs = unknown> = {
  definition: NxToolDefinition;
  handler: NxToolHandler<TArgs>;
};

export function registerNxTool<TArgs>(
  server: McpServer,
  binding: NxToolBinding<TArgs>,
): void {
  // Avoid expensive inference through the SDK's registerTool generic boundary.
  const config = {
    description: binding.definition.description,
    inputSchema: binding.definition.inputSchema,
  };
  const registrar = server as unknown as LooseToolRegistrar;
  registrar.registerTool(binding.definition.name, config, binding.handler);
}

export function registerNxTools(
  server: McpServer,
  bindings: ReadonlyArray<NxToolBinding>,
): void {
  for (const binding of bindings) {
    registerNxTool(server, binding);
  }
}

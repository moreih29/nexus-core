/**
 * AgentConfig — shape emitted by build-agents.ts for OpenCode src/agents/<name>.ts.
 *
 * Nexus-internal convention. Exported from @moreih29/nexus-core/types so
 * generated consumer files can import a type that resolves in every universe
 * (authoring, distribution, consumer install).
 *
 * Fields match the emitter in scripts/build-agents.ts::opencodeAgentTs.
 * The `permission` map uses capability-matrix-derived keys (`edit`, `bash`,
 * `webfetch`, plus MCP tool identifiers like `nx_task_add`) so the index
 * signature is intentionally open.
 */
export type PermissionMode = "allow" | "deny" | "ask";

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  permission?: Record<string, PermissionMode>;
  mode?: "primary" | "subagent" | "all";
  system: string;
}

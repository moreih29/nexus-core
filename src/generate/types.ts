export type Harness = "claude" | "codex" | "opencode";

export type AssetKind = "agent" | "skill";

export type MacroParamSchema = {
  type: string;
  required: boolean;
  semantic?: string;
  values_ref?: string;
  values?: string[];
};

export type InvocationSchema = {
  id: string;
  params: Record<string, MacroParamSchema>;
};

export type InvocationCatalog = {
  invocations: InvocationSchema[];
};

export type EnumCatalog = {
  values: string[];
};

export type HarnessInvocationMap = {
  invocation_map: Record<string, Record<string, unknown>>;
};

export type HarnessLayout = {
  paths: Record<AssetKind, string>;
};

export type ClaudeAgentRules = {
  model_tier: Record<string, string>;
  capability_disallowed_tools: Record<string, string[]>;
};

export type CodexAgentRules = {
  model_tier: Record<string, string>;
  capability_sandbox_mode: Record<string, string | null>;
  capability_disabled_tools: Record<string, string[]>;
  nx_mcp_server?: {
    command?: string;
    args?: string[];
  };
};

export type OpencodeAgentRules = {
  model_tier: Record<string, string | null>;
  capability_permissions: Record<string, Record<string, string>>;
};

export type SpecDocument = {
  kind: AssetKind;
  id: string;
  name: string;
  description: string;
  frontmatter: Record<string, unknown>;
  body: string;
  sourcePath: string;
};

export type GeneratedFile = {
  kind: AssetKind;
  sourcePath: string;
  targetPath: string;
  content: string;
};

export type SyncOptions = {
  harness: Harness;
  target: string;
  dryRun?: boolean;
};

export type SyncResult = {
  harness: Harness;
  targetRoot: string;
  files: GeneratedFile[];
  writtenFiles: string[];
};

export type ParsedMacro = {
  id: string;
  params: Record<string, string | { heredoc: string }>;
};

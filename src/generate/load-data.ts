import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  ClaudeAgentRules,
  CodexAgentRules,
  EnumCatalog,
  Harness,
  HarnessInvocationMap,
  HarnessLayout,
  InvocationCatalog,
  InvocationSchema,
  OpencodeAgentRules,
} from "./types.js";

const PACKAGE_ROOT = new URL("../../", import.meta.url);

function readYamlFile<T>(relativePath: string): T {
  const absolutePath = new URL(relativePath, PACKAGE_ROOT);
  return parseYaml(readFileSync(absolutePath, "utf8")) as T;
}

export function loadInvocationCatalog(): Map<string, InvocationSchema> {
  const catalog = readYamlFile<InvocationCatalog>("vocabulary/invocations.yml");
  const result = new Map<string, InvocationSchema>();

  for (const invocation of catalog.invocations) {
    const params: InvocationSchema["params"] = {};

    for (const [name, schema] of Object.entries(invocation.params)) {
      const resolved = { ...schema };
      if (schema.type === "enum" && schema.values_ref) {
        const enumValues = readYamlFile<EnumCatalog>(
          join("vocabulary", schema.values_ref),
        );
        resolved.values = enumValues.values;
      }
      params[name] = resolved;
    }

    result.set(invocation.id, {
      id: invocation.id,
      params,
    });
  }

  return result;
}

export function loadHarnessInvocationMap(
  harness: Harness,
): HarnessInvocationMap["invocation_map"] {
  const data = readYamlFile<HarnessInvocationMap>(
    `harness/${harness}/invocations.yml`,
  );
  return data.invocation_map;
}

export function loadHarnessLayout(harness: Harness): HarnessLayout {
  return readYamlFile<HarnessLayout>(`harness/${harness}/layout.yml`);
}

export function loadClaudeAgentRules(): ClaudeAgentRules {
  return readYamlFile<ClaudeAgentRules>("harness/claude/agent-rules.yml");
}

export function loadCodexAgentRules(): CodexAgentRules {
  return readYamlFile<CodexAgentRules>("harness/codex/agent-rules.yml");
}

export function loadOpencodeAgentRules(): OpencodeAgentRules {
  return readYamlFile<OpencodeAgentRules>("harness/opencode/agent-rules.yml");
}

import type { HookHandler, NexusHookOutput } from "../../../src/hooks/types.js";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  expandInvocations,
  type InvocationsMap,
  type Harness,
} from "../../../src/shared/invocations.js";

// Tag priority: specific variants first (m:gc > m, rule:name > rule, plan:auto > plan, init:reset > init)
const TAG_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "plan:auto", regex: /\[plan:auto\]/ },
  { name: "plan", regex: /\[plan\](?!\w)/ },
  { name: "run", regex: /\[run\](?!\w)/ },
  { name: "d", regex: /\[d\](?!\w)/ },
  { name: "m:gc", regex: /\[m:gc\]/ },
  { name: "m", regex: /\[m\](?!\w)/ },
  { name: "rule:name", regex: /\[rule:([a-zA-Z0-9_-]+)\]/ },
  { name: "rule", regex: /\[rule\](?!\w)/ },
  { name: "sync", regex: /\[sync\](?!\w)/ },
  { name: "init:reset", regex: /\[init:reset\]/ },
  { name: "init", regex: /\[init\](?!\w)/ },
];

// ---------------------------------------------------------------------------
// Invocations loader — cached per process
// ---------------------------------------------------------------------------

let _invocationsCache: InvocationsMap | null = null;

function loadInvocations(): InvocationsMap {
  if (_invocationsCache) return _invocationsCache;

  const selfDir = new URL(".", import.meta.url).pathname;
  // Walk up from handler directory to find assets/tools/tool-name-map.yml
  let dir = selfDir;
  while (dir !== "/") {
    const candidate = resolve(dir, "assets/tools/tool-name-map.yml");
    if (existsSync(candidate)) {
      const raw = readFileSync(candidate, "utf-8");
      const parsed = parseYaml(raw) as { invocations?: InvocationsMap };
      if (!parsed.invocations) {
        throw new Error("[prompt-router] tool-name-map.yml missing 'invocations' section");
      }
      _invocationsCache = parsed.invocations;
      return _invocationsCache;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(`[prompt-router] Cannot locate assets/tools/tool-name-map.yml from ${selfDir}`);
}

// ---------------------------------------------------------------------------
// Harness resolution
// ---------------------------------------------------------------------------

function resolveHarness(): Harness {
  const h = process.env["NEXUS_HARNESS"];
  if (h === "claude" || h === "opencode" || h === "codex") return h;
  if (h) {
    process.stderr.write(
      `[prompt-router] Unknown NEXUS_HARNESS="${h}", falling back to "claude"\n`
    );
  }
  return "claude";
}

// ---------------------------------------------------------------------------
// Invocation expansion helper
// ---------------------------------------------------------------------------

function expand(template: string, harness: Harness): string {
  return expandInvocations(template, harness, loadInvocations());
}

// ---------------------------------------------------------------------------
// Rule target loader
// ---------------------------------------------------------------------------

function loadValidRuleTargets(cwd: string): string[] {
  const targets: string[] = [];
  for (const dir of ["assets/agents", "assets/skills"]) {
    const absDir = join(cwd, dir);
    if (!existsSync(absDir)) continue;
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      if (entry.isDirectory()) targets.push(entry.name);
    }
  }
  return targets;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const handler: HookHandler = async (input): Promise<NexusHookOutput | void> => {
  if (input.hook_event_name !== "UserPromptSubmit") return;

  const prompt = input.prompt;
  const detected: Array<{ name: string; arg?: string }> = [];

  // Detect all tags — use seen Set keyed on base tag name to prevent duplicates
  // (e.g. plan:auto and plan share base "plan"; whichever appears first wins)
  const seen = new Set<string>();
  for (const { name, regex } of TAG_PATTERNS) {
    const m = regex.exec(prompt);
    if (!m) continue;
    const base = name.split(":")[0];
    if (seen.has(base)) continue;
    seen.add(base);
    detected.push({ name, arg: m[1] });
  }

  const sessionDir = join(input.cwd, ".nexus/state", input.session_id);
  const planPath = join(sessionDir, "plan.json");
  const tasksPath = join(sessionDir, "tasks.json");
  const hasPlan = existsSync(planPath);
  const hasTasks = existsSync(tasksPath);

  const harness = resolveHarness();

  const notices: string[] = [];
  let decision: "block" | undefined;
  let block_reason: string | undefined;

  for (const tag of detected) {
    switch (tag.name) {
      case "plan":
        notices.push(
          `<system-notice>[plan] tag detected. ${expand('{{skill_activation skill="nx-plan"}}', harness)} for structured planning.</system-notice>`
        );
        break;

      case "plan:auto":
        notices.push(
          `<system-notice>[plan:auto] tag detected. ${expand('{{skill_activation skill="nx-plan" mode="auto"}}', harness)} for structured planning.</system-notice>`
        );
        break;

      case "run":
        if (!hasTasks) {
          notices.push(
            `<system-notice>[run] tag detected but no tasks.json. ${expand('{{skill_activation skill="nx-plan"}}', harness)} with args "auto" first to generate tasks, then run.</system-notice>`
          );
        } else {
          notices.push(
            `<system-notice>[run] tag detected. ${expand('{{skill_activation skill="nx-run"}}', harness)} to execute tasks.</system-notice>`
          );
        }
        break;

      case "d":
        if (!hasPlan) {
          decision = "block";
          block_reason =
            `[d] tag requires an active plan session. ${expand('{{skill_activation skill="nx-plan"}}', harness)} first.`;
        } else {
          notices.push(
            `<system-notice>[d] tag detected. Record decision via \`nx_plan_decide(issue_id, summary)\` MCP tool.</system-notice>`
          );
        }
        break;

      case "m":
        notices.push(
          `<system-notice>[m] tag detected. Save a memory note to \`.nexus/memory/<prefix>-<name>.md\`. Prefix: empirical-, external-, or pattern- (see architecture.md §2-1).</system-notice>`
        );
        break;

      case "m:gc":
        notices.push(
          `<system-notice>[m:gc] tag detected. Review \`.nexus/memory/\` for stale or duplicate entries and consolidate.</system-notice>`
        );
        break;

      case "rule": {
        const valid = loadValidRuleTargets(input.cwd);
        notices.push(
          `<system-notice>[rule] tag detected. Determine target from intent. Valid targets: ${valid.join(", ")}. Update \`.nexus/rules/<target>.md\`.</system-notice>`
        );
        break;
      }

      case "rule:name": {
        const valid = loadValidRuleTargets(input.cwd);
        const name = tag.arg ?? "";
        if (!valid.includes(name)) {
          decision = "block";
          block_reason = `[rule:${name}] invalid — must be one of: ${valid.join(", ")}`;
        } else {
          notices.push(
            `<system-notice>[rule:${name}] tag detected. Update \`.nexus/rules/${name}.md\` with user's directive.</system-notice>`
          );
        }
        break;
      }

      case "sync":
        notices.push(
          `<system-notice>[sync] tag detected. ${expand('{{skill_activation skill="nx-sync"}}', harness)} to synchronize \`.nexus/context/\`.</system-notice>`
        );
        break;

      case "init":
        notices.push(
          `<system-notice>[init] tag detected. ${expand('{{skill_activation skill="nx-init"}}', harness)} for project onboarding.</system-notice>`
        );
        break;

      case "init:reset":
        notices.push(
          `<system-notice>[init:reset] tag detected. ${expand('{{skill_activation skill="nx-init" mode="reset"}}', harness)} for full re-initialization.</system-notice>`
        );
        break;
    }
  }

  // No tags detected + active state → emit state notice
  if (detected.length === 0) {
    if (hasPlan) {
      try {
        const plan = JSON.parse(readFileSync(planPath, "utf-8")) as {
          topic?: string;
          issues?: Array<{ status: string }>;
        };
        const pending = plan.issues?.filter((i) => i.status === "pending").length ?? 0;
        notices.push(
          `<system-notice>Active plan session: "${plan.topic ?? "(unknown)"}", ${pending} issues pending.</system-notice>`
        );
      } catch {
        // Malformed plan.json — skip notice
      }
    } else if (hasTasks) {
      try {
        const tasks = JSON.parse(readFileSync(tasksPath, "utf-8")) as {
          tasks?: Array<{ status: string }>;
        };
        const pending = tasks.tasks?.filter((t) => t.status !== "completed").length ?? 0;
        if (pending > 0) {
          notices.push(
            `<system-notice>Active run session: ${pending} tasks remaining in tasks.json.</system-notice>`
          );
        }
      } catch {
        // Malformed tasks.json — skip notice
      }
    }
  }

  if (decision === "block") {
    return { decision, block_reason };
  }
  if (notices.length === 0) return;
  return { additional_context: notices.join("\n\n") };
};

export default handler;

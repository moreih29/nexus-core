/**
 * prompt-router/handler.test.ts
 *
 * Verifies all 11 tag handlers × state combinations described in Task #18.
 * Uses bun:test. Fixtures placed in a tmp directory per describe block.
 */

import { test, expect, describe, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { NexusHookInput, NexusHookOutput } from "../../../src/hooks/types.js";
import handler from "./handler.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Root tmp dir shared across all tests in this module. */
let ROOT: string;
const SESSION_ID = "test-session-001";

function sessionDir(): string {
  return path.join(ROOT, ".nexus", "state", SESSION_ID);
}

function planPath(): string {
  return path.join(sessionDir(), "plan.json");
}

function tasksPath(): string {
  return path.join(sessionDir(), "tasks.json");
}

function ensureSessionDir(): void {
  fs.mkdirSync(sessionDir(), { recursive: true });
}

function writePlan(topic = "test-topic", pendingCount = 2): void {
  ensureSessionDir();
  const issues = [
    ...Array.from({ length: pendingCount }, (_, i) => ({
      id: `I${i + 1}`,
      status: "pending",
    })),
    { id: "I99", status: "completed" },
  ];
  fs.writeFileSync(planPath(), JSON.stringify({ topic, issues }));
}

function writeTasks(pendingCount = 3): void {
  ensureSessionDir();
  const tasks = [
    ...Array.from({ length: pendingCount }, (_, i) => ({
      id: `T${i + 1}`,
      status: "open",
    })),
    { id: "T99", status: "completed" },
  ];
  fs.writeFileSync(tasksPath(), JSON.stringify({ tasks }));
}

function removePlan(): void {
  try {
    fs.unlinkSync(planPath());
  } catch {
    // already absent
  }
}

function removeTasks(): void {
  try {
    fs.unlinkSync(tasksPath());
  } catch {
    // already absent
  }
}

function makeInput(prompt: string): NexusHookInput {
  return {
    hook_event_name: "UserPromptSubmit",
    session_id: SESSION_ID,
    cwd: ROOT,
    prompt,
  };
}

/** Assert output has additional_context and does NOT block. */
function assertNotice(
  result: NexusHookOutput | void,
  expected: RegExp | string
): void {
  expect(result).not.toBeUndefined();
  const r = result as NexusHookOutput;
  expect(r.decision).toBeUndefined();
  expect(r.additional_context).toMatch(expected);
}

/** Assert output is a block decision. */
function assertBlock(
  result: NexusHookOutput | void,
  reasonPattern?: RegExp | string
): void {
  expect(result).not.toBeUndefined();
  const r = result as NexusHookOutput;
  expect(r.decision).toBe("block");
  if (reasonPattern) {
    expect(r.block_reason).toMatch(reasonPattern);
  }
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-prompt-router-"));
  // Create mock agent and skill directories so loadValidRuleTargets works.
  for (const name of ["architect", "engineer", "reviewer"]) {
    fs.mkdirSync(path.join(ROOT, "assets", "agents", name), { recursive: true });
  }
  for (const name of ["nx-plan", "nx-run", "nx-sync", "nx-init"]) {
    fs.mkdirSync(path.join(ROOT, "assets", "skills", name), { recursive: true });
  }
  // Ensure session dir exists (plan/tasks written per-test).
  ensureSessionDir();
});

afterAll(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Scenario 1 — [plan] alone → nx-plan skill, no "auto" args
// ---------------------------------------------------------------------------

describe("scenario 1 — [plan] alone", () => {
  test("additional_context mentions nx-plan", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[plan] structured planning"));
    assertNotice(result, /nx-plan/);
    assertNotice(result, /<system-notice>/);
  });

  test("does NOT mention 'auto'", async () => {
    const result = await handler(makeInput("[plan] structured planning")) as NexusHookOutput;
    expect(result?.additional_context).not.toMatch(/auto/);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2 — [plan:auto] → nx-plan + "auto", prioritised over [plan]
// ---------------------------------------------------------------------------

describe("scenario 2 — [plan:auto] priority over [plan]", () => {
  test('[plan:auto] context includes "auto"', async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[plan:auto] auto planning"));
    assertNotice(result, /auto/);
  });

  test("[plan:auto] is dispatched even when [plan] also appears in prompt", async () => {
    // [plan:auto] appears first → base "plan" is locked → [plan] variant skipped
    const result = await handler(
      makeInput("[plan:auto] [plan] do not double-dispatch")
    ) as NexusHookOutput;
    // Should mention auto (from plan:auto) exactly once
    const ctx = result?.additional_context ?? "";
    expect((ctx.match(/plan:auto/g) ?? []).length).toBe(1);
    // Must NOT also contain a plain [plan] notice (no second system-notice for plain plan)
    expect((ctx.match(/<system-notice>/g) ?? []).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — [run] + tasks.json present → nx-run
// ---------------------------------------------------------------------------

describe("scenario 3 — [run] with tasks.json present", () => {
  test("invokes nx-run skill", async () => {
    removePlan();
    writeTasks();
    const result = await handler(makeInput("[run] execute tasks"));
    assertNotice(result, /nx-run/);
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — [run] + tasks.json absent → nx-plan auto guidance
// ---------------------------------------------------------------------------

describe("scenario 4 — [run] without tasks.json", () => {
  test("recommends nx-plan auto first", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[run] go"));
    assertNotice(result, /nx-plan/);
    assertNotice(result, /auto/);
    // Must NOT directly invoke nx-run
    const r = result as NexusHookOutput;
    expect(r.additional_context).not.toMatch(/Invoke `nx-run`/);
  });
});

// ---------------------------------------------------------------------------
// Scenario 5 — [d] + plan.json present → nx_plan_decide guidance
// ---------------------------------------------------------------------------

describe("scenario 5 — [d] with active plan", () => {
  test("guides to nx_plan_decide", async () => {
    writePlan();
    removeTasks();
    const result = await handler(makeInput("[d] decide now"));
    assertNotice(result, /nx_plan_decide/);
  });
});

// ---------------------------------------------------------------------------
// Scenario 6 — [d] + plan.json absent → decision:block
// ---------------------------------------------------------------------------

describe("scenario 6 — [d] without plan — decision:block", () => {
  test("blocks with reason about nx-plan", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[d] decide"));
    assertBlock(result, /nx-plan/);
  });

  test("block_reason is English text", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[d] decide")) as NexusHookOutput;
    // Must be a non-empty English string (ASCII)
    expect(result.block_reason).toBeTruthy();
    expect(result.block_reason).toMatch(/[a-zA-Z]/);
  });
});

// ---------------------------------------------------------------------------
// Scenario 7 — [m] → memory notice, distinct from [m:gc]
// ---------------------------------------------------------------------------

describe("scenario 7 — [m] memory save", () => {
  test("mentions .nexus/memory/ save guidance", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[m] remember this"));
    assertNotice(result, /\.nexus\/memory\//);
  });

  test("[m] notice does NOT mention 'consolidate' (that's [m:gc])", async () => {
    const result = await handler(makeInput("[m] remember this")) as NexusHookOutput;
    expect(result.additional_context).not.toMatch(/consolidate/);
  });
});

// ---------------------------------------------------------------------------
// Scenario 8 — [m:gc] → gc guidance, distinct from [m]
// ---------------------------------------------------------------------------

describe("scenario 8 — [m:gc] garbage-collect", () => {
  test("mentions consolidate or stale entry cleanup", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[m:gc] clean memory"));
    assertNotice(result, /consolidate|stale/i);
  });

  test("[m:gc] notice does NOT reference prefix/pattern (that's [m])", async () => {
    const result = await handler(makeInput("[m:gc] clean memory")) as NexusHookOutput;
    // [m] notice mentions "Prefix:" — [m:gc] should not
    expect(result.additional_context).not.toMatch(/Prefix:/);
  });
});

// ---------------------------------------------------------------------------
// Scenario 9 — [rule] alone → valid targets listed
// ---------------------------------------------------------------------------

describe("scenario 9 — [rule] without name", () => {
  test("lists valid targets from agents + skills dirs", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[rule] add a new rule"));
    // Our fixtures: architect, engineer, reviewer, nx-plan, nx-run, nx-sync, nx-init
    assertNotice(result, /architect/);
    assertNotice(result, /nx-plan/);
  });
});

// ---------------------------------------------------------------------------
// Scenario 10 — [rule:valid_name] → update guidance
// ---------------------------------------------------------------------------

describe("scenario 10 — [rule:architect] valid target", () => {
  test("guides to update .nexus/rules/architect.md", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[rule:architect] new rule content"));
    assertNotice(result, /\.nexus\/rules\/architect\.md/);
  });
});

// ---------------------------------------------------------------------------
// Scenario 11 — [rule:invalid_name] → decision:block
// ---------------------------------------------------------------------------

describe("scenario 11 — [rule:nonexistent] invalid target — decision:block", () => {
  test("blocks with reason listing valid targets", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[rule:nonexistent] bad rule"));
    assertBlock(result, /nonexistent/);
  });

  test("block_reason mentions valid alternatives", async () => {
    const result = await handler(
      makeInput("[rule:nonexistent] bad rule")
    ) as NexusHookOutput;
    // Should mention at least one valid target
    expect(result.block_reason).toMatch(/architect|engineer|nx-plan/);
  });
});

// ---------------------------------------------------------------------------
// Scenario 12 — [sync] → nx-sync guidance
// ---------------------------------------------------------------------------

describe("scenario 12 — [sync]", () => {
  test("invokes nx-sync skill guidance", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[sync] synchronize context"));
    assertNotice(result, /nx-sync/);
    assertNotice(result, /\.nexus\/context\//);
  });
});

// ---------------------------------------------------------------------------
// Scenario 13 — [init] vs [init:reset] distinction
// ---------------------------------------------------------------------------

describe("scenario 13 — [init] and [init:reset] distinction", () => {
  test("[init] mentions nx-init for onboarding", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[init] project setup"));
    assertNotice(result, /nx-init/);
    // Must NOT say "reset"
    const r = result as NexusHookOutput;
    expect(r.additional_context).not.toMatch(/reset/);
  });

  test("[init:reset] includes 'reset' args", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[init:reset] full reset"));
    assertNotice(result, /reset/);
  });

  test("[init:reset] is dispatched instead of [init] when both appear", async () => {
    // [init:reset] appears first in TAG_PATTERNS → base "init" seen → [init] skipped
    const result = await handler(
      makeInput("[init:reset] [init] should not double")
    ) as NexusHookOutput;
    const ctx = result?.additional_context ?? "";
    expect((ctx.match(/<system-notice>/g) ?? []).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Scenario 14 — multiple tags in single prompt ([plan] [m])
// ---------------------------------------------------------------------------

describe("scenario 14 — multiple tags processed together", () => {
  test("[plan] and [m] both produce notices", async () => {
    removePlan();
    removeTasks();
    const result = await handler(
      makeInput("[plan] create plan [m] remember this lesson")
    ) as NexusHookOutput;
    expect(result).not.toBeUndefined();
    expect(result.decision).toBeUndefined();
    const ctx = result.additional_context ?? "";
    expect(ctx).toMatch(/nx-plan/);
    expect(ctx).toMatch(/\.nexus\/memory\//);
    // Two system-notice blocks
    expect((ctx.match(/<system-notice>/g) ?? []).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Scenario 15 — no tags + active plan.json → state notice
// ---------------------------------------------------------------------------

describe("scenario 15 — no tags with active plan.json", () => {
  test("emits active plan session notice", async () => {
    writePlan("my-feature", 3);
    removeTasks();
    const result = await handler(makeInput("just a regular message"));
    assertNotice(result, /my-feature/);
    assertNotice(result, /pending/);
  });
});

// ---------------------------------------------------------------------------
// Scenario 16 — no tags + no plan.json + no tasks.json → no output
// ---------------------------------------------------------------------------

describe("scenario 16 — no tags, no state files", () => {
  test("returns undefined (no output)", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("just chatting, no tags"));
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Scenario 17 — all notices are English + wrapped in <system-notice>
// ---------------------------------------------------------------------------

describe("scenario 17 — all notices are English and use <system-notice>", () => {
  const tagCases: Array<[string, string]> = [
    ["[plan]", "[plan] do something"],
    ["[plan:auto]", "[plan:auto] do auto"],
    ["[run] with tasks", "[run] run tasks"], // will have tasks.json
    ["[m]", "[m] save this"],
    ["[m:gc]", "[m:gc] gc"],
    ["[rule]", "[rule] add rule"],
    ["[rule:architect]", "[rule:architect] update"],
    ["[sync]", "[sync] sync now"],
    ["[init]", "[init] project"],
    ["[init:reset]", "[init:reset] reset"],
  ];

  for (const [label, prompt] of tagCases) {
    test(`${label} — notice is English + <system-notice> wrapped`, async () => {
      if (label === "[run] with tasks") {
        writeTasks();
      } else {
        removeTasks();
      }
      removePlan();

      const result = await handler(makeInput(prompt));
      // Must return something (not undefined, not block for these cases)
      expect(result).not.toBeUndefined();
      const r = result as NexusHookOutput;

      // For non-blocking cases: check additional_context
      if (r.decision !== "block") {
        const ctx = r.additional_context ?? "";
        expect(ctx).toMatch(/<system-notice>/);
        expect(ctx).toMatch(/<\/system-notice>/);
        // Must be primarily ASCII English (no Korean/CJK characters)
        expect(ctx).not.toMatch(/[\u4e00-\u9fff\uac00-\ud7a3\u3040-\u30ff]/);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Regex priority verification
// ---------------------------------------------------------------------------

describe("regex priority — specific variants win over generic", () => {
  test("[plan:auto] wins over [plan] — base 'plan' not double-dispatched", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[plan:auto] [plan]")) as NexusHookOutput;
    // Only one system-notice emitted (plan:auto wins; plain plan skipped)
    const ctx = result?.additional_context ?? "";
    expect((ctx.match(/<system-notice>/g) ?? []).length).toBe(1);
    expect(ctx).toMatch(/plan:auto/);
  });

  test("[m:gc] wins over [m] when both appear", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[m:gc] [m]")) as NexusHookOutput;
    const ctx = result?.additional_context ?? "";
    expect((ctx.match(/<system-notice>/g) ?? []).length).toBe(1);
    expect(ctx).toMatch(/m:gc/);
    expect(ctx).not.toMatch(/Prefix:/);
  });

  test("[init:reset] wins over [init] when both appear", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[init:reset] [init]")) as NexusHookOutput;
    const ctx = result?.additional_context ?? "";
    expect((ctx.match(/<system-notice>/g) ?? []).length).toBe(1);
    expect(ctx).toMatch(/reset/);
  });
});

// ---------------------------------------------------------------------------
// Non-UserPromptSubmit events are ignored
// ---------------------------------------------------------------------------

describe("non-UserPromptSubmit events are ignored", () => {
  test("SessionStart returns undefined", async () => {
    const input: NexusHookInput = {
      hook_event_name: "SessionStart",
      session_id: SESSION_ID,
      cwd: ROOT,
    };
    const result = await handler(input);
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Harness matrix — 3 harnesses × primary tag cases (invocations SSOT)
// ---------------------------------------------------------------------------
// Expected expanded strings per harness (skill_activation template):
//   claude:   Skill({ command: "<skill>" })
//   opencode: skill({ name: "<skill>" })
//   codex:    $<skill>

describe("harness matrix — claude", () => {
  let _savedHarness: string | undefined;

  beforeEach(() => {
    _savedHarness = process.env["NEXUS_HARNESS"];
    process.env["NEXUS_HARNESS"] = "claude";
  });

  afterEach(() => {
    if (_savedHarness === undefined) {
      delete process.env["NEXUS_HARNESS"];
    } else {
      process.env["NEXUS_HARNESS"] = _savedHarness;
    }
  });

  test("[plan] → Skill({ command: \"nx-plan\" })", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[plan] go")) as NexusHookOutput;
    expect(result.additional_context).toMatch(/Skill\(\{ command: "nx-plan" \}\)/);
  });

  test("[plan:auto] → Skill({ command: \"nx-plan\" }) + auto in tag text", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[plan:auto] go")) as NexusHookOutput;
    expect(result.additional_context).toMatch(/Skill\(\{ command: "nx-plan" \}\)/);
    expect(result.additional_context).toMatch(/auto/);
  });

  test("[run] with tasks → Skill({ command: \"nx-run\" })", async () => {
    removePlan();
    writeTasks();
    const result = await handler(makeInput("[run] go")) as NexusHookOutput;
    expect(result.additional_context).toMatch(/Skill\(\{ command: "nx-run" \}\)/);
  });

  test("[run] no tasks → Skill({ command: \"nx-plan\" }) + auto", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[run] go")) as NexusHookOutput;
    expect(result.additional_context).toMatch(/Skill\(\{ command: "nx-plan" \}\)/);
    expect(result.additional_context).toMatch(/auto/);
  });

  test("[sync] → Skill({ command: \"nx-sync\" })", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[sync] go")) as NexusHookOutput;
    expect(result.additional_context).toMatch(/Skill\(\{ command: "nx-sync" \}\)/);
  });

  test("[init] → Skill({ command: \"nx-init\" })", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[init] go")) as NexusHookOutput;
    expect(result.additional_context).toMatch(/Skill\(\{ command: "nx-init" \}\)/);
  });

  test("[init:reset] → Skill({ command: \"nx-init\" }) + reset in tag text", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[init:reset] go")) as NexusHookOutput;
    expect(result.additional_context).toMatch(/Skill\(\{ command: "nx-init" \}\)/);
    expect(result.additional_context).toMatch(/reset/);
  });
});

describe("harness matrix — opencode", () => {
  let _savedHarness: string | undefined;

  beforeEach(() => {
    _savedHarness = process.env["NEXUS_HARNESS"];
    process.env["NEXUS_HARNESS"] = "opencode";
  });

  afterEach(() => {
    if (_savedHarness === undefined) {
      delete process.env["NEXUS_HARNESS"];
    } else {
      process.env["NEXUS_HARNESS"] = _savedHarness;
    }
  });

  test("[plan] → skill({ name: \"nx-plan\" })", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[plan] go")) as NexusHookOutput;
    expect(result.additional_context).toMatch(/skill\(\{ name: "nx-plan" \}\)/);
  });

  test("[plan:auto] → skill({ name: \"nx-plan\" }) + auto", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[plan:auto] go")) as NexusHookOutput;
    expect(result.additional_context).toMatch(/skill\(\{ name: "nx-plan" \}\)/);
    expect(result.additional_context).toMatch(/auto/);
  });

  test("[run] with tasks → skill({ name: \"nx-run\" })", async () => {
    removePlan();
    writeTasks();
    const result = await handler(makeInput("[run] go")) as NexusHookOutput;
    expect(result.additional_context).toMatch(/skill\(\{ name: "nx-run" \}\)/);
  });

  test("[run] no tasks → skill({ name: \"nx-plan\" }) + auto", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[run] go")) as NexusHookOutput;
    expect(result.additional_context).toMatch(/skill\(\{ name: "nx-plan" \}\)/);
    expect(result.additional_context).toMatch(/auto/);
  });

  test("[sync] → skill({ name: \"nx-sync\" })", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[sync] go")) as NexusHookOutput;
    expect(result.additional_context).toMatch(/skill\(\{ name: "nx-sync" \}\)/);
  });

  test("[init] → skill({ name: \"nx-init\" })", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[init] go")) as NexusHookOutput;
    expect(result.additional_context).toMatch(/skill\(\{ name: "nx-init" \}\)/);
  });

  test("[init:reset] → skill({ name: \"nx-init\" }) + reset", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[init:reset] go")) as NexusHookOutput;
    expect(result.additional_context).toMatch(/skill\(\{ name: "nx-init" \}\)/);
    expect(result.additional_context).toMatch(/reset/);
  });
});

describe("harness matrix — codex", () => {
  let _savedHarness: string | undefined;

  beforeEach(() => {
    _savedHarness = process.env["NEXUS_HARNESS"];
    process.env["NEXUS_HARNESS"] = "codex";
  });

  afterEach(() => {
    if (_savedHarness === undefined) {
      delete process.env["NEXUS_HARNESS"];
    } else {
      process.env["NEXUS_HARNESS"] = _savedHarness;
    }
  });

  test("[plan] → $nx-plan", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[plan] go")) as NexusHookOutput;
    expect(result.additional_context).toMatch(/\$nx-plan/);
  });

  test("[plan:auto] → $nx-plan + auto in tag text", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[plan:auto] go")) as NexusHookOutput;
    expect(result.additional_context).toMatch(/\$nx-plan/);
    expect(result.additional_context).toMatch(/auto/);
  });

  test("[run] with tasks → $nx-run", async () => {
    removePlan();
    writeTasks();
    const result = await handler(makeInput("[run] go")) as NexusHookOutput;
    expect(result.additional_context).toMatch(/\$nx-run/);
  });

  test("[run] no tasks → $nx-plan + auto", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[run] go")) as NexusHookOutput;
    expect(result.additional_context).toMatch(/\$nx-plan/);
    expect(result.additional_context).toMatch(/auto/);
  });

  test("[sync] → $nx-sync", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[sync] go")) as NexusHookOutput;
    expect(result.additional_context).toMatch(/\$nx-sync/);
  });

  test("[init] → $nx-init", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[init] go")) as NexusHookOutput;
    expect(result.additional_context).toMatch(/\$nx-init/);
  });

  test("[init:reset] → $nx-init + reset in tag text", async () => {
    removePlan();
    removeTasks();
    const result = await handler(makeInput("[init:reset] go")) as NexusHookOutput;
    expect(result.additional_context).toMatch(/\$nx-init/);
    expect(result.additional_context).toMatch(/reset/);
  });
});

// ---------------------------------------------------------------------------
// 모듈 전역 상태 격리
// ---------------------------------------------------------------------------

describe("모듈 전역 상태 격리", () => {
  function makePromptInput(cwd: string, prompt: string): NexusHookInput {
    return {
      hook_event_name: "UserPromptSubmit",
      session_id: "sess-isolation",
      cwd,
      prompt,
    };
  }

  // Test A: two cwds with different agents/skills → each sees only its own targets
  test("Test A: different cwds return only their own valid rule targets", async () => {
    const tmpDir1 = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-pr-isolation-a1-"));
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-pr-isolation-a2-"));

    try {
      // tmpDir1: agent "architect" only
      fs.mkdirSync(path.join(tmpDir1, "assets/agents/architect"), { recursive: true });

      // tmpDir2: agent "engineer" only
      fs.mkdirSync(path.join(tmpDir2, "assets/agents/engineer"), { recursive: true });

      // [rule:architect] is valid in tmpDir1, invalid in tmpDir2
      const r1 = await handler(makePromptInput(tmpDir1, "[rule:architect] new rule")) as NexusHookOutput;
      expect(r1.decision).toBeUndefined();
      expect(r1.additional_context).toMatch(/architect/);

      const r2 = await handler(makePromptInput(tmpDir2, "[rule:architect] new rule")) as NexusHookOutput;
      expect(r2.decision).toBe("block");

      // [rule:engineer] is invalid in tmpDir1, valid in tmpDir2
      const r3 = await handler(makePromptInput(tmpDir1, "[rule:engineer] new rule")) as NexusHookOutput;
      expect(r3.decision).toBe("block");

      const r4 = await handler(makePromptInput(tmpDir2, "[rule:engineer] new rule")) as NexusHookOutput;
      expect(r4.decision).toBeUndefined();
      expect(r4.additional_context).toMatch(/engineer/);
    } finally {
      fs.rmSync(tmpDir1, { recursive: true, force: true });
      fs.rmSync(tmpDir2, { recursive: true, force: true });
    }
  });

  // Test B: newly added directory is reflected on the next call
  test("Test B: newly added agent directory is recognized in subsequent call", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-pr-isolation-b-"));

    try {
      // Start with "architect" only — "foo" is not a valid target yet
      fs.mkdirSync(path.join(tmpDir, "assets/agents/architect"), { recursive: true });

      const r1 = await handler(makePromptInput(tmpDir, "[rule:foo] test")) as NexusHookOutput;
      expect(r1.decision).toBe("block");

      // Add "foo" agent directory
      fs.mkdirSync(path.join(tmpDir, "assets/agents/foo"), { recursive: true });

      // Next call should see "foo" as a valid target
      const r2 = await handler(makePromptInput(tmpDir, "[rule:foo] test")) as NexusHookOutput;
      expect(r2.decision).toBeUndefined();
      expect(r2.additional_context).toMatch(/foo/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

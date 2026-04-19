/**
 * agent-bootstrap handler tests
 *
 * Scenarios:
 * (1) fresh + registered role (assets/agents/architect exists) → additional_context contains core index + rules
 * (2) fresh + unregistered role ("general") → silent skip (no additional_context)
 * (3) resume_count > 0 → skip (not fresh)
 * (4) .nexus/rules/<role>.md absent → core index only
 * (5) core index > 2KB → truncated to recent-modified N entries
 * (6) tracker write side-effect absent (agent-tracker.json unchanged before/after)
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import handler from "./handler.ts";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Create a temp directory tree suitable for agent-bootstrap tests.
 *  Returns the cwd (root of the fixture).
 *
 *  Layout:
 *    <root>/
 *      assets/agents/architect/          ← registered role
 *      .nexus/memory/                    ← memory .md files
 *      .nexus/context/                   ← context .md files
 *      .nexus/rules/architect.md         ← role rule
 *      .nexus/state/sessions/<sid>/      ← session dir (no tracker by default)
 */
function makeFixture(opts: {
  withRule?: boolean;
  memoryFiles?: number;
  contextFiles?: number;
  withTracker?: { agentId: string; resumeCount: number };
  sessionId?: string;
} = {}): { cwd: string; sessionId: string; cleanup: () => void } {
  const {
    withRule = true,
    memoryFiles = 1,
    contextFiles = 1,
    withTracker,
    sessionId = "sess-test",
  } = opts;

  const cwd = mkdtempSync(join(tmpdir(), "nexus-bootstrap-"));

  // Registered role directory
  mkdirSync(join(cwd, "assets/agents/architect"), { recursive: true });

  // Memory files
  const memDir = join(cwd, ".nexus/memory");
  mkdirSync(memDir, { recursive: true });
  for (let i = 0; i < memoryFiles; i++) {
    writeFileSync(join(memDir, `mem-${i}.md`), `# Memory file ${i}\nsome content`);
  }

  // Context files
  const ctxDir = join(cwd, ".nexus/context");
  mkdirSync(ctxDir, { recursive: true });
  for (let i = 0; i < contextFiles; i++) {
    writeFileSync(join(ctxDir, `ctx-${i}.md`), `# Context file ${i}\nsome content`);
  }

  // Rules
  const rulesDir = join(cwd, ".nexus/rules");
  mkdirSync(rulesDir, { recursive: true });
  if (withRule) {
    writeFileSync(join(rulesDir, "architect.md"), "Always think in systems.");
  }

  // Session dir
  const sessionDir = join(cwd, ".nexus/state", sessionId);
  mkdirSync(sessionDir, { recursive: true });

  // Optional tracker
  if (withTracker) {
    writeFileSync(
      join(sessionDir, "agent-tracker.json"),
      JSON.stringify([
        { agent_id: withTracker.agentId, resume_count: withTracker.resumeCount },
      ])
    );
  }

  return {
    cwd,
    sessionId,
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  };
}

/** Build a SubagentStart input */
function makeInput(
  cwd: string,
  sessionId: string,
  agentType: string,
  agentId = "agent-001"
) {
  return {
    hook_event_name: "SubagentStart" as const,
    session_id: sessionId,
    cwd,
    agent_type: agentType,
    agent_id: agentId,
  };
}

// ---------------------------------------------------------------------------
// Scenario (1): fresh + registered role → additional_context with core index + rules
// ---------------------------------------------------------------------------

describe("scenario 1: fresh + registered role", () => {
  let cleanup: () => void;

  afterAll(() => cleanup?.());

  test("additional_context contains core index and role rule", async () => {
    const { cwd, sessionId, cleanup: c } = makeFixture({ withRule: true });
    cleanup = c;

    const result = await handler(makeInput(cwd, sessionId, "architect"));

    expect(result).toBeDefined();
    expect(result!.additional_context).toBeDefined();
    const ctx = result!.additional_context!;

    // Core index header
    expect(ctx).toContain("Available memory/context:");
    // At least one .md entry
    expect(ctx).toMatch(/\.nexus\/(memory|context)\/.*\.md/);
    // Role rule injection
    expect(ctx).toContain("Custom rule for architect:");
    expect(ctx).toContain("Always think in systems.");
  });
});

// ---------------------------------------------------------------------------
// Scenario (2): fresh + unregistered role → silent skip
// ---------------------------------------------------------------------------

describe("scenario 2: fresh + unregistered role", () => {
  let cleanup: () => void;

  afterAll(() => cleanup?.());

  test("returns undefined (no additional_context) for unknown role", async () => {
    const { cwd, sessionId, cleanup: c } = makeFixture({ withRule: false });
    cleanup = c;

    const result = await handler(makeInput(cwd, sessionId, "general"));

    // Silent skip: handler returns void / undefined
    expect(result == null).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario (3): resume_count > 0 → skip entirely
// ---------------------------------------------------------------------------

describe("scenario 3: resume — skip on resume_count > 0", () => {
  let cleanup: () => void;

  afterAll(() => cleanup?.());

  test("returns undefined when agent has been resumed", async () => {
    const agentId = "agent-resume";
    const { cwd, sessionId, cleanup: c } = makeFixture({
      withTracker: { agentId, resumeCount: 1 },
    });
    cleanup = c;

    const result = await handler(makeInput(cwd, sessionId, "architect", agentId));

    expect(result == null).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario (4): no .nexus/rules/<role>.md → core index only (no rule block)
// ---------------------------------------------------------------------------

describe("scenario 4: no role rule file → core index only", () => {
  let cleanup: () => void;

  afterAll(() => cleanup?.());

  test("additional_context has core index but no rule block", async () => {
    const { cwd, sessionId, cleanup: c } = makeFixture({ withRule: false });
    cleanup = c;

    const result = await handler(makeInput(cwd, sessionId, "architect"));

    expect(result).toBeDefined();
    const ctx = result!.additional_context!;

    expect(ctx).toContain("Available memory/context:");
    expect(ctx).not.toContain("Custom rule for architect:");
  });
});

// ---------------------------------------------------------------------------
// Scenario (5): core index > 2KB → truncated to recent N entries
// ---------------------------------------------------------------------------

describe("scenario 5: 2KB truncation of core index", () => {
  let cleanup: () => void;

  afterAll(() => cleanup?.());

  test("core index is truncated when total size exceeds 2KB", async () => {
    // Create enough files to exceed 2KB.
    // Each entry line looks like:
    //   "- .nexus/memory/mem-XX.md: Memory file XX" (~45 chars + newline)
    // 2048 / 46 ≈ 44 entries needed; create 60 to be safe.
    const LOTS = 60;
    const { cwd, sessionId, cleanup: c } = makeFixture({
      withRule: false,
      memoryFiles: LOTS,
      contextFiles: 0,
    });
    cleanup = c;

    // Spread mtimes so "recent" ordering is deterministic:
    // give each file a distinct mtime (oldest → newest = index 0 → LOTS-1)
    for (let i = 0; i < LOTS; i++) {
      const filePath = join(cwd, ".nexus/memory", `mem-${i}.md`);
      const t = new Date(Date.now() - (LOTS - i) * 10_000); // older files have smaller index
      utimesSync(filePath, t, t);
    }

    const result = await handler(makeInput(cwd, sessionId, "architect"));

    expect(result).toBeDefined();
    const ctx = result!.additional_context!;
    expect(ctx).toContain("Available memory/context:");

    // The raw section between <system-notice> tags for the core index
    const indexSection = ctx.split("</system-notice>")[0];

    // Should NOT contain all 60 files — truncation must have kicked in
    const entryCount = (indexSection.match(/- \.nexus\/memory\/mem-/g) ?? []).length;
    expect(entryCount).toBeGreaterThan(0);
    expect(entryCount).toBeLessThan(LOTS);

    // The index section must not exceed 2KB (plus small wrapper overhead)
    const indexBytes = new TextEncoder().encode(indexSection).length;
    // Allow a generous margin for the header line and wrapping
    expect(indexBytes).toBeLessThan(2048 + 200);
  });
});

// ---------------------------------------------------------------------------
// Scenario (6): no tracker write side-effects
// ---------------------------------------------------------------------------

describe("scenario 6: handler produces no file write side-effects", () => {
  let cleanup: () => void;

  afterAll(() => cleanup?.());

  test("agent-tracker.json is not created or modified by handler", async () => {
    const { cwd, sessionId, cleanup: c } = makeFixture({ withTracker: undefined });
    cleanup = c;

    const trackerPath = join(cwd, ".nexus/state", sessionId, "agent-tracker.json");

    // Tracker must not exist before the call
    expect(existsSync(trackerPath)).toBe(false);

    await handler(makeInput(cwd, sessionId, "architect"));

    // Tracker must still not exist after the call
    expect(existsSync(trackerPath)).toBe(false);
  });

  test("pre-existing agent-tracker.json is not modified by handler", async () => {
    const agentId = "agent-side-effect";
    const { cwd, sessionId, cleanup: c } = makeFixture({
      withTracker: { agentId, resumeCount: 0 },
    });
    cleanup = c;

    const trackerPath = join(cwd, ".nexus/state", sessionId, "agent-tracker.json");
    const before = readFileSync(trackerPath, "utf-8");

    await handler(makeInput(cwd, sessionId, "architect", agentId));

    const after = readFileSync(trackerPath, "utf-8");
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 모듈 전역 상태 격리
// ---------------------------------------------------------------------------

describe("모듈 전역 상태 격리", () => {
  // Test A: two different cwds with different agent sets produce independent results
  test("Test A: different cwds return only their own roles", async () => {
    const tmpDir1 = mkdtempSync(join(tmpdir(), "nexus-isolation-a1-"));
    const tmpDir2 = mkdtempSync(join(tmpdir(), "nexus-isolation-a2-"));

    try {
      // tmpDir1: only "architect"
      mkdirSync(join(tmpDir1, "assets/agents/architect"), { recursive: true });
      mkdirSync(join(tmpDir1, ".nexus/memory"), { recursive: true });
      writeFileSync(join(tmpDir1, ".nexus/memory/mem.md"), "# mem\ncontent");
      mkdirSync(join(tmpDir1, ".nexus/state/sess1"), { recursive: true });

      // tmpDir2: only "engineer"
      mkdirSync(join(tmpDir2, "assets/agents/engineer"), { recursive: true });
      mkdirSync(join(tmpDir2, ".nexus/memory"), { recursive: true });
      writeFileSync(join(tmpDir2, ".nexus/memory/mem.md"), "# mem\ncontent");
      mkdirSync(join(tmpDir2, ".nexus/state/sess2"), { recursive: true });

      // Call with tmpDir1 as architect → should return context
      const r1a = await handler(makeInput(tmpDir1, "sess1", "architect"));
      expect(r1a).toBeDefined();

      // Call with tmpDir1 as engineer → should be skipped (engineer not in tmpDir1)
      const r1b = await handler(makeInput(tmpDir1, "sess1", "engineer"));
      expect(r1b == null).toBe(true);

      // Call with tmpDir2 as engineer → should return context
      const r2a = await handler(makeInput(tmpDir2, "sess2", "engineer"));
      expect(r2a).toBeDefined();

      // Call with tmpDir2 as architect → should be skipped (architect not in tmpDir2)
      const r2b = await handler(makeInput(tmpDir2, "sess2", "architect"));
      expect(r2b == null).toBe(true);
    } finally {
      rmSync(tmpDir1, { recursive: true, force: true });
      rmSync(tmpDir2, { recursive: true, force: true });
    }
  });

  // Test B: adding a new role directory is picked up on the next call
  test("Test B: newly added role is reflected in subsequent call", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "nexus-isolation-b-"));

    try {
      // Start with only "architect"
      mkdirSync(join(tmpDir, "assets/agents/architect"), { recursive: true });
      mkdirSync(join(tmpDir, ".nexus/memory"), { recursive: true });
      writeFileSync(join(tmpDir, ".nexus/memory/mem.md"), "# mem\ncontent");
      mkdirSync(join(tmpDir, ".nexus/state/sess"), { recursive: true });

      // "foo" does not exist yet → should be skipped
      const r1 = await handler(makeInput(tmpDir, "sess", "foo"));
      expect(r1 == null).toBe(true);

      // Add "foo" role directory
      mkdirSync(join(tmpDir, "assets/agents/foo"), { recursive: true });

      // Now "foo" should be recognized on the next call
      const r2 = await handler(makeInput(tmpDir, "sess", "foo"));
      expect(r2).toBeDefined();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

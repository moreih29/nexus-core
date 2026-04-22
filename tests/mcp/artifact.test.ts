import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createInMemoryClient,
  parseTextResult,
  withNexusEnv,
  withTempProjectRoot,
} from "./helpers.js";

test("writes artifacts under .nexus/state/artifacts", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        const result = await client.callTool({
          name: "nx_artifact_write",
          arguments: {
            filename: "reports/findings.md",
            content: "# Findings\n\nMCP test artifact",
          },
        });

        const payload = parseTextResult(result);
        const artifactPath = join(
          projectRoot,
          ".nexus",
          "state",
          "artifacts",
          "reports",
          "findings.md",
        );

        expect(payload).toEqual({
          success: true,
          path: ".nexus/state/artifacts/reports/findings.md",
        });
        expect(readFileSync(artifactPath, "utf8")).toBe(
          "# Findings\n\nMCP test artifact",
        );
      } finally {
        await close();
      }
    });
  });
});

test("sanitizes traversal input for artifact writes", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        const result = await client.callTool({
          name: "nx_artifact_write",
          arguments: {
            filename: "../escape/report.md",
            content: "sanitized",
          },
        });

        const payload = parseTextResult(result) as {
          success: boolean;
          path: string;
        };
        const artifactPath = join(
          projectRoot,
          ".nexus",
          "state",
          "artifacts",
          "escape",
          "report.md",
        );

        expect(payload.success).toBe(true);
        expect(payload.path).toBe(".nexus/state/artifacts/escape/report.md");
        expect(readFileSync(artifactPath, "utf8")).toBe("sanitized");
      } finally {
        await close();
      }
    });
  });
});

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

test("nx_artifact_list returns empty array when artifacts directory is absent", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        const result = await client.callTool({
          name: "nx_artifact_list",
          arguments: {},
        });

        const payload = parseTextResult(result) as {
          artifacts: unknown[];
        };
        expect(payload.artifacts).toEqual([]);
      } finally {
        await close();
      }
    });
  });
});

test("nx_artifact_list returns all artifacts without prefix filter", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        await client.callTool({
          name: "nx_artifact_write",
          arguments: { filename: "reports/a.md", content: "aaa" },
        });
        await client.callTool({
          name: "nx_artifact_write",
          arguments: { filename: "logs/b.txt", content: "bbb" },
        });

        const result = await client.callTool({
          name: "nx_artifact_list",
          arguments: {},
        });

        const payload = parseTextResult(result) as {
          artifacts: Array<{
            filename: string;
            size: number;
            modified_at: string;
          }>;
        };

        expect(payload.artifacts).toHaveLength(2);
        const filenames = payload.artifacts.map((a) => a.filename).sort();
        expect(filenames).toEqual(["logs/b.txt", "reports/a.md"]);

        for (const entry of payload.artifacts) {
          expect(typeof entry.size).toBe("number");
          expect(new Date(entry.modified_at).toISOString()).toBe(
            entry.modified_at,
          );
        }
      } finally {
        await close();
      }
    });
  });
});

test("nx_artifact_list filters by prefix", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        await client.callTool({
          name: "nx_artifact_write",
          arguments: { filename: "reports/a.md", content: "aaa" },
        });
        await client.callTool({
          name: "nx_artifact_write",
          arguments: { filename: "reports/b.md", content: "bbb" },
        });
        await client.callTool({
          name: "nx_artifact_write",
          arguments: { filename: "logs/c.txt", content: "ccc" },
        });

        const result = await client.callTool({
          name: "nx_artifact_list",
          arguments: { prefix: "reports/" },
        });

        const payload = parseTextResult(result) as {
          artifacts: Array<{ filename: string }>;
        };

        expect(payload.artifacts).toHaveLength(2);
        const filenames = payload.artifacts.map((a) => a.filename).sort();
        expect(filenames).toEqual(["reports/a.md", "reports/b.md"]);
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

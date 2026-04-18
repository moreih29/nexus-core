import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { join } from "node:path";
import { readJsonFile } from "../../shared/json-store.js";
import { textResult } from "../../shared/mcp-utils.js";
import { getNexusRoot } from "../../shared/paths.js";
import { type HistoryFile } from "../../types/state.js";

export function registerHistoryTools(server: McpServer): void {
  server.tool(
    "nx_history_search",
    "Search past cycles in .nexus/history.json by full-text or get most recent N",
    {
      query: z.string().optional().describe("Full-text search term against cycle JSON"),
      last_n: z.number().optional().describe("Max cycles to return (default: 10)"),
    },
    async ({ query, last_n }) => {
      const historyPath = join(getNexusRoot(), "history.json");
      const history = await readJsonFile<HistoryFile>(historyPath, { cycles: [] });
      let cycles = Array.isArray(history.cycles) ? history.cycles : [];

      if (query && query.length > 0) {
        const q = query.toLowerCase();
        cycles = cycles.filter((c) => JSON.stringify(c).toLowerCase().includes(q));
      }

      const total = cycles.length;
      const reversed = [...cycles].reverse();   // newest → oldest
      const limit = last_n ?? 10;
      const showing = reversed.slice(0, limit);

      return textResult({
        total,
        showing: showing.length,
        cycles: showing,
      });
    }
  );
}

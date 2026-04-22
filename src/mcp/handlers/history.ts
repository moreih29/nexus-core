import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readJsonFile } from "../../shared/json-store.js";
import { textResult } from "../../shared/mcp-utils.js";
import { getNexusRoot } from "../../shared/paths.js";
import {
  type NxToolBinding,
  registerNxTools,
} from "../../shared/register-tool.js";
import type { HistoryFile } from "../../types/state.js";
import { historySearchTool } from "../definitions/history.js";

interface HistorySearchArgs {
  query?: string;
  last_n?: number;
}

const historyToolBindings: ReadonlyArray<NxToolBinding> = [
  {
    definition: historySearchTool,
    handler: async ({ query, last_n }: HistorySearchArgs) => {
      const historyPath = join(getNexusRoot(), "history.json");
      const history = await readJsonFile<HistoryFile>(historyPath, {
        cycles: [],
      });
      let cycles = Array.isArray(history.cycles) ? history.cycles : [];

      if (query && query.length > 0) {
        const q = query.toLowerCase();
        cycles = cycles.filter((c) =>
          JSON.stringify(c).toLowerCase().includes(q),
        );
      }

      const total = cycles.length;
      const reversed = [...cycles].reverse();
      const limit = last_n ?? 10;
      const showing = reversed.slice(0, limit);

      return textResult({
        total,
        showing: showing.length,
        cycles: showing,
      });
    },
  },
];

export function registerHistoryTools(server: McpServer): void {
  registerNxTools(server, historyToolBindings);
}

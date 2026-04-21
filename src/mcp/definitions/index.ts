import { artifactToolDefinitions } from "./artifact.js";
import { historyToolDefinitions } from "./history.js";
import { planToolDefinitions } from "./plan.js";
import { taskToolDefinitions } from "./task.js";

export {
  artifactToolDefinitions,
  artifactWriteTool,
} from "./artifact.js";
export {
  historySearchTool,
  historyToolDefinitions,
} from "./history.js";
export {
  planAnalysisAddTool,
  planDecideTool,
  planResumeTool,
  planStartTool,
  planStatusTool,
  planToolDefinitions,
  planUpdateTool,
} from "./plan.js";
export {
  taskAddTool,
  taskCloseTool,
  taskListTool,
  taskResumeTool,
  taskToolDefinitions,
  taskUpdateTool,
} from "./task.js";

export const mcpToolDefinitionsByGroup = {
  artifact: artifactToolDefinitions,
  history: historyToolDefinitions,
  plan: planToolDefinitions,
  task: taskToolDefinitions,
} as const;

export const mcpToolDefinitions = Object.values(
  mcpToolDefinitionsByGroup,
).flat();

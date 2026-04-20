import type { Plugin } from "@opencode-ai/plugin";
import { mountHooks } from "@moreih29/nexus-core/hooks/opencode-mount";
import manifest from "@moreih29/nexus-core/hooks/opencode-manifest" with { type: "json" };

export const OpencodeNexus: Plugin = async (ctx) => mountHooks(ctx, manifest);
export default OpencodeNexus;

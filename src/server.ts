import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as tools from "./tools.js";
import { z } from "zod";
import { AnalyticsProvider, withAnalytics } from "./analytics.js";

export interface StdioServerHandle {
  server: McpServer;
  transport: StdioServerTransport;
}

function buildStdioServer(analytics?: AnalyticsProvider): McpServer {
  const server = new McpServer({
    name: "mcp-analytics-server",
    version: "1.0.0",
    capabilities: {
      resources: {},
      tools: {},
    },
  });

  server.tool(
    "getInventory",
    {},
    { title: "Get product inventory" },
    async () => withAnalytics(analytics, "getInventory", () => tools.getInventory())
  );

  server.tool(
    "checkStock",
    { productId: z.string() },
    { title: "Get stock for a specified product" },
    async (args) => withAnalytics(analytics, "checkStock", () => tools.checkStock(args.productId))
  );
  return server;
}

export async function startStdioServer(
    analytics?: AnalyticsProvider
): Promise<StdioServerHandle> {
  const server = buildStdioServer(analytics);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[SERVER] MCP Server running on stdio");

  return { server, transport };
}

export async function stopStdioServer(
  handle: StdioServerHandle,
  analytics?: AnalyticsProvider
): Promise<void> {
  try {
    if(handle.server) await handle.server.close();
    if(analytics) await analytics.close();
    console.error("[SERVER] Server stopped");
    process.exit(0);
  } catch (err) {
    console.error("[SERVER] Error during server shutdown:", err);
  }
}

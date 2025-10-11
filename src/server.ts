import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export interface StdioServerHandle {
  server: McpServer;
  transport: StdioServerTransport;
}

function buildStdioServer(): McpServer {
      const server = new McpServer({
    name: "mcp-analytics-server",
    version: "1.0.0",
    capabilities: {
      resources: {},
      tools: {},
    }})

    return server;
}

export async function startStdioServer(
): Promise<StdioServerHandle> {
  const server = buildStdioServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[SERVER] MCP Server running on stdio");

  return { server, transport };
}

export async function stopStdioServer(
  handle: StdioServerHandle
): Promise<void> {
  try {
    await handle.server.close();
    console.error("[SERVER] Server stopped");
    process.exit(0);
  } catch (err) {
    console.error("[SERVER] Error during server shutdown:", err);
  }
}

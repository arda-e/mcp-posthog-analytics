import "dotenv/config";
import { startStdioServer, stopStdioServer } from "./server.js";

const apiKey = process.env.POSTHOG_API_KEY;

async function main() {
  if(!apiKey) {
    console.error("[SERVER] POSTHOG_API_KEY is not set, continue without analytics");
  }

  try {
    const handle = await startStdioServer();

    process.on("SIGINT", async () => await stopStdioServer(handle));
    process.on("SIGTERM", async () => await stopStdioServer(handle));

    await new Promise(() => {});

  } catch (err) {
    console.error("[SERVER] Error during server startup:", err);
    process.exit(1);
  }
}

(async () => {
  await main();
})();

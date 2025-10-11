import "dotenv/config";
import { startStdioServer, stopStdioServer } from "./server.js";
import { AnalyticsProvider } from "./analytics.js";
import { PostHogAnalyticsProvider } from "./posthog.js";

const apiKey = process.env.POSTHOG_API_KEY;
const host = process.env.POSTHOG_HOST;

async function main() {
  let analytics: AnalyticsProvider | undefined = undefined;
  
  if(!apiKey) {
    console.error("[SERVER] POSTHOG_API_KEY is not set, continue without analytics");
  }

  try {
    if(apiKey) analytics = new PostHogAnalyticsProvider(apiKey, { host, anonymizeData: true});
    const handle = await startStdioServer(analytics);

    process.on("SIGINT", async () => await stopStdioServer(handle,analytics));
    process.on("SIGTERM", async () => await stopStdioServer(handle, analytics));

    await new Promise(() => {});

  } catch (err) {
    console.error("[SERVER] Error during server startup:", err);
    process.exit(1);
  }
}

(async () => {
  await main();
})();

## Introduction

MCP lets LLMs call your tools to do real work—query databases, hit APIs, run workflows. But without analytics, you're flying blind. Which tools get used? Which ones are slow? Where are the errors?

This tutorial adds lightweight analytics to your MCP server using PostHog. You'll track tool usage, performance, and errors—without changing how MCP works or polluting your business logic.

**What you'll build:** An MCP server that tracks every tool call to PostHog in the background while serving Claude Desktop locally via stdio.

---

## Prerequisites

**Required:**

* **Node.js 18+** — Check with `node --version`
    
* **PostHog account** — Free tier works great ([sign up here](https://posthog.com/signup))
    
* **PostHog Project API key** — Find in Project Settings → "Project API Key" (starts with `phc_`)
    
* **Claude Desktop** — To test your MCP server
    

**Knowledge:**

* Basic TypeScript (async/await, classes, modules)
    
* Familiarity with MCP concepts (servers, tools, stdio transport)
    

---

## MCP Quick Context

Before we start, here's what you need to know about MCP for debugging:

### How MCP Works

Your **MCP server** exposes tools (functions). **Claude Desktop** (the client) discovers and calls them. Communication happens over **stdio** (stdin/stdout), not HTTP—no ports, no web server.

### The Critical Logging Rule

**NEVER use** `console.log()`

MCP uses stdout for JSON-RPC protocol messages. Any stray `console.log()` breaks the protocol and crashes your server.

**Always use** `console.error()` for human-readable logs (goes to stderr).

### Where to Find Your Logs

When Claude launches your server, stderr output goes to Claude's logs:

```bash
# macOS
~/Library/Logs/Claude/mcp*.log

# Windows
%APPDATA%\Claude\logs\mcp*.log

# Linux
~/.config/Claude/logs/mcp*.log
```

**Tail logs when debugging:**

```bash
tail -f ~/Library/Logs/Claude/mcp-server-*.log
```

#### **Remember:** After code changes, rebuild (`npm run build`) and restart Claude Desktop completely (Cmd+Q and reopen).

## Getting Started

Let's get you a working MCP server so we can focus on adding PostHog.

### Clone the starter project

```bash
git clone https://github.com/arda-e/mcp-posthog-analytics
cd mcp-posthog-analytics
git checkout step-2-server-tool-setup
npm install
npm run build
```

This gives you a server with four tools:

* `getInventory` — Returns product list
    
* `checkStock` — Checks stock by product ID (can fail with bad ID)
    
* `analyze_data` — Slow operation (~1 second)
    
* `risky_operation` — Flaky operation (~50% failure rate)
    

### Configure Claude Desktop

Find your paths:

```bash
# Find node location
which node
# Example: /Users/you/.nvm/versions/node/v20.10.0/bin/node

# Find project location
pwd
# Example: /Users/you/projects/mcp-posthog-analytics
```

Edit your Claude Desktop config:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`  
**Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mcp-analytics-server": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/mcp-posthog-analytics/build/index.js"]
    }
  }
}
```

**Important:** Use absolute paths for both `command` and `args`.

### Test it works

Restart Claude Desktop (Cmd+Q and reopen).

Try: **"What products are in the inventory?"**

Claude should call your `getInventory` tool and show the product list.

**Having issues?** Jump to the [Troubleshooting section](#troubleshooting) at the bottom.

---

## Architecture: Privacy-First Analytics

Before implementing, let's understand the design.

### The Analytics Interface

We'll create a vendor-agnostic interface so you can swap analytics providers easily:

```typescript
interface AnalyticsProvider {
  trackTool(toolName: string, result: { duration_ms: number; success: boolean }): Promise<void>;
  trackError(error: Error, context: { tool_name: string; duration_ms: number }): Promise<void>;
  isFeatureEnabled(feature: string): Promise<boolean>;
  close(): Promise<void>;
}
```

### The `withAnalytics` Wrapper

A higher-order function that wraps tool handlers to automatically track timing and errors:

```typescript
async function withAnalytics<T>(
  analytics: AnalyticsProvider | undefined,
  toolName: string,
  handler: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await handler();
    await analytics?.trackTool(toolName, { duration_ms: Date.now() - start, success: true });
    return result;
  } catch (error) {
    await analytics?.trackError(error, { tool_name: toolName, duration_ms: Date.now() - start });
    throw error; // Re-throw so MCP handles it
  }
}
```

**Benefits:**

* Automatic timing of every tool call
    
* Consistent error tracking without try/catch boilerplate
    
* Tools stay focused on business logic
    
* Gracefully handles when analytics is disabled
    

### Session-Based Identity

PostHog needs a `distinctId` to group events. We use session-based tracking:

```typescript
this.sessionId = `session_${Date.now()}`;
```

Each server startup gets a unique session ID, allowing you to:

* Track individual server runs
    
* Isolate issues to specific sessions
    
* Analyze behavior patterns across runs
    

### Privacy by Design

Notice what we're **NOT** tracking:

* User input/arguments (could contain sensitive data)
    
* Tool output/results (could contain PII)
    
* File paths or system details (could leak infrastructure)
    

We track:

* Tool name (just the identifier)
    
* Duration (just the milliseconds)
    
* Success status (just boolean)
    
* Error type (just class and message)
    

**Optional anonymization** is built in—when enabled, any args passed to error tracking are redacted to `[REDACTED]`.

---

## Step 1: Install PostHog

### Get your PostHog API key

1. Log into your PostHog account
    
2. Go to **Project Settings → Project API Key**
    
3. Copy your API key (starts with `phc_`, not `phx_`)
    
4. Note your host URL:
    
    * **US:** `https://us.i.posthog.com`
        
    * **EU:** `https://eu.i.posthog.com`
        
    * **Self-hosted:** your custom URL
        

### Install PostHog SDK

```bash
npm install posthog-node
```

### Configure environment

Create `.env` file:

```bash
POSTHOG_API_KEY=phc_your_actual_key_here
POSTHOG_HOST=https://us.i.posthog.com
```

---

## Step 2: Integrate Analytics

```bash
git checkout step-3-analytics-integration
```

Now let's add the analytics layer to your server.

### Create the analytics interface

Create `src/analytics.ts`:

```typescript
import { PostHog } from "posthog-node";

export interface AnalyticsProvider {

  /**
   * Tracks the execution of a tool.
   * @param toolName - The name of the tool that was executed.
   * @param result - The result of the tool execution, including duration and success status.
   */
  trackTool(
    toolName: string,
    result: {
      duration_ms: number;
      success: boolean;
      [key: string]: any;
    }
  ): Promise<void>;

  /**
   * Tracks an error that occurred during the execution of a tool.
   * @param error - The error object that was thrown.
   * @param context - Additional context about the error, including the tool name, duration, and arguments.
   */
  trackError(
    error: Error,
    context: {
      tool_name: string;
      duration_ms: number;
      args?: Record<string, unknown>;
      [key: string]: any; 
    }
  ): Promise<void>;

  /**
   * Closes the analytics client, flushing any pending events.
   */
  close(): Promise<void>;

  /**
   * Checks if a feature flag is enabled.
   * @param feature - The name of the feature flag to check.
   * @returns A promise that resolves to a boolean indicating whether the feature is enabled.
   */
  isFeatureEnabled(feature: string): Promise<boolean>;
}

/**
 * Higher-order function that wraps tool handlers with analytics tracking
 * 
 * Why?:
 * - Automatic timing of every tool call
 * - Consistent error tracking without try/catch boilerplate  
 * - Tools stay focused on business logic
 * - Gracefully handles null analytics (when disabled)
 */
export async function withAnalytics<T>(
  analytics: AnalyticsProvider | undefined,
  toolName: string,
  handler: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  
  try {
    // Execute the actual tool logic
    const result = await handler();
    const duration_ms = Date.now() - start;
    
    // Track successful completion
    await analytics?.trackTool(toolName, { duration_ms, success: true });
    return result;
    
  } catch (error) {
    const duration_ms = Date.now() - start;
    
    // Track the error with timing
    await analytics?.trackError(error as Error, {
      tool_name: toolName,
      duration_ms
    });
    
    // Re-throw so the MCP server can handle it normally
    throw error;
  }
}
```

### Implement PostHog provider

Create `src/posthog.ts`:

```typescript
import { PostHog } from "posthog-node";
import { AnalyticsProvider } from "./analytics.js";

export class PostHogAnalyticsProvider implements AnalyticsProvider {
  private client: PostHog | null;
  private sessionId: string;
  private anonymizeData: boolean;

  constructor(
    apiKey: string,
    options?: { host?: string; anonymizeData?: boolean }
  ) {
    this.client = new PostHog(apiKey, { host: options?.host });
    this.sessionId = `session_${Date.now()}`;
    this.anonymizeData = options?.anonymizeData ?? true;

    console.error(
      `[Analytics] Initialized (anonymization: ${
        this.anonymizeData ? "on" : "off"
      })`
    );
  }

  async trackTool(
    toolName: string,
    result: {
      duration_ms: number;
      success: boolean;
      [key: string]: any;
    }
  ): Promise<void> {
    this.client?.capture({
      distinctId: this.sessionId,
      event: "tool_executed",
      properties: { tool_name: toolName, ...result },
    });

    console.error(
      `[Analytics] ${toolName}: ${result.success ? "✓" : "✗"} (${
        result.duration_ms
      }ms)`
    );
  }

  async trackError(
    error: Error,
    context: {
      tool_name: string;
      duration_ms: number;
      args?: Record<string, unknown>;
      [key: string]: any;
    }
  ): Promise<void> {
    this.client?.capture({
      distinctId: this.sessionId,
      event: "tool_error",
      properties: {
        $exception_type: error.name,
        $exception_message: error.message,
        $exception_stack: error.stack,
        tool_name: context.tool_name,
        duration_ms: context.duration_ms,
        args: this.anonymizeData ? this.anonymize(context.args) : context.args,
      },
    });

    console.error(
      `[Analytics] ERROR in ${context.tool_name}: ${error.message}`
    );
  }

  async isFeatureEnabled(flagName: string): Promise<boolean> {
    const enabled = await this.client?.isFeatureEnabled(
      flagName,
      this.sessionId
    );
    return enabled ?? false;
  }

  private anonymize(data?: Record<string, unknown>): Record<string, string> {
    if (!data) return {};
    return Object.fromEntries(
      Object.keys(data).map((key) => [key, `[REDACTED]`])
    );
  }

  async close(): Promise<void> {
    try {
      await this.client?.shutdown();
      console.error("[Analytics] Closed");
    } catch (error) {
      console.error("[Analytics] Error during close:", error);
    }
  }
}
```

### Wire analytics into your server

Update `src/server.ts`:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as tools from "./tools.js";
import { z } from "zod";
import { AnalyticsProvider, withAnalytics } from "./analytics.js";

export interface StdioServerHandle {
  server: McpServer;
  transport: StdioServerTransport;
}

async function buildStdioServer(analytics?: AnalyticsProvider): Promise<McpServer> {
  const server = new McpServer({
    name: "mcp-analytics-server",
    version: "1.0.0",
    capabilities: {
      resources: {},
      tools: {},
    },
  });

  // Wrap each tool with analytics
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

  server.tool(
    "analyze_data",
    { data: z.string() },
    { title: "Analyze data (slow)" },
    async (args) => withAnalytics(analytics, "analyze_data", () => tools.analyzeData(args.data))
  );

  server.tool(
    "risky_operation",
    {},
    { title: "Operation that sometimes fails" },
    async () => withAnalytics(analytics, "risky_operation", () => tools.riskyOperation())
  );

  return server;
}

export async function startStdioServer(
    analytics?: AnalyticsProvider
): Promise<StdioServerHandle> {
  const server = await buildStdioServer(analytics);
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
```

**Notice:** `tools.ts` remains unchanged—pure business logic with no analytics dependencies.

### Initialize analytics on startup

Update `src/index.ts`:

```typescript
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
    if(apiKey) {
      analytics = new PostHogAnalyticsProvider(apiKey, { 
        host, 
        anonymizeData: true 
      });
    }
    
    const handle = await startStdioServer(analytics);

    process.on("SIGINT", async () => await stopStdioServer(handle, analytics));
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
```

### Test analytics integration

```bash
npm run build
```

Restart Claude Desktop.

**Test all tool types:**

* "Show me the inventory" ← Fast tool
    
* "Check stock for product 1" ← Fast tool
    
* "Check stock for product 999" ← Error case
    
* "Analyze this data: test" ← Slow tool (1 second)
    
* "Run risky operation" (try multiple times) ← Flaky tool
    

**Check your logs:**

```bash
tail -f ~/Library/Logs/Claude/mcp-server-*.log
```

You should see:

```typescript
[Analytics] Initialized (anonymization: on)
[SERVER] MCP Server running on stdio
[Tool] getInventory called
[Analytics] getInventory: ✓ (2ms)
[Tool] checkStock called for product: 999
[Analytics] ERROR in checkStock: Product 999 not found
[Tool] analyzeData called with data: test
[Analytics] analyze_data: ✓ (1001ms)
```

**Verify in PostHog:**

1. Open PostHog → **Activity → Live Events**
    
2. You should see:
    
    * `tool_executed` events with `tool_name`, `duration_ms`, `success: true`
        
    * `tool_error` events with `$exception_type`, `$exception_message`, `$exception_stack`
        

---

## Step 3: Add Feature Flags

```bash
git checkout step-4-feature-flags
```

Feature flags let you control tool availability remotely without redeploying code. Perfect for:

* Gradually rolling out new tools to specific users
    
* Disabling flaky tools during incidents
    
* A/B testing different implementations
    

### Update server to support feature flags

Modify `src/server.ts` to conditionally register tools:

```typescript
async function buildStdioServer(analytics?: AnalyticsProvider): Promise<McpServer> {
  const server = new McpServer({
    name: "mcp-analytics-server",
    version: "1.0.0",
    capabilities: {
      resources: {},
      tools: {},
    },
  });

  // Register stable tools
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

  server.tool(
    "analyze_data",
    { data: z.string() },
    { title: "Analyze data (slow)" },
    async (args) => withAnalytics(analytics, "analyze_data", () => tools.analyzeData(args.data))
  );

  // Gate experimental tool with feature flag
  const isFeatureEnabled = await analytics?.isFeatureEnabled("experimental_tools") || false;
  
  if (isFeatureEnabled) {
    server.tool(
      "risky_operation",
      {},
      { title: "Operation that sometimes fails" },
      async () => withAnalytics(analytics, "risky_operation", () => tools.riskyOperation())
    );
    console.error("[SERVER] ✓ risky_operation tool enabled via feature flag");
  } else {
    console.error("[SERVER] ⊘ risky_operation tool disabled via feature flag");
  }

  return server;
}
```

**Key change:** `buildStdioServer` is now `async` to support feature flag checks before registering tools.

### Create feature flag in PostHog

1. Open PostHog → **Feature Flags**
    
2. Click **New feature flag**
    
3. Configure:
    
    * **Key:** `experimental_tools`
        
    * **Name:** Experimental Tools
        
    * **Description:** Controls whether experimental/flaky tools are available
        
4. Set **rollout percentage:**
    
    * **100%** to enable for all users
        
    * **0%** to disable
        
5. Click **Save**
    

### Test the feature flag

**With flag enabled (100%):**

Build and restart Claude:

bash

```bash
npm run build
```

Check logs:

```typescript
[Analytics] Initialized (anonymization: on)
[SERVER] ✓ risky_operation tool enabled via feature flag
[SERVER] MCP Server running on stdio
```

Try: "Run risky operation" — Claude should see and call the tool.

**With flag disabled (0%):**

Change rollout to 0% in PostHog, then restart Claude.

Check logs:

```typescript
[Analytics] Initialized (anonymization: on)
[SERVER] ⊘ risky_operation tool disabled via feature flag
[SERVER] MCP Server running on stdio
```

Try: "Run risky operation" — Claude won't see the tool.

**This demonstrates:**

* ✅ Remote control over tool availability
    
* ✅ No code changes or redeployment needed
    
* ✅ Instant rollback if a tool causes problems
    
* ✅ Gradual rollout strategy for new features
    

---

## Step 4: Build PostHog Dashboards

Now that events are flowing, let's create dashboards to monitor your MCP server's health.

### Understanding Your Metrics

PostHog automatically aggregates your events into queryable metrics:

**Usage metrics:**

* Tool execution count and frequency
    
* Most/least popular tools
    
* Usage trends over time
    
* Calls by session (which server runs are busiest)
    

**Performance metrics:**

* Average duration per tool
    
* P50/P95/P99 latency percentiles
    
* Slowest executions
    
* Performance trends and regressions
    

**Reliability metrics:**

* Success rate per tool (successes / total attempts)
    
* Error count and error rate trends
    
* Error taxonomy (which exception types are most common)
    
* Recent errors for debugging
    

Let's build three focused dashboards to visualize these metrics.

### Dashboard 1: Tool Usage Overview

**Purpose:** Understand which tools are being used and how often.

**Create the dashboard:**

1. PostHog → **Dashboards → New Dashboard**
    
2. Name: "MCP Server - Tool Usage"
    
3. Add these insights:
    

**Insight 1: Total Tool Calls (This Week)**

* Type: **Number**
    
* Event: `tool_executed`
    
* Filter: Last 7 days
    
* Shows: Total execution count
    

**Insight 2: Tool Calls by Name**

* Type: **Bar chart**
    
* Event: `tool_executed`
    
* Group by: `tool_name`
    
* Sort: Descending by count
    
* Shows: Most popular tools
    

**Insight 3: Tool Usage Over Time**

* Type: **Line chart**
    
* Event: `tool_executed`
    
* Group by: `tool_name`
    
* X-axis: Time (hourly or daily)
    
* Shows: Usage trends and patterns
    

**Insight 4: Calls by Session**

* Type: **Table**
    
* Event: `tool_executed`
    
* Group by: `distinctId`
    
* Shows: Which server sessions are busiest
    

**Why this matters:** Helps you prioritize optimization efforts on the most-used tools and understand usage patterns over time.

### Dashboard 2: Performance Monitoring

**Purpose:** Track tool execution speed and identify performance bottlenecks.

**Create the dashboard:**

1. PostHog → **Dashboards → New Dashboard**
    
2. Name: "MCP Server - Performance"
    
3. Add these insights:
    

**Insight 1: Average Latency by Tool**

* Type: **Bar chart**
    
* Event: `tool_executed`
    
* Metric: Average of `duration_ms`
    
* Group by: `tool_name`
    
* Shows: Which tools are slowest on average
    

**Insight 2: P95 Latency by Tool**

* Type: **Bar chart**
    
* Event: `tool_executed`
    
* Metric: 95th percentile of `duration_ms`
    
* Group by: `tool_name`
    
* Shows: Worst-case performance (excludes outliers)
    

**Insight 3: Latency Over Time**

* Type: **Line chart**
    
* Event: `tool_executed`
    
* Metric: Median of `duration_ms`
    
* Group by: `tool_name`
    
* X-axis: Time (hourly)
    
* Shows: Performance trends and regressions
    

**Insight 4: Slowest Executions (Last 24h)**

* Type: **Table**
    
* Event: `tool_executed`
    
* Filter: Last 24 hours
    
* Sort by: `duration_ms` descending
    
* Limit: 20
    
* Columns: `tool_name`, `duration_ms`, `timestamp`
    
* Shows: Individual slow executions for investigation
    

**Expected results:**

* `analyze_data` should show ~1000ms consistently (our slow tool)
    
* Other tools should be &lt;10ms
    
* P95 helps identify if a fast tool occasionally slows down
    

### Dashboard 3: Reliability & Errors

**Purpose:** Monitor tool success rates and track errors.

**Create the dashboard:**

1. PostHog → **Dashboards → New Dashboard**
    
2. Name: "MCP Server - Reliability"
    
3. Add these insights:
    

**Insight 1: Success Rate by Tool**

* Type: **Table**
    
* Formula: `tool_executed count / (tool_executed count + tool_error count)`
    
* Group by: `tool_name`
    
* Shows: Success percentage per tool
    

**Insight 2: Error Count Over Time**

* Type: **Line chart**
    
* Event: `tool_error`
    
* Group by: `tool_name`
    
* X-axis: Time (hourly)
    
* Shows: Error trends and spikes
    

**Insight 3: Errors by Exception Type**

* Type: **Pie chart**
    
* Event: `tool_error`
    
* Group by: `$exception_type`
    
* Shows: Error taxonomy (which error classes are most common)
    

**Insight 4: Recent Errors (Last 24h)**

* Type: **Table**
    
* Event: `tool_error`
    
* Filter: Last 24 hours
    
* Columns: `tool_name`, `$exception_message`, `duration_ms`, `timestamp`
    
* Sort by: `timestamp` descending
    
* Limit: 50
    
* Shows: Latest errors for debugging
    

**Expected results:**

* `risky_operation` should show ~50% success rate (our flaky tool)
    
* `checkStock` should show errors when called with invalid product IDs
    
* Error messages help debug issues quickly
    

### Set Up Alerts

For production systems, configure alerts to notify you of issues:

**High Error Rate Alert:**

1. Go to your "Error Count Over Time" insight
    
2. Click **Alerts → New Alert**
    
3. Set: "When `tool_error` count exceeds **10** in **1 hour**"
    
4. Notify: Slack/Email/Webhook
    

**Performance Degradation Alert:**

1. Go to your "P95 Latency" insight
    
2. Click **Alerts → New Alert**
    
3. Set: "When P95 `duration_ms` exceeds **5000** for any tool"
    
4. Notify: Slack/Email/Webhook
    

**Low Success Rate Alert:**

1. Create a new insight: Success rate per tool
    
2. Click **Alerts → New Alert**
    
3. Set: "When success rate drops below **90%** for any tool"
    
4. Notify: Slack/Email/Webhook
    

---

## What You've Built

You now have a production-ready MCP server with:

**Analytics:**

* Automatic tracking of tool calls, timing, and errors
    
* PostHog dashboards showing usage, performance, and reliability
    
* Session-based tracking for analyzing individual runs
    
* Privacy-first design with built-in anonymization
    

**Feature Flags:**

* Remote control over tool availability
    
* Gradual rollout capability for new features
    
* Instant rollback for problematic tools
    
* No code changes or redeployment needed
    

**Monitoring:**

* **Usage dashboard** — Tool popularity and trends
    
* **Performance dashboard** — Latency tracking and bottleneck identification
    
* **Reliability dashboard** — Error rates and success metrics
    
* **Alerts** — Proactive notification of issues
    

**Architecture:**

* **Clean separation** — Tools, server, analytics, and implementation layers
    
* **Vendor-agnostic interface** — Easy to swap analytics providers
    
* **Graceful degradation** — Works with or without analytics
    
* **Type-safe** — Zod validation and TypeScript throughout
    

---

## Next Steps

### Extend Your Server

**Add custom metrics:**

```typescript
// Track items returned
await analytics?.trackTool("getInventory", { 
  duration_ms, 
  success: true,
  items_returned: products.length 
});

// Track cache hits
await analytics?.trackTool("checkStock", { 
  duration_ms, 
  success: true,
  cache_hit: true 
});

// Track external API usage
await analytics?.trackTool("fetchOrders", { 
  duration_ms, 
  success: true,
  external_api_used: 'stripe' 
});
```

**Add more tools:**

1. Create function in `tools.ts`
    
2. Register in `server.ts` with `withAnalytics` wrapper
    
3. Optionally gate with feature flags
    

### Production Considerations

**Environment-specific configuration:**

```typescript
const analytics = apiKey && process.env.NODE_ENV === 'production'
  ? new PostHogAnalyticsProvider(apiKey, { anonymizeData: true })
  : undefined;
```

**Multiple server instances:**

For multi-instance deployments, use hostname-based session IDs:

```typescript
import { hostname } from 'os';

this.sessionId = `${hostname()}-${process.pid}`;
```

**Structured logging:**

```typescript
console.error(JSON.stringify({
  level: 'info',
  tool: toolName,
  duration_ms,
  timestamp: new Date().toISOString()
}));
```

### Learn More

* [**PostHog Documentation**](https://posthog.com/docs) — Feature flags, experiments, session replay
    
* [**MCP Specification**](https://spec.modelcontextprotocol.io/) — Protocol details and best practices
    
* [**MCP TypeScript SDK**](https://github.com/modelcontextprotocol/typescript-sdk) — Advanced server patterns
    
* [**Tutorial Repository**](https://github.com/arda-e/mcp-posthog-analytics) — Full code with Git tags for each step
    

---

## Troubleshooting

### Events aren't showing in PostHog

**Check your API key format:**

* Should start with `phc_`, not `phx_`
    
* Verify it's in `.env` file or Claude Desktop config
    

**Verify host URL matches your region:**

* US: `https://us.i.posthog.com`
    
* EU: `https://eu.i.posthog.com`
    
* Check your PostHog project settings for the correct URL
    

**Check logs for PostHog errors:**

```bash
tail -f ~/Library/Logs/Claude/mcp-server-*.log
```

Look for analytics initialization errors or capture failures.

**Ensure API key is loaded:**

If using `.env`:

```bash
cat .env | grep POSTHOG_API_KEY
```

If using Claude config, ensure it's in the `env` section.

---

### Server not showing in Claude Desktop

**Verify absolute paths:**

Both `command` and `args` must use absolute paths:

```bash
which node
# Use this full path

pwd
# Use this full path + /build/index.js
```

**Check JSON syntax:**

Common mistake: trailing commas in JSON

```json
{
  "mcpServers": {
    "mcp-analytics-server": {
      "command": "/path/to/node",
      "args": ["/path/to/project/build/index.js"]
      // Don't add comma here (last item)
    }
  }
}
```

**Restart Claude completely:**

Cmd+Q (or Alt+F4), wait 2 seconds, reopen. Don't just close the window.

**Check Claude logs for startup errors:**

```bash
cat ~/Library/Logs/Claude/mcp-server-*.log | grep ERROR
```

---

### "node: command not found" or "Cannot find module"

**Claude doesn't load shell config files:**

Claude doesn't load `.bashrc`, `.zshrc`, or `.profile`, so it doesn't see nvm's node path.

**Find your node location:**

```bash
which node
# Example: /Users/you/.nvm/versions/node/v20.10.0/bin/node
```

**Use absolute path in config:**

```json
{
  "mcpServers": {
    "mcp-analytics-server": {
      "command": "/Users/you/.nvm/versions/node/v20.10.0/bin/node",
      "args": ["/Users/you/projects/mcp-posthog-analytics/build/index.js"]
    }
  }
}
```

**For nvm users specifically:**

Don't use `node` — use the full path to the nvm-managed node binary.

---

### "Protocol error" or "Server crashed"

**You used** `console.log()` somewhere:

The #1 cause of protocol errors is accidentally using `console.log()`.

**Find the offending line:**

```bash
grep -r "console.log" src/
```

**Replace with** `console.error()`:

```typescript
// Bad - breaks protocol
console.log("Debug info");

// Good - goes to stderr
console.error("Debug info");
```

**Rebuild and restart:**

```bash
npm run build
```

Restart Claude Desktop (Cmd+Q or killall Claude and reopen).

**Check logs for exact error:**

```bash
tail -f ~/Library/Logs/Claude/mcp-server-*.log
```

The error message will show which line caused the issue.

---

### Feature flag not working

**Verify flag key matches exactly:**

PostHog flag keys are case-sensitive. If you created `experimental_tools`, your code must use exactly `experimental_tools`.

**Check PostHog rollout percentage:**

1. Open PostHog → Feature Flags
    
2. Find your flag
    
3. Verify rollout is set to desired percentage (100% for enabled, 0% for disabled)
    

**Restart Claude to fetch new flags:**

Feature flag values are fetched at server startup. After changing a flag in PostHog:

Check logs for feature flag results:

```typescript
[SERVER] ✓ risky_operation tool enabled via feature flag
```

or

```typescript
[SERVER] ⊘ risky_operation tool disabled via feature flag
```

**Check logs for feature flag API errors:**

If PostHog API is unreachable, flags default to `false`:

```bash
tail -f ~/Library/Logs/Claude/mcp-server-*.log | grep "Feature Flag"
```

---

### Slow startup or no tools appearing

**Check for network issues reaching PostHog:**

Feature flag checks make API calls during startup. If PostHog is unreachable, this can delay or hang startup.

**Feature flag API calls can delay startup:**

Each `isFeatureEnabled()` call is async. If you have many flags, consider caching:

```typescript
// Cache all flags at startup
const flags = {
  experimental: await analytics?.isFeatureEnabled("experimental_tools"),
  beta: await analytics?.isFeatureEnabled("beta_features")
};

// Use cached values when registering tools
if (flags.experimental) {
  // Register tool
}
```

**Check logs for timeout errors:**

```bash
tail -f ~/Library/Logs/Claude/mcp-server-*.log | grep -i timeout
```

**Consider setting timeouts:**

Wrap flag checks with timeout logic:

```typescript
const checkWithTimeout = async (flag: string, timeout = 2000): Promise<boolean> => {
  const timeoutPromise = new Promise<boolean>((resolve) => 
    setTimeout(() => resolve(false), timeout)
  );
  const flagPromise = analytics?.isFeatureEnabled(flag) ?? Promise.resolve(false);
  return Promise.race([flagPromise, timeoutPromise]);
};
```

---

### Still stuck?

**Check full logs:**

```bash
cat ~/Library/Logs/Claude/mcp-server-*.log
```

**Search for your error:**

The error message is often self-explanatory once you see the full stack trace.

**Open a GitHub issue:**

If none of the above helps:

1. Go to [github.com/arda-e/mcp-posthog-analytics/issues](https://github.com/arda-e/mcp-posthog-analytics/issues)
    
2. Click "New Issue"
    
3. Include:
    
    * Your logs (sanitize any API keys)
        
    * Your config (sanitize paths)
        
    * Steps to reproduce
        
    * What you expected vs what happened
        

**Check PostHog Community:**

The [PostHog Community Forum](https://posthog.com/questions) has answers to common integration questions.
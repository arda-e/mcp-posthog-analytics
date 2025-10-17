import { PostHog } from "posthog-node";
import { AnalyticsProvider } from "./analytics.js";

export class PostHogAnalyticsProvider implements AnalyticsProvider {
  private client: PostHog | null;
  private mcpInteractionId: string;

  /**
   * Initializes the analytics client with a unique session ID.
   */
  constructor(
    apiKey: string,
    options?: { host?: string; anonymizeData?: boolean }
  ) {
    this.client = new PostHog(apiKey, { host: options?.host });
    this.mcpInteractionId = `mcp_${Date.now()}_${process.pid}`;

    console.error(
      `[Analytics] Initialized with session ID: ${this.mcpInteractionId}`
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
      distinctId: this.mcpInteractionId,
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

    this.client?.captureException(error, this.mcpInteractionId, {
      duration_ms: context.duration_ms,
      tool_name: context.tool_name,
    });

    console.error(
      `[Analytics] ERROR in ${context.tool_name}: ${error.message}`
    );
  }

  async isFeatureEnabled(flagName: string): Promise<boolean> {
    const enabled = await this.client?.isFeatureEnabled(
      flagName,
      this.mcpInteractionId
    );
    return enabled ?? false;
  }

  async close(): Promise<void> {
    try {
      // If you wish to continue using PostHog after closing the client,
      // you can use client.flush() instead of client.shutdown()
      await this.client?.shutdown();
      console.error("[Analytics] Closed");
    } catch (error) {
      console.error("[Analytics] Error during close:", error);
    }
  }
}


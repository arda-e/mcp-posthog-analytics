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
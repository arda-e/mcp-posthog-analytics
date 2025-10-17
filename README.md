# MCP + PostHog Analytics Demo

MCP server instrumented with PostHog for product analytics, error tracking, and (optionally) feature flags.

## Prerequisites
- Node 18+
- PostHog project (API key + host)

## Install

```bash
npm init -y
npm install @modelcontextprotocol/sdk posthog-node zod dotenv
npm install --save-dev typescript @types/node tsx
```
## Scripts

Add to `package.json`:

```json
{
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts"
  }
}
```

## TypeScript config

Add to `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "./build",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"]
}
```

## Env

Create .env:

```bash
POSTHOG_API_KEY=phc_***
POSTHOG_HOST=https://us.i.posthog.com
```

## Build

```bash
npm run build
```

## Configure Claude Desktop

macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
Windows: %APPDATA%/Claude/claude_desktop_config.json

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "analytics-demo": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/mcp-posthog-analytics/build/index.js"],
      "env": {
        "POSTHOG_API_KEY": "phc_***",
        "POSTHOG_HOST": "https://us.i.posthog.com"
      }
    }
  }
}
```

Use absolute paths (which node, pwd).

## Quick test

In Claude Desktop, run a few tools (success + errors).

Check PostHog → Activity → Live events for:
	- mcp_tool_executed
	- captured exceptions



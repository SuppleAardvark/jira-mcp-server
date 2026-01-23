---
topic: development-workflow
tags:
- development
- setup
- testing
- workflow
- npm
files:
- package.json
- tsconfig.json
- .env.example
- CLAUDE.md
created: '2026-01-23T09:33:15.932987Z'
updated: '2026-01-23T09:33:15.932987Z'
---

## Overview

Development workflow and setup guide for the JIRA MCP Server project.

## Prerequisites

- Node.js >= 20 (specified in package.json engines)
- npm (comes with Node.js)
- A JIRA Cloud account with API access

## Initial Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Create environment configuration: `cp .env.example .env`
4. Edit `.env` with your JIRA credentials

## npm Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `npm install` | - | Install all dependencies |
| `npm run build` | `tsc` | Compile TypeScript to `dist/` |
| `npm run dev` | `tsc --watch` | Watch mode for development |
| `npm start` | `node dist/index.js` | Run the compiled MCP server |
| `npm test` | `vitest run` | Run all tests once |
| `npm run test:watch` | `vitest` | Run tests in watch mode |

### When to Use Each Script

- **`npm run dev`** - During active development; keeps TypeScript compiler running
- **`npm run build`** - Before running, after pulling changes, or for CI/CD
- **`npm test`** - Before committing, in CI pipelines
- **`npm run test:watch`** - During TDD or when fixing bugs

## TypeScript Configuration

- **Target**: ES2022 - Modern JavaScript features
- **Module System**: NodeNext - Native ESM support
- **Strict Mode**: Enabled - Full type safety
- **Source**: `src/` directory
- **Output**: `dist/` directory

Key implications:
- Use `.js` extensions in imports (e.g., `import { x } from './module.js'`)
- The package is ESM-only (`"type": "module"` in package.json)

## Testing

### Framework

Vitest (v4.0.17) - Fast, modern test runner with native TypeScript support.

### Test Organization

Tests are co-located with source files using `__tests__` directories:
- `src/__tests__/permissions.test.ts` - Scope and allowlist parsing
- `src/tools/__tests__/issues.test.ts` - ADF conversion and parent extraction

### Running Tests

```bash
npm test                                          # Run all tests
npm run test:watch                                # Watch mode
npx vitest run src/__tests__/permissions.test.ts # Specific file
npx vitest -t "parses single scope correctly"    # By name
```

## Running Locally

### Standard Run

```bash
npm run build
JIRA_BASE_URL=https://your-domain.atlassian.net \
JIRA_EMAIL=you@example.com \
JIRA_API_TOKEN=your-token \
npm start
```

### With MCP Client

Configure your MCP client to spawn it:

```json
{
  "mcpServers": {
    "jira": {
      "command": "node",
      "args": ["/path/to/dist/index.js"],
      "env": {
        "JIRA_BASE_URL": "https://your-domain.atlassian.net",
        "JIRA_EMAIL": "you@example.com",
        "JIRA_API_TOKEN": "your-token"
      }
    }
  }
}
```

## Common Development Tasks

### Adding a New Tool

1. Define the tool in appropriate module under `src/tools/`
2. Add scope mapping in `src/permissions.ts`
3. Register tool in `src/index.ts`
4. Add tests in `src/tools/__tests__/`
5. Build and test: `npm run build && npm test`

### Pre-commit Checklist

1. `npm run build` - Ensure clean compilation
2. `npm test` - All tests pass
3. Manual testing with MCP client if API changes

## Project Structure

```
jira-mcp-server/
├── src/
│   ├── index.ts           # MCP server setup, tool registration
│   ├── jira-client.ts     # Singleton HTTP client for JIRA API
│   ├── permissions.ts     # Scope and allowlist management
│   ├── types.ts           # TypeScript interfaces
│   ├── __tests__/         # Test files for core modules
│   └── tools/
│       ├── sprint.ts      # Board and sprint operations
│       ├── issues.ts      # Issue CRUD, search, comments
│       ├── attachments.ts # Attachment operations
│       └── __tests__/     # Test files for tool modules
├── dist/                  # Compiled output (gitignored)
├── package.json           # Dependencies and scripts
├── tsconfig.json          # TypeScript configuration
└── CLAUDE.md              # AI assistant guidance
```

## Related Files

- package.json
- tsconfig.json
- .env.example
- CLAUDE.md
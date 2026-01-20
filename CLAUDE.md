# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Run Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to dist/
npm run dev          # Watch mode for development
npm start            # Run the compiled server
npm test             # Run tests
npm run test:watch   # Run tests in watch mode
```

## Environment Variables

Required for the server to start:
- `JIRA_BASE_URL` - JIRA instance URL (e.g., `https://your-domain.atlassian.net`)
- `JIRA_EMAIL` - Atlassian account email
- `JIRA_API_TOKEN` - API token from Atlassian account settings

## Architecture

This is an MCP (Model Context Protocol) server that exposes JIRA operations as tools for AI assistants like Claude.

### Core Components

- **`src/index.ts`** - MCP server setup using stdio transport. Registers all tools and routes tool calls to appropriate handlers.
- **`src/jira-client.ts`** - Singleton HTTP client for JIRA REST API. Handles authentication (Basic auth with API token), JSON/binary requests, and error responses.
- **`src/types.ts`** - TypeScript interfaces for JIRA API responses and tool return types.

### Tool Modules (`src/tools/`)

Each module exports functions that transform JIRA API responses into simplified formats:

- **`sprint.ts`** - Board listing, active sprint retrieval, sprint issue queries
- **`issues.ts`** - Issue CRUD, JQL search, comments, transitions. Includes `adfToText()` for converting Atlassian Document Format to plain text.
- **`attachments.ts`** - List and download issue attachments

### Key Patterns

- The `JiraClient` uses a singleton pattern via `getJiraClient()` - instantiated on first use, reads env vars in constructor
- Tool functions return simplified result objects (not raw JIRA responses) to provide clean data to AI assistants
- JIRA API v3 is used for issues (`/rest/api/3/`) and Agile API v1 for boards/sprints (`/rest/agile/1.0/`)
- Comments and descriptions use Atlassian Document Format (ADF) - a structured JSON format that gets converted to plain text for output

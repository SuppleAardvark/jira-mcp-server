---
topic: project-architecture
tags:
- architecture
- mcp
- jira
- overview
files:
- src/index.ts
- src/jira-client.ts
- src/permissions.ts
- src/types.ts
- package.json
created: '2026-01-23T09:34:00.453715Z'
updated: '2026-01-23T09:34:00.453715Z'
---

## Overview

This is an MCP (Model Context Protocol) server that exposes JIRA operations as tools for AI assistants like Claude. It enables AI agents to interact with JIRA for issue tracking, sprint management, and project workflows.

## Purpose

- Expose JIRA functionality through standardized MCP protocol
- Provide simplified, AI-friendly data formats
- Enable secure, scoped access to JIRA resources
- Support agile workflows (sprints, boards, backlogs)

## Directory Structure

```
jira-mcp-server/
├── src/
│   ├── index.ts           # MCP server entry point
│   ├── jira-client.ts     # JIRA REST API client
│   ├── permissions.ts     # Scope and allowlist management
│   ├── types.ts           # TypeScript interfaces
│   └── tools/
│       ├── sprint.ts      # Board and sprint operations
│       ├── issues.ts      # Issue CRUD, search, stats
│       └── attachments.ts # File operations
├── dist/                  # Compiled JavaScript output
├── package.json
├── tsconfig.json
└── CLAUDE.md
```

## Core Components

### MCP Server (`src/index.ts`)

- Uses `@modelcontextprotocol/sdk` with stdio transport
- Registers 22 tools organized by functionality
- Handles tool call routing via switch statement
- Filters available tools based on permission scopes

### JIRA Client (`src/jira-client.ts`)

- Singleton HTTP client for all JIRA API calls
- Basic authentication with API token
- Handles JSON and binary requests
- Consistent error formatting

### Permissions (`src/permissions.ts`)

- Parses scope strings to filter available tools
- Board, project, and issue type allowlists
- Intentionally vague error messages for security

### Type Definitions (`src/types.ts`)

- TypeScript interfaces for JIRA API responses
- Simplified output types for tool results
- Field enums for configurable responses

## Tool Categories

| Category | Module | Tools |
|----------|--------|-------|
| Sprints | `sprint.ts` | Board listing, sprint queries, sprint issues |
| Issues | `issues.ts` | CRUD, search, comments, transitions, stats |
| Attachments | `attachments.ts` | List, download, upload files |
| Discovery | `issues.ts` | Field schemas, field values, debug |

## Data Flow

```
AI Assistant
    ↓
MCP Protocol (stdio)
    ↓
index.ts (tool routing)
    ↓
tools/*.ts (business logic)
    ↓
jira-client.ts (HTTP)
    ↓
JIRA REST API
```

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP protocol implementation |
| `typescript` | Type-safe development |
| `vitest` | Testing framework |

## Design Principles

1. **Simplified Output**: Transform verbose JIRA responses to clean structures
2. **Permission-Based Access**: Scope tools and resources via environment variables
3. **Lazy Initialization**: Client created on first use
4. **Error Transparency**: Include full error details for debugging

## Related Files

- src/index.ts
- src/jira-client.ts
- src/permissions.ts
- src/types.ts
- package.json
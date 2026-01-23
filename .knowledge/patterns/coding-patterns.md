---
topic: coding-patterns
tags:
- patterns
- typescript
- best-practices
- singleton
- error-handling
- pagination
files:
- src/jira-client.ts
- src/index.ts
- src/tools/issues.ts
- src/tools/sprint.ts
- src/types.ts
created: '2026-01-23T09:33:15.898257Z'
updated: '2026-01-23T09:33:15.898257Z'
---

## Overview

This document captures the key coding patterns used in the JIRA MCP server codebase.

## Singleton Pattern for JiraClient

The `JiraClient` class uses a singleton pattern to ensure only one HTTP client instance exists throughout the application lifecycle.

### Implementation

```typescript
// src/jira-client.ts

// Private module-level variable
let clientInstance: JiraClient | null = null;

// Factory function that returns singleton
export function getJiraClient(): JiraClient {
  if (!clientInstance) {
    clientInstance = new JiraClient();
  }
  return clientInstance;
}
```

### Benefits

- Lazy initialization: client is only created when first needed
- Configuration read once from environment variables
- Shared authentication state across all tool calls
- Memory efficient for long-running MCP server process

## Error Handling Patterns

### HTTP Request Error Handling

The client wraps all API calls with consistent error formatting:

```typescript
// src/jira-client.ts

private async request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(url, { /* ... */ });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `JIRA API error: ${response.status} ${response.statusText}\n${errorBody}`
    );
  }

  // Handle 204 No Content and empty responses
  if (response.status === 204) {
    return undefined as T;
  }

  return JSON.parse(text) as T;
}
```

### Tool-Level Error Handling

The MCP server catches all errors and returns them as structured error responses:

```typescript
// src/index.ts

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    switch (name) {
      case 'jira_get_issue': {
        // Tool logic...
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});
```

### Permission Verification Pattern

Security-sensitive operations verify permissions before proceeding:

```typescript
// src/tools/issues.ts

async function verifyIssueAllowed(
  issueKey: string,
  issueTypeAllowlist: Set<string> | null,
  projectAllowlist: Set<string> | null
): Promise<string> {
  const projectKey = getProjectFromIssueKey(issueKey);
  if (!isProjectAllowed(projectKey, projectAllowlist)) {
    throw new Error(`Issue not found: ${issueKey}`);  // Intentionally vague
  }
}
```

## Data Transformation Patterns

### Raw API to Simplified Output

Tool functions transform verbose JIRA API responses into clean, simplified structures.

```typescript
// src/tools/sprint.ts

export async function listBoards(boardAllowlist: Allowlist): Promise<ListBoardsResult> {
  const client = getJiraClient();
  const response = await client.listBoards(0, 100);

  return {
    boards: response.values.map((board) => ({
      id: board.id,
      name: board.name,
      type: board.type,
      projectKey: board.location?.projectKey,
    })),
    total: response.values.length,
  };
}
```

### Configurable Field Selection

```typescript
// src/tools/issues.ts

export type IssueField = 'key' | 'summary' | 'description' | 'type' | 'status';

const DEFAULT_ISSUE_FIELDS: IssueField[] = ['key', 'summary', 'description'];

export async function getIssue(
  issueKey: string,
  requestedFields?: IssueField[]
): Promise<IssueDetails> {
  const fieldsToReturn = requestedFields ?? DEFAULT_ISSUE_FIELDS;
  const result: IssueDetails = { key: issue.key };

  for (const field of fieldsToReturn) {
    switch (field) {
      case 'summary':
        result.summary = issue.fields.summary;
        break;
      case 'description':
        result.description = adfToText(issue.fields.description);
        break;
    }
  }
  return result;
}
```

## ADF (Atlassian Document Format) Conversion

JIRA v3 API uses Atlassian Document Format for rich text.

### ADF to Text Converter

```typescript
// src/tools/issues.ts

export function adfToText(doc: JiraDocument | string | undefined): string {
  if (!doc) return '';
  if (typeof doc === 'string') return doc;

  function extractText(nodes: JiraDocumentNode[]): string {
    return nodes
      .map((node) => {
        if (node.text) return node.text;
        if (node.content) return extractText(node.content);
        if (node.type === 'hardBreak') return '\n';
        return '';
      })
      .join('');
  }

  return extractText(doc.content);
}
```

### Creating ADF for API Requests

```typescript
// src/jira-client.ts

async addComment(issueKey: string, body: string): Promise<JiraComment> {
  return this.request<JiraComment>(
    `/rest/api/3/issue/${issueKey}/comment`,
    {
      method: 'POST',
      body: JSON.stringify({
        body: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: body }],
            },
          ],
        },
      }),
    }
  );
}
```

## Tool Registration Pattern

Tools are registered declaratively using a schema-based approach in `src/index.ts`:

```typescript
const allTools = [
  {
    name: 'jira_get_issue',
    description: 'Get detailed information about a specific JIRA issue...',
    inputSchema: {
      type: 'object',
      properties: {
        issueKey: {
          type: 'string',
          description: 'The issue key (e.g., PROJ-123)',
        },
      },
      required: ['issueKey'],
    },
  },
];
```

## Pagination Handling

### Token-Based Pagination (Modern)

```typescript
// src/jira-client.ts

async searchIssues(
  jql: string,
  maxResults = 50,
  nextPageToken?: string
): Promise<JiraSearchResponse> {
  const body: Record<string, unknown> = { jql, maxResults };
  if (nextPageToken) {
    body.nextPageToken = nextPageToken;
  }
  return this.request<JiraSearchResponse>('/rest/api/3/search/jql', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
```

### Multi-Page Aggregation with Deduplication

```typescript
// src/tools/sprint.ts

const seenSprintIds = new Set<number>();

for (const boardId of boardIds) {
  let pageStart = 0;
  let hasMore = true;

  while (hasMore) {
    const response = await client.getSprintsForBoard(boardId, state, pageStart, pageSize);

    for (const sprint of response.values) {
      if (!seenSprintIds.has(sprint.id)) {
        seenSprintIds.add(sprint.id);
        allSprints.push(/* ... */);
      }
    }

    hasMore = !response.isLast && response.values.length === pageSize;
    pageStart += pageSize;
  }
}
```

## Type Safety Patterns

### Separate API Types from Tool Output Types

```typescript
// src/types.ts

// Raw JIRA API response type
export interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: JiraIssueFields;
}

// Simplified output type for tools
export interface IssueDetails {
  key: string;
  summary?: string;
  description?: string;
  type?: string;
  status?: string;
}
```

## Related Files

- src/jira-client.ts
- src/index.ts
- src/tools/issues.ts
- src/tools/sprint.ts
- src/types.ts
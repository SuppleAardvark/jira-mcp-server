---
topic: jira-api-integration
tags:
- jira
- api
- rest
- authentication
- endpoints
files:
- src/jira-client.ts
- src/types.ts
- src/tools/issues.ts
- src/tools/sprint.ts
- src/tools/attachments.ts
created: '2026-01-23T09:33:15.917965Z'
updated: '2026-01-23T09:33:15.917965Z'
---

## Overview

This document describes how the MCP server integrates with the JIRA REST API.

## Authentication

### Method: Basic Authentication with API Token

```typescript
const credentials = `${email}:${apiToken}`;
const authHeader = `Basic ${Buffer.from(credentials).toString("base64")}`;
```

Credentials are read from environment variables at startup and stored in the singleton `JiraClient` instance.

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `JIRA_BASE_URL` | JIRA instance base URL | `https://your-domain.atlassian.net` |
| `JIRA_EMAIL` | Atlassian account email | `user@company.com` |
| `JIRA_API_TOKEN` | API token from Atlassian account settings | `ATATT3x...` |

### Optional Environment Variables (Access Control)

| Variable | Description |
|----------|-------------|
| `JIRA_SCOPES` | Comma-separated list of allowed tool scopes |
| `JIRA_ALLOWED_BOARDS` | Comma-separated board IDs or names to allow |
| `JIRA_ALLOWED_ISSUE_TYPES` | Comma-separated issue types to allow |
| `JIRA_ALLOWED_PROJECTS` | Comma-separated project keys to allow |

## API Versions

### JIRA REST API v3 (`/rest/api/3/`)

Used for core issue operations:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/rest/api/3/issue/{issueKey}` | GET | Fetch single issue details |
| `/rest/api/3/issue/{issueKey}` | PUT | Update issue fields |
| `/rest/api/3/issue` | POST | Create new issue |
| `/rest/api/3/issue/{issueKey}/comment` | GET/POST | List/add comments |
| `/rest/api/3/issue/{issueKey}/transitions` | GET/POST | Get/execute transitions |
| `/rest/api/3/issue/{issueKey}/changelog` | GET | Get issue change history |
| `/rest/api/3/issue/{issueKey}/attachments` | POST | Upload attachment |
| `/rest/api/3/search/jql` | POST | Search issues with JQL |
| `/rest/api/3/field` | GET | List all JIRA fields |
| `/rest/api/3/label` | GET | List all labels |
| `/rest/api/3/priority` | GET | List all priorities |
| `/rest/api/3/status` | GET | List all statuses |
| `/rest/api/3/issuetype` | GET | List all issue types |

### JIRA Agile API v1 (`/rest/agile/1.0/`)

Used for boards and sprints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/rest/agile/1.0/board` | GET | List all boards |
| `/rest/agile/1.0/board/{boardId}/sprint` | GET | List sprints for board |
| `/rest/agile/1.0/sprint/{sprintId}` | GET | Get sprint details |

## Request Handling

### JSON Requests

```typescript
await fetch(url, {
  headers: {
    Authorization: authHeader,
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});
```

### File Upload (Attachments)

```typescript
await fetch(url, {
  method: "POST",
  headers: {
    Authorization: authHeader,
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
    "X-Atlassian-Token": "no-check",  // XSRF protection bypass
  },
  body: formDataBuffer,
});
```

## Pagination

### Token-Based Pagination (Search)

The `/rest/api/3/search/jql` endpoint uses token-based pagination:

```typescript
const body = {
  jql,
  maxResults,
  nextPageToken,  // From previous response
};
```

Responses include:
- `nextPageToken`: Token for next page
- `isLast`: Boolean indicating final page

### Offset-Based Pagination (Legacy)

Other endpoints use traditional offset pagination with `startAt` and `maxResults` parameters.

## Atlassian Document Format (ADF)

JIRA API v3 uses ADF for rich text fields (descriptions, comments).

### Reading ADF

The `adfToText()` function recursively extracts plain text from ADF nodes.

### Writing ADF

Plain text is wrapped in ADF structure:

```typescript
{
  type: "doc",
  version: 1,
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: plainText }],
    },
  ],
}
```

## Rate Limiting

The server does **not** implement explicit rate limiting. Considerations:
- Atlassian Cloud has rate limits (typically 100 requests/minute)
- Bulk operations paginate through up to 4000 issues (40 pages x 100)

## Data Transformation

Tool functions transform raw JIRA responses into simplified formats:

| Raw JIRA Field | Transformed Output |
|----------------|-------------------|
| `fields.assignee.displayName` | `assignee: string` |
| `fields.status.name` | `status: string` |
| `fields.description` (ADF) | `description: string` (plain text) |

## Related Files

- src/jira-client.ts
- src/types.ts
- src/tools/issues.ts
- src/tools/sprint.ts
- src/tools/attachments.ts
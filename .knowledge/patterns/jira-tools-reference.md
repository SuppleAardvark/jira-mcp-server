---
topic: jira-tools-reference
tags:
- tools
- api
- jira
- reference
- mcp
files:
- src/tools/sprint.ts
- src/tools/issues.ts
- src/tools/attachments.ts
- src/index.ts
created: '2026-01-23T09:34:00.471522Z'
updated: '2026-01-23T14:04:36.121010Z'
---

## Overview

Complete reference for all JIRA tools exposed by the MCP server.

## Sprint Tools (`src/tools/sprint.ts`)

### jira_list_boards

List all accessible JIRA boards.

- **Parameters**: None
- **Returns**: `{ boards: [{ id, name, type, projectKey }], total }`
- **API**: `GET /rest/agile/1.0/board`
- **Use case**: Discover board IDs before querying sprints

### jira_get_active_sprint

Get the currently active sprint for a board.

- **Parameters**: `boardId` (number, required)
- **Returns**: `{ sprint: { id, name, state, startDate, endDate, goal } | null }`
- **API**: `GET /rest/agile/1.0/board/{boardId}/sprint?state=active`
- **Use case**: Find current sprint for adding issues

### jira_list_sprints

List sprints with filtering and pagination.

- **Parameters**: `boardId` OR `projectKey` (one required), `state`, `startAt`, `maxResults`
- **Returns**: `{ sprints: [...], total, startAt, maxResults, hasMore }`
- **API**: `GET /rest/agile/1.0/board/{boardId}/sprint`
- **Use case**: Get historical sprints for reporting

### jira_get_sprint_issues

Get all issues in a sprint.

- **Parameters**: `sprintId` (required), `maxResults`, `fields`
- **Returns**: `{ sprintId, issues: [...], total }`
- **API**: `GET /rest/api/3/search` with JQL `sprint = {sprintId}`
- **Use case**: Sprint status reports

### jira_get_my_sprint_issues

Get current user's issues in a sprint.

- **Parameters**: `sprintId` (required), `maxResults`, `fields`
- **Returns**: Same as jira_get_sprint_issues
- **API**: JQL `sprint = {sprintId} AND assignee = currentUser()`
- **Use case**: Personal sprint dashboard

## Issue Tools (`src/tools/issues.ts`)

### jira_get_issue

Get detailed issue information.

- **Parameters**: `issueKey` (required), `fields`
- **Returns**: Full issue details including custom fields
- **API**: `GET /rest/api/3/issue/{issueKey}`
- **Use case**: View complete issue details

### jira_search_issues

Search issues using JQL.

- **Parameters**: `jql` (required), `maxResults`, `nextPageToken`, `fields`
- **Returns**: `{ issues: [...], total, hasMore, nextPageToken }`
- **API**: `POST /rest/api/3/search/jql`
- **Use case**: Find issues by any criteria

### jira_create_issue

Create new issue.

- **Parameters**: `projectKey`, `summary`, `issueType` (required), `description`, `priority`, `labels`, `assignee`, `parent`, `components`
- **Returns**: `{ key, id, self }`
- **API**: `POST /rest/api/3/issue`

### jira_update_issue

Update issue fields.

- **Parameters**: `issueKey` (required), `summary`, `description`, `assignee`, `priority`, `labels`, `customFields`
- **Returns**: `{ success, issueKey }`
- **API**: `PUT /rest/api/3/issue/{issueKey}`

### jira_get_transitions

Get available status transitions.

- **Parameters**: `issueKey` (required)
- **Returns**: `{ issueKey, transitions: [{ id, name, toStatus, toStatusCategory }] }`
- **API**: `GET /rest/api/3/issue/{issueKey}/transitions`

### jira_transition_issue

Move issue to new status.

- **Parameters**: `issueKey`, `transitionId` (required), `comment`
- **Returns**: `{ success, issueKey, transitionId }`
- **API**: `POST /rest/api/3/issue/{issueKey}/transitions`

### jira_get_issue_comments

Get comments on an issue.

- **Parameters**: `issueKey` (required), `maxResults`
- **Returns**: `{ issueKey, comments: [{ id, author, body, created }], total }`
- **API**: `GET /rest/api/3/issue/{issueKey}/comment`

### jira_add_comment

Add comment to issue.

- **Parameters**: `issueKey`, `body` (required)
- **Returns**: `{ success, issueKey, commentId }`
- **API**: `POST /rest/api/3/issue/{issueKey}/comment`

### jira_get_issue_history

Get issue changelog.

- **Parameters**: `issueKey` (required), `maxResults`
- **Returns**: `{ issueKey, history: [{ id, author, created, changes }], total }`
- **API**: `GET /rest/api/3/issue/{issueKey}/changelog`

### jira_get_backlog_stats

Get aggregated statistics with pivot tables.

- **Parameters**: `jql` (required), `boardId`, `excludeResolved`, `issueTypes`, `assignees`, `sprint`, `groupBy`, `pivot`, `fieldFilters`
- **Returns**: Counts by status/type/priority/assignee plus custom pivot data
- **API**: Paginated `POST /rest/api/3/search/jql`
- **Use case**: Backlog health reports, velocity tracking

### jira_get_sprint_report

Generate retrospective reports.

- **Parameters**: `sprintId`, `projectKey`, `storyPointsField` (all required), `previousSprintId`, `labelsOfInterest`, `statusGroups`, `includeTriage`, `includeInflow`
- **Returns**: Status groups, bug metrics, label tracking with sprint comparison
- **Use case**: Sprint retrospectives

## Attachment Tools (`src/tools/attachments.ts`)

### jira_list_attachments

List issue attachments.

- **Parameters**: `issueKey` (required)
- **Returns**: `{ issueKey, attachments: [{ id, filename, size, mimeType, created, author }] }`

### jira_download_attachment

Download attachment to local file.

- **Parameters**: `attachmentId`, `outputPath` (required)
- **Returns**: `{ success, path, size }`

### jira_upload_attachment

Upload file as attachment.

- **Parameters**: `issueKey`, `filePath` (required)
- **Returns**: `{ issueKey, attachments: [...] }`

## Discovery Tools (`src/tools/issues.ts`)

### jira_get_field_schema

Get JIRA fields metadata.

- **Parameters**: `projectKey`, `customOnly`, `searchTerm`
- **Returns**: `{ fields: [{ id, name, custom, schema }], total }`
- **Use case**: Find custom field IDs (e.g., Story Points)

### jira_list_field_values

List discrete field values.

- **Parameters**: `field` (required: labels|priorities|statuses|issueTypes|resolutions|components), `projectKey`, `searchTerm`, `maxResults`
- **Returns**: `{ field, values: [{ id, name, description }], total }`
- **Use case**: Discover valid values before creating issues

### jira_debug_search

Explore raw JIRA data.

- **Parameters**: `jql` (required), `maxResults`, `fields`
- **Returns**: `{ issues: [{ key, fields }], fieldNames }`
- **Use case**: Debug field IDs and data structures

## Related Files

- src/tools/sprint.ts
- src/tools/issues.ts
- src/tools/attachments.ts
- src/index.ts

#### issues.ts`)
## Issue Tools (`src/tools/issues.ts`)

### jira_get_issue

Get detailed issue information.

- **Parameters**: `issueKey` (required), `fields`
- **Returns**: Full issue details including custom fields
- **API**: `GET /rest/api/3/issue/{issueKey}`
- **Use case**: View complete issue details

### jira_search_issues

Search issues using JQL.

- **Parameters**: `jql` (required), `maxResults`, `nextPageToken`, `fields`
- **Returns**: `{ issues: [...], total, hasMore, nextPageToken }`
- **API**: `POST /rest/api/3/search/jql`
- **Use case**: Find issues by any criteria

### jira_create_issue

Create new issue.

- **Parameters**: `projectKey`, `summary`, `issueType` (required), `description`, `priority`, `labels`, `assignee`, `parent`, `components`, `customFields`
- **Returns**: `{ key, id, self }`
- **API**: `POST /rest/api/3/issue`
- **Note**: Use `jira_get_create_fields` first to discover required custom fields

### jira_update_issue

Update issue fields.

- **Parameters**: `issueKey` (required), `summary`, `description`, `assignee`, `priority`, `labels`, `customFields`
- **Returns**: `{ success, issueKey }`
- **API**: `PUT /rest/api/3/issue/{issueKey}`

### jira_get_transitions

Get available status transitions.

- **Parameters**: `issueKey` (required)
- **Returns**: `{ issueKey, transitions: [{ id, name, toStatus, toStatusCategory }] }`
- **API**: `GET /rest/api/3/issue/{issueKey}/transitions`

### jira_transition_issue

Move issue to new status.

- **Parameters**: `issueKey`, `transitionId` (required), `comment`
- **Returns**: `{ success, issueKey, transitionId }`
- **API**: `POST /rest/api/3/issue/{issueKey}/transitions`

### jira_get_issue_comments

Get comments on an issue.

- **Parameters**: `issueKey` (required), `maxResults`
- **Returns**: `{ issueKey, comments: [{ id, author, body, created }], total }`
- **API**: `GET /rest/api/3/issue/{issueKey}/comment`

### jira_add_comment

Add comment to issue.

- **Parameters**: `issueKey`, `body` (required)
- **Returns**: `{ success, issueKey, commentId }`
- **API**: `POST /rest/api/3/issue/{issueKey}/comment`

### jira_get_issue_history

Get issue changelog.

- **Parameters**: `issueKey` (required), `maxResults`
- **Returns**: `{ issueKey, history: [{ id, author, created, changes }], total }`
- **API**: `GET /rest/api/3/issue/{issueKey}/changelog`

### jira_get_backlog_stats

Get aggregated statistics with pivot tables.

- **Parameters**: `jql` (required), `boardId`, `excludeResolved`, `issueTypes`, `assignees`, `sprint`, `groupBy`, `pivot`, `fieldFilters`
- **Returns**: Counts by status/type/priority/assignee plus custom pivot data
- **API**: Paginated `POST /rest/api/3/search/jql`
- **Use case**: Backlog health reports, velocity tracking

### jira_get_sprint_report

Generate retrospective reports.

- **Parameters**: `sprintId`, `projectKey`, `storyPointsField` (all required), `previousSprintId`, `labelsOfInterest`, `statusGroups`, `includeTriage`, `includeInflow`
- **Returns**: Status groups, bug metrics, label tracking with sprint comparison
- **Use case**: Sprint retrospectives

#### issues.ts`)
## Discovery Tools (`src/tools/issues.ts`)

### jira_get_field_schema

Get JIRA fields metadata.

- **Parameters**: `projectKey`, `customOnly`, `searchTerm`
- **Returns**: `{ fields: [{ id, name, custom, schema }], total }`
- **Use case**: Find custom field IDs (e.g., Story Points)

### jira_get_create_fields

**IMPORTANT**: Call this BEFORE creating an issue to discover required fields.

- **Parameters**: `projectKey`, `issueType` (required), `includeOptional`
- **Returns**: `{ projectKey, issueType, issueTypeId, requiredFields, optionalFields, total }`
- **API**: `GET /rest/api/3/issue/createmeta/{projectKey}/issuetypes/{typeId}`
- **Use case**: Discover required custom fields and their formats before issue creation
- **Note**: Returns format hints for each field type (e.g., "Object with accountId" for user fields)

### jira_list_field_values

List discrete field values.

- **Parameters**: `field` (required: labels|priorities|statuses|issueTypes|resolutions|components), `projectKey`, `searchTerm`, `maxResults`
- **Returns**: `{ field, values: [{ id, name, description }], total }`
- **Use case**: Discover valid values before creating issues

### jira_debug_search

Explore raw JIRA data.

- **Parameters**: `jql` (required), `maxResults`, `fields`
- **Returns**: `{ issues: [{ key, fields }], fieldNames }`
- **Use case**: Debug field IDs and data structures
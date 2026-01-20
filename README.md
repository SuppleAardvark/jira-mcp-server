# JIRA MCP Server

An MCP (Model Context Protocol) server that provides Claude with tools to interact with JIRA for sprint management, issue tracking, and attachment handling.

## Installation

### Option 1: Install from npm

```bash
npm install -g @suppleaardvark/jira-mcp-server
```

### Option 2: Build from source

```bash
git clone https://github.com/suppleaardvark/jira-mcp-server.git
cd jira-mcp-server
npm install
npm run build
```

## Setup

### 1. Get JIRA API Credentials

1. Log into your Atlassian account at https://id.atlassian.com
2. Go to **Security** → **API tokens** → **Create API token**
3. Give it a name (e.g., "Claude MCP") and copy the token

### 2. Configure Environment Variables

**Required:**

```bash
export JIRA_BASE_URL="https://your-domain.atlassian.net"
export JIRA_EMAIL="your-email@example.com"
export JIRA_API_TOKEN="your-api-token"
```

**Optional:**

```bash
# Restrict which tools are available (comma-separated scopes)
export JIRA_SCOPES="boards:read,sprints:read,issues:read"

# Restrict access to specific boards (pipe-separated, by ID or name)
export JIRA_ALLOWED_BOARDS="123|My Project Board"

# Restrict access to specific projects (pipe-separated)
export JIRA_ALLOWED_PROJECTS="PROJ|DEV"

# Restrict access to specific issue types (pipe-separated)
export JIRA_ALLOWED_ISSUE_TYPES="Bug|Task|Story"
```

See [Permission Scopes](#permission-scopes) and [Resource Allowlists](#resource-allowlists) for details.

### 3. Configure MCP Client

Add to your MCP client configuration (e.g., Claude Desktop `claude_desktop_config.json`):

**If installed from npm:**

```json
{
  "mcpServers": {
    "jira": {
      "command": "npx",
      "args": [
         "-y",
         "@suppleaardvark/jira-mcp-server"
      ],
      "env": {
        "JIRA_BASE_URL": "https://your-domain.atlassian.net",
        "JIRA_EMAIL": "your-email@example.com",
        "JIRA_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

**If built from source:**

```json
{
  "mcpServers": {
    "jira": {
      "command": "node",
      "args": ["/path/to/jira-mcp-server/dist/index.js"],
      "env": {
        "JIRA_BASE_URL": "https://your-domain.atlassian.net",
        "JIRA_EMAIL": "your-email@example.com",
        "JIRA_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

**With restricted scopes (read-only example):**

```json
{
  "mcpServers": {
    "jira": {
      "command": "jira-mcp-server",
      "env": {
        "JIRA_BASE_URL": "https://your-domain.atlassian.net",
        "JIRA_EMAIL": "your-email@example.com",
        "JIRA_API_TOKEN": "your-api-token",
        "JIRA_SCOPES": "boards:read,sprints:read,issues:read,comments:read,attachments:read"
      }
    }
  }
}
```

## Available Tools

### Sprint Tools

#### `jira_list_boards`
List all accessible JIRA boards.

**Parameters:** None

**Returns:** Board IDs, names, types (scrum/kanban), and project keys.

#### `jira_get_active_sprint`
Get the currently active sprint for a board.

**Parameters:**
- `boardId` (number, required) - The board ID

**Returns:** Sprint ID, name, state, dates, and goal.

#### `jira_get_sprint_issues`
Get all issues in a sprint.

**Parameters:**
- `sprintId` (number, required) - The sprint ID
- `maxResults` (number, optional) - Maximum issues to return (default: 50)
- `fields` (string[], optional) - Fields to include. Default: `["key", "summary", "status", "statusCategory", "assignee", "priority"]`. Use `"customFields"` to include custom fields.

**Returns:** Issues with requested fields.

#### `jira_get_my_sprint_issues`
Get issues assigned to the current user in a sprint.

**Parameters:**
- `sprintId` (number, required) - The sprint ID
- `maxResults` (number, optional) - Maximum issues to return (default: 200)
- `fields` (string[], optional) - Fields to include. Default: `["key", "summary", "status", "statusCategory", "assignee", "priority"]`. Use `"customFields"` to include custom fields.

**Returns:** Issues assigned to you, sorted by status then priority.

### Issue Tools

#### `jira_get_issue`
Get detailed information about an issue.

**Parameters:**
- `issueKey` (string, required) - The issue key (e.g., "PROJ-123")
- `fields` (string[], optional) - Fields to include. Default: all fields. Options: `key`, `summary`, `description`, `type`, `status`, `statusCategory`, `priority`, `assignee`, `reporter`, `created`, `updated`, `labels`, `components`, `attachmentCount`, `commentCount`, `parent`, `customFields`.

**Returns:** Issue details with requested fields. Custom fields are returned with human-readable names.

#### `jira_search_issues`
Search for issues using JQL.

**Parameters:**
- `jql` (string, required) - JQL query string
- `maxResults` (number, optional) - Maximum results (default: 50)
- `fields` (string[], optional) - Fields to include. Default: `["key", "summary", "status", "statusCategory", "assignee", "type", "parent"]`. Use `"customFields"` to include custom fields.

**Returns:** Issues with requested fields. Also includes `hasMore` flag indicating if additional results exist beyond `maxResults`.

**Important:** Queries must be bounded with a project filter or other restriction (e.g., assignee, sprint). Unbounded queries like `status = "Open"` are rejected by JIRA's API.

**Example JQL queries:**
- `project = PROJ AND status = "In Progress"`
- `assignee = currentUser() AND sprint in openSprints()`
- `project = PROJ AND labels = bug AND created >= -7d`

#### `jira_get_backlog_stats`
Get aggregated statistics for issues matching a JQL query without fetching all issue details.

**Parameters:**
- `jql` (string, required) - JQL query string (e.g., "project = PROJ")
- `boardId` (number, optional) - Filter by board ID (adds project filter based on board's project)
- `excludeResolved` (boolean, optional) - Exclude resolved issues (adds "resolution IS EMPTY")
- `issueTypes` (string[], optional) - Filter by issue types (e.g., ["Bug", "Story"])
- `assignees` (string[], optional) - Filter by assignees (use "unassigned" for unassigned issues)
- `sprint` (number, optional) - Filter by sprint ID
- `groupBy` (string[], optional) - Fields to group by. Options: `status`, `type`, `priority`, `assignee`, `reporter`, `labels`, `components`, `resolution`, `project`. If specified, replaces default aggregations.
- `pivot` (object, optional) - Custom pivot table configuration:
  - `rowField` (string, required) - Field for pivot rows
  - `columnField` (string, required) - Field for pivot columns
  - `action` (string, optional) - Aggregation: `count` (default), `sum`, `avg`, `cardinality`
  - `valueField` (string, optional) - Field ID for sum/avg (e.g., `customfield_10024` for story points)
- `fieldFilters` (object[], optional) - Additional field-based filters applied via JQL

**Returns:** Counts grouped by status, type, priority, assignee, and a `byTypeAndStatus` pivot table. When `pivot` is specified, includes custom pivot results with row/column totals. Analyzes up to 4000 issues.

**Example - Story points by assignee:**
```json
{
  "jql": "project = ED",
  "sprint": 616,
  "pivot": {
    "rowField": "assignee",
    "columnField": "status",
    "action": "sum",
    "valueField": "customfield_10024"
  }
}
```

#### `jira_get_issue_comments`
Get comments on an issue.

**Parameters:**
- `issueKey` (string, required) - The issue key
- `maxResults` (number, optional) - Maximum comments (default: 20)

**Returns:** Comments with author, body, and creation date.

#### `jira_create_issue`
Create a new JIRA issue.

**Parameters:**
- `projectKey` (string, required) - Project key (e.g., "PROJ")
- `summary` (string, required) - Issue title
- `issueType` (string, required) - Type (e.g., "Task", "Bug", "Story", "Epic", "Sub-task")
- `description` (string, optional) - Issue description
- `priority` (string, optional) - Priority name (e.g., "High", "Medium", "Low")
- `labels` (string[], optional) - Labels to add
- `assignee` (string, optional) - Atlassian account ID
- `parent` (string, optional) - Parent issue key (for subtasks or epic linking)
- `components` (string[], optional) - Component names

**Returns:** Created issue key, ID, and URL.

#### `jira_update_issue`
Update fields on an existing issue.

**Parameters:**
- `issueKey` (string, required) - The issue key
- `summary` (string, optional) - New summary
- `description` (string, optional) - New description
- `assignee` (string, optional) - Atlassian account ID (null to unassign)
- `priority` (string, optional) - Priority name
- `labels` (string[], optional) - Labels to set
- `customFields` (object, optional) - Custom fields to update. Keys are field IDs (e.g., "customfield_10001") and values depend on field type.

#### `jira_get_transitions`
Get available status transitions for an issue.

**Parameters:**
- `issueKey` (string, required) - The issue key

**Returns:** Available transitions with IDs, names, and target statuses.

#### `jira_transition_issue`
Move an issue to a new status.

**Parameters:**
- `issueKey` (string, required) - The issue key
- `transitionId` (string, required) - Transition ID (from `jira_get_transitions`)
- `comment` (string, optional) - Comment to add with the transition

#### `jira_add_comment`
Add a comment to an issue.

**Parameters:**
- `issueKey` (string, required) - The issue key
- `body` (string, required) - Comment text

#### `jira_get_issue_history`
Get the changelog/history of an issue showing all field changes.

**Parameters:**
- `issueKey` (string, required) - The issue key
- `maxResults` (number, optional) - Maximum history entries (default: 100)

**Returns:** History entries with author, timestamp, and field changes (from/to values).

#### `jira_get_field_schema`
Get available JIRA fields with their IDs, names, and types. Useful for discovering custom field IDs (e.g., finding the ID for "Story Points" to use in stats aggregations).

**Parameters:**
- `projectKey` (string, optional) - If provided, only return fields configured for this project. This shows which fields are actually in use, not just all fields in JIRA.
- `customOnly` (boolean, optional) - If true, only return custom fields
- `searchTerm` (string, optional) - Filter fields by name or ID (case-insensitive)

**Returns:** Field metadata including ID, name, whether it's custom, and schema type.

**Example - Find story points field for a project:**
```json
{
  "projectKey": "ED",
  "searchTerm": "story"
}
```

#### `jira_debug_search`
Debug tool for exploring raw JIRA data. Returns raw field data and field name mappings.

**Parameters:**
- `jql` (string, required) - JQL query string
- `maxResults` (number, optional) - Maximum issues to return (default: 1)
- `fields` (string[], optional) - Specific JIRA field IDs to return

**Returns:** Raw issue data with field values and a mapping of field IDs to names.

### Attachment Tools

#### `jira_list_attachments`
List all attachments on an issue.

**Parameters:**
- `issueKey` (string, required) - The issue key

**Returns:** Attachment IDs, filenames, sizes, MIME types, and authors.

#### `jira_download_attachment`
Download an attachment to a local file.

**Parameters:**
- `attachmentId` (string, required) - Attachment ID (from `jira_list_attachments`)
- `outputPath` (string, required) - Local file path to save the attachment

#### `jira_upload_attachment`
Upload a file as an attachment to an issue.

**Parameters:**
- `issueKey` (string, required) - The issue key (e.g., "PROJ-123")
- `filePath` (string, required) - Local file path to upload

**Returns:** Uploaded attachment details including ID, filename, size, and MIME type.

## Permission Scopes

Use the `JIRA_SCOPES` environment variable to restrict which tools are available. This is useful for limiting access in shared environments or enforcing least-privilege access.

Tools outside the configured scopes are completely hidden from the agent—they won't appear in the tool list and the agent won't know they exist.

**Default behavior:** If `JIRA_SCOPES` is not set or empty, all tools are enabled.

### Available Scopes

| Scope | Tools |
|-------|-------|
| `boards:read` | `jira_list_boards` |
| `sprints:read` | `jira_get_active_sprint`, `jira_get_sprint_issues`, `jira_get_my_sprint_issues` |
| `issues:read` | `jira_get_issue`, `jira_search_issues`, `jira_get_transitions`, `jira_get_issue_history`, `jira_get_backlog_stats`, `jira_get_field_schema`, `jira_debug_search` |
| `issues:write` | `jira_create_issue`, `jira_update_issue`, `jira_transition_issue` |
| `comments:read` | `jira_get_issue_comments` |
| `comments:write` | `jira_add_comment` |
| `attachments:read` | `jira_list_attachments`, `jira_download_attachment` |
| `attachments:write` | `jira_upload_attachment` |

### Examples

**Read-only access:**
```bash
JIRA_SCOPES="boards:read,sprints:read,issues:read,comments:read,attachments:read"
```

**Issues only (read and write):**
```bash
JIRA_SCOPES="issues:read,issues:write"
```

**Full access (explicit):**
```bash
JIRA_SCOPES="boards:read,sprints:read,issues:read,issues:write,comments:read,comments:write,attachments:read,attachments:write"
```

Invalid scope names are logged as warnings and ignored.

## Resource Allowlists

In addition to tool-level scopes, you can restrict access to specific boards, projects, and issue types using allowlists. Resources outside the allowlist are hidden from the agent.

### Board Allowlist

Use `JIRA_ALLOWED_BOARDS` to restrict which boards (and their sprints) the agent can access.

```bash
# By board ID
JIRA_ALLOWED_BOARDS="123|456"

# By board name (case-insensitive)
JIRA_ALLOWED_BOARDS="Project Alpha|Project Beta"

# Mix of IDs and names
JIRA_ALLOWED_BOARDS="123|Project Beta"
```

**Behavior:**
- `jira_list_boards` returns only allowed boards
- `jira_get_active_sprint` fails for non-allowed boards
- `jira_get_sprint_issues` and `jira_get_my_sprint_issues` fail for sprints on non-allowed boards
- If not set, all boards are accessible

### Issue Type Allowlist

Use `JIRA_ALLOWED_ISSUE_TYPES` to restrict which issue types the agent can access.

```bash
# Allow only bugs and tasks
JIRA_ALLOWED_ISSUE_TYPES="Bug|Task"

# Allow common work items (case-insensitive)
JIRA_ALLOWED_ISSUE_TYPES="bug|task|story|sub-task"
```

**Behavior:**
- `jira_get_issue` fails for issues of non-allowed types
- `jira_search_issues` filters out issues of non-allowed types
- `jira_create_issue` fails when trying to create non-allowed types
- All issue operations (update, transition, comment, attachments) fail for non-allowed types
- If not set, all issue types are accessible

### Project Allowlist

Use `JIRA_ALLOWED_PROJECTS` to restrict which projects the agent can access. This filters issues by project key.

```bash
# Allow only specific projects
JIRA_ALLOWED_PROJECTS="PROJ|DEV"

# Single project (case-insensitive)
JIRA_ALLOWED_PROJECTS="proj"
```

**Behavior:**
- `jira_get_issue` fails for issues from non-allowed projects
- `jira_search_issues` filters out issues from non-allowed projects
- `jira_create_issue` fails when trying to create issues in non-allowed projects
- All issue operations (update, transition, comment, attachments) fail for non-allowed projects
- If not set, all projects are accessible

### Combined Example

Restrict agent to only view bugs and tasks in a specific project:

```json
{
  "mcpServers": {
    "jira": {
      "command": "jira-mcp-server",
      "env": {
        "JIRA_BASE_URL": "https://your-domain.atlassian.net",
        "JIRA_EMAIL": "your-email@example.com",
        "JIRA_API_TOKEN": "your-api-token",
        "JIRA_SCOPES": "boards:read,sprints:read,issues:read",
        "JIRA_ALLOWED_BOARDS": "Project Alpha",
        "JIRA_ALLOWED_PROJECTS": "PROJ",
        "JIRA_ALLOWED_ISSUE_TYPES": "Bug|Task"
      }
    }
  }
}
```

## Example Usage

```
User: What's in my current sprint?

Claude: [Uses jira_list_boards to find boards]
Claude: [Uses jira_get_active_sprint with boardId]
Claude: [Uses jira_get_sprint_issues with sprintId]

Here are the issues in your current sprint:
- PROJ-101: Implement login page (In Progress, assigned to Alice)
- PROJ-102: Fix checkout bug (To Do, unassigned)
...
```

```
User: Create a bug for the login timeout issue

Claude: [Uses jira_create_issue]

Created PROJ-103: Login timeout after 5 minutes of inactivity
```

## API Permissions

The API token needs read access to:
- Boards and sprints (Agile API)
- Issues and comments
- Attachments

For write operations, ensure the token's associated account has permission to:
- Create/edit issues in the target projects
- Add comments
- Transition issues

## Troubleshooting

**"Missing JIRA configuration" error**
- Ensure all three environment variables are set: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`

**"401 Unauthorized" errors**
- Verify your API token is correct and hasn't expired
- Confirm your email matches the Atlassian account

**"404 Not Found" for boards/sprints**
- Board/sprint APIs require the project to use Scrum or Kanban boards
- Classic projects without boards won't have sprint data

**"403 Forbidden" on create/update**
- Check that your account has the necessary project permissions

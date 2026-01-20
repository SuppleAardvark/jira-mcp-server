# JIRA MCP Server

An MCP (Model Context Protocol) server that provides Claude with tools to interact with JIRA for sprint management, issue tracking, and attachment handling.

## Setup

### 1. Get JIRA API Credentials

1. Log into your Atlassian account at https://id.atlassian.com
2. Go to **Security** → **API tokens** → **Create API token**
3. Give it a name (e.g., "Claude MCP") and copy the token

### 2. Configure Environment Variables

Set the following environment variables:

```bash
export JIRA_BASE_URL="https://your-domain.atlassian.net"
export JIRA_EMAIL="your-email@example.com"
export JIRA_API_TOKEN="your-api-token"
```

### 3. Build the Server

```bash
cd mcp-servers/jira-mcp
npm install
npm run build
```

### 4. Configure MCP Client

Add to your MCP client configuration (e.g., Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "jira": {
      "command": "node",
      "args": ["/path/to/mcp-servers/jira-mcp/dist/index.js"],
      "env": {
        "JIRA_BASE_URL": "https://your-domain.atlassian.net",
        "JIRA_EMAIL": "your-email@example.com",
        "JIRA_API_TOKEN": "your-api-token"
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

**Returns:** Issues with keys, summaries, statuses, and assignees.

### Issue Tools

#### `jira_get_issue`
Get detailed information about an issue.

**Parameters:**
- `issueKey` (string, required) - The issue key (e.g., "PROJ-123")

**Returns:** Full issue details including summary, description, status, assignee, labels, components, and parent info.

#### `jira_search_issues`
Search for issues using JQL.

**Parameters:**
- `jql` (string, required) - JQL query string
- `maxResults` (number, optional) - Maximum results (default: 50)

**Important:** Queries must be bounded with a project filter or other restriction (e.g., assignee, sprint). Unbounded queries like `status = "Open"` are rejected by JIRA's API.

**Example JQL queries:**
- `project = PROJ AND status = "In Progress"`
- `assignee = currentUser() AND sprint in openSprints()`
- `project = PROJ AND labels = bug AND created >= -7d`

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

#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { listBoards, getActiveSprint, listSprints, getSprintIssues, getMySprintIssues, type SprintIssueField } from './tools/sprint.js';
import {
  getIssue,
  searchIssues,
  getIssueComments,
  updateIssue,
  getTransitions,
  transitionIssue,
  addComment,
  createIssue,
  getIssueHistory,
  getBacklogStats,
  debugSearch,
  getFieldSchema,
  getCreateFields,
  getSprintReport,
  listFieldValues,
  type IssueField,
  type SearchIssueField,
  type ListableField,
} from './tools/issues.js';
import { listAttachments, downloadAttachment, uploadAttachment } from './tools/attachments.js';
import { parseScopes, isToolAllowed, parseAllowlist, parseIssueTypesAllowlist, parseProjectAllowlist } from './permissions.js';

// Parse permission scopes from environment variable
const allowedTools = parseScopes(process.env.JIRA_SCOPES);

// Parse board, issue type, and project allowlists
const boardAllowlist = parseAllowlist(process.env.JIRA_ALLOWED_BOARDS);
const issueTypeAllowlist = parseIssueTypesAllowlist(process.env.JIRA_ALLOWED_ISSUE_TYPES);
const projectAllowlist = parseProjectAllowlist(process.env.JIRA_ALLOWED_PROJECTS);

// Sprint report defaults from environment variables
// Format: pipe-separated status names (e.g., "To Do|Open|Reopened")
function parseStatusList(envValue: string | undefined): string[] | undefined {
  if (!envValue || envValue.trim() === '') return undefined;
  return envValue.split('|').map(s => s.trim()).filter(s => s !== '');
}

function parseStatusGroups(envValue: string | undefined): Record<string, string[]> | undefined {
  // Format: "GroupName:Status1,Status2|GroupName2:Status3,Status4"
  if (!envValue || envValue.trim() === '') return undefined;
  const groups: Record<string, string[]> = {};
  const parts = envValue.split('|');
  for (const part of parts) {
    const [groupName, statuses] = part.split(':');
    if (groupName && statuses) {
      groups[groupName.trim()] = statuses.split(',').map(s => s.trim()).filter(s => s !== '');
    }
  }
  return Object.keys(groups).length > 0 ? groups : undefined;
}

const sprintReportDefaults = {
  statusGroups: parseStatusGroups(process.env.JIRA_STATUS_GROUPS),
  bugBacklogStatuses: parseStatusList(process.env.JIRA_BUG_BACKLOG_STATUSES),
  blockedStatuses: parseStatusList(process.env.JIRA_BLOCKED_STATUSES),
  doneStatuses: parseStatusList(process.env.JIRA_DONE_STATUSES),
  storyPointsField: process.env.JIRA_STORY_POINTS_FIELD,
};

const server = new Server(
  {
    name: 'jira-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// All available tools
const allTools = [
  // Sprint tools
  {
    name: 'jira_list_boards',
      description: 'List all accessible JIRA boards. Returns board IDs, names, types (scrum/kanban), and project keys.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'jira_get_active_sprint',
      description: 'Get the currently active sprint for a specific board. Returns sprint ID, name, dates, and goal.',
      inputSchema: {
        type: 'object',
        properties: {
          boardId: {
            type: 'number',
            description: 'The ID of the JIRA board',
          },
        },
        required: ['boardId'],
      },
    },
    {
      name: 'jira_list_sprints',
      description: 'List sprints for a board or project. Returns sprint IDs, names, states, dates, and goals sorted by most recent first. Supports pagination.',
      inputSchema: {
        type: 'object',
        properties: {
          boardId: {
            type: 'number',
            description: 'The ID of a specific JIRA board. Either boardId or projectKey is required.',
          },
          projectKey: {
            type: 'string',
            description: 'Project key to get sprints from all boards in the project (e.g., "PROJ"). Either boardId or projectKey is required.',
          },
          state: {
            type: 'string',
            enum: ['active', 'future', 'closed'],
            description: 'Filter sprints by state. If not specified, returns all sprints.',
          },
          startAt: {
            type: 'number',
            description: 'Index of the first sprint to return (for pagination). Default: 0.',
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of sprints to return (default: 50)',
          },
        },
      },
    },
    {
      name: 'jira_get_sprint_issues',
      description: 'Get all issues in a specific sprint. Returns issue keys, summaries, statuses, and assignees by default. Use the fields parameter to customize which fields are returned.',
      inputSchema: {
        type: 'object',
        properties: {
          sprintId: {
            type: 'number',
            description: 'The ID of the sprint',
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of issues to return (default: 50)',
          },
          fields: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['key', 'summary', 'status', 'statusCategory', 'assignee', 'priority', 'type', 'description', 'labels', 'customFields'],
            },
            description: 'Fields to include in the response. Default: ["key", "summary", "status", "statusCategory", "assignee", "priority"]. Use "customFields" to include custom fields.',
          },
        },
        required: ['sprintId'],
      },
    },
    {
      name: 'jira_get_my_sprint_issues',
      description: 'Get issues assigned to the current user in a specific sprint. Filters by assignee = currentUser(). Returns issue keys, summaries, statuses, and priorities sorted by status then priority by default. Use the fields parameter to customize which fields are returned.',
      inputSchema: {
        type: 'object',
        properties: {
          sprintId: {
            type: 'number',
            description: 'The ID of the sprint',
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of issues to return (default: 200)',
          },
          fields: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['key', 'summary', 'status', 'statusCategory', 'assignee', 'priority', 'type', 'description', 'labels', 'customFields'],
            },
            description: 'Fields to include in the response. Default: ["key", "summary", "status", "statusCategory", "assignee", "priority"]. Use "customFields" to include custom fields.',
          },
        },
        required: ['sprintId'],
      },
    },
    // Issue tools
    {
      name: 'jira_get_issue',
      description: 'Get detailed information about a specific JIRA issue by its key (e.g., PROJ-123). Returns all fields by default including custom fields. Use the fields parameter to reduce response size.',
      inputSchema: {
        type: 'object',
        properties: {
          issueKey: {
            type: 'string',
            description: 'The issue key (e.g., PROJ-123)',
          },
          fields: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['key', 'summary', 'description', 'type', 'status', 'statusCategory', 'priority', 'assignee', 'reporter', 'created', 'updated', 'labels', 'components', 'attachmentCount', 'commentCount', 'parent', 'customFields'],
            },
            description: 'Fields to include in the response. Default: all fields. Use to reduce response size by specifying only needed fields.',
          },
        },
        required: ['issueKey'],
      },
    },
    {
      name: 'jira_search_issues',
      description: 'Search for issues using JQL (JIRA Query Language). Returns up to 50 issues by default. IMPORTANT: Queries must be bounded with a project filter or other restriction (e.g., assignee, sprint) - unbounded queries are rejected by JIRA. Example: "project = PROJ AND status = \\"In Progress\\""',
      inputSchema: {
        type: 'object',
        properties: {
          jql: {
            type: 'string',
            description: 'JQL query string',
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of results to return. Defaults to 50 if not specified.',
          },
          nextPageToken: {
            type: 'string',
            description: 'Token for fetching the next page of results. Use the nextPageToken from a previous response to continue pagination.',
          },
          fields: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['key', 'summary', 'status', 'statusCategory', 'assignee', 'type', 'parent', 'priority', 'description', 'labels', 'customFields'],
            },
            description: 'Fields to include in the response. Default: ["key", "summary", "status", "statusCategory", "assignee", "type", "parent"]. Use "customFields" to include custom fields.',
          },
        },
        required: ['jql'],
      },
    },
    {
      name: 'jira_get_backlog_stats',
      description: 'Get aggregated statistics for issues matching a JQL query. Returns counts grouped by status, type, priority, and assignee by default. Supports custom pivoting on any field pair with aggregation actions (count, sum, avg, cardinality) and flexible field filters.',
      inputSchema: {
        type: 'object',
        properties: {
          jql: {
            type: 'string',
            description: 'JQL query string (e.g., "project = PROJ")',
          },
          boardId: {
            type: 'number',
            description: 'Filter by board ID (adds project filter based on board\'s project)',
          },
          excludeResolved: {
            type: 'boolean',
            description: 'Exclude resolved/done issues (adds "resolution IS EMPTY" to JQL)',
          },
          issueTypes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by issue types (e.g., ["Bug", "Story"])',
          },
          assignees: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by assignees (use "unassigned" for unassigned issues)',
          },
          sprint: {
            type: 'number',
            description: 'Filter by sprint ID',
          },
          groupBy: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['status', 'type', 'priority', 'assignee', 'reporter', 'labels', 'components', 'resolution', 'project'],
            },
            description: 'Fields to group by. If specified, replaces default aggregations with custom groupedBy results.',
          },
          pivot: {
            type: 'object',
            description: 'Custom pivot table configuration',
            properties: {
              rowField: {
                type: 'string',
                enum: ['status', 'type', 'priority', 'assignee', 'reporter', 'labels', 'components', 'resolution', 'project'],
                description: 'Field for pivot table rows',
              },
              columnField: {
                type: 'string',
                enum: ['status', 'type', 'priority', 'assignee', 'reporter', 'labels', 'components', 'resolution', 'project'],
                description: 'Field for pivot table columns',
              },
              action: {
                type: 'string',
                enum: ['count', 'sum', 'avg', 'cardinality'],
                description: 'Aggregation action (default: count). Use sum/avg with valueField for numeric aggregations.',
              },
              valueField: {
                type: 'string',
                description: 'Custom field ID for sum/avg operations (e.g., customfield_10001 for story points)',
              },
            },
            required: ['rowField', 'columnField'],
          },
          fieldFilters: {
            type: 'array',
            description: 'Additional field-based filters applied via JQL',
            items: {
              type: 'object',
              properties: {
                field: {
                  type: 'string',
                  description: 'JQL field name (e.g., status, priority, labels, customfield_10001)',
                },
                operator: {
                  type: 'string',
                  enum: ['eq', 'in', 'not', 'contains', 'empty', 'notEmpty'],
                  description: 'Filter operator',
                },
                value: {
                  oneOf: [
                    { type: 'string' },
                    { type: 'array', items: { type: 'string' } },
                  ],
                  description: 'Filter value (string or array for "in" operator)',
                },
              },
              required: ['field', 'operator'],
            },
          },
        },
        required: ['jql'],
      },
    },
    {
      name: 'jira_get_sprint_report',
      description: 'Generate a sprint report for retrospectives. Returns issue counts and story points grouped by status categories, bug metrics, and label-specific tracking. Compares current sprint with previous sprint.',
      inputSchema: {
        type: 'object',
        properties: {
          sprintId: {
            type: 'number',
            description: 'The current sprint ID',
          },
          previousSprintId: {
            type: 'number',
            description: 'The previous sprint ID for comparison (optional)',
          },
          projectKey: {
            type: 'string',
            description: 'Project key (e.g., "PROJ")',
          },
          storyPointsField: {
            type: 'string',
            description: 'Custom field ID for story points (e.g., "customfield_10024"). Optional if JIRA_STORY_POINTS_FIELD env var is set.',
          },
          labelsOfInterest: {
            type: 'array',
            items: { type: 'string' },
            description: 'Labels to track separately (e.g., ["NZ", "TopTen"]). Returns complete/not complete counts for each.',
          },
          statusGroups: {
            type: 'object',
            description: 'Custom status groupings. Keys are group names, values are arrays of status names. Can be set via JIRA_STATUS_GROUPS env var. Defaults: To Do, Blocked, In Progress, Design Review, To Test, Done.',
            additionalProperties: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          bugBacklogStatuses: {
            type: 'array',
            items: { type: 'string' },
            description: 'Statuses to include when counting bugs in backlog (e.g., ["To Do"]). Can be set via JIRA_BUG_BACKLOG_STATUSES env var. Default: all bugs not in Done statuses.',
          },
          blockedStatuses: {
            type: 'array',
            items: { type: 'string' },
            description: 'Statuses considered "blocked" (e.g., ["Blocked", "Blocked on QA"]). Can be set via JIRA_BLOCKED_STATUSES env var. Default: ["Blocked", "Blocked on QA"].',
          },
          includeTriage: {
            type: 'boolean',
            description: 'Include triage metrics (issues created after sprint started). Default: false.',
          },
          includeInflow: {
            type: 'boolean',
            description: 'Include inflow metrics (issues pulled from backlog after sprint started). Requires changelog lookups. Default: false.',
          },
        },
        required: ['sprintId', 'projectKey', 'storyPointsField'],
      },
    },
    {
      name: 'jira_get_issue_comments',
      description: 'Get comments on a specific JIRA issue. Returns comment author, body, and creation date.',
      inputSchema: {
        type: 'object',
        properties: {
          issueKey: {
            type: 'string',
            description: 'The issue key (e.g., PROJ-123)',
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of comments (default: 20)',
          },
        },
        required: ['issueKey'],
      },
    },
    {
      name: 'jira_update_issue',
      description: 'Update fields on a JIRA issue. Can update summary, description, assignee, priority, labels, and custom fields.',
      inputSchema: {
        type: 'object',
        properties: {
          issueKey: {
            type: 'string',
            description: 'The issue key (e.g., PROJ-123)',
          },
          summary: {
            type: 'string',
            description: 'New summary/title for the issue',
          },
          description: {
            type: 'string',
            description: 'New description for the issue',
          },
          assignee: {
            type: 'string',
            description: 'Atlassian account ID of the assignee (use null to unassign)',
          },
          priority: {
            type: 'string',
            description: 'Priority name (e.g., "High", "Medium", "Low")',
          },
          labels: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of labels to set on the issue',
          },
          customFields: {
            type: 'object',
            description: 'Custom fields to update. Keys are field IDs (e.g., "customfield_10001") and values depend on field type.',
            additionalProperties: true,
          },
        },
        required: ['issueKey'],
      },
    },
    {
      name: 'jira_get_transitions',
      description: 'Get available status transitions for an issue. Use this to see what statuses an issue can be moved to.',
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
    {
      name: 'jira_get_issue_history',
      description: 'Get the changelog/history of a JIRA issue. Returns all field changes, status transitions, and other modifications.',
      inputSchema: {
        type: 'object',
        properties: {
          issueKey: {
            type: 'string',
            description: 'The issue key (e.g., PROJ-123)',
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of history entries to return (default: 100)',
          },
        },
        required: ['issueKey'],
      },
    },
    {
      name: 'jira_transition_issue',
      description: 'Transition an issue to a new status. Use jira_get_transitions first to get valid transition IDs.',
      inputSchema: {
        type: 'object',
        properties: {
          issueKey: {
            type: 'string',
            description: 'The issue key (e.g., PROJ-123)',
          },
          transitionId: {
            type: 'string',
            description: 'The transition ID (from jira_get_transitions)',
          },
          comment: {
            type: 'string',
            description: 'Optional comment to add with the transition',
          },
        },
        required: ['issueKey', 'transitionId'],
      },
    },
    {
      name: 'jira_add_comment',
      description: 'Add a comment to a JIRA issue.',
      inputSchema: {
        type: 'object',
        properties: {
          issueKey: {
            type: 'string',
            description: 'The issue key (e.g., PROJ-123)',
          },
          body: {
            type: 'string',
            description: 'The comment text',
          },
        },
        required: ['issueKey', 'body'],
      },
    },
    {
      name: 'jira_create_issue',
      description: 'Create a new JIRA issue. Returns the created issue key and ID.',
      inputSchema: {
        type: 'object',
        properties: {
          projectKey: {
            type: 'string',
            description: 'The project key (e.g., PROJ)',
          },
          summary: {
            type: 'string',
            description: 'The issue summary/title',
          },
          issueType: {
            type: 'string',
            description: 'The issue type (e.g., "Task", "Bug", "Story", "Epic", "Sub-task")',
          },
          description: {
            type: 'string',
            description: 'The issue description',
          },
          priority: {
            type: 'string',
            description: 'Priority name (e.g., "High", "Medium", "Low")',
          },
          labels: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of labels to add to the issue',
          },
          assignee: {
            type: 'string',
            description: 'Atlassian account ID of the assignee',
          },
          parent: {
            type: 'string',
            description: 'Parent issue key (for subtasks or linking stories to epics)',
          },
          components: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of component names to add to the issue',
          },
          customFields: {
            type: 'object',
            description: 'Custom fields to set on the issue. Keys should be field IDs (e.g., "customfield_10001") and values depend on field type. Use jira_get_create_fields to discover required fields and their formats.',
            additionalProperties: true,
          },
        },
        required: ['projectKey', 'summary', 'issueType'],
      },
    },
    // Attachment tools
    {
      name: 'jira_list_attachments',
      description: 'List all attachments on a JIRA issue. Returns attachment IDs, filenames, sizes, and types.',
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
    {
      name: 'jira_download_attachment',
      description: 'Download an attachment from JIRA to a local file path.',
      inputSchema: {
        type: 'object',
        properties: {
          attachmentId: {
            type: 'string',
            description: 'The attachment ID (from jira_list_attachments)',
          },
          outputPath: {
            type: 'string',
            description: 'Local file path to save the attachment',
          },
        },
        required: ['attachmentId', 'outputPath'],
      },
    },
    {
      name: 'jira_upload_attachment',
      description: 'Upload a file as an attachment to a JIRA issue.',
      inputSchema: {
        type: 'object',
        properties: {
          issueKey: {
            type: 'string',
            description: 'The issue key (e.g., PROJ-123)',
          },
          filePath: {
            type: 'string',
            description: 'Local file path to upload',
          },
        },
        required: ['issueKey', 'filePath'],
      },
    },
    // Field schema tool
    {
      name: 'jira_get_field_schema',
      description: 'Get available JIRA fields with their IDs, names, and types. Useful for discovering custom field IDs (e.g., finding the ID for "Story Points" to use in stats aggregations). Returns field metadata including schema type.',
      inputSchema: {
        type: 'object',
        properties: {
          projectKey: {
            type: 'string',
            description: 'If provided, only return fields configured for this project. This shows which fields are actually in use, not just all fields in JIRA.',
          },
          customOnly: {
            type: 'boolean',
            description: 'If true, only return custom fields (excludes built-in fields like summary, status, etc.)',
          },
          searchTerm: {
            type: 'string',
            description: 'Filter fields by name or ID (case-insensitive). E.g., "story" to find Story Points field.',
          },
        },
      },
    },

    // Create fields discovery tool
    {
      name: 'jira_get_create_fields',
      description: 'IMPORTANT: Call this BEFORE creating an issue to discover required fields and their formats. Returns all required fields for a project and issue type, including custom fields, with allowed values and format hints. This prevents "field is required" errors during issue creation.',
      inputSchema: {
        type: 'object',
        properties: {
          projectKey: {
            type: 'string',
            description: 'The project key (e.g., "PROJ")',
          },
          issueType: {
            type: 'string',
            description: 'The issue type name (e.g., "Task", "Bug", "Story")',
          },
          includeOptional: {
            type: 'boolean',
            description: 'If true, also return optional fields. Default: false (only required fields).',
          },
        },
        required: ['projectKey', 'issueType'],
      },
    },

    // Field values tool
    {
      name: 'jira_list_field_values',
      description: 'List discrete values for a JIRA field. Supports labels, priorities, statuses, issue types, resolutions, and components. Useful for discovering valid values before creating/updating issues.',
      inputSchema: {
        type: 'object',
        properties: {
          field: {
            type: 'string',
            enum: ['labels', 'priorities', 'statuses', 'issueTypes', 'resolutions', 'components'],
            description: 'The field to list values for',
          },
          projectKey: {
            type: 'string',
            description: 'Project key (required for "components" field, e.g., "PROJ")',
          },
          searchTerm: {
            type: 'string',
            description: 'Filter values by name (case-insensitive partial match)',
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of values to return (default: 1000 for labels)',
          },
        },
        required: ['field'],
      },
    },

    // Debug tools
    {
      name: 'jira_debug_search',
      description: 'Debug tool for exploring raw JIRA data. Returns raw field data and field name mappings. Useful for finding custom field IDs.',
      inputSchema: {
        type: 'object',
        properties: {
          jql: {
            type: 'string',
            description: 'JQL query string',
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of issues to return (default: 1)',
          },
          fields: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific fields to return (omit for all fields)',
          },
        },
        required: ['jql'],
      },
    },
  ];

// Define available tools (filtered by permission scopes)
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: allTools.filter(tool => isToolAllowed(tool.name, allowedTools)),
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Check if tool is allowed by permission scopes (returns same error as unknown tool)
  if (!isToolAllowed(name, allowedTools)) {
    return {
      content: [{ type: 'text', text: `Error: Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    switch (name) {
      // Sprint tools
      case 'jira_list_boards': {
        const result = await listBoards(boardAllowlist);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'jira_get_active_sprint': {
        const boardId = args?.boardId as number;
        if (!boardId) {
          throw new Error('boardId is required');
        }
        const result = await getActiveSprint(boardId, boardAllowlist);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'jira_list_sprints': {
        const boardId = args?.boardId as number | undefined;
        const projectKey = args?.projectKey as string | undefined;
        if (!boardId && !projectKey) {
          throw new Error('Either boardId or projectKey is required');
        }
        const options = {
          boardId,
          projectKey,
          state: args?.state as 'active' | 'future' | 'closed' | undefined,
          startAt: args?.startAt as number | undefined,
          maxResults: args?.maxResults as number | undefined,
        };
        const result = await listSprints(options, boardAllowlist);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'jira_get_sprint_issues': {
        const sprintId = args?.sprintId as number;
        const maxResults = (args?.maxResults as number) || 50;
        const fields = args?.fields as SprintIssueField[] | undefined;
        if (!sprintId) {
          throw new Error('sprintId is required');
        }
        const result = await getSprintIssues(sprintId, maxResults, boardAllowlist, fields);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'jira_get_my_sprint_issues': {
        const sprintId = args?.sprintId as number;
        const maxResults = (args?.maxResults as number) || 200;
        const fields = args?.fields as SprintIssueField[] | undefined;
        if (!sprintId) {
          throw new Error('sprintId is required');
        }
        const result = await getMySprintIssues(sprintId, maxResults, boardAllowlist, fields);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // Issue tools
      case 'jira_get_issue': {
        const issueKey = args?.issueKey as string;
        const fields = args?.fields as IssueField[] | undefined;
        if (!issueKey) {
          throw new Error('issueKey is required');
        }
        const result = await getIssue(issueKey, issueTypeAllowlist, projectAllowlist, fields);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'jira_search_issues': {
        const jql = args?.jql as string;
        const maxResults = (args?.maxResults as number) || 50;
        const nextPageToken = args?.nextPageToken as string | undefined;
        const fields = args?.fields as SearchIssueField[] | undefined;
        if (!jql) {
          throw new Error('jql is required');
        }
        const result = await searchIssues(jql, maxResults, issueTypeAllowlist, projectAllowlist, fields, nextPageToken);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'jira_get_backlog_stats': {
        const jql = args?.jql as string;
        if (!jql) {
          throw new Error('jql is required');
        }
        const options = {
          excludeResolved: args?.excludeResolved as boolean | undefined,
          issueTypes: args?.issueTypes as string[] | undefined,
          assignees: args?.assignees as string[] | undefined,
          sprint: args?.sprint as number | undefined,
          boardId: args?.boardId as number | undefined,
          groupBy: args?.groupBy as import('./tools/issues.js').StatsField[] | undefined,
          pivot: args?.pivot as import('./tools/issues.js').PivotConfig | undefined,
          fieldFilters: args?.fieldFilters as import('./tools/issues.js').FieldFilter[] | undefined,
        };
        const result = await getBacklogStats(jql, options, projectAllowlist, issueTypeAllowlist);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'jira_get_sprint_report': {
        const sprintId = args?.sprintId as number;
        const projectKey = args?.projectKey as string;
        // Use provided storyPointsField, fall back to env default
        const storyPointsField = (args?.storyPointsField as string) || sprintReportDefaults.storyPointsField;
        if (!sprintId || !projectKey) {
          throw new Error('sprintId and projectKey are required');
        }
        if (!storyPointsField) {
          throw new Error('storyPointsField is required (provide it or set JIRA_STORY_POINTS_FIELD env var)');
        }
        const options = {
          sprintId,
          projectKey,
          storyPointsField,
          previousSprintId: args?.previousSprintId as number | undefined,
          labelsOfInterest: args?.labelsOfInterest as string[] | undefined,
          // Use provided values or fall back to env defaults
          statusGroups: (args?.statusGroups as Record<string, string[]> | undefined) ?? sprintReportDefaults.statusGroups,
          bugBacklogStatuses: (args?.bugBacklogStatuses as string[] | undefined) ?? sprintReportDefaults.bugBacklogStatuses,
          blockedStatuses: (args?.blockedStatuses as string[] | undefined) ?? sprintReportDefaults.blockedStatuses,
          includeTriage: args?.includeTriage as boolean | undefined,
          includeInflow: args?.includeInflow as boolean | undefined,
        };
        const result = await getSprintReport(options, issueTypeAllowlist, projectAllowlist);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'jira_get_issue_comments': {
        const issueKey = args?.issueKey as string;
        const maxResults = (args?.maxResults as number) || 20;
        if (!issueKey) {
          throw new Error('issueKey is required');
        }
        const result = await getIssueComments(issueKey, maxResults, issueTypeAllowlist, projectAllowlist);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'jira_update_issue': {
        const issueKey = args?.issueKey as string;
        if (!issueKey) {
          throw new Error('issueKey is required');
        }
        const updates: {
          summary?: string;
          description?: string;
          assignee?: string;
          priority?: string;
          labels?: string[];
          customFields?: Record<string, unknown>;
        } = {};
        if (args?.summary !== undefined) updates.summary = args.summary as string;
        if (args?.description !== undefined) updates.description = args.description as string;
        if (args?.assignee !== undefined) updates.assignee = args.assignee as string;
        if (args?.priority !== undefined) updates.priority = args.priority as string;
        if (args?.labels !== undefined) updates.labels = args.labels as string[];
        if (args?.customFields !== undefined) updates.customFields = args.customFields as Record<string, unknown>;

        const result = await updateIssue(issueKey, updates, issueTypeAllowlist, projectAllowlist);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'jira_get_transitions': {
        const issueKey = args?.issueKey as string;
        if (!issueKey) {
          throw new Error('issueKey is required');
        }
        const result = await getTransitions(issueKey, issueTypeAllowlist, projectAllowlist);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'jira_get_issue_history': {
        const issueKey = args?.issueKey as string;
        const maxResults = (args?.maxResults as number) || 100;
        if (!issueKey) {
          throw new Error('issueKey is required');
        }
        const result = await getIssueHistory(issueKey, maxResults, issueTypeAllowlist, projectAllowlist);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'jira_transition_issue': {
        const issueKey = args?.issueKey as string;
        const transitionId = args?.transitionId as string;
        const comment = args?.comment as string | undefined;
        if (!issueKey || !transitionId) {
          throw new Error('issueKey and transitionId are required');
        }
        const result = await transitionIssue(issueKey, transitionId, comment, issueTypeAllowlist, projectAllowlist);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'jira_add_comment': {
        const issueKey = args?.issueKey as string;
        const body = args?.body as string;
        if (!issueKey || !body) {
          throw new Error('issueKey and body are required');
        }
        const result = await addComment(issueKey, body, issueTypeAllowlist, projectAllowlist);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'jira_create_issue': {
        const projectKey = args?.projectKey as string;
        const summary = args?.summary as string;
        const issueType = args?.issueType as string;
        if (!projectKey || !summary || !issueType) {
          throw new Error('projectKey, summary, and issueType are required');
        }
        const result = await createIssue({
          projectKey,
          summary,
          issueType,
          description: args?.description as string | undefined,
          priority: args?.priority as string | undefined,
          labels: args?.labels as string[] | undefined,
          assignee: args?.assignee as string | undefined,
          parent: args?.parent as string | undefined,
          components: args?.components as string[] | undefined,
          customFields: args?.customFields as Record<string, unknown> | undefined,
        }, issueTypeAllowlist, projectAllowlist);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // Attachment tools
      case 'jira_list_attachments': {
        const issueKey = args?.issueKey as string;
        if (!issueKey) {
          throw new Error('issueKey is required');
        }
        const result = await listAttachments(issueKey, issueTypeAllowlist, projectAllowlist);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'jira_download_attachment': {
        const attachmentId = args?.attachmentId as string;
        const outputPath = args?.outputPath as string;
        if (!attachmentId || !outputPath) {
          throw new Error('attachmentId and outputPath are required');
        }
        const result = await downloadAttachment(attachmentId, outputPath);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'jira_upload_attachment': {
        const issueKey = args?.issueKey as string;
        const filePath = args?.filePath as string;
        if (!issueKey || !filePath) {
          throw new Error('issueKey and filePath are required');
        }
        const result = await uploadAttachment(issueKey, filePath, issueTypeAllowlist, projectAllowlist);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // Field schema tool
      case 'jira_get_field_schema': {
        const projectKey = args?.projectKey as string | undefined;
        const customOnly = args?.customOnly as boolean | undefined;
        const searchTerm = args?.searchTerm as string | undefined;
        const result = await getFieldSchema({ projectKey, customOnly, searchTerm });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // Create fields discovery tool
      case 'jira_get_create_fields': {
        const projectKey = args?.projectKey as string;
        const issueType = args?.issueType as string;
        if (!projectKey || !issueType) {
          throw new Error('projectKey and issueType are required');
        }
        const includeOptional = args?.includeOptional as boolean | undefined;
        const result = await getCreateFields(projectKey, issueType, { includeOptional });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // Field values tool
      case 'jira_list_field_values': {
        const field = args?.field as ListableField;
        if (!field) {
          throw new Error('field is required');
        }
        const projectKey = args?.projectKey as string | undefined;
        const searchTerm = args?.searchTerm as string | undefined;
        const maxResults = args?.maxResults as number | undefined;
        const result = await listFieldValues({ field, projectKey, searchTerm, maxResults });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // Debug tools
      case 'jira_debug_search': {
        const jql = args?.jql as string;
        const maxResults = (args?.maxResults as number) || 1;
        const fields = args?.fields as string[] | undefined;
        if (!jql) {
          throw new Error('jql is required');
        }
        const result = await debugSearch(jql, maxResults, fields);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('JIRA MCP server running on stdio');
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

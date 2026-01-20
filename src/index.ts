#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { listBoards, getActiveSprint, getSprintIssues, getMySprintIssues } from './tools/sprint.js';
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
} from './tools/issues.js';
import { listAttachments, downloadAttachment, uploadAttachment } from './tools/attachments.js';
import { parseScopes, isToolAllowed, parseAllowlist, parseIssueTypesAllowlist, parseProjectAllowlist } from './permissions.js';

// Parse permission scopes from environment variable
const allowedTools = parseScopes(process.env.JIRA_SCOPES);

// Parse board, issue type, and project allowlists
const boardAllowlist = parseAllowlist(process.env.JIRA_ALLOWED_BOARDS);
const issueTypeAllowlist = parseIssueTypesAllowlist(process.env.JIRA_ALLOWED_ISSUE_TYPES);
const projectAllowlist = parseProjectAllowlist(process.env.JIRA_ALLOWED_PROJECTS);

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
      name: 'jira_get_sprint_issues',
      description: 'Get all issues in a specific sprint. Returns issue keys, summaries, statuses, and assignees.',
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
        },
        required: ['sprintId'],
      },
    },
    {
      name: 'jira_get_my_sprint_issues',
      description: 'Get issues assigned to the current user in a specific sprint. Filters by assignee = currentUser(). Returns issue keys, summaries, statuses, and priorities sorted by status then priority.',
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
        },
        required: ['sprintId'],
      },
    },
    // Issue tools
    {
      name: 'jira_get_issue',
      description: 'Get detailed information about a specific JIRA issue by its key (e.g., PROJ-123). Returns summary, description, status, assignee, labels, and more.',
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
        },
        required: ['jql'],
      },
    },
    {
      name: 'jira_get_backlog_stats',
      description: 'Get aggregated statistics for issues matching a JQL query. Returns counts grouped by status, type, priority, and assignee. Useful for quick backlog overview without paginating through all issues.',
      inputSchema: {
        type: 'object',
        properties: {
          jql: {
            type: 'string',
            description: 'JQL query string (e.g., "project = PROJ")',
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
        },
        required: ['jql'],
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
      description: 'Update fields on a JIRA issue. Can update summary, description, assignee, priority, and labels.',
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

      case 'jira_get_sprint_issues': {
        const sprintId = args?.sprintId as number;
        const maxResults = (args?.maxResults as number) || 50;
        if (!sprintId) {
          throw new Error('sprintId is required');
        }
        const result = await getSprintIssues(sprintId, maxResults, boardAllowlist);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'jira_get_my_sprint_issues': {
        const sprintId = args?.sprintId as number;
        const maxResults = (args?.maxResults as number) || 200;
        if (!sprintId) {
          throw new Error('sprintId is required');
        }
        const result = await getMySprintIssues(sprintId, maxResults, boardAllowlist);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // Issue tools
      case 'jira_get_issue': {
        const issueKey = args?.issueKey as string;
        if (!issueKey) {
          throw new Error('issueKey is required');
        }
        const result = await getIssue(issueKey, issueTypeAllowlist, projectAllowlist);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'jira_search_issues': {
        const jql = args?.jql as string;
        const maxResults = (args?.maxResults as number) || 50;
        if (!jql) {
          throw new Error('jql is required');
        }
        const result = await searchIssues(jql, maxResults, issueTypeAllowlist, projectAllowlist);
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
        };
        const result = await getBacklogStats(jql, options, projectAllowlist, issueTypeAllowlist);
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
        } = {};
        if (args?.summary !== undefined) updates.summary = args.summary as string;
        if (args?.description !== undefined) updates.description = args.description as string;
        if (args?.assignee !== undefined) updates.assignee = args.assignee as string;
        if (args?.priority !== undefined) updates.priority = args.priority as string;
        if (args?.labels !== undefined) updates.labels = args.labels as string[];

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

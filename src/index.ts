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
} from './tools/issues.js';
import { listAttachments, downloadAttachment } from './tools/attachments.js';

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

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
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
      description: 'Search for issues using JQL (JIRA Query Language). IMPORTANT: Queries must be bounded with a project filter or other restriction (e.g., assignee, sprint) - unbounded queries are rejected by JIRA. Example: "project = PROJ AND status = \\"In Progress\\""',
      inputSchema: {
        type: 'object',
        properties: {
          jql: {
            type: 'string',
            description: 'JQL query string',
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of results (default: 50)',
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
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // Sprint tools
      case 'jira_list_boards': {
        const result = await listBoards();
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'jira_get_active_sprint': {
        const boardId = args?.boardId as number;
        if (!boardId) {
          throw new Error('boardId is required');
        }
        const result = await getActiveSprint(boardId);
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
        const result = await getSprintIssues(sprintId, maxResults);
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
        const result = await getMySprintIssues(sprintId, maxResults);
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
        const result = await getIssue(issueKey);
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
        const result = await searchIssues(jql, maxResults);
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
        const result = await getIssueComments(issueKey, maxResults);
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

        const result = await updateIssue(issueKey, updates);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'jira_get_transitions': {
        const issueKey = args?.issueKey as string;
        if (!issueKey) {
          throw new Error('issueKey is required');
        }
        const result = await getTransitions(issueKey);
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
        const result = await transitionIssue(issueKey, transitionId, comment);
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
        const result = await addComment(issueKey, body);
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
        });
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
        const result = await listAttachments(issueKey);
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

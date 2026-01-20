import { getJiraClient } from '../jira-client.js';
import type {
  IssueDetails,
  CommentSummary,
  JiraDocument,
  JiraDocumentNode,
  CreateIssueResult,
} from '../types.js';

// Convert Atlassian Document Format to plain text
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

// Extract parent epic from issue fields
// Handles both next-gen (fields.parent) and classic (customfield_* epic link) projects
export function extractParent(fields: Record<string, unknown>): IssueDetails['parent'] | undefined {
  // Next-gen/team-managed projects use fields.parent
  if (fields.parent && typeof fields.parent === 'object') {
    const parent = fields.parent as {
      key?: string;
      fields?: { summary?: string; issuetype?: { name?: string } };
    };
    if (parent.key) {
      return {
        key: parent.key,
        summary: parent.fields?.summary ?? '',
        type: parent.fields?.issuetype?.name ?? 'Unknown',
      };
    }
  }

  // Classic/company-managed projects use customfield_* for epic link
  // The field value is typically just the epic key as a string
  for (const [key, value] of Object.entries(fields)) {
    if (key.startsWith('customfield_') && typeof value === 'string') {
      // Epic links are typically issue keys like "PROJ-123"
      if (/^[A-Z][A-Z0-9]+-\d+$/.test(value)) {
        return {
          key: value,
          summary: '', // We don't have the summary for classic epic links
          type: 'Epic',
        };
      }
    }
  }

  return undefined;
}

export async function getIssue(issueKey: string): Promise<IssueDetails> {
  const client = getJiraClient();
  const issue = await client.getIssue(issueKey, ['renderedFields']);

  const parent = extractParent(issue.fields as unknown as Record<string, unknown>);

  return {
    key: issue.key,
    summary: issue.fields.summary,
    description: adfToText(issue.fields.description),
    type: issue.fields.issuetype.name,
    status: issue.fields.status.name,
    statusCategory: issue.fields.status.statusCategory.name,
    priority: issue.fields.priority?.name,
    assignee: issue.fields.assignee?.displayName,
    reporter: issue.fields.reporter?.displayName,
    created: issue.fields.created,
    updated: issue.fields.updated,
    labels: issue.fields.labels,
    components: issue.fields.components.map((c) => c.name),
    attachmentCount: issue.fields.attachment?.length ?? 0,
    commentCount: issue.fields.comment?.total ?? 0,
    parent,
  };
}

export async function searchIssues(
  jql: string,
  maxResults = 50
): Promise<{
  issues: Array<{
    key: string;
    summary: string;
    status: string;
    statusCategory: string;
    assignee?: string;
    type: string;
    parent?: { key: string; summary: string };
  }>;
  total: number;
}> {
  const client = getJiraClient();
  const response = await client.searchIssues(jql, 0, maxResults, [
    'summary',
    'status',
    'assignee',
    'issuetype',
    'parent',
  ]);

  return {
    issues: response.issues.map((issue) => {
      const parent = extractParent(issue.fields as unknown as Record<string, unknown>);
      return {
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        statusCategory: issue.fields.status.statusCategory.name,
        assignee: issue.fields.assignee?.displayName,
        type: issue.fields.issuetype.name,
        parent: parent ? { key: parent.key, summary: parent.summary } : undefined,
      };
    }),
    total: response.total,
  };
}

export async function getIssueComments(
  issueKey: string,
  maxResults = 20
): Promise<{
  issueKey: string;
  comments: CommentSummary[];
  total: number;
}> {
  const client = getJiraClient();
  const response = await client.getIssueComments(issueKey, 0, maxResults);

  return {
    issueKey,
    comments: response.comments.map((comment) => ({
      id: comment.id,
      author: comment.author.displayName,
      body: adfToText(comment.body as JiraDocument | string),
      created: comment.created,
    })),
    total: response.total,
  };
}

export async function updateIssue(
  issueKey: string,
  updates: {
    summary?: string;
    description?: string;
    assignee?: string; // accountId
    priority?: string; // priority name or id
    labels?: string[];
  }
): Promise<{ success: boolean; issueKey: string }> {
  const client = getJiraClient();

  // Build fields object
  const fields: Record<string, unknown> = {};

  if (updates.summary !== undefined) {
    fields.summary = updates.summary;
  }

  if (updates.description !== undefined) {
    fields.description = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: updates.description }],
        },
      ],
    };
  }

  if (updates.assignee !== undefined) {
    fields.assignee = updates.assignee ? { accountId: updates.assignee } : null;
  }

  if (updates.priority !== undefined) {
    fields.priority = { name: updates.priority };
  }

  if (updates.labels !== undefined) {
    fields.labels = updates.labels;
  }

  await client.updateIssue(issueKey, fields);

  return { success: true, issueKey };
}

export async function getTransitions(
  issueKey: string
): Promise<{
  issueKey: string;
  transitions: Array<{
    id: string;
    name: string;
    toStatus: string;
    toStatusCategory: string;
  }>;
}> {
  const client = getJiraClient();
  const response = await client.getTransitions(issueKey);

  return {
    issueKey,
    transitions: response.transitions.map((t) => ({
      id: t.id,
      name: t.name,
      toStatus: t.to.name,
      toStatusCategory: t.to.statusCategory.name,
    })),
  };
}

export async function transitionIssue(
  issueKey: string,
  transitionId: string,
  comment?: string
): Promise<{ success: boolean; issueKey: string; transitionId: string }> {
  const client = getJiraClient();

  await client.transitionIssue(issueKey, transitionId, undefined, comment);

  return { success: true, issueKey, transitionId };
}

export async function addComment(
  issueKey: string,
  body: string
): Promise<{ success: boolean; issueKey: string; commentId: string }> {
  const client = getJiraClient();

  const comment = await client.addComment(issueKey, body);

  return { success: true, issueKey, commentId: comment.id };
}

export async function createIssue(options: {
  projectKey: string;
  summary: string;
  issueType: string;
  description?: string;
  priority?: string;
  labels?: string[];
  assignee?: string; // accountId
  parent?: string; // parent issue key (for subtasks or linking to epics)
  components?: string[];
}): Promise<CreateIssueResult> {
  const client = getJiraClient();

  // Build fields object
  const fields: Record<string, unknown> = {
    project: { key: options.projectKey },
    summary: options.summary,
    issuetype: { name: options.issueType },
  };

  if (options.description) {
    fields.description = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: options.description }],
        },
      ],
    };
  }

  if (options.priority) {
    fields.priority = { name: options.priority };
  }

  if (options.labels) {
    fields.labels = options.labels;
  }

  if (options.assignee) {
    fields.assignee = { accountId: options.assignee };
  }

  if (options.parent) {
    fields.parent = { key: options.parent };
  }

  if (options.components) {
    fields.components = options.components.map((name) => ({ name }));
  }

  const result = await client.createIssue(fields);

  return {
    key: result.key,
    id: result.id,
    self: result.self,
  };
}

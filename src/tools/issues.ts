import { getJiraClient } from '../jira-client.js';
import type {
  IssueDetails,
  CommentSummary,
  JiraDocument,
  JiraDocumentNode,
  CreateIssueResult,
  HistoryEntry,
} from '../types.js';
import { isIssueTypeAllowed, isProjectAllowed, getProjectFromIssueKey } from '../permissions.js';

/**
 * Verify that an issue's project and type are allowed, throwing an error if not.
 * Returns the issue type name for convenience.
 */
async function verifyIssueAllowed(
  issueKey: string,
  issueTypeAllowlist: Set<string> | null,
  projectAllowlist: Set<string> | null
): Promise<string> {
  // Check project allowlist first (can be done without fetching the issue)
  const projectKey = getProjectFromIssueKey(issueKey);
  if (!isProjectAllowed(projectKey, projectAllowlist)) {
    throw new Error(`Issue not found: ${issueKey}`);
  }

  if (issueTypeAllowlist === null) {
    // No type restrictions, but we still need to fetch the type for consistency
    const client = getJiraClient();
    const issue = await client.getIssue(issueKey);
    return issue.fields.issuetype.name;
  }

  const client = getJiraClient();
  const issue = await client.getIssue(issueKey);
  const typeName = issue.fields.issuetype.name;

  if (!isIssueTypeAllowed(typeName, issueTypeAllowlist)) {
    throw new Error(`Issue not found: ${issueKey}`);
  }

  return typeName;
}

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

export async function getIssue(
  issueKey: string,
  issueTypeAllowlist: Set<string> | null,
  projectAllowlist: Set<string> | null
): Promise<IssueDetails> {
  // Check project allowlist first
  const projectKey = getProjectFromIssueKey(issueKey);
  if (!isProjectAllowed(projectKey, projectAllowlist)) {
    throw new Error(`Issue not found: ${issueKey}`);
  }

  const client = getJiraClient();
  const issue = await client.getIssue(issueKey, ['renderedFields']);

  // Check if issue type is allowed
  if (!isIssueTypeAllowed(issue.fields.issuetype.name, issueTypeAllowlist)) {
    throw new Error(`Issue not found: ${issueKey}`);
  }

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
  maxResults = 50,
  issueTypeAllowlist: Set<string> | null,
  projectAllowlist: Set<string> | null
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

  // Filter results by allowed projects and issue types
  const filteredIssues = response.issues.filter((issue) => {
    const projectKey = getProjectFromIssueKey(issue.key);
    return isProjectAllowed(projectKey, projectAllowlist) &&
      isIssueTypeAllowed(issue.fields.issuetype.name, issueTypeAllowlist);
  });

  return {
    issues: filteredIssues.map((issue) => {
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
    total: filteredIssues.length,
  };
}

export async function getIssueComments(
  issueKey: string,
  maxResults = 20,
  issueTypeAllowlist: Set<string> | null,
  projectAllowlist: Set<string> | null
): Promise<{
  issueKey: string;
  comments: CommentSummary[];
  total: number;
}> {
  // Verify issue project and type are allowed
  await verifyIssueAllowed(issueKey, issueTypeAllowlist, projectAllowlist);

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
  },
  issueTypeAllowlist: Set<string> | null,
  projectAllowlist: Set<string> | null
): Promise<{ success: boolean; issueKey: string }> {
  // Verify issue project and type are allowed
  await verifyIssueAllowed(issueKey, issueTypeAllowlist, projectAllowlist);

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
  issueKey: string,
  issueTypeAllowlist: Set<string> | null,
  projectAllowlist: Set<string> | null
): Promise<{
  issueKey: string;
  transitions: Array<{
    id: string;
    name: string;
    toStatus: string;
    toStatusCategory: string;
  }>;
}> {
  // Verify issue project and type are allowed
  await verifyIssueAllowed(issueKey, issueTypeAllowlist, projectAllowlist);

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
  comment: string | undefined,
  issueTypeAllowlist: Set<string> | null,
  projectAllowlist: Set<string> | null
): Promise<{ success: boolean; issueKey: string; transitionId: string }> {
  // Verify issue project and type are allowed
  await verifyIssueAllowed(issueKey, issueTypeAllowlist, projectAllowlist);

  const client = getJiraClient();

  await client.transitionIssue(issueKey, transitionId, undefined, comment);

  return { success: true, issueKey, transitionId };
}

export async function addComment(
  issueKey: string,
  body: string,
  issueTypeAllowlist: Set<string> | null,
  projectAllowlist: Set<string> | null
): Promise<{ success: boolean; issueKey: string; commentId: string }> {
  // Verify issue project and type are allowed
  await verifyIssueAllowed(issueKey, issueTypeAllowlist, projectAllowlist);

  const client = getJiraClient();

  const comment = await client.addComment(issueKey, body);

  return { success: true, issueKey, commentId: comment.id };
}

export async function createIssue(
  options: {
    projectKey: string;
    summary: string;
    issueType: string;
    description?: string;
    priority?: string;
    labels?: string[];
    assignee?: string; // accountId
    parent?: string; // parent issue key (for subtasks or linking to epics)
    components?: string[];
  },
  issueTypeAllowlist: Set<string> | null,
  projectAllowlist: Set<string> | null
): Promise<CreateIssueResult> {
  // Check if project is allowed
  if (!isProjectAllowed(options.projectKey, projectAllowlist)) {
    throw new Error(`Invalid project: ${options.projectKey}`);
  }

  // Check if issue type is allowed
  if (!isIssueTypeAllowed(options.issueType, issueTypeAllowlist)) {
    throw new Error(`Invalid issue type: ${options.issueType}`);
  }

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

export async function getIssueHistory(
  issueKey: string,
  maxResults = 100,
  issueTypeAllowlist: Set<string> | null,
  projectAllowlist: Set<string> | null
): Promise<{
  issueKey: string;
  history: HistoryEntry[];
  total: number;
}> {
  // Verify issue project and type are allowed
  await verifyIssueAllowed(issueKey, issueTypeAllowlist, projectAllowlist);

  const client = getJiraClient();
  const response = await client.getIssueChangelog(issueKey, 0, maxResults);

  return {
    issueKey,
    history: response.values.map((entry) => ({
      id: entry.id,
      author: entry.author.displayName,
      created: entry.created,
      changes: entry.items.map((item) => ({
        field: item.field,
        from: item.fromString,
        to: item.toString,
      })),
    })),
    total: response.total,
  };
}

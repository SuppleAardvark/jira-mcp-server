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

/**
 * Extract a readable value from a custom field.
 */
function extractCustomFieldValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  // Handle arrays (e.g., multi-select fields)
  if (Array.isArray(value)) {
    return value.map(v => extractCustomFieldValue(v));
  }

  // Handle objects with common JIRA patterns
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;

    // User objects
    if ('displayName' in obj) {
      return obj.displayName;
    }

    // Option/select fields
    if ('value' in obj && typeof obj.value === 'string') {
      return obj.value;
    }

    // Status-like objects
    if ('name' in obj && typeof obj.name === 'string') {
      return obj.name;
    }

    // Sprint objects
    if ('name' in obj && 'state' in obj) {
      return { name: obj.name, state: obj.state };
    }

    // ADF content - convert to text
    if ('type' in obj && obj.type === 'doc' && 'content' in obj) {
      return adfToText(obj as unknown as JiraDocument);
    }

    // Issue link references
    if ('key' in obj && 'fields' in obj) {
      const fields = obj.fields as Record<string, unknown>;
      return {
        key: obj.key,
        summary: fields.summary,
      };
    }

    // Return simple objects as-is, complex ones get stringified summary
    const keys = Object.keys(obj);
    if (keys.length <= 3) {
      return obj;
    }
    // For complex objects, try to extract meaningful data
    if ('self' in obj && keys.length > 3) {
      const { self, ...rest } = obj;
      return rest;
    }
    return obj;
  }

  // Primitives (string, number, boolean)
  return value;
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
  const issue = await client.getIssue(issueKey, ['renderedFields', 'names']);

  // Check if issue type is allowed
  if (!isIssueTypeAllowed(issue.fields.issuetype.name, issueTypeAllowlist)) {
    throw new Error(`Issue not found: ${issueKey}`);
  }

  const parent = extractParent(issue.fields as unknown as Record<string, unknown>);

  // Extract custom fields
  const customFields: Record<string, unknown> = {};
  const fieldNames = (issue as unknown as { names?: Record<string, string> }).names || {};
  const fields = issue.fields as unknown as Record<string, unknown>;

  for (const [key, value] of Object.entries(fields)) {
    if (key.startsWith('customfield_') && value !== null) {
      const fieldName = fieldNames[key] || key;
      const extractedValue = extractCustomFieldValue(value);
      if (extractedValue !== null) {
        customFields[fieldName] = extractedValue;
      }
    }
  }

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
    customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
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
  hasMore: boolean;
}> {
  const client = getJiraClient();

  // Collect issues across multiple pages if needed (max 100 per page)
  const allIssues: typeof response.issues = [];
  let nextPageToken: string | undefined;
  let hasMore = false;
  const pageSize = Math.min(maxResults, 100);

  let response = await client.searchIssues(jql, 0, pageSize, [
    'summary',
    'status',
    'assignee',
    'issuetype',
    'parent',
  ]);
  allIssues.push(...response.issues);

  // Fetch additional pages if needed and available
  while (allIssues.length < maxResults && response.nextPageToken && !response.isLast) {
    nextPageToken = response.nextPageToken;
    const remaining = maxResults - allIssues.length;
    response = await client.searchIssues(jql, 0, Math.min(remaining, 100), [
      'summary',
      'status',
      'assignee',
      'issuetype',
      'parent',
    ], nextPageToken);
    allIssues.push(...response.issues);
  }

  // Check if there are more results beyond what we fetched
  hasMore = !response.isLast && !!response.nextPageToken;

  // Filter results by allowed projects and issue types
  const filteredIssues = allIssues.filter((issue) => {
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
    hasMore,
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
    customFields?: Record<string, unknown>; // customfield_XXXXX or field name -> value
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

  // Add custom fields - pass through as-is (user provides customfield_XXXXX keys)
  if (updates.customFields) {
    for (const [key, value] of Object.entries(updates.customFields)) {
      fields[key] = value;
    }
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

export async function getBacklogStats(
  jql: string,
  options: {
    excludeResolved?: boolean;
    issueTypes?: string[];
    assignees?: string[];
    sprint?: number;
    boardId?: number;
  },
  projectAllowlist: Set<string> | null,
  issueTypeAllowlist: Set<string> | null
): Promise<{
  total: number;
  analyzed: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  byPriority: Record<string, number>;
  byAssignee: Record<string, number>;
  byTypeAndStatus: Record<string, Record<string, number>>;
}> {
  const client = getJiraClient();

  // Extract ORDER BY clause if present (case-insensitive)
  // Handle both "... ORDER BY ..." and JQL that starts with "ORDER BY ..."
  const orderByMatch = jql.match(/^(.*?)\s*(ORDER\s+BY\s+.*)$/i);
  let baseJql = orderByMatch ? orderByMatch[1].trim() : jql;
  const orderByClause = orderByMatch ? orderByMatch[2] : '';

  // Build filter conditions
  const filters: string[] = [];

  // If boardId is provided, fetch the board to get its project
  if (options.boardId) {
    const board = await client.getBoard(options.boardId);
    if (board.location?.projectKey) {
      filters.push(`project = "${board.location.projectKey}"`);
    }
  }

  if (options.excludeResolved) {
    filters.push('resolution IS EMPTY');
  }

  if (options.issueTypes && options.issueTypes.length > 0) {
    const types = options.issueTypes.map(t => `"${t}"`).join(', ');
    filters.push(`issuetype IN (${types})`);
  }

  if (options.assignees && options.assignees.length > 0) {
    const assigneeFilters = options.assignees.map(a =>
      a.toLowerCase() === 'unassigned' ? 'assignee IS EMPTY' : `assignee = "${a}"`
    );
    filters.push(`(${assigneeFilters.join(' OR ')})`);
  }

  if (options.sprint) {
    filters.push(`sprint = ${options.sprint}`);
  }

  // Combine base JQL with filters
  let finalJql = baseJql.trim();
  if (filters.length > 0) {
    if (finalJql) {
      finalJql += ' AND ' + filters.join(' AND ');
    } else {
      finalJql = filters.join(' AND ');
    }
  }

  // Re-add ORDER BY clause if present
  if (orderByClause) {
    finalJql += ' ' + orderByClause;
  }

  // Aggregate counts across multiple pages
  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  const byAssignee: Record<string, number> = {};
  const byTypeAndStatus: Record<string, Record<string, number>> = {};

  const pageSize = 100;
  let totalFromJira = 0;
  let analyzed = 0;
  let pageCount = 0;
  let nextPageToken: string | undefined;

  // Fetch up to 4000 issues across multiple pages using token-based pagination
  while (pageCount < 40) { // 40 pages * 100 = 4000 max
    const response = await client.searchIssues(finalJql, 0, pageSize, [
      'status',
      'issuetype',
      'priority',
      'assignee',
    ], nextPageToken);
    if (response.total !== undefined) {
      totalFromJira = response.total;
    }

    if (response.issues.length === 0) {
      break;
    }

    // Filter and aggregate
    for (const issue of response.issues) {
      const projectKey = getProjectFromIssueKey(issue.key);
      if (!isProjectAllowed(projectKey, projectAllowlist) ||
          !isIssueTypeAllowed(issue.fields.issuetype.name, issueTypeAllowlist)) {
        continue;
      }

      analyzed++;

      const status = issue.fields.status.name;
      byStatus[status] = (byStatus[status] || 0) + 1;

      const type = issue.fields.issuetype.name;
      byType[type] = (byType[type] || 0) + 1;

      // Pivot: Type -> Status
      if (!byTypeAndStatus[type]) {
        byTypeAndStatus[type] = {};
      }
      byTypeAndStatus[type][status] = (byTypeAndStatus[type][status] || 0) + 1;

      const priority = issue.fields.priority?.name || 'None';
      byPriority[priority] = (byPriority[priority] || 0) + 1;

      const assignee = issue.fields.assignee?.displayName || 'Unassigned';
      byAssignee[assignee] = (byAssignee[assignee] || 0) + 1;
    }

    pageCount++;

    // Stop if this is the last page
    if (response.isLast || !response.nextPageToken) {
      break;
    }
    nextPageToken = response.nextPageToken;
  }

  return {
    total: totalFromJira || analyzed,
    analyzed,
    byStatus,
    byType,
    byPriority,
    byAssignee,
    byTypeAndStatus,
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

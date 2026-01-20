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
export function extractCustomFieldValue(value: unknown): unknown {
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

// Fields that can be requested for getIssue
export type IssueField = 'key' | 'summary' | 'description' | 'type' | 'status' | 'statusCategory' | 'priority' | 'assignee' | 'reporter' | 'created' | 'updated' | 'labels' | 'components' | 'attachmentCount' | 'commentCount' | 'parent' | 'customFields';

// Default fields for getIssue (all fields)
const DEFAULT_ISSUE_FIELDS: IssueField[] = ['key', 'summary', 'description', 'type', 'status', 'statusCategory', 'priority', 'assignee', 'reporter', 'created', 'updated', 'labels', 'components', 'attachmentCount', 'commentCount', 'parent', 'customFields'];

export async function getIssue(
  issueKey: string,
  issueTypeAllowlist: Set<string> | null,
  projectAllowlist: Set<string> | null,
  requestedFields?: IssueField[]
): Promise<IssueDetails> {
  // Check project allowlist first
  const projectKey = getProjectFromIssueKey(issueKey);
  if (!isProjectAllowed(projectKey, projectAllowlist)) {
    throw new Error(`Issue not found: ${issueKey}`);
  }

  const fieldsToReturn = requestedFields ?? DEFAULT_ISSUE_FIELDS;
  const needsCustomFields = fieldsToReturn.includes('customFields');

  const client = getJiraClient();

  // Fetch issue and field names in parallel if needed
  const issuePromise = client.getIssue(issueKey, ['renderedFields']);
  const fieldNamesPromise = needsCustomFields ? client.getFields() : Promise.resolve([]);
  const [issue, allFields] = await Promise.all([issuePromise, fieldNamesPromise]);

  // Check if issue type is allowed
  if (!isIssueTypeAllowed(issue.fields.issuetype.name, issueTypeAllowlist)) {
    throw new Error(`Issue not found: ${issueKey}`);
  }

  const fields = issue.fields as unknown as Record<string, unknown>;
  const fieldNames: Record<string, string> = {};
  for (const field of allFields) {
    fieldNames[field.id] = field.name;
  }

  // Build result based on requested fields
  const result: IssueDetails = { key: issue.key };

  for (const field of fieldsToReturn) {
    switch (field) {
      case 'key':
        break;
      case 'summary':
        result.summary = issue.fields.summary;
        break;
      case 'description':
        result.description = adfToText(issue.fields.description);
        break;
      case 'type':
        result.type = issue.fields.issuetype.name;
        break;
      case 'status':
        result.status = issue.fields.status.name;
        break;
      case 'statusCategory':
        result.statusCategory = issue.fields.status.statusCategory.name;
        break;
      case 'priority':
        result.priority = issue.fields.priority?.name;
        break;
      case 'assignee':
        result.assignee = issue.fields.assignee?.displayName;
        break;
      case 'reporter':
        result.reporter = issue.fields.reporter?.displayName;
        break;
      case 'created':
        result.created = issue.fields.created;
        break;
      case 'updated':
        result.updated = issue.fields.updated;
        break;
      case 'labels':
        result.labels = issue.fields.labels;
        break;
      case 'components':
        result.components = issue.fields.components.map((c) => c.name);
        break;
      case 'attachmentCount':
        result.attachmentCount = issue.fields.attachment?.length ?? 0;
        break;
      case 'commentCount':
        result.commentCount = issue.fields.comment?.total ?? 0;
        break;
      case 'parent':
        result.parent = extractParent(fields);
        break;
      case 'customFields': {
        const customFields: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(fields)) {
          if (key.startsWith('customfield_') && value !== null) {
            const fieldName = fieldNames[key] || key;
            const extractedValue = extractCustomFieldValue(value);
            if (extractedValue !== null) {
              customFields[fieldName] = extractedValue;
            }
          }
        }
        if (Object.keys(customFields).length > 0) {
          result.customFields = customFields;
        }
        break;
      }
    }
  }

  return result;
}

// Fields that can be requested for search results
export type SearchIssueField = 'key' | 'summary' | 'status' | 'statusCategory' | 'assignee' | 'type' | 'parent' | 'priority' | 'description' | 'labels' | 'customFields';

// Default fields for search results
const DEFAULT_SEARCH_FIELDS: SearchIssueField[] = ['key', 'summary', 'status', 'statusCategory', 'assignee', 'type', 'parent'];

export interface SearchIssueResult {
  key: string;
  summary?: string;
  status?: string;
  statusCategory?: string;
  assignee?: string;
  type?: string;
  parent?: { key: string; summary: string };
  priority?: string;
  description?: string;
  labels?: string[];
  customFields?: Record<string, unknown>;
}

export async function searchIssues(
  jql: string,
  maxResults = 50,
  issueTypeAllowlist: Set<string> | null,
  projectAllowlist: Set<string> | null,
  requestedFields?: SearchIssueField[],
  pageToken?: string
): Promise<{
  issues: SearchIssueResult[];
  total: number;
  hasMore: boolean;
  nextPageToken?: string;
}> {
  const client = getJiraClient();

  const fieldsToReturn = requestedFields ?? DEFAULT_SEARCH_FIELDS;
  const needsCustomFields = fieldsToReturn.includes('customFields');
  const needsDescription = fieldsToReturn.includes('description');
  const needsPriority = fieldsToReturn.includes('priority');
  const needsLabels = fieldsToReturn.includes('labels');

  // Build list of JIRA fields to request
  const jiraFields = ['summary', 'status', 'assignee', 'issuetype', 'parent'];
  if (needsDescription) jiraFields.push('description');
  if (needsPriority) jiraFields.push('priority');
  if (needsLabels) jiraFields.push('labels');
  if (needsCustomFields) {
    // Request all fields when custom fields are needed
    jiraFields.length = 0;
    jiraFields.push('*all');
  }

  // Fetch a single page of issues (max 100 per page)
  const pageSize = Math.min(maxResults, 100);

  // Use the incoming pageToken if provided, otherwise start from the beginning
  const response = await client.searchIssues(jql, 0, pageSize, jiraFields, pageToken);
  const allIssues = response.issues;

  // Return pagination info for the caller to continue if needed
  const hasMore = !response.isLast && !!response.nextPageToken;
  const nextPageToken = response.nextPageToken;

  // Filter results by allowed projects and issue types
  const filteredIssues = allIssues.filter((issue) => {
    const projectKey = getProjectFromIssueKey(issue.key);
    return isProjectAllowed(projectKey, projectAllowlist) &&
      isIssueTypeAllowed(issue.fields.issuetype.name, issueTypeAllowlist);
  });

  // Get field names if custom fields are requested
  let fieldNames: Record<string, string> | undefined;
  if (needsCustomFields && filteredIssues.length > 0) {
    const allFields = await client.getFields();
    fieldNames = {};
    for (const field of allFields) {
      fieldNames[field.id] = field.name;
    }
  }

  return {
    issues: filteredIssues.map((issue) => {
      const result: SearchIssueResult = { key: issue.key };
      const fields = issue.fields as unknown as Record<string, unknown>;
      const status = fields.status as { name: string; statusCategory: { name: string } };

      for (const field of fieldsToReturn) {
        switch (field) {
          case 'key':
            break;
          case 'summary':
            result.summary = fields.summary as string;
            break;
          case 'status':
            result.status = status.name;
            break;
          case 'statusCategory':
            result.statusCategory = status.statusCategory.name;
            break;
          case 'assignee': {
            const assignee = fields.assignee as { displayName: string } | null;
            result.assignee = assignee?.displayName;
            break;
          }
          case 'type': {
            const issuetype = fields.issuetype as { name: string };
            result.type = issuetype.name;
            break;
          }
          case 'parent': {
            const parent = extractParent(fields);
            if (parent) {
              result.parent = { key: parent.key, summary: parent.summary };
            }
            break;
          }
          case 'priority': {
            const priority = fields.priority as { name: string } | null;
            result.priority = priority?.name;
            break;
          }
          case 'description':
            result.description = adfToText(fields.description as JiraDocument | string | undefined);
            break;
          case 'labels':
            result.labels = fields.labels as string[];
            break;
          case 'customFields': {
            const customFields: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(fields)) {
              if (key.startsWith('customfield_') && value !== null) {
                const fieldName = fieldNames?.[key] || key;
                const extractedValue = extractCustomFieldValue(value);
                if (extractedValue !== null) {
                  customFields[fieldName] = extractedValue;
                }
              }
            }
            if (Object.keys(customFields).length > 0) {
              result.customFields = customFields;
            }
            break;
          }
        }
      }

      return result;
    }),
    total: filteredIssues.length,
    hasMore,
    nextPageToken,
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

// Standard fields that can be used for grouping/pivoting
export type StatsField = 'status' | 'type' | 'priority' | 'assignee' | 'reporter' | 'labels' | 'components' | 'resolution' | 'project';

// Aggregation actions for pivot tables
export type AggregationAction = 'count' | 'sum' | 'avg' | 'cardinality';

// Pivot configuration
export interface PivotConfig {
  rowField: StatsField;
  columnField: StatsField;
  action?: AggregationAction; // default: 'count'
  valueField?: string; // custom field ID for sum/avg (e.g., story points)
}

// Field filter configuration
export interface FieldFilter {
  field: string;
  operator: 'eq' | 'in' | 'not' | 'contains' | 'empty' | 'notEmpty';
  value?: string | string[];
}

/**
 * Extract a field value from an issue for stats aggregation.
 */
function getFieldValue(issue: { key: string; fields: Record<string, unknown> }, field: StatsField): string | string[] {
  const fields = issue.fields;
  switch (field) {
    case 'status':
      return (fields.status as { name: string })?.name || 'Unknown';
    case 'type':
      return (fields.issuetype as { name: string })?.name || 'Unknown';
    case 'priority':
      return (fields.priority as { name: string })?.name || 'None';
    case 'assignee':
      return (fields.assignee as { displayName: string })?.displayName || 'Unassigned';
    case 'reporter':
      return (fields.reporter as { displayName: string })?.displayName || 'Unknown';
    case 'labels':
      return (fields.labels as string[]) || [];
    case 'components':
      return (fields.components as { name: string }[])?.map(c => c.name) || [];
    case 'resolution':
      return (fields.resolution as { name: string })?.name || 'Unresolved';
    case 'project':
      return getProjectFromIssueKey(issue.key);
    default:
      return 'Unknown';
  }
}

/**
 * Get numeric value from a field (for sum/avg operations).
 */
function getNumericValue(fields: Record<string, unknown>, valueField: string): number | null {
  const value = fields[valueField];
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

export async function getBacklogStats(
  jql: string,
  options: {
    excludeResolved?: boolean;
    issueTypes?: string[];
    assignees?: string[];
    sprint?: number;
    boardId?: number;
    // New options for flexible aggregation
    groupBy?: StatsField[]; // Which fields to group by (default: all standard fields)
    pivot?: PivotConfig; // Custom pivot table
    fieldFilters?: FieldFilter[]; // Additional field-based filters
  },
  projectAllowlist: Set<string> | null,
  issueTypeAllowlist: Set<string> | null
): Promise<{
  total: number;
  analyzed: number;
  byStatus?: Record<string, number>;
  byType?: Record<string, number>;
  byPriority?: Record<string, number>;
  byAssignee?: Record<string, number>;
  byTypeAndStatus?: Record<string, Record<string, number>>;
  // Dynamic groupBy results
  groupedBy?: Record<string, Record<string, number>>;
  // Custom pivot results
  pivot?: {
    rows: string[];
    columns: string[];
    data: Record<string, Record<string, number>>;
    totals: { rows: Record<string, number>; columns: Record<string, number>; grand: number };
    valueFieldName?: string; // Resolved name of the valueField (e.g., "Story Points" instead of "customfield_10001")
  };
}> {
  const client = getJiraClient();

  // Extract ORDER BY clause if present (case-insensitive)
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

  // Add field filters to JQL
  if (options.fieldFilters) {
    for (const filter of options.fieldFilters) {
      const jqlField = filter.field;
      switch (filter.operator) {
        case 'eq':
          filters.push(`${jqlField} = "${filter.value}"`);
          break;
        case 'in':
          if (Array.isArray(filter.value)) {
            const values = filter.value.map(v => `"${v}"`).join(', ');
            filters.push(`${jqlField} IN (${values})`);
          }
          break;
        case 'not':
          filters.push(`${jqlField} != "${filter.value}"`);
          break;
        case 'contains':
          filters.push(`${jqlField} ~ "${filter.value}"`);
          break;
        case 'empty':
          filters.push(`${jqlField} IS EMPTY`);
          break;
        case 'notEmpty':
          filters.push(`${jqlField} IS NOT EMPTY`);
          break;
      }
    }
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

  // Determine which fields to fetch based on groupBy and pivot
  const fieldsNeeded = new Set<string>(['status', 'issuetype', 'priority', 'assignee']);

  if (options.groupBy) {
    for (const field of options.groupBy) {
      if (field === 'type') fieldsNeeded.add('issuetype');
      else if (field === 'reporter') fieldsNeeded.add('reporter');
      else if (field === 'labels') fieldsNeeded.add('labels');
      else if (field === 'components') fieldsNeeded.add('components');
      else if (field === 'resolution') fieldsNeeded.add('resolution');
    }
  }

  // Track if we need custom fields (requires fetching all fields)
  // Note: needsAllFields was removed - we now explicitly add custom fields to fieldsNeeded

  if (options.pivot) {
    const addPivotField = (f: StatsField) => {
      if (f === 'type') fieldsNeeded.add('issuetype');
      else if (f === 'reporter') fieldsNeeded.add('reporter');
      else if (f === 'labels') fieldsNeeded.add('labels');
      else if (f === 'components') fieldsNeeded.add('components');
      else if (f === 'resolution') fieldsNeeded.add('resolution');
    };
    addPivotField(options.pivot.rowField);
    addPivotField(options.pivot.columnField);
    if (options.pivot.valueField) {
      // Add the value field (custom or standard) to the fields list
      fieldsNeeded.add(options.pivot.valueField);
    }
  }

  // Use default groupBy if not specified
  const useDefaultGroups = !options.groupBy;
  const groupByFields = options.groupBy || [];

  // Check if we need custom field name resolution
  const needsFieldNames = options.pivot?.valueField?.startsWith('customfield_');

  // Standard aggregation (when using defaults)
  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  const byAssignee: Record<string, number> = {};
  const byTypeAndStatus: Record<string, Record<string, number>> = {};

  // Dynamic groupBy aggregation
  const groupedBy: Record<string, Record<string, number>> = {};
  for (const field of groupByFields) {
    groupedBy[field] = {};
  }

  // Custom pivot aggregation
  const pivotData: Record<string, Record<string, { count: number; sum: number; values: Set<string> }>> = {};
  const pivotRowTotals: Record<string, { count: number; sum: number }> = {};
  const pivotColTotals: Record<string, { count: number; sum: number }> = {};
  let pivotGrandTotal = { count: 0, sum: 0 };

  // Field names mapping for custom fields
  let fieldNames: Record<string, string> = {};
  let resolvedValueFieldName: string | undefined;

  // Fetch field names upfront if needed
  if (needsFieldNames) {
    const allFields = await client.getFields();
    for (const field of allFields) {
      fieldNames[field.id] = field.name;
    }
    if (options.pivot?.valueField) {
      resolvedValueFieldName = fieldNames[options.pivot.valueField] || options.pivot.valueField;
    }
  }

  const pageSize = 100;
  let totalFromJira = 0;
  let analyzed = 0;
  let pageCount = 0;
  let nextPageToken: string | undefined;

  // Determine fields to fetch
  const searchFields = Array.from(fieldsNeeded);

  // Fetch up to 4000 issues across multiple pages using token-based pagination
  while (pageCount < 40) { // 40 pages * 100 = 4000 max
    const response = await client.searchIssues(finalJql, 0, pageSize, searchFields, nextPageToken);
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
      const issueData = { key: issue.key, fields: issue.fields as unknown as Record<string, unknown> };

      // Standard aggregations (when using defaults)
      if (useDefaultGroups) {
        const status = issue.fields.status.name;
        byStatus[status] = (byStatus[status] || 0) + 1;

        const type = issue.fields.issuetype.name;
        byType[type] = (byType[type] || 0) + 1;

        // Default pivot: Type -> Status
        if (!byTypeAndStatus[type]) {
          byTypeAndStatus[type] = {};
        }
        byTypeAndStatus[type][status] = (byTypeAndStatus[type][status] || 0) + 1;

        const priority = issue.fields.priority?.name || 'None';
        byPriority[priority] = (byPriority[priority] || 0) + 1;

        const assignee = issue.fields.assignee?.displayName || 'Unassigned';
        byAssignee[assignee] = (byAssignee[assignee] || 0) + 1;
      }

      // Dynamic groupBy aggregations
      for (const field of groupByFields) {
        const values = getFieldValue(issueData, field);
        const valueArray = Array.isArray(values) ? values : [values];
        for (const val of valueArray) {
          groupedBy[field][val] = (groupedBy[field][val] || 0) + 1;
        }
      }

      // Custom pivot aggregation
      if (options.pivot) {
        const rowValues = getFieldValue(issueData, options.pivot.rowField);
        const colValues = getFieldValue(issueData, options.pivot.columnField);
        const rowArray = Array.isArray(rowValues) ? rowValues : [rowValues];
        const colArray = Array.isArray(colValues) ? colValues : [colValues];

        const numericValue = options.pivot.valueField
          ? getNumericValue(issue.fields as unknown as Record<string, unknown>, options.pivot.valueField) ?? 0
          : 1;

        const issueKey = issue.key;

        for (const row of rowArray) {
          for (const col of colArray) {
            if (!pivotData[row]) pivotData[row] = {};
            if (!pivotData[row][col]) pivotData[row][col] = { count: 0, sum: 0, values: new Set() };

            pivotData[row][col].count++;
            pivotData[row][col].sum += numericValue;
            pivotData[row][col].values.add(issueKey);

            // Row totals
            if (!pivotRowTotals[row]) pivotRowTotals[row] = { count: 0, sum: 0 };
            pivotRowTotals[row].count++;
            pivotRowTotals[row].sum += numericValue;

            // Column totals
            if (!pivotColTotals[col]) pivotColTotals[col] = { count: 0, sum: 0 };
            pivotColTotals[col].count++;
            pivotColTotals[col].sum += numericValue;

            // Grand total
            pivotGrandTotal.count++;
            pivotGrandTotal.sum += numericValue;
          }
        }
      }
    }

    pageCount++;

    // Stop if this is the last page
    if (response.isLast || !response.nextPageToken) {
      break;
    }
    nextPageToken = response.nextPageToken;
  }

  // Build result
  const result: {
    total: number;
    analyzed: number;
    byStatus?: Record<string, number>;
    byType?: Record<string, number>;
    byPriority?: Record<string, number>;
    byAssignee?: Record<string, number>;
    byTypeAndStatus?: Record<string, Record<string, number>>;
    groupedBy?: Record<string, Record<string, number>>;
    pivot?: {
      rows: string[];
      columns: string[];
      data: Record<string, Record<string, number>>;
      totals: { rows: Record<string, number>; columns: Record<string, number>; grand: number };
      valueFieldName?: string;
    };
  } = {
    total: totalFromJira || analyzed,
    analyzed,
  };

  // Include standard aggregations only when using defaults
  if (useDefaultGroups) {
    result.byStatus = byStatus;
    result.byType = byType;
    result.byPriority = byPriority;
    result.byAssignee = byAssignee;
    result.byTypeAndStatus = byTypeAndStatus;
  }

  // Include dynamic groupBy results
  if (groupByFields.length > 0) {
    result.groupedBy = groupedBy;
  }

  // Include custom pivot results
  if (options.pivot) {
    const action = options.pivot.action || 'count';
    const rows = Object.keys(pivotData).sort();
    const columns = [...new Set(rows.flatMap(r => Object.keys(pivotData[r])))].sort();

    // Convert pivot data based on action
    const data: Record<string, Record<string, number>> = {};
    for (const row of rows) {
      data[row] = {};
      for (const col of columns) {
        const cell = pivotData[row]?.[col];
        if (!cell) {
          data[row][col] = 0;
        } else {
          switch (action) {
            case 'count':
              data[row][col] = cell.count;
              break;
            case 'sum':
              data[row][col] = cell.sum;
              break;
            case 'avg':
              data[row][col] = cell.count > 0 ? cell.sum / cell.count : 0;
              break;
            case 'cardinality':
              data[row][col] = cell.values.size;
              break;
          }
        }
      }
    }

    // Convert totals based on action
    const rowTotals: Record<string, number> = {};
    const colTotals: Record<string, number> = {};

    for (const row of rows) {
      const t = pivotRowTotals[row];
      switch (action) {
        case 'count': rowTotals[row] = t?.count || 0; break;
        case 'sum': rowTotals[row] = t?.sum || 0; break;
        case 'avg': rowTotals[row] = t?.count ? t.sum / t.count : 0; break;
        case 'cardinality': rowTotals[row] = Object.values(pivotData[row] || {}).reduce((acc, c) => acc + c.values.size, 0); break;
      }
    }

    for (const col of columns) {
      const t = pivotColTotals[col];
      switch (action) {
        case 'count': colTotals[col] = t?.count || 0; break;
        case 'sum': colTotals[col] = t?.sum || 0; break;
        case 'avg': colTotals[col] = t?.count ? t.sum / t.count : 0; break;
        case 'cardinality': {
          const allValues = new Set<string>();
          for (const row of rows) {
            pivotData[row]?.[col]?.values.forEach(v => allValues.add(v));
          }
          colTotals[col] = allValues.size;
          break;
        }
      }
    }

    let grand: number;
    switch (action) {
      case 'count': grand = pivotGrandTotal.count; break;
      case 'sum': grand = pivotGrandTotal.sum; break;
      case 'avg': grand = pivotGrandTotal.count ? pivotGrandTotal.sum / pivotGrandTotal.count : 0; break;
      case 'cardinality': grand = analyzed; break; // Total unique issues
    }

    result.pivot = {
      rows,
      columns,
      data,
      totals: { rows: rowTotals, columns: colTotals, grand },
      ...(resolvedValueFieldName && { valueFieldName: resolvedValueFieldName }),
    };
  }

  return result;
}

/**
 * Debug search tool - returns raw JIRA data for exploration.
 * Useful for finding field IDs and understanding data structure.
 */
export async function debugSearch(
  jql: string,
  maxResults = 1,
  fields?: string[]
): Promise<{
  issues: Array<{
    key: string;
    fields: Record<string, unknown>;
  }>;
  fieldNames?: Record<string, string>;
}> {
  const client = getJiraClient();

  // Fetch issues and field metadata in parallel
  const [response, allFields] = await Promise.all([
    client.searchIssues(jql, 0, maxResults, fields),
    client.getFields(),
  ]);

  // Build field name mapping
  const fieldNames: Record<string, string> = {};
  for (const field of allFields) {
    fieldNames[field.id] = field.name;
  }

  return {
    issues: response.issues.map(issue => ({
      key: issue.key,
      fields: issue.fields as unknown as Record<string, unknown>,
    })),
    fieldNames,
  };
}

interface FieldSchemaResult {
  fields: Array<{
    id: string;
    name: string;
    custom: boolean;
    required?: boolean;
    searchable?: boolean;
    navigable?: boolean;
    schema?: {
      type: string;
      items?: string;
      custom?: string;
      customId?: number;
    };
  }>;
  total: number;
  projectKey?: string;
}

/**
 * Get field schema - returns available JIRA fields with their IDs, names, and types.
 * If projectKey is provided, returns only fields configured for that project.
 * Useful for discovering custom field IDs (e.g., finding the ID for "Story Points").
 */
export async function getFieldSchema(options?: {
  customOnly?: boolean;
  searchTerm?: string;
  projectKey?: string;
}): Promise<FieldSchemaResult> {
  const client = getJiraClient();

  // If project key provided, get fields from create meta (shows fields in use for that project)
  if (options?.projectKey) {
    const meta = await client.getCreateMeta(options.projectKey);

    let fields = Object.values(meta.fields).map((field) => ({
      id: field.fieldId,
      name: field.name,
      custom: field.fieldId.startsWith('customfield_'),
      required: field.required,
      schema: field.schema,
    }));

    // Filter to custom fields only if requested
    if (options?.customOnly) {
      fields = fields.filter(f => f.custom);
    }

    // Filter by search term if provided
    if (options?.searchTerm) {
      const term = options.searchTerm.toLowerCase();
      fields = fields.filter(f =>
        f.name.toLowerCase().includes(term) ||
        f.id.toLowerCase().includes(term)
      );
    }

    // Sort by name
    fields.sort((a, b) => a.name.localeCompare(b.name));

    return {
      projectKey: options.projectKey,
      fields,
      total: fields.length,
    };
  }

  // No project key - return all fields from global field list
  const allFields = await client.getFields();

  let filtered = allFields;

  // Filter to custom fields only if requested
  if (options?.customOnly) {
    filtered = filtered.filter(f => f.custom);
  }

  // Filter by search term (case-insensitive match on name or id)
  if (options?.searchTerm) {
    const term = options.searchTerm.toLowerCase();
    filtered = filtered.filter(f =>
      f.name.toLowerCase().includes(term) ||
      f.id.toLowerCase().includes(term)
    );
  }

  // Sort by name for easier reading
  filtered.sort((a, b) => a.name.localeCompare(b.name));

  return {
    fields: filtered.map(f => {
      const extended = f as Record<string, unknown>;
      const result: FieldSchemaResult['fields'][0] = {
        id: f.id,
        name: f.name,
        custom: f.custom,
      };
      if (extended.searchable !== undefined) {
        result.searchable = extended.searchable as boolean;
      }
      if (extended.navigable !== undefined) {
        result.navigable = extended.navigable as boolean;
      }
      if (extended.schema) {
        result.schema = extended.schema as { type: string; items?: string; custom?: string; customId?: number };
      }
      return result;
    }),
    total: filtered.length,
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

/**
 * List all labels in JIRA, optionally filtered by a search term.
 */
export type ListableField = 'labels' | 'priorities' | 'statuses' | 'issueTypes' | 'resolutions' | 'components';

export interface FieldValue {
  id?: string;
  name: string;
  description?: string;
  // Additional field-specific properties
  extra?: Record<string, unknown>;
}

export async function listFieldValues(options: {
  field: ListableField;
  projectKey?: string;  // Required for 'components' field
  searchTerm?: string;
  maxResults?: number;
}): Promise<{
  field: ListableField;
  values: FieldValue[];
  total: number;
}> {
  const client = getJiraClient();
  let values: FieldValue[] = [];

  switch (options.field) {
    case 'labels': {
      const response = await client.getLabels(0, options.maxResults || 1000);
      values = response.values.map(name => ({ name }));
      break;
    }

    case 'priorities': {
      const priorities = await client.getPriorities();
      values = priorities.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        extra: p.iconUrl ? { iconUrl: p.iconUrl } : undefined,
      }));
      break;
    }

    case 'statuses': {
      const statuses = await client.getStatuses();
      values = statuses.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        extra: { statusCategory: s.statusCategory },
      }));
      break;
    }

    case 'issueTypes': {
      const types = await client.getIssueTypes();
      values = types.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        extra: { subtask: t.subtask },
      }));
      break;
    }

    case 'resolutions': {
      const resolutions = await client.getResolutions();
      values = resolutions.map(r => ({
        id: r.id,
        name: r.name,
        description: r.description,
      }));
      break;
    }

    case 'components': {
      if (!options.projectKey) {
        throw new Error('projectKey is required when listing components');
      }
      const components = await client.getProjectComponents(options.projectKey);
      values = components.map(c => ({
        id: c.id,
        name: c.name,
        description: c.description,
        extra: c.lead ? { lead: c.lead } : undefined,
      }));
      break;
    }

    default:
      throw new Error(`Unknown field: ${options.field}`);
  }

  // Filter by search term if provided
  if (options.searchTerm) {
    const term = options.searchTerm.toLowerCase();
    values = values.filter(v => v.name.toLowerCase().includes(term));
  }

  // Sort alphabetically
  values.sort((a, b) => a.name.localeCompare(b.name));

  // Apply maxResults limit (for non-labels which don't have server-side pagination)
  if (options.maxResults && options.field !== 'labels') {
    values = values.slice(0, options.maxResults);
  }

  return {
    field: options.field,
    values,
    total: values.length,
  };
}

/**
 * Status group definitions for sprint reports.
 * Maps group names to arrays of status names that belong to that group.
 */
const DEFAULT_STATUS_GROUPS: Record<string, string[]> = {
  'To Do': ['To Do', 'Open', 'Reopened'],
  'Blocked': ['Blocked'],
  'In Progress': ['In Progress', 'Ready to Style'],
  'Design Review': ['Design Review'],
  'To Test': ['Ready to Test', 'To Test', 'In Review'],
  'Done': ['Done', 'Closed', 'Invalid', 'Parked', 'Resolved'],
};

interface SprintReportMetrics {
  issues: number;
  storyPoints: number;
}

interface SprintReportRow {
  current: SprintReportMetrics;
  previous?: SprintReportMetrics;
}

interface LabelMetrics {
  complete: SprintReportMetrics;
  notComplete: SprintReportMetrics;
}

export interface SprintReportResult {
  currentSprint: { id: number; name: string };
  previousSprint?: { id: number; name: string };
  storyPointsField: string;
  storyPointsFieldName?: string;

  // Status group rows
  statusGroups: Record<string, SprintReportRow>;

  // Triage: items created after the sprint started (optional)
  triage?: SprintReportRow;

  // Inflow: items added to the sprint after it started (from backlog, optional)
  inflow?: SprintReportRow;

  // Bug metrics
  bugs: {
    backlogTotal: SprintReportMetrics;
    fixedInSprint: SprintReportRow;
    notFixedInSprint: SprintReportRow;
  };

  // Label-specific metrics
  labels: Record<string, {
    current: LabelMetrics;
    previous?: LabelMetrics;
  }>;
}

/**
 * Generate a sprint report with status groups, bug metrics, and label tracking.
 * Designed for retrospective reports.
 */
export async function getSprintReport(
  options: {
    sprintId: number;
    previousSprintId?: number;
    storyPointsField: string;
    labelsOfInterest?: string[];
    statusGroups?: Record<string, string[]>;
    projectKey: string;
    includeTriage?: boolean;
    includeInflow?: boolean;
  },
  issueTypeAllowlist: Set<string> | null,
  projectAllowlist: Set<string> | null
): Promise<SprintReportResult> {
  const client = getJiraClient();
  const statusGroups = options.statusGroups || DEFAULT_STATUS_GROUPS;
  const doneStatuses = statusGroups['Done'] || ['Done'];
  const toTestStatuses = statusGroups['To Test'] || ['Ready to Test'];
  const fixedStatuses = [...doneStatuses, ...toTestStatuses];

  // Get sprint info
  const currentSprint = await client.getSprint(options.sprintId);
  let previousSprint: typeof currentSprint | undefined;
  if (options.previousSprintId) {
    previousSprint = await client.getSprint(options.previousSprintId);
  }

  // Get field name for story points
  const allFields = await client.getFields();
  const spFieldMeta = allFields.find(f => f.id === options.storyPointsField);
  const storyPointsFieldName = spFieldMeta?.name;

  // Helper to get stats for a sprint
  const getSprintStats = async (sprintId: number) => {
    return getBacklogStats(
      `project = ${options.projectKey}`,
      {
        sprint: sprintId,
        groupBy: ['status'],
        pivot: {
          rowField: 'status',
          columnField: 'type',
          action: 'sum',
          valueField: options.storyPointsField,
        },
      },
      issueTypeAllowlist,
      projectAllowlist
    );
  };

  // Get current sprint stats
  const currentStats = await getSprintStats(options.sprintId);

  // Get previous sprint stats if requested
  let previousStats: typeof currentStats | undefined;
  if (options.previousSprintId) {
    previousStats = await getSprintStats(options.previousSprintId);
  }

  // Helper to aggregate metrics from status groups
  const aggregateStatusGroup = (
    stats: typeof currentStats,
    statuses: string[]
  ): SprintReportMetrics => {
    let issues = 0;
    let storyPoints = 0;

    const byStatus = stats.groupedBy?.status || stats.byStatus || {};
    const pivotData = stats.pivot?.data || {};

    for (const status of statuses) {
      issues += byStatus[status] || 0;
      // Sum story points across all issue types for this status
      const statusRow = pivotData[status];
      if (statusRow) {
        storyPoints += Object.values(statusRow).reduce((a, b) => a + b, 0);
      }
    }

    return { issues, storyPoints };
  };

  // Build status group rows
  const statusGroupResults: Record<string, SprintReportRow> = {};
  for (const [groupName, statuses] of Object.entries(statusGroups)) {
    statusGroupResults[groupName] = {
      current: aggregateStatusGroup(currentStats, statuses),
    };
    if (previousStats) {
      statusGroupResults[groupName].previous = aggregateStatusGroup(previousStats, statuses);
    }
  }

  // Triage: items created after the sprint started (optional)
  let triageRow: SprintReportRow | undefined;
  if (options.includeTriage) {
    const getTriageMetrics = async (sprintId: number, sprintStartDate: string | undefined): Promise<SprintReportMetrics> => {
      if (!sprintStartDate) {
        return { issues: 0, storyPoints: 0 };
      }
      // Format date for JQL (JIRA expects yyyy-MM-dd)
      const startDate = sprintStartDate.split('T')[0];
      const triageStats = await getBacklogStats(
        `project = ${options.projectKey} AND sprint = ${sprintId} AND created >= "${startDate}"`,
        {
          pivot: {
            rowField: 'status',
            columnField: 'type',
            action: 'sum',
            valueField: options.storyPointsField,
          },
        },
        issueTypeAllowlist,
        projectAllowlist
      );
      return {
        issues: triageStats.total,
        storyPoints: triageStats.pivot?.totals?.grand || 0,
      };
    };

    triageRow = {
      current: await getTriageMetrics(options.sprintId, currentSprint.startDate),
    };
    if (options.previousSprintId && previousSprint) {
      triageRow.previous = await getTriageMetrics(options.previousSprintId, previousSprint.startDate);
    }
  }

  // Inflow: items created before the sprint started but added to the sprint after it started (optional)
  let inflowRow: SprintReportRow | undefined;
  if (options.includeInflow) {
    const getInflowMetrics = async (sprintId: number, sprintName: string, sprintStartDate: string | undefined): Promise<SprintReportMetrics> => {
      if (!sprintStartDate) {
        return { issues: 0, storyPoints: 0 };
      }
      const startDate = sprintStartDate.split('T')[0];
      const sprintStartTime = new Date(sprintStartDate).getTime();

      // Get issues created BEFORE sprint started (these are potential inflow candidates)
      const candidateIssues = await client.searchIssues(
        `project = ${options.projectKey} AND sprint = ${sprintId} AND created < "${startDate}"`,
        0,
        500,
        ['key', options.storyPointsField]
      );

      let inflowIssues = 0;
      let inflowPoints = 0;

      // Check each candidate's changelog to see when it was added to this sprint
      for (const issue of candidateIssues.issues) {
        const changelog = await client.getIssueChangelog(issue.key, 100);

        // Look for when the sprint field was changed to include this sprint
        for (const entry of changelog.values) {
          const changeTime = new Date(entry.created).getTime();
          if (changeTime <= sprintStartTime) {
            // Change happened before sprint started, not inflow
            continue;
          }

          // Check if any item in this changelog entry added this sprint
          for (const item of entry.items) {
            if (item.field === 'Sprint' && item.toString?.includes(sprintName)) {
              // This issue was added to the sprint after it started
              inflowIssues++;
              const points = issue.fields[options.storyPointsField];
              if (typeof points === 'number') {
                inflowPoints += points;
              }
              break;
            }
          }
        }
      }

      return { issues: inflowIssues, storyPoints: inflowPoints };
    };

    inflowRow = {
      current: await getInflowMetrics(options.sprintId, currentSprint.name, currentSprint.startDate),
    };
    if (options.previousSprintId && previousSprint) {
      inflowRow.previous = await getInflowMetrics(options.previousSprintId, previousSprint.name, previousSprint.startDate);
    }
  }

  // Bug metrics - get bugs in backlog (not in any active sprint)
  const bugBacklogStats = await getBacklogStats(
    `project = ${options.projectKey} AND type = Bug AND sprint IS EMPTY`,
    {
      excludeResolved: true,
      pivot: {
        rowField: 'priority',
        columnField: 'status',
        action: 'sum',
        valueField: options.storyPointsField,
      },
    },
    issueTypeAllowlist,
    projectAllowlist
  );

  // Helper to get bug metrics for a sprint
  const getBugMetrics = (stats: typeof currentStats, fixed: boolean): SprintReportMetrics => {
    const targetStatuses = fixed ? fixedStatuses :
      Object.values(statusGroups).flat().filter(s => !fixedStatuses.includes(s));

    let issues = 0;
    let storyPoints = 0;

    const pivotData = stats.pivot?.data || {};

    for (const [status, typeData] of Object.entries(pivotData)) {
      if (fixed ? fixedStatuses.includes(status) : !fixedStatuses.includes(status)) {
        // Only count Bug type
        issues += (stats.byTypeAndStatus?.Bug?.[status] || 0);
        storyPoints += (typeData as Record<string, number>)['Bug'] || 0;
      }
    }

    return { issues, storyPoints };
  };

  // Get bug-specific stats for current sprint
  const currentBugStats = await getBacklogStats(
    `project = ${options.projectKey} AND type = Bug`,
    {
      sprint: options.sprintId,
      groupBy: ['status'],
      pivot: {
        rowField: 'status',
        columnField: 'type',
        action: 'sum',
        valueField: options.storyPointsField,
      },
    },
    issueTypeAllowlist,
    projectAllowlist
  );

  let previousBugStats: typeof currentBugStats | undefined;
  if (options.previousSprintId) {
    previousBugStats = await getBacklogStats(
      `project = ${options.projectKey} AND type = Bug`,
      {
        sprint: options.previousSprintId,
        groupBy: ['status'],
        pivot: {
          rowField: 'status',
          columnField: 'type',
          action: 'sum',
          valueField: options.storyPointsField,
        },
      },
      issueTypeAllowlist,
      projectAllowlist
    );
  }

  // Label metrics
  const labelResults: SprintReportResult['labels'] = {};

  for (const label of options.labelsOfInterest || []) {
    // Current sprint label stats
    const currentLabelStats = await getBacklogStats(
      `project = ${options.projectKey} AND labels = "${label}"`,
      {
        sprint: options.sprintId,
        groupBy: ['status'],
        pivot: {
          rowField: 'status',
          columnField: 'type',
          action: 'sum',
          valueField: options.storyPointsField,
        },
      },
      issueTypeAllowlist,
      projectAllowlist
    );

    const currentComplete = aggregateStatusGroup(currentLabelStats, doneStatuses);
    const currentNotComplete = aggregateStatusGroup(
      currentLabelStats,
      Object.values(statusGroups).flat().filter(s => !doneStatuses.includes(s))
    );

    labelResults[label] = {
      current: {
        complete: currentComplete,
        notComplete: currentNotComplete,
      },
    };

    // Previous sprint label stats
    if (options.previousSprintId) {
      const previousLabelStats = await getBacklogStats(
        `project = ${options.projectKey} AND labels = "${label}"`,
        {
          sprint: options.previousSprintId,
          groupBy: ['status'],
          pivot: {
            rowField: 'status',
            columnField: 'type',
            action: 'sum',
            valueField: options.storyPointsField,
          },
        },
        issueTypeAllowlist,
        projectAllowlist
      );

      labelResults[label].previous = {
        complete: aggregateStatusGroup(previousLabelStats, doneStatuses),
        notComplete: aggregateStatusGroup(
          previousLabelStats,
          Object.values(statusGroups).flat().filter(s => !doneStatuses.includes(s))
        ),
      };
    }
  }

  return {
    currentSprint: { id: currentSprint.id, name: currentSprint.name },
    previousSprint: previousSprint ? { id: previousSprint.id, name: previousSprint.name } : undefined,
    storyPointsField: options.storyPointsField,
    storyPointsFieldName,
    statusGroups: statusGroupResults,
    triage: triageRow,
    inflow: inflowRow,
    bugs: {
      backlogTotal: {
        issues: bugBacklogStats.total,
        storyPoints: bugBacklogStats.pivot?.totals?.grand || 0,
      },
      fixedInSprint: {
        current: getBugMetrics(currentBugStats, true),
        previous: previousBugStats ? getBugMetrics(previousBugStats, true) : undefined,
      },
      notFixedInSprint: {
        current: getBugMetrics(currentBugStats, false),
        previous: previousBugStats ? getBugMetrics(previousBugStats, false) : undefined,
      },
    },
    labels: labelResults,
  };
}

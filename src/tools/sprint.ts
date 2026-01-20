import { getJiraClient } from '../jira-client.js';
import type {
  ListBoardsResult,
  GetActiveSprintResult,
  GetSprintIssuesResult,
  SprintIssuesSummary,
  JiraDocument,
} from '../types.js';
import { type Allowlist, isBoardAllowed } from '../permissions.js';
import { adfToText, extractCustomFieldValue } from './issues.js';

export async function listBoards(boardAllowlist: Allowlist): Promise<ListBoardsResult> {
  const client = getJiraClient();
  const response = await client.listBoards(0, 100);

  const filteredBoards = response.values.filter((board) =>
    isBoardAllowed(board.id, board.name, boardAllowlist)
  );

  return {
    boards: filteredBoards.map((board) => ({
      id: board.id,
      name: board.name,
      type: board.type,
      projectKey: board.location?.projectKey,
    })),
    total: filteredBoards.length,
  };
}

export async function getActiveSprint(
  boardId: number,
  boardAllowlist: Allowlist
): Promise<GetActiveSprintResult> {
  const client = getJiraClient();

  // Verify board is allowed
  const board = await client.getBoard(boardId);
  if (!isBoardAllowed(board.id, board.name, boardAllowlist)) {
    throw new Error(`Board not found: ${boardId}`);
  }

  const response = await client.getActiveSprint(boardId);

  if (response.values.length === 0) {
    return { sprint: null };
  }

  const sprint = response.values[0];
  return {
    sprint: {
      id: sprint.id,
      name: sprint.name,
      state: sprint.state,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      goal: sprint.goal,
    },
  };
}

// Standard fields that can be requested
export type SprintIssueField = 'key' | 'summary' | 'status' | 'statusCategory' | 'assignee' | 'priority' | 'type' | 'description' | 'labels' | 'customFields';

// Default fields returned when no filter is specified
const DEFAULT_SPRINT_ISSUE_FIELDS: SprintIssueField[] = ['key', 'summary', 'status', 'statusCategory', 'assignee', 'priority'];

/**
 * Build a filtered issue object based on requested fields.
 */
function buildFilteredIssue(
  issue: { key: string; fields: Record<string, unknown> },
  requestedFields: SprintIssueField[],
  fieldNames?: Record<string, string>
): SprintIssuesSummary {
  const result: SprintIssuesSummary = { key: issue.key };
  const fields = issue.fields;
  const status = fields.status as { name: string; statusCategory: { name: string } };

  for (const field of requestedFields) {
    switch (field) {
      case 'key':
        // Always included
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
      case 'priority': {
        const priority = fields.priority as { name: string } | null;
        result.priority = priority?.name;
        break;
      }
      case 'type': {
        const issuetype = fields.issuetype as { name: string };
        result.type = issuetype.name;
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
}

export async function getSprintIssues(
  sprintId: number,
  maxResults = 50,
  boardAllowlist: Allowlist,
  requestedFields?: SprintIssueField[]
): Promise<GetSprintIssuesResult> {
  const client = getJiraClient();

  // Verify sprint's board is allowed
  const sprint = await client.getSprint(sprintId);
  const board = await client.getBoard(sprint.originBoardId);
  if (!isBoardAllowed(board.id, board.name, boardAllowlist)) {
    throw new Error(`Sprint not found: ${sprintId}`);
  }

  const fieldsToReturn = requestedFields ?? DEFAULT_SPRINT_ISSUE_FIELDS;
  const needsCustomFields = fieldsToReturn.includes('customFields');
  const needsDescription = fieldsToReturn.includes('description');
  const needsType = fieldsToReturn.includes('type');
  const needsLabels = fieldsToReturn.includes('labels');

  // Build list of JIRA fields to request
  const jiraFields = ['summary', 'status', 'assignee', 'priority'];
  if (needsDescription) jiraFields.push('description');
  if (needsType) jiraFields.push('issuetype');
  if (needsLabels) jiraFields.push('labels');
  if (needsCustomFields) {
    jiraFields.push('*all'); // Need all fields for custom fields
  }

  // Use JQL to get sprint issues with specific fields
  const jql = `sprint = ${sprintId}`;
  const expand = needsCustomFields ? ['names'] : [];
  const response = await client.searchIssues(jql, 0, maxResults, jiraFields);

  // Get field names if custom fields are requested
  let fieldNames: Record<string, string> | undefined;
  if (needsCustomFields) {
    // Fetch one issue with expand=names to get field name mappings
    const sampleResponse = await client.getIssue(response.issues[0]?.key || '', ['names']);
    fieldNames = (sampleResponse as unknown as { names?: Record<string, string> }).names;
  }

  const issues: SprintIssuesSummary[] = response.issues.map((issue) =>
    buildFilteredIssue(issue as { key: string; fields: Record<string, unknown> }, fieldsToReturn, fieldNames)
  );

  return {
    sprintId,
    issues,
    total: response.total ?? issues.length,
  };
}

export async function getMySprintIssues(
  sprintId: number,
  maxResults = 200,
  boardAllowlist: Allowlist,
  requestedFields?: SprintIssueField[]
): Promise<GetSprintIssuesResult> {
  const client = getJiraClient();

  // Verify sprint's board is allowed
  const sprint = await client.getSprint(sprintId);
  const board = await client.getBoard(sprint.originBoardId);
  if (!isBoardAllowed(board.id, board.name, boardAllowlist)) {
    throw new Error(`Sprint not found: ${sprintId}`);
  }

  const fieldsToReturn = requestedFields ?? DEFAULT_SPRINT_ISSUE_FIELDS;
  const needsCustomFields = fieldsToReturn.includes('customFields');
  const needsDescription = fieldsToReturn.includes('description');
  const needsType = fieldsToReturn.includes('type');
  const needsLabels = fieldsToReturn.includes('labels');

  // Build list of JIRA fields to request
  const jiraFields = ['summary', 'status', 'assignee', 'priority'];
  if (needsDescription) jiraFields.push('description');
  if (needsType) jiraFields.push('issuetype');
  if (needsLabels) jiraFields.push('labels');
  if (needsCustomFields) {
    jiraFields.push('*all'); // Need all fields for custom fields
  }

  // Use JQL to filter by current user and sprint
  const jql = `sprint = ${sprintId} AND assignee = currentUser() ORDER BY status ASC, priority DESC`;
  const response = await client.searchIssues(jql, 0, maxResults, jiraFields);

  // Get field names if custom fields are requested
  let fieldNames: Record<string, string> | undefined;
  if (needsCustomFields && response.issues.length > 0) {
    const sampleResponse = await client.getIssue(response.issues[0].key, ['names']);
    fieldNames = (sampleResponse as unknown as { names?: Record<string, string> }).names;
  }

  const issues: SprintIssuesSummary[] = response.issues.map((issue) =>
    buildFilteredIssue(issue as { key: string; fields: Record<string, unknown> }, fieldsToReturn, fieldNames)
  );

  return {
    sprintId,
    issues,
    total: response.total ?? issues.length,
  };
}

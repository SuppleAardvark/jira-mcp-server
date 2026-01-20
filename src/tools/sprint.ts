import { getJiraClient } from '../jira-client.js';
import type {
  ListBoardsResult,
  GetActiveSprintResult,
  GetSprintIssuesResult,
  SprintIssuesSummary,
} from '../types.js';

export async function listBoards(): Promise<ListBoardsResult> {
  const client = getJiraClient();
  const response = await client.listBoards(0, 100);

  return {
    boards: response.values.map((board) => ({
      id: board.id,
      name: board.name,
      type: board.type,
      projectKey: board.location?.projectKey,
    })),
    total: response.total,
  };
}

export async function getActiveSprint(
  boardId: number
): Promise<GetActiveSprintResult> {
  const client = getJiraClient();
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

export async function getSprintIssues(
  sprintId: number,
  maxResults = 50
): Promise<GetSprintIssuesResult> {
  const client = getJiraClient();
  const response = await client.getSprintIssues(sprintId, 0, maxResults);

  const issues: SprintIssuesSummary[] = response.issues.map((issue) => ({
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status.name,
    statusCategory: issue.fields.status.statusCategory.name,
    assignee: issue.fields.assignee?.displayName,
    priority: issue.fields.priority?.name,
  }));

  return {
    sprintId,
    issues,
    total: response.total,
  };
}

export async function getMySprintIssues(
  sprintId: number,
  maxResults = 200
): Promise<GetSprintIssuesResult> {
  const client = getJiraClient();

  // Use JQL to filter by current user and sprint
  const jql = `sprint = ${sprintId} AND assignee = currentUser() ORDER BY status ASC, priority DESC`;
  const response = await client.searchIssues(jql, 0, maxResults, [
    'summary',
    'status',
    'assignee',
    'priority',
  ]);

  const issues: SprintIssuesSummary[] = response.issues.map((issue) => ({
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status.name,
    statusCategory: issue.fields.status.statusCategory.name,
    assignee: issue.fields.assignee?.displayName,
    priority: issue.fields.priority?.name,
  }));

  return {
    sprintId,
    issues,
    total: response.total,
  };
}

import { getJiraClient } from '../jira-client.js';
import type {
  ListBoardsResult,
  GetActiveSprintResult,
  GetSprintIssuesResult,
  SprintIssuesSummary,
} from '../types.js';
import { type Allowlist, isBoardAllowed } from '../permissions.js';

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

export async function getSprintIssues(
  sprintId: number,
  maxResults = 50,
  boardAllowlist: Allowlist
): Promise<GetSprintIssuesResult> {
  const client = getJiraClient();

  // Verify sprint's board is allowed
  const sprint = await client.getSprint(sprintId);
  const board = await client.getBoard(sprint.originBoardId);
  if (!isBoardAllowed(board.id, board.name, boardAllowlist)) {
    throw new Error(`Sprint not found: ${sprintId}`);
  }

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
  maxResults = 200,
  boardAllowlist: Allowlist
): Promise<GetSprintIssuesResult> {
  const client = getJiraClient();

  // Verify sprint's board is allowed
  const sprint = await client.getSprint(sprintId);
  const board = await client.getBoard(sprint.originBoardId);
  if (!isBoardAllowed(board.id, board.name, boardAllowlist)) {
    throw new Error(`Sprint not found: ${sprintId}`);
  }

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
    total: response.total ?? issues.length,
  };
}

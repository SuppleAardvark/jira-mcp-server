/**
 * Permission scopes for controlling which MCP tools are exposed.
 *
 * Configure via JIRA_SCOPES environment variable:
 *   JIRA_SCOPES="boards:read,sprints:read,issues:read"
 *
 * If not set or empty, all scopes are enabled (backwards compatible).
 */

export const SCOPES = {
  'boards:read': ['jira_list_boards'],
  'sprints:read': ['jira_get_active_sprint', 'jira_get_sprint_issues', 'jira_get_my_sprint_issues'],
  'issues:read': ['jira_get_issue', 'jira_search_issues', 'jira_get_transitions', 'jira_get_issue_history'],
  'issues:write': ['jira_create_issue', 'jira_update_issue', 'jira_transition_issue'],
  'comments:read': ['jira_get_issue_comments'],
  'comments:write': ['jira_add_comment'],
  'attachments:read': ['jira_list_attachments', 'jira_download_attachment'],
  'attachments:write': ['jira_upload_attachment'],
} as const;

export type Scope = keyof typeof SCOPES;

const ALL_SCOPES = Object.keys(SCOPES) as Scope[];

/**
 * Get all tool names from all scopes.
 */
function getAllToolNames(): Set<string> {
  const tools = new Set<string>();
  for (const scopeTools of Object.values(SCOPES)) {
    for (const tool of scopeTools) {
      tools.add(tool);
    }
  }
  return tools;
}

/**
 * Parse the JIRA_SCOPES environment variable and return the set of allowed tool names.
 *
 * @param envValue - The value of JIRA_SCOPES environment variable
 * @returns Set of allowed tool names
 */
export function parseScopes(envValue: string | undefined): Set<string> {
  // If not set or empty, allow all tools
  if (!envValue || envValue.trim() === '') {
    return getAllToolNames();
  }

  const requestedScopes = envValue.split(',').map(s => s.trim()).filter(s => s !== '');
  const allowedTools = new Set<string>();

  for (const scope of requestedScopes) {
    if (scope in SCOPES) {
      const tools = SCOPES[scope as Scope];
      for (const tool of tools) {
        allowedTools.add(tool);
      }
    } else {
      console.error(`Warning: Invalid scope "${scope}" ignored. Valid scopes: ${ALL_SCOPES.join(', ')}`);
    }
  }

  return allowedTools;
}

/**
 * Check if a tool is allowed based on the set of allowed tools.
 *
 * @param toolName - The name of the tool to check
 * @param allowedTools - Set of allowed tool names
 * @returns true if the tool is allowed
 */
export function isToolAllowed(toolName: string, allowedTools: Set<string>): boolean {
  return allowedTools.has(toolName);
}

/**
 * Parsed allowlist that can match by ID or name.
 */
export interface Allowlist {
  /** If null, all items are allowed */
  ids: Set<number> | null;
  names: Set<string> | null;
}

/**
 * Parse an allowlist environment variable that can contain IDs or names.
 * Returns null sets if the allowlist is not configured (meaning all allowed).
 *
 * @param envValue - Pipe-separated list of IDs or names (e.g., "123|Board Name|456")
 * @returns Allowlist with separate sets for numeric IDs and string names
 */
export function parseAllowlist(envValue: string | undefined): Allowlist {
  if (!envValue || envValue.trim() === '') {
    return { ids: null, names: null };
  }

  const ids = new Set<number>();
  const names = new Set<string>();

  const items = envValue.split('|').map(s => s.trim()).filter(s => s !== '');

  for (const item of items) {
    const asNumber = parseInt(item, 10);
    if (!isNaN(asNumber) && asNumber.toString() === item) {
      ids.add(asNumber);
    } else {
      // Case-insensitive matching for names
      names.add(item.toLowerCase());
    }
  }

  return { ids, names };
}

/**
 * Check if a board is allowed by the allowlist.
 *
 * @param boardId - The board's numeric ID
 * @param boardName - The board's name
 * @param allowlist - The parsed allowlist
 * @returns true if the board is allowed (or if no allowlist is configured)
 */
export function isBoardAllowed(
  boardId: number,
  boardName: string,
  allowlist: Allowlist
): boolean {
  // If no allowlist configured, all boards are allowed
  if (allowlist.ids === null && allowlist.names === null) {
    return true;
  }

  // Check if board matches by ID or name
  if (allowlist.ids?.has(boardId)) {
    return true;
  }
  if (allowlist.names?.has(boardName.toLowerCase())) {
    return true;
  }

  return false;
}

/**
 * Parse the issue types allowlist environment variable.
 * Returns null if not configured (meaning all types allowed).
 *
 * @param envValue - Pipe-separated list of issue type names (e.g., "Bug|Task|Story")
 * @returns Set of lowercase issue type names, or null if all allowed
 */
export function parseIssueTypesAllowlist(envValue: string | undefined): Set<string> | null {
  if (!envValue || envValue.trim() === '') {
    return null;
  }

  const types = new Set<string>();
  const items = envValue.split('|').map(s => s.trim()).filter(s => s !== '');

  for (const item of items) {
    types.add(item.toLowerCase());
  }

  return types;
}

/**
 * Check if an issue type is allowed by the allowlist.
 *
 * @param issueType - The issue type name
 * @param allowlist - The parsed allowlist (null means all allowed)
 * @returns true if the issue type is allowed
 */
export function isIssueTypeAllowed(
  issueType: string,
  allowlist: Set<string> | null
): boolean {
  if (allowlist === null) {
    return true;
  }
  return allowlist.has(issueType.toLowerCase());
}

/**
 * Parse the project allowlist environment variable.
 * Returns null if not configured (meaning all projects allowed).
 *
 * @param envValue - Pipe-separated list of project keys (e.g., "PROJ|DEV|OPS")
 * @returns Set of uppercase project keys, or null if all allowed
 */
export function parseProjectAllowlist(envValue: string | undefined): Set<string> | null {
  if (!envValue || envValue.trim() === '') {
    return null;
  }

  const projects = new Set<string>();
  const items = envValue.split('|').map(s => s.trim()).filter(s => s !== '');

  for (const item of items) {
    // Project keys are typically uppercase
    projects.add(item.toUpperCase());
  }

  return projects;
}

/**
 * Check if a project is allowed by the allowlist.
 *
 * @param projectKey - The project key (e.g., "PROJ")
 * @param allowlist - The parsed allowlist (null means all allowed)
 * @returns true if the project is allowed
 */
export function isProjectAllowed(
  projectKey: string,
  allowlist: Set<string> | null
): boolean {
  if (allowlist === null) {
    return true;
  }
  return allowlist.has(projectKey.toUpperCase());
}

/**
 * Extract project key from an issue key.
 *
 * @param issueKey - The issue key (e.g., "PROJ-123")
 * @returns The project key (e.g., "PROJ")
 */
export function getProjectFromIssueKey(issueKey: string): string {
  const match = issueKey.match(/^([A-Z][A-Z0-9]*)-\d+$/i);
  if (!match) {
    throw new Error(`Invalid issue key format: ${issueKey}`);
  }
  return match[1].toUpperCase();
}

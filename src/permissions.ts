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
  'issues:read': ['jira_get_issue', 'jira_search_issues', 'jira_get_transitions'],
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

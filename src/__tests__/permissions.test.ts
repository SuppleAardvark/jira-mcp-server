import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SCOPES,
  parseScopes,
  isToolAllowed,
  parseAllowlist,
  isBoardAllowed,
  parseIssueTypesAllowlist,
  isIssueTypeAllowed,
  type Scope,
} from '../permissions.js';

describe('SCOPES', () => {
  it('contains all expected scopes', () => {
    const expectedScopes: Scope[] = [
      'boards:read',
      'sprints:read',
      'issues:read',
      'issues:write',
      'comments:read',
      'comments:write',
      'attachments:read',
      'attachments:write',
    ];
    expect(Object.keys(SCOPES).sort()).toEqual(expectedScopes.sort());
  });

  it('boards:read contains jira_list_boards', () => {
    expect(SCOPES['boards:read']).toContain('jira_list_boards');
  });

  it('sprints:read contains sprint tools', () => {
    expect(SCOPES['sprints:read']).toContain('jira_get_active_sprint');
    expect(SCOPES['sprints:read']).toContain('jira_get_sprint_issues');
    expect(SCOPES['sprints:read']).toContain('jira_get_my_sprint_issues');
  });

  it('issues:read contains issue read tools', () => {
    expect(SCOPES['issues:read']).toContain('jira_get_issue');
    expect(SCOPES['issues:read']).toContain('jira_search_issues');
    expect(SCOPES['issues:read']).toContain('jira_get_transitions');
  });

  it('issues:write contains issue write tools', () => {
    expect(SCOPES['issues:write']).toContain('jira_create_issue');
    expect(SCOPES['issues:write']).toContain('jira_update_issue');
    expect(SCOPES['issues:write']).toContain('jira_transition_issue');
  });

  it('comments:read contains jira_get_issue_comments', () => {
    expect(SCOPES['comments:read']).toContain('jira_get_issue_comments');
  });

  it('comments:write contains jira_add_comment', () => {
    expect(SCOPES['comments:write']).toContain('jira_add_comment');
  });

  it('attachments:read contains attachment read tools', () => {
    expect(SCOPES['attachments:read']).toContain('jira_list_attachments');
    expect(SCOPES['attachments:read']).toContain('jira_download_attachment');
  });

  it('attachments:write contains jira_upload_attachment', () => {
    expect(SCOPES['attachments:write']).toContain('jira_upload_attachment');
  });
});

describe('parseScopes', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('returns all tools when envValue is undefined', () => {
    const allowed = parseScopes(undefined);
    // Should contain tools from all scopes
    expect(allowed.has('jira_list_boards')).toBe(true);
    expect(allowed.has('jira_get_active_sprint')).toBe(true);
    expect(allowed.has('jira_get_issue')).toBe(true);
    expect(allowed.has('jira_create_issue')).toBe(true);
    expect(allowed.has('jira_get_issue_comments')).toBe(true);
    expect(allowed.has('jira_add_comment')).toBe(true);
    expect(allowed.has('jira_list_attachments')).toBe(true);
    expect(allowed.has('jira_upload_attachment')).toBe(true);
  });

  it('returns all tools when envValue is empty string', () => {
    const allowed = parseScopes('');
    expect(allowed.has('jira_list_boards')).toBe(true);
    expect(allowed.has('jira_create_issue')).toBe(true);
  });

  it('returns all tools when envValue is whitespace only', () => {
    const allowed = parseScopes('   ');
    expect(allowed.has('jira_list_boards')).toBe(true);
  });

  it('parses single scope correctly', () => {
    const allowed = parseScopes('issues:read');
    expect(allowed.has('jira_get_issue')).toBe(true);
    expect(allowed.has('jira_search_issues')).toBe(true);
    expect(allowed.has('jira_get_transitions')).toBe(true);
    // Should not have tools from other scopes
    expect(allowed.has('jira_list_boards')).toBe(false);
    expect(allowed.has('jira_create_issue')).toBe(false);
  });

  it('parses multiple scopes correctly', () => {
    const allowed = parseScopes('issues:read,issues:write');
    expect(allowed.has('jira_get_issue')).toBe(true);
    expect(allowed.has('jira_create_issue')).toBe(true);
    expect(allowed.has('jira_list_boards')).toBe(false);
  });

  it('handles scopes with extra whitespace', () => {
    const allowed = parseScopes('  issues:read  ,  boards:read  ');
    expect(allowed.has('jira_get_issue')).toBe(true);
    expect(allowed.has('jira_list_boards')).toBe(true);
    expect(allowed.has('jira_add_comment')).toBe(false);
  });

  it('handles empty items in scope list', () => {
    const allowed = parseScopes('issues:read,,boards:read,');
    expect(allowed.has('jira_get_issue')).toBe(true);
    expect(allowed.has('jira_list_boards')).toBe(true);
  });

  it('logs warning for invalid scope and ignores it', () => {
    const allowed = parseScopes('issues:read,invalid:scope,boards:read');
    expect(allowed.has('jira_get_issue')).toBe(true);
    expect(allowed.has('jira_list_boards')).toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Warning: Invalid scope "invalid:scope" ignored')
    );
  });

  it('returns empty set when only invalid scopes provided', () => {
    const allowed = parseScopes('foo:bar,baz:qux');
    expect(allowed.size).toBe(0);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
  });

  it('handles all scopes combined', () => {
    const allScopes = Object.keys(SCOPES).join(',');
    const allowed = parseScopes(allScopes);
    // Count all unique tools
    const allTools = new Set<string>();
    for (const tools of Object.values(SCOPES)) {
      for (const tool of tools) {
        allTools.add(tool);
      }
    }
    expect(allowed.size).toBe(allTools.size);
  });
});

describe('isToolAllowed', () => {
  it('returns true for tool in allowed set', () => {
    const allowed = new Set(['jira_get_issue', 'jira_list_boards']);
    expect(isToolAllowed('jira_get_issue', allowed)).toBe(true);
    expect(isToolAllowed('jira_list_boards', allowed)).toBe(true);
  });

  it('returns false for tool not in allowed set', () => {
    const allowed = new Set(['jira_get_issue']);
    expect(isToolAllowed('jira_create_issue', allowed)).toBe(false);
  });

  it('returns false for empty allowed set', () => {
    const allowed = new Set<string>();
    expect(isToolAllowed('jira_get_issue', allowed)).toBe(false);
  });
});

describe('parseAllowlist', () => {
  it('returns null sets when envValue is undefined', () => {
    const result = parseAllowlist(undefined);
    expect(result.ids).toBeNull();
    expect(result.names).toBeNull();
  });

  it('returns null sets when envValue is empty', () => {
    const result = parseAllowlist('');
    expect(result.ids).toBeNull();
    expect(result.names).toBeNull();
  });

  it('returns null sets when envValue is whitespace', () => {
    const result = parseAllowlist('   ');
    expect(result.ids).toBeNull();
    expect(result.names).toBeNull();
  });

  it('parses numeric IDs correctly', () => {
    const result = parseAllowlist('123|456|789');
    expect(result.ids).toEqual(new Set([123, 456, 789]));
    expect(result.names?.size).toBe(0);
  });

  it('parses string names correctly', () => {
    const result = parseAllowlist('Project Alpha|Project Beta');
    expect(result.ids?.size).toBe(0);
    expect(result.names).toEqual(new Set(['project alpha', 'project beta']));
  });

  it('parses mixed IDs and names correctly', () => {
    const result = parseAllowlist('123|Project Alpha|456');
    expect(result.ids).toEqual(new Set([123, 456]));
    expect(result.names).toEqual(new Set(['project alpha']));
  });

  it('handles whitespace around items', () => {
    const result = parseAllowlist('  123  |  Project Alpha  ');
    expect(result.ids).toEqual(new Set([123]));
    expect(result.names).toEqual(new Set(['project alpha']));
  });

  it('handles empty items in list', () => {
    const result = parseAllowlist('123||456|');
    expect(result.ids).toEqual(new Set([123, 456]));
  });

  it('handles names containing commas', () => {
    const result = parseAllowlist('Project Alpha, Beta|Other Board');
    expect(result.names).toEqual(new Set(['project alpha, beta', 'other board']));
  });
});

describe('isBoardAllowed', () => {
  it('returns true when allowlist has null sets (no restrictions)', () => {
    const allowlist = { ids: null, names: null };
    expect(isBoardAllowed(123, 'Any Board', allowlist)).toBe(true);
  });

  it('returns true when board ID matches', () => {
    const allowlist = { ids: new Set([123, 456]), names: new Set<string>() };
    expect(isBoardAllowed(123, 'Some Board', allowlist)).toBe(true);
    expect(isBoardAllowed(456, 'Other Board', allowlist)).toBe(true);
  });

  it('returns true when board name matches (case-insensitive)', () => {
    const allowlist = { ids: new Set<number>(), names: new Set(['project alpha']) };
    expect(isBoardAllowed(999, 'Project Alpha', allowlist)).toBe(true);
    expect(isBoardAllowed(999, 'PROJECT ALPHA', allowlist)).toBe(true);
    expect(isBoardAllowed(999, 'project alpha', allowlist)).toBe(true);
  });

  it('returns false when board does not match', () => {
    const allowlist = { ids: new Set([123]), names: new Set(['project alpha']) };
    expect(isBoardAllowed(999, 'Project Beta', allowlist)).toBe(false);
  });

  it('returns true when either ID or name matches', () => {
    const allowlist = { ids: new Set([123]), names: new Set(['project beta']) };
    expect(isBoardAllowed(123, 'Project Alpha', allowlist)).toBe(true);
    expect(isBoardAllowed(999, 'Project Beta', allowlist)).toBe(true);
  });
});

describe('parseIssueTypesAllowlist', () => {
  it('returns null when envValue is undefined', () => {
    expect(parseIssueTypesAllowlist(undefined)).toBeNull();
  });

  it('returns null when envValue is empty', () => {
    expect(parseIssueTypesAllowlist('')).toBeNull();
  });

  it('returns null when envValue is whitespace', () => {
    expect(parseIssueTypesAllowlist('   ')).toBeNull();
  });

  it('parses issue types correctly (lowercase)', () => {
    const result = parseIssueTypesAllowlist('Bug|Task|Story');
    expect(result).toEqual(new Set(['bug', 'task', 'story']));
  });

  it('handles whitespace around items', () => {
    const result = parseIssueTypesAllowlist('  Bug  |  Task  ');
    expect(result).toEqual(new Set(['bug', 'task']));
  });

  it('handles empty items in list', () => {
    const result = parseIssueTypesAllowlist('Bug||Task|');
    expect(result).toEqual(new Set(['bug', 'task']));
  });

  it('handles types containing commas', () => {
    const result = parseIssueTypesAllowlist('Bug, Critical|Task');
    expect(result).toEqual(new Set(['bug, critical', 'task']));
  });
});

describe('isIssueTypeAllowed', () => {
  it('returns true when allowlist is null (no restrictions)', () => {
    expect(isIssueTypeAllowed('Bug', null)).toBe(true);
    expect(isIssueTypeAllowed('Any Type', null)).toBe(true);
  });

  it('returns true when issue type matches (case-insensitive)', () => {
    const allowlist = new Set(['bug', 'task']);
    expect(isIssueTypeAllowed('Bug', allowlist)).toBe(true);
    expect(isIssueTypeAllowed('BUG', allowlist)).toBe(true);
    expect(isIssueTypeAllowed('bug', allowlist)).toBe(true);
    expect(isIssueTypeAllowed('Task', allowlist)).toBe(true);
  });

  it('returns false when issue type does not match', () => {
    const allowlist = new Set(['bug', 'task']);
    expect(isIssueTypeAllowed('Story', allowlist)).toBe(false);
    expect(isIssueTypeAllowed('Epic', allowlist)).toBe(false);
  });

  it('returns false for empty allowlist', () => {
    const allowlist = new Set<string>();
    expect(isIssueTypeAllowed('Bug', allowlist)).toBe(false);
  });
});

// JIRA API Response Types

export interface JiraBoard {
  id: number;
  name: string;
  type: 'scrum' | 'kanban' | 'simple';
  location?: {
    projectId: number;
    projectKey: string;
    projectName: string;
  };
}

export interface JiraBoardsResponse {
  maxResults: number;
  startAt: number;
  total: number;
  isLast: boolean;
  values: JiraBoard[];
}

export interface JiraSprint {
  id: number;
  self: string;
  state: 'active' | 'closed' | 'future';
  name: string;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  goal?: string;
  originBoardId: number;
}

export interface JiraSprintsResponse {
  maxResults: number;
  startAt: number;
  isLast: boolean;
  values: JiraSprint[];
}

export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  avatarUrls?: Record<string, string>;
  active: boolean;
}

export interface JiraIssueType {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
}

export interface JiraPriority {
  id: string;
  name: string;
  iconUrl?: string;
}

export interface JiraStatus {
  id: string;
  name: string;
  statusCategory: {
    id: number;
    key: string;
    name: string;
    colorName: string;
  };
}

export interface JiraComponent {
  id: string;
  name: string;
  description?: string;
}

export interface JiraAttachment {
  id: string;
  filename: string;
  author: JiraUser;
  created: string;
  size: number;
  mimeType: string;
  content: string; // URL to download
}

export interface JiraComment {
  id: string;
  author: JiraUser;
  body: string | JiraDocument;
  created: string;
  updated: string;
}

export interface JiraCommentsResponse {
  comments: JiraComment[];
  maxResults: number;
  total: number;
  startAt: number;
}

// Atlassian Document Format (ADF) - simplified
export interface JiraDocument {
  type: 'doc';
  version: number;
  content: JiraDocumentNode[];
}

export interface JiraDocumentNode {
  type: string;
  content?: JiraDocumentNode[];
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

// Parent issue reference (for subtasks and issues linked to epics)
export interface JiraParentIssue {
  id: string;
  key: string;
  self: string;
  fields: {
    summary: string;
    issuetype: JiraIssueType;
    status: JiraStatus;
  };
}

export interface JiraIssueFields {
  summary: string;
  description?: string | JiraDocument;
  issuetype: JiraIssueType;
  status: JiraStatus;
  priority?: JiraPriority;
  assignee?: JiraUser;
  reporter?: JiraUser;
  created: string;
  updated: string;
  labels: string[];
  components: JiraComponent[];
  attachment: JiraAttachment[];
  comment?: JiraCommentsResponse;
  // Parent issue (next-gen projects) or epic (via custom field)
  parent?: JiraParentIssue;
  // Custom fields (for epic link in classic projects)
  [key: string]: unknown;
}

export interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: JiraIssueFields;
}

export interface JiraSprintIssuesResponse {
  maxResults: number;
  startAt: number;
  total: number;
  issues: JiraIssue[];
}

export interface JiraSearchResponse {
  expand?: string;
  startAt?: number;
  maxResults: number;
  total?: number;
  issues: JiraIssue[];
  // New pagination fields for /search/jql endpoint
  nextPageToken?: string;
  isLast?: boolean;
}

export interface JiraTransition {
  id: string;
  name: string;
  to: JiraStatus;
  hasScreen: boolean;
  isGlobal: boolean;
  isInitial: boolean;
  isAvailable: boolean;
  isConditional: boolean;
}

export interface JiraTransitionsResponse {
  expand?: string;
  transitions: JiraTransition[];
}

// Tool input/output types
export interface ListBoardsResult {
  boards: Array<{
    id: number;
    name: string;
    type: string;
    projectKey?: string;
  }>;
  total: number;
}

export interface GetActiveSprintResult {
  sprint: {
    id: number;
    name: string;
    state: string;
    startDate?: string;
    endDate?: string;
    goal?: string;
  } | null;
}

export interface SprintIssuesSummary {
  key: string;
  summary: string;
  status: string;
  statusCategory: string;
  assignee?: string;
  priority?: string;
}

export interface GetSprintIssuesResult {
  sprintId: number;
  issues: SprintIssuesSummary[];
  total: number;
}

export interface IssueDetails {
  key: string;
  summary: string;
  description?: string;
  type: string;
  status: string;
  statusCategory: string;
  priority?: string;
  assignee?: string;
  reporter?: string;
  created: string;
  updated: string;
  labels: string[];
  components: string[];
  attachmentCount: number;
  commentCount: number;
  // Parent epic/issue info
  parent?: {
    key: string;
    summary: string;
    type: string;
  };
  // Custom fields (customfield_* mapped to their names when available)
  customFields?: Record<string, unknown>;
}

export interface CommentSummary {
  id: string;
  author: string;
  body: string;
  created: string;
}

export interface AttachmentSummary {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  created: string;
  author: string;
}

export interface CreateIssueResult {
  key: string;
  id: string;
  self: string;
}

export interface CreateIssueResponse {
  id: string;
  key: string;
  self: string;
}

// Changelog types
export interface JiraChangelogItem {
  field: string;
  fieldtype: string;
  fieldId?: string;
  from: string | null;
  fromString: string | null;
  to: string | null;
  toString: string | null;
}

export interface JiraChangelogEntry {
  id: string;
  author: JiraUser;
  created: string;
  items: JiraChangelogItem[];
}

export interface JiraChangelogResponse {
  startAt: number;
  maxResults: number;
  total: number;
  isLast: boolean;
  values: JiraChangelogEntry[];
}

export interface HistoryEntry {
  id: string;
  author: string;
  created: string;
  changes: Array<{
    field: string;
    from: string | null;
    to: string | null;
  }>;
}

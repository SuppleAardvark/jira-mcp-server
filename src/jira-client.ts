import * as fs from 'fs';
import * as path from 'path';
import type {
  JiraBoard,
  JiraBoardsResponse,
  JiraSprint,
  JiraSprintsResponse,
  JiraSprintIssuesResponse,
  JiraIssue,
  JiraSearchResponse,
  JiraCommentsResponse,
  JiraAttachment,
  JiraTransitionsResponse,
  JiraComment,
  CreateIssueResponse,
  JiraChangelogResponse,
} from './types.js';

interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export class JiraClient {
  private config: JiraConfig;

  constructor() {
    const baseUrl = process.env.JIRA_BASE_URL;
    const email = process.env.JIRA_EMAIL;
    const apiToken = process.env.JIRA_API_TOKEN;

    if (!baseUrl || !email || !apiToken) {
      throw new Error(
        'Missing JIRA configuration. Required: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN'
      );
    }

    this.config = {
      baseUrl: baseUrl.replace(/\/$/, ''), // Remove trailing slash
      email,
      apiToken,
    };
  }

  private get authHeader(): string {
    const credentials = `${this.config.email}:${this.config.apiToken}`;
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = endpoint.startsWith('http')
      ? endpoint
      : `${this.config.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `JIRA API error: ${response.status} ${response.statusText}\n${errorBody}`
      );
    }

    // Handle 204 No Content and other empty responses
    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (!text) {
      return undefined as T;
    }

    return JSON.parse(text) as T;
  }

  private async requestBinary(endpoint: string): Promise<Buffer> {
    const url = endpoint.startsWith('http')
      ? endpoint
      : `${this.config.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      headers: {
        Authorization: this.authHeader,
        Accept: '*/*',
      },
    });

    if (!response.ok) {
      throw new Error(
        `JIRA API error: ${response.status} ${response.statusText}`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // Board operations
  async listBoards(
    startAt = 0,
    maxResults = 50
  ): Promise<JiraBoardsResponse> {
    return this.request<JiraBoardsResponse>(
      `/rest/agile/1.0/board?startAt=${startAt}&maxResults=${maxResults}`
    );
  }

  async getBoard(boardId: number): Promise<JiraBoard> {
    return this.request<JiraBoard>(`/rest/agile/1.0/board/${boardId}`);
  }

  // Sprint operations
  async getSprint(sprintId: number): Promise<JiraSprint> {
    return this.request<JiraSprint>(`/rest/agile/1.0/sprint/${sprintId}`);
  }

  async getSprintsForBoard(
    boardId: number,
    state?: 'active' | 'future' | 'closed',
    startAt = 0,
    maxResults = 50
  ): Promise<JiraSprintsResponse> {
    let url = `/rest/agile/1.0/board/${boardId}/sprint?startAt=${startAt}&maxResults=${maxResults}`;
    if (state) {
      url += `&state=${state}`;
    }
    return this.request<JiraSprintsResponse>(url);
  }

  async getActiveSprint(boardId: number): Promise<JiraSprintsResponse> {
    return this.getSprintsForBoard(boardId, 'active', 0, 1);
  }

  async getSprintIssues(
    sprintId: number,
    startAt = 0,
    maxResults = 50
  ): Promise<JiraSprintIssuesResponse> {
    return this.request<JiraSprintIssuesResponse>(
      `/rest/agile/1.0/sprint/${sprintId}/issue?startAt=${startAt}&maxResults=${maxResults}`
    );
  }

  // Issue operations
  async getIssue(
    issueKey: string,
    expand?: string[]
  ): Promise<JiraIssue> {
    let url = `/rest/api/3/issue/${issueKey}`;
    if (expand && expand.length > 0) {
      url += `?expand=${expand.join(',')}`;
    }
    return this.request<JiraIssue>(url);
  }

  async searchIssues(
    jql: string,
    startAt = 0,
    maxResults = 50,
    fields?: string[],
    nextPageToken?: string
  ): Promise<JiraSearchResponse> {
    const body: Record<string, unknown> = {
      jql,
      maxResults,
    };
    if (fields && fields.length > 0) {
      body.fields = fields;
    }
    if (nextPageToken) {
      body.nextPageToken = nextPageToken;
    }

    // Use POST for the new /search/jql endpoint (startAt is ignored, use nextPageToken)
    return this.request<JiraSearchResponse>('/rest/api/3/search/jql', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async getIssueComments(
    issueKey: string,
    startAt = 0,
    maxResults = 20
  ): Promise<JiraCommentsResponse> {
    return this.request<JiraCommentsResponse>(
      `/rest/api/3/issue/${issueKey}/comment?startAt=${startAt}&maxResults=${maxResults}`
    );
  }

  async getIssueChangelog(
    issueKey: string,
    startAt = 0,
    maxResults = 100
  ): Promise<JiraChangelogResponse> {
    return this.request<JiraChangelogResponse>(
      `/rest/api/3/issue/${issueKey}/changelog?startAt=${startAt}&maxResults=${maxResults}`
    );
  }

  // Issue mutation operations
  async updateIssue(
    issueKey: string,
    fields: Record<string, unknown>
  ): Promise<void> {
    await this.request<void>(`/rest/api/3/issue/${issueKey}`, {
      method: 'PUT',
      body: JSON.stringify({ fields }),
    });
  }

  async getTransitions(issueKey: string): Promise<JiraTransitionsResponse> {
    return this.request<JiraTransitionsResponse>(
      `/rest/api/3/issue/${issueKey}/transitions`
    );
  }

  async transitionIssue(
    issueKey: string,
    transitionId: string,
    fields?: Record<string, unknown>,
    comment?: string
  ): Promise<void> {
    const body: Record<string, unknown> = {
      transition: { id: transitionId },
    };

    if (fields) {
      body.fields = fields;
    }

    if (comment) {
      body.update = {
        comment: [
          {
            add: {
              body: {
                type: 'doc',
                version: 1,
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: comment }],
                  },
                ],
              },
            },
          },
        ],
      };
    }

    await this.request<void>(`/rest/api/3/issue/${issueKey}/transitions`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async addComment(issueKey: string, body: string): Promise<JiraComment> {
    return this.request<JiraComment>(
      `/rest/api/3/issue/${issueKey}/comment`,
      {
        method: 'POST',
        body: JSON.stringify({
          body: {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: body }],
              },
            ],
          },
        }),
      }
    );
  }

  async createIssue(fields: Record<string, unknown>): Promise<CreateIssueResponse> {
    return this.request<CreateIssueResponse>('/rest/api/3/issue', {
      method: 'POST',
      body: JSON.stringify({ fields }),
    });
  }

  // Attachment operations
  async getAttachment(attachmentId: string): Promise<JiraAttachment> {
    return this.request<JiraAttachment>(
      `/rest/api/3/attachment/${attachmentId}`
    );
  }

  async downloadAttachment(
    attachmentId: string,
    outputPath: string
  ): Promise<{ success: boolean; path: string; size: number }> {
    // First get attachment metadata
    const attachment = await this.getAttachment(attachmentId);

    // Download the content
    const buffer = await this.requestBinary(attachment.content);

    // Ensure output directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write to file
    fs.writeFileSync(outputPath, buffer);

    return {
      success: true,
      path: outputPath,
      size: buffer.length,
    };
  }

  // Field metadata
  async getFields(): Promise<Array<{
    id: string;
    name: string;
    custom: boolean;
    searchable?: boolean;
    navigable?: boolean;
    schema?: {
      type: string;
      items?: string;
      custom?: string;
      customId?: number;
    };
  }>> {
    return this.request<Array<{
      id: string;
      name: string;
      custom: boolean;
      searchable?: boolean;
      navigable?: boolean;
      schema?: {
        type: string;
        items?: string;
        custom?: string;
        customId?: number;
      };
    }>>('/rest/api/3/field');
  }

  // Get all labels
  async getLabels(startAt = 0, maxResults = 1000): Promise<{
    values: string[];
    total: number;
    isLast: boolean;
  }> {
    return this.request<{
      values: string[];
      total: number;
      isLast: boolean;
    }>(`/rest/api/3/label?startAt=${startAt}&maxResults=${maxResults}`);
  }

  // Get all priorities
  async getPriorities(): Promise<Array<{
    id: string;
    name: string;
    description?: string;
    iconUrl?: string;
  }>> {
    return this.request<Array<{
      id: string;
      name: string;
      description?: string;
      iconUrl?: string;
    }>>('/rest/api/3/priority');
  }

  // Get all statuses
  async getStatuses(): Promise<Array<{
    id: string;
    name: string;
    description?: string;
    statusCategory: {
      id: number;
      key: string;
      name: string;
    };
  }>> {
    return this.request<Array<{
      id: string;
      name: string;
      description?: string;
      statusCategory: {
        id: number;
        key: string;
        name: string;
      };
    }>>('/rest/api/3/status');
  }

  // Get all issue types
  async getIssueTypes(): Promise<Array<{
    id: string;
    name: string;
    description?: string;
    subtask: boolean;
  }>> {
    return this.request<Array<{
      id: string;
      name: string;
      description?: string;
      subtask: boolean;
    }>>('/rest/api/3/issuetype');
  }

  // Get all resolutions
  async getResolutions(): Promise<Array<{
    id: string;
    name: string;
    description?: string;
  }>> {
    return this.request<Array<{
      id: string;
      name: string;
      description?: string;
    }>>('/rest/api/3/resolution');
  }

  // Get components for a project
  async getProjectComponents(projectKey: string): Promise<Array<{
    id: string;
    name: string;
    description?: string;
    lead?: { displayName: string; accountId: string };
  }>> {
    return this.request<Array<{
      id: string;
      name: string;
      description?: string;
      lead?: { displayName: string; accountId: string };
    }>>(`/rest/api/3/project/${projectKey}/components`);
  }

  // Get issue types available for creating issues in a project
  async getProjectIssueTypes(
    projectKey: string
  ): Promise<Array<{ id: string; name: string }>> {
    const result = await this.request<{
      issueTypes: Array<{ id: string; name: string }>;
    }>(`/rest/api/3/issue/createmeta/${projectKey}/issuetypes`);
    return result.issueTypes;
  }

  // Get fields available for creating issues in a project/issue type
  async getCreateMeta(
    projectKey: string,
    issueTypeId?: string
  ): Promise<{
    fields: Record<string, {
      required: boolean;
      name: string;
      fieldId: string;
      schema: {
        type: string;
        items?: string;
        custom?: string;
        customId?: number;
      };
      allowedValues?: Array<{ id: string; name: string; value?: string }>;
    }>;
  }> {
    // First get issue types for the project
    if (!issueTypeId) {
      const projectMeta = await this.request<{
        issueTypes: Array<{ id: string; name: string }>;
      }>(`/rest/api/3/issue/createmeta/${projectKey}/issuetypes`);
      // Use first issue type if not specified
      issueTypeId = projectMeta.issueTypes[0]?.id;
    }

    if (!issueTypeId) {
      throw new Error(`No issue types found for project ${projectKey}`);
    }

    return this.request<{
      fields: Record<string, {
        required: boolean;
        name: string;
        fieldId: string;
        schema: {
          type: string;
          items?: string;
          custom?: string;
          customId?: number;
        };
        allowedValues?: Array<{ id: string; name: string; value?: string }>;
      }>;
    }>(`/rest/api/3/issue/createmeta/${projectKey}/issuetypes/${issueTypeId}`);
  }

  async uploadAttachment(
    issueKey: string,
    filePath: string
  ): Promise<JiraAttachment[]> {
    const url = `${this.config.baseUrl}/rest/api/3/issue/${issueKey}/attachments`;

    // Read file and get metadata
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileBuffer = fs.readFileSync(filePath);
    const filename = path.basename(filePath);

    // Create form data with the file
    const boundary = `----FormBoundary${Date.now()}`;
    const crlf = '\r\n';

    const formDataParts = [
      `--${boundary}${crlf}`,
      `Content-Disposition: form-data; name="file"; filename="${filename}"${crlf}`,
      `Content-Type: application/octet-stream${crlf}${crlf}`,
    ];

    const formDataEnd = `${crlf}--${boundary}--${crlf}`;

    // Combine parts into a single buffer
    const formDataStart = Buffer.from(formDataParts.join(''), 'utf-8');
    const formDataEndBuffer = Buffer.from(formDataEnd, 'utf-8');
    const body = Buffer.concat([formDataStart, fileBuffer, formDataEndBuffer]);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'X-Atlassian-Token': 'no-check',
        Accept: 'application/json',
      },
      body,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `JIRA API error: ${response.status} ${response.statusText}\n${errorBody}`
      );
    }

    return response.json() as Promise<JiraAttachment[]>;
  }
}

// Singleton instance
let clientInstance: JiraClient | null = null;

export function getJiraClient(): JiraClient {
  if (!clientInstance) {
    clientInstance = new JiraClient();
  }
  return clientInstance;
}

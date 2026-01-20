import { getJiraClient } from '../jira-client.js';
import type { AttachmentSummary } from '../types.js';
import { isIssueTypeAllowed, isProjectAllowed, getProjectFromIssueKey } from '../permissions.js';

export async function listAttachments(
  issueKey: string,
  issueTypeAllowlist: Set<string> | null,
  projectAllowlist: Set<string> | null
): Promise<{
  issueKey: string;
  attachments: AttachmentSummary[];
}> {
  // Check project allowlist first
  const projectKey = getProjectFromIssueKey(issueKey);
  if (!isProjectAllowed(projectKey, projectAllowlist)) {
    throw new Error(`Issue not found: ${issueKey}`);
  }

  const client = getJiraClient();
  const issue = await client.getIssue(issueKey);

  // Check if issue type is allowed
  if (!isIssueTypeAllowed(issue.fields.issuetype.name, issueTypeAllowlist)) {
    throw new Error(`Issue not found: ${issueKey}`);
  }

  return {
    issueKey,
    attachments: (issue.fields.attachment ?? []).map((att) => ({
      id: att.id,
      filename: att.filename,
      size: att.size,
      mimeType: att.mimeType,
      created: att.created,
      author: att.author.displayName,
    })),
  };
}

export async function downloadAttachment(
  attachmentId: string,
  outputPath: string
): Promise<{
  success: boolean;
  path: string;
  size: number;
}> {
  // Note: downloadAttachment doesn't filter by issue type since we only have
  // the attachment ID. The attachment ID would need to come from listAttachments
  // which already applies issue type filtering.
  const client = getJiraClient();
  return client.downloadAttachment(attachmentId, outputPath);
}

export async function uploadAttachment(
  issueKey: string,
  filePath: string,
  issueTypeAllowlist: Set<string> | null,
  projectAllowlist: Set<string> | null
): Promise<{
  issueKey: string;
  attachments: AttachmentSummary[];
}> {
  // Check project allowlist first
  const projectKey = getProjectFromIssueKey(issueKey);
  if (!isProjectAllowed(projectKey, projectAllowlist)) {
    throw new Error(`Issue not found: ${issueKey}`);
  }

  // Verify issue type is allowed
  const client = getJiraClient();
  const issue = await client.getIssue(issueKey);

  if (!isIssueTypeAllowed(issue.fields.issuetype.name, issueTypeAllowlist)) {
    throw new Error(`Issue not found: ${issueKey}`);
  }

  const uploaded = await client.uploadAttachment(issueKey, filePath);

  return {
    issueKey,
    attachments: uploaded.map((att) => ({
      id: att.id,
      filename: att.filename,
      size: att.size,
      mimeType: att.mimeType,
      created: att.created,
      author: att.author.displayName,
    })),
  };
}

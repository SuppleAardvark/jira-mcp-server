import { getJiraClient } from '../jira-client.js';
import type { AttachmentSummary } from '../types.js';

export async function listAttachments(
  issueKey: string
): Promise<{
  issueKey: string;
  attachments: AttachmentSummary[];
}> {
  const client = getJiraClient();
  const issue = await client.getIssue(issueKey);

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
  const client = getJiraClient();
  return client.downloadAttachment(attachmentId, outputPath);
}

export async function uploadAttachment(
  issueKey: string,
  filePath: string
): Promise<{
  issueKey: string;
  attachments: AttachmentSummary[];
}> {
  const client = getJiraClient();
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

import type {
  ChatMessagesListResponse,
  ChatMessage,
  CreateChatMessageRequest,
  PreparedChatAttachmentResponse
} from '../../../../src/shared/api-types.js';
import { request, requestBlob, requestUpload } from '../../shared/api/http-client.js';


// ===== Внутренний чат сотрудников (20.57.0) =====

export async function getChatMessages(
  headers: Record<string, string>,
  cursor?: string,
  limit = 50
): Promise<ChatMessagesListResponse> {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}&limit=${limit}` : `?limit=${limit}`;
  return request(`/chat/messages${qs}`, headers);
}

export async function postChatMessage(
  headers: Record<string, string>,
  body: CreateChatMessageRequest
): Promise<ChatMessage> {
  return request('/chat/messages', headers, { method: 'POST', body });
}

export async function uploadChatAttachment(
  headers: Record<string, string>,
  form: FormData
): Promise<PreparedChatAttachmentResponse> {
  return requestUpload('/chat/attachments', headers, form);
}

export async function getChatAttachment(headers: Record<string, string>, id: string): Promise<Blob> {
  return requestBlob(`/chat/attachments/${id}`, headers);
}

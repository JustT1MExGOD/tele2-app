import type {
  FaqListResponse,
  MyTicketsResponse,
  AdminTicketsListResponse,
  AdminTicketsSlaResponse,
  CreateTicketRequest,
  CreateTicketResponse,
  TicketReplyRequest,
  TicketReplyResponse
} from '../../../../src/shared/api-types.js';
import { request } from '../../shared/api/http-client.js';

export async function getSupportAdminTickets(headers: Record<string, string>): Promise<AdminTicketsSlaResponse> {
  return request('/support/admin/tickets', headers);
}

export async function getFaq(headers: Record<string, string>): Promise<FaqListResponse> {
  return request('/support/faq', headers);
}

export async function getMyTickets(headers: Record<string, string>): Promise<MyTicketsResponse> {
  return request('/support/my', headers);
}

export async function getSupportTickets(headers: Record<string, string>): Promise<AdminTicketsListResponse> {
  return request('/support/tickets', headers);
}

export async function replyTicket(
  headers: Record<string, string>,
  id: number,
  body: TicketReplyRequest
): Promise<TicketReplyResponse> {
  return request(`/support/tickets/${id}/reply`, headers, { method: 'POST', body });
}

export async function createSupportTicket(
  headers: Record<string, string>,
  body: CreateTicketRequest
): Promise<CreateTicketResponse> {
  return request('/support', headers, { method: 'POST', body });
}

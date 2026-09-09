import type {
  TasksListResponse,
  TaskDetailResponse,
  ChangeTaskStatusRequest,
  ChangeTaskStatusResponse,
  AddTaskCommentRequest,
  AddTaskCommentResponse,
  CreateTaskRequest,
  CreateTaskResponse
} from '../../../../src/shared/api-types.js';
import { request } from '../../shared/api/http-client.js';

export async function getTasks(
  headers: Record<string, string>,
  orgQuery: string
): Promise<TasksListResponse> {
  return request(`/tasks?_=1${orgQuery}`, headers);
}

export async function getTask(headers: Record<string, string>, id: number): Promise<TaskDetailResponse> {
  return request(`/tasks/${id}`, headers);
}

export async function changeTaskStatus(
  headers: Record<string, string>,
  id: number,
  body: ChangeTaskStatusRequest
): Promise<ChangeTaskStatusResponse> {
  return request(`/tasks/${id}/status`, headers, { method: 'POST', body });
}

export async function addTaskComment(
  headers: Record<string, string>,
  id: number,
  body: AddTaskCommentRequest
): Promise<AddTaskCommentResponse> {
  return request(`/tasks/${id}/comments`, headers, { method: 'POST', body });
}

export async function createTask(
  headers: Record<string, string>,
  body: CreateTaskRequest
): Promise<CreateTaskResponse | { ok: true; deduped: true }> {
  return request('/tasks', headers, { method: 'POST', body });
}

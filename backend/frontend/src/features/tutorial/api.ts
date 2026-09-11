import type {
  TutorialCompleteRequest,
  AcademyProgressResponse,
  AcademyCompleteStepResponse,
  AcademyContextualStatusResponse
} from '../../../../src/shared/api-types.js';
import { request } from '../../shared/api/http-client.js';

export async function tutorialComplete(headers: Record<string, string>, body: TutorialCompleteRequest): Promise<unknown> {
  return request('/me/tutorial-complete', headers, { method: 'POST', body });
}

// ===== T2 Academy =====

export async function getAcademyProgress(headers: Record<string, string>): Promise<AcademyProgressResponse> {
  return request('/academy/progress', headers);
}

export async function completeAcademyStep(headers: Record<string, string>, stepId: string): Promise<AcademyCompleteStepResponse> {
  return request('/academy/progress/complete-step', headers, { method: 'POST', body: { step_id: stepId } });
}

export async function getAcademyContextualStatus(headers: Record<string, string>, contextId: string): Promise<AcademyContextualStatusResponse> {
  return request(`/academy/contextual/${encodeURIComponent(contextId)}`, headers);
}

export async function dismissAcademyContextual(headers: Record<string, string>, contextId: string): Promise<{ ok: true }> {
  return request('/academy/contextual/dismiss', headers, { method: 'POST', body: { context_id: contextId } });
}

import type {
  TutorialCompleteRequest
} from '../../../../src/shared/api-types.js';
import { request } from '../../shared/api/http-client.js';

export async function tutorialComplete(headers: Record<string, string>, body: TutorialCompleteRequest): Promise<unknown> {
  return request('/me/tutorial-complete', headers, { method: 'POST', body });
}

import type {
  CommandCenterResponse,
  WhatIfRequest,
  WhatIfResponse,
  WhatIfApplyResponse
} from '../../../../src/shared/api-types.js';
import { request } from '../../shared/api/http-client.js';

export async function getCommandCenter(
  headers: Record<string, string>,
  orgQuery: string
): Promise<CommandCenterResponse> {
  return request(`/command-center?_=1${orgQuery}`, headers);
}

export async function runWhatIf(headers: Record<string, string>, body: WhatIfRequest): Promise<WhatIfResponse> {
  return request('/schedule/what-if', headers, { method: 'POST', body });
}

export async function applyWhatIf(headers: Record<string, string>, body: WhatIfRequest): Promise<WhatIfApplyResponse> {
  return request('/schedule/what-if/apply', headers, { method: 'POST', body });
}

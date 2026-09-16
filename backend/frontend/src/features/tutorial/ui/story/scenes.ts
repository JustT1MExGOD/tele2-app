/**
 * Step → illustrated scene mapping. Chapter 1 ("employee-ch1-*") is the
 * fully hand-composed representative episode (§ brief step 5) — every
 * other step id/kind falls back to a generic-but-sensible scene so the
 * rest of the course still renders coherently until it's explicitly
 * ported in a later pass (see final report).
 */
import type { AcademyStep, AcademyStepKind } from '../../model/types.js';
import {
  sceneShopExterior,
  sceneShopInterior,
  sceneStoreCloseup,
  sceneRoute,
  sceneCelebration
} from './illustrations.js';
import type { ScenePose } from './illustrations.js';

export type SceneId = 'exterior' | 'interior' | 'closeup' | 'route' | 'celebration';

export interface SceneDescriptor {
  id: SceneId;
  markup: string;
  employee: 'hidden' | 'idle' | 'walk';
  customer: boolean;
  arbPose: ScenePose;
}

const SCENE_BUILDERS: Record<SceneId, () => string> = {
  exterior: sceneShopExterior,
  interior: sceneShopInterior,
  closeup: sceneStoreCloseup,
  route: sceneRoute,
  celebration: sceneCelebration
};

/** Explicit per-step overrides for the fully polished Chapter 1 episode. */
const STEP_SCENES: Record<string, { scene: SceneId; employee: SceneDescriptor['employee']; arbPose: ScenePose }> = {
  'employee-ch1-welcome': { scene: 'exterior', employee: 'walk', arbPose: 'wave' },
  'employee-ch1-story': { scene: 'interior', employee: 'idle', arbPose: 'talk' },
  'employee-ch1-discover-store': { scene: 'closeup', employee: 'hidden', arbPose: 'point' },
  'employee-ch1-practice-replacement': { scene: 'route', employee: 'idle', arbPose: 'think' },
  'employee-ch1-complete': { scene: 'celebration', employee: 'hidden', arbPose: 'celebrate' }
};

const CUE_POSE: Partial<Record<string, ScenePose>> = {
  idle: 'idle', enter: 'enter', talking: 'talk', explaining: 'talk', pointing: 'point',
  thinking: 'think', waiting: 'idle', celebrating: 'celebrate', success: 'success',
  mistake: 'mistake', hint: 'think', surprised: 'talk', 'chapter-complete': 'celebrate'
};

function fallbackForKind(kind: AcademyStepKind): { scene: SceneId; employee: SceneDescriptor['employee'] } {
  switch (kind) {
    case 'discover': return { scene: 'closeup', employee: 'hidden' };
    case 'practice':
    case 'challenge': return { scene: 'route', employee: 'idle' };
    case 'quiz': return { scene: 'interior', employee: 'hidden' };
    default: return { scene: 'interior', employee: 'idle' };
  }
}

export function sceneForStep(step: AcademyStep): SceneDescriptor {
  const explicit = STEP_SCENES[step.id];
  const fallback = fallbackForKind(step.kind);
  const sceneId = explicit?.scene ?? fallback.scene;
  const employee = explicit?.employee ?? fallback.employee;
  const arbPose = explicit?.arbPose ?? CUE_POSE[step.cue ?? 'idle'] ?? 'idle';
  return {
    id: sceneId,
    markup: SCENE_BUILDERS[sceneId](),
    employee,
    customer: false,
    arbPose
  };
}

export const idleJourneyScene: SceneDescriptor = {
  id: 'exterior',
  markup: sceneShopExterior(),
  employee: 'idle',
  customer: false,
  arbPose: 'idle'
};

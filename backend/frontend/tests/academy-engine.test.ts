/**
 * T2 Academy — pure step-runner state machine (no DOM, no network).
 */
import { describe, it, expect } from 'vitest';
import { TutorialEngine } from '../src/features/tutorial/engine/tutorial-engine.js';
import type { AcademyCourse } from '../src/features/tutorial/model/types.js';

function makeCourse(): AcademyCourse {
  return {
    id: 'test-course',
    role: 'employee',
    title: 'Test',
    chapters: [
      {
        id: 'ch1',
        title: 'Chapter 1',
        steps: [
          { id: 'ch1-story', kind: 'story', say: 'Hi' },
          { id: 'ch1-discover', kind: 'discover', targetId: 'x' },
          { id: 'ch1-practice', kind: 'practice', targetId: 'y' },
          { id: 'ch1-quiz', kind: 'quiz', quiz: { question: 'Q?', options: ['A', 'B'], correctIndex: 1 } },
          { id: 'ch1-complete', kind: 'cutscene' }
        ]
      }
    ]
  };
}

describe('TutorialEngine', () => {
  it('story/cutscene steps can always advance', () => {
    const engine = new TutorialEngine(makeCourse());
    expect(engine.getStep().id).toBe('ch1-story');
    expect(engine.canAdvance()).toBe(true);
  });

  it('discover/practice steps cannot advance until markRequiredActionDone() is called', () => {
    const engine = new TutorialEngine(makeCourse());
    engine.advance(); // -> discover
    expect(engine.getStep().id).toBe('ch1-discover');
    expect(engine.canAdvance()).toBe(false);
    engine.markRequiredActionDone();
    expect(engine.canAdvance()).toBe(true);
  });

  it('advance() throws if a mandatory step has not been completed — cannot bypass required practice', () => {
    const engine = new TutorialEngine(makeCourse());
    engine.advance(); // -> discover, not done
    expect(() => engine.advance()).toThrow();
  });

  it('a subsequent step resets the required-action flag — completing one step does not carry over to the next', () => {
    const engine = new TutorialEngine(makeCourse());
    engine.advance(); // -> discover
    engine.markRequiredActionDone();
    engine.advance(); // -> practice
    expect(engine.getStep().id).toBe('ch1-practice');
    expect(engine.canAdvance()).toBe(false);
  });

  it('quiz: wrong answer does not allow advancing', () => {
    const engine = new TutorialEngine(makeCourse());
    engine.advance(); engine.markRequiredActionDone();
    engine.advance(); engine.markRequiredActionDone();
    engine.advance(); // -> quiz
    expect(engine.answerQuiz(0)).toBe(false); // correctIndex is 1
    expect(engine.canAdvance()).toBe(false);
  });

  it('quiz: correct answer allows advancing', () => {
    const engine = new TutorialEngine(makeCourse());
    engine.advance(); engine.markRequiredActionDone();
    engine.advance(); engine.markRequiredActionDone();
    engine.advance(); // -> quiz
    expect(engine.answerQuiz(1)).toBe(true);
    expect(engine.canAdvance()).toBe(true);
  });

  it('isLastStepOfChapter() is true only on the final step, and advancing past it reports chapterComplete', () => {
    const engine = new TutorialEngine(makeCourse());
    expect(engine.isLastStepOfChapter()).toBe(false);
    engine.advance(); engine.markRequiredActionDone();
    engine.advance(); engine.markRequiredActionDone();
    engine.advance();
    engine.answerQuiz(1);
    engine.advance(); // -> ch1-complete (cutscene, last step)
    expect(engine.isLastStepOfChapter()).toBe(true);
    const result = engine.advance();
    expect(result.chapterComplete).toBe(true);
  });

  it('jumpToStep() restores to a specific step (pause/resume, progress restore from server) and resets required-action state', () => {
    const engine = new TutorialEngine(makeCourse());
    const ok = engine.jumpToStep('ch1-practice');
    expect(ok).toBe(true);
    expect(engine.getStep().id).toBe('ch1-practice');
    expect(engine.canAdvance()).toBe(false);
  });

  it('jumpToStep() with an unknown id returns false and does not move the engine', () => {
    const engine = new TutorialEngine(makeCourse());
    const ok = engine.jumpToStep('does-not-exist');
    expect(ok).toBe(false);
    expect(engine.getStep().id).toBe('ch1-story');
  });

  it('subscribe() fires on every state-changing call, unsubscribe stops further notifications', () => {
    const engine = new TutorialEngine(makeCourse());
    let calls = 0;
    const unsub = engine.subscribe(() => { calls += 1; });
    engine.markRequiredActionDone(); // no-op required action on a story step still emits
    expect(calls).toBe(1);
    unsub();
    engine.advance();
    expect(calls).toBe(1);
  });

  it('getStepProgress() reports the correct index/total for the current chapter', () => {
    const engine = new TutorialEngine(makeCourse());
    expect(engine.getStepProgress()).toEqual({ index: 0, total: 5 });
    engine.advance(); engine.markRequiredActionDone();
    expect(engine.getStepProgress()).toEqual({ index: 1, total: 5 });
  });
});

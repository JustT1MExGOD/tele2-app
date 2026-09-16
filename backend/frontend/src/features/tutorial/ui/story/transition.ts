/**
 * Ink-wipe scene transition (§ brief step 4 "графических масок") — a single
 * jagged SVG shape swept across the stage with GSAP, masking the old scene
 * out and the new one in. Reduced-motion collapses to an instant swap
 * (§ brief step 10), matching every other Academy animation's behavior.
 */
import { gsap } from 'gsap';
import { transitionWipeSvg } from './illustrations.js';

function reduceMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export class WipeTransition {
  private el: HTMLDivElement;

  constructor(host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'story-wipe';
    this.el.innerHTML = transitionWipeSvg();
    this.el.setAttribute('aria-hidden', 'true');
    host.appendChild(this.el);
  }

  /** Runs `swap()` at the moment the wipe fully covers the stage, then
   * reveals the new content. Resolves once the whole transition finishes. */
  async run(swap: () => void): Promise<void> {
    const shape = this.el.querySelector<SVGPathElement>('.story-wipe-shape');
    if (!shape || reduceMotion()) { swap(); return; }
    this.el.style.display = 'block';
    gsap.set(shape, { xPercent: -160 });
    await new Promise<void>((resolve) => {
      const tl = gsap.timeline({ onComplete: resolve });
      tl.to(shape, { xPercent: 0, duration: 0.42, ease: 'power2.in' })
        .add(swap)
        .to(shape, { xPercent: 160, duration: 0.46, ease: 'power2.out' }, '+=0.02');
    });
    this.el.style.display = 'none';
  }

  destroy(): void {
    gsap.killTweensOf(this.el.querySelector('.story-wipe-shape'));
    this.el.remove();
  }
}

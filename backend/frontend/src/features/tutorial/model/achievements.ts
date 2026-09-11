/** Presentation-only helpers over the server's badge/XP data — no logic
 * that decides WHETHER a reward is earned (that's server-authoritative,
 * core/academy/rewards.ts). */
export interface AcademyBadgeView {
  code: string;
  title: string;
}

export function formatXpGain(amount: number): string {
  return `+${amount} XP`;
}

export function badgeIcon(_code: string): string {
  // Single shared icon for this pass — a per-badge icon set is a later
  // asset-polish item (see final report's deferred work).
  return '🏅';
}

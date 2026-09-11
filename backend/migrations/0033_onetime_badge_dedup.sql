SET LOCAL search_path TO public;

-- Hotfix — race-condition XP/badge duplication (adversarial review).
-- employee_badges' only existing constraint is UNIQUE (employee_id,
-- badge_code, earned_at) (migrations/0001_baseline.sql) — earned_at
-- defaults to now() per row, so two concurrent requests for the SAME
-- badge basically never collide on it (different microsecond
-- timestamps), which made api/routes/analytics/insights.ts's
-- check-then-act (`hasBadge()` then `addXp()`+`grantBadge()`) a real,
-- exploitable race: N concurrent POST /me/tutorial-complete calls each
-- pass the pre-check before any of them has inserted, so N badges (and
-- N x XP) get granted instead of 1.
--
-- Badge codes are NOT uniformly one-time — 'ideal_shift'/'streak_7'/
-- 'streak_30' (core/employees/gamification.ts::evaluateShiftClose) are
-- intentionally re-earnable (listBadges() orders by earned_at DESC as a
-- history/timeline, not a flag), so a blanket UNIQUE(employee_id,
-- badge_code) would silently stop a real repeat achievement from ever
-- being recorded again. Only the genuinely one-time badges
-- ('tutorial_done'/'tutorial_mgr_done' — course completion) need real
-- dedup, so this is a PARTIAL unique index scoped to just those codes —
-- add any future one-time badge code to the WHERE list below, not a
-- schema change.
CREATE UNIQUE INDEX IF NOT EXISTS employee_badges_onetime_uq
  ON employee_badges (employee_id, badge_code)
  WHERE badge_code IN ('tutorial_done', 'tutorial_mgr_done');

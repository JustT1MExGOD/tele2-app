/**
 * Contract test for app/api-bridge.ts (20.58.0 architecture split). The
 * bridge's only job is reassembling window.apiClient from 23 capability
 * modules under features/*\/api.ts — this test is the regression guard that
 * catches a capability rename/move silently dropping (or duplicating) an
 * entry from the public surface, independent of the bridge's own source
 * (the expected list below is hardcoded from the pre-split api-client.ts,
 * not derived from the bridge itself, so a mistake made in both places at
 * once would still be caught by anything importing a name that no longer
 * exists).
 */
import { describe, it, expect } from 'vitest';
import '../src/app/api-bridge.js';

// Exact 134-name public surface of the former monolithic api-client.ts
// (128 original + resolveStore + getShiftOpenMap, both added for the
// replacement-shift feature, + getAcademyProgress/completeAcademyStep/
// getAcademyContextualStatus/dismissAcademyContextual, added for T2
// Academy), preserved verbatim by the split (see the architecture trace/plan).
const EXPECTED_KEYS = [
  'getOrgStores', 'getMetrics', 'getPromos', 'getPromoCard', 'createPromo',
  'markPromoUsed', 'keepPromo', 'getCashTable', 'saveCash', 'createMetric',
  'deleteMetric', 'sendNetworkDigest', 'getAlerts', 'changeAlertStatus',
  'getAlertsEffectiveness', 'markAlertRead', 'getTasks', 'getTask',
  'changeTaskStatus', 'addTaskComment', 'getCommandCenter', 'getEmployees',
  'createTask', 'getMe', 'bindMe', 'linkPhone', 'getMyDay', 'getSchedules',
  'getScheduleMonth', 'saveSchedulesBulk', 'getPlansTemplate',
  'getPlansEmployeesMonth', 'getPlansStoresMonth', 'getEmployeeMonthPlan',
  'saveEmployeeMonthPlan', 'getStoreDailyPlans', 'getStoreMonthPlan',
  'saveStoreMonthPlan', 'generateEmployeeMonthPlanDrafts',
  'getLatestEmployeeMonthPlanDraft', 'getEmployeeMonthPlanDraftById',
  'applyEmployeeMonthPlanDraft', 'generateScheduleDraft',
  'getScheduleDraftById', 'applyScheduleDraft', 'getStaffingRequirements',
  'saveStaffingRequirements', 'getScheduleAvailability',
  'addScheduleAvailability', 'deleteScheduleAvailability', 'getBfqList',
  'getBfqEmployee', 'saveBfqManual', 'getAccessStatus', 'getAccessOrgs',
  'getAccessDirectory', 'submitAccessRequest', 'getAccessRequests',
  'registerPhone', 'loginPhone', 'logoutPhone', 'consumePasswordReset',
  'loginMfa', 'getMfaStatus', 'mfaTotpEnroll', 'mfaTotpConfirm',
  'mfaRecoveryCodesGenerate', 'mfaTelegramVerify', 'listSessions',
  'revokeSession', 'revokeOtherSessions', 'approveAccessRequest',
  'rejectAccessRequest', 'getSupportAdminTickets', 'getSupervisorDashboard',
  'getSupervisorHealth', 'getSales', 'createSale', 'zeroSaleMetric',
  'getSalesHistory', 'openShift', 'closeShift', 'getShiftCurrent', 'getShiftOpenMap', 'resolveStore',
  'parseSalePhrase', 'quickSale', 'getFaq', 'getMyTickets',
  'getSupportTickets', 'replyTicket', 'createSupportTicket',
  'tutorialComplete', 'getAcademyProgress', 'completeAcademyStep',
  'getAcademyContextualStatus', 'dismissAcademyContextual',
  'getStatsDaily', 'getDashboard', 'getEmployeeProgress',
  'getMyInsight', 'getSelfStats', 'getBranding', 'getOrgsAdmin', 'saveOrg',
  'getAuditLog', 'getDealersTree', 'renameDealer', 'renameSector',
  'assignSupervisorSector', 'getHeatmapPrecise', 'getForecast',
  'getStaffingHints', 'getAnnouncements', 'createAnnouncement',
  'markAnnouncementRead', 'getAnnouncementReads', 'getReportDay',
  'runWhatIf', 'applyWhatIf', 'getStoreProfile', 'updateStoreDisplayName',
  'getEmployeeProfile', 'createEmployee', 'deactivateEmployee',
  'setEmployeeRole', 'createStore', 'getNetworkLive', 'uploadAvatar',
  'exportCsv', 'getChatMessages', 'postChatMessage', 'uploadChatAttachment',
  'getChatAttachment'
] as const;

describe('api-bridge (window.apiClient contract)', () => {
  it('exposes exactly the expected 134-entry public surface, no more, no fewer', () => {
    const actualKeys = Object.keys(window.apiClient);
    expect(actualKeys.length).toBe(EXPECTED_KEYS.length);
    expect([...actualKeys].sort()).toEqual([...EXPECTED_KEYS].sort());
  });

  it('has no duplicate keys in the expected list itself (guards the fixture)', () => {
    expect(new Set(EXPECTED_KEYS).size).toBe(EXPECTED_KEYS.length);
  });

  it('every entry is a callable function', () => {
    for (const key of EXPECTED_KEYS) {
      expect(typeof window.apiClient[key]).toBe('function');
    }
  });
});

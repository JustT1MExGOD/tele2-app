/**
 * Assembles the public `window.apiClient` surface from the capability-owned
 * API modules under features/&lt;name&gt;/api.ts (20.58.0 architecture split — see
 * docs/ARCHITECTURE.md). This is the Vite library-mode entry compiled to
 * api-client.bundle.js (see vite.config.ts) and loaded via <script> before
 * every classic-script page bundle, exactly as the former monolithic
 * api-client.ts was.
 *
 * Intentionally thin: every function here is a straight re-export from its
 * owning capability module. No logic, no transport code, no types beyond
 * what `declare global` needs — those all live in shared/api/http-client.ts
 * and features/&lt;name&gt;/api.ts. This file's only job is the window.apiClient
 * object literal below, so a consumer page (still calling
 * window.apiClient.xxx(), unchanged by this split) sees exactly the same
 * surface it did before.
 */

import {
  getAccessStatus,
  getAccessOrgs,
  getAccessDirectory,
  submitAccessRequest,
  getAccessRequests,
  approveAccessRequest,
  rejectAccessRequest
} from '../features/access/api.js';
import {
  getBranding,
  getOrgsAdmin,
  saveOrg,
  getAuditLog,
  getDealersTree,
  renameDealer,
  renameSector,
  assignSupervisorSector
} from '../features/admin/api.js';
import {
  getAlerts,
  changeAlertStatus,
  getAlertsEffectiveness,
  markAlertRead
} from '../features/alerts/api.js';
import {
  registerPhone,
  loginPhone,
  logoutPhone,
  consumePasswordReset,
  loginMfa,
  getMfaStatus,
  mfaTotpEnroll,
  mfaTotpConfirm,
  mfaRecoveryCodesGenerate,
  mfaTelegramVerify,
  listSessions,
  revokeSession,
  revokeOtherSessions
} from '../features/auth/api.js';
import {
  getBfqList,
  getBfqEmployee,
  saveBfqManual
} from '../features/bfq/api.js';
import {
  getMetrics,
  getCashTable,
  saveCash,
  createMetric,
  deleteMetric
} from '../features/cash-metrics/api.js';
import {
  getChatMessages,
  postChatMessage,
  uploadChatAttachment,
  getChatAttachment
} from '../features/chat/api.js';
import {
  getCommandCenter,
  runWhatIf,
  applyWhatIf
} from '../features/command-center/api.js';
import {
  generateEmployeeMonthPlanDrafts,
  getLatestEmployeeMonthPlanDraft,
  getEmployeeMonthPlanDraftById,
  applyEmployeeMonthPlanDraft
} from '../features/employee-plan-generator/api.js';
import {
  getEmployees,
  getEmployeeProgress,
  getEmployeeProfile,
  createEmployee,
  deactivateEmployee,
  setEmployeeRole
} from '../features/employees/api.js';
import {
  getMe,
  bindMe,
  linkPhone,
  getMyDay,
  getMyInsight,
  getSelfStats,
  uploadAvatar
} from '../features/me/api.js';
import {
  getPlansTemplate,
  getPlansEmployeesMonth,
  getPlansStoresMonth,
  getEmployeeMonthPlan,
  saveEmployeeMonthPlan,
  getStoreDailyPlans,
  getStoreMonthPlan,
  saveStoreMonthPlan
} from '../features/plans/api.js';
import {
  getPromos,
  getPromoCard,
  createPromo,
  markPromoUsed,
  keepPromo
} from '../features/promos/api.js';
import {
  sendNetworkDigest,
  getStatsDaily,
  getDashboard,
  getHeatmapPrecise,
  getForecast,
  getStaffingHints,
  getAnnouncements,
  createAnnouncement,
  markAnnouncementRead,
  getAnnouncementReads,
  getReportDay
} from '../features/reports/api.js';
import {
  getSales,
  createSale,
  zeroSaleMetric,
  getSalesHistory,
  parseSalePhrase,
  quickSale
} from '../features/sales/api.js';
import {
  generateScheduleDraft,
  getScheduleDraftById,
  applyScheduleDraft,
  getStaffingRequirements,
  saveStaffingRequirements
} from '../features/schedule-generator/api.js';
import {
  getSchedules,
  getScheduleMonth,
  saveSchedulesBulk,
  getScheduleAvailability,
  addScheduleAvailability,
  deleteScheduleAvailability
} from '../features/schedules/api.js';
import {
  openShift,
  closeShift,
  getShiftCurrent,
  resolveStore
} from '../features/shifts/api.js';
import {
  getOrgStores,
  getStoreProfile,
  updateStoreDisplayName,
  createStore,
  getNetworkLive
} from '../features/stores/api.js';
import {
  getSupervisorDashboard,
  getSupervisorHealth
} from '../features/supervisor/api.js';
import {
  getSupportAdminTickets,
  getFaq,
  getMyTickets,
  getSupportTickets,
  replyTicket,
  createSupportTicket
} from '../features/support/api.js';
import {
  getTasks,
  getTask,
  changeTaskStatus,
  addTaskComment,
  createTask
} from '../features/tasks/api.js';
import {
  tutorialComplete
} from '../features/tutorial/api.js';
import { exportCsv } from '../shared/api/http-client.js';

declare global {
  interface Window {
    apiClient: {
      getOrgStores: typeof getOrgStores;
      getMetrics: typeof getMetrics;
      getPromos: typeof getPromos;
      getPromoCard: typeof getPromoCard;
      createPromo: typeof createPromo;
      markPromoUsed: typeof markPromoUsed;
      keepPromo: typeof keepPromo;
      getCashTable: typeof getCashTable;
      saveCash: typeof saveCash;
      createMetric: typeof createMetric;
      deleteMetric: typeof deleteMetric;
      sendNetworkDigest: typeof sendNetworkDigest;
      getAlerts: typeof getAlerts;
      changeAlertStatus: typeof changeAlertStatus;
      getAlertsEffectiveness: typeof getAlertsEffectiveness;
      markAlertRead: typeof markAlertRead;
      getTasks: typeof getTasks;
      getTask: typeof getTask;
      changeTaskStatus: typeof changeTaskStatus;
      addTaskComment: typeof addTaskComment;
      getCommandCenter: typeof getCommandCenter;
      getEmployees: typeof getEmployees;
      createTask: typeof createTask;
      getMe: typeof getMe;
      bindMe: typeof bindMe;
      linkPhone: typeof linkPhone;
      getMyDay: typeof getMyDay;
      getSchedules: typeof getSchedules;
      getScheduleMonth: typeof getScheduleMonth;
      saveSchedulesBulk: typeof saveSchedulesBulk;
      getPlansTemplate: typeof getPlansTemplate;
      getPlansEmployeesMonth: typeof getPlansEmployeesMonth;
      getPlansStoresMonth: typeof getPlansStoresMonth;
      getEmployeeMonthPlan: typeof getEmployeeMonthPlan;
      saveEmployeeMonthPlan: typeof saveEmployeeMonthPlan;
      getStoreDailyPlans: typeof getStoreDailyPlans;
      getStoreMonthPlan: typeof getStoreMonthPlan;
      saveStoreMonthPlan: typeof saveStoreMonthPlan;
      generateEmployeeMonthPlanDrafts: typeof generateEmployeeMonthPlanDrafts;
      getLatestEmployeeMonthPlanDraft: typeof getLatestEmployeeMonthPlanDraft;
      getEmployeeMonthPlanDraftById: typeof getEmployeeMonthPlanDraftById;
      applyEmployeeMonthPlanDraft: typeof applyEmployeeMonthPlanDraft;
      generateScheduleDraft: typeof generateScheduleDraft;
      getScheduleDraftById: typeof getScheduleDraftById;
      applyScheduleDraft: typeof applyScheduleDraft;
      getStaffingRequirements: typeof getStaffingRequirements;
      saveStaffingRequirements: typeof saveStaffingRequirements;
      getScheduleAvailability: typeof getScheduleAvailability;
      addScheduleAvailability: typeof addScheduleAvailability;
      deleteScheduleAvailability: typeof deleteScheduleAvailability;
      getBfqList: typeof getBfqList;
      getBfqEmployee: typeof getBfqEmployee;
      saveBfqManual: typeof saveBfqManual;
      getAccessStatus: typeof getAccessStatus;
      getAccessOrgs: typeof getAccessOrgs;
      getAccessDirectory: typeof getAccessDirectory;
      submitAccessRequest: typeof submitAccessRequest;
      getAccessRequests: typeof getAccessRequests;
      registerPhone: typeof registerPhone;
      loginPhone: typeof loginPhone;
      logoutPhone: typeof logoutPhone;
      consumePasswordReset: typeof consumePasswordReset;
      loginMfa: typeof loginMfa;
      getMfaStatus: typeof getMfaStatus;
      mfaTotpEnroll: typeof mfaTotpEnroll;
      mfaTotpConfirm: typeof mfaTotpConfirm;
      mfaRecoveryCodesGenerate: typeof mfaRecoveryCodesGenerate;
      mfaTelegramVerify: typeof mfaTelegramVerify;
      listSessions: typeof listSessions;
      revokeSession: typeof revokeSession;
      revokeOtherSessions: typeof revokeOtherSessions;
      approveAccessRequest: typeof approveAccessRequest;
      rejectAccessRequest: typeof rejectAccessRequest;
      getSupportAdminTickets: typeof getSupportAdminTickets;
      getSupervisorDashboard: typeof getSupervisorDashboard;
      getSupervisorHealth: typeof getSupervisorHealth;
      getSales: typeof getSales;
      createSale: typeof createSale;
      zeroSaleMetric: typeof zeroSaleMetric;
      getSalesHistory: typeof getSalesHistory;
      openShift: typeof openShift;
      closeShift: typeof closeShift;
      getShiftCurrent: typeof getShiftCurrent;
      resolveStore: typeof resolveStore;
      parseSalePhrase: typeof parseSalePhrase;
      quickSale: typeof quickSale;
      getFaq: typeof getFaq;
      getMyTickets: typeof getMyTickets;
      getSupportTickets: typeof getSupportTickets;
      replyTicket: typeof replyTicket;
      createSupportTicket: typeof createSupportTicket;
      tutorialComplete: typeof tutorialComplete;
      getStatsDaily: typeof getStatsDaily;
      getDashboard: typeof getDashboard;
      getEmployeeProgress: typeof getEmployeeProgress;
      getMyInsight: typeof getMyInsight;
      getSelfStats: typeof getSelfStats;
      getBranding: typeof getBranding;
      getOrgsAdmin: typeof getOrgsAdmin;
      saveOrg: typeof saveOrg;
      getHeatmapPrecise: typeof getHeatmapPrecise;
      getForecast: typeof getForecast;
      getStaffingHints: typeof getStaffingHints;
      getAnnouncements: typeof getAnnouncements;
      createAnnouncement: typeof createAnnouncement;
      markAnnouncementRead: typeof markAnnouncementRead;
      getAnnouncementReads: typeof getAnnouncementReads;
      getReportDay: typeof getReportDay;
      runWhatIf: typeof runWhatIf;
      applyWhatIf: typeof applyWhatIf;
      getStoreProfile: typeof getStoreProfile;
      updateStoreDisplayName: typeof updateStoreDisplayName;
      getEmployeeProfile: typeof getEmployeeProfile;
      createEmployee: typeof createEmployee;
      deactivateEmployee: typeof deactivateEmployee;
      setEmployeeRole: typeof setEmployeeRole;
      createStore: typeof createStore;
      getNetworkLive: typeof getNetworkLive;
      uploadAvatar: typeof uploadAvatar;
      exportCsv: typeof exportCsv;
      getAuditLog: typeof getAuditLog;
      getDealersTree: typeof getDealersTree;
      renameDealer: typeof renameDealer;
      renameSector: typeof renameSector;
      assignSupervisorSector: typeof assignSupervisorSector;
      getChatMessages: typeof getChatMessages;
      postChatMessage: typeof postChatMessage;
      uploadChatAttachment: typeof uploadChatAttachment;
      getChatAttachment: typeof getChatAttachment;
    };
  }
}

window.apiClient = {
  getOrgStores,
  getMetrics,
  getPromos,
  getPromoCard,
  createPromo,
  markPromoUsed,
  keepPromo,
  getCashTable,
  saveCash,
  createMetric,
  deleteMetric,
  sendNetworkDigest,
  getAlerts,
  changeAlertStatus,
  getAlertsEffectiveness,
  markAlertRead,
  getTasks,
  getTask,
  changeTaskStatus,
  addTaskComment,
  getCommandCenter,
  getEmployees,
  createTask,
  getMe,
  bindMe,
  linkPhone,
  getMyDay,
  getSchedules,
  getScheduleMonth,
  saveSchedulesBulk,
  getPlansTemplate,
  getPlansEmployeesMonth,
  getPlansStoresMonth,
  getEmployeeMonthPlan,
  saveEmployeeMonthPlan,
  getStoreDailyPlans,
  getStoreMonthPlan,
  saveStoreMonthPlan,
  generateEmployeeMonthPlanDrafts,
  getLatestEmployeeMonthPlanDraft,
  getEmployeeMonthPlanDraftById,
  applyEmployeeMonthPlanDraft,
  generateScheduleDraft,
  getScheduleDraftById,
  applyScheduleDraft,
  getStaffingRequirements,
  saveStaffingRequirements,
  getScheduleAvailability,
  addScheduleAvailability,
  deleteScheduleAvailability,
  getBfqList,
  getBfqEmployee,
  saveBfqManual,
  getAccessStatus,
  getAccessOrgs,
  getAccessDirectory,
  submitAccessRequest,
  getAccessRequests,
  registerPhone,
  loginPhone,
  logoutPhone,
  consumePasswordReset,
  loginMfa,
  getMfaStatus,
  mfaTotpEnroll,
  mfaTotpConfirm,
  mfaRecoveryCodesGenerate,
  mfaTelegramVerify,
  listSessions,
  revokeSession,
  revokeOtherSessions,
  approveAccessRequest,
  rejectAccessRequest,
  getSupportAdminTickets,
  getSupervisorDashboard,
  getSupervisorHealth,
  getSales,
  createSale,
  zeroSaleMetric,
  getSalesHistory,
  openShift,
  closeShift,
  getShiftCurrent,
  resolveStore,
  parseSalePhrase,
  quickSale,
  getFaq,
  getMyTickets,
  getSupportTickets,
  replyTicket,
  createSupportTicket,
  tutorialComplete,
  getStatsDaily,
  getDashboard,
  getEmployeeProgress,
  getMyInsight,
  getSelfStats,
  getBranding,
  getOrgsAdmin,
  saveOrg,
  getHeatmapPrecise,
  getForecast,
  getStaffingHints,
  getAnnouncements,
  createAnnouncement,
  markAnnouncementRead,
  getAnnouncementReads,
  getReportDay,
  runWhatIf,
  applyWhatIf,
  getStoreProfile,
  updateStoreDisplayName,
  getEmployeeProfile,
  createEmployee,
  deactivateEmployee,
  setEmployeeRole,
  createStore,
  getNetworkLive,
  uploadAvatar,
  exportCsv,
  getAuditLog,
  getDealersTree,
  renameDealer,
  renameSector,
  assignSupervisorSector,
  getChatMessages,
  postChatMessage,
  uploadChatAttachment,
  getChatAttachment
};

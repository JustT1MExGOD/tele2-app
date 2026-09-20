package ru.t2sales.shared.api

import kotlinx.serialization.Serializable

/**
 * Hand-ported from backend/src/shared/api-types.ts. Only the shapes needed
 * for login + the read-only Reports slice (Milestone 1) — not a full port
 * of api-types.ts. Field names are kept verbatim (the source mixes
 * snake_case and camelCase, so no blanket naming strategy is applied).
 */

@Serializable
data class LoginRequest(
    val phone: String,
    val password: String
)

@Serializable
data class LoginResponse(
    val ok: Boolean = true,
    val mfa_required: Boolean? = null,
    val mfa_token: String? = null,
    val mfa_methods: List<String>? = null
)

@Serializable
data class LoginMfaRequest(
    val mfa_token: String,
    val method: String,
    val code: String? = null
)

@Serializable
data class MeResponse(
    val bound: Boolean,
    val employee_id: Int? = null,
    val full_name: String? = null,
    val role: String? = null,
    val org_id: String? = null,
    val phone: String? = null,
    val is_manager: Boolean? = null,
    val mfa_enrollment_required: Boolean? = null,
    val mfa_reverification_required: Boolean? = null
)

@Serializable
data class ApiErrorBody(
    val error: String? = null,
    val message: String? = null
)

@Serializable
data class DashboardLeaderRow(
    val employee_id: Int,
    val full_name: String,
    val sim: Double,
    val mnp: Double,
    val pa: Double,
    val combo: Double,
    val phones: Double,
    val accessories: Double,
    val score: Double
)

@Serializable
data class DashboardPeriod(
    val from: String? = null,
    val to: String
)

@Serializable
data class DashboardResponse(
    val top: List<DashboardLeaderRow>,
    val top7: List<DashboardLeaderRow>,
    val period: DashboardPeriod
)

@Serializable
data class AnnouncementItem(
    val id: Int,
    val title: String,
    val body: String,
    val required: Boolean,
    val is_read: Boolean,
    val created_at: String
)

typealias AnnouncementsListResponse = List<AnnouncementItem>

// StatsDailyRow (backend api-types.ts) is a dynamic metrics map merged with
// store_id/name/code — modeled as a raw JsonObject in HttpClient.kt call
// sites rather than a fixed data class, since the metric set is driven by
// the metrics catalog and isn't fixed at compile time.

@Serializable
data class OutcomeBucket(
    val recovered: Int = 0,
    val still_missed: Int? = null,
    val recurred: Int? = null
)

@Serializable
data class AlertTypeEffectiveness(
    val with_task: OutcomeBucket,
    val without_task: OutcomeBucket,
    val total: Int,
    val open_rate: Double? = null,
    val dismissed_rate: Double? = null,
    val false_positive_rate: Double? = null,
    val recovery_rate_with_task: Double? = null,
    val recovery_rate_without_task: Double? = null
)

@Serializable
data class EffectivenessSummaryResponse(
    val plan_miss_projected: AlertTypeEffectiveness,
    val anomaly_vs_forecast: AlertTypeEffectiveness
)

// ---------- Home screen (GET /me/day, GET /supervisor/health) ----------
// Hand-ported subsets of MeDayResponse/TaskItem/SupervisorHealthResponse
// (backend api-types.ts) — only the fields the read-only Home screen
// renders. ignoreUnknownKeys=true (HttpClient.kt) means the extra fields
// the real responses carry are simply dropped, not an error.

@Serializable
data class ShiftSummary(
    val store_id: String? = null,
    val store_name: String? = null,
    val store_code: String? = null,
    val store_address: String? = null,
    val shift_text: String? = null,
    val hours: Double? = null
)

@Serializable
data class DayProgressEntry(
    val fact: Double = 0.0,
    val plan: Double = 0.0,
    val pct: Double = 0.0
)

@Serializable
data class DayTotal(
    val fact: Double = 0.0,
    val plan: Double = 0.0,
    val pct: Double = 0.0
)

@Serializable
data class TaskItem(
    val id: Int,
    val title: String,
    val status: String,
    val store_name: String? = null,
    val due_at: String? = null
)

@Serializable
data class MeDayResponse(
    val bound: Boolean,
    val message: String? = null,
    val shift: ShiftSummary? = null,
    val total: DayTotal? = null,
    val progress: Map<String, DayProgressEntry>? = null,
    val tasks: List<TaskItem>? = null
)

@Serializable
data class CommandCenterDrop(
    val severity: String? = null,
    val store_name: String? = null,
    val message: String? = null,
    val ai_comment: String? = null,
    val store_id: String? = null
)

@Serializable
data class SupervisorHealthResponse(
    val health: Double = 0.0,
    val overall_pct: Double = 0.0,
    val pace_delta: Double = 0.0,
    val drops: List<CommandCenterDrop> = emptyList(),
    val date: String? = null
)

// ---------- Tasks screen (GET /tasks, GET /tasks/:id) ----------

@Serializable
data class TaskListItem(
    val id: Int,
    val title: String,
    val description: String? = null,
    val priority: String = "normal",
    val status: String,
    val assigned_to: Int? = null,
    val due_at: String? = null,
    val assignee_name: String? = null,
    val store_name: String? = null
)

@Serializable
data class TaskCommentItem(
    val id: Int,
    val body: String,
    val created_at: String,
    val author_name: String? = null
)

@Serializable
data class TaskDetailResponse(
    val task: TaskListItem,
    val comments: List<TaskCommentItem> = emptyList()
)

// ---------- Schedule screen (GET /schedules, GET /schedules/month) ----------

@Serializable
data class ScheduleRow(
    val work_date: String,
    val shift_text: String? = null,
    val hours: Double? = null,
    val store_id: String,
    val employee_id: Int,
    val full_name: String,
    val store_name: String? = null,
    val store_short: String? = null
)

@Serializable
data class ScheduleMonthResponse(
    val month: String,
    val items: List<ScheduleRow> = emptyList()
)

@Serializable
data class StoreInfo(
    val id: String,
    val name: String,
    val color: String? = null
)

@Serializable
data class OrgStoresResponse(
    val stores: List<StoreInfo> = emptyList()
)

@Serializable
data class ScheduleBulkItem(
    val employee_id: Int,
    val work_date: String,
    val store_id: String,
    val hours: Int,
    val shift_text: String
)

@Serializable
data class SaveScheduleBulkRequest(val items: List<ScheduleBulkItem>)

@Serializable
data class SaveScheduleBulkResponse(val count: Int = 0)

@Serializable
data class ChangeTaskStatusRequest(val status: String)

@Serializable
data class AddTaskCommentRequest(val body: String)

// ---------- Team screen (GET /employees, GET /sales?date=) ----------

@Serializable
data class EmployeeListItem(
    val id: Int,
    val full_name: String,
    val short_name: String? = null,
    val is_active: Boolean = true,
    val role: String = "employee"
)

@Serializable
data class OrgAdminItem(
    val id: String,
    val name: String,
    val brand_name: String? = null,
    val primary_color: String? = null,
    val sector_id: String? = null,
    val chat_id: String? = null,
    val sales_thread_id: String? = null,
    val reports_thread_id: String? = null,
    val is_active: Boolean? = null,
    val dealer_name: String? = null
)

@Serializable
data class CreateEmployeeRequest(val full_name: String, val role: String, val org_id: String? = null)

@Serializable
data class SetRoleRequest(val role: String, val sector_id: String? = null)

@Serializable
data class CreateStoreRequest(
    val id: String,
    val name: String,
    val code: String? = null,
    val color: String? = null,
    val work_time: String? = null,
    val hours: Int? = null,
    val close_time_weekday: String? = null,
    val close_time_sunday: String? = null,
    val open_time_weekday: String? = null,
    val open_time_sunday: String? = null,
    val org_id: String? = null
)

// ---------- Add sale (GET /metrics, GET /shifts/open-map, POST /sales) ----------

@Serializable
data class MetricDef(
    val id: String,
    val label: String? = null,
    val short_label: String? = null,
    val unit: String? = null,
    val unit_type: String? = null
)

@Serializable
data class MetricsResponse(val items: List<MetricDef> = emptyList())

@Serializable
data class ShiftOpenMapResponse(
    val open: Map<String, String> = emptyMap(),
    val stores: List<StoreInfo> = emptyList()
)

// ---------- Profile / "Мой план" ----------

@Serializable
data class MonthSummaryRow(
    val employee_id: Int,
    val full_name: String = "",
    val role: String = "",
    val shifts: Int? = null,
    val remaining_shifts: Int? = null,
    val plan: Map<String, Double> = emptyMap(),
    val fact: Map<String, Double> = emptyMap(),
    val pct: Map<String, Double> = emptyMap()
)

@Serializable
data class MonthTotals(
    val plan: Map<String, Double> = emptyMap(),
    val fact: Map<String, Double> = emptyMap(),
    val pct: Map<String, Double> = emptyMap()
)

@Serializable
data class MonthSummaryResponse(
    val rows: List<MonthSummaryRow> = emptyList(),
    val remaining_days: Int? = null,
    val totals: MonthTotals? = null
)

@Serializable
data class StoreMonthRow(
    val store_id: String = "",
    val name: String = "",
    val code: String? = null,
    val plan: Map<String, Double> = emptyMap(),
    val fact: Map<String, Double> = emptyMap()
)

@Serializable
data class StoreMonthResponse(val rows: List<StoreMonthRow> = emptyList())

@Serializable
data class StoreDailyPlan(
    val store_id: String = "",
    val name: String = "",
    val code: String? = null,
    val color: String? = null,
    val has_plan: Boolean = false,
    val plan: Map<String, Double> = emptyMap()
)

@Serializable
data class StoreDailyPlansResponse(val stores: List<StoreDailyPlan> = emptyList())

@Serializable
data class BfqItem(
    val employee_id: Int,
    val full_name: String? = null,
    val total: Double? = null,
    val quality: Double? = null,
    val profit: Double? = null,
    val vmr: Double? = null
)

@Serializable
data class BfqListResponse(val items: List<BfqItem> = emptyList())

@Serializable
data class ShiftSession(
    val store_id: String? = null,
    val store_name: String? = null,
    val opened_at: String? = null,
    val work_mode: String? = null
)

@Serializable
data class ShiftCurrentResponse(
    val session: ShiftSession? = null,
    val fact: Map<String, Double> = emptyMap(),
    val day_plan: Map<String, Double> = emptyMap()
)

@Serializable
data class InsightBody(
    val message: String = "",
    val focus: List<String> = emptyList(),
    val plan_total: Double? = null,
    val projected_total: Double? = null,
    val on_track: Boolean? = null
)

@Serializable
data class MyInsightResponse(val insight: InsightBody? = null)

@Serializable
data class Gamification(
    val level: Int = 1,
    val title: String? = null,
    val xp: Int = 0,
    val next_level_xp: Int? = null,
    val streak_days: Int = 0
)

@Serializable
data class BestShift(val date: String = "", val score: Double = 0.0)

@Serializable
data class SelfStatsResponse(
    val gamification: Gamification? = null,
    val best_shift: BestShift? = null
)

@Serializable
data class SessionListItem(
    val id: Int,
    val last_seen_at: String = "",
    val current: Boolean = false,
    val user_agent: String? = null,
    val city: String? = null,
    val country: String? = null
)

@Serializable
data class ListSessionsResponse(val sessions: List<SessionListItem> = emptyList())

@Serializable
data class LinkPhoneRequest(val phone: String, val password: String)

@Serializable
data class ParseSaleRequest(val text: String)

@Serializable
data class QuickSaleRequest(val text: String, val client_id: String, val employee_id: Int? = null)

@Serializable
data class ParsedSale(val metrics: Map<String, Double> = emptyMap(), val confidence: Double? = null, val unmatched: List<String> = emptyList())

@Serializable
data class QuickSaleResponse(val parsed: ParsedSale? = null)

// ---------- Command Center (GET /command-center) ----------

@Serializable
data class CcNetwork(
    val health: Double = 0.0,
    val overall_pct: Double = 0.0,
    val pace_delta: Double = 0.0,
    val staff_on_shift: Int = 0,
    val stores_count: Int = 0
)

@Serializable
data class CcStoreToday(
    val overall: Double? = null,
    val sim: Double? = null,
    val plan_sim: Double? = null,
    val mnp: Double? = null,
    val plan_mnp: Double? = null
)

@Serializable
data class CcStore(
    val name: String,
    val color: String? = null,
    val staff_count: Int? = null,
    val today: CcStoreToday? = null
)

@Serializable
data class CcAction(
    val type: String,
    val id: kotlinx.serialization.json.JsonPrimitive? = null,
    val store_id: String? = null,
    val employee_id: Int? = null,
    val alert_id: Int? = null,
    val message: String? = null
)

@Serializable
data class CcProblem(
    val severity: String = "",
    val message: String = "",
    val store_id: String? = null,
    val store_name: String? = null,
    val ai_comment: String? = null,
    val alert_id: Int? = null,
    val actions: List<CcAction> = emptyList()
)

@Serializable
data class CcResponse(
    val network: CcNetwork = CcNetwork(),
    val stores: List<CcStore> = emptyList(),
    val problems: List<CcProblem> = emptyList()
)

// ---------- Cash (GET /cash/table, PUT /cash) ----------

@Serializable
data class CashStore(val id: String, val name: String? = null)

@Serializable
data class CashEntry(
    val cash_fact: kotlinx.serialization.json.JsonPrimitive? = null,
    val cash_1c: kotlinx.serialization.json.JsonPrimitive? = null,
    val delta: kotlinx.serialization.json.JsonPrimitive? = null
)

@Serializable
data class CashTable(
    val stores: List<CashStore> = emptyList(),
    val dates: List<String> = emptyList(),
    val cells: Map<String, Map<String, CashEntry>> = emptyMap()
)

// ---------- Chat (GET/POST /chat/messages, /chat/attachments) ----------

@Serializable
data class ChatSender(val id: Int, val displayName: String = "", val role: String = "")

@Serializable
data class ChatAttachment(
    val id: String,
    val originalFilename: String = "",
    val mimeType: String = "",
    val sizeBytes: Long = 0
)

@Serializable
data class ChatMessage(
    val id: String,
    val clientMessageId: String = "",
    val body: String? = null,
    val createdAt: String = "",
    val sender: ChatSender,
    val attachments: List<ChatAttachment> = emptyList()
)

@Serializable
data class ChatMessagesResponse(val items: List<ChatMessage> = emptyList(), val nextCursor: String? = null)

@Serializable
data class CreateChatMessageRequest(
    val clientMessageId: String,
    val body: String? = null,
    val attachmentIds: List<String> = emptyList()
)

@Serializable
data class PreparedAttachment(val id: String)

// ---------- Admin: audit log, dealers/sectors ----------

@Serializable
data class AuditItem(
    val id: Int = 0,
    val actor_name: String? = null,
    val action: String = "",
    val target_type: String = "",
    val target_id: String? = null,
    val actor_role: String? = null,
    val before: kotlinx.serialization.json.JsonElement? = null,
    val after: kotlinx.serialization.json.JsonElement? = null,
    val created_at: String = ""
)

@Serializable
data class AuditResponse(val items: List<AuditItem> = emptyList())

@Serializable
data class DealerOrgRef(val id: String, val name: String = "")

@Serializable
data class DealerSupervisorRef(val id: Int, val full_name: String = "")

@Serializable
data class SectorNode(
    val id: String,
    val name: String = "",
    val orgs: List<DealerOrgRef> = emptyList(),
    val supervisors: List<DealerSupervisorRef> = emptyList()
)

@Serializable
data class DealerNode(val id: Int, val name: String = "", val sectors: List<SectorNode> = emptyList())

@Serializable
data class DealersTree(
    val dealers: List<DealerNode> = emptyList(),
    val unassigned_sectors: List<SectorNode> = emptyList(),
    val unassigned_supervisors: List<DealerSupervisorRef> = emptyList()
)

// ---------- Admin Control Center ----------

/** pg count()/bigint columns reach JSON as strings ("3") although the TS contract says number - accept both. */
object LenientIntSerializer : kotlinx.serialization.KSerializer<Int> {
    override val descriptor = kotlinx.serialization.descriptors.PrimitiveSerialDescriptor("LenientInt", kotlinx.serialization.descriptors.PrimitiveKind.INT)
    override fun deserialize(decoder: kotlinx.serialization.encoding.Decoder): Int {
        val el = (decoder as? kotlinx.serialization.json.JsonDecoder)?.decodeJsonElement()
        return (el as? kotlinx.serialization.json.JsonPrimitive)?.content?.toDoubleOrNull()?.toInt() ?: decoder.decodeInt()
    }
    override fun serialize(encoder: kotlinx.serialization.encoding.Encoder, value: Int) = encoder.encodeInt(value)
}

@Serializable
data class AcCount(
    @Serializable(with = LenientIntSerializer::class) val active: Int = 0,
    @Serializable(with = LenientIntSerializer::class) val total: Int = 0
)

@Serializable
data class AcOverview(
    val stores: AcCount = AcCount(),
    val employees: AcCount = AcCount(),
    /** the backend really sends {active, replacement} (the TS contract says number) - kept raw and read leniently */
    val shifts_today: kotlinx.serialization.json.JsonElement? = null,
    @Serializable(with = LenientIntSerializer::class) val pending_access_requests: Int = 0,
    @Serializable(with = LenientIntSerializer::class) val open_support_tickets: Int = 0,
    @Serializable(with = LenientIntSerializer::class) val active_alerts: Int = 0
)

@Serializable
data class AcEmployeeHit(val id: Int, val full_name: String = "", val role: String = "")

@Serializable
data class AcSearch(val employees: List<AcEmployeeHit> = emptyList())

@Serializable
data class AcEmployeeProfile(
    val id: Int,
    val full_name: String = "",
    val role: String = "employee",
    val access_status: String? = null,
    val is_active: Boolean = true,
    val hire_date: String? = null
)

@Serializable
data class AcSession(
    val id: Int,
    val last_seen_at: String = "",
    val user_agent: String? = null,
    val city: String? = null,
    val country: String? = null
)

@Serializable
data class AcEmployeeDetail(val employee: AcEmployeeProfile, val sessions: List<AcSession> = emptyList())

@Serializable
data class AcStore(
    val id: String,
    val name: String = "",
    val display_name: String? = null,
    val code: String = "",
    val is_active: Boolean = true
)

@Serializable
data class AcStoresList(val items: List<AcStore> = emptyList())

@Serializable
data class AcStoreDetail(val store: AcStore)

@Serializable
data class AcStepUpResponse(val step_up_token: String = "")

@Serializable
data class AcPasswordReset(val token: String = "")

@Serializable
data class AcFlag(
    val key: String,
    val org_id: String? = null,
    val enabled: Boolean = false,
    val description: String? = null
)

@Serializable
data class AcFlagsList(val items: List<AcFlag> = emptyList())

// ---------- Admin Center: sales correction ----------

@Serializable
data class AcSaleRow(
    val id: String,
    val employee_name: String = "",
    val store_id: String = "",
    val store_name: String = "",
    val sale_date: String = "",
    val voided_at: String? = null,
    val void_reason: String? = null,
    val version: Int = 1
)

@Serializable
data class AcSalesList(val items: List<AcSaleRow> = emptyList())

@Serializable
data class AcMetricValue(val value: Double = 0.0, val label: String = "")

@Serializable
data class AcSaleDetail(val row: AcSaleRow, val metrics: Map<String, AcMetricValue> = emptyMap())

@Serializable
data class AcCrossOrgPreview(val crossOrg: Boolean = false)

// ---------- Admin Center: shift / schedule / plan corrections ----------

@Serializable
data class AcShiftRow(
    val id: Int,
    val store_id: String = "",
    val work_date: String = "",
    val status: String = "",
    val employee_name: String = "",
    val store_name: String = "",
    val voided_at: String? = null,
    val void_reason: String? = null,
    val version: Int = 1
)

@Serializable
data class AcShiftsList(val items: List<AcShiftRow> = emptyList())

@Serializable
data class AcShiftDetail(val row: AcShiftRow)

@Serializable
data class AcScheduleRow(
    val id: Int,
    val store_id: String = "",
    val work_date: String = "",
    val shift_text: String? = null,
    val hours: Double? = null,
    val employee_name: String = "",
    val store_name: String = "",
    val version: Int = 1
)

@Serializable
data class AcSchedulesList(val items: List<AcScheduleRow> = emptyList())

@Serializable
data class AcScheduleDetail(val row: AcScheduleRow)

@Serializable
data class AcDestinationPreview(val destinationExists: Boolean = false)

@Serializable
data class AcPlanDetail(val row: kotlinx.serialization.json.JsonObject = kotlinx.serialization.json.JsonObject(emptyMap()), val metrics: Map<String, AcMetricValue> = emptyMap())

// ---------- Sales history (GET /sales/history) ----------

@Serializable
data class HistorySale(
    val full_name: String = "",
    val store_name: String? = null,
    val sale_date: String = "",
    val sim: Double? = null,
    val mnp: Double? = null,
    val pa: Double? = null
)

@Serializable
data class SalesHistoryResponse(val items: List<HistorySale> = emptyList())

// ---------- Alerts, announcements, support ----------

@Serializable
data class AlertItem(
    val id: Int,
    val severity: String = "",
    val title: String = "",
    val body: String? = null,
    val status: String = "open",
    val created_at: String? = null,
    val store_name: String? = null,
    val task_id: Int? = null,
    val task_status: String? = null
)

@Serializable
data class ReaderRef(val full_name: String = "")

@Serializable
data class AnnouncementReads(val read: List<ReaderRef> = emptyList(), val unread: List<ReaderRef> = emptyList())

@Serializable
data class FaqItem(val id: Int = 0, val question: String = "", val answer: String = "")

@Serializable
data class SupportTicket(
    val id: Int,
    val full_name: String? = null,
    val message: String = "",
    val status: String? = null,
    val admin_reply: String? = null
)

@Serializable
data class CreateTicketResult(val auto_reply: String? = null, val message: String? = null)

// ---------- Promos ----------

@Serializable
data class PromoListItem(
    val id: Int,
    val mask: String = "",
    val note: String? = null,
    val created_by_name: String? = null,
    val created_at: String = ""
)

@Serializable
data class PromosList(val items: List<PromoListItem> = emptyList())

@Serializable
data class PromoCardData(
    val id: Int,
    val code: String = "",
    val note: String? = null,
    val created_by_name: String? = null
)

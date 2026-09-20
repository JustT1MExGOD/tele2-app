package ru.t2sales.shared.api

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.forms.formData
import io.ktor.client.request.forms.submitFormWithBinaryData
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.websocket.readText
import kotlinx.serialization.json.JsonArray

/**
 * getDashboard/getStatsDaily/getAnnouncements mirror
 * backend/frontend/src/features/reports/api.ts, but that module is a shared
 * helper actually consumed by the Home page, not the real `/reports` page
 * (backend/frontend/src/pages/reports/index.ts) — kept here for a future
 * Home screen, not currently wired into the Reports screen.
 *
 * getAlertsEffectiveness is the one read-only, in-scope piece of the real
 * `/reports` page (its "Эффективность рекомендаций" section, admin-only —
 * digest-send/report-image/CSV export are mutations or need image
 * rendering, deferred per the plan).
 */
class ReportsApi(private val client: HttpClient) {

    suspend fun getDashboard(): DashboardResponse =
        client.get(apiUrl("/dashboard?_=1")).body()

    /** Raw JSON array — StatsDailyRow is a dynamic metrics map merged with
     * store_id/name/code (backend api-types.ts: `MetricValues & {...}`),
     * so there's no fixed Kotlin shape to decode into. Callers pull known
     * keys (store_id, name, code) plus whichever metric keys they need. */
    suspend fun getStatsDaily(date: String): JsonArray =
        client.get(apiUrl("/stats/daily?date=$date")).body()

    /** GET /reports/day/:store?date= - {svg} or story {svgs:{plan,fact,tomorrow}}. */
    suspend fun getReportDay(storeId: String, date: String): kotlinx.serialization.json.JsonObject =
        client.get(apiUrl("/reports/day/${java.net.URLEncoder.encode(storeId, "UTF-8")}?date=$date")).body()

    suspend fun getAnnouncements(): AnnouncementsListResponse =
        client.get(apiUrl("/announcements")).body()

    suspend fun getAlertsEffectiveness(): EffectivenessSummaryResponse =
        client.get(apiUrl("/alerts/effectiveness")).body()

    /** kind: "weekly" | "monthly" - posts the network digest to the chat. */
    suspend fun sendDigest(kind: String) {
        client.post(apiUrl("/reports/send-digest")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.buildJsonObject { put("kind", kotlinx.serialization.json.JsonPrimitive(kind)) })
        }
    }
}

/**
 * GET /me/day and GET /supervisor/health, the two calls the Home screen
 * needs beyond ReportsApi's getDashboard/getStatsDaily (see that class's
 * doc comment — those were ported ahead of time for this exact screen).
 * Mutations reachable from the real Home page (task-complete, change-store/
 * open-shift, the "О приложении" modal) are out of scope this pass — see
 * HomeScreen.kt.
 */
class HomeApi(private val client: HttpClient) {

    suspend fun getMyDay(): MeDayResponse =
        client.get(apiUrl("/me/day")).body()

    suspend fun getSupervisorHealth(): SupervisorHealthResponse =
        client.get(apiUrl("/supervisor/health")).body()
}

class AuthApi(private val client: HttpClient) {

    suspend fun login(phone: String, password: String): LoginResponse {
        val response = client.post(apiUrl("/auth/login")) {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(phone, password))
        }
        return response.body()
    }

    suspend fun loginMfa(mfaToken: String, method: String, code: String): LoginResponse {
        val response = client.post(apiUrl("/auth/login/mfa")) {
            contentType(ContentType.Application.Json)
            setBody(LoginMfaRequest(mfaToken, method, code))
        }
        return response.body()
    }

    suspend fun me(): MeResponse =
        client.get(apiUrl("/me")).body()
}

/** List, detail, status change and comments. Task creation is deferred. */
class TasksApi(private val client: HttpClient) {

    suspend fun getTasks(): List<TaskListItem> =
        client.get(apiUrl("/tasks?_=1")).body()

    suspend fun getTask(id: Int): TaskDetailResponse =
        client.get(apiUrl("/tasks/$id")).body()

    suspend fun changeStatus(id: Int, status: String) {
        client.post(apiUrl("/tasks/$id/status")) {
            contentType(ContentType.Application.Json)
            setBody(ChangeTaskStatusRequest(status))
        }
    }

    suspend fun addComment(id: Int, body: String) {
        client.post(apiUrl("/tasks/$id/comments")) {
            contentType(ContentType.Application.Json)
            setBody(AddTaskCommentRequest(body))
        }
    }
}

/** Today's roster, a month of shifts, and single-shift save. Auto-draft generator is deferred. */
class ScheduleApi(private val client: HttpClient) {

    suspend fun getSchedules(date: String, orgId: String? = null): List<ScheduleRow> =
        client.get(apiUrl("/schedules?date=$date" + (orgId?.let { "&org_id=$it" } ?: ""))).body()

    suspend fun getScheduleMonth(month: String): ScheduleMonthResponse =
        client.get(apiUrl("/schedules/month?month=$month")).body()

    suspend fun getOrgStores(): OrgStoresResponse =
        client.get(apiUrl("/org/stores")).body()

    // --- automatic schedule draft (DRAFT -> APPLY), coverage requirements, unavailability ---
    suspend fun generateDraft(month: String?): kotlinx.serialization.json.JsonObject =
        client.post(apiUrl("/schedule-drafts/generate")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.buildJsonObject { month?.let { put("month", kotlinx.serialization.json.JsonPrimitive(it)) } })
        }.body()

    suspend fun getDraft(id: Int): kotlinx.serialization.json.JsonObject =
        client.get(apiUrl("/schedule-drafts/$id")).body()

    suspend fun applyDraft(id: Int, replace: Boolean): kotlinx.serialization.json.JsonObject =
        client.post(apiUrl("/schedule-drafts/$id/apply")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.buildJsonObject { if (replace) put("replace", kotlinx.serialization.json.JsonPrimitive(true)) })
        }.body()

    suspend fun getStaffing(storeId: String): kotlinx.serialization.json.JsonObject =
        client.get(apiUrl("/stores/${java.net.URLEncoder.encode(storeId, "UTF-8")}/staffing-requirements")).body()

    /** rows = (weekday 0=Пн..6=Вс, required_employees, max_trainees) */
    suspend fun saveStaffing(storeId: String, rows: List<Triple<Int, Int, Int>>) {
        client.put(apiUrl("/stores/${java.net.URLEncoder.encode(storeId, "UTF-8")}/staffing-requirements")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.buildJsonObject {
                put("weekday_rows", kotlinx.serialization.json.JsonArray(rows.map { (wd, req, tr) ->
                    kotlinx.serialization.json.buildJsonObject {
                        put("weekday", kotlinx.serialization.json.JsonPrimitive(wd))
                        put("required_employees", kotlinx.serialization.json.JsonPrimitive(req))
                        put("max_trainees", kotlinx.serialization.json.JsonPrimitive(tr))
                    }
                }))
            })
        }
    }

    suspend fun getAvailability(employeeId: Int): kotlinx.serialization.json.JsonObject =
        client.get(apiUrl("/employees/$employeeId/schedule-availability")).body()

    suspend fun addAvailability(employeeId: Int, kind: String, date: String) {
        client.post(apiUrl("/employees/$employeeId/schedule-availability")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.buildJsonObject {
                put("kind", kotlinx.serialization.json.JsonPrimitive(kind))
                put("specific_date", kotlinx.serialization.json.JsonPrimitive(date))
            })
        }
    }

    suspend fun deleteAvailability(employeeId: Int, rowId: Int) {
        client.delete(apiUrl("/employees/$employeeId/schedule-availability/$rowId")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.JsonObject(emptyMap()))
        }
    }

    /** manager-tier only (server-enforced). hours = 0 means a day off. */
    suspend fun saveShift(item: ScheduleBulkItem): SaveScheduleBulkResponse =
        client.post(apiUrl("/schedules/bulk")) {
            contentType(ContentType.Application.Json)
            setBody(SaveScheduleBulkRequest(listOf(item)))
        }.body()
}

/** Team roster, today's sales, avatars, role/removal/creation and CSV export. */
class TeamApi(private val client: HttpClient) {
    private val avatars = HashMap<Int, ByteArray?>()

    private fun org(orgId: String?, first: Boolean) =
        if (orgId == null) "" else (if (first) "?" else "&") + "org_id=" + orgId

    suspend fun getEmployees(orgId: String? = null): List<EmployeeListItem> =
        client.get(apiUrl("/employees" + org(orgId, true))).body()

    /** Raw rows: metrics are a dynamic map next to id/employee_id. */
    suspend fun getSales(date: String, orgId: String? = null): JsonArray =
        client.get(apiUrl("/sales?date=$date" + org(orgId, false))).body()

    suspend fun getOrgs(): List<OrgAdminItem> =
        client.get(apiUrl("/orgs")).body()

    /** Null when the employee has no photo (404) or it can't be fetched. */
    suspend fun getAvatar(employeeId: Int): ByteArray? {
        if (avatars.containsKey(employeeId)) return avatars[employeeId]
        val bytes = runCatching { client.get(apiUrl("/avatars/$employeeId")).body<ByteArray>() }.getOrNull()
        avatars[employeeId] = bytes
        return bytes
    }

    fun forgetAvatar(employeeId: Int) {
        avatars.remove(employeeId)
    }

    suspend fun setRole(id: Int, role: String, sectorId: String? = null) {
        client.patch(apiUrl("/employees/$id/role")) {
            contentType(ContentType.Application.Json)
            setBody(SetRoleRequest(role, sectorId))
        }
    }

    suspend fun deactivate(id: Int) {
        client.delete(apiUrl("/employees/$id"))
    }

    suspend fun createEmployee(req: CreateEmployeeRequest) {
        client.post(apiUrl("/employees")) {
            contentType(ContentType.Application.Json)
            setBody(req)
        }
    }

    suspend fun createStore(req: CreateStoreRequest) {
        client.post(apiUrl("/stores")) {
            contentType(ContentType.Application.Json)
            setBody(req)
        }
    }

    suspend fun exportCsv(path: String): ByteArray =
        client.get(apiUrl(path)).body()
}

/** Add-sale form: metrics catalog, open-shift map, sale creation and single-metric correction. */
class SalesApi(private val client: HttpClient) {

    /** POST /metrics -> {ok, item}. short_label defaults to the label's first 8 characters, like the web. */
    suspend fun createMetric(label: String, shortLabel: String, unit: String): kotlinx.serialization.json.JsonObject =
        client.post(apiUrl("/metrics")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.buildJsonObject {
                put("label", kotlinx.serialization.json.JsonPrimitive(label))
                put("short_label", kotlinx.serialization.json.JsonPrimitive(shortLabel))
                put("unit", kotlinx.serialization.json.JsonPrimitive(unit))
            })
        }.body()

    suspend fun deleteMetric(id: String) {
        client.delete(apiUrl("/metrics/$id"))
    }

    suspend fun getMetrics(): MetricsResponse =
        client.get(apiUrl("/metrics")).body()

    suspend fun getHistory(from: String, to: String, employeeId: Int?): SalesHistoryResponse =
        client.get(apiUrl("/sales/history?from=$from&to=$to" + (employeeId?.let { "&employee_id=$it" } ?: ""))).body()

    suspend fun getBfqEmployee(id: Int, month: String): kotlinx.serialization.json.JsonObject =
        client.get(apiUrl("/bfq/$id?month=$month")).body()

    suspend fun saveBfqManual(employeeId: Int, month: String, vmrAvg: Double, penalty: Double) {
        client.post(apiUrl("/bfq/manual")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.buildJsonObject {
                put("employee_id", kotlinx.serialization.json.JsonPrimitive(employeeId))
                put("month", kotlinx.serialization.json.JsonPrimitive(month))
                put("vmr_avg", kotlinx.serialization.json.JsonPrimitive(vmrAvg))
                put("penalty", kotlinx.serialization.json.JsonPrimitive(penalty))
            })
        }
    }

    suspend fun getOpenMap(): ShiftOpenMapResponse =
        client.get(apiUrl("/shifts/open-map")).body()

    /** Body is a dynamic map: employee_id, store_id, sale_date, client_id + one key per metric. */
    suspend fun createSale(body: kotlinx.serialization.json.JsonObject) {
        client.post(apiUrl("/sales")) {
            contentType(ContentType.Application.Json)
            setBody(body)
        }
    }

    suspend fun zeroMetric(saleId: Int, metric: String) {
        client.put(apiUrl("/sales/$saleId/zero")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.buildJsonObject { put("metric", kotlinx.serialization.json.JsonPrimitive(metric)) })
        }
    }
}

/** «Мой план» / Профиль: month plan, BFQ, live shift, insight, gamification, sessions, phone login, avatar, quick sale. */
class ProfileApi(private val client: HttpClient) {

    /** The desktop has no geolocation - like the web fallback, coordinates go as null. storeCode = replacement / other store. */
    suspend fun openShift(storeCode: String?): kotlinx.serialization.json.JsonObject =
        client.post(apiUrl("/shifts/open")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.buildJsonObject {
                put("lat", kotlinx.serialization.json.JsonNull)
                put("lng", kotlinx.serialization.json.JsonNull)
                put("accuracy_m", kotlinx.serialization.json.JsonNull)
                storeCode?.let { put("store_code", kotlinx.serialization.json.JsonPrimitive(it)) }
            })
        }.body()

    suspend fun closeShift(selfReport: String, mood: Int, handoverNote: String): kotlinx.serialization.json.JsonObject =
        client.post(apiUrl("/shifts/close")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.buildJsonObject {
                put("lat", kotlinx.serialization.json.JsonNull)
                put("lng", kotlinx.serialization.json.JsonNull)
                put("accuracy_m", kotlinx.serialization.json.JsonNull)
                put("self_report", kotlinx.serialization.json.JsonPrimitive(selfReport))
                put("mood", kotlinx.serialization.json.JsonPrimitive(mood))
                put("handover_note", kotlinx.serialization.json.JsonPrimitive(handoverNote))
            })
        }.body()

    suspend fun resolveStore(code: String): kotlinx.serialization.json.JsonObject =
        client.post(apiUrl("/shifts/resolve-store")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.buildJsonObject { put("code", kotlinx.serialization.json.JsonPrimitive(code)) })
        }.body()

    suspend fun getMonthPlans(month: String): MonthSummaryResponse =
        client.get(apiUrl("/plans/employees/month?month=$month")).body()

    suspend fun getBfq(month: String): BfqListResponse =
        client.get(apiUrl("/bfq?month=$month")).body()

    suspend fun getShiftCurrent(): ShiftCurrentResponse =
        client.get(apiUrl("/shifts/current")).body()

    suspend fun getInsight(): MyInsightResponse =
        client.get(apiUrl("/me/insight")).body()

    suspend fun getSelfStats(): SelfStatsResponse =
        client.get(apiUrl("/me/self-stats")).body()

    suspend fun listSessions(): ListSessionsResponse =
        client.get(apiUrl("/auth/sessions")).body()

    suspend fun revokeSession(id: Int) {
        client.delete(apiUrl("/auth/sessions/$id"))
    }

    suspend fun revokeOtherSessions() {
        client.post(apiUrl("/auth/sessions/revoke-others")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.JsonObject(emptyMap()))
        }
    }

    suspend fun linkPhone(phone: String, password: String) {
        client.post(apiUrl("/me/link-phone")) {
            contentType(ContentType.Application.Json)
            setBody(LinkPhoneRequest(phone, password))
        }
    }

    suspend fun logout() {
        client.post(apiUrl("/auth/logout")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.JsonObject(emptyMap()))
        }
    }

    suspend fun parseSale(text: String): ParsedSale =
        client.post(apiUrl("/sales/parse")) {
            contentType(ContentType.Application.Json)
            setBody(ParseSaleRequest(text))
        }.body()

    suspend fun quickSale(text: String, clientId: String): QuickSaleResponse =
        client.post(apiUrl("/sales/quick")) {
            contentType(ContentType.Application.Json)
            setBody(QuickSaleRequest(text, clientId))
        }.body()

    suspend fun uploadAvatar(jpeg: ByteArray) {
        client.submitFormWithBinaryData(
            apiUrl("/me/avatar"),
            formData {
                append("file", jpeg, io.ktor.http.Headers.build {
                    append(io.ktor.http.HttpHeaders.ContentType, "image/jpeg")
                    append(io.ktor.http.HttpHeaders.ContentDisposition, "filename=\"avatar.jpg\"")
                })
            }
        )
    }
}

/** Command Center: network snapshot, problems with actions, alert ack and task creation. */
class CommandCenterApi(private val client: HttpClient) {

    suspend fun get(): CcResponse =
        client.get(apiUrl("/command-center?_=1")).body()

    suspend fun ackAlert(alertId: Int) {
        client.post(apiUrl("/alerts/$alertId/status")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.buildJsonObject { put("status", kotlinx.serialization.json.JsonPrimitive("in_progress")) })
        }
    }

    suspend fun createTask(body: kotlinx.serialization.json.JsonObject) {
        client.post(apiUrl("/tasks")) {
            contentType(ContentType.Application.Json)
            setBody(body)
        }
    }
}

/** Cash by day per store and the entry form. */
class CashApi(private val client: HttpClient) {

    suspend fun getTable(from: String, to: String): CashTable =
        client.get(apiUrl("/cash/table?from=$from&to=$to")).body()

    suspend fun save(body: kotlinx.serialization.json.JsonObject) {
        client.put(apiUrl("/cash")) {
            contentType(ContentType.Application.Json)
            setBody(body)
        }
    }
}

/** Internal chat: history, catch-up after an id, send, attachments. Real-time is done by polling (web fallback). */
class ChatApi(private val client: HttpClient) {

    /**
     * GET /chat/ws - push-only channel (the client sends nothing). Frames: {type:"refresh"} or {type:"message", message}.
     * Returns when the socket closes; throws if it can't be opened. REST stays the source of truth.
     */
    suspend fun listen(onOpen: suspend () -> Unit, onFrame: suspend (kotlinx.serialization.json.JsonObject) -> Unit) {
        client.webSocket(urlString = apiUrl("/chat/ws").replaceFirst("http", "ws")) {
            onOpen()
            for (frame in incoming) {
                if (frame is io.ktor.websocket.Frame.Text) {
                    val el = runCatching { kotlinx.serialization.json.Json.parseToJsonElement(frame.readText()) }.getOrNull()
                    (el as? kotlinx.serialization.json.JsonObject)?.let { onFrame(it) }
                }
            }
        }
    }

    suspend fun getMessages(cursor: String? = null, limit: Int = 50): ChatMessagesResponse =
        client.get(apiUrl("/chat/messages?limit=$limit" + (cursor?.let { "&cursor=$it" } ?: ""))).body()

    suspend fun getAfter(afterId: String, limit: Int = 50): List<ChatMessage> =
        client.get(apiUrl("/chat/messages?after=$afterId&limit=$limit")).body<ChatMessagesResponse>().items

    suspend fun post(req: CreateChatMessageRequest): ChatMessage =
        client.post(apiUrl("/chat/messages")) {
            contentType(ContentType.Application.Json)
            setBody(req)
        }.body()

    suspend fun uploadAttachment(name: String, mime: String, bytes: ByteArray): PreparedAttachment =
        client.submitFormWithBinaryData(
            apiUrl("/chat/attachments"),
            formData {
                append("file", bytes, io.ktor.http.Headers.build {
                    append(io.ktor.http.HttpHeaders.ContentType, mime)
                    append(io.ktor.http.HttpHeaders.ContentDisposition, "filename=\"" + name.replace("\"", "") + "\"")
                })
            }
        ).body()

    suspend fun downloadAttachment(id: String): ByteArray =
        client.get(apiUrl("/chat/attachments/$id")).body()
}

/** Supervisor cabinet: one dashboard payload feeds all four tabs (dynamic shape, parsed as JSON). */
class SupervisorApi(private val client: HttpClient) {

    suspend fun getDashboard(days: Int): kotlinx.serialization.json.JsonObject =
        client.get(apiUrl("/supervisor/dashboard?days=$days")).body()
}

/** Admin-only: networks, audit log, dealers/sectors. */
class AdminApi(private val client: HttpClient) {

    suspend fun getOrgs(): List<OrgAdminItem> =
        client.get(apiUrl("/orgs")).body()

    suspend fun saveOrg(id: String, body: kotlinx.serialization.json.JsonObject) {
        client.put(apiUrl("/admin/org/$id")) {
            contentType(ContentType.Application.Json)
            setBody(body)
        }
    }

    suspend fun getAudit(action: String?, targetType: String?, from: String?, to: String?, limit: Int, offset: Int): AuditResponse {
        val q = buildList {
            action?.let { add("action=$it") }
            targetType?.let { add("target_type=$it") }
            from?.let { add("from=$it") }
            to?.let { add("to=$it") }
            add("limit=$limit")
            add("offset=$offset")
        }.joinToString("&")
        return client.get(apiUrl("/audit?$q")).body()
    }

    suspend fun getDealers(): DealersTree =
        client.get(apiUrl("/admin/dealers")).body()

    suspend fun renameDealer(id: Int, name: String) {
        client.patch(apiUrl("/admin/dealers/$id")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.buildJsonObject { put("name", kotlinx.serialization.json.JsonPrimitive(name)) })
        }
    }

    suspend fun renameSector(id: String, name: String) {
        client.patch(apiUrl("/admin/sectors/$id")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.buildJsonObject { put("name", kotlinx.serialization.json.JsonPrimitive(name)) })
        }
    }

    suspend fun assignSupervisorSector(supervisorId: Int, sectorId: String) {
        client.put(apiUrl("/supervisor/$supervisorId/sector")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.buildJsonObject { put("sector_id", kotlinx.serialization.json.JsonPrimitive(sectorId)) })
        }
    }
}

/** Admin Control Center: overview, employee and store administration, step-up MFA. */
class AdminCenterApi(private val client: HttpClient) {

    private fun io.ktor.client.request.HttpRequestBuilder.stepUp(token: String?) {
        if (token != null) headers.append("X-Step-Up-Token", token)
    }

    suspend fun overview(): AcOverview = client.get(apiUrl("/admin/overview")).body()

    suspend fun search(q: String): AcSearch =
        client.get(apiUrl("/admin/search?q=" + java.net.URLEncoder.encode(q, "UTF-8"))).body()

    suspend fun employee(id: Int): AcEmployeeDetail = client.get(apiUrl("/admin/employees/$id")).body()

    suspend fun changeRole(id: Int, role: String, stepUp: String?) {
        client.post(apiUrl("/admin/employees/$id/role")) {
            contentType(ContentType.Application.Json)
            stepUp(stepUp)
            setBody(SetRoleRequest(role))
        }
    }

    suspend fun deactivateEmployee(id: Int) {
        client.post(apiUrl("/admin/employees/$id/deactivate")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.JsonObject(emptyMap()))
        }
    }

    suspend fun reactivateEmployee(id: Int) {
        client.post(apiUrl("/admin/employees/$id/reactivate")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.JsonObject(emptyMap()))
        }
    }

    suspend fun revokeSession(employeeId: Int, sessionId: Int) {
        client.delete(apiUrl("/admin/employees/$employeeId/sessions/$sessionId"))
    }

    suspend fun revokeAllSessions(employeeId: Int) {
        client.post(apiUrl("/admin/employees/$employeeId/sessions/revoke-all")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.JsonObject(emptyMap()))
        }
    }

    suspend fun resetMfa(employeeId: Int, stepUp: String) {
        client.post(apiUrl("/admin/employees/$employeeId/mfa/reset")) {
            contentType(ContentType.Application.Json)
            stepUp(stepUp)
            setBody(kotlinx.serialization.json.JsonObject(emptyMap()))
        }
    }

    suspend fun passwordReset(employeeId: Int): AcPasswordReset =
        client.post(apiUrl("/admin/employees/$employeeId/password-reset")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.JsonObject(emptyMap()))
        }.body()

    suspend fun stores(): AcStoresList = client.get(apiUrl("/admin/stores")).body()

    suspend fun store(id: String): AcStoreDetail = client.get(apiUrl("/admin/stores/$id")).body()

    suspend fun editStoreName(id: String, name: String) {
        client.patch(apiUrl("/admin/stores/$id")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.buildJsonObject { put("name", kotlinx.serialization.json.JsonPrimitive(name)) })
        }
    }

    suspend fun deactivateStore(id: String) {
        client.post(apiUrl("/admin/stores/$id/deactivate")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.JsonObject(emptyMap()))
        }
    }

    suspend fun reactivateStore(id: String) {
        client.post(apiUrl("/admin/stores/$id/reactivate")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.JsonObject(emptyMap()))
        }
    }

    private fun json(vararg pairs: Pair<String, Any?>): kotlinx.serialization.json.JsonObject =
        kotlinx.serialization.json.buildJsonObject {
            pairs.forEach { (k, v) ->
                when (v) {
                    null -> {}
                    is String -> put(k, kotlinx.serialization.json.JsonPrimitive(v))
                    is Int -> put(k, kotlinx.serialization.json.JsonPrimitive(v))
                    is Double -> put(k, kotlinx.serialization.json.JsonPrimitive(v))
                    is Boolean -> put(k, kotlinx.serialization.json.JsonPrimitive(v))
                }
            }
        }

    // ---- sales correction
    suspend fun searchSales(from: String?, to: String?, includeVoided: Boolean): AcSalesList {
        val q = buildList {
            from?.let { add("from=$it") }
            to?.let { add("to=$it") }
            if (includeVoided) add("include_voided=1")
            add("limit=100")
        }.joinToString("&")
        return client.get(apiUrl("/admin/sales?$q")).body()
    }

    suspend fun sale(id: String): AcSaleDetail = client.get(apiUrl("/admin/sales/$id")).body()

    suspend fun previewVoidSale(id: String): kotlinx.serialization.json.JsonObject =
        client.post(apiUrl("/admin/sales/$id/void/preview")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.JsonObject(emptyMap()))
        }.body()

    suspend fun voidSale(id: String, version: Int, reason: String) {
        client.post(apiUrl("/admin/sales/$id/void")) {
            contentType(ContentType.Application.Json)
            setBody(json("version" to version, "reason" to reason))
        }
    }

    suspend fun restoreSale(id: String, version: Int, reason: String) {
        client.post(apiUrl("/admin/sales/$id/restore")) {
            contentType(ContentType.Application.Json)
            setBody(json("version" to version, "reason" to reason))
        }
    }

    suspend fun correctSaleMetric(id: String, metric: String, value: Double, version: Int, reason: String) {
        client.post(apiUrl("/admin/sales/$id/correct-metric")) {
            contentType(ContentType.Application.Json)
            setBody(json("metric" to metric, "value" to value, "version" to version, "reason" to reason))
        }
    }

    suspend fun previewCorrectStore(id: String, newStoreId: String): AcCrossOrgPreview =
        client.post(apiUrl("/admin/sales/$id/correct-store/preview")) {
            contentType(ContentType.Application.Json)
            setBody(json("new_store_id" to newStoreId))
        }.body()

    suspend fun correctSaleStore(id: String, version: Int, newStoreId: String, reason: String, stepUp: String?) {
        client.post(apiUrl("/admin/sales/$id/correct-store")) {
            contentType(ContentType.Application.Json)
            stepUp(stepUp)
            setBody(json("version" to version, "new_store_id" to newStoreId, "reason" to reason))
        }
    }

    private fun rangeQuery(from: String?, to: String?, includeVoided: Boolean): String = buildList {
        from?.let { add("from=$it") }
        to?.let { add("to=$it") }
        if (includeVoided) add("include_voided=1")
        add("limit=100")
    }.joinToString("&")

    // ---- shift corrections
    suspend fun searchShifts(from: String?, to: String?, includeVoided: Boolean): AcShiftsList =
        client.get(apiUrl("/admin/shifts?" + rangeQuery(from, to, includeVoided))).body()

    suspend fun shift(id: Int): AcShiftDetail = client.get(apiUrl("/admin/shifts/$id")).body()

    suspend fun previewVoidShift(id: Int): kotlinx.serialization.json.JsonObject =
        client.post(apiUrl("/admin/shifts/$id/void/preview")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.JsonObject(emptyMap()))
        }.body()

    suspend fun voidShift(id: Int, version: Int, reason: String) {
        client.post(apiUrl("/admin/shifts/$id/void")) { contentType(ContentType.Application.Json); setBody(json("version" to version, "reason" to reason)) }
    }

    suspend fun restoreShift(id: Int, version: Int, reason: String) {
        client.post(apiUrl("/admin/shifts/$id/restore")) { contentType(ContentType.Application.Json); setBody(json("version" to version, "reason" to reason)) }
    }

    suspend fun previewCorrectShift(id: Int, newStoreId: String): AcCrossOrgPreview =
        client.post(apiUrl("/admin/shifts/$id/correct/preview")) { contentType(ContentType.Application.Json); setBody(json("new_store_id" to newStoreId)) }.body()

    suspend fun correctShift(id: Int, version: Int, newStoreId: String?, workDate: String?, reason: String, stepUp: String?) {
        client.post(apiUrl("/admin/shifts/$id/correct")) {
            contentType(ContentType.Application.Json)
            stepUp(stepUp)
            setBody(json("version" to version, "new_store_id" to newStoreId, "work_date" to workDate, "reason" to reason))
        }
    }

    // ---- schedule corrections
    suspend fun searchSchedules(from: String?, to: String?): AcSchedulesList =
        client.get(apiUrl("/admin/schedules?" + rangeQuery(from, to, false))).body()

    suspend fun schedule(id: Int): AcScheduleDetail = client.get(apiUrl("/admin/schedules/$id")).body()

    suspend fun previewVoidSchedule(id: Int): kotlinx.serialization.json.JsonObject =
        client.post(apiUrl("/admin/schedules/$id/void/preview")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.JsonObject(emptyMap()))
        }.body()

    suspend fun voidSchedule(id: Int, version: Int, reason: String) {
        client.post(apiUrl("/admin/schedules/$id/void")) { contentType(ContentType.Application.Json); setBody(json("version" to version, "reason" to reason)) }
    }

    suspend fun previewCorrectSchedule(id: Int, workDate: String): AcDestinationPreview =
        client.post(apiUrl("/admin/schedules/$id/correct/preview")) { contentType(ContentType.Application.Json); setBody(json("work_date" to workDate)) }.body()

    suspend fun correctSchedule(id: Int, version: Int, storeId: String?, workDate: String?, hours: Double?, reason: String) {
        client.post(apiUrl("/admin/schedules/$id/correct")) {
            contentType(ContentType.Application.Json)
            setBody(json("version" to version, "store_id" to storeId, "work_date" to workDate, "hours" to hours, "reason" to reason))
        }
    }

    // ---- plan corrections (kind: "employees" | "stores")
    suspend fun plan(kind: String, id: Int): AcPlanDetail = client.get(apiUrl("/admin/plans/$kind/$id")).body()

    suspend fun correctPlanMetric(kind: String, id: Int, metric: String, value: Double, version: Int, reason: String) {
        client.post(apiUrl("/admin/plans/$kind/$id/correct-metric")) {
            contentType(ContentType.Application.Json)
            setBody(json("metric" to metric, "value" to value, "version" to version, "reason" to reason))
        }
    }

    suspend fun flags(): AcFlagsList = client.get(apiUrl("/admin/feature-flags")).body()

    suspend fun upsertFlag(key: String, orgId: String?, enabled: Boolean, description: String?) {
        client.put(apiUrl("/admin/feature-flags/" + java.net.URLEncoder.encode(key, "UTF-8"))) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.buildJsonObject {
                put("org_id", orgId?.let { kotlinx.serialization.json.JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull)
                put("enabled", kotlinx.serialization.json.JsonPrimitive(enabled))
                put("description", description?.let { kotlinx.serialization.json.JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull)
            })
        }
    }

    suspend fun deleteFlag(key: String, orgId: String?) {
        client.delete(apiUrl("/admin/feature-flags/" + java.net.URLEncoder.encode(key, "UTF-8") + (orgId?.let { "?org_id=" + java.net.URLEncoder.encode(it, "UTF-8") } ?: "")))
    }

    suspend fun createMetric(label: String, shortLabel: String?, unit: String) {
        client.post(apiUrl("/metrics")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.buildJsonObject {
                put("label", kotlinx.serialization.json.JsonPrimitive(label))
                shortLabel?.let { put("short_label", kotlinx.serialization.json.JsonPrimitive(it)) }
                put("unit", kotlinx.serialization.json.JsonPrimitive(unit))
            })
        }
    }

    suspend fun deleteMetric(id: String) {
        client.delete(apiUrl("/metrics/$id"))
    }

    suspend fun operations(): kotlinx.serialization.json.JsonObject =
        client.get(apiUrl("/admin/operations-overview")).body()

    suspend fun issueStepUp(code: String): String =
        client.post(apiUrl("/auth/mfa/step-up")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.buildJsonObject {
                put("method", kotlinx.serialization.json.JsonPrimitive("totp"))
                put("code", kotlinx.serialization.json.JsonPrimitive(code))
            })
        }.body<AcStepUpResponse>().step_up_token
}

/** Month plans: employees, stores, today's store plans and the edit forms. */
class PlansApi(private val client: HttpClient) {

    suspend fun employeesMonth(month: String): MonthSummaryResponse =
        client.get(apiUrl("/plans/employees/month?month=$month")).body()

    suspend fun storesMonth(month: String): StoreMonthResponse =
        client.get(apiUrl("/plans/stores/month?month=$month")).body()

    suspend fun storeDaily(): StoreDailyPlansResponse =
        client.get(apiUrl("/plans/stores/daily?_=1")).body()

    suspend fun storeDailyFor(date: String): StoreDailyPlansResponse =
        client.get(apiUrl("/plans/stores/daily?date=$date")).body()

    /** GET /plans?date= - raw rows (store_id, plan_date, metric columns). */
    suspend fun template(date: String): kotlinx.serialization.json.JsonArray =
        client.get(apiUrl("/plans?date=$date")).body()

    /** GET /org/stores raw - keeps code, short_name, work_time, hours that StoreInfo drops. */
    suspend fun orgStoresRaw(): kotlinx.serialization.json.JsonElement =
        client.get(apiUrl("/org/stores")).body()

    // --- automatic personal plan drafts ---
    suspend fun generatePlanDraft(month: String?): kotlinx.serialization.json.JsonObject =
        client.post(apiUrl("/plans/employees/month-drafts")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.buildJsonObject { month?.let { put("month", kotlinx.serialization.json.JsonPrimitive(it)) } })
        }.body()

    suspend fun latestPlanDraft(month: String): kotlinx.serialization.json.JsonObject =
        client.get(apiUrl("/plans/employees/month-drafts/latest?month=$month")).body()

    suspend fun applyPlanDraft(id: Int): kotlinx.serialization.json.JsonObject =
        client.post(apiUrl("/plans/employees/month-drafts/$id/apply")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.JsonObject(emptyMap()))
        }.body()

    suspend fun employeePlan(id: Int, month: String): kotlinx.serialization.json.JsonObject =
        client.get(apiUrl("/plans/employees/$id/month?month=$month")).body()

    suspend fun saveEmployeePlan(id: Int, body: kotlinx.serialization.json.JsonObject) {
        client.put(apiUrl("/plans/employees/$id/month")) { contentType(ContentType.Application.Json); setBody(body) }
    }

    suspend fun storePlan(id: String, month: String): kotlinx.serialization.json.JsonObject =
        client.get(apiUrl("/plans/stores/$id/month?month=$month")).body()

    suspend fun saveStorePlan(id: String, body: kotlinx.serialization.json.JsonObject) {
        client.put(apiUrl("/plans/stores/$id/month")) { contentType(ContentType.Application.Json); setBody(body) }
    }
}

/** Alerts lifecycle. */
class AlertsApi(private val client: HttpClient) {

    suspend fun list(status: String): List<AlertItem> =
        client.get(apiUrl("/alerts?status=$status")).body()

    suspend fun markRead(id: Int) {
        client.post(apiUrl("/alerts/$id/read")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.JsonObject(emptyMap()))
        }
    }

    suspend fun changeStatus(id: Int, status: String) {
        client.post(apiUrl("/alerts/$id/status")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.buildJsonObject { put("status", kotlinx.serialization.json.JsonPrimitive(status)) })
        }
    }
}

/** Announcements (read/create/reads) and support (FAQ, my tickets, create, admin list/reply). */
class InfoApi(private val client: HttpClient) {

    suspend fun announcements(): AnnouncementsListResponse =
        client.get(apiUrl("/announcements")).body()

    suspend fun markAnnouncementRead(id: Int) {
        client.post(apiUrl("/announcements/$id/read")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.JsonObject(emptyMap()))
        }
    }

    suspend fun announcementReads(id: Int): AnnouncementReads =
        client.get(apiUrl("/announcements/$id/reads")).body()

    suspend fun createAnnouncement(title: String, body: String, required: Boolean) {
        client.post(apiUrl("/announcements")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.buildJsonObject {
                put("title", kotlinx.serialization.json.JsonPrimitive(title))
                put("body", kotlinx.serialization.json.JsonPrimitive(body))
                put("required", kotlinx.serialization.json.JsonPrimitive(required))
            })
        }
    }

    suspend fun promos(): PromosList = client.get(apiUrl("/promos")).body()

    suspend fun promoCard(id: Int): PromoCardData = client.get(apiUrl("/promos/$id")).body()

    suspend fun createPromo(code: String, note: String) {
        client.post(apiUrl("/promos")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.buildJsonObject {
                put("code", kotlinx.serialization.json.JsonPrimitive(code))
                put("note", kotlinx.serialization.json.JsonPrimitive(note))
            })
        }
    }

    suspend fun markPromoUsed(id: Int) {
        client.post(apiUrl("/promos/$id/use")) { contentType(ContentType.Application.Json); setBody(kotlinx.serialization.json.JsonObject(emptyMap())) }
    }

    suspend fun keepPromo(id: Int) {
        client.post(apiUrl("/promos/$id/keep")) { contentType(ContentType.Application.Json); setBody(kotlinx.serialization.json.JsonObject(emptyMap())) }
    }

    suspend fun faq(): List<FaqItem> = client.get(apiUrl("/support/faq")).body()

    suspend fun myTickets(): List<SupportTicket> = client.get(apiUrl("/support/my")).body()

    suspend fun createTicket(message: String, fullName: String): CreateTicketResult =
        client.post(apiUrl("/support")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.buildJsonObject {
                put("message", kotlinx.serialization.json.JsonPrimitive(message))
                put("full_name", kotlinx.serialization.json.JsonPrimitive(fullName))
            })
        }.body()

    suspend fun allTickets(): List<SupportTicket> = client.get(apiUrl("/support/tickets")).body()

    suspend fun replyTicket(id: Int, reply: String) {
        client.post(apiUrl("/support/tickets/$id/reply")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.buildJsonObject { put("reply", kotlinx.serialization.json.JsonPrimitive(reply)) })
        }
    }
}

/** Analytics: live network map, heatmap by hour, 7-day forecast, staffing hints, what-if scenarios. */
class AnalyticsApi(private val client: HttpClient) {

    suspend fun storeProfile(storeId: String): kotlinx.serialization.json.JsonObject =
        client.get(apiUrl("/stores/$storeId/profile?_=1")).body()

    suspend fun setStoreDisplayName(storeId: String, name: String?) {
        client.patch(apiUrl("/stores/$storeId")) {
            contentType(ContentType.Application.Json)
            setBody(kotlinx.serialization.json.buildJsonObject {
                put("display_name", name?.let { kotlinx.serialization.json.JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull)
            })
        }
    }

    suspend fun live(): kotlinx.serialization.json.JsonObject = client.get(apiUrl("/network/live?_=1")).body()

    suspend fun heatmap(storeId: String): kotlinx.serialization.json.JsonObject =
        client.get(apiUrl("/heatmap/precise/$storeId")).body()

    suspend fun forecast(storeId: String): kotlinx.serialization.json.JsonObject =
        client.get(apiUrl("/forecast/$storeId")).body()

    suspend fun staffingHints(): kotlinx.serialization.json.JsonObject = client.get(apiUrl("/staffing-hints")).body()

    suspend fun whatIf(body: kotlinx.serialization.json.JsonObject): kotlinx.serialization.json.JsonObject =
        client.post(apiUrl("/schedule/what-if")) { contentType(ContentType.Application.Json); setBody(body) }.body()

    suspend fun applyWhatIf(body: kotlinx.serialization.json.JsonObject): kotlinx.serialization.json.JsonObject =
        client.post(apiUrl("/schedule/what-if/apply")) { contentType(ContentType.Application.Json); setBody(body) }.body()
}

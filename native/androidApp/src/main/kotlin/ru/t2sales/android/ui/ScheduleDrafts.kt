package ru.t2sales.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import ru.t2sales.shared.api.ApiException
import ru.t2sales.shared.api.EmployeeListItem
import ru.t2sales.shared.api.ScheduleApi
import ru.t2sales.shared.api.StoreInfo
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Radius

private val DRAFT_MONTHS = listOf(
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
)
private val DRAFT_WEEKDAYS = listOf("Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс")
private val DRAFT_ERROR = Color(0xFFE5484D)

private fun monthTitle(ym: YearMonth) = "${DRAFT_MONTHS[ym.monthValue - 1]} ${ym.year}"

/** Draft kept in memory only, exactly like the web (the backend has no "latest draft" endpoint). */
class ScheduleDraft(val id: Int, val month: String, val status: String, val blocking: List<String>, val items: List<JsonObject>) {
    /** employee_id may arrive as a string (bigint driver) - always parsed through dbl(). */
    fun byEmployee(): Map<Int, Map<String, JsonObject>> =
        items.groupBy { it["employee_id"].dbl().toInt() }.mapValues { (_, list) -> list.associateBy { it["work_date"].str().take(10) } }
}

private fun tierLabel(tier: String) = mapOf(
    "employee_store_weekday" to "по истории сотрудника на этой точке в этот день недели",
    "employee_store" to "по истории сотрудника на этой точке",
    "employee" to "по общей истории сотрудника",
    "store_weekday" to "по среднему точки в этот день недели",
    "store" to "по среднему показателю точки",
    "org" to "по среднему показателю сети",
    "no_history" to "истории нет — только покрытие/доступность"
)[tier] ?: tier

private fun statusLabel(s: String) = when (s) { "applied" -> "Применён"; "stale" -> "Устарел"; else -> "Черновик" }

private fun parseDraft(view: JsonObject, fallbackId: Int, fallbackMonth: String, fallbackStatus: String, fallbackBlocking: List<String>): ScheduleDraft {
    val d = view["draft"] as? JsonObject
    val blocking = (d?.get("blocking_errors")?.arr()?.map { it.obj()["message"].str() }) ?: fallbackBlocking
    return ScheduleDraft(
        id = d?.get("id")?.dbl()?.toInt() ?: fallbackId,
        month = d?.get("month").str().ifEmpty { fallbackMonth },
        status = d?.get("status").str().ifEmpty { fallbackStatus },
        blocking = blocking,
        items = view["items"].arr().map { it.obj() }
    )
}

@Composable
internal fun DraftConfirmDialog(title: String, text: String, confirmLabel: String, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    SheetDialog(title, onDismiss) {
        Text(text, color = T2Colors.hint, fontSize = 14.sp, modifier = Modifier.padding(bottom = 16.dp))
        MainButton(confirmLabel, enabled = true, onClick = onConfirm)
    }
}

@Composable
fun GhostButton(label: String, onClick: () -> Unit) {
    Text(
        label,
        fontWeight = FontWeight.Bold,
        fontSize = 13.sp,
        color = T2Colors.text,
        modifier = Modifier.clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 12.dp)
    )
}

/** Port of #scheduleDraftSection (desktop's ScheduleDrafts.kt): month, generate, apply, coverage + availability editors, errors, per-employee summary. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DraftSection(
    scheduleApi: ScheduleApi,
    stores: Map<String, StoreInfo>,
    employees: List<EmployeeListItem>,
    draft: ScheduleDraft?,
    onDraft: (ScheduleDraft?) -> Unit,
    onApplied: () -> Unit
) {
    val scope = rememberCoroutineScope()
    val today = remember { LocalDate.now(ZoneId.of("Europe/Moscow")) }
    val options = remember { listOf(YearMonth.from(today), YearMonth.from(today).plusMonths(1)) }
    var monthIdx by remember { mutableStateOf(0) }
    var generating by remember { mutableStateOf(false) }
    var applying by remember { mutableStateOf(false) }
    var confirmApply by remember { mutableStateOf(false) }
    var replaceCount by remember { mutableStateOf<Int?>(null) }
    var staffing by remember { mutableStateOf(false) }
    var availability by remember { mutableStateOf(false) }
    var planPromptMonth by remember { mutableStateOf<String?>(null) }

    val shape = RoundedCornerShape(T2Radius.default)
    Column(modifier = Modifier.fillMaxWidth().clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape).padding(vertical = 6.dp)) {
        Text(
            "АВТОМАТИЧЕСКИЙ РАСЧЁТ ГРАФИКА",
            color = T2Colors.hint, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.7.sp,
            modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 8.dp)
        )
        FlowRow(
            modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Column(modifier = Modifier.width(180.dp)) {
                SelectField("", monthTitle(options[monthIdx]), options.map { monthTitle(it) }) { picked -> monthIdx = options.indexOfFirst { monthTitle(it) == picked }.coerceAtLeast(0) }
            }
            Column(modifier = Modifier.width(260.dp)) {
                MainButton(if (generating) "Считаем…" else "Составить график автоматически", enabled = !generating) {
                    generating = true
                    scope.launch {
                        runCatching {
                            val month = options[monthIdx].atDay(1).toString()
                            val gen = scheduleApi.generateDraft(month)
                            val id = gen["draft_id"].dbl().toInt()
                            val view = scheduleApi.getDraft(id)
                            val d = parseDraft(view, id, gen["month"].str(), gen["status"].str(), gen["blocking_errors"].arr().map { it.obj()["message"].str() })
                            onDraft(d)
                            Toaster.show("Черновик графика на ${monthTitle(YearMonth.parse(d.month.take(7)))} рассчитан")
                        }.onFailure { Toaster.show(it.message ?: "Не удалось рассчитать черновик графика", true) }
                        generating = false
                    }
                }
            }
            if (draft != null && draft.status == "draft" && draft.blocking.isEmpty()) {
                Column(modifier = Modifier.width(200.dp)) {
                    MainButton(if (applying) "Применяем…" else "Применить график", enabled = !applying) { confirmApply = true }
                }
            }
            GhostButton("Требования к покрытию") { staffing = true }
            GhostButton("Недоступность/отпуск") { availability = true }
        }

        if (draft != null && draft.blocking.isNotEmpty()) {
            Column(modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp)) {
                Text("Есть блокирующие ошибки — применить график нельзя, пока они не устранены:", color = DRAFT_ERROR, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                draft.blocking.forEach { Text("• $it", color = DRAFT_ERROR, fontSize = 13.sp, modifier = Modifier.padding(start = 8.dp, top = 2.dp)) }
            }
        } else if (draft?.status == "stale") {
            Text(
                "Черновик устарел: график или настройки покрытия/доступности изменились после расчёта. Пересчитайте график заново.",
                color = DRAFT_ERROR, fontSize = 13.sp, modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp)
            )
        }

        if (draft == null) {
            Text(
                "Черновик графика ещё не рассчитан.",
                color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 12.dp)
            )
        } else {
            DraftSummary(draft, stores, employees)
        }
    }

    if (confirmApply && draft != null) {
        val label = monthTitle(YearMonth.parse(draft.month.take(7)))
        DraftConfirmDialog(
            "Применить график", "Применить рассчитанный график на $label? Смены на редактируемые даты этого месяца будут заменены.", "Применить",
            onDismiss = { confirmApply = false }
        ) {
            confirmApply = false
            applying = true
            applyDraft(scope, scheduleApi, draft, replace = false, onDraft, { onApplied(); planPromptMonth = draft.month.take(7) }, onNeedReplace = { replaceCount = it }) { applying = false }
        }
    }
    val n = replaceCount
    if (n != null && draft != null) {
        DraftConfirmDialog(
            "Заменить смены", "На этот месяц уже есть $n смен(ы) на редактируемые даты — заменить их?", "Заменить",
            onDismiss = { replaceCount = null }
        ) {
            replaceCount = null
            applying = true
            applyDraft(scope, scheduleApi, draft, replace = true, onDraft, { onApplied(); planPromptMonth = draft.month.take(7) }, onNeedReplace = {}) { applying = false }
        }
    }
    planPromptMonth?.let { ym ->
        DraftConfirmDialog(
            "График сохранён", "График сохранён. Рассчитать персональные планы на этот месяц?", "Рассчитать планы",
            onDismiss = { planPromptMonth = null }
        ) {
            planPromptMonth = null
            Nav.open(Page.MonthPlan)
        }
    }
    if (staffing) StaffingDialog(scheduleApi, stores.values.sortedBy { it.name }) { staffing = false }
    if (availability) AvailabilityDialog(scheduleApi, employees) { availability = false }
}

private fun applyDraft(
    scope: CoroutineScope, api: ScheduleApi, draft: ScheduleDraft, replace: Boolean,
    onDraft: (ScheduleDraft?) -> Unit, onApplied: () -> Unit, onNeedReplace: (Int) -> Unit, done: () -> Unit
) {
    scope.launch {
        runCatching { api.applyDraft(draft.id, replace) }
            .onSuccess { res ->
                val applied = (res["applied"].str() == "true")
                if (!applied && res["requires_replace_confirmation"].str() == "true") {
                    onNeedReplace(res["existing_editable_shifts"].dbl().toInt())
                } else {
                    val d = res["draft"].obj()
                    onDraft(ScheduleDraft(d["id"].dbl().toInt(), d["month"].str().ifEmpty { draft.month }, d["status"].str().ifEmpty { draft.status }, d["blocking_errors"].arr().map { it.obj()["message"].str() }, draft.items))
                    if (applied) { Toaster.show("График сохранён"); onApplied() }
                }
            }
            .onFailure { e ->
                val code = (e as? ApiException)?.code
                when (code) {
                    "stale_draft" -> { Toaster.show("Черновик устарел: график изменился — пересчитайте", true); onDraft(ScheduleDraft(draft.id, draft.month, "stale", draft.blocking, draft.items)) }
                    "blocking_errors" -> Toaster.show("В черновике есть блокирующие ошибки — сначала устраните их", true)
                    else -> Toaster.show(e.message ?: "Не удалось применить график", true)
                }
            }
        done()
    }
}

@Composable
private fun DraftSummary(draft: ScheduleDraft, stores: Map<String, StoreInfo>, employees: List<EmployeeListItem>) {
    val monthTxt = monthTitle(YearMonth.parse(draft.month.take(7)))
    Text(
        "Месяц: $monthTxt · Статус: ${statusLabel(draft.status)} · смен: ${draft.items.size}",
        color = T2Colors.hint, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 8.dp)
    )
    val byEmp = draft.byEmployee()
    if (byEmp.isEmpty()) {
        Text("Нет назначенных смен в черновике.", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 12.dp))
        return
    }
    val names = employees.associate { it.id to it.full_name }
    Column(modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        byEmp.entries.sortedBy { (names[it.key] ?: "").lowercase() }.forEach { (empId, byDate) ->
            val items = byDate.values
            val hours = items.sumOf { it["hours"].dbl() }
            val perStore = items.groupingBy { it["store_id"].str() }.eachCount()
            val breakdown = perStore.entries.joinToString("; ") { (sid, c) -> "${stores[sid]?.name ?: sid}: $c смен" }
            val tiers = items.map { it["explanation"].obj()["tier"].str() }.filter { it.isNotEmpty() }.distinct().joinToString("; ") { tierLabel(it) }
            val cardShape = RoundedCornerShape(T2Radius.sm)
            Column(modifier = Modifier.fillMaxWidth().clip(cardShape).background(T2Colors.surface2).border(1.dp, T2Colors.border, cardShape).padding(12.dp)) {
                Text(names[empId] ?: "#$empId", fontWeight = FontWeight.Bold, fontSize = 14.sp)
                Text("смен: ${items.size} · часов: ${if (hours % 1.0 == 0.0) hours.toLong().toString() else hours.toString()}", color = T2Colors.hint, fontSize = 12.sp)
                Text(breakdown, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp))
                if (tiers.isNotEmpty()) Text(tiers, color = T2Colors.hint, fontSize = 12.sp)
            }
        }
    }
}

/** Port of openStaffingEditor: required employees and trainee limit per weekday for a store. */
@Composable
private fun StaffingDialog(api: ScheduleApi, stores: List<StoreInfo>, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var storeId by remember { mutableStateOf(stores.firstOrNull()?.id) }
    var loaded by remember { mutableStateOf<Boolean?>(null) }
    val required = remember { mutableStateOf(List(7) { "0" }) }
    val trainees = remember { mutableStateOf(List(7) { "1" }) }
    var busy by remember { mutableStateOf(false) }

    LaunchedEffect(storeId) {
        val sid = storeId ?: return@LaunchedEffect
        loaded = null
        runCatching { api.getStaffing(sid) }.onSuccess { data ->
            val byWd = data["rows"].arr().map { it.obj() }.filter { it["weekday"].str().isNotEmpty() && it["weekday"].str() != "null" }.associateBy { it["weekday"].dbl().toInt() }
            required.value = List(7) { wd -> (byWd[wd]?.get("required_employees")?.dbl()?.toInt() ?: 0).toString() }
            trainees.value = List(7) { wd -> (byWd[wd]?.get("max_trainees")?.dbl()?.toInt() ?: 1).toString() }
            loaded = true
        }.onFailure { loaded = false }
    }

    SheetDialog("Требования к покрытию точки", onDismiss) {
        SelectField("Точка", stores.firstOrNull { it.id == storeId }?.name ?: "", stores.map { it.name }) { n -> stores.firstOrNull { it.name == n }?.let { storeId = it.id } }
        Spacer(Modifier.height(12.dp))
        when (loaded) {
            null -> Text("Загрузка…", color = T2Colors.hint, fontSize = 13.sp)
            false -> Text("Ошибка загрузки", color = T2Colors.hint, fontSize = 13.sp)
            true -> {
                Text("Требуемое число сотрудников и лимит стажёров по дням недели:", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(bottom = 8.dp))
                DRAFT_WEEKDAYS.forEachIndexed { wd, label ->
                    Row(modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(label, fontWeight = FontWeight.Bold, modifier = Modifier.width(36.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Field("", required.value[wd], { v -> required.value = required.value.toMutableList().also { it[wd] = v.filter(Char::isDigit).take(3) } }, numeric = true, placeholder = "чел.", fill = T2Colors.surface2)
                        }
                        Column(modifier = Modifier.weight(1f)) {
                            Field("", trainees.value[wd], { v -> trainees.value = trainees.value.toMutableList().also { it[wd] = v.filter(Char::isDigit).take(3) } }, numeric = true, placeholder = "стаж.", fill = T2Colors.surface2)
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
                MainButton(if (busy) "Сохраняем…" else "Сохранить", enabled = !busy) {
                    val sid = storeId ?: return@MainButton
                    busy = true
                    scope.launch {
                        runCatching { api.saveStaffing(sid, List(7) { wd -> Triple(wd, required.value[wd].toIntOrNull() ?: 0, trainees.value[wd].toIntOrNull() ?: 0) }) }
                            .onSuccess { Toaster.show("Покрытие сохранено"); onDismiss() }
                            .onFailure { Toaster.show(it.message ?: "Ошибка", true); busy = false }
                    }
                }
            }
        }
    }
}

/** Port of openAvailabilityEditor: vacation / unavailable days of an employee (feeds the auto schedule). */
@Composable
private fun AvailabilityDialog(api: ScheduleApi, employees: List<EmployeeListItem>, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val sorted = remember(employees) { employees.sortedBy { it.full_name.lowercase() } }
    var empId by remember { mutableStateOf(sorted.firstOrNull()?.id) }
    var rows by remember { mutableStateOf<List<JsonObject>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var reload by remember { mutableStateOf(0) }
    var kind by remember { mutableStateOf("vacation") }
    var date by remember { mutableStateOf(LocalDate.now(ZoneId.of("Europe/Moscow")).toString()) }
    val kindLabels = mapOf("vacation" to "Отпуск", "unavailable" to "Недоступен")

    LaunchedEffect(empId, reload) {
        val id = empId ?: return@LaunchedEffect
        rows = null; failed = false
        runCatching { api.getAvailability(id) }.onSuccess { rows = it["rows"].arr().map { r -> r.obj() } }.onFailure { failed = true }
    }

    SheetDialog("Недоступность / отпуск сотрудника", onDismiss) {
        SelectField("Сотрудник", sorted.firstOrNull { it.id == empId }?.full_name ?: "", sorted.map { it.full_name }) { n -> sorted.firstOrNull { it.full_name == n }?.let { empId = it.id } }
        Spacer(Modifier.height(12.dp))
        val list = rows
        when {
            failed -> Text("Ошибка загрузки", color = T2Colors.hint, fontSize = 13.sp)
            list == null -> Text("Загрузка…", color = T2Colors.hint, fontSize = 13.sp)
            list.isEmpty() -> Text("Нет отметок недоступности", color = T2Colors.hint, fontSize = 13.sp)
            else -> list.forEach { r ->
                Row(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(kindLabels[r["kind"].str()] ?: r["kind"].str(), fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                        Text(r["specific_date"].str().take(10), color = T2Colors.hint, fontSize = 12.sp)
                    }
                    GhostButton("Убрать") {
                        val id = empId ?: return@GhostButton
                        scope.launch {
                            runCatching { api.deleteAvailability(id, r["id"].dbl().toInt()) }
                                .onSuccess { reload++ }
                                .onFailure { Toaster.show(it.message ?: "Ошибка", true) }
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.weight(1f)) {
                SelectField("Тип", kindLabels[kind] ?: "", kindLabels.values.toList()) { n -> kind = kindLabels.entries.first { it.value == n }.key }
            }
            Column(modifier = Modifier.weight(1f)) {
                Field("Дата", date, { date = it }, placeholder = "ГГГГ-ММ-ДД", fill = T2Colors.surface2)
            }
        }
        Spacer(Modifier.height(12.dp))
        MainButton("Добавить", enabled = true) {
            val id = empId
            if (id == null || runCatching { LocalDate.parse(date.trim()) }.isFailure) { Toaster.show("Укажите дату в формате ГГГГ-ММ-ДД", true); return@MainButton }
            scope.launch {
                runCatching { api.addAvailability(id, kind, date.trim()) }
                    .onSuccess { Toaster.show("Добавлено"); reload++ }
                    .onFailure { Toaster.show(it.message ?: "Ошибка", true) }
            }
        }
    }
}

package ru.t2sales.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.CircularProgressIndicator
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
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
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import ru.t2sales.android.AppContainer
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.api.MetricDef
import ru.t2sales.shared.api.MonthSummaryResponse
import ru.t2sales.shared.api.MonthSummaryRow
import ru.t2sales.shared.api.StoreDailyPlan
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Radius
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId

private val ROLES = mapOf("trainee" to "Стажёр", "employee" to "Продавец", "senior" to "Старший продавец", "manager" to "Руководитель", "supervisor" to "Супервайзер", "admin" to "Администратор")
private enum class PlanSort { Name, Role, Shifts }

private fun tone(f: Double, pct: Double): Color = when {
    pct >= 100 -> T2Colors.success
    pct >= 50 -> T2Colors.warning
    f > 0 -> T2Colors.text
    else -> T2Colors.danger
}
private fun n(v: Double) = if (v % 1.0 == 0.0) v.toLong().toString() else v.toString()

/** Port of #page-monthplan: month nav, employees table with tone cells, manual plan editing, today's store plans. */
@Composable
fun MonthPlanScreen(container: AppContainer, me: MeResponse) {
    val canManage = me.role == "manager" || me.role == "admin" || me.is_manager == true
    val scope = rememberCoroutineScope()
    val month = PlanMonthState.month
    var data by remember { mutableStateOf<MonthSummaryResponse?>(null) }
    var failed by remember { mutableStateOf(false) }
    var stores by remember { mutableStateOf<List<StoreDailyPlan>?>(null) }
    var metrics by remember { mutableStateOf<List<MetricDef>>(FALLBACK_METRICS) }
    var reload by remember { mutableStateOf(0) }
    var showAll by remember { mutableStateOf(false) }
    var sort by remember { mutableStateOf(PlanSort.Name) }
    var asc by remember { mutableStateOf(true) }
    var metricSort by remember { mutableStateOf<String?>(null) }
    var editEmp by remember { mutableStateOf<MonthSummaryRow?>(null) }
    var editStore by remember { mutableStateOf<StoreDailyPlan?>(null) }

    LaunchedEffect(Unit) {
        runCatching { container.salesApi.getMetrics().items }.onSuccess { m -> if (m.isNotEmpty()) metrics = m.map { MetricDef(it.id, it.label ?: it.id, it.short_label, it.unit) } }
    }
    LaunchedEffect(month, reload) {
        data = null; failed = false
        runCatching { container.plansApi.employeesMonth(month.toString()) }.onSuccess { data = it }.onFailure { failed = true }
        runCatching { container.plansApi.storeDaily().stores }.onSuccess { stores = it }.onFailure { stores = emptyList() }
    }

    if (T2Colors.uiBeta) {
        MonthPlanBeta(container, month, data, failed, stores, metrics, canManage, showAll, { showAll = !showAll },
            onEditEmp = { editEmp = it }, onEditStore = { editStore = it }, onRetry = { reload++ }, onReload = { reload++ })
        MonthPlanBetaOverlays(container, scope, metrics, month, editEmp, { editEmp = it }, editStore, { editStore = it }) { reload++ }
        return
    }
    PageSection("Планы и факт за месяц") {
        MonthNav(month) { PlanMonthState.month = it }
        val d = data
        when {
            failed -> ErrorState("Планы месяца недоступны", onRetry = { reload++ })
            d == null -> LoadingBlock(Modifier.padding(16.dp))
            else -> {
                Text("Сотрудников: ${d.rows.size} \u00B7 ост. дней: ${d.remaining_days ?: "\u2014"}", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                if (d.rows.isEmpty()) {
                    Text("Нет данных за $month", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
                } else {
                    Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.End) {
                        MChipButton(if (showAll) "Скрыть лишние метрики" else "Показать все метрики") { showAll = !showAll }
                    }
                    val cols = if (showAll) metrics else metrics.take(6)
                    val sorted = d.rows.sortedWith { a, b ->
                        val ms = metricSort
                        val c = if (ms != null) (a.fact[ms] ?: 0.0).compareTo(b.fact[ms] ?: 0.0) else when (sort) {
                            PlanSort.Name -> a.full_name.compareTo(b.full_name, true)
                            PlanSort.Role -> (ROLES[a.role] ?: a.role).compareTo(ROLES[b.role] ?: b.role, true)
                            PlanSort.Shifts -> (a.shifts ?: 0).compareTo(b.shifts ?: 0)
                        }
                        if (asc) c else -c
                    }
                    fun sortStatic(k: PlanSort) { metricSort = null; if (sort == k) asc = !asc else { sort = k; asc = true } }
                    fun sortMetric(id: String) { if (metricSort == id) asc = !asc else { metricSort = id; asc = true } }
                    // a wide table: it keeps a readable width per column and scrolls sideways on a phone
                    Box(modifier = Modifier.padding(top = 8.dp).horizontalScroll(rememberScrollState())) {
                        Column(Modifier.width((330 + cols.size * 92).dp)) {
                            Row(modifier = Modifier.fillMaxWidth().background(T2Colors.surface2).padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                                Head("ФИО", metricSort == null && sort == PlanSort.Name, asc, Modifier.weight(2.5f)) { sortStatic(PlanSort.Name) }
                                Head("Роль", metricSort == null && sort == PlanSort.Role, asc, Modifier.weight(1.8f)) { sortStatic(PlanSort.Role) }
                                Head("Смены", metricSort == null && sort == PlanSort.Shifts, asc, Modifier.weight(1.5f)) { sortStatic(PlanSort.Shifts) }
                                cols.forEach { m -> Head(m.label ?: m.id, metricSort == m.id, asc, Modifier.weight(1f)) { sortMetric(m.id) } }
                            }
                            sorted.forEach { r ->
                                Row(
                                    modifier = Modifier.fillMaxWidth().then(if (canManage) Modifier.clickable { editEmp = r } else Modifier).padding(horizontal = 16.dp, vertical = 14.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(r.full_name, fontSize = 13.sp, modifier = Modifier.weight(2.5f))
                                    Text(ROLES[r.role] ?: r.role, fontSize = 13.sp, modifier = Modifier.weight(1.8f))
                                    Text("${r.shifts ?: 0} \u00B7 ост. ${r.remaining_shifts ?: 0}", fontSize = 13.sp, modifier = Modifier.weight(1.5f))
                                    cols.forEach { m ->
                                        val f = r.fact[m.id] ?: 0.0
                                        Text(n(f), fontSize = 13.sp, color = tone(f, r.pct[m.id] ?: 0.0), modifier = Modifier.weight(1f))
                                    }
                                }
                                Box(Modifier.fillMaxWidth().height(1.dp).background(T2Colors.border))
                            }
                            d.totals?.let { t ->
                                if (t.fact.isNotEmpty()) Row(modifier = Modifier.fillMaxWidth().background(T2Colors.surface2).padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Text("Итого сеть", fontWeight = FontWeight.Bold, fontSize = 13.sp, modifier = Modifier.weight(2.5f))
                                    Text("\u2014", fontSize = 13.sp, modifier = Modifier.weight(1.8f))
                                    Text("\u2014", fontSize = 13.sp, modifier = Modifier.weight(1.5f))
                                    cols.forEach { m ->
                                        val f = t.fact[m.id] ?: 0.0
                                        Text(n(f), fontWeight = FontWeight.Bold, fontSize = 13.sp, color = tone(f, t.pct[m.id] ?: 0.0), modifier = Modifier.weight(1f))
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (canManage) {
        Spacer(Modifier.height(12.dp))
        PageSection("Автоматический расчёт персональных планов") {
            EmployeePlanDraftSection(container, metrics) { reload++ }
        }
    }

    Spacer(Modifier.height(12.dp))
    PageSection("Дневные планы точек сегодня") {
        val list = stores
        when {
            list == null -> LoadingBlock(Modifier.padding(16.dp))
            list.isEmpty() -> EmptyText("Нет данных")
            else -> list.forEach { st ->
                val color = st.color?.let { runCatching { Color(("FF" + it.removePrefix("#")).toLong(16)) }.getOrNull() } ?: T2Colors.blue
                val shape = RoundedCornerShape(T2Radius.default)
                Row(
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp).fillMaxWidth().height(androidx.compose.foundation.layout.IntrinsicSize.Min)
                        .clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape)
                ) {
                    Box(Modifier.width(4.dp).fillMaxHeight().background(color))
                    Column(modifier = Modifier.weight(1f)) {
                        Row(
                            modifier = Modifier.fillMaxWidth().then(if (canManage) Modifier.clickable { editStore = st } else Modifier).padding(14.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(color.copy(alpha = 0.2f)), contentAlignment = Alignment.Center) {
                                Text(st.name.take(2).uppercase(), color = color, fontWeight = FontWeight.ExtraBold, fontSize = 14.sp)
                            }
                            Spacer(Modifier.width(12.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(st.name, fontWeight = FontWeight.ExtraBold, fontSize = 15.sp)
                                Text("${st.code ?: ""} \u00B7 дневной план" + if (st.has_plan) "" else " \u00B7 план на месяц не задан", color = T2Colors.hint, fontSize = 12.sp)
                            }
                            if (canManage) Text("\u203A", color = T2Colors.hint, fontSize = 18.sp)
                        }
                        Row(modifier = Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            metrics.take(8).forEach { m ->
                                val chip = RoundedCornerShape(T2Radius.sm)
                                Column(
                                    modifier = Modifier.weight(1f).clip(chip).background(T2Colors.surface2).border(1.dp, T2Colors.border, chip).padding(horizontal = 4.dp, vertical = 10.dp),
                                    horizontalAlignment = Alignment.CenterHorizontally
                                ) {
                                    Text(n(st.plan[m.id] ?: 0.0), fontSize = 16.sp, fontWeight = FontWeight.Black)
                                    Text((m.label ?: m.id).uppercase(), color = T2Colors.hint, fontSize = 9.sp, fontWeight = FontWeight.Bold, maxLines = 1)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    editEmp?.let { r ->
        PlanEditDialog(
            title = "План: ${r.full_name}", note = "Месяц $month. Дневной = остаток / смены.", metrics = metrics,
            load = { container.plansApi.employeePlan(r.employee_id, month.toString()) },
            onDismiss = { editEmp = null },
            onSave = { body ->
                scope.launch {
                    runCatching { container.plansApi.saveEmployeePlan(r.employee_id, body) }
                        .onSuccess { T2Toast.show("План сохранён"); editEmp = null; reload++ }
                        .onFailure { T2Toast.show(it.message ?: "Ошибка", true) }
                }
            },
            month = month.toString()
        )
    }
    editStore?.let { st ->
        val cur = YearMonth.from(LocalDate.now(ZoneId.of("Europe/Moscow"))).toString()
        PlanEditDialog(
            title = "План точки: ${st.name}", note = "Месяц $cur, план на всю точку целиком. Дневной = остаток / оставшиеся дни.", metrics = metrics,
            load = { container.plansApi.storePlan(st.store_id, cur) },
            onDismiss = { editStore = null },
            onSave = { body ->
                scope.launch {
                    runCatching { container.plansApi.saveStorePlan(st.store_id, body) }
                        .onSuccess { T2Toast.show("План точки сохранён"); editStore = null; reload++ }
                        .onFailure { T2Toast.show(it.message ?: "Ошибка", true) }
                }
            },
            month = cur
        )
    }
}

@Composable
private fun Head(label: String, active: Boolean, asc: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val arrow = if (active) (if (asc) "\u2191" else "\u2193") else "\u21C5"
    Text("$label $arrow", color = if (active) T2Colors.primary else T2Colors.hint, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, maxLines = 1, modifier = modifier.clickable(onClick = onClick))
}

@Composable
private fun PlanEditDialog(
    title: String, note: String, metrics: List<MetricDef>, month: String,
    load: suspend () -> kotlinx.serialization.json.JsonObject,
    onDismiss: () -> Unit, onSave: (kotlinx.serialization.json.JsonObject) -> Unit
) {
    val values = remember { mutableStateMapOf<String, String>() }
    var loaded by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        val p = runCatching { load() }.getOrDefault(kotlinx.serialization.json.JsonObject(emptyMap()))
        metrics.forEach { m ->
            var v = (p[m.id] as? JsonPrimitive)?.doubleOrNull
            if (v == null && m.id == "credit_issued") v = (p["credit"] as? JsonPrimitive)?.doubleOrNull
            values[m.id] = n(v ?: 0.0)
        }
        loaded = true
    }
    SheetDialog(title, onDismiss) {
        if (!loaded) { LoadingBlock(); return@SheetDialog }
        Text(note, color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(bottom = 12.dp))
        metrics.forEach { m ->
            Field(m.label + (m.unit?.let { " ($it)" } ?: ""), values[m.id] ?: "", { v -> values[m.id] = v.filter { it.isDigit() || it == '.' } }, fill = T2Colors.surface2)
            Spacer(Modifier.height(14.dp))
        }
        MainButton("Сохранить", enabled = true) {
            val body = buildJsonObject {
                put("month", JsonPrimitive(month))
                metrics.forEach { m -> put(m.id, JsonPrimitive(values[m.id]?.toDoubleOrNull() ?: 0.0)) }
                values["credit_issued"]?.let { put("credit", JsonPrimitive(it.toDoubleOrNull() ?: 0.0)) }
            }
            onSave(body)
        }
    }
}

// ======================= Beta UI 3.0 «Ночная смена» =======================

/** Beta month plan: employees as grouped cells (name / role / shifts + blended %), drafts + daily store plans below. */
@Composable
private fun MonthPlanBeta(
    container: AppContainer, month: java.time.YearMonth, data: MonthSummaryResponse?, failed: Boolean, stores: List<StoreDailyPlan>?,
    metrics: List<MetricDef>, canManage: Boolean, showAll: Boolean, onToggleAll: () -> Unit,
    onEditEmp: (MonthSummaryRow) -> Unit, onEditStore: (StoreDailyPlan) -> Unit, onRetry: () -> Unit, onReload: () -> Unit
) {
    val d = data
    U3LargeTitle("Планы", monthLabel(month))
    MonthNav(month) { PlanMonthState.month = it }
    Spacer(Modifier.height(8.dp))
    when {
        failed -> ErrorState("Планы месяца недоступны", onRetry = onRetry)
        d == null -> SkeletonBlock(Modifier.fillMaxWidth().height(200.dp), 22.dp)
        d.rows.isEmpty() -> EmptyText("Нет данных за $month")
        else -> {
            Text("Сотрудников: ${d.rows.size} · ост. дней: ${d.remaining_days ?: "—"}", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 4.dp, vertical = 6.dp))
            val cols = if (showAll) metrics else metrics.take(4)
            U3GroupHead("Сотрудники", if (showAll) "Ключевые метрики" else "Все метрики", onToggleAll)
            U3Group {
                d.rows.forEachIndexed { i, r ->
                    if (i > 0) U3Sep()
                    val pcts = cols.mapNotNull { m -> r.pct[m.id] }.filter { it > 0 }
                    val p = if (pcts.isNotEmpty()) (pcts.sum() / pcts.size).toInt() else 0
                    U3Cell(
                        r.full_name, "${ROLES[r.role] ?: r.role} · смен ${r.shifts ?: 0} · ост. ${r.remaining_shifts ?: 0}",
                        leading = { U3Tile(r.full_name.take(1).uppercase(), tint = u3Tone(p)) },
                        trailing = { Row(verticalAlignment = Alignment.CenterVertically) { U3Pie(p, 18.dp); Spacer(Modifier.width(8.dp)); U3Value("$p%", u3Tone(p)) } },
                        onClick = if (canManage) ({ onEditEmp(r) }) else null
                    )
                    Text(
                        cols.joinToString("  ·  ") { m -> "${m.short_label ?: m.label ?: m.id} ${n(r.fact[m.id] ?: 0.0)}" },
                        color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(start = 70.dp, end = 16.dp, bottom = 10.dp)
                    )
                }
            }
        }
    }

    if (canManage) {
        U3GroupHead("Автоматический расчёт")
        U3Group {
            Box(Modifier.padding(horizontal = 4.dp, vertical = 4.dp)) {
                EmployeePlanDraftSection(container, metrics, onApplied = onReload)
            }
        }
    }

    U3GroupHead("Дневные планы точек сегодня")
    val list = stores
    when {
        list == null -> SkeletonBlock(Modifier.fillMaxWidth().height(120.dp), 22.dp)
        list.isEmpty() -> EmptyText("Нет данных")
        else -> U3Group {
            list.forEachIndexed { i, st ->
                if (i > 0) U3Sep()
                val color = st.color?.let { runCatching { Color(("FF" + it.removePrefix("#")).toLong(16)) }.getOrNull() } ?: T2Colors.blue
                U3Cell(
                    st.name, "${st.code ?: ""} · дневной план" + if (st.has_plan) "" else " · план на месяц не задан",
                    leading = { U3Tile(st.name.take(2).uppercase(), tint = color, bg = color.copy(alpha = 0.16f)) },
                    trailing = { if (canManage) U3Value("›", T2Colors.hint) },
                    onClick = if (canManage) ({ onEditStore(st) }) else null
                )
                Text(
                    metrics.take(6).joinToString("  ·  ") { m -> "${m.short_label ?: m.label ?: m.id} ${n(st.plan[m.id] ?: 0.0)}" },
                    color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(start = 70.dp, end = 16.dp, bottom = 10.dp)
                )
            }
        }
    }
    Spacer(Modifier.height(96.dp))
}

/** The two edit sheets, kept outside the beta list so their state lives next to the screen's. */
@Composable
private fun MonthPlanBetaOverlays(
    container: AppContainer, scope: kotlinx.coroutines.CoroutineScope, metrics: List<MetricDef>, month: java.time.YearMonth,
    editEmp: MonthSummaryRow?, onEditEmp: (MonthSummaryRow?) -> Unit,
    editStore: StoreDailyPlan?, onEditStore: (StoreDailyPlan?) -> Unit, onReload: () -> Unit
) {
    editEmp?.let { r ->
        PlanEditDialog(
            title = "План: ${r.full_name}", note = "Месяц $month. Дневной = остаток / смены.", metrics = metrics,
            load = { container.plansApi.employeePlan(r.employee_id, month.toString()) },
            onDismiss = { onEditEmp(null) },
            onSave = { body ->
                scope.launch {
                    runCatching { container.plansApi.saveEmployeePlan(r.employee_id, body) }
                        .onSuccess { T2Toast.show("План сохранён"); onEditEmp(null); onReload() }
                        .onFailure { T2Toast.show(it.message ?: "Ошибка", true) }
                }
            },
            month = month.toString()
        )
    }
    editStore?.let { st ->
        val cur = YearMonth.from(LocalDate.now(ZoneId.of("Europe/Moscow"))).toString()
        PlanEditDialog(
            title = "План точки: ${st.name}", note = "Месяц $cur, план на всю точку целиком. Дневной = остаток / оставшиеся дни.", metrics = metrics,
            load = { container.plansApi.storePlan(st.store_id, cur) },
            onDismiss = { onEditStore(null) },
            onSave = { body ->
                scope.launch {
                    runCatching { container.plansApi.saveStorePlan(st.store_id, body) }
                        .onSuccess { T2Toast.show("План точки сохранён"); onEditStore(null); onReload() }
                        .onFailure { T2Toast.show(it.message ?: "Ошибка", true) }
                }
            },
            month = cur
        )
    }
}

package ru.t2sales.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
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
import kotlin.math.roundToLong
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import ru.t2sales.android.AppContainer
import ru.t2sales.shared.api.ApiException
import ru.t2sales.shared.api.MetricDef
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Radius

private val PLAN_ERROR = Color(0xFFE5484D)
private val PLAN_WARNING = Color(0xFFC77700)

private class PlanDraft(val id: Int, val month: String, val status: String, val blocking: List<String>, val items: List<JsonObject>)

private fun statusLabel(s: String) = when (s) { "applied" -> "Применён"; "stale" -> "Устарел"; else -> "Черновик" }

private fun tierLabel(t: String) = when (t) {
    "employee_store" -> "по истории сотрудника на этой точке"
    "store_avg" -> "по среднему показателю точки"
    "org_avg" -> "по среднему показателю сети"
    else -> "пропорционально сменам (истории продаж нет)"
}

/** Whole numbers with a Russian thousands separator - hides float artifacts like 20907.120000000003. */
private fun fmtMetric(v: Double): String = "%,d".format(v.roundToLong()).replace(',', ' ')

private fun explanation(item: JsonObject): String {
    val byStore = item["by_store"].arr()
    if (byStore.isEmpty()) return "Нет запланированных смен на этот месяц."
    return byStore.joinToString("; ") { s -> val o = s.obj(); "${o["store_name"].str()}: ${o["future_shifts"].dbl().toInt()} смен, ${tierLabel(o["tier"].str())}" }
}

private fun blockingOf(d: JsonObject?) = d?.get("blocking_errors")?.arr()?.map { it.obj() }?.map { "${it["store_name"].str()}: ${it["message"].str()}" }.orEmpty()

/** Port of #employeePlanDraftSection (plans-bfq): month, calculate, apply, blocking errors and per-employee cards with every metric. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun EmployeePlanDraftSection(container: AppContainer, metrics: List<MetricDef>, onApplied: () -> Unit) {
    val scope = rememberCoroutineScope()
    val nowMonth = remember { YearMonth.from(LocalDate.now(ZoneId.of("Europe/Moscow"))) }
    var month by remember { mutableStateOf(nowMonth.plusMonths(1)) } // next month is the default
    var draft by remember { mutableStateOf<PlanDraft?>(null) }
    var generating by remember { mutableStateOf(false) }
    var applying by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }

    fun generate() {
        generating = true
        scope.launch {
            runCatching {
                val d = container.plansApi.generatePlanDraft(month.atDay(1).toString())
                PlanDraft(d["draft_id"].dbl().toInt(), d["month"].str(), d["status"].str(), d["blocking_errors"].arr().map { it.obj() }.map { "${it["store_name"].str()}: ${it["message"].str()}" }, d["items"].arr().map { it.obj() })
            }.onSuccess { draft = it; T2Toast.show("Черновик планов на ${monthLabel(YearMonth.parse(it.month.take(7)))} рассчитан") }
                .onFailure { T2Toast.show(it.message ?: "Не удалось рассчитать черновик", true) }
            generating = false
        }
    }

    // opening the page picks up the latest already calculated draft for the selected month (if any)
    LaunchedEffect(month) {
        if (PlanDraftRequest.month != null) return@LaunchedEffect
        draft = runCatching { container.plansApi.latestPlanDraft(month.atDay(1).toString()) }.getOrNull()?.let { v ->
            val d = v["draft"] as? JsonObject ?: return@let null
            PlanDraft(d["id"].dbl().toInt(), d["month"].str(), d["status"].str(), blockingOf(d), v["items"].arr().map { it.obj() })
        }
    }
    // «Рассчитать персональные планы?» after applying a schedule draft: select that month and calculate right away
    val requested = PlanDraftRequest.month
    LaunchedEffect(requested) {
        val m = requested ?: return@LaunchedEffect
        PlanDraftRequest.month = null
        month = m
        generate()
    }

    val shape = RoundedCornerShape(T2Radius.default)
    Column(modifier = Modifier.fillMaxWidth()) {
        FlowRow(
            modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Column(modifier = Modifier.width(200.dp)) {
                SelectField("", monthLabel(month), listOf(monthLabel(nowMonth), monthLabel(nowMonth.plusMonths(1)))) { picked -> month = if (picked == monthLabel(nowMonth)) nowMonth else nowMonth.plusMonths(1) }
            }
            Column(modifier = Modifier.width(200.dp)) {
                MainButton(if (generating) "Считаем…" else "Рассчитать планы", enabled = !generating) { generate() }
            }
            val d = draft
            if (d != null && d.status == "draft" && d.blocking.isEmpty()) {
                Column(modifier = Modifier.width(200.dp)) {
                    MainButton(if (applying) "Применяем…" else "Применить планы", enabled = !applying) { confirm = true }
                }
            }
        }

        val d = draft
        if (d == null) {
            Text("Черновик ещё не рассчитан.", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 12.dp))
        } else {
            Text(
                "Месяц: ${monthLabel(YearMonth.parse(d.month.take(7)))} · Статус: ${statusLabel(d.status)} · сотрудников: ${d.items.size}",
                color = T2Colors.hint, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 8.dp)
            )
            if (d.status == "stale") Text("Черновик устарел: расписание или план точки изменились после расчёта. Пересчитайте план заново.", color = PLAN_ERROR, fontSize = 13.sp, modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp))
            if (d.blocking.isNotEmpty()) Column(modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp)) {
                Text("Есть блокирующие ошибки — применить план нельзя, пока они не устранены:", color = PLAN_ERROR, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                d.blocking.forEach { Text("• $it", color = PLAN_ERROR, fontSize = 13.sp, modifier = Modifier.padding(start = 8.dp, top = 2.dp)) }
            }
            if (d.items.isEmpty()) {
                Text("Нет сотрудников с запланированными сменами на этот месяц.", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 12.dp))
            } else Column(modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                d.items.forEach { item ->
                    Column(modifier = Modifier.fillMaxWidth().clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape).padding(12.dp)) {
                        Text(item["full_name"].str(), fontWeight = FontWeight.Bold, fontSize = 14.sp)
                        Text("смен: ${item["total_shifts"].dbl().toInt()}", color = T2Colors.hint, fontSize = 12.sp)
                        val plan = item["final_plan"].obj()
                        FlowRow(modifier = Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            metrics.forEach { m ->
                                Column(modifier = Modifier.width(96.dp)) {
                                    Text(fmtMetric(plan[m.id].dbl()), fontWeight = FontWeight.ExtraBold, fontSize = 15.sp)
                                    Text(m.label ?: m.id, color = T2Colors.hint, fontSize = 11.sp)
                                }
                            }
                        }
                        Text(explanation(item), color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
                        val warnings = item["warnings"].arr().map { it.str() }
                        if (warnings.isNotEmpty()) Text(warnings.joinToString("\n"), color = PLAN_WARNING, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
                    }
                }
            }
        }
    }

    val cur = draft
    if (confirm && cur != null) {
        ConfirmDialog(
            "Применить планы", "Применить рассчитанные планы на ${monthLabel(YearMonth.parse(cur.month.take(7)))}? Текущие персональные планы сотрудников на этот месяц будут перезаписаны.", "Применить",
            onDismiss = { confirm = false }
        ) {
            confirm = false
            applying = true
            scope.launch {
                runCatching { container.plansApi.applyPlanDraft(cur.id) }
                    .onSuccess { res ->
                        val rd = res["draft"].obj()
                        draft = PlanDraft(rd["id"].dbl().toInt(), rd["month"].str().ifEmpty { cur.month }, rd["status"].str().ifEmpty { cur.status }, blockingOf(rd), cur.items)
                        T2Toast.show("Планы применены")
                        onApplied()
                    }
                    .onFailure { e ->
                        when ((e as? ApiException)?.code) {
                            "stale_draft" -> { T2Toast.show("Черновик устарел: расписание или план точки изменились — пересчитайте план", true); draft = PlanDraft(cur.id, cur.month, "stale", cur.blocking, cur.items) }
                            "blocking_errors" -> T2Toast.show("В черновике есть блокирующие ошибки — сначала устраните их", true)
                            else -> T2Toast.show(e.message ?: "Не удалось применить план", true)
                        }
                    }
                applying = false
            }
        }
    }
}

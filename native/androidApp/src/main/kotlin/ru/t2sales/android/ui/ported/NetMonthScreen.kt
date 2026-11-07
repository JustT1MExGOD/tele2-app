package ru.t2sales.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.CircularProgressIndicator
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.t2sales.android.AppContainer
import ru.t2sales.shared.api.MetricDef
import ru.t2sales.shared.api.MonthSummaryResponse
import ru.t2sales.shared.api.StoreMonthRow
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Hero

private val BLUE = T2Colors.blue
private val ROLES = mapOf("trainee" to "Стажёр", "employee" to "Продавец", "senior" to "Старший продавец", "manager" to "Руководитель", "supervisor" to "Супервайзер", "admin" to "Администратор")

/** Port of #page-netmonth («Динамика выполнения»): network totals, then per-employee and per-store bar cards. */
@Composable
fun NetMonthScreen(container: AppContainer) {
    val month = PlanMonthState.month
    var emp by remember { mutableStateOf<MonthSummaryResponse?>(null) }
    var stores by remember { mutableStateOf<List<StoreMonthRow>>(emptyList()) }
    var failed by remember { mutableStateOf(false) }
    var metrics by remember { mutableStateOf<List<MetricDef>>(FALLBACK_METRICS) }
    var reload by remember { mutableStateOf(0) }

    LaunchedEffect(Unit) {
        runCatching { container.salesApi.getMetrics().items }.onSuccess { m -> if (m.isNotEmpty()) metrics = m.map { MetricDef(it.id, it.label ?: it.id, it.short_label, it.unit) } }
    }
    LaunchedEffect(month, reload) {
        emp = null; failed = false
        runCatching {
            val e = container.plansApi.employeesMonth(month.toString())
            val s = container.plansApi.storesMonth(month.toString()).rows
            e to s
        }.onSuccess { (e, s) -> emp = e; stores = s }.onFailure { failed = true }
    }

    if (T2Colors.uiBeta) {
        NetMonthBeta(month, emp, stores, failed, metrics) { reload++ }
        return
    }
    PageSection("Сеть за месяц") {
        MonthNav(month) { PlanMonthState.month = it }
        val d = emp
        when {
            failed -> ErrorState("Не удалось загрузить", onRetry = { reload++ })
            d == null -> LoadingBlock(Modifier.padding(16.dp))
            else -> {
                val totals = d.totals
                Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                    StoreCard(BLUE) {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            metrics.forEach { m -> BarRow(m.label ?: m.id, totals?.fact?.get(m.id) ?: 0.0, totals?.plan?.get(m.id) ?: 0.0) }
                        }
                    }
                }
                Text("Сотрудников: ${d.rows.size} \u00B7 ост. дней: ${d.remaining_days ?: "\u2014"}", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
            }
        }
    }

    val d = emp
    if (d != null) {
        if (d.rows.isNotEmpty()) {
            Spacer(Modifier.height(12.dp))
            SectionTitle("По сотрудникам")
            Grid(d.rows) { r ->
                BlueCard(metrics, r.full_name, "${ROLES[r.role] ?: r.role} \u00B7 смен ${r.shifts ?: 0} \u00B7 ост. ${r.remaining_shifts ?: 0}", r.fact, r.plan)
            }
        }
        if (stores.isNotEmpty()) {
            Spacer(Modifier.height(12.dp))
            SectionTitle("По точкам")
            Grid(stores) { r -> BlueCard(metrics, r.name, r.code ?: "", r.fact, r.plan) }
        }
    }
}

@Composable
private fun BlueCard(metrics: List<MetricDef>, name: String, sub: String, fact: Map<String, Double>, plan: Map<String, Double>) {
    StoreCard(BLUE) {
        Text(name, fontWeight = FontWeight.ExtraBold, fontSize = 15.sp)
        Text(sub, color = T2Colors.hint, fontSize = 11.sp)
        Column(modifier = Modifier.padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            metrics.take(6).forEach { m -> BarRow(m.label ?: m.id, fact[m.id] ?: 0.0, plan[m.id] ?: 0.0) }
        }
        if (metrics.size > 6) ExtraToggle {
            metrics.drop(6).forEach { m -> BarRow(m.label ?: m.id, fact[m.id] ?: 0.0, plan[m.id] ?: 0.0) }
        }
    }
}

// ======================= Beta UI 3.0 «Ночная смена» =======================

/** Blended completion % across the metrics that have a plan (fact/plan otherwise). */
private fun blendPct(fact: Map<String, Double>, plan: Map<String, Double>, pct: Map<String, Double>?): Int {
    val fromPct = pct?.values?.filter { it > 0 }.orEmpty()
    if (fromPct.isNotEmpty()) return (fromPct.sum() / fromPct.size).toInt()
    var f = 0.0; var p = 0.0
    plan.forEach { (k, v) -> if (v > 0) { p += v; f += fact[k] ?: 0.0 } }
    return if (p > 0) (f / p * 100).toInt() else 0
}

private fun factPlanSub(metrics: List<MetricDef>, fact: Map<String, Double>, plan: Map<String, Double>): String =
    metrics.take(4).joinToString("  ·  ") { m -> "${m.short_label ?: m.label ?: m.id} ${fmtN(fact[m.id] ?: 0.0)}/${fmtN(plan[m.id] ?: 0.0)}" }

/** Beta: hero with the network completion ring + month nav, then grouped employee/store cells. */
@Composable
private fun NetMonthBeta(
    month: java.time.YearMonth, emp: MonthSummaryResponse?, stores: List<StoreMonthRow>,
    failed: Boolean, metrics: List<MetricDef>, onRetry: () -> Unit
) {
    val d = emp
    U3LargeTitle(
        "Динамика",
        if (d != null) "Сотрудников: ${d.rows.size} · ост. дней: ${d.remaining_days ?: "—"} · ${monthLabel(month)}" else monthLabel(month)
    )
    MonthNav(month) { PlanMonthState.month = it }
    Spacer(Modifier.height(8.dp))
    when {
        failed -> ErrorState("Не удалось загрузить", onRetry = onRetry)
        d == null -> SkeletonBlock(Modifier.fillMaxWidth().height(160.dp), 28.dp)
        else -> {
            val totals = d.totals
            val pct = blendPct(totals?.fact.orEmpty(), totals?.plan.orEmpty(), totals?.pct)
            U3Hero {
                U3HeroRow("Выполнение сети", chip = monthLabel(month))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        U3HeroNumber("$pct", "%")
                        Text(
                            metrics.take(3).joinToString("  ·  ") { m -> "${m.short_label ?: m.label ?: m.id} ${fmtN(totals?.fact?.get(m.id) ?: 0.0)}/${fmtN(totals?.plan?.get(m.id) ?: 0.0)}" },
                            color = T2Hero.onHero2, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp)
                        )
                    }
                    U3Ring(pct, "план", size = 84.dp)
                }
            }
            if (d.rows.isNotEmpty()) {
                U3GroupHead("По сотрудникам")
                U3Group {
                    d.rows.forEachIndexed { i, r ->
                        if (i > 0) U3Sep()
                        val p = blendPct(r.fact, r.plan, r.pct)
                        U3Cell(
                            r.full_name, "${ROLES[r.role] ?: r.role} · смен ${r.shifts ?: 0} · ост. ${r.remaining_shifts ?: 0}",
                            leading = { U3Tile(r.full_name.take(1).uppercase(), tint = u3Tone(p)) },
                            trailing = {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    U3Pie(p, 18.dp)
                                    Spacer(Modifier.width(8.dp)); U3Value("$p%", u3Tone(p))
                                }
                            }
                        )
                        Text(
                            factPlanSub(metrics, r.fact, r.plan), color = T2Colors.hint, fontSize = 12.sp,
                            modifier = Modifier.padding(start = 70.dp, end = 16.dp, bottom = 10.dp)
                        )
                    }
                }
            }
            if (stores.isNotEmpty()) {
                U3GroupHead("По точкам")
                U3Group {
                    stores.forEachIndexed { i, r ->
                        if (i > 0) U3Sep()
                        val p = blendPct(r.fact, r.plan, null)
                        U3Cell(
                            r.name, (r.code ?: "") + "  ·  " + factPlanSub(metrics, r.fact, r.plan),
                            leading = { U3IconTile(NavIcons.svStores, tint = u3Tone(p)) },
                            trailing = { U3Value("$p%", u3Tone(p)) }
                        )
                    }
                }
            }
            Spacer(Modifier.height(96.dp))
        }
    }
}

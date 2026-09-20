package ru.t2sales.desktop.ui.plans

import ru.t2sales.desktop.ui.components.LoadingBlock
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
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
import ru.t2sales.desktop.di.AppContainer
import ru.t2sales.desktop.ui.components.PageSection
import ru.t2sales.desktop.ui.supervisor.BarRow
import ru.t2sales.desktop.ui.supervisor.ExtraToggle
import ru.t2sales.desktop.ui.supervisor.Grid
import ru.t2sales.desktop.ui.supervisor.SectionTitle
import ru.t2sales.desktop.ui.supervisor.StoreCard
import ru.t2sales.shared.api.MetricDef
import ru.t2sales.shared.api.MonthSummaryResponse
import ru.t2sales.shared.api.StoreMonthRow
import ru.t2sales.shared.theme.T2Colors

private val BLUE = Color(0xFF2AABEE)
private val ROLES = mapOf("trainee" to "Стажёр", "employee" to "Продавец", "senior" to "Старший продавец", "manager" to "Руководитель", "supervisor" to "Супервайзер", "admin" to "Администратор")

/** Port of #page-netmonth («Динамика выполнения»): network totals, then per-employee and per-store bar cards. */
@Composable
fun NetMonthScreen(container: AppContainer) {
    val month = PlanMonthState.month
    var emp by remember { mutableStateOf<MonthSummaryResponse?>(null) }
    var stores by remember { mutableStateOf<List<StoreMonthRow>>(emptyList()) }
    var failed by remember { mutableStateOf(false) }
    var metrics by remember { mutableStateOf<List<MetricDef>>(FALLBACK_METRICS) }

    LaunchedEffect(Unit) {
        runCatching { container.salesApi.getMetrics().items }.onSuccess { m -> if (m.isNotEmpty()) metrics = m.map { MetricDef(it.id, it.label ?: it.id, it.short_label, it.unit) } }
    }
    LaunchedEffect(month) {
        emp = null; failed = false
        runCatching {
            val e = container.plansApi.employeesMonth(month.toString())
            val s = container.plansApi.storesMonth(month.toString()).rows
            e to s
        }.onSuccess { (e, s) -> emp = e; stores = s }.onFailure { failed = true }
    }

    PageSection("Сеть за месяц") {
        MonthNav(month) { PlanMonthState.month = it }
        val d = emp
        when {
            failed -> Text("Не удалось загрузить", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
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

package ru.t2sales.desktop.ui.plans

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import ru.t2sales.shared.api.MetricDef
import ru.t2sales.shared.theme.T2Colors

/** planMonth is shared between «Планы и факт за месяц» and «Динамика выполнения», like in the web. */
object PlanMonthState {
    var month by mutableStateOf(YearMonth.from(LocalDate.now(ZoneId.of("Europe/Moscow"))))
}

/** Set by the schedule screen after applying a schedule draft: MonthPlan then selects this month and generates the plan draft (web: planDraftMonthSelect + generateEmployeePlanDrafts). */
object PlanDraftRequest {
    var month by mutableStateOf<YearMonth?>(null)
}

val MONTH_NAMES = listOf("Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь")
fun monthLabel(m: YearMonth) = "${MONTH_NAMES[m.monthValue - 1]} ${m.year}"

val FALLBACK_METRICS = listOf(
    MetricDef("sim", "SIM", unit = "шт"), MetricDef("mnp", "MNP", unit = "шт"), MetricDef("pa", "ПА", unit = "шт"),
    MetricDef("combo", "Комбо", unit = "шт"), MetricDef("phones", "Телефоны", unit = "₽"), MetricDef("accessories", "Аксессуары", unit = "₽"),
    MetricDef("settings", "Настройки", unit = "₽"), MetricDef("insurance", "Страховки", unit = "₽"), MetricDef("wink", "Wink", unit = "₽"),
    MetricDef("shpd", "ШПД", unit = "шт"), MetricDef("focus", "ФО", unit = "₽"), MetricDef("credit_request", "Кредит заявка", unit = "шт"),
    MetricDef("credit_issued", "Кредит выдан", unit = "₽"), MetricDef("plotter", "Плоттер", unit = "шт"), MetricDef("hb", "НВ", unit = "шт")
)

@Composable
fun MonthNav(month: java.time.YearMonth, onChange: (java.time.YearMonth) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 4.dp),
        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically
    ) {
        NavCircle("\u2039") { onChange(month.minusMonths(1)) }
        Text(monthLabel(month), fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, modifier = Modifier.widthIn(min = 120.dp).padding(horizontal = 12.dp))
        NavCircle("\u203A") { onChange(month.plusMonths(1)) }
    }
}

@Composable
private fun NavCircle(label: String, onClick: () -> Unit) {
    Box(
        modifier = Modifier.size(40.dp).clip(CircleShape).background(T2Colors.surface2).border(1.dp, T2Colors.border, CircleShape).clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) { Text(label, fontSize = 20.sp) }
}

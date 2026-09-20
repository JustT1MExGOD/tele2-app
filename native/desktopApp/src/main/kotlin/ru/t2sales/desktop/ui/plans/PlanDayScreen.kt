package ru.t2sales.desktop.ui.plans

import ru.t2sales.desktop.ui.components.LoadingBlock
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.roundToInt
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import ru.t2sales.desktop.di.AppContainer
import ru.t2sales.desktop.ui.analytics.arr
import ru.t2sales.desktop.ui.analytics.dbl
import ru.t2sales.desktop.ui.analytics.obj
import ru.t2sales.desktop.ui.analytics.str
import ru.t2sales.desktop.ui.home.ProgressRow
import ru.t2sales.shared.api.ScheduleRow
import ru.t2sales.shared.theme.T2Colors

private val PLAN_KEYS = listOf("sim", "mnp", "pa", "hb", "combo", "phones", "accessories", "insurance")
private val LABELS = mapOf(
    "sim" to "SIM", "mnp" to "MNP", "pa" to "ПА", "hb" to "НВ", "combo" to "Комбо", "phones" to "Телефоны",
    "accessories" to "Аксессуары", "insurance" to "Страховки", "wink" to "Wink", "shpd" to "ШПД", "focus" to "ФО"
)
private val GROUPS = listOf(
    "Блок GI" to listOf("sim" to null, "mnp" to null, "pa" to null, "hb" to null),
    "Товарка" to listOf("combo" to null, "phones" to null, "accessories" to null, "insurance" to null),
    "Ростелеком" to listOf("wink" to null, "shpd" to null, "focus" to null),
    "Кредиты" to listOf("credit_request" to "Заявка", "credit_issued" to "Выданный")
)

private class DayData(
    val stores: List<JsonObject>,
    val fact: Map<String, JsonObject>,
    val plan: Map<String, JsonObject>,
    val staff: Map<String, List<ScheduleRow>>
)

/** Port of #page-plan (loadPlanDay): collapsible card per store with today's staff, plan % and fact/plan bars by block. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PlanDayScreen(container: AppContainer) {
    var data by remember { mutableStateOf<DayData?>(null) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        runCatching {
            val date = LocalDate.now(ZoneId.of("Europe/Moscow")).toString()
            val storesEl: JsonElement = container.plansApi.orgStoresRaw()
            val storeArr = (storesEl as? JsonObject)?.get("stores")?.arr() ?: storesEl.arr()
            val stats = container.reportsApi.getStatsDaily(date)
            val schedules = container.scheduleApi.getSchedules(date)
            val template = container.plansApi.template(date)
            val computed = runCatching { container.plansApi.storeDailyFor(date) }.getOrNull()

            val planMap = mutableMapOf<String, JsonObject>()
            val fromDay = mutableSetOf<String>()
            template.forEach { el ->
                val p = el.obj()
                if (p["plan_date"].str().take(10) == date) { planMap[p["store_id"].str()] = p; fromDay += p["store_id"].str() }
            }
            computed?.stores?.forEach { st ->
                if (st.store_id !in fromDay && st.plan.isNotEmpty()) {
                    planMap[st.store_id] = JsonObject(st.plan.mapValues { kotlinx.serialization.json.JsonPrimitive(it.value) })
                }
            }
            DayData(
                stores = storeArr.map { it.obj() }.sortedBy { it["hours"].dbl() },
                fact = stats.associate { val o = it.obj(); o["store_id"].str().ifEmpty { o["id"].str() } to o },
                plan = planMap,
                staff = schedules.groupBy { it.store_id }
            )
        }.onSuccess { data = it }.onFailure { failed = true }
    }

    ru.t2sales.desktop.ui.components.PageSection("План дня") {
        val d = data
        when {
            failed -> Text("Ошибка загрузки", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
            d == null -> LoadingBlock(Modifier.padding(16.dp))
            d.stores.isEmpty() -> Text("Нет точек", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
            else -> BoxWithConstraints(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                val cols = ((maxWidth + 12.dp) / (420.dp + 12.dp)).toInt().coerceAtLeast(1)
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    d.stores.chunked(cols).forEach { row ->
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                            row.forEach { st -> Box(Modifier.weight(1f)) { StoreDayCard(st, d) } }
                            repeat(cols - row.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun StoreDayCard(store: JsonObject, d: DayData) {
    val id = store["id"].str()
    val fact = d.fact[id] ?: JsonObject(emptyMap())
    val plan = d.plan[id] ?: JsonObject(emptyMap())
    val staff = d.staff[id].orEmpty()
    var open by remember { mutableStateOf(false) }
    var sf = 0.0; var sp = 0.0
    PLAN_KEYS.forEach { sf += fact[it].dbl(); sp += plan[it].dbl() }
    val overall = if (sp > 0) ((sf / sp) * 100).roundToInt() else if (sf > 0) 100 else 0
    val tone = when { overall >= 100 -> T2Colors.success; overall >= 70 -> T2Colors.warning; else -> T2Colors.danger }
    val shape = RoundedCornerShape(16.dp)
    val name = store["name"].str()
    Column(modifier = Modifier.fillMaxWidth().clip(shape).background(T2Colors.surface)) {
        Row(
            modifier = Modifier.fillMaxWidth().clickable { open = !open }.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Box(modifier = Modifier.size(42.dp).clip(RoundedCornerShape(14.dp)).background(T2Colors.primarySoft), contentAlignment = Alignment.Center) {
                Text((store["short_name"].str().ifEmpty { name.ifEmpty { "?" } }).take(2), color = T2Colors.primary, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(name, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                Text(listOf(store["code"].str(), store["work_time"].str()).joinToString(" · "), color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp))
            }
            Text("$overall%", color = tone, fontSize = 16.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.End, modifier = Modifier.widthIn(min = 44.dp))
        }
        if (open) {
            Box(Modifier.fillMaxWidth().height(1.dp).background(T2Colors.border))
            Column(modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp)) {
                if (staff.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 10.dp)) {
                    staff.forEach { s ->
                        Text(s.full_name + (s.shift_text?.takeIf { it.isNotEmpty() }?.let { " · $it" } ?: ""), fontSize = 12.sp, modifier = Modifier.clip(RoundedCornerShape(99.dp)).background(T2Colors.surface2).padding(horizontal = 10.dp, vertical = 5.dp))
                    }
                } else Text("Нет на смене", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(vertical = 12.dp))
                GROUPS.forEach { (title, metrics) ->
                    Text(title.uppercase(), color = T2Colors.hint, fontSize = 11.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 0.4.sp, modifier = Modifier.padding(top = 14.dp, bottom = 8.dp))
                    metrics.forEach { (key, label) -> ProgressRow(label ?: LABELS[key] ?: key, fact[key].dbl(), plan[key].dbl()) }
                }
            }
        }
    }
}

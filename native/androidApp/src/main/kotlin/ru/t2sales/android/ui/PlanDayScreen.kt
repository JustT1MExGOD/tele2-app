package ru.t2sales.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.async
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
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import ru.t2sales.android.AppContainer
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

private class DayData(val stores: List<JsonObject>, val fact: Map<String, JsonObject>, val plan: Map<String, JsonObject>, val staff: Map<String, List<ScheduleRow>>)

/** Mobile port of #page-plan (loadPlanDay): a collapsible card per store with today's staff, the plan % and fact/plan bars by block. */
@Composable
fun PlanDayScreen(container: AppContainer) {
    var data by remember { mutableStateOf<DayData?>(null) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(AppState.refreshTick) {
        runCatching { coroutineScope {
            val date = LocalDate.now(ZoneId.of("Europe/Moscow")).toString()
            // the five requests go out together
            val aStores = async { container.plansApi.orgStoresRaw() }
            val aStats = async { container.reportsApi.getStatsDaily(date) }
            val aSchedules = async { container.scheduleApi.getSchedules(date) }
            val aTemplate = async { container.plansApi.template(date) }
            val aComputed = async { runCatching { container.plansApi.storeDailyFor(date) }.getOrNull() }
            val storesEl = aStores.await()
            val storeArr = (storesEl as? JsonObject)?.get("stores").arr().ifEmpty { storesEl.arr() }
            val stats = aStats.await()
            val schedules = aSchedules.await()
            val template = aTemplate.await()
            val computed = aComputed.await()

            // the plan set for the day wins; otherwise the computed one (month plan spread over the days)
            val planMap = mutableMapOf<String, JsonObject>()
            val fromDay = mutableSetOf<String>()
            template.forEach { el ->
                val p = el.obj()
                if (p["plan_date"].str().take(10) == date) { planMap[p["store_id"].str()] = p; fromDay += p["store_id"].str() }
            }
            computed?.stores?.forEach { st ->
                if (st.store_id !in fromDay && st.plan.isNotEmpty()) planMap[st.store_id] = JsonObject(st.plan.mapValues { JsonPrimitive(it.value) })
            }
            DayData(
                stores = storeArr.map { it.obj() }.sortedBy { it["hours"].dbl() },
                fact = stats.associate { val o = it.obj(); o["store_id"].str().ifEmpty { o["id"].str() } to o },
                plan = planMap,
                staff = schedules.groupBy { it.store_id }
            )
        } }.onSuccess { data = it }.onFailure { failed = true }
    }

    Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 12.dp)) {
        Text("План дня", fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(bottom = 12.dp))
        val d = data
        when {
            failed -> Text("Ошибка загрузки", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
            d == null -> LoadingBlock(Modifier.padding(vertical = 16.dp), lines = 5)
            d.stores.isEmpty() -> Text("Нет точек", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
            else -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { d.stores.forEach { StoreDayCard(it, d) } }
        }
        Spacer(Modifier.height(96.dp))
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
    var sf = 0.0
    var sp = 0.0
    PLAN_KEYS.forEach { sf += fact[it].dbl(); sp += plan[it].dbl() }
    val overall = if (sp > 0) ((sf / sp) * 100).roundToInt() else if (sf > 0) 100 else 0
    val tone = when { overall >= 100 -> T2Colors.success; overall >= 70 -> T2Colors.warning; else -> T2Colors.danger }
    val shape = RoundedCornerShape(16.dp)
    val name = store["name"].str()
    Column(Modifier.fillMaxWidth().clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape)) {
        Row(Modifier.fillMaxWidth().clickable { open = !open }.padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(42.dp).clip(RoundedCornerShape(14.dp)).background(T2Colors.primarySoft), contentAlignment = Alignment.Center) {
                Text((store["short_name"].str().ifEmpty { name.ifEmpty { "?" } }).take(2), color = T2Colors.primary, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
            }
            Column(Modifier.weight(1f)) {
                Text(name, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                Text(listOf(store["code"].str(), store["work_time"].str()).filter { it.isNotEmpty() }.joinToString(" · "), color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp))
            }
            Text("$overall%", color = tone, fontSize = 16.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.End, modifier = Modifier.widthIn(min = 44.dp))
        }
        if (open) {
            Box(Modifier.fillMaxWidth().height(1.dp).background(T2Colors.border))
            Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp)) {
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

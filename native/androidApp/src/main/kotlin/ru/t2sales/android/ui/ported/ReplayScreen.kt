package ru.t2sales.android.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.Slider
import androidx.compose.material.SliderDefaults
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import kotlin.math.roundToInt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import ru.t2sales.android.AppContainer
import ru.t2sales.shared.api.EmployeeListItem
import ru.t2sales.shared.theme.T2Colors

private val MOSCOW = ZoneId.of("Europe/Moscow")
private val MONTHS_GEN = listOf("января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря")
private val MONTHS_NOM = listOf("Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь")
private const val UNITS = "__units__"
private val UNIT_METRICS = listOf("sim", "mnp", "pa", "combo")
private val PALETTE = listOf(0xFF3BB8F5, 0xFF30D158, 0xFFFF9F0A, 0xFFBF5AF2, 0xFFFF453A, 0xFF64D2FF, 0xFFFFD60A, 0xFF5E5CE6, 0xFFAC8E68, 0xFF32ADE6, 0xFFFF6482, 0xFF63E6BE).map { Color(it) }

/** One employee's numbers for every day of the month: day index (0-based) -> metric -> amount. */
private class Series(val name: String, val perDay: List<Map<String, Double>>)

/**
 * "Повтор месяца": the month replayed day by day as a race - bars grow, employees overtake each other, a day counter runs.
 * Play / pause, speed and a slider to scrub. It reads the same per-day sales the other screens use (past days are cached on disk).
 */
@Composable
fun ReplayScreen(container: AppContainer) {
    val today = remember { LocalDate.now(MOSCOW) }
    var month by remember { mutableStateOf(YearMonth.from(today)) }
    var metric by remember { mutableStateOf(UNITS) }
    var metrics by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
    var series by remember { mutableStateOf<Map<Int, Series>?>(null) }
    var loaded by remember { mutableStateOf(0) }
    var failed by remember { mutableStateOf(false) }
    var day by remember { mutableStateOf(0) }
    var playing by remember { mutableStateOf(false) }
    var speed by remember { mutableStateOf(1) }

    val days = if (month == YearMonth.from(today)) today.dayOfMonth else month.lengthOfMonth()

    LaunchedEffect(Unit) {
        runCatching { container.salesApi.getMetrics().items }.onSuccess { list ->
            metrics = list.map { it.id to (it.label ?: it.id) }
        }
    }

    LaunchedEffect(month) {
        series = null; failed = false; loaded = 0; playing = false; day = 0
        val employees = runCatching { container.teamApi.getEmployees() }.getOrDefault(emptyList<EmployeeListItem>()).associateBy { it.id }
        val gate = Semaphore(6) // a few requests at a time: a month is up to 31 reads
        val cache = container.readCache
        val perDate: List<JsonArray?> = coroutineScope {
            (1..days).map { d ->
                val date = month.atDay(d).toString()
                async(Dispatchers.IO) {
                    gate.withPermit {
                        val key = "replay.$date"
                        // a finished day never changes: read it from disk when we have it (today is always fetched fresh)
                        val saved = if (month.atDay(d) < today) cache.get(key, JsonArray.serializer())?.value else null
                        val rows = saved ?: runCatching { container.teamApi.getSales(date) }.getOrNull()?.also { if (month.atDay(d) < today) cache.put(key, JsonArray.serializer(), it) }
                        loaded++
                        rows
                    }
                }
            }.awaitAll()
        }
        if (perDate.all { it == null }) { failed = true; return@LaunchedEffect }
        val map = HashMap<Int, MutableList<MutableMap<String, Double>>>()
        perDate.forEachIndexed { i, rows ->
            rows?.forEach { el ->
                val o = el as? JsonObject ?: return@forEach
                val id = o["employee_id"]?.jsonPrimitive?.intOrNull ?: return@forEach
                val list = map.getOrPut(id) { MutableList(days) { HashMap() } }
                for ((k, v) in o) {
                    val n = (v as? kotlinx.serialization.json.JsonPrimitive)?.doubleOrNull ?: continue
                    if (k != "employee_id" && k != "id") list[i][k] = (list[i][k] ?: 0.0) + n
                }
            }
        }
        series = map.mapValues { (id, list) -> Series(employees[id]?.let { it.short_name?.takeIf { s -> s.isNotBlank() } ?: it.full_name.split(' ').take(2).joinToString(" ") } ?: "№$id", list) }
        day = days - 1
    }

    // the run: one day per tick, a little faster on 2x / 4x
    LaunchedEffect(playing, speed, series) {
        while (playing) {
            delay(900L / speed)
            if (day >= days - 1) { playing = false } else day++
        }
    }

    PageSection("Повтор месяца") {
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 14.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                MonthButton("‹") { month = month.minusMonths(1) }
                Text("${MONTHS_NOM[month.monthValue - 1]} ${month.year}", fontWeight = FontWeight.Bold, fontSize = 16.sp, modifier = Modifier.weight(1f))
                MonthButton("›", enabled = month < YearMonth.from(today)) { month = month.plusMonths(1) }
            }
            Spacer(Modifier.height(10.dp))
            val options = listOf(DropdownItem("Единицы (SIM + MNP + ПА + Комбо)", UNITS)) + metrics.map { DropdownItem(it.second, it.first) }
            DropdownField(options.firstOrNull { it.key == metric }?.label ?: "Единицы (SIM + MNP + ПА + Комбо)", options, selected = metric) { metric = it.key as String }
            Spacer(Modifier.height(14.dp))

            val data = series
            when {
                failed -> Text("Не получилось загрузить продажи за месяц", color = T2Colors.danger)
                data == null -> Column {
                    Text("Загружаем дни: $loaded из $days", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(bottom = 10.dp))
                    LoadingBlock(lines = 5)
                }
                data.isEmpty() -> Text("За этот месяц нет продаж", color = T2Colors.hint)
                else -> {
                    val colors = remember(data) { data.keys.sorted().mapIndexed { i, id -> id to PALETTE[i % PALETTE.size] }.toMap() }
                    val value: (Int, Int) -> Double = { id, upTo ->
                        var sum = 0.0
                        for (d in 0..upTo) {
                            val m = data[id]!!.perDay[d]
                            sum += if (metric == UNITS) UNIT_METRICS.sumOf { m[it] ?: 0.0 } else m[metric] ?: 0.0
                        }
                        sum
                    }
                    val frame = data.keys.associateWith { value(it, day.coerceIn(0, days - 1)) }
                    Text(
                        "${month.atDay(day + 1).dayOfMonth} ${MONTHS_GEN[month.monthValue - 1]}",
                        fontSize = 34.sp, fontWeight = FontWeight.Black, color = T2Colors.text
                    )
                    Text("день ${day + 1} из $days", color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(bottom = 10.dp))
                    RaceChart(data.mapValues { it.value.name }, frame, colors)
                    Spacer(Modifier.height(10.dp))
                    Controls(playing, speed, day, days, onToggle = {
                        if (!playing && day >= days - 1) day = 0 // at the end, play starts over
                        playing = !playing
                    }, onSpeed = { speed = it }, onSeek = { playing = false; day = it })
                }
            }
        }
    }
}

@Composable
private fun MonthButton(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    Text(
        label, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = if (enabled) T2Colors.text else T2Colors.hint.copy(alpha = 0.4f),
        modifier = Modifier.clip(RoundedCornerShape(12.dp)).background(T2Colors.surface2).clickable(enabled = enabled, onClick = onClick).padding(horizontal = 16.dp, vertical = 6.dp)
    )
}

private val ROW = 40.dp
private const val SHOWN = 10

/** Bars sorted by the current value; when the order changes a bar slides to its new place, the ones that leave the top fade out. */
@Composable
private fun RaceChart(names: Map<Int, String>, frame: Map<Int, Double>, colors: Map<Int, Color>) {
    val order = frame.entries.sortedByDescending { it.value }.map { it.key }
    val top = (frame.values.maxOrNull() ?: 0.0).coerceAtLeast(1.0)
    BoxWithConstraints(Modifier.fillMaxWidth().height(ROW * SHOWN.coerceAtMost(order.size))) {
        val rowPx = with(androidx.compose.ui.platform.LocalDensity.current) { ROW.toPx() }
        val nameW = 130.dp
        val valueW = 70.dp
        val barMax = maxWidth - nameW - valueW - 12.dp
        order.forEachIndexed { rank, id ->
            key(id) {
                val y by animateFloatAsState(rank * rowPx, tween(520))
                val visible by animateFloatAsState(if (rank < SHOWN) 1f else 0f, tween(300))
                val frac by animateFloatAsState((frame[id] ?: 0.0).toFloat() / top.toFloat(), tween(520))
                val shown = animatedInt((frame[id] ?: 0.0).roundToInt(), 520)
                Row(
                    Modifier.offset { IntOffset(0, y.roundToInt()) }.fillMaxWidth().height(ROW).graphicsLayer { alpha = visible },
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(names[id].orEmpty(), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, modifier = Modifier.width(nameW))
                    Box(Modifier.width(barMax).height(24.dp)) {
                        Box(Modifier.width(barMax * frac.coerceIn(0f, 1f)).height(24.dp).clip(RoundedCornerShape(8.dp)).background(colors[id] ?: T2Colors.primary))
                    }
                    Text(shown.toString(), fontSize = 14.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(start = 10.dp).width(valueW))
                }
            }
        }
    }
}

@Composable
private fun Controls(playing: Boolean, speed: Int, day: Int, days: Int, onToggle: () -> Unit, onSpeed: (Int) -> Unit, onSeek: (Int) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            if (playing) "❚❚" else "▶", fontSize = 18.sp, color = T2Colors.onAccent, fontWeight = FontWeight.Bold,
            modifier = Modifier.clip(RoundedCornerShape(14.dp)).background(T2Colors.accent).clickable(onClick = onToggle).padding(horizontal = 20.dp, vertical = 9.dp)
        )
        Slider(
            value = day.toFloat(), onValueChange = { onSeek(it.roundToInt()) }, valueRange = 0f..(days - 1).coerceAtLeast(1).toFloat(),
            colors = SliderDefaults.colors(thumbColor = T2Colors.primary, activeTrackColor = T2Colors.primary, inactiveTrackColor = T2Colors.surface3),
            modifier = Modifier.weight(1f)
        )
        listOf(1, 2, 4).forEach { s ->
            Text(
                "${s}×", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = if (speed == s) T2Colors.primary else T2Colors.hint,
                modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(if (speed == s) T2Colors.primarySoft else T2Colors.surface2).clickable { onSpeed(s) }.padding(horizontal = 10.dp, vertical = 6.dp)
            )
        }
    }
}

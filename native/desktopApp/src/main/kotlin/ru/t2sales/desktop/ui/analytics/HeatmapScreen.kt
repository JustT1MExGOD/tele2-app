package ru.t2sales.desktop.ui.analytics

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.hoverable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.delay
import ru.t2sales.desktop.di.AppContainer
import ru.t2sales.desktop.ui.components.PageSection
import ru.t2sales.desktop.ui.components.SelectField
import ru.t2sales.desktop.ui.components.SkeletonBlock
import ru.t2sales.desktop.ui.components.animatedFloat
import ru.t2sales.desktop.ui.components.animatedInt
import ru.t2sales.desktop.ui.components.reveal
import ru.t2sales.shared.api.StoreInfo
import ru.t2sales.shared.theme.T2Colors

private val MOSCOW = ZoneId.of("Europe/Moscow")
private const val REFRESH_MS = 30_000L

/**
 * Port of #page-heatmap: store select + sales by hour (9:00-21:00), best hour highlighted.
 * Native extras (the web page is static): cells cascade in and glide to new values, the data refreshes itself every 30 s
 * while the page is open, hovering an hour shows its share of the day and rank, the best hour softly pulses, the current hour is marked.
 */
@Composable
fun HeatmapScreen(container: AppContainer) {
    var stores by remember { mutableStateOf<List<StoreInfo>>(emptyList()) }
    var storeId by remember { mutableStateOf<String?>(null) }
    var cells by remember { mutableStateOf<List<Pair<Int, Double>>?>(null) }
    var note by remember { mutableStateOf("") }
    var failed by remember { mutableStateOf(false) }
    var updatedAt by remember { mutableStateOf<LocalTime?>(null) }
    var hover by remember { mutableStateOf<Int?>(null) }

    LaunchedEffect(Unit) {
        runCatching { container.scheduleApi.getOrgStores().stores }.onSuccess { stores = it; storeId = it.firstOrNull()?.id }
    }
    // First load on store change (skeleton), then silent refreshes: the cells keep their place and glide to the new numbers.
    LaunchedEffect(storeId) {
        val sid = storeId ?: return@LaunchedEffect
        cells = null; failed = false
        while (true) {
            runCatching { container.analyticsApi.heatmap(sid) }.onSuccess { d ->
                var raw = d["hours"].arr().ifEmpty { d["by_hour"].arr() }.map { it.obj()["hour"].let { h -> (if (h.str().isEmpty()) it.obj()["sale_hour"] else h).dbl().toInt() } to (it.obj()["value"].dbl().takeIf { v -> v != 0.0 } ?: it.obj()["count"].dbl().takeIf { v -> v != 0.0 } ?: it.obj()["total"].dbl()) }
                if (raw.isEmpty()) raw = d["profile"].obj().map { (h, v) -> (h.toIntOrNull() ?: -1) to v.dbl() }
                if (raw.isEmpty()) raw = d["rows"].arr().map { it.obj()["hour"].dbl().toInt() to it.obj()["value"].dbl() }
                val byHour = raw.filter { it.first in 9..21 }.toMap()
                cells = (9..21).map { it to (byHour[it] ?: 0.0) }
                note = d["note"].str().ifEmpty { "Heatmap по часу продажи (МСК)" }
                failed = false
                updatedAt = LocalTime.now(MOSCOW)
            }.onFailure { if (cells == null) failed = true }
            delay(REFRESH_MS)
        }
    }

    PageSection("Heatmap по часам") {
        Box(modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 8.dp)) {
            SelectField("Точка", stores.firstOrNull { it.id == storeId }?.name ?: "", stores.map { it.name }) { n -> stores.firstOrNull { it.name == n }?.let { storeId = it.id } }
        }
        val list = cells
        when {
            failed -> Text("🍉 Пока нечего показать — как только по точке пойдут продажи, здесь появится картина по часам", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
            list == null -> HeatmapSkeleton()
            else -> {
                val max = maxOf(1.0, list.maxOf { it.second })
                val total = list.sumOf { it.second }
                val best = list.maxByOrNull { it.second }
                val ranks = list.sortedByDescending { it.second }.mapIndexed { i, p -> p.first to i + 1 }.toMap()
                val nowHour = LocalTime.now(MOSCOW).hour

                Row(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    LiveDot()
                    Spacer(Modifier.size(8.dp))
                    Text(
                        buildAnnotatedString {
                            withStyle(SpanStyle(color = T2Colors.hint)) { append("$note · 9:00–21:00") }
                            if (best != null && best.second > 0) {
                                withStyle(SpanStyle(color = T2Colors.primary, fontWeight = FontWeight.Bold)) { append(" · лучший час ${best.first}:00 (${fmtN(best.second)})") }
                            }
                        },
                        fontSize = 13.sp
                    )
                }
                // fixed-height detail line: hover never makes the grid jump
                val hv = hover
                Box(Modifier.padding(horizontal = 16.dp).height(20.dp)) {
                    if (hv != null) {
                        val v = list.firstOrNull { it.first == hv }?.second ?: 0.0
                        val share = if (total > 0) (v / total * 100).toInt() else 0
                        Text("$hv:00 · ${fmtN(v)} · $share% от дня · #${ranks[hv]} из ${list.size} по часам", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    } else {
                        updatedAt?.let { Text("обновлено ${it.format(DateTimeFormatter.ofPattern("HH:mm:ss"))} · само раз в 30 с", color = T2Colors.hint, fontSize = 12.sp) }
                    }
                }
                BoxWithConstraints(modifier = Modifier.fillMaxWidth().padding(12.dp)) {
                    val cols = ((maxWidth + 8.dp) / (64.dp + 8.dp)).toInt().coerceAtLeast(1)
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        list.chunked(cols).forEachIndexed { rowIdx, row ->
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                row.forEachIndexed { colIdx, (h, v) ->
                                    HeatCell(
                                        hour = h, value = v, max = max,
                                        isBest = best != null && best.second > 0 && h == best.first,
                                        isNow = h == nowHour,
                                        order = rowIdx * cols + colIdx,
                                        modifier = Modifier.weight(1f),
                                        onHover = { on -> if (on) hover = h else if (hover == h) hover = null }
                                    )
                                }
                                repeat(cols - row.size) { Spacer(Modifier.weight(1f)) }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun HeatCell(hour: Int, value: Double, max: Double, isBest: Boolean, isNow: Boolean, order: Int, modifier: Modifier, onHover: (Boolean) -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    val source = remember { MutableInteractionSource() }
    val hovered by source.collectIsHoveredAsState()
    LaunchedEffect(hovered) { onHover(hovered) }

    val intensity = animatedFloat((value / max).toFloat().coerceIn(0f, 1f))   // colour glides to the new level; corrections (negative) count as empty
    val shown = animatedInt(value.toInt())                          // and so does the number
    val lift by animateFloatAsState(if (hovered) 1.06f else 1f, tween(140))
    val pulse by rememberInfiniteTransition().animateFloat(0.55f, 1f, infiniteRepeatable(tween(1400, easing = LinearEasing), RepeatMode.Reverse))

    Column(
        modifier = modifier
            .reveal(order, 30)
            .graphicsLayer { scaleX = lift; scaleY = lift }
            .clip(shape)
            .background(if (isBest) T2Colors.successSoft else Color(0xFF2AABEE).copy(alpha = (0.12f + intensity * 0.75f).coerceIn(0f, 1f)))
            .then(if (isBest) Modifier.border(2.dp, T2Colors.success.copy(alpha = pulse), shape) else Modifier)
            .hoverable(source)
            .padding(horizontal = 6.dp, vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("$hour:00", color = T2Colors.hint, fontSize = 11.sp)
            if (isNow) {
                Spacer(Modifier.size(4.dp))
                Box(Modifier.size(6.dp).clip(CircleShape).background(T2Colors.primary))
            }
        }
        Text(fmtN(shown.toDouble()), fontWeight = FontWeight.ExtraBold, fontSize = 16.sp)
    }
}

/** A small breathing dot: the page refreshes itself. */
@Composable
private fun LiveDot() {
    val a by rememberInfiniteTransition().animateFloat(0.3f, 1f, infiniteRepeatable(tween(1000, easing = LinearEasing), RepeatMode.Reverse))
    Box(Modifier.size(8.dp).graphicsLayer { alpha = a }.clip(CircleShape).background(T2Colors.success))
}

@Composable
private fun HeatmapSkeleton() {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth().padding(12.dp)) {
        val cols = ((maxWidth + 8.dp) / (64.dp + 8.dp)).toInt().coerceAtLeast(1)
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            (0 until 13).chunked(cols).forEach { row ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    row.forEach { SkeletonBlock(Modifier.weight(1f).height(58.dp), 12.dp) }
                    repeat(cols - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
    }
}

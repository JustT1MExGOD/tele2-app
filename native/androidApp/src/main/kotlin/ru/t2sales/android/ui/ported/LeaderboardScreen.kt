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
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import java.time.ZoneId
import ru.t2sales.android.AppContainer
import ru.t2sales.shared.api.LeaderboardResponse
import ru.t2sales.shared.api.MetricDef
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Hero
import ru.t2sales.shared.theme.T2Radius
import ru.t2sales.shared.theme.T2Spacing
import ru.t2sales.shared.api.LeaderboardItem
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.style.TextOverflow

private val MOSCOW = ZoneId.of("Europe/Moscow")

/**
 * Топы сотрудников — mobile port of backend/frontend/src/pages/leaderboard and the
 * desktop client's leaderboard/LeaderboardScreen.kt (web 20.75.0 / desktop 20.77.0;
 * missing on Android until now — closed for parity). One top per metric in the
 * catalog (not one blended score like the supervisor board's top_employees); the
 * period defaults to 1st of month → today, matching the web.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LeaderboardScreen(container: AppContainer) {
    var metrics by remember { mutableStateOf<List<MetricDef>>(emptyList()) }
    var metric by remember { mutableStateOf<String?>(null) }
    var from by remember { mutableStateOf(LocalDate.now(MOSCOW).withDayOfMonth(1).toString()) }
    var to by remember { mutableStateOf(LocalDate.now(MOSCOW).toString()) }
    var result by remember { mutableStateOf<LeaderboardResponse?>(null) }
    var failed by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var reload by remember { mutableStateOf(0) }

    LaunchedEffect(reload) {
        runCatching { container.salesApi.getMetrics().items }
            .onSuccess { metrics = it; if (metric == null) metric = it.firstOrNull()?.id }
            .onFailure { }
    }

    LaunchedEffect(metric, from, to, reload) {
        val m = metric ?: return@LaunchedEffect
        loading = true
        failed = false
        // Android has no org-switcher (desktop AppNav.adminViewOrgId); null = my own network, matching the web default.
        runCatching { container.leaderboardApi.get(m, from, to, null) }
            .onSuccess { result = it }
            .onFailure { failed = true }
        loading = false
    }

    if (T2Colors.uiBeta) {
        LeaderboardBeta(metrics, metric, { metric = it }, from, to, { from = it; to = LocalDate.now(MOSCOW).toString() }, result, failed, loading) { reload++ }
        return
    }
    PageSection("Топы сотрудников") {
        Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.weight(1f)) { Field("", from, { from = it }, placeholder = "С даты", fill = T2Colors.surface2) }
            Box(Modifier.weight(1f)) { Field("", to, { to = it }, placeholder = "По дату", fill = T2Colors.surface2) }
        }
        FlowRow(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            metrics.forEach { m ->
                val active = m.id == metric
                val shape = RoundedCornerShape(99.dp)
                Text(
                    m.label ?: m.id,
                    color = if (active) T2Colors.primary else T2Colors.text,
                    fontWeight = FontWeight.Bold, fontSize = 13.sp,
                    modifier = Modifier.clip(shape)
                        .background(if (active) T2Colors.primarySoft else T2Colors.surface2)
                        .border(1.dp, if (active) T2Colors.primary else T2Colors.border, shape)
                        .clickable { metric = m.id }
                        .padding(horizontal = 12.dp, vertical = 8.dp)
                )
            }
        }
        when {
            metrics.isEmpty() && !loading -> EmptyText("Каталог метрик пуст")
            failed -> ErrorState("Не удалось загрузить топ", onRetry = { reload++ })
            loading && result == null -> LoadingBlock(Modifier.padding(16.dp))
            else -> {
                val items = result?.items.orEmpty()
                if (items.isEmpty()) {
                    Text("Пока нет продаж за выбранный период", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
                } else {
                    val max = items.first().value.takeIf { it > 0 } ?: 1.0
                    val unitSuffix = if (result?.metric?.unit == "money") " ₽" else ""
                    Column(modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        items.forEach { item ->
                            val pct = (item.value / max).coerceIn(0.02, 1.0)
                            Column(modifier = Modifier.fillMaxWidth()) {
                                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text("${item.rank}. ${item.full_name}", fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                                    Text("${item.value.toInt()}$unitSuffix", color = T2Colors.hint, fontSize = 13.sp)
                                }
                                Spacer(Modifier.height(6.dp))
                                Box(modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(99.dp)).background(T2Colors.surface2)) {
                                    Box(modifier = Modifier.fillMaxWidth(pct.toFloat()).height(6.dp).clip(RoundedCornerShape(99.dp)).background(T2Colors.primary))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// ======================= Beta UI 3.0 «Ночная смена» (design-system/ui3/v5-team, screen 4 "Рейтинг") =======================

private fun fmtDay(iso: String) = if (iso.length >= 10) iso.substring(8, 10) + "." + iso.substring(5, 7) else iso

/** Period segment, metric chips, podium 2-1-3 on the hero mesh, the rest as a grouped list with my row highlighted + the gap to the next place. */
@Composable
private fun LeaderboardBeta(
    metrics: List<MetricDef>, metric: String?, onMetric: (String) -> Unit, from: String, to: String, onFrom: (String) -> Unit,
    result: LeaderboardResponse?, failed: Boolean, loading: Boolean, onRetry: () -> Unit
) {
    val today = LocalDate.now(MOSCOW)
    val periods = listOf("Сегодня" to today, "Неделя" to today.minusDays(6), "Месяц" to today.withDayOfMonth(1))
    val periodIdx = periods.indexOfFirst { it.second.toString() == from && to == today.toString() }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
        U3LargeTitle("Рейтинг", result?.metric?.let { "${it.label}, ${fmtDay(from)} — ${fmtDay(to)}" })
        U3Segmented(periods.map { it.first }, periodIdx.coerceAtLeast(0)) { onFrom(periods[it].second.toString()) }
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            metrics.forEach { m ->
                val active = m.id == metric
                Box(
                    Modifier.height(T2Spacing.hit).bouncyClickable(to = 0.95f) { onMetric(m.id) },
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        m.label ?: m.id, color = if (active) T2Colors.onPrimary else T2Colors.textSecondary, fontWeight = FontWeight.SemiBold, fontSize = 13.sp,
                        modifier = Modifier.clip(CircleShape).background(if (active) T2Colors.primary else T2Colors.surface2).padding(horizontal = 14.dp, vertical = 8.dp)
                    )
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        when {
            metrics.isEmpty() && !loading -> EmptyText("Каталог метрик пуст")
            failed -> ErrorState("Не удалось загрузить топ", onRetry = onRetry)
            loading && result == null -> SkeletonBlock(Modifier.fillMaxWidth().height(200.dp), 28.dp)
            else -> LeaderboardBetaBody(result)
        }
        Spacer(Modifier.height(96.dp))
    }
}

@Composable
private fun LeaderboardBetaBody(result: LeaderboardResponse?) {
    val items = result?.items.orEmpty()
    val money = result?.metric?.unit == "money"
    val fmt = { x: Double -> (if (x % 1.0 == 0.0) x.toLong().toString() else "%.1f".format(java.util.Locale.US, x)) + if (money) " ₽" else "" }
    if (items.isEmpty()) {
        EmptyText("Пока нет продаж за выбранный период")
        return
    }
    Podium(items.take(3), fmt)
    val me = AppNav.myEmployeeId
    val rest = items.drop(3)
    if (rest.isNotEmpty()) {
        Spacer(Modifier.height(16.dp))
        U3Group {
            rest.forEachIndexed { i, it ->
                if (i > 0) U3Sep()
                U3Cell(
                    it.full_name + if (it.employee_id == me) " · вы" else "", highlight = it.employee_id == me,
                    leading = { U3Tile("${it.rank}") }, trailing = { U3Value(fmt(it.value)) }
                )
            }
        }
    }
    val mine = items.firstOrNull { it.employee_id == me }
    val ahead = mine?.let { m -> items.lastOrNull { it.rank < m.rank && it.value > m.value } }
    if (mine != null && ahead != null) {
        Text(
            "До ${ahead.rank}-го места: ${fmt(ahead.value - mine.value)}", color = T2Colors.hint, fontSize = 13.sp,
            textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 12.dp)
        )
    }
}

/** 2-1-3 podium on the hero mesh: the first place is taller and centred. */
@Composable
private fun Podium(top: List<LeaderboardItem>, fmt: (Double) -> String) {
    U3Hero {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
            listOf(1, 0, 2).forEach { idx ->
                val it = top.getOrNull(idx)
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    if (it != null) {
                        val initials = it.full_name.split(" ").filter { s -> s.isNotBlank() }.take(2).joinToString("") { s -> s.take(1) }
                        val big = idx == 0
                        Box(
                            Modifier.size(if (big) 56.dp else 44.dp).clip(CircleShape).background(T2Hero.onHeroFill)
                                .border(if (big) 2.dp else 1.dp, if (big) T2Hero.onHero else T2Hero.onHeroLine, CircleShape),
                            contentAlignment = Alignment.Center
                        ) { Text(initials, color = T2Hero.onHero, fontWeight = FontWeight.Bold, fontSize = if (big) 18.sp else 15.sp) }
                        Text(
                            it.full_name.split(" ").let { p -> p.getOrNull(1) ?: p.first() }, color = T2Hero.onHero, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp)
                        )
                        Text(fmt(it.value), color = T2Hero.onHero2, fontSize = 12.sp)
                        val shape = RoundedCornerShape(topStart = T2Radius.sm, topEnd = T2Radius.sm)
                        Box(
                            Modifier.padding(top = 8.dp).fillMaxWidth().height(if (idx == 0) 64.dp else if (idx == 1) 44.dp else 32.dp).clip(shape).background(T2Hero.onHeroFill),
                            contentAlignment = Alignment.Center
                        ) { Text("${idx + 1}", color = T2Hero.onHero, fontSize = 20.sp, fontWeight = FontWeight.Bold) }
                    }
                }
            }
        }
    }
}

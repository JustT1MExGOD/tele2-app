package ru.t2sales.desktop.ui.leaderboard

import ru.t2sales.desktop.ui.components.LoadingBlock
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import java.time.ZoneId
import ru.t2sales.desktop.di.AppContainer
import ru.t2sales.desktop.ui.components.Field
import ru.t2sales.desktop.ui.components.PageSection
import ru.t2sales.shared.api.LeaderboardResponse
import ru.t2sales.shared.api.MetricDef
import ru.t2sales.shared.theme.T2Colors

private val MOSCOW = ZoneId.of("Europe/Moscow")

/**
 * Топы сотрудников (20.77.0, "нативный клиент всегда должен
 * соответствовать вебу" — порт backend/frontend/src/pages/leaderboard,
 * на вебе с 20.75.0, в нативном клиенте не было вообще). Отдельный топ
 * по КАЖДОЙ метрике каталога, не один сводный score (как у
 * SupervisorScreen's top_employees) — период явно выбирается, по
 * умолчанию 1-е число месяца → сегодня, как на вебе.
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

    LaunchedEffect(Unit) {
        runCatching { container.salesApi.getMetrics().items }
            .onSuccess { metrics = it; if (metric == null) metric = it.firstOrNull()?.id }
            .onFailure { }
    }

    LaunchedEffect(metric, from, to, reload) {
        val m = metric ?: return@LaunchedEffect
        loading = true
        failed = false
        runCatching { container.leaderboardApi.get(m, from, to, ru.t2sales.desktop.ui.shell.AppNav.adminViewOrgId) }
            .onSuccess { result = it }
            .onFailure { failed = true }
        loading = false
    }

    PageSection("Топы сотрудников") {
        Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.weight(1f)) { Field("", from, { from = it }, placeholder = "С даты ГГГГ-ММ-ДД", fill = T2Colors.surface2) }
            Box(Modifier.weight(1f)) { Field("", to, { to = it }, placeholder = "По дату ГГГГ-ММ-ДД", fill = T2Colors.surface2) }
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
            metrics.isEmpty() && !loading -> Text("Каталог метрик пуст", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
            failed -> ru.t2sales.desktop.ui.components.ErrorState("Не удалось загрузить топ", onRetry = { reload++ })
            loading && result == null -> LoadingBlock(Modifier.padding(16.dp))
            else -> {
                val items = result?.items.orEmpty()
                if (items.isEmpty()) {
                    Text("Пока нет продаж за выбранный период", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
                } else {
                    val max = items.first().value.takeIf { it > 0 } ?: 1.0
                    val unitSuffix = if (result?.metric?.unit == "money") " ₽" else ""
                    if (T2Colors.uiBeta) {
                        BetaPodium(items.take(3), unitSuffix)
                        ru.t2sales.desktop.ui.components.Group(Modifier.padding(horizontal = 16.dp).padding(bottom = 16.dp)) {
                            items.drop(3).forEachIndexed { i, item ->
                                if (i > 0) ru.t2sales.desktop.ui.components.GroupSeparator(60.dp)
                                val p = (item.value / max).toFloat()
                                ru.t2sales.desktop.ui.components.BetaCell(
                                    item.full_name, "${(p * 100).toInt()}% от лидера",
                                    leading = { Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text("${item.rank}", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.width(22.dp))
                                        ru.t2sales.desktop.ui.components.Initials(item.full_name, 32.dp)
                                    } },
                                    value = "${item.value.toInt()}$unitSuffix",
                                    trailing = { ru.t2sales.desktop.ui.components.BetaPie(p, 18.dp) }
                                )
                            }
                            if (items.size <= 3) Text("Все участники на пьедестале", color = T2Colors.hint, fontSize = 15.sp, modifier = Modifier.padding(16.dp))
                        }
                        return@PageSection
                    }
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

/** Beta UI 3.0 podium (design-system/ui3/v5-team, frame 4): 2nd · 1st (taller, highlighted) · 3rd. */
@Composable
private fun BetaPodium(top: List<ru.t2sales.shared.api.LeaderboardItem>, unit: String) {
    if (top.isEmpty()) return
    val order = listOfNotNull(top.getOrNull(1), top.getOrNull(0), top.getOrNull(2))
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Bottom) {
        order.forEach { it ->
            val first = it.rank == 1
            val shape = RoundedCornerShape(ru.t2sales.shared.theme.T2Radius.cell)
            Column(
                Modifier.weight(1f).clip(shape).background(T2Colors.surface).border(1.dp, if (first) T2Colors.borderStrong else T2Colors.border, shape)
                    .padding(horizontal = 10.dp, vertical = if (first) 22.dp else 14.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text("${it.rank} место", color = T2Colors.hint, fontSize = 12.sp)
                Spacer(Modifier.height(8.dp))
                ru.t2sales.desktop.ui.components.Initials(it.full_name, if (first) 44.dp else 36.dp, highlight = first)
                Spacer(Modifier.height(8.dp))
                Text(it.full_name.split(" ").let { p -> p.getOrNull(1)?.let { n -> "$n ${p[0].take(1)}." } ?: p[0] }, color = T2Colors.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                Text("${it.value.toInt()}$unit", color = T2Colors.text, fontSize = if (first) 22.sp else 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 2.dp))
            }
        }
    }
}

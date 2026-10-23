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
            metrics.isEmpty() && !loading -> Text("Каталог метрик пуст", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
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

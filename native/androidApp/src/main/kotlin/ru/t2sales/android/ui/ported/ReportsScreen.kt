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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.io.File
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.roundToInt
import kotlinx.coroutines.launch
import ru.t2sales.shared.api.AlertTypeEffectiveness
import ru.t2sales.shared.api.EffectivenessSummaryResponse
import ru.t2sales.shared.api.OutcomeBucket
import ru.t2sales.shared.api.ReportsApi
import ru.t2sales.shared.api.TeamApi
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Radius


/** Port of pages/reports (index.html #page-reports): digest, report image, CSV export (manager), effectiveness (admin). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ReportsScreen(reportsApi: ReportsApi, teamApi: TeamApi, isAdmin: Boolean, canManage: Boolean, onOpenReportImg: () -> Unit) {
    val scope = rememberCoroutineScope()
    var learn by remember { mutableStateOf<EffectivenessSummaryResponse?>(null) }
    var learnFailed by remember { mutableStateOf(false) }
    var digestBusy by remember { mutableStateOf(false) }

    LaunchedEffect(isAdmin) {
        if (isAdmin) runCatching { reportsApi.getAlertsEffectiveness() }.onSuccess { learn = it }.onFailure { learnFailed = true }
    }

    Section("Сводка по сети") {
        Text(
            "Итог по сети (план/темп, лучшие и отстающие точки) — как ежедневные фото-отчёты по точке, только раз в неделю/месяц по всей сети.",
            color = T2Colors.hint, fontSize = 13.sp,
            modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 10.dp)
        )
        if (canManage) {
            FlowRow(
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                listOf("weekly" to ("Отправить недельную" to "Недельная сводка отправлена"), "monthly" to ("Отправить месячную" to "Месячная сводка отправлена")).forEach { (kind, texts) ->
                    MChip(texts.first) {
                        if (!digestBusy) {
                            digestBusy = true
                            scope.launch {
                                runCatching { reportsApi.sendDigest(kind) }
                                    .onSuccess { T2Toast.show(texts.second) }
                                    .onFailure { T2Toast.show(it.message ?: "Не удалось отправить сводку", true) }
                                digestBusy = false
                            }
                        }
                    }
                }
            }
        }
    }
    Spacer(Modifier.height(12.dp))

    Section("Отчёт по точке") {
        NavRow(NavIcons.reportImg, "Отчёт-картинка", "SVG итог дня по выбранной точке") { onOpenReportImg() }
    }
    Spacer(Modifier.height(12.dp))

    if (canManage) {
        Section("Экспорт CSV") {
            NavRow(NavIcons.download, "Продажи", null) { export(scope, teamApi, "sales") }
            NavRow(NavIcons.download, "BFQ", null) { export(scope, teamApi, "bfq") }
            NavRow(NavIcons.download, "График", null) { export(scope, teamApi, "schedules") }
        }
        Spacer(Modifier.height(12.dp))
    }

    if (isAdmin) {
        Section("Эффективность рекомендаций") {
            Text(
                "Explain/Predict находят причину и предупреждают заранее, Recommend подсказывает действие в задаче — здесь видно, помогает ли это на самом деле: сравнение алертов с доведённой до конца задачей и без.",
                color = T2Colors.hint, fontSize = 13.sp,
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 10.dp)
            )
            Column(modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp)) {
                val l = learn
                when {
                    learnFailed -> Text("Не удалось загрузить", color = T2Colors.hint, fontSize = 13.sp)
                    l == null -> Text("Загрузка…", color = T2Colors.hint, fontSize = 13.sp)
                    else -> {
                        TypeBlock("Прогноз конца дня (plan_miss_projected)", l.plan_miss_projected)
                        TypeBlock("Просевшие дни (anomaly_vs_forecast)", l.anomaly_vs_forecast)
                    }
                }
            }
        }
    }
}

private fun export(scope: kotlinx.coroutines.CoroutineScope, teamApi: TeamApi, type: String) {
    val today = LocalDate.now(ZoneId.of("Europe/Moscow")).toString()
    val month = today.take(7)
    val path = when (type) {
        "sales" -> "/export/sales.csv?from=$month-01&to=$today"
        "bfq" -> "/export/bfq.csv?month=$month"
        else -> "/export/schedules.csv?month=$month"
    }
    scope.launch {
        runCatching { teamApi.exportCsv(path) }
            .onSuccess { bytes -> FileShare.share("${type}_$month.csv", "text/csv", bytes) }
            .onFailure { T2Toast.show("Ошибка экспорта", true) }
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(T2Radius.default)
    Column(modifier = Modifier.fillMaxWidth().clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape).padding(vertical = 6.dp)) {
        Text(
            title.uppercase(), color = T2Colors.hint, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.7.sp,
            modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 8.dp)
        )
        content()
    }
}

@Composable
private fun NavRow(icon: androidx.compose.ui.graphics.Path, title: String, sub: String?, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        val shape = RoundedCornerShape(T2Radius.sm)
        Box(
            modifier = Modifier.size(42.dp).clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape),
            contentAlignment = Alignment.Center
        ) { NavIcon(icon, contentDescription = null, tint = T2Colors.textSecondary, size = 20.dp) }
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            if (sub != null) Text(sub, color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp))
        }
        Text("›", color = T2Colors.hint, fontSize = 18.sp)
    }
}

@Composable
private fun MChip(label: String, onClick: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Text(
        label, fontWeight = FontWeight.Bold, fontSize = 13.sp,
        modifier = Modifier.clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 12.dp)
    )
}

private val OUTCOME_LABEL = mapOf("recovered" to "исправилось", "still_missed" to "не исправилось", "recurred" to "повторилось")

private fun bucketRateText(label: String, bucket: OutcomeBucket): String {
    val entries = listOfNotNull(
        "recovered".takeIf { bucket.recovered > 0 }?.let { it to bucket.recovered },
        bucket.still_missed?.takeIf { it > 0 }?.let { "still_missed" to it },
        bucket.recurred?.takeIf { it > 0 }?.let { "recurred" to it }
    )
    val total = entries.sumOf { it.second }
    if (total == 0) return "$label: пока нет данных"
    val parts = entries.joinToString(" · ") { (key, value) -> "${OUTCOME_LABEL[key] ?: key} $value (${(value * 100.0 / total).roundToInt()}%)" }
    return "$label ($total): $parts"
}

private fun pct(v: Double?): String = if (v == null) "—" else "${(v * 100).roundToInt()}%"

@Composable
private fun TypeBlock(title: String, data: AlertTypeEffectiveness) {
    Column(modifier = Modifier.padding(top = 10.dp)) {
        Text("$title (${data.total})", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(bottom = 4.dp))
        Text(bucketRateText("С выполненной задачей", data.with_task), color = T2Colors.hint, fontSize = 13.sp)
        Text(bucketRateText("Без задачи", data.without_task), color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp))
        Text(
            "Открыли: ${pct(data.open_rate)} · Отклонили: ${pct(data.dismissed_rate)} · Похоже на ложную тревогу: ${pct(data.false_positive_rate)}",
            color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp)
        )
        val w = data.recovery_rate_with_task
        val wo = data.recovery_rate_without_task
        if (w != null && wo != null) {
            val delta = ((w - wo) * 100).roundToInt()
            Text("Задача меняет исход: ${if (delta > 0) "+" else ""}$delta п.п.", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp))
        }
    }
}

package ru.t2sales.android.ui

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
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import java.time.ZoneId
import ru.t2sales.shared.api.HistorySale
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.api.SalesApi
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Hero

/** «История продаж» can be opened for one employee (profile action) or for everyone (Team -> Управление). */
object HistoryFilter {
    var employeeId by mutableStateOf<Int?>(null)
}

private fun n(v: Double?) = (v ?: 0.0).let { if (it % 1.0 == 0.0) it.toLong().toString() else it.toString() }

/** Port of #page-history (pages/support loadHistory): this month's sales, one row each. */
@Composable
fun HistoryScreen(api: SalesApi, me: MeResponse) {
    val filter = HistoryFilter.employeeId
    var items by remember(filter) { mutableStateOf<List<HistorySale>?>(null) }
    var failed by remember(filter) { mutableStateOf(false) }
    var reload by remember { mutableStateOf(0) }

    LaunchedEffect(filter, reload) {
        failed = false
        val today = LocalDate.now(ZoneId.of("Europe/Moscow"))
        runCatching { api.getHistory(today.withDayOfMonth(1).toString(), today.toString(), filter) }
            .onSuccess { items = it.items }
            .onFailure { failed = true }
    }

    if (T2Colors.uiBeta) {
        HistoryBeta(items, failed, filter, onRetry = { reload++ })
        return
    }

    PageSection("История продаж") {
        val list = items
        when {
            failed -> ErrorState("Не удалось загрузить историю", onRetry = { reload++ })
            list == null -> LoadingBlock(Modifier.padding(16.dp))
            list.isEmpty() -> EmptyText("Нет продаж за период")
            else -> list.forEach { s ->
                Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 13.dp)) {
                    Text(if (filter != null) s.store_name ?: "" else s.full_name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                    Text(
                        s.sale_date.take(10) + (if (filter == null) " · ${s.store_name ?: ""}" else "") + " · SIM ${n(s.sim)} · MNP ${n(s.mnp)} · ПА ${n(s.pa)}",
                        color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp)
                    )
                }
            }
        }
    }
}

// ======================= Beta UI 3.0 «Ночная смена» (design-system/ui3/v5-team, screen "История продаж") =======================

/** Hero with the month's totals, then each sale as a grouped cell (leading day tile, SIM/MNP value trailing). */
@Composable
private fun HistoryBeta(items: List<HistorySale>?, failed: Boolean, filter: Int?, onRetry: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
        U3LargeTitle("История продаж")
        val list = items
        when {
            failed -> ErrorState("Не удалось загрузить историю", onRetry = onRetry)
            list == null -> SkeletonBlock(Modifier.fillMaxWidth().height(160.dp), 28.dp)
            list.isEmpty() -> EmptyText("Нет продаж за период")
            else -> {
                val simTotal = list.sumOf { it.sim ?: 0.0 }
                val mnpTotal = list.sumOf { it.mnp ?: 0.0 }
                U3Hero {
                    U3HeroRow("Продажи за месяц", chip = "${list.size} записей")
                    U3HeroNumber(n(simTotal), "SIM")
                    Text("MNP ${n(mnpTotal)} · ПА ${n(list.sumOf { it.pa ?: 0.0 })}", color = T2Hero.onHero2, fontSize = 15.sp, modifier = Modifier.padding(top = 2.dp))
                }
                Spacer(Modifier.height(14.dp))
                U3Group {
                    list.forEachIndexed { i, s ->
                        if (i > 0) U3Sep()
                        val day = s.sale_date.take(10).let { if (it.length >= 10) it.substring(8, 10) else it }
                        U3Cell(
                            if (filter != null) s.store_name ?: "" else s.full_name,
                            s.sale_date.take(10) + (if (filter == null) " · ${s.store_name ?: ""}" else ""),
                            leading = { U3Tile(day) },
                            trailing = { U3Value("${n(s.sim)}/${n(s.mnp)}") }
                        )
                    }
                }
            }
        }
        Spacer(Modifier.height(96.dp))
    }
}

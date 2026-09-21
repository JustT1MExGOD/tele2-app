package ru.t2sales.android.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
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

    LaunchedEffect(filter) {
        val today = LocalDate.now(ZoneId.of("Europe/Moscow"))
        runCatching { api.getHistory(today.withDayOfMonth(1).toString(), today.toString(), filter) }
            .onSuccess { items = it.items }
            .onFailure { failed = true }
    }

    PageSection("История продаж") {
        val list = items
        when {
            failed -> Text("Не удалось загрузить историю", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
            list == null -> LoadingBlock(Modifier.padding(16.dp))
            list.isEmpty() -> Text("Нет продаж за период", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
            else -> list.forEach { s ->
                Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 13.dp)) {
                    Text(if (filter != null) s.store_name ?: "" else s.full_name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                    Text(
                        s.sale_date.take(10) + (if (filter == null) " \u00B7 ${s.store_name ?: ""}" else "") + " \u00B7 SIM ${n(s.sim)} \u00B7 MNP ${n(s.mnp)} \u00B7 ПА ${n(s.pa)}",
                        color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp)
                    )
                }
            }
        }
    }
}

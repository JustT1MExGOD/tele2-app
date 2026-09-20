package ru.t2sales.desktop.ui.admincenter

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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.CircularProgressIndicator
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
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import ru.t2sales.desktop.di.AppContainer
import ru.t2sales.desktop.ui.components.Field
import ru.t2sales.desktop.ui.components.MChipButton
import ru.t2sales.desktop.ui.components.PageSection
import ru.t2sales.desktop.ui.components.T2Toast
import ru.t2sales.shared.api.AcSaleDetail
import ru.t2sales.shared.api.AcSaleRow
import ru.t2sales.shared.api.StoreInfo
import ru.t2sales.shared.theme.T2Colors

private sealed class SaleFlow {
    class Void(val row: AcSaleRow, val preview: String) : SaleFlow()
    class Restore(val row: AcSaleRow) : SaleFlow()
    class Metric(val row: AcSaleRow, val id: String, val label: String, val value: Double) : SaleFlow()
    class PickStore(val row: AcSaleRow) : SaleFlow()
    class ConfirmStore(val row: AcSaleRow, val newStoreId: String, val crossOrg: Boolean) : SaleFlow()
    class Ticket(val row: AcSaleRow, val newStoreId: String, val reason: String) : SaleFlow()
}

/** Port of admin-center/sales-correction.ts: search daily sale rows, detail, void/restore/metric/store corrections. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun SalesTab(container: AppContainer) {
    val api = container.adminCenterApi
    val scope = rememberCoroutineScope()
    var from by remember { mutableStateOf("") }
    var to by remember { mutableStateOf("") }
    var includeVoided by remember { mutableStateOf(false) }
    var results by remember { mutableStateOf<List<AcSaleRow>?>(null) }
    var searching by remember { mutableStateOf(false) }
    var searchFailed by remember { mutableStateOf(false) }
    var selectedId by remember { mutableStateOf<String?>(null) }
    var detail by remember { mutableStateOf<AcSaleDetail?>(null) }
    var detailFailed by remember { mutableStateOf(false) }
    var reloadDetail by remember { mutableStateOf(0) }
    var flow by remember { mutableStateOf<SaleFlow?>(null) }
    var stores by remember { mutableStateOf<List<StoreInfo>>(emptyList()) }

    fun search() {
        searching = true; searchFailed = false
        scope.launch {
            runCatching { api.searchSales(from.ifBlank { null }, to.ifBlank { null }, includeVoided) }
                .onSuccess { results = it.items }
                .onFailure { searchFailed = true }
            searching = false
        }
    }
    LaunchedEffect(selectedId, reloadDetail) {
        val id = selectedId ?: return@LaunchedEffect
        detailFailed = false
        runCatching { api.sale(id) }.onSuccess { detail = it }.onFailure { detailFailed = true }
    }
    LaunchedEffect(Unit) { runCatching { container.scheduleApi.getOrgStores().stores }.onSuccess { stores = it } }

    fun done(msg: String) { T2Toast.show(msg); reloadDetail++ }
    val stale = "Ошибка (возможно, версия устарела)"

    PageSection("Поиск строк продаж") {
        Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) { Field("", from, { from = it }, placeholder = "С ГГГГ-ММ-ДД", fill = T2Colors.surface2) }
            Box(Modifier.weight(1f)) { Field("", to, { to = it }, placeholder = "По ГГГГ-ММ-ДД", fill = T2Colors.surface2) }
            Row(modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { includeVoided = !includeVoided }.padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(if (includeVoided) "\u2611" else "\u2610", fontSize = 20.sp, color = T2Colors.primary)
                Text(" показывать аннулированные", fontSize = 13.sp)
            }
            MChipButton("Найти") { search() }
        }
        val list = results
        when {
            searching -> LoadingBlock(Modifier.padding(16.dp))
            searchFailed -> EmptyText("Ошибка поиска")
            list == null -> {}
            list.isEmpty() -> EmptyText("Ничего не найдено")
            else -> list.forEach { r -> NavRow("${r.employee_name} \u00B7 ${r.store_name}", r.sale_date + if (r.voided_at != null) " \u00B7 аннулировано" else "") { selectedId = r.id } }
        }
    }

    if (selectedId != null) {
        Spacer(Modifier.height(12.dp))
        val d = detail
        when {
            detailFailed -> PageSection(null) { EmptyText("Не удалось загрузить строку") }
            d == null || d.row.id != selectedId -> LoadingBlock()
            else -> {
                val row = d.row
                val canEdit = row.voided_at == null
                PageSection("${row.employee_name} \u00B7 ${row.store_name} \u00B7 ${row.sale_date}") {
                    if (d.metrics.isEmpty()) Text("нет метрик", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                    FlowRow(modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        d.metrics.forEach { (id, m) ->
                            val v = if (m.value % 1.0 == 0.0) m.value.toLong().toString() else m.value.toString()
                            val shape = RoundedCornerShape(12.dp)
                            Text(
                                "${m.label.ifEmpty { id }}: $v", fontWeight = FontWeight.Bold, fontSize = 13.sp,
                                color = if (canEdit) T2Colors.text else T2Colors.hint,
                                modifier = Modifier.clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape)
                                    .then(if (canEdit) Modifier.clickable { flow = SaleFlow.Metric(row, id, m.label.ifEmpty { id }, m.value) } else Modifier)
                                    .padding(horizontal = 12.dp, vertical = 12.dp)
                            )
                        }
                    }
                    if (row.voided_at != null) Text("Аннулировано: ${row.void_reason ?: ""}", color = T2Colors.textSecondary, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
                    Row(modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (row.voided_at != null) MChipButton("Восстановить") { flow = SaleFlow.Restore(row) }
                        else {
                            MChipButton("Аннулировать") {
                                scope.launch {
                                    val preview = runCatching { api.previewVoidSale(row.id) }.getOrNull()?.let { prettyJson(it["metrics"] ?: it) } ?: ""
                                    flow = SaleFlow.Void(row, preview)
                                }
                            }
                            MChipButton("Изменить точку") { flow = SaleFlow.PickStore(row) }
                        }
                    }
                }
            }
        }
    }

    when (val f = flow) {
        is SaleFlow.Void -> DangerDialog("Аннулировать строку продаж", "Все метрики этой строки будут обнулены. Действие обратимо через \"Восстановить\".", preview = f.preview, onDismiss = { flow = null }, onConfirm = { reason ->
            flow = null
            scope.launch { runCatching { api.voidSale(f.row.id, f.row.version, reason) }.onSuccess { done("Строка аннулирована") }.onFailure { T2Toast.show(stale, true) } }
        })
        is SaleFlow.Restore -> DangerDialog("Восстановить строку продаж", "Значения метрик будут возвращены к состоянию до аннулирования.", confirmLabel = "Восстановить", onDismiss = { flow = null }, onConfirm = { reason ->
            flow = null
            scope.launch { runCatching { api.restoreSale(f.row.id, f.row.version, reason) }.onSuccess { done("Строка восстановлена") }.onFailure { T2Toast.show(stale, true) } }
        })
        is SaleFlow.Metric -> MetricCorrectionDialog(f.label, f.value, onDismiss = { flow = null }, onSave = { value, reason ->
            flow = null
            scope.launch { runCatching { api.correctSaleMetric(f.row.id, f.id, value, f.row.version, reason) }.onSuccess { done("Метрика изменена") }.onFailure { T2Toast.show(stale, true) } }
        })
        is SaleFlow.PickStore -> FieldCorrectionPick(
            stores.filter { it.id != f.row.store_id },
            onDismiss = { flow = null },
            onNext = { newId ->
                scope.launch {
                    val cross = runCatching { api.previewCorrectStore(f.row.id, newId).crossOrg }.getOrDefault(false)
                    flow = SaleFlow.ConfirmStore(f.row, newId, cross)
                }
            }
        )
        is SaleFlow.ConfirmStore -> DangerDialog(
            "Подтвердить смену точки",
            if (f.crossOrg) "Внимание: новая точка относится к другой сети. Потребуется MFA-подтверждение." else "Строка будет перенесена на выбранную точку.",
            confirmLabel = "Перенести", onDismiss = { flow = null },
            onConfirm = { reason ->
                if (f.crossOrg) flow = SaleFlow.Ticket(f.row, f.newStoreId, reason)
                else {
                    flow = null
                    scope.launch { runCatching { api.correctSaleStore(f.row.id, f.row.version, f.newStoreId, reason, null) }.onSuccess { done("Точка изменена") }.onFailure { T2Toast.show(stale, true) } }
                }
            }
        )
        is SaleFlow.Ticket -> StepUpDialog(api, onDismiss = { flow = null }, onTicket = { ticket ->
            flow = null
            scope.launch { runCatching { api.correctSaleStore(f.row.id, f.row.version, f.newStoreId, f.reason, ticket) }.onSuccess { done("Точка изменена") }.onFailure { T2Toast.show(stale, true) } }
        })
        null -> {}
    }
}

@Composable
private fun FieldCorrectionPick(stores: List<StoreInfo>, onDismiss: () -> Unit, onNext: (String) -> Unit) {
    var picked by remember { mutableStateOf(stores.firstOrNull()?.id) }
    ru.t2sales.desktop.ui.components.SheetDialog("Изменить точку строки продаж", onDismiss) {
        ru.t2sales.desktop.ui.components.SelectField("", stores.firstOrNull { it.id == picked }?.name ?: "", stores.map { it.name }) { name -> stores.firstOrNull { it.name == name }?.let { picked = it.id } }
        Spacer(Modifier.height(16.dp))
        ru.t2sales.desktop.ui.components.MainButton("Далее", enabled = picked != null) { picked?.let(onNext) }
    }
}

internal fun prettyJson(el: kotlinx.serialization.json.JsonElement): String =
    kotlinx.serialization.json.Json { prettyPrint = true }.encodeToString(kotlinx.serialization.json.JsonElement.serializer(), el)

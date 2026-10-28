package ru.t2sales.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import ru.t2sales.shared.api.AdminApi
import ru.t2sales.shared.api.OrgAdminItem
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Radius

private enum class OrgSort { Name, Dealer, Sector, Status }

/** Port of the «Сети» page (index.html #page-orgs, network-admin): add-network row + sortable networks table, edit form. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun OrgsScreen(api: AdminApi) {
    val scope = rememberCoroutineScope()
    var orgs by remember { mutableStateOf<List<OrgAdminItem>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var reload by remember { mutableStateOf(0) }
    var sort by remember { mutableStateOf(OrgSort.Name) }
    var asc by remember { mutableStateOf(true) }
    var editing by remember { mutableStateOf<OrgAdminItem?>(null) }
    var adding by remember { mutableStateOf(false) }

    LaunchedEffect(reload) {
        failed = false
        runCatching { api.getOrgs() }.onSuccess { orgs = it }.onFailure { failed = true }
    }

    PageSection("Сети") {
        Row(
            modifier = Modifier.fillMaxWidth().clickable { adding = true }.padding(horizontal = 16.dp, vertical = 13.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            val shape = RoundedCornerShape(T2Radius.sm)
            Box(Modifier.size(42.dp).clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape), contentAlignment = Alignment.Center) {
                NavIcon(NavIcons.plus, contentDescription = null, tint = T2Colors.textSecondary, size = 20.dp)
            }
            Spacer(Modifier.width(12.dp))
            Text("Добавить сеть", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            Text("\u203A", color = T2Colors.hint, fontSize = 18.sp)
        }
        val list = orgs
        when {
            failed -> ErrorState("\uD83C\uDF49 Не получилось загрузить сети", onRetry = { reload++ })
            list == null -> LoadingBlock(Modifier.padding(16.dp))
            list.isEmpty() -> Text("\uD83C\uDF49 Сетей пока нет", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
            else -> {
                val sorted = list.sortedWith { a, b ->
                    val c = when (sort) {
                        OrgSort.Name -> a.name.compareTo(b.name, true)
                        OrgSort.Dealer -> (a.dealer_name ?: "").compareTo(b.dealer_name ?: "", true)
                        OrgSort.Sector -> (a.sector_id ?: "").compareTo(b.sector_id ?: "", true)
                        OrgSort.Status -> (a.is_active != false).compareTo(b.is_active != false)
                    }
                    if (asc) c else -c
                }
                fun sortBy(k: OrgSort) { if (sort == k) asc = !asc else { sort = k; asc = true } }
                FlowRow(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    listOf(
                        OrgSort.Name to "Название",
                        OrgSort.Dealer to "Дилер",
                        OrgSort.Sector to "Сектор",
                        OrgSort.Status to "Статус"
                    ).forEach { (k, label) ->
                        val active = sort == k
                        val shape = RoundedCornerShape(99.dp)
                        Text(
                            "$label${if (active) (if (asc) " ↑" else " ↓") else ""}",
                            color = if (active) T2Colors.primary else T2Colors.hint,
                            fontWeight = FontWeight.SemiBold, fontSize = 12.sp,
                            modifier = Modifier.clip(shape)
                                .background(if (active) T2Colors.primarySoft else T2Colors.surface2)
                                .border(1.dp, if (active) T2Colors.primary else T2Colors.border, shape)
                                .clickable { sortBy(k) }
                                .padding(horizontal = 10.dp, vertical = 6.dp)
                        )
                    }
                }
                sorted.forEach { o ->
                    Row(
                        modifier = Modifier.fillMaxWidth().clickable { editing = o }.padding(horizontal = 16.dp, vertical = 13.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(o.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                            Text(
                                o.id +
                                    (o.dealer_name?.let { " · дилер $it" } ?: "") +
                                    (o.sector_id?.let { " · сектор $it" } ?: ""),
                                fontSize = 12.sp, color = T2Colors.hint,
                                modifier = Modifier.padding(top = 2.dp)
                            )
                        }
                        Text(
                            if (o.is_active == false) "выкл." else "активна",
                            fontSize = 12.sp,
                            color = if (o.is_active == false) T2Colors.danger else T2Colors.success,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                    Box(Modifier.fillMaxWidth().height(1.dp).background(T2Colors.border))
                }
            }
        }
    }

    if (adding || editing != null) {
        OrgForm(
            org = editing,
            onDismiss = { adding = false; editing = null },
            onSave = { id, body, isNew ->
                scope.launch {
                    runCatching { api.saveOrg(id, body) }
                        .onSuccess { T2Toast.show(if (isNew) "Сеть создана" else "Сеть обновлена"); adding = false; editing = null; reload++ }
                        .onFailure { T2Toast.show("Ошибка", true) }
                }
            }
        )
    }
}

@Composable
private fun OrgForm(org: OrgAdminItem?, onDismiss: () -> Unit, onSave: (String, kotlinx.serialization.json.JsonObject, Boolean) -> Unit) {
    val fill = T2Colors.surface2
    var id by remember { mutableStateOf(org?.id ?: "") }
    var name by remember { mutableStateOf(org?.name ?: "") }
    var brand by remember { mutableStateOf(org?.brand_name ?: "") }
    var color by remember { mutableStateOf(org?.primary_color ?: "#2AABEE") }
    var sector by remember { mutableStateOf(org?.sector_id ?: "default") }
    var dealer by remember { mutableStateOf(org?.dealer_name ?: "") }
    var chat by remember { mutableStateOf(org?.chat_id ?: "") }
    var salesThread by remember { mutableStateOf(org?.sales_thread_id ?: "") }
    var reportsThread by remember { mutableStateOf(org?.reports_thread_id ?: "") }
    var active by remember { mutableStateOf(org?.is_active != false) }

    SheetDialog(org?.name ?: "Новая сеть", onDismiss) {
        Field("ID (латиница${if (org != null) ", нельзя изменить" else ""})", id, { if (org == null) id = it }, placeholder = "novaya_set", fill = fill)
        Spacer(Modifier.height(14.dp))
        Field("Название", name, { name = it }, fill = fill); Spacer(Modifier.height(14.dp))
        Field("Бренд (короткое имя)", brand, { brand = it }, fill = fill); Spacer(Modifier.height(14.dp))
        Field("Основной цвет", color, { color = it }, fill = fill); Spacer(Modifier.height(14.dp))
        Field("Сектор", sector, { sector = it }, fill = fill); Spacer(Modifier.height(14.dp))
        Field("Дилер (владелец сектора)", dealer, { dealer = it }, placeholder = "ООО «Ромашка»", fill = fill); Spacer(Modifier.height(14.dp))
        Field("Chat ID группы", chat, { chat = it }, placeholder = "-100\u2026", fill = fill); Spacer(Modifier.height(14.dp))
        Field("Thread ID \u00B7 продажи", salesThread, { salesThread = it }, placeholder = "необязательно", fill = fill); Spacer(Modifier.height(14.dp))
        Field("Thread ID \u00B7 отчёты", reportsThread, { reportsThread = it }, placeholder = "необязательно", fill = fill)
        Text(
            "Chat ID и Thread ID узнать командой /chatid в нужной группе/теме Telegram.",
            color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(vertical = 8.dp)
        )
        if (org != null) {
            Row(modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { active = !active }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(if (active) "\u2611" else "\u2610", fontSize = 20.sp, color = T2Colors.primary)
                Spacer(Modifier.width(8.dp))
                Text("Сеть активна")
            }
        }
        Spacer(Modifier.height(16.dp))
        MainButton("Сохранить", enabled = true) {
            val finalId = org?.id ?: id.trim().lowercase().replace(Regex("[^a-z0-9_]"), "_")
            if (finalId.isEmpty() || name.isBlank()) {
                T2Toast.show("ID и название обязательны", true)
                return@MainButton
            }
            val body = buildJsonObject {
                put("name", JsonPrimitive(name.trim()))
                brand.trim().takeIf { it.isNotEmpty() }?.let { put("brand_name", JsonPrimitive(it)) }
                color.trim().takeIf { it.isNotEmpty() }?.let { put("primary_color", JsonPrimitive(it)) }
                sector.trim().takeIf { it.isNotEmpty() }?.let { put("sector_id", JsonPrimitive(it)) }
                dealer.trim().takeIf { it.isNotEmpty() }?.let { put("dealer_name", JsonPrimitive(it)) }
                chat.trim().takeIf { it.isNotEmpty() }?.let { put("chat_id", JsonPrimitive(it)) }
                salesThread.trim().takeIf { it.isNotEmpty() }?.let { put("sales_thread_id", JsonPrimitive(it)) }
                reportsThread.trim().takeIf { it.isNotEmpty() }?.let { put("reports_thread_id", JsonPrimitive(it)) }
                if (org != null) put("is_active", JsonPrimitive(active))
            }
            onSave(finalId, body, org == null)
        }
    }
}

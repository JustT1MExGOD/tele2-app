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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import ru.t2sales.desktop.di.AppContainer
import ru.t2sales.desktop.ui.components.Field
import ru.t2sales.desktop.ui.components.MChipButton
import ru.t2sales.desktop.ui.components.MainButton
import ru.t2sales.desktop.ui.components.PageSection
import ru.t2sales.desktop.ui.components.SelectField
import ru.t2sales.desktop.ui.components.T2Toast
import ru.t2sales.shared.api.AcFlag
import ru.t2sales.shared.api.MetricDef
import ru.t2sales.shared.api.OrgAdminItem
import ru.t2sales.shared.theme.T2Colors

@Composable
private fun ListRow(title: String, sub: String?, action: (@Composable () -> Unit)?) {
    Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            if (!sub.isNullOrEmpty()) Text(sub, color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp))
        }
        action?.invoke()
    }
}

// ---------------- Feature flags
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun FlagsTab(container: AppContainer) {
    val api = container.adminCenterApi
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<AcFlag>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var reload by remember { mutableStateOf(0) }
    var key by remember { mutableStateOf("") }
    var orgId by remember { mutableStateOf("") }
    var enabled by remember { mutableStateOf(false) }
    var description by remember { mutableStateOf("") }

    LaunchedEffect(reload) { runCatching { api.flags().items }.onSuccess { items = it }.onFailure { failed = true } }

    PageSection("Флаги функциональности") {
        Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) { Field("", key, { key = it }, placeholder = "ключ (a-z, 0-9, _)", fill = T2Colors.surface2) }
            Box(Modifier.weight(1f)) { Field("", orgId, { orgId = it }, placeholder = "org_id (пусто = все сети)", fill = T2Colors.surface2) }
            Row(
                modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { enabled = !enabled }.padding(4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(if (enabled) "\u2611" else "\u2610", fontSize = 20.sp, color = T2Colors.primary)
                Text(" включено", fontSize = 13.sp)
            }
            Box(Modifier.weight(2f)) { Field("", description, { description = it }, placeholder = "описание", fill = T2Colors.surface2) }
            Box(Modifier.width(140.dp)) {
                MainButton("Сохранить", enabled = true) {
                    if (key.isBlank()) { T2Toast.show("Укажите ключ", true); return@MainButton }
                    scope.launch {
                        runCatching { api.upsertFlag(key.trim(), orgId.trim().ifEmpty { null }, enabled, description.trim().ifEmpty { null }) }
                            .onSuccess { T2Toast.show("Флаг сохранён"); reload++ }
                            .onFailure { T2Toast.show("Ошибка сохранения флага", true) }
                    }
                }
            }
        }
        val list = items
        when {
            failed -> EmptyText("Не удалось загрузить флаги")
            list == null -> LoadingBlock(Modifier.padding(16.dp))
            list.isEmpty() -> EmptyText("Флагов пока нет")
            else -> list.forEach { f ->
                ListRow("${f.key} \u00B7 ${f.org_id ?: "все сети"} \u00B7 ${if (f.enabled) "включено" else "выключено"}", f.description) {
                    MChipButton("Удалить") {
                        scope.launch {
                            runCatching { api.deleteFlag(f.key, f.org_id) }
                                .onSuccess { T2Toast.show("Флаг удалён"); reload++ }
                                .onFailure { T2Toast.show("Ошибка удаления флага", true) }
                        }
                    }
                }
            }
        }
    }
}

// ---------------- Org settings
@Composable
internal fun OrgSettingsTab(container: AppContainer) {
    val api = container.adminApi
    val scope = rememberCoroutineScope()
    var orgs by remember { mutableStateOf<List<OrgAdminItem>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var reload by remember { mutableStateOf(0) }
    var selected by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(reload) { runCatching { api.getOrgs() }.onSuccess { orgs = it }.onFailure { failed = true } }

    PageSection("Сети") {
        val list = orgs
        when {
            failed -> EmptyText("Не удалось загрузить сети")
            list == null -> LoadingBlock(Modifier.padding(16.dp))
            list.isEmpty() -> EmptyText("Сетей нет")
            else -> list.forEach { o -> NavRow(o.brand_name ?: o.name, o.id + if (o.is_active == false) " \u00B7 неактивна" else "") { selected = o.id } }
        }
    }
    val org = orgs?.firstOrNull { it.id == selected }
    if (org != null) {
        Spacer(Modifier.height(12.dp))
        var name by remember(org.id) { mutableStateOf(org.name) }
        var brand by remember(org.id) { mutableStateOf(org.brand_name ?: "") }
        var color by remember(org.id) { mutableStateOf(org.primary_color ?: "#2AABEE") }
        PageSection(org.brand_name ?: org.name) {
            Column(modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Field("", name, { name = it }, placeholder = "Название", fill = T2Colors.surface2)
                Field("", brand, { brand = it }, placeholder = "Отображаемое имя", fill = T2Colors.surface2)
                Field("", color, { color = it }, placeholder = "#2AABEE", fill = T2Colors.surface2)
                MainButton("Сохранить", enabled = true) {
                    if (name.isBlank()) { T2Toast.show("Укажите название", true); return@MainButton }
                    val body = buildJsonObject {
                        put("name", JsonPrimitive(name.trim()))
                        brand.trim().takeIf { it.isNotEmpty() }?.let { put("brand_name", JsonPrimitive(it)) }
                        color.trim().takeIf { it.isNotEmpty() }?.let { put("primary_color", JsonPrimitive(it)) }
                    }
                    scope.launch {
                        runCatching { api.saveOrg(org.id, body) }
                            .onSuccess { T2Toast.show("Сеть сохранена"); reload++ }
                            .onFailure { T2Toast.show("Ошибка сохранения сети", true) }
                    }
                }
            }
        }
    }
}

// ---------------- Business rules (metrics catalog)
@Composable
internal fun RulesTab(container: AppContainer) {
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<MetricDef>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var reload by remember { mutableStateOf(0) }
    var label by remember { mutableStateOf("") }
    var short by remember { mutableStateOf("") }
    var unit by remember { mutableStateOf("шт") }

    LaunchedEffect(reload) { runCatching { container.salesApi.getMetrics().items }.onSuccess { items = it }.onFailure { failed = true } }

    PageSection("Новая метрика") {
        Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) { Field("", label, { label = it }, placeholder = "Название", fill = T2Colors.surface2) }
            Box(Modifier.weight(1f)) { Field("", short, { short = it }, placeholder = "Короткое имя", fill = T2Colors.surface2) }
            Box(Modifier.width(110.dp)) { SelectField("", unit, listOf("шт", "\u20BD")) { unit = it } }
            Box(Modifier.width(140.dp)) {
                MainButton("Добавить", enabled = true) {
                    if (label.isBlank()) { T2Toast.show("Укажите название", true); return@MainButton }
                    scope.launch {
                        runCatching { container.adminCenterApi.createMetric(label.trim(), short.trim().ifEmpty { null }, if (unit == "\u20BD") "money" else "count") }
                            .onSuccess { T2Toast.show("Метрика добавлена"); label = ""; short = ""; reload++ }
                            .onFailure { T2Toast.show("Ошибка добавления метрики", true) }
                    }
                }
            }
        }
        val list = items
        when {
            failed -> EmptyText("Не удалось загрузить метрики")
            list == null -> LoadingBlock(Modifier.padding(16.dp))
            list.isEmpty() -> EmptyText("Метрик нет")
            else -> list.forEach { m ->
                ListRow("${m.label ?: m.id} (${m.short_label ?: ""})", "${m.id} \u00B7 ${m.unit ?: ""}") {
                    MChipButton("Удалить") {
                        scope.launch {
                            runCatching { container.adminCenterApi.deleteMetric(m.id) }
                                .onSuccess { T2Toast.show("Метрика удалена"); reload++ }
                                .onFailure { T2Toast.show("Ошибка удаления (возможно, базовая метрика)", true) }
                        }
                    }
                }
            }
        }
    }
}

// ---------------- Operations center
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun OperationsTab(container: AppContainer) {
    var data by remember { mutableStateOf<JsonObject?>(null) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { runCatching { container.adminCenterApi.operations() }.onSuccess { data = it }.onFailure { failed = true } }

    fun str(o: kotlinx.serialization.json.JsonElement?, vararg keys: String): String =
        keys.firstNotNullOfOrNull { k -> ((o as? JsonObject)?.get(k) as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotEmpty() } } ?: ""

    val d = data
    PageSection("Открытые алерты по всем сетям") {
        when {
            failed -> EmptyText("Не удалось загрузить данные")
            d == null -> LoadingBlock(Modifier.padding(16.dp))
            else -> {
                val bySeverity = (d["alerts_by_severity"] as? JsonObject).orEmpty()
                if (bySeverity.isNotEmpty()) {
                    FlowRow(modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        bySeverity.forEach { (sev, count) -> StatusPill("$sev: ${(count as? JsonPrimitive)?.contentOrNull ?: ""}") }
                    }
                }
                val alerts = (d["alerts"] as? kotlinx.serialization.json.JsonArray).orEmpty()
                if (alerts.isEmpty()) EmptyText("Открытых алертов нет")
                alerts.forEach { a -> ListRow(str(a, "title", "alert_type"), str(a, "store_name", "store_id") + " \u00B7 " + str(a, "severity"), null) }
            }
        }
    }
    Spacer(Modifier.height(12.dp))
    PageSection("Заявки на доступ по всем сетям") {
        if (d != null) {
            val reqs = (d["pending_access_requests"] as? kotlinx.serialization.json.JsonArray).orEmpty()
            if (reqs.isEmpty()) EmptyText("Заявок на доступ нет")
            reqs.forEach { r ->
                val user = str(r, "telegram_username")
                ListRow(str(r, "full_name"), str(r, "effective_org_id", "org_id") + if (user.isNotEmpty()) " \u00B7 @$user" else "", null)
            }
        }
    }
}

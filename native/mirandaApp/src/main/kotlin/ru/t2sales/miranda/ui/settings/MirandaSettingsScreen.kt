package ru.t2sales.miranda.ui.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.CircularProgressIndicator
import androidx.compose.material.MaterialTheme
import androidx.compose.material.RadioButton
import androidx.compose.material.Switch
import androidx.compose.material.SwitchDefaults
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import ru.t2sales.miranda.settings.MirandaSettingsStore
import ru.t2sales.shared.api.MirandaApi
import ru.t2sales.shared.theme.T2Colors

/** Вкладка «Настройки» - отображение дерева контактов (локально) + свой статус "в сети" (на сервере). */
@Composable
fun MirandaSettingsScreen(api: MirandaApi) {
    val scope = rememberCoroutineScope()

    var groupByCustom by remember { mutableStateOf(MirandaSettingsStore.groupByMode == "custom") }
    var showOffline by remember { mutableStateOf(MirandaSettingsStore.showOfflineContacts) }
    var sortOnlineFirst by remember { mutableStateOf(MirandaSettingsStore.sortOnlineFirst) }

    // null = ещё не загружено с сервера; "online" | "offline" | "auto"
    var presence by remember { mutableStateOf<String?>(null) }
    var presenceError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        runCatching { api.listAllContacts() }
            .onFailure { presenceError = it.toString() }
        // Текущий presence_override не отдаётся отдельным эндпойнтом - дефолт
        // "авто" безопасен (ровно то, что уже активно, если ничего не меняли).
        presence = "auto"
    }

    fun setPresence(status: String) {
        val prev = presence
        presence = status
        scope.launch {
            runCatching { api.setPresence(status) }
                .onFailure { presence = prev; presenceError = it.toString() }
        }
    }

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp)) {
        Text("Настройки", fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, color = T2Colors.text)
        Spacer(Modifier.height(24.dp))

        SectionTitle("Отображение")
        Spacer(Modifier.height(12.dp))
        SettingToggleRow(
            label = "Группировать по своим группам контактов",
            hint = "Выключено - группировка по точке",
            checked = groupByCustom,
            onCheckedChange = {
                groupByCustom = it
                MirandaSettingsStore.groupByMode = if (it) "custom" else "store"
            }
        )
        Spacer(Modifier.height(12.dp))
        SettingToggleRow(
            label = "Показывать офлайн-контакты",
            hint = "Выключено - в группах видны только те, кто сейчас в сети",
            checked = showOffline,
            onCheckedChange = {
                showOffline = it
                MirandaSettingsStore.showOfflineContacts = it
            }
        )
        Spacer(Modifier.height(12.dp))
        SettingToggleRow(
            label = "Сначала контакты в сети",
            hint = "Внутри каждой группы контакты в сети поднимаются вверх",
            checked = sortOnlineFirst,
            onCheckedChange = {
                sortOnlineFirst = it
                MirandaSettingsStore.sortOnlineFirst = it
            }
        )

        Spacer(Modifier.height(32.dp))
        SectionTitle("Мой статус")
        Spacer(Modifier.height(12.dp))

        if (presence == null) {
            CircularProgressIndicator()
        } else {
            PresenceOption("Авто (в сети, когда открыто приложение)", "auto", presence!!) { setPresence(it) }
            PresenceOption("Всегда в сети", "online", presence!!) { setPresence(it) }
            PresenceOption("Всегда не в сети", "offline", presence!!) { setPresence(it) }
        }
        if (presenceError != null) {
            Spacer(Modifier.height(8.dp))
            Text(presenceError!!, color = T2Colors.text, fontSize = 12.sp)
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text.uppercase(), fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.6.sp, color = T2Colors.hint)
}

@Composable
private fun SettingToggleRow(label: String, hint: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(label, fontSize = 14.sp, color = T2Colors.text)
            Text(hint, fontSize = 12.sp, color = T2Colors.hint)
        }
        Spacer(Modifier.width(16.dp))
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            colors = SwitchDefaults.colors(checkedThumbColor = T2Colors.primary, checkedTrackColor = T2Colors.primarySoft)
        )
    }
}

@Composable
private fun PresenceOption(label: String, value: String, selected: String, onSelect: (String) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable { onSelect(value) }.padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        RadioButton(
            selected = selected == value,
            onClick = { onSelect(value) },
            colors = androidx.compose.material.RadioButtonDefaults.colors(selectedColor = T2Colors.primary)
        )
        Spacer(Modifier.width(8.dp))
        Text(label, fontSize = 14.sp, color = T2Colors.text)
    }
}

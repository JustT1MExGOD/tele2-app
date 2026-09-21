package ru.t2sales.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import ru.t2sales.android.AppContainer
import ru.t2sales.shared.api.AnnouncementItem
import ru.t2sales.shared.api.AnnouncementReads
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.theme.T2Colors

/** Port of #page-announce (pages/network-admin loadAnnouncements): announcements, "Прочитал", "Кто прочитал", new-announcement form. */
@Composable
fun AnnounceScreen(container: AppContainer, me: MeResponse) {
    val canManage = me.role == "manager" || me.role == "admin" || me.is_manager == true
    val api = container.infoApi
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<AnnouncementItem>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var reload by remember { mutableStateOf(0) }
    var readsFor by remember { mutableStateOf<AnnouncementItem?>(null) }
    var title by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    var required by remember { mutableStateOf(false) }

    LaunchedEffect(reload) { runCatching { api.announcements() }.onSuccess { items = it }.onFailure { failed = true } }

    PageSection("Объявления сети") {
        val list = items
        when {
            failed -> Text("\uD83C\uDF49 Не удалось загрузить объявления", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
            list == null -> LoadingBlock(Modifier.padding(16.dp))
            list.isEmpty() -> Text("\uD83C\uDF49 Нет объявлений", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
            else -> list.forEach { a ->
                val shape = RoundedCornerShape(16.dp)
                Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp).fillMaxWidth().clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape).padding(14.dp)) {
                    Text(a.title + if (a.required) " \u00B7 обязательно" else "", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    Text((if (a.is_read) "\u2713 прочитано" else "не прочитано") + " \u00B7 " + a.created_at.take(10), color = T2Colors.hint, fontSize = 11.sp)
                    Text(a.body, fontSize = 14.sp, lineHeight = 20.sp, modifier = Modifier.padding(vertical = 8.dp))
                    if (!a.is_read) MainButton("Прочитал", enabled = true) {
                        scope.launch { runCatching { api.markAnnouncementRead(a.id) }; reload++ }
                    }
                    if (canManage) Row(modifier = Modifier.padding(top = 8.dp)) { MChipButton("Кто прочитал") { readsFor = a } }
                }
            }
        }
    }

    if (canManage) {
        Spacer(Modifier.height(12.dp))
        PageSection("Новое объявление") {
            Column(modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 14.dp)) {
                Field("Заголовок", title, { title = it }, fill = T2Colors.surface2)
                Spacer(Modifier.height(14.dp))
                Field("Текст", body, { body = it }, fill = T2Colors.surface2)
                Row(modifier = Modifier.padding(vertical = 8.dp).clip(RoundedCornerShape(8.dp)).clickable { required = !required }.padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(if (required) "\u2611" else "\u2610", fontSize = 20.sp, color = T2Colors.primary)
                    Text(" Обязательное", fontSize = 13.sp)
                }
                MainButton("Опубликовать", enabled = true) {
                    if (title.isBlank() || body.isBlank()) { T2Toast.show("Заполни заголовок и текст", true); return@MainButton }
                    scope.launch {
                        runCatching { api.createAnnouncement(title.trim(), body.trim(), required) }
                            .onSuccess { T2Toast.show("Опубликовано"); title = ""; body = ""; required = false; reload++ }
                            .onFailure { T2Toast.show((it.message ?: "Ошибка") + " (нужна таблица announcements)", true) }
                    }
                }
            }
        }
    }

    readsFor?.let { a ->
        var reads by remember(a.id) { mutableStateOf<AnnouncementReads?>(null) }
        var readsFailed by remember(a.id) { mutableStateOf(false) }
        LaunchedEffect(a.id) { runCatching { api.announcementReads(a.id) }.onSuccess { reads = it }.onFailure { readsFailed = true } }
        SheetDialog("Кто прочитал", onDismiss = { readsFor = null }) {
            val r = reads
            when {
                readsFailed -> Text("Не удалось загрузить", color = T2Colors.hint, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(16.dp))
                r == null -> LoadingBlock()
                else -> {
                    Text("ПРОЧИТАЛИ (${r.read.size}/${r.read.size + r.unread.size})", color = T2Colors.hint, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.7.sp, modifier = Modifier.padding(bottom = 8.dp))
                    if (r.read.isEmpty()) Text("Пока никто", color = T2Colors.hint, fontSize = 13.sp)
                    r.read.forEach { Text("\u2713 ${it.full_name}", fontSize = 13.sp, modifier = Modifier.padding(vertical = 4.dp)) }
                    if (r.unread.isNotEmpty()) {
                        Text("ЕЩЁ НЕ ПРОЧИТАЛИ", color = T2Colors.hint, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.7.sp, modifier = Modifier.padding(top = 12.dp, bottom = 8.dp))
                        r.unread.forEach { Text(it.full_name, fontSize = 13.sp, color = T2Colors.hint, modifier = Modifier.padding(vertical = 4.dp)) }
                    }
                }
            }
        }
    }
}

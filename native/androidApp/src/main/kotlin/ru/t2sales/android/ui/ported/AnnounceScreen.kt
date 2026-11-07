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

    fun publish() {
        if (title.isBlank() || body.isBlank()) { T2Toast.show("Заполни заголовок и текст", true); return }
        scope.launch {
            runCatching { api.createAnnouncement(title.trim(), body.trim(), required) }
                .onSuccess { T2Toast.show("Опубликовано"); title = ""; body = ""; required = false; reload++ }
                .onFailure { T2Toast.show((it.message ?: "Ошибка") + " (нужна таблица announcements)", true) }
        }
    }

    LaunchedEffect(reload) {
        failed = false
        runCatching { api.announcements() }.onSuccess { items = it }.onFailure { failed = true }
    }

    if (T2Colors.uiBeta) {
        AnnounceBeta(
            items, failed, canManage,
            title, { title = it }, body, { body = it }, required, { required = it },
            onRetry = { reload++ },
            onRead = { a -> scope.launch { runCatching { api.markAnnouncementRead(a.id) }; reload++ } },
            onReads = { readsFor = it },
            onPublish = ::publish
        )
        AnnounceReadsSheet(readsFor, api) { readsFor = null }
        return
    }

    PageSection("Объявления сети") {
        val list = items
        when {
            failed -> ErrorState("🍉 Не удалось загрузить объявления", onRetry = { reload++ })
            list == null -> LoadingBlock(Modifier.padding(16.dp))
            list.isEmpty() -> EmptyText("🍉 Нет объявлений")
            else -> list.forEach { a ->
                val shape = RoundedCornerShape(16.dp)
                Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp).fillMaxWidth().clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape).padding(14.dp)) {
                    Text(a.title + if (a.required) " · обязательно" else "", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    Text((if (a.is_read) "✓ прочитано" else "не прочитано") + " · " + a.created_at.take(10), color = T2Colors.hint, fontSize = 11.sp)
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
                    Text(if (required) "☑" else "☐", fontSize = 20.sp, color = T2Colors.primary)
                    Text(" Обязательное", fontSize = 13.sp)
                }
                MainButton("Опубликовать", enabled = true) { publish() }
            }
        }
    }

    AnnounceReadsSheet(readsFor, api) { readsFor = null }
}

@Composable
private fun AnnounceReadsSheet(readsFor: AnnouncementItem?, api: ru.t2sales.shared.api.InfoApi, onDismiss: () -> Unit) {
    readsFor?.let { a ->
        var reads by remember(a.id) { mutableStateOf<AnnouncementReads?>(null) }
        var readsFailed by remember(a.id) { mutableStateOf(false) }
        LaunchedEffect(a.id) { runCatching { api.announcementReads(a.id) }.onSuccess { reads = it }.onFailure { readsFailed = true } }
        SheetDialog("Кто прочитал", onDismiss = onDismiss) {
            val r = reads
            when {
                readsFailed -> Text("Не удалось загрузить", color = T2Colors.hint, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(16.dp))
                r == null -> LoadingBlock()
                else -> {
                    Text("ПРОЧИТАЛИ (${r.read.size}/${r.read.size + r.unread.size})", color = T2Colors.hint, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.7.sp, modifier = Modifier.padding(bottom = 8.dp))
                    if (r.read.isEmpty()) Text("Пока никто", color = T2Colors.hint, fontSize = 13.sp)
                    r.read.forEach { Text("✓ ${it.full_name}", fontSize = 13.sp, modifier = Modifier.padding(vertical = 4.dp)) }
                    if (r.unread.isNotEmpty()) {
                        Text("ЕЩЁ НЕ ПРОЧИТАЛИ", color = T2Colors.hint, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.7.sp, modifier = Modifier.padding(top = 12.dp, bottom = 8.dp))
                        r.unread.forEach { Text(it.full_name, fontSize = 13.sp, color = T2Colors.hint, modifier = Modifier.padding(vertical = 4.dp)) }
                    }
                }
            }
        }
    }
}

// ======================= Beta UI 3.0 «Ночная смена» (design-system/ui3/v5-team, screen "Объявления") =======================

/**
 * Hero with the unread count, the announcements as grouped cells (unread ones get a "Отметить прочитанным" action cell),
 * and — for managers — the new-announcement form under a U3GroupHead (fields stay classic).
 */
@Composable
private fun AnnounceBeta(
    items: List<AnnouncementItem>?, failed: Boolean, canManage: Boolean,
    title: String, onTitle: (String) -> Unit, body: String, onBody: (String) -> Unit, required: Boolean, onRequired: (Boolean) -> Unit,
    onRetry: () -> Unit, onRead: (AnnouncementItem) -> Unit, onReads: (AnnouncementItem) -> Unit, onPublish: () -> Unit
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
        U3LargeTitle("Объявления")
        val list = items
        when {
            failed -> ErrorState("Не удалось загрузить объявления", onRetry = onRetry)
            list == null -> SkeletonBlock(Modifier.fillMaxWidth().height(160.dp), 28.dp)
            list.isEmpty() -> EmptyText("Нет объявлений")
            else -> {
                val unread = list.count { !it.is_read }
                U3Hero {
                    U3HeroRow("Объявления сети", chip = if (unread > 0) "$unread новых" else "Всё прочитано")
                    U3HeroNumber("$unread", if (unread == 1) "непрочитанное" else "непрочитанных")
                }
                Spacer(Modifier.height(14.dp))
                U3Group {
                    list.forEachIndexed { i, a ->
                        if (i > 0) U3Sep()
                        U3Cell(
                            a.title + if (a.required) " · обязательно" else "",
                            (if (a.is_read) "✓ прочитано" else "не прочитано") + " · " + a.created_at.take(10) + "\n" + a.body,
                            leading = { U3IconTile(NavIcons.announce, tint = if (a.is_read) T2Colors.textSecondary else T2Colors.accentText) },
                            trailing = if (canManage) ({ Text("›", color = T2Colors.hint, fontSize = 18.sp) }) else null,
                            onClick = if (canManage) ({ onReads(a) }) else null
                        )
                        if (!a.is_read) {
                            U3Sep()
                            U3Cell("Отметить прочитанным", onClick = { onRead(a) })
                        }
                    }
                }
            }
        }
        if (canManage) {
            U3GroupHead("Новое объявление")
            U3Group {
                Column(modifier = Modifier.padding(16.dp)) {
                    Field("Заголовок", title, onTitle, fill = T2Colors.surface2)
                    Spacer(Modifier.height(14.dp))
                    Field("Текст", body, onBody, fill = T2Colors.surface2)
                    Row(modifier = Modifier.padding(vertical = 8.dp).clip(RoundedCornerShape(8.dp)).clickable { onRequired(!required) }.padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(if (required) "☑" else "☐", fontSize = 20.sp, color = T2Colors.primary)
                        Text(" Обязательное", fontSize = 13.sp)
                    }
                    U3PrimaryButton("Опубликовать", onClick = onPublish)
                }
            }
        }
        Spacer(Modifier.height(96.dp))
    }
}

package ru.t2sales.miranda.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.CircularProgressIndicator
import androidx.compose.material.Icon
import androidx.compose.material.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.Send
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.awt.FileDialog
import java.io.File
import java.util.UUID
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ru.t2sales.miranda.ui.components.T2Toast
import ru.t2sales.shared.api.MirandaApi
import ru.t2sales.shared.api.MirandaAttachment
import ru.t2sales.shared.api.MirandaMessage
import ru.t2sales.shared.api.MirandaPostMessageRequest
import ru.t2sales.shared.theme.T2Colors

private const val MAX_BODY = 5000
private const val MAX_ATTACHMENTS = 5
private const val PAGE = 50
private const val MAX_VISIBLE = 300

private enum class PendingStatus { Sending, Failed }

private class Pending(
    val clientId: String,
    val body: String?,
    val files: List<File>,
    val attachmentIds: MutableList<String?>,
    var status: PendingStatus
)

/**
 * Port of desktopApp's ChatScreen.kt, adapted from the org-wide chat
 * channel to a single Miranda conversation: WS frames filtered by
 * conversationId, keyset pagination via MirandaMessage.id, sender shaped
 * as corporateAccountId/employeeId/displayName (no role - Miranda doesn't
 * surface the sender's T2 Sales role in a corporate messenger).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MirandaChatScreen(api: MirandaApi, conversationId: Int, myCorporateAccountId: Int) {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    val messages = remember { mutableStateListOf<MirandaMessage>() }
    val pending = remember { mutableStateListOf<Pending>() }
    val composerFiles = remember { mutableStateListOf<File>() }
    var loaded by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    var oldestCursor by remember { mutableStateOf<String?>(null) }
    var hasMore by remember { mutableStateOf(true) }
    var loadingOlder by remember { mutableStateOf(false) }
    var text by remember { mutableStateOf("") }

    fun upsert(m: MirandaMessage): Boolean {
        if (messages.any { it.id == m.id }) return false
        pending.removeAll { it.clientId == m.clientMessageId }
        messages.add(m)
        messages.sortBy { it.id }
        while (messages.size > MAX_VISIBLE) messages.removeAt(0)
        return true
    }

    LaunchedEffect(conversationId) {
        messages.clear(); pending.clear(); loaded = false; failed = false
        runCatching { api.getMessages(conversationId, null, PAGE) }
            .onSuccess { r ->
                messages.addAll(r.items.sortedBy { it.id })
                oldestCursor = r.nextCursor; hasMore = r.nextCursor != null
            }
            .onFailure { failed = true; T2Toast.show("Не удалось загрузить переписку", true) }
        loaded = true
        if (messages.isNotEmpty()) {
            listState.scrollToItem(messages.size - 1)
            runCatching { api.markRead(conversationId, messages.last().id.toString()) }
        }
    }

    fun applyIncoming(items: List<MirandaMessage>) {
        var added = false
        items.sortedBy { it.id }.forEach { if (upsert(it)) added = true }
        if (added) {
            scope.launch { listState.animateScrollToItem((messages.size + pending.size - 1).coerceAtLeast(0)) }
            messages.lastOrNull()?.let { last -> scope.launch { runCatching { api.markRead(conversationId, last.id.toString()) } } }
        }
    }

    var wsUp by remember { mutableStateOf(false) }
    LaunchedEffect(loaded, conversationId) {
        if (!loaded) return@LaunchedEffect
        var retry = 5000L
        while (true) {
            runCatching {
                api.listen(
                    onOpen = { wsUp = true; retry = 5000L },
                    onFrame = { f ->
                        if (f["type"]?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content } == "message") {
                            (f["message"] as? kotlinx.serialization.json.JsonObject)?.let { m ->
                                runCatching { kotlinx.serialization.json.Json { ignoreUnknownKeys = true }.decodeFromJsonElement(MirandaMessage.serializer(), m) }
                                    .getOrNull()?.let { if (it.conversationId == conversationId) applyIncoming(listOf(it)) }
                            }
                        }
                    }
                )
            }
            wsUp = false
            delay(retry)
            retry = (retry * 3 / 2).coerceAtMost(60000L)
        }
    }
    // Polling catch-up stays the source of truth while the WS is reconnecting - same backstop as the org-wide chat.
    LaunchedEffect(loaded, conversationId) {
        if (!loaded) return@LaunchedEffect
        var pollDelay = 4000L
        while (true) {
            val wait = if (wsUp) maxOf(15000L, pollDelay) else pollDelay
            delay(wait)
            val last = messages.lastOrNull()?.id?.toString() ?: "0"
            runCatching { api.getMessagesAfter(conversationId, last, PAGE) }
                .onSuccess { r -> applyIncoming(r.items); pollDelay = 4000L }
                .onFailure { pollDelay = (pollDelay * 2).coerceAtMost(30000L) }
        }
    }

    LaunchedEffect(listState, conversationId) {
        androidx.compose.runtime.snapshotFlow { listState.firstVisibleItemIndex }.collect { idx ->
            val cursor = oldestCursor
            if (idx == 0 && hasMore && !loadingOlder && cursor != null && messages.isNotEmpty()) {
                loadingOlder = true
                runCatching { api.getMessages(conversationId, cursor, PAGE) }
                    .onSuccess { r ->
                        val older = r.items.sortedBy { it.id }.filter { o -> messages.none { it.id == o.id } }
                        messages.addAll(0, older)
                        oldestCursor = r.nextCursor; hasMore = r.nextCursor != null
                        listState.scrollToItem(older.size)
                    }
                    .onFailure { T2Toast.show("Не удалось загрузить историю", true) }
                loadingOlder = false
            }
        }
    }

    fun submit(p: Pending) {
        scope.launch {
            p.status = PendingStatus.Sending
            runCatching {
                p.files.forEachIndexed { i, f ->
                    if (p.attachmentIds[i] == null) {
                        val mime = java.nio.file.Files.probeContentType(f.toPath()) ?: "application/octet-stream"
                        p.attachmentIds[i] = api.uploadAttachment(f.name, mime, f.readBytes()).id
                    }
                }
                val ids = p.attachmentIds.filterNotNull()
                api.postMessage(conversationId, MirandaPostMessageRequest(p.clientId, p.body, ids))
            }.onSuccess { m ->
                upsert(m)
                listState.animateScrollToItem((messages.size + pending.size - 1).coerceAtLeast(0))
            }.onFailure {
                val i = pending.indexOfFirst { x -> x.clientId == p.clientId }
                if (i >= 0) pending[i] = Pending(p.clientId, p.body, p.files, p.attachmentIds, PendingStatus.Failed)
                T2Toast.show(it.message ?: "Не удалось отправить сообщение", true)
            }
        }
    }

    fun send() {
        val body = text.trim()
        if (body.isEmpty() && composerFiles.isEmpty()) return
        if (body.length > MAX_BODY) { T2Toast.show("Сообщение длиннее $MAX_BODY символов", true); return }
        val p = Pending(UUID.randomUUID().toString(), body.ifEmpty { null }, composerFiles.toList(), MutableList(composerFiles.size) { null }, PendingStatus.Sending)
        text = ""
        composerFiles.clear()
        pending.add(p)
        scope.launch { listState.scrollToItem((messages.size + pending.size - 1).coerceAtLeast(0)) }
        submit(p)
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
            when {
                failed -> Text("Не удалось загрузить переписку", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.align(Alignment.Center).padding(24.dp))
                !loaded -> CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                else -> BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
                    val bubbleMax = minOf(maxWidth * 0.78f, 640.dp)
                    LazyColumn(
                        state = listState,
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.Bottom)
                    ) {
                        itemsIndexed(messages, key = { _, m -> m.id }) { _, m ->
                            MessageRow(m, mine = m.sender.corporateAccountId == myCorporateAccountId, bubbleMax = bubbleMax) { a -> download(scope, api, a) }
                        }
                        itemsIndexed(pending, key = { _, p -> "p" + p.clientId + p.status }) { _, p ->
                            PendingRow(p, bubbleMax) { submit(p) }
                        }
                    }
                }
            }
        }

        Column(modifier = Modifier.fillMaxWidth().background(T2Colors.surface).padding(horizontal = 12.dp, vertical = 8.dp)) {
            if (composerFiles.isNotEmpty()) {
                FlowRow(modifier = Modifier.padding(bottom = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    composerFiles.forEachIndexed { i, f ->
                        Row(
                            modifier = Modifier.clip(CircleShape).background(T2Colors.surface2).padding(horizontal = 8.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(f.name, fontSize = 11.sp)
                            Text("  ×", color = T2Colors.hint, fontSize = 14.sp, modifier = Modifier.clickable { composerFiles.removeAt(i) })
                        }
                    }
                }
            }
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(
                    modifier = Modifier.size(44.dp).clip(CircleShape).background(T2Colors.surface2).border(1.dp, T2Colors.border, CircleShape).clickable {
                        val dlg = FileDialog(null as java.awt.Frame?, "Прикрепить файл", FileDialog.LOAD)
                        dlg.isMultipleMode = true
                        dlg.isVisible = true
                        val picked = dlg.files.toList()
                        if (picked.isNotEmpty()) {
                            if (composerFiles.size + picked.size > MAX_ATTACHMENTS) T2Toast.show("Максимум $MAX_ATTACHMENTS вложений на сообщение", true)
                            composerFiles.addAll(picked.take(MAX_ATTACHMENTS - composerFiles.size))
                        }
                    },
                    contentAlignment = Alignment.Center
                ) { Icon(Icons.Outlined.AttachFile, contentDescription = "Прикрепить файл", tint = T2Colors.text, modifier = Modifier.size(20.dp)) }

                val shape = RoundedCornerShape(16.dp)
                BasicTextField(
                    value = text,
                    onValueChange = { text = it },
                    textStyle = TextStyle(color = T2Colors.text, fontSize = 14.sp),
                    cursorBrush = SolidColor(T2Colors.primary),
                    decorationBox = { inner ->
                        Box {
                            if (text.isEmpty()) Text("Написать сообщение…", color = T2Colors.hint, fontSize = 14.sp)
                            inner()
                        }
                    },
                    modifier = Modifier
                        .weight(1f)
                        .heightIn(min = 44.dp, max = 120.dp)
                        .clip(shape)
                        .background(T2Colors.surface2)
                        .border(1.dp, T2Colors.border, shape)
                        .padding(horizontal = 12.dp, vertical = 12.dp)
                        .onPreviewKeyEvent { e ->
                            if (e.key == Key.Enter && e.type == KeyEventType.KeyDown && !e.isShiftPressed) {
                                send(); true
                            } else false
                        }
                )
                val canSend = text.isNotBlank() || composerFiles.isNotEmpty()
                Box(
                    modifier = Modifier.size(44.dp).clip(CircleShape).background(if (canSend) T2Colors.primary else T2Colors.surface3).clickable(enabled = canSend) { send() },
                    contentAlignment = Alignment.Center
                ) { Icon(Icons.Outlined.Send, contentDescription = "Отправить", tint = if (canSend) Color.White else T2Colors.hint, modifier = Modifier.size(20.dp)) }
            }
        }
    }
}

private fun download(scope: kotlinx.coroutines.CoroutineScope, api: MirandaApi, a: MirandaAttachment) {
    scope.launch {
        runCatching { api.downloadAttachment(a.id) }
            .onSuccess { bytes ->
                val dlg = FileDialog(null as java.awt.Frame?, "Сохранить файл", FileDialog.SAVE)
                dlg.file = a.originalFilename
                dlg.isVisible = true
                val name = dlg.file
                if (name != null) File(dlg.directory, name).writeBytes(bytes)
            }
            .onFailure { T2Toast.show("Не удалось скачать файл", true) }
    }
}

@Composable
private fun MessageRow(m: MirandaMessage, mine: Boolean, bubbleMax: androidx.compose.ui.unit.Dp, onAttachment: (MirandaAttachment) -> Unit) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
        Column(
            modifier = Modifier
                .widthIn(max = bubbleMax)
                .clip(RoundedCornerShape(16.dp))
                .background(if (mine) T2Colors.primarySoft else T2Colors.surface2)
                .padding(horizontal = 12.dp, vertical = 8.dp)
        ) {
            if (!mine) Text(m.sender.displayName, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            val msgBody = m.body
            if (!msgBody.isNullOrEmpty()) Text(msgBody, color = T2Colors.text, fontSize = 14.sp, lineHeight = 20.sp)
            if (m.attachments.isNotEmpty()) {
                Column(modifier = Modifier.padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    m.attachments.forEach { a ->
                        val shape = RoundedCornerShape(8.dp)
                        Row(
                            modifier = Modifier.fillMaxWidth().clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape).clickable { onAttachment(a) }.padding(horizontal = 10.dp, vertical = 6.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Text(a.originalFilename, fontSize = 12.sp, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
                            Text(size(a.sizeBytes), color = T2Colors.hint, fontSize = 12.sp)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PendingRow(p: Pending, bubbleMax: androidx.compose.ui.unit.Dp, onRetry: () -> Unit) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Column(modifier = Modifier.widthIn(max = bubbleMax).clip(RoundedCornerShape(16.dp)).background(T2Colors.primarySoft).padding(horizontal = 12.dp, vertical = 8.dp)) {
            val pendingBody = p.body
            if (!pendingBody.isNullOrEmpty()) Text(pendingBody, fontSize = 14.sp, lineHeight = 20.sp)
            p.files.forEach { Text(it.name, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp)) }
            Row(modifier = Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val label = if (p.status == PendingStatus.Sending) "Отправка…" else "Не отправлено"
                Text(label, fontSize = 10.sp, color = if (p.status == PendingStatus.Failed) T2Colors.danger else T2Colors.hint)
                if (p.status != PendingStatus.Sending) Text("Повторить", fontSize = 10.sp, color = T2Colors.primary, fontWeight = FontWeight.SemiBold, modifier = Modifier.clickable(onClick = onRetry))
            }
        }
    }
}

private fun size(bytes: Long): String = when {
    bytes < 1024 -> "$bytes Б"
    bytes < 1024 * 1024 -> "%.1f КБ".format(bytes / 1024.0)
    else -> "%.1f МБ".format(bytes / (1024.0 * 1024.0))
}

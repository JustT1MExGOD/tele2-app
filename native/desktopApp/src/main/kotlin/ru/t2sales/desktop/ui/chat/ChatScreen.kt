package ru.t2sales.desktop.ui.chat

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
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.awt.FileDialog
import java.io.File
import java.math.BigInteger
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ru.t2sales.desktop.di.AppContainer
import ru.t2sales.desktop.ui.components.T2Toast
import ru.t2sales.shared.api.ChatAttachment
import ru.t2sales.shared.api.ChatMessage
import ru.t2sales.shared.api.CreateChatMessageRequest
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.theme.T2Colors

private const val MAX_BODY = 5000
private const val MAX_ATTACHMENTS = 5
private const val PAGE = 50
private const val MAX_VISIBLE = 300

private val ROLE = mapOf(
    "trainee" to "Стажёр", "employee" to "Сотрудник", "senior" to "Старший",
    "manager" to "Управляющий", "supervisor" to "Супервайзер", "admin" to "Админ"
)

private enum class PendingStatus { Sending, Failed, Unknown }

private class Pending(
    val clientId: String,
    val body: String?,
    val files: List<File>,
    val attachmentIds: MutableList<String?>,
    var status: PendingStatus
)

private fun idOf(m: ChatMessage): BigInteger = m.id.toBigIntegerOrNull() ?: BigInteger.ZERO

private fun timeMsk(iso: String): String = runCatching {
    OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.of("Europe/Moscow")).format(DateTimeFormatter.ofPattern("HH:mm"))
}.getOrDefault("")

private fun size(bytes: Long): String = when {
    bytes < 1024 -> "$bytes Б"
    bytes < 1024 * 1024 -> "%.1f КБ".format(bytes / 1024.0)
    else -> "%.1f МБ".format(bytes / (1024.0 * 1024.0))
}

/** Port of pages/chat: message feed with history + catch-up polling, composer with attachments (Enter sends). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ChatScreen(container: AppContainer, me: MeResponse) {
    val api = container.chatApi
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    val messages = remember { mutableStateListOf<ChatMessage>() }
    val pending = remember { mutableStateListOf<Pending>() }
    val composerFiles = remember { mutableStateListOf<File>() }
    var loaded by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    var oldestCursor by remember { mutableStateOf<String?>(null) }
    var hasMore by remember { mutableStateOf(true) }
    var loadingOlder by remember { mutableStateOf(false) }
    var text by remember { mutableStateOf("") }
    var newBelow by remember { mutableStateOf(false) }

    fun upsert(m: ChatMessage): Boolean {
        if (messages.any { it.id == m.id }) return false
        pending.removeAll { it.clientId == m.clientMessageId }
        messages.add(m)
        messages.sortWith(compareBy { idOf(it) })
        while (messages.size > MAX_VISIBLE) messages.removeAt(0)
        return true
    }
    val nearBottom by remember {
        derivedStateOf {
            val info = listState.layoutInfo
            val last = info.visibleItemsInfo.lastOrNull()?.index ?: 0
            last >= info.totalItemsCount - 2
        }
    }

    LaunchedEffect(Unit) {
        runCatching { api.getMessages(null, PAGE) }
            .onSuccess { r ->
                messages.clear(); messages.addAll(r.items.sortedBy { idOf(it) })
                oldestCursor = r.nextCursor; hasMore = r.nextCursor != null
            }
            .onFailure { failed = true; T2Toast.show("Не удалось загрузить чат", true) }
        loaded = true
        if (messages.isNotEmpty()) listState.scrollToItem(messages.size - 1)
    }

    fun applyIncoming(items: List<ChatMessage>) {
        val wasNear = nearBottom
        var added = false
        items.sortedBy { idOf(it) }.forEach { if (upsert(it)) added = true }
        if (added) {
            scope.launch { if (wasNear) listState.animateScrollToItem((messages.size + pending.size - 1).coerceAtLeast(0)) else newBelow = true }
        }
    }

    // Like the web's RealtimeTransport: WebSocket pushes ("message" applied directly, "refresh" triggers a catch-up), polling
    // stays as the REST source of truth - every 4s while the socket is down, every 15s while it is up.
    val kick = remember { kotlinx.coroutines.channels.Channel<Unit>(kotlinx.coroutines.channels.Channel.CONFLATED) }
    var wsUp by remember { mutableStateOf(false) }
    LaunchedEffect(loaded) {
        if (!loaded) return@LaunchedEffect
        var retry = 5000L
        while (true) {
            runCatching {
                api.listen(
                    onOpen = { wsUp = true; retry = 5000L; kick.trySend(Unit) },
                    onFrame = { f ->
                        when (f["type"]?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content }) {
                            "refresh" -> kick.trySend(Unit)
                            "message" -> (f["message"] as? kotlinx.serialization.json.JsonObject)?.let { m ->
                                runCatching { kotlinx.serialization.json.Json { ignoreUnknownKeys = true }.decodeFromJsonElement(ChatMessage.serializer(), m) }.getOrNull()?.let { applyIncoming(listOf(it)) }
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
    LaunchedEffect(loaded) {
        if (!loaded) return@LaunchedEffect
        var pollDelay = 4000L
        while (true) {
            val wait = if (wsUp) maxOf(15000L, pollDelay) else pollDelay
            kotlinx.coroutines.withTimeoutOrNull(wait) { kick.receive() }
            val last = messages.lastOrNull()?.id ?: "0"
            runCatching { api.getAfter(last, PAGE) }
                .onSuccess { items -> applyIncoming(items); pollDelay = 4000L }
                .onFailure { pollDelay = (pollDelay * 2).coerceAtMost(30000L) }
        }
    }

    // scrolled to the top -> older history
    LaunchedEffect(listState) {
        androidx.compose.runtime.snapshotFlow { listState.firstVisibleItemIndex to listState.firstVisibleItemScrollOffset }.collect { (idx, _) ->
            val cursor = oldestCursor
            if (idx == 0 && hasMore && !loadingOlder && cursor != null && messages.isNotEmpty()) {
                loadingOlder = true
                runCatching { api.getMessages(cursor, PAGE) }
                    .onSuccess { r ->
                        val older = r.items.sortedBy { idOf(it) }.filter { o -> messages.none { it.id == o.id } }
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
                api.post(CreateChatMessageRequest(p.clientId, p.body, ids))
            }.onSuccess { m ->
                upsert(m)
                pending.removeAll { it.clientId == p.clientId }
                listState.animateScrollToItem((messages.size + pending.size - 1).coerceAtLeast(0))
            }.onFailure {
                val i = pending.indexOfFirst { x -> x.clientId == p.clientId }
                if (i >= 0) {
                    val cur = pending[i]
                    cur.status = PendingStatus.Failed
                    pending[i] = Pending(cur.clientId, cur.body, cur.files, cur.attachmentIds, PendingStatus.Failed)
                }
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
                failed -> Text("Не удалось загрузить чат", color = T2Colors.textSecondary, fontSize = 13.sp, modifier = Modifier.align(Alignment.Center).padding(24.dp))
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
                            MessageRow(m, mine = m.sender.id == me.employee_id, bubbleMax = bubbleMax) { a -> download(scope, api, a) }
                        }
                        itemsIndexed(pending, key = { _, p -> "p" + p.clientId + p.status }) { _, p ->
                            PendingRow(p, bubbleMax) { submit(p) }
                        }
                    }
                    if (newBelow && !nearBottom) {
                        Text(
                            "Новые сообщения \u2193",
                            color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                            modifier = Modifier
                                .align(Alignment.BottomCenter)
                                .padding(bottom = 16.dp)
                                .clip(CircleShape)
                                .background(Color(0xFF106FA3))
                                .clickable {
                                    newBelow = false
                                    scope.launch { listState.animateScrollToItem((messages.size + pending.size - 1).coerceAtLeast(0)) }
                                }
                                .padding(horizontal = 14.dp, vertical = 8.dp)
                        )
                    }
                }
            }
        }

        // composer
        Column(modifier = Modifier.fillMaxWidth().background(T2Colors.surface).border(0.dp, Color.Transparent).padding(horizontal = 12.dp, vertical = 8.dp)) {
            Box(modifier = Modifier.fillMaxWidth().size(width = 1.dp, height = 0.dp))
            if (composerFiles.isNotEmpty()) {
                FlowRow(modifier = Modifier.padding(bottom = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    composerFiles.forEachIndexed { i, f ->
                        Row(
                            modifier = Modifier.clip(CircleShape).background(T2Colors.surface2).padding(horizontal = 8.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(f.name, fontSize = 11.sp)
                            Text("  \u00D7", color = T2Colors.textSecondary, fontSize = 14.sp, modifier = Modifier.clickable { composerFiles.removeAt(i) })
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
                            if (text.isEmpty()) Text("Написать сообщение\u2026", color = T2Colors.hint, fontSize = 14.sp)
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
                ) { Icon(Icons.Outlined.Send, contentDescription = "Отправить", tint = if (canSend) Color.White else T2Colors.textSecondary, modifier = Modifier.size(20.dp)) }
            }
        }
    }
}

private fun download(scope: kotlinx.coroutines.CoroutineScope, api: ru.t2sales.shared.api.ChatApi, a: ChatAttachment) {
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
private fun linkified(body: String): AnnotatedString = buildAnnotatedString {
    val regex = Regex("https?://[^\\s<]+")
    var last = 0
    regex.findAll(body).forEach { m ->
        var url = m.value
        val trailing = Regex("[),.!?;:]+$").find(url)?.value ?: ""
        if (trailing.isNotEmpty()) url = url.dropLast(trailing.length)
        append(body.substring(last, m.range.first))
        pushStringAnnotation("URL", url)
        withStyle(SpanStyle(color = T2Colors.primary, textDecoration = TextDecoration.Underline)) { append(url) }
        pop()
        append(trailing)
        last = m.range.last + 1
    }
    append(body.substring(last))
}

@Composable
private fun MessageRow(m: ChatMessage, mine: Boolean, bubbleMax: androidx.compose.ui.unit.Dp, onAttachment: (ChatAttachment) -> Unit) {
    val uri = androidx.compose.ui.platform.LocalUriHandler.current
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
        Column(
            modifier = Modifier
                .widthIn(max = bubbleMax)
                .clip(RoundedCornerShape(16.dp))
                .background(if (mine) T2Colors.primarySoft else T2Colors.surface2)
                .padding(horizontal = 12.dp, vertical = 8.dp)
        ) {
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(m.sender.displayName, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                Text(ROLE[m.sender.role] ?: m.sender.role, fontSize = 11.sp, color = T2Colors.textSecondary)
            }
            val msgBody = m.body
            if (!msgBody.isNullOrEmpty()) {
                val annotated = linkified(msgBody)
                androidx.compose.foundation.text.ClickableText(
                    text = annotated,
                    style = TextStyle(color = T2Colors.text, fontSize = 14.sp, lineHeight = 20.sp),
                    onClick = { off -> annotated.getStringAnnotations("URL", off, off).firstOrNull()?.let { runCatching { uri.openUri(it.item) } } }
                )
            }
            if (m.attachments.isNotEmpty()) {
                Column(modifier = Modifier.padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    m.attachments.forEach { a ->
                        val shape = RoundedCornerShape(8.dp)
                        Row(
                            modifier = Modifier.fillMaxWidth().clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape).clickable { onAttachment(a) }.padding(horizontal = 10.dp, vertical = 6.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Text(a.originalFilename, fontSize = 12.sp, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
                            Text(size(a.sizeBytes), color = T2Colors.textSecondary, fontSize = 12.sp)
                        }
                    }
                }
            }
            Text(timeMsk(m.createdAt), fontSize = 10.sp, color = T2Colors.textSecondary, modifier = Modifier.padding(top = 4.dp))
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
                val label = when (p.status) { PendingStatus.Sending -> "Отправка\u2026"; PendingStatus.Unknown -> "Статус неизвестен"; PendingStatus.Failed -> "Не отправлено" }
                Text(label, fontSize = 10.sp, color = if (p.status == PendingStatus.Failed) T2Colors.danger else T2Colors.textSecondary)
                if (p.status != PendingStatus.Sending) Text("Повторить", fontSize = 10.sp, color = T2Colors.primary, fontWeight = FontWeight.SemiBold, modifier = Modifier.clickable(onClick = onRetry))
            }
        }
    }
}

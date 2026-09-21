package ru.t2sales.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.math.BigInteger
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import ru.t2sales.android.AppContainer
import ru.t2sales.shared.api.ChatAttachment
import ru.t2sales.shared.api.ChatMessage
import ru.t2sales.shared.api.CreateChatMessageRequest
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.theme.T2Colors

private const val MAX_BODY = 5000
private const val PAGE = 50
private const val MAX_VISIBLE = 300

private val ROLE = mapOf(
    "trainee" to "Стажёр", "employee" to "Сотрудник", "senior" to "Старший",
    "manager" to "Управляющий", "supervisor" to "Супервайзер", "admin" to "Админ"
)

private enum class PendingStatus { Sending, Failed }

private const val MAX_ATTACHMENTS = 5

/** A file picked for a message: read once from the phone's storage, so a failed send can be retried from memory. */
private class Picked(val name: String, val mime: String, val bytes: ByteArray)

private class Pending(val clientId: String, val body: String, val files: List<Picked>, val attachmentIds: MutableList<String?>, val status: PendingStatus)

private fun readPicked(uri: android.net.Uri): Picked? = runCatching {
    val ctx = ru.t2sales.shared.auth.AndroidPlatform.appContext
    val resolver = ctx.contentResolver
    var name = "file"
    resolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) name = c.getString(0) ?: name }
    Picked(name, resolver.getType(uri) ?: "application/octet-stream", resolver.openInputStream(uri)!!.use { it.readBytes() })
}.getOrNull()

private fun idOf(m: ChatMessage): BigInteger = m.id.toBigIntegerOrNull() ?: BigInteger.ZERO

private fun timeMsk(iso: String): String = runCatching {
    OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.of("Europe/Moscow")).format(DateTimeFormatter.ofPattern("HH:mm"))
}.getOrDefault("")

private fun size(bytes: Long): String = when {
    bytes < 1024 -> "$bytes Б"
    bytes < 1024 * 1024 -> "%.1f КБ".format(java.util.Locale.US, bytes / 1024.0)
    else -> "%.1f МБ".format(java.util.Locale.US, bytes / (1024.0 * 1024.0))
}

/**
 * Mobile port of pages/chat: the message feed with history and live updates, a composer. Like the PC client: the WebSocket pushes
 * new messages, polling (4 s while the socket is down, 15 s while it is up) stays the source of truth. Not ported yet: sending and
 * saving attachments (they are listed under the message).
 */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun ChatScreen(container: AppContainer, me: MeResponse) {
    val api = container.chatApi
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    val messages = remember { mutableStateListOf<ChatMessage>() }
    val pending = remember { mutableStateListOf<Pending>() }
    var loaded by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    var oldestCursor by remember { mutableStateOf<String?>(null) }
    var hasMore by remember { mutableStateOf(true) }
    var loadingOlder by remember { mutableStateOf(false) }
    var text by remember { mutableStateOf("") }
    val composerFiles = remember { mutableStateListOf<Picked>() }
    val picker = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.GetMultipleContents()) { uris ->
        val room = MAX_ATTACHMENTS - composerFiles.size
        if (uris.size > room) Toaster.show("Максимум $MAX_ATTACHMENTS вложений на сообщение", true)
        uris.take(room.coerceAtLeast(0)).forEach { u -> readPicked(u)?.let { composerFiles.add(it) } ?: Toaster.show("Не удалось прочитать файл", true) }
    }
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
            .onFailure { failed = true }
        loaded = true
        if (messages.isNotEmpty()) listState.scrollToItem(messages.size - 1)
    }

    fun applyIncoming(items: List<ChatMessage>) {
        val wasNear = nearBottom
        var added = false
        items.sortedBy { idOf(it) }.forEach { if (upsert(it)) added = true }
        if (added) scope.launch { if (wasNear) listState.animateScrollToItem((messages.size + pending.size - 1).coerceAtLeast(0)) else newBelow = true }
    }

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
                        when ((f["type"] as? JsonPrimitive)?.content) {
                            "refresh" -> kick.trySend(Unit)
                            "message" -> (f["message"] as? JsonObject)?.let { m ->
                                runCatching { Json { ignoreUnknownKeys = true }.decodeFromJsonElement(ChatMessage.serializer(), m) }.getOrNull()?.let { applyIncoming(listOf(it)) }
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
            runCatching { api.getAfter(last, PAGE) }.onSuccess { items -> applyIncoming(items); pollDelay = 4000L }.onFailure { pollDelay = (pollDelay * 2).coerceAtMost(30000L) }
        }
    }

    // scrolled to the top -> older history
    LaunchedEffect(listState) {
        snapshotFlow { listState.firstVisibleItemIndex }.collect { idx ->
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
                    .onFailure { Toaster.show("Не удалось загрузить историю", true) }
                loadingOlder = false
            }
        }
    }

    fun submit(p: Pending) {
        scope.launch {
            runCatching {
                p.files.forEachIndexed { i, f -> if (p.attachmentIds[i] == null) p.attachmentIds[i] = api.uploadAttachment(f.name, f.mime, f.bytes).id }
                api.post(CreateChatMessageRequest(p.clientId, p.body.ifEmpty { null }, p.attachmentIds.filterNotNull()))
            }
                .onSuccess { m ->
                    upsert(m)
                    pending.removeAll { it.clientId == p.clientId }
                    listState.animateScrollToItem((messages.size + pending.size - 1).coerceAtLeast(0))
                }
                .onFailure {
                    val i = pending.indexOfFirst { x -> x.clientId == p.clientId }
                    if (i >= 0) pending[i] = Pending(p.clientId, p.body, p.files, p.attachmentIds, PendingStatus.Failed)
                    Toaster.show(it.message ?: "Не удалось отправить сообщение", true)
                }
        }
    }

    fun send() {
        val body = text.trim()
        if (body.isEmpty() && composerFiles.isEmpty()) return
        if (body.length > MAX_BODY) { Toaster.show("Сообщение длиннее $MAX_BODY символов", true); return }
        val id = UUID.randomUUID().toString() // the server de-duplicates on it: a retry never posts twice
        val p = Pending(id, body, composerFiles.toList(), MutableList(composerFiles.size) { null }, PendingStatus.Sending)
        text = ""
        composerFiles.clear()
        pending.add(p)
        scope.launch { listState.scrollToItem((messages.size + pending.size - 1).coerceAtLeast(0)) }
        submit(p)
    }

    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        Text("Чат", fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 8.dp))
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                failed -> Text("Не удалось загрузить чат", color = T2Colors.textSecondary, fontSize = 13.sp, modifier = Modifier.align(Alignment.Center).padding(24.dp))
                !loaded -> LoadingBlock(Modifier.align(Alignment.Center).padding(24.dp), lines = 4)
                else -> BoxWithConstraints(Modifier.fillMaxSize()) {
                    val bubbleMax = maxWidth * 0.85f
                    LazyColumn(state = listState, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.Bottom)) {
                        itemsIndexed(messages, key = { _, m -> m.id }) { _, m -> MessageRow(m, mine = m.sender.id == me.employee_id, bubbleMax = bubbleMax) { a -> download(scope, api, a) } }
                        itemsIndexed(pending, key = { _, p -> "p" + p.clientId + p.status }) { _, p -> PendingRow(p, bubbleMax) { submit(p) } }
                    }
                    if (newBelow && !nearBottom) {
                        Text(
                            "Новые сообщения ↓", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp).clip(CircleShape).background(Color(0xFF106FA3))
                                .clickable { newBelow = false; scope.launch { listState.animateScrollToItem((messages.size + pending.size - 1).coerceAtLeast(0)) } }
                                .padding(horizontal = 14.dp, vertical = 8.dp)
                        )
                    }
                }
            }
        }

        // composer
        Column(Modifier.fillMaxWidth().background(T2Colors.surface).padding(horizontal = 12.dp, vertical = 8.dp)) {
            if (composerFiles.isNotEmpty()) {
                androidx.compose.foundation.layout.FlowRow(Modifier.padding(bottom = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    composerFiles.forEachIndexed { i, f ->
                        Row(Modifier.clip(CircleShape).background(T2Colors.surface2).padding(horizontal = 10.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(f.name, fontSize = 12.sp, maxLines = 1)
                            Text("  ×", color = T2Colors.textSecondary, fontSize = 16.sp, modifier = Modifier.clickable { composerFiles.removeAt(i) })
                        }
                    }
                }
            }
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.size(44.dp).clip(CircleShape).background(T2Colors.surface2).border(1.dp, T2Colors.border, CircleShape).clickable { picker.launch("*/*") }, contentAlignment = Alignment.Center) {
                    Text("＋", fontSize = 22.sp, color = T2Colors.text)
                }
                val shape = RoundedCornerShape(16.dp)
                BasicTextField(
                    value = text,
                    onValueChange = { text = it },
                    textStyle = TextStyle(color = T2Colors.text, fontSize = 15.sp),
                    cursorBrush = SolidColor(T2Colors.primary),
                    decorationBox = { inner -> Box { if (text.isEmpty()) Text("Написать сообщение…", color = T2Colors.hint, fontSize = 15.sp); inner() } },
                    modifier = Modifier.weight(1f).heightIn(min = 44.dp, max = 120.dp).clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape).padding(horizontal = 12.dp, vertical = 12.dp)
                )
                val canSend = text.isNotBlank() || composerFiles.isNotEmpty()
                Box(Modifier.size(44.dp).clip(CircleShape).background(if (canSend) T2Colors.primary else T2Colors.surface3).clickable(enabled = canSend) { send() }, contentAlignment = Alignment.Center) {
                    Text("➤", color = if (canSend) Color.White else T2Colors.textSecondary, fontSize = 18.sp)
                }
            }
        }
    }
}

private fun download(scope: kotlinx.coroutines.CoroutineScope, api: ru.t2sales.shared.api.ChatApi, a: ChatAttachment) {
    scope.launch {
        runCatching { api.downloadAttachment(a.id) }
            .onSuccess { bytes -> FileShare.share(a.originalFilename.ifEmpty { "file" }, a.mimeType.ifEmpty { "application/octet-stream" }, bytes) }
            .onFailure { Toaster.show("Не удалось скачать файл", true) }
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
private fun MessageRow(m: ChatMessage, mine: Boolean, bubbleMax: Dp, onAttachment: (ChatAttachment) -> Unit) {
    val uri = androidx.compose.ui.platform.LocalUriHandler.current
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
        Column(Modifier.widthIn(max = bubbleMax).clip(RoundedCornerShape(16.dp)).background(if (mine) T2Colors.primarySoft else T2Colors.surface2).padding(horizontal = 12.dp, vertical = 8.dp)) {
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(m.sender.displayName, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                Text(ROLE[m.sender.role] ?: m.sender.role, fontSize = 11.sp, color = T2Colors.textSecondary)
            }
            val body = m.body
            if (!body.isNullOrEmpty()) {
                val annotated = linkified(body)
                androidx.compose.foundation.text.ClickableText(
                    text = annotated,
                    style = TextStyle(color = T2Colors.text, fontSize = 15.sp, lineHeight = 21.sp),
                    onClick = { off -> annotated.getStringAnnotations("URL", off, off).firstOrNull()?.let { runCatching { uri.openUri(it.item) } } }
                )
            }
            m.attachments.forEach { a -> AttachmentChip(a) { onAttachment(a) } }
            Text(timeMsk(m.createdAt), fontSize = 10.sp, color = T2Colors.textSecondary, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

@Composable
private fun AttachmentChip(a: ChatAttachment, onClick: () -> Unit) {
    val shape = RoundedCornerShape(8.dp)
    Row(Modifier.padding(top = 6.dp).fillMaxWidth().clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape).clickable(onClick = onClick).padding(horizontal = 10.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("📎 " + a.originalFilename, fontSize = 12.sp, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
        Text(size(a.sizeBytes), color = T2Colors.textSecondary, fontSize = 12.sp)
    }
}

@Composable
private fun PendingRow(p: Pending, bubbleMax: Dp, onRetry: () -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Column(Modifier.widthIn(max = bubbleMax).clip(RoundedCornerShape(16.dp)).background(T2Colors.primarySoft).padding(horizontal = 12.dp, vertical = 8.dp)) {
            if (p.body.isNotEmpty()) Text(p.body, fontSize = 15.sp, lineHeight = 21.sp)
            p.files.forEach { Text(it.name, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp)) }
            Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(if (p.status == PendingStatus.Sending) "Отправка…" else "Не отправлено", fontSize = 10.sp, color = if (p.status == PendingStatus.Failed) T2Colors.danger else T2Colors.textSecondary)
                if (p.status == PendingStatus.Failed) Text("Повторить", fontSize = 10.sp, color = T2Colors.primary, fontWeight = FontWeight.SemiBold, modifier = Modifier.clickable(onClick = onRetry))
            }
        }
    }
}

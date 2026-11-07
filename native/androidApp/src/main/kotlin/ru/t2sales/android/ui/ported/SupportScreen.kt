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
import ru.t2sales.shared.api.FaqItem
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.api.SupportTicket
import ru.t2sales.shared.theme.T2Colors

/** Port of #page-support (pages/support): FAQ accordion, my tickets + send form, admin ticket list with reply. */
@Composable
fun SupportScreen(container: AppContainer, me: MeResponse) {
    val api = container.infoApi
    val scope = rememberCoroutineScope()
    val isAdmin = me.role == "admin"
    var faq by remember { mutableStateOf<List<FaqItem>?>(null) }
    var faqFailed by remember { mutableStateOf(false) }
    var my by remember { mutableStateOf<List<SupportTicket>>(emptyList()) }
    var all by remember { mutableStateOf<List<SupportTicket>?>(null) }
    var reload by remember { mutableStateOf(0) }
    var message by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<String?>(null) }
    var expanded by remember { mutableStateOf<Int?>(null) }
    var replyTo by remember { mutableStateOf<SupportTicket?>(null) }

    LaunchedEffect(reload) {
        runCatching { api.faq() }.onSuccess { faq = it }.onFailure { faq = emptyList(); faqFailed = true }
        runCatching { api.myTickets() }.onSuccess { my = it }
        if (isAdmin) runCatching { api.allTickets() }.onSuccess { all = it }.onFailure { all = emptyList() }
    }

    fun send() {
        val m = message.trim()
        if (m.isEmpty()) { T2Toast.show("Введите сообщение", true); return }
        scope.launch {
            runCatching { api.createTicket(m, me.full_name ?: "Гость") }
                .onSuccess { r -> result = r.auto_reply ?: r.message ?: "Отправлено"; message = ""; T2Toast.show("Отправлено"); reload++ }
                .onFailure { T2Toast.show("Ошибка отправки", true) }
        }
    }

    if (T2Colors.uiBeta) {
        SupportBeta(
            faq, faqFailed, my, all, isAdmin,
            expanded, { expanded = it }, message, { message = it }, result,
            onRetry = { reload++ }, onSend = ::send, onReply = { replyTo = it }
        )
        replyTo?.let { t -> SupportReplySheet(t, api, { replyTo = null }, { reload++ }) }
        return
    }

    PageSection("Частые вопросы") {
        val list = faq
        when {
            list == null -> LoadingBlock(Modifier.padding(16.dp))
            faqFailed -> ErrorState("Не удалось загрузить FAQ", onRetry = { reload++ })
            list.isEmpty() -> EmptyText("FAQ пока пуст")
            else -> list.forEach { f ->
                Row(modifier = Modifier.fillMaxWidth().clickable { expanded = if (expanded == f.id) null else f.id }.padding(horizontal = 16.dp, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(f.question, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                    Text("\u203A", color = T2Colors.hint, fontSize = 18.sp)
                }
                if (expanded == f.id) Text(f.answer, color = T2Colors.textSecondary, fontSize = 13.sp, modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 14.dp))
            }
        }
    }
    Spacer(Modifier.height(12.dp))

    PageSection("Чат с поддержкой") {
        Column(modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 14.dp)) {
            if (my.isEmpty()) Text("Пока нет обращений", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp))
            my.take(8).forEach { t ->
                val shape = RoundedCornerShape(12.dp)
                Column(modifier = Modifier.padding(bottom = 8.dp).fillMaxWidth().clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape).padding(horizontal = 12.dp, vertical = 10.dp)) {
                    Text("#${t.id} \u00B7 ${t.status ?: ""}", color = T2Colors.hint, fontSize = 12.sp)
                    Text(t.message, fontSize = 14.sp, modifier = Modifier.padding(vertical = 4.dp))
                    if (!t.admin_reply.isNullOrBlank()) Text("\u21A9 ${t.admin_reply}", color = T2Colors.primary, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp))
                }
            }
            Spacer(Modifier.height(8.dp))
            Field("Сообщение", message, { message = it }, placeholder = "Опишите вопрос или проблему", fill = T2Colors.surface2)
            Spacer(Modifier.height(12.dp))
            MainButton("Отправить", enabled = true) { send() }
            result?.let { Text(it, color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) }
        }
    }

    if (isAdmin) {
        Spacer(Modifier.height(12.dp))
        PageSection("Тикеты (только admin)") {
            val list = all
            when {
                list == null -> LoadingBlock(Modifier.padding(16.dp))
                list.isEmpty() -> EmptyText("Нет тикетов")
                else -> list.forEach { t ->
                    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 13.dp)) {
                        Text("#${t.id} ${t.full_name ?: ""}", fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                        Text(t.message, color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp, bottom = 6.dp))
                        MainButton("Ответить", enabled = true) { replyTo = t }
                    }
                }
            }
        }
    }

    replyTo?.let { t -> SupportReplySheet(t, api, { replyTo = null }, { reload++ }) }
}

@Composable
private fun SupportReplySheet(t: SupportTicket, api: ru.t2sales.shared.api.InfoApi, onDismiss: () -> Unit, onChanged: () -> Unit) {
    val scope = rememberCoroutineScope()
    var reply by remember(t.id) { mutableStateOf("") }
    SheetDialog("Ответ на тикет #${t.id}", onDismiss = onDismiss) {
        Field("", reply, { reply = it }, placeholder = "Ответ", fill = T2Colors.surface2)
        Spacer(Modifier.height(16.dp))
        MainButton("Отправить", enabled = true) {
            if (reply.isBlank()) return@MainButton
            scope.launch {
                runCatching { api.replyTicket(t.id, reply.trim()) }
                    .onSuccess { T2Toast.show("Ответ отправлен"); onDismiss(); onChanged() }
                    .onFailure { T2Toast.show("Ошибка", true) }
            }
        }
    }
}

// ======================= Beta UI 3.0 «Ночная смена» (design-system/ui3/v5-team, screen "Поддержка") =======================

/** FAQ accordion as grouped expandable cells, my tickets as a group, the send form, and — for admins — the ticket list. */
@Composable
private fun SupportBeta(
    faq: List<FaqItem>?, faqFailed: Boolean, my: List<SupportTicket>, all: List<SupportTicket>?, isAdmin: Boolean,
    expanded: Int?, onExpand: (Int?) -> Unit, message: String, onMessage: (String) -> Unit, result: String?,
    onRetry: () -> Unit, onSend: () -> Unit, onReply: (SupportTicket) -> Unit
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
        U3LargeTitle("Поддержка")
        U3GroupHead("Частые вопросы")
        val list = faq
        when {
            list == null -> SkeletonBlock(Modifier.fillMaxWidth().height(120.dp), 22.dp)
            faqFailed -> ErrorState("Не удалось загрузить FAQ", onRetry = onRetry)
            list.isEmpty() -> EmptyText("FAQ пока пуст")
            else -> U3Group {
                list.forEachIndexed { i, f ->
                    if (i > 0) U3Sep()
                    val open = expanded == f.id
                    U3Cell(
                        f.question, if (open) f.answer else null,
                        leading = { U3IconTile(NavIcons.info, tint = T2Colors.accentText) },
                        trailing = { Text(if (open) "▴" else "›", color = T2Colors.hint, fontSize = 18.sp) },
                        onClick = { onExpand(if (open) null else f.id) }
                    )
                }
            }
        }

        U3GroupHead("Чат с поддержкой")
        if (my.isEmpty()) EmptyText("Пока нет обращений")
        else U3Group {
            my.take(8).forEachIndexed { i, t ->
                if (i > 0) U3Sep()
                U3Cell(
                    "#${t.id} · ${t.status ?: ""}",
                    t.message + (t.admin_reply?.takeIf { it.isNotBlank() }?.let { "\n↩ $it" } ?: ""),
                    leading = { U3IconTile(NavIcons.chat, tint = T2Colors.textSecondary) }
                )
            }
        }
        Spacer(Modifier.height(10.dp))
        U3Group {
            Column(Modifier.padding(16.dp)) {
                Field("Сообщение", message, onMessage, placeholder = "Опишите вопрос или проблему", fill = T2Colors.surface2)
                Spacer(Modifier.height(12.dp))
                U3PrimaryButton("Отправить", onClick = onSend)
                result?.let { Text(it, color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) }
            }
        }

        if (isAdmin) {
            U3GroupHead("Тикеты")
            val tickets = all
            when {
                tickets == null -> SkeletonBlock(Modifier.fillMaxWidth().height(120.dp), 22.dp)
                tickets.isEmpty() -> EmptyText("Нет тикетов")
                else -> U3Group {
                    tickets.forEachIndexed { i, t ->
                        if (i > 0) U3Sep()
                        U3Cell(
                            "#${t.id} ${t.full_name ?: ""}", t.message,
                            leading = { U3IconTile(NavIcons.support, tint = T2Colors.textSecondary) },
                            trailing = { Text("›", color = T2Colors.hint, fontSize = 18.sp) },
                            onClick = { onReply(t) }
                        )
                    }
                }
            }
        }
        Spacer(Modifier.height(96.dp))
    }
}

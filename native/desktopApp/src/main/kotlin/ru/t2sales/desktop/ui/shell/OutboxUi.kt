package ru.t2sales.desktop.ui.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Box
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
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
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.launch
import ru.t2sales.desktop.offline.OutboxStatus
import ru.t2sales.desktop.offline.SalesOutbox
import ru.t2sales.desktop.ui.components.MainButton
import ru.t2sales.desktop.ui.components.SheetDialog
import ru.t2sales.desktop.ui.components.T2Toast
import ru.t2sales.shared.theme.T2Colors

private val TIME = DateTimeFormatter.ofPattern("dd.MM HH:mm").withZone(ZoneId.of("Europe/Moscow"))

/** Header pill: sales that have not reached the server yet. Invisible while the queue is empty. */
@Composable
fun OutboxPill(outbox: SalesOutbox) {
    val pending = outbox.pendingCount
    val review = outbox.reviewCount
    if (pending + review == 0) return
    var open by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(22.dp)
    val tone = if (review > 0) T2Colors.danger else T2Colors.warning
    Row(
        modifier = Modifier.height(44.dp).clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape).clickable { open = true }.padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(Modifier.size(10.dp).clip(CircleShape).background(tone))
        Spacer(Modifier.width(8.dp))
        Text(
            buildString {
                if (pending > 0) append("В очереди: $pending")
                if (review > 0) { if (isNotEmpty()) append(" · "); append("проверить: $review") }
            },
            color = T2Colors.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold
        )
    }
    Spacer(Modifier.width(8.dp))
    if (open) OutboxDialog(outbox) { open = false }
}

@Composable
private fun OutboxDialog(outbox: SalesOutbox, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    SheetDialog("Не отправлено", onDismiss) {
        Text(
            "Эти продажи внесены без связи с сервером. Они сохранены на этом компьютере и отправятся сами, как только связь появится; повторная отправка никогда не удвоит продажу.",
            color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(bottom = 14.dp)
        )
        val list = outbox.items
        if (list.isEmpty()) Text("Очередь пуста", color = T2Colors.hint, modifier = Modifier.padding(vertical = 8.dp))
        list.forEach { item ->
            val review = item.status == OutboxStatus.Review
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(item.summary, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                    val at = runCatching { TIME.format(Instant.parse(item.createdAt)) }.getOrDefault(item.createdAt)
                    Text(
                        if (review) "$at · сервер отклонил: ${item.error ?: "нужна проверка"}" else "$at · ждёт связи" + if (item.attempts > 0) " · попыток: ${item.attempts}" else "",
                        color = if (review) T2Colors.danger else T2Colors.hint, fontSize = 12.sp
                    )
                }
                if (review) {
                    Text(
                        "Удалить", color = T2Colors.danger, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { outbox.discard(item.clientId) }.padding(horizontal = 10.dp, vertical = 6.dp)
                    )
                }
            }
        }
        if (outbox.reviewCount > 0) {
            Text(
                "Отклонённые продажи сами не отправляются: проверьте данные в «Истории продаж» и внесите заново, если нужно, затем удалите запись из очереди.",
                color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp, bottom = 6.dp)
            )
        }
        Spacer(Modifier.height(14.dp))
        MainButton(if (busy) "Отправляем…" else "Отправить сейчас", enabled = !busy && outbox.pendingCount > 0) {
            busy = true
            scope.launch {
                val r = outbox.flush()
                busy = false
                when {
                    r.stoppedByError -> T2Toast.show("Пока не получилось: нет связи или нужен повторный вход. Попробуем ещё раз позже.", true)
                    r.sent == 0 && r.review > 0 -> T2Toast.show("Сервер отклонил продажу", true)
                }
                if (outbox.items.isEmpty()) onDismiss()
            }
        }
    }
}

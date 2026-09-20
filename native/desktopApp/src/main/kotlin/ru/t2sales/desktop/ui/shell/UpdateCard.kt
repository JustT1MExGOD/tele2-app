package ru.t2sales.desktop.ui.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ru.t2sales.desktop.ui.components.T2Toast
import ru.t2sales.desktop.update.UpdateManager
import ru.t2sales.desktop.update.UpdateState
import ru.t2sales.desktop.update.VerificationStage
import ru.t2sales.shared.theme.T2Colors

fun formatBytes(bytes: Long): String {
    if (bytes < 1024) return "$bytes Б"
    val units = listOf("КБ", "МБ", "ГБ")
    var v = bytes / 1024.0
    var i = 0
    while (v >= 1024 && i < units.size - 1) { v /= 1024; i++ }
    return "%.1f %s".format(v, units[i])
}

/**
 * Port of preload/update-notification.ts: a small card bottom-left. Hidden while not configured / up to date / checking.
 * User-confirmation invariant: nothing installs by itself - only a real click on "Установить сейчас" does, and a mandatory
 * update is only visually emphasised, never forced. "Позже" hides the card for the current state only; a state change re-shows it.
 */
@Composable
fun UpdateCard(updates: UpdateManager, modifier: Modifier = Modifier) {
    val st = updates.status
    val scope = rememberCoroutineScope()
    var dismissedFor by remember { mutableStateOf<UpdateState?>(null) }
    // only a genuine state CHANGE clears a dismissal (a progress tick in the same state must not un-hide the card)
    if (dismissedFor != null && st.state != dismissedFor) dismissedFor = null
    if (dismissedFor == st.state) return
    if (st.state == UpdateState.NotConfigured || st.state == UpdateState.UpToDate || st.state == UpdateState.Checking) return

    val shape = RoundedCornerShape(16.dp)
    Column(
        modifier = modifier.widthIn(max = 320.dp).clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape).padding(horizontal = 16.dp, vertical = 14.dp)
    ) {
        when (st.state) {
            UpdateState.UpdateAvailable -> {
                val m = st.availableManifest ?: return@Column
                if (m.mandatory) Text("ВАЖНОЕ ОБНОВЛЕНИЕ", color = Color(0xFFEF6C00), fontWeight = FontWeight.Bold, fontSize = 11.sp, modifier = Modifier.padding(bottom = 4.dp))
                Text("Доступна версия ${m.version}", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                Text("Размер: ${formatBytes(m.size)}", color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
                m.releaseNotes?.takeIf { it.isNotBlank() }?.let {
                    Text(it, color = T2Colors.textSecondary, fontSize = 12.sp, modifier = Modifier.padding(vertical = 6.dp).heightIn(max = 80.dp).verticalScroll(rememberScrollState()))
                }
                Buttons("Позже", { dismissedFor = st.state }, "Скачать") { updates.downloadUpdate() }
            }
            UpdateState.Downloading -> {
                val p = st.progress
                val pct = if (p != null && p.totalBytes > 0) (p.receivedBytes * 100 / p.totalBytes).toInt() else 0
                Text("Загрузка обновления…", fontWeight = FontWeight.Bold, fontSize = 13.sp, modifier = Modifier.padding(bottom = 6.dp))
                Box(Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(99.dp)).background(T2Colors.surface3)) {
                    Box(Modifier.fillMaxWidth(pct / 100f).height(6.dp).background(Color(0xFF2AABEE)))
                }
                Text(p?.let { "${formatBytes(it.receivedBytes)} / ${formatBytes(it.totalBytes)}" } ?: "", color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
            }
            UpdateState.Verifying -> Text(
                when (st.verificationStage) {
                    VerificationStage.Authenticode -> "Проверка цифровой подписи Windows…"
                    VerificationStage.Sha256 -> "Проверка SHA-256…"
                    null -> "Проверка целостности файла…"
                },
                fontWeight = FontWeight.Bold, fontSize = 13.sp
            )
            UpdateState.ReadyToInstall -> {
                Text("Обновление готово к установке", fontWeight = FontWeight.Bold, fontSize = 13.sp, modifier = Modifier.padding(bottom = 4.dp))
                st.signatureWarning?.let { Text(it, color = Color(0xFFEF6C00), fontSize = 12.sp, modifier = Modifier.padding(vertical = 4.dp)) }
                Buttons("Позже", { dismissedFor = st.state }, "Установить сейчас") {
                    scope.launch {
                        // the ONLY call site of installUpdate(): always a direct result of this click - never automatic, never on a timer
                        runCatching { updates.installUpdate { scope.launch { delay(1500); kotlin.system.exitProcess(0) } } }
                            .onFailure { T2Toast.show(it.message ?: "Не удалось запустить установку", true) }
                    }
                }
            }
            UpdateState.Error -> {
                Text("Ошибка обновления", color = Color(0xFFC62828), fontWeight = FontWeight.Bold, fontSize = 13.sp, modifier = Modifier.padding(bottom = 4.dp))
                Text(st.errorMessage ?: "Неизвестная ошибка", color = T2Colors.textSecondary, fontSize = 12.sp)
                Buttons("Скрыть", { dismissedFor = st.state }, null) {}
            }
            else -> {}
        }
    }
}

@Composable
private fun Buttons(secondary: String, onSecondary: () -> Unit, primary: String?, onPrimary: () -> Unit) {
    Row(modifier = Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, androidx.compose.ui.Alignment.End)) {
        Text(
            secondary, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = T2Colors.text,
            modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(T2Colors.surface2).clickable(onClick = onSecondary).padding(horizontal = 12.dp, vertical = 7.dp)
        )
        if (primary != null) Text(
            primary, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = T2Colors.onAccent,
            modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(T2Colors.accent).clickable(onClick = onPrimary).padding(horizontal = 12.dp, vertical = 7.dp)
        )
    }
}

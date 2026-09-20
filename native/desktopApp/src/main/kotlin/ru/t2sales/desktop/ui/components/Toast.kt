package ru.t2sales.desktop.ui.components

import androidx.compose.ui.unit.sp
import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import ru.t2sales.shared.theme.T2Colors

/** Web-style toast (toast('...', 'ok'|'err')). Rendered once by AppShell. */
object T2Toast {
    var message by mutableStateOf<String?>(null)
    var isError by mutableStateOf(false)
    private var seq = 0
    var token by mutableStateOf(0)
    var actionLabel by mutableStateOf<String?>(null)
    var onAction: (() -> Unit)? = null
    var holdMs: Long = 3000

    fun show(text: String, error: Boolean = false) {
        message = text
        isError = error
        actionLabel = null
        onAction = null
        holdMs = 3000
        token = ++seq
    }

    /** A toast with a button ("Отменить"): stays [holdMs] so there is time to press it. */
    fun showAction(text: String, label: String, holdMs: Long = 10_000, onAction: () -> Unit) {
        message = text
        isError = false
        actionLabel = label
        this.onAction = onAction
        this.holdMs = holdMs
        token = ++seq
    }
}

@Composable
fun ToastHost(modifier: Modifier = Modifier) {
    val text = T2Toast.message ?: return
    LaunchedEffect(T2Toast.token) {
        delay(T2Toast.holdMs)
        T2Toast.message = null
    }
    val shape = RoundedCornerShape(14.dp)
    Row(
        modifier = modifier.clip(shape).background(T2Colors.surface3).border(1.dp, T2Colors.border, shape).padding(horizontal = 18.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(text, color = if (T2Toast.isError) T2Colors.danger else T2Colors.text, fontWeight = FontWeight.SemiBold)
        val label = T2Toast.actionLabel
        if (label != null) {
            Text(
                label.uppercase(), color = T2Colors.primary, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp,
                modifier = Modifier.padding(start = 16.dp).clip(RoundedCornerShape(8.dp))
                    .clickable { val action = T2Toast.onAction; T2Toast.message = null; action?.invoke() }.padding(horizontal = 8.dp, vertical = 4.dp)
            )
        }
    }
}

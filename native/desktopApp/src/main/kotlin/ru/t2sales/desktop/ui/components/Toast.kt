package ru.t2sales.desktop.ui.components

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

    fun show(text: String, error: Boolean = false) {
        message = text
        isError = error
        token = ++seq
    }
}

@Composable
fun ToastHost(modifier: Modifier = Modifier) {
    val text = T2Toast.message ?: return
    LaunchedEffect(T2Toast.token) {
        delay(3000)
        T2Toast.message = null
    }
    val shape = RoundedCornerShape(14.dp)
    Text(
        text,
        color = if (T2Toast.isError) T2Colors.danger else T2Colors.text,
        fontWeight = FontWeight.SemiBold,
        modifier = modifier
            .clip(shape)
            .background(T2Colors.surface3)
            .border(1.dp, T2Colors.border, shape)
            .padding(horizontal = 18.dp, vertical = 12.dp)
    )
}

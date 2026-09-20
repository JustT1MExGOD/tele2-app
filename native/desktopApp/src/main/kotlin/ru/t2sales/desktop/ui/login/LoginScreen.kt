package ru.t2sales.desktop.ui.login

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.MaterialTheme
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
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.auth.AuthRepository
import ru.t2sales.desktop.ui.components.MainButton
import ru.t2sales.desktop.ui.components.Field
import ru.t2sales.shared.theme.T2Colors

/** Mirrors the web app's .gate-shell / .gate-card sign-in screen (styles.css:1726-1822). */
@Composable
fun LoginScreen(
    authRepository: AuthRepository,
    onLoggedIn: (MeResponse) -> Unit
) {
    val viewModel = remember { LoginViewModel(authRepository) }
    val scope = rememberCoroutineScope()

    var uiState by remember { mutableStateOf<LoginUiState>(LoginUiState.PhonePassword) }
    var phone by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    fun run(block: suspend () -> LoginOutcome) {
        if (busy) return
        busy = true
        scope.launch {
            try {
                applyOutcome(block(), onLoggedIn) { uiState = it }
            } finally {
                busy = false
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(if (T2Colors.dark) Color(0xFF0E2230) else Color(0xFFDCEFFA), T2Colors.bg),
                    endY = 520f
                )
            ),
        contentAlignment = Alignment.TopCenter
    ) {
        Column(
            modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth().padding(horizontal = 16.dp, vertical = 48.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text("🍉", fontSize = 48.sp)
            Spacer(Modifier.height(10.dp))
            Text("T2 Sales", fontSize = 28.sp, fontWeight = FontWeight.ExtraBold, color = T2Colors.text)
            Spacer(Modifier.height(6.dp))
            Text("Вход без Telegram", fontSize = 14.sp, color = T2Colors.hint)
            Spacer(Modifier.height(20.dp))

            val shape = RoundedCornerShape(24.dp)
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(shape)
                    .background(
                        Brush.linearGradient(
                            if (T2Colors.dark) listOf(Color(0x0FFFFFFF), Color(0x0A000000))
                            else listOf(Color(0xFFFFFFFF), Color(0xFFF4F5F7))
                        )
                    )
                    .border(1.dp, T2Colors.border, shape)
                    .padding(start = 18.dp, end = 18.dp, top = 22.dp, bottom = 20.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Box(
                    modifier = Modifier.size(64.dp).clip(CircleShape).background(T2Colors.primarySoft),
                    contentAlignment = Alignment.Center
                ) { Text("🔒", fontSize = 28.sp) }
                Spacer(Modifier.height(10.dp))

                when (val state = uiState) {
                    is LoginUiState.Error -> {
                        Title("Не удалось войти")
                        Desc(state.message, T2Colors.danger)
                        MainButton("Повторить", enabled = true) { uiState = state.previous }
                    }

                    is LoginUiState.MfaCode -> {
                        Title("Код подтверждения")
                        Desc("Метод: ${state.methods.joinToString()}")
                        Field("Код", code, { code = it })
                        Spacer(Modifier.height(16.dp))
                        MainButton("Подтвердить", enabled = !busy) {
                            run { viewModel.submitMfaCode(state.mfaToken, state.methods.first(), code) }
                        }
                    }

                    LoginUiState.PhonePassword -> {
                        Title("Вход с телефоном и паролем")
                        Desc("Для тех, у кого нет доступа к Telegram — пароль привязывается в профиле («Мой план» → «Вход с компьютера»).")
                        Field("Телефон", phone, { phone = it })
                        Spacer(Modifier.height(12.dp))
                        Field("Пароль", password, { password = it }, password = true)
                        Spacer(Modifier.height(16.dp))
                        MainButton(if (busy) "Входим…" else "Войти", enabled = !busy) {
                            run { viewModel.submitPhonePassword(phone, password) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Title(text: String) {
    Text(text, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, color = T2Colors.text, textAlign = TextAlign.Center)
    Spacer(Modifier.height(8.dp))
}

@Composable
private fun Desc(text: String, color: Color = T2Colors.hint) {
    Text(text, fontSize = 14.sp, color = color, textAlign = TextAlign.Center, lineHeight = 20.sp)
    Spacer(Modifier.height(18.dp))
}

private fun applyOutcome(
    outcome: LoginOutcome,
    onLoggedIn: (MeResponse) -> Unit,
    setState: (LoginUiState) -> Unit
) {
    when (outcome) {
        is LoginOutcome.LoggedIn -> onLoggedIn(outcome.me)
        is LoginOutcome.NextState -> setState(outcome.state)
    }
}

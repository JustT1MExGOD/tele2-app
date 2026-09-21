package ru.t2sales.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import ru.t2sales.android.AppContainer
import ru.t2sales.shared.api.ApiException
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.auth.LoginResult
import ru.t2sales.shared.theme.T2Colors

private sealed class Step {
    data object PhonePassword : Step()
    data class Mfa(val token: String, val method: String) : Step()
    data class Failed(val message: String, val back: Step) : Step()
}

/** Mirrors the web app's .gate-shell / .gate-card sign-in screen (styles.css:1726-1822), same as the PC client. */
@Composable
fun LoginScreen(container: AppContainer, onLoggedIn: (MeResponse) -> Unit) {
    val scope = rememberCoroutineScope()
    var step by remember { mutableStateOf<Step>(Step.PhonePassword) }
    var phone by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    fun run(current: Step, block: suspend () -> LoginResult) {
        if (busy) return
        busy = true
        scope.launch {
            try {
                when (val r = block()) {
                    is LoginResult.LoggedIn -> onLoggedIn(r.me)
                    is LoginResult.MfaRequired -> step = Step.Mfa(r.mfaToken, r.methods.firstOrNull() ?: "totp")
                }
            } catch (e: ApiException) {
                step = Step.Failed(e.message, current)
            } catch (e: Exception) {
                step = Step.Failed("Нет связи с сервером", current)
            } finally {
                busy = false
            }
        }
    }

    Box(
        Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(if (T2Colors.dark) Color(0xFF0E2230) else Color(0xFFDCEFFA), T2Colors.bg), endY = 900f)),
        contentAlignment = Alignment.TopCenter
    ) {
        Column(
            Modifier.fillMaxSize().statusBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 40.dp),
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
                Modifier.fillMaxWidth().clip(shape)
                    .background(Brush.linearGradient(if (T2Colors.dark) listOf(Color(0x0FFFFFFF), Color(0x0A000000)) else listOf(Color(0xFFFFFFFF), Color(0xFFF4F5F7))))
                    .border(1.dp, T2Colors.border, shape)
                    .padding(start = 18.dp, end = 18.dp, top = 22.dp, bottom = 20.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Box(Modifier.size(64.dp).clip(CircleShape).background(T2Colors.primarySoft), contentAlignment = Alignment.Center) { Text("🔒", fontSize = 28.sp) }
                Spacer(Modifier.height(10.dp))
                when (val s = step) {
                    is Step.Failed -> {
                        Title("Не удалось войти")
                        Desc(s.message, T2Colors.danger)
                        MainButton("Повторить") { step = s.back }
                    }
                    is Step.Mfa -> {
                        Title("Код подтверждения")
                        Desc("Метод: ${s.method}")
                        Field("Код", code, { code = it }, keyboard = KeyboardType.Number)
                        Spacer(Modifier.height(16.dp))
                        MainButton("Подтвердить", !busy) { run(s) { container.authRepository.submitMfaCode(s.token, s.method, code) } }
                    }
                    Step.PhonePassword -> {
                        Title("Вход с телефоном и паролем")
                        Desc("Для тех, у кого нет доступа к Telegram — пароль привязывается в профиле («Мой план» → «Вход с компьютера»).")
                        Field("Телефон", phone, { phone = it }, keyboard = KeyboardType.Phone)
                        Spacer(Modifier.height(12.dp))
                        Field("Пароль", password, { password = it }, password = true)
                        Spacer(Modifier.height(16.dp))
                        MainButton(if (busy) "Входим…" else "Войти", !busy) { run(Step.PhonePassword) { container.authRepository.login(phone, password) } }
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

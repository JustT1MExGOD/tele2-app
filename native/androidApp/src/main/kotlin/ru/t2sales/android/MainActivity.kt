package ru.t2sales.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import ru.t2sales.android.ui.LoginScreen
import ru.t2sales.android.ui.Shell
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Theme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val container = (application as T2App).container
        setContent {
            T2Colors.dark = isSystemInDarkTheme()
            T2Theme { Root(container) }
        }
    }
}

@Composable
private fun Root(container: AppContainer) {
    var checking by remember { mutableStateOf(true) }
    var me by remember { mutableStateOf<MeResponse?>(null) }
    LaunchedEffect(Unit) {
        me = container.authRepository.currentSession()
        checking = false
    }
    when {
        checking -> ru.t2sales.android.ui.SplashBox()
        me == null -> LoginScreen(container) { me = it }
        else -> Shell(container, me!!, onLogout = { me = null })
    }
}

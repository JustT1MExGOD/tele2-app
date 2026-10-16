package ru.t2sales.miranda

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.CircularProgressIndicator
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.WindowPosition
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberWindowState
import ru.t2sales.miranda.di.MirandaContainer
import ru.t2sales.miranda.ui.admin.MirandaAdminScreen
import ru.t2sales.miranda.ui.chat.MirandaChatScreen
import ru.t2sales.miranda.ui.components.ToastHost
import ru.t2sales.miranda.ui.conversations.ConversationsScreen
import ru.t2sales.miranda.ui.device.DeviceActivationScreen
import ru.t2sales.miranda.ui.device.DeviceActivationViewModel
import ru.t2sales.miranda.ui.device.DeviceState
import ru.t2sales.miranda.ui.login.LoginScreen
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Theme

/**
 * Much simpler than desktopApp's Main.kt per the plan's scope cut for
 * Miranda's first iteration: no tray/relay/outbox/updater - just
 * Login -> Device Activation -> Messenger/Admin shell.
 */
fun main() {
    application {
        val container = remember { MirandaContainer() }
        val windowState = rememberWindowState(
            size = DpSize(1000.dp, 700.dp),
            position = WindowPosition.Aligned(Alignment.Center)
        )
        Window(onCloseRequest = ::exitApplication, title = "T2 Miranda", state = windowState) {
            T2Theme {
                Box(Modifier.fillMaxSize()) {
                    MirandaRoot(container)
                    ToastHost(Modifier.align(Alignment.BottomCenter).padding(bottom = 32.dp))
                }
            }
        }
    }
}

@Composable
private fun MirandaRoot(container: MirandaContainer) {
    var me by remember { mutableStateOf<MeResponse?>(null) }
    var checkedSession by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        me = container.authRepository.currentSession()
        checkedSession = true
    }

    if (!checkedSession) {
        Box(Modifier.fillMaxSize().background(T2Colors.bg), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }

    val currentMe = me
    if (currentMe == null) {
        LoginScreen(authRepository = container.authRepository, onLoggedIn = { me = it })
    } else {
        MirandaShell(container, currentMe, onLogout = { me = null })
    }
}

@Composable
private fun MirandaShell(container: MirandaContainer, me: MeResponse, onLogout: () -> Unit) {
    val isAdmin = me.role == "admin"
    val viewModel = remember { DeviceActivationViewModel(container.mirandaApi, container.deviceSecretStore) }
    var state by remember { mutableStateOf<DeviceState>(DeviceState.Checking) }
    var retryTick by remember { mutableStateOf(0) }

    LaunchedEffect(retryTick) { state = viewModel.checkOrRegister() }

    when (val s = state) {
        is DeviceState.Active -> MirandaMessengerShell(
            container = container,
            myCorporateAccountId = s.corporateAccountId,
            isAdmin = isAdmin,
            onLogout = onLogout
        )
        else -> DeviceActivationScreen(
            viewModel = viewModel,
            state = s,
            isAdmin = isAdmin,
            onRetry = { retryTick++ },
            onActive = { corporateAccountId, _ -> state = DeviceState.Active(corporateAccountId, null) }
        )
    }
}

private enum class MirandaTab { Conversations, Admin }

@Composable
private fun MirandaMessengerShell(
    container: MirandaContainer,
    myCorporateAccountId: Int,
    isAdmin: Boolean,
    onLogout: () -> Unit
) {
    var tab by remember { mutableStateOf(MirandaTab.Conversations) }
    var openConversation by remember { mutableStateOf<Pair<Int, String>?>(null) }

    Row(Modifier.fillMaxSize().background(T2Colors.bg)) {
        Column(
            modifier = Modifier.width(220.dp).fillMaxHeight().background(T2Colors.surface).padding(16.dp)
        ) {
            Text("T2 Miranda", fontSize = 18.sp, fontWeight = FontWeight.ExtraBold, color = T2Colors.text)
            Spacer(Modifier.height(20.dp))
            NavItem("Диалоги", tab == MirandaTab.Conversations) { tab = MirandaTab.Conversations; openConversation = null }
            if (isAdmin) {
                Spacer(Modifier.height(4.dp))
                NavItem("Админ", tab == MirandaTab.Admin) { tab = MirandaTab.Admin; openConversation = null }
            }
            Spacer(Modifier.weight(1f, fill = true))
            NavItem("Выйти", false, onClick = onLogout)
        }

        Box(Modifier.fillMaxSize()) {
            when (tab) {
                MirandaTab.Conversations -> {
                    val open = openConversation
                    if (open == null) {
                        ConversationsScreen(
                            api = container.mirandaApi,
                            myCorporateAccountId = myCorporateAccountId,
                            onOpenConversation = { id, title -> openConversation = id to title }
                        )
                    } else {
                        Column(Modifier.fillMaxSize()) {
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(16.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text("←", fontSize = 18.sp, color = T2Colors.text, modifier = Modifier.clickable { openConversation = null }.padding(end = 12.dp))
                                Text(open.second, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = T2Colors.text)
                            }
                            Box(Modifier.fillMaxSize()) {
                                MirandaChatScreen(api = container.mirandaApi, conversationId = open.first, myCorporateAccountId = myCorporateAccountId)
                            }
                        }
                    }
                }
                MirandaTab.Admin -> MirandaAdminScreen(mirandaApi = container.mirandaApi, adminCenterApi = container.adminCenterApi)
            }
        }
    }
}

@Composable
private fun NavItem(label: String, selected: Boolean, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .background(if (selected) T2Colors.primarySoft else T2Colors.surface, androidx.compose.foundation.shape.RoundedCornerShape(10.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp)
    ) {
        Text(label, color = if (selected) T2Colors.primary else T2Colors.text, fontSize = 14.sp, fontWeight = FontWeight.Medium)
    }
}

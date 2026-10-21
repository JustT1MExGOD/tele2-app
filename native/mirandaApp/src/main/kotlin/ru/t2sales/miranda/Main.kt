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
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.painter.BitmapPainter
import androidx.compose.ui.res.loadImageBitmap
import androidx.compose.ui.res.useResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Notification
import androidx.compose.ui.window.Tray
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.WindowPosition
import androidx.compose.ui.window.WindowState
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberTrayState
import androidx.compose.ui.window.rememberWindowState
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import ru.t2sales.miranda.di.MirandaContainer
import ru.t2sales.miranda.settings.MirandaSettingsStore
import ru.t2sales.miranda.system.MirandaAppWindow
import ru.t2sales.miranda.system.MirandaNotifier
import ru.t2sales.miranda.ui.admin.MirandaAdminScreen
import ru.t2sales.miranda.ui.chat.MirandaChatScreen
import ru.t2sales.miranda.ui.components.ToastHost
import ru.t2sales.miranda.ui.conversations.ContactsTreeScreen
import ru.t2sales.miranda.ui.device.DeviceActivationScreen
import ru.t2sales.miranda.ui.device.DeviceActivationViewModel
import ru.t2sales.miranda.ui.device.DeviceState
import ru.t2sales.miranda.ui.login.LoginScreen
import ru.t2sales.miranda.ui.settings.MirandaSettingsScreen
import ru.t2sales.miranda.session.PointSessionInfo
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.api.MirandaMessage
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Theme

private fun loadImageBitmapFrom(stream: java.io.InputStream) = loadImageBitmap(stream)

/** Сессия сотрудника (MeResponse) или аккаунта точки (Этап B) - разные принципалы, без общего "me". */
private sealed class MirandaSession {
    data class Employee(val me: MeResponse) : MirandaSession()
    data class Point(val corporateAccountId: Int, val accountName: String) : MirandaSession()
}

/**
 * Simpler than desktopApp's Main.kt per the plan's scope cut for
 * Miranda's first iteration: no relay/outbox/updater - just
 * Login -> Device Activation -> Messenger/Admin shell. Tray (§F плана) —
 * только для всплывающих уведомлений о сообщениях, без скрытия окна в
 * трей (Miranda не живёт в фоне как T2 Sales).
 */
fun main() {
    application {
        val container = remember { MirandaContainer() }
        val windowState = rememberWindowState(
            size = DpSize(1000.dp, 700.dp),
            position = WindowPosition.Aligned(Alignment.Center)
        )
        val icon = remember { BitmapPainter(useResource("icon.png", ::loadImageBitmapFrom)) }

        // §F плана — иконка в трее только ради системных уведомлений
        // (всплывающее окно со звуком по умолчанию ОС, правый нижний угол
        // на Windows) — тот же Compose Desktop Tray API, что desktopApp
        // уже использует (system/System.kt::AppNotifier).
        val trayState = rememberTrayState()
        LaunchedEffect(Unit) {
            MirandaNotifier.send = { title, text -> trayState.sendNotification(Notification(title, text, Notification.Type.Info)) }
        }
        Tray(icon = icon, state = trayState, tooltip = "T2 Miranda") {
            Item("Выйти", onClick = ::exitApplication)
        }

        Window(onCloseRequest = ::exitApplication, title = "T2 Miranda", state = windowState, icon = icon) {
            LaunchedEffect(Unit) { MirandaAppWindow.awt = window }
            T2Theme {
                Box(Modifier.fillMaxSize()) {
                    MirandaRoot(container, windowState)
                    ToastHost(Modifier.align(Alignment.BottomCenter).padding(bottom = 32.dp))
                }
            }
        }
    }
}

@Composable
private fun MirandaRoot(container: MirandaContainer, windowState: WindowState) {
    var session by remember { mutableStateOf<MirandaSession?>(null) }
    var checkedSession by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        val me = container.authRepository.currentSession()
        session = if (me != null) {
            MirandaSession.Employee(me)
        } else {
            // Нет "/me"-аналога для точечной сессии - локально сохранённая
            // identity (PointSessionStore) - только подсказка для UI, не
            // доказательство; подтверждаем обращением к серверу, иначе
            // отозванная/просроченная t2_point_session вернёт 401 только
            // при первом реальном запросе внутри мессенджера.
            val cached = container.pointSessionStore.load()
            if (cached != null) {
                val stillValid = runCatching { container.mirandaApi.listConversations() }.isSuccess
                if (stillValid) {
                    MirandaSession.Point(cached.corporateAccountId, cached.accountName)
                } else {
                    container.pointSessionStore.clear()
                    null
                }
            } else {
                null
            }
        }
        checkedSession = true
    }

    if (!checkedSession) {
        Box(Modifier.fillMaxSize().background(T2Colors.bg), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }

    when (val s = session) {
        null -> LoginScreen(
            authRepository = container.authRepository,
            mirandaApi = container.mirandaApi,
            onLoggedIn = { session = MirandaSession.Employee(it) },
            onPointLoggedIn = { corporateAccountId, accountName ->
                container.pointSessionStore.save(PointSessionInfo(corporateAccountId, accountName))
                session = MirandaSession.Point(corporateAccountId, accountName)
            }
        )
        is MirandaSession.Employee -> MirandaShell(container, s.me, windowState, onLogout = { session = null })
        is MirandaSession.Point -> MirandaMessengerShell(
            container = container,
            myCorporateAccountId = s.corporateAccountId,
            isAdmin = false,
            windowState = windowState,
            onLogout = {
                scope.launch { runCatching { container.mirandaApi.pointLogout() } }
                container.pointSessionStore.clear()
                session = null
            }
        )
    }
}

@Composable
private fun MirandaShell(container: MirandaContainer, me: MeResponse, windowState: WindowState, onLogout: () -> Unit) {
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
            windowState = windowState,
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

private enum class MirandaTab { Conversations, Settings, Admin }

// Насколько шире становится окно, когда рядом с деревом контактов
// открывается панель чата - раскрытие "на месте", без отдельного окна
// (явная правка пользователя: "рядом экран приложения расширялся").
private val CHAT_PANEL_WIDTH = 440.dp

@Composable
private fun MirandaMessengerShell(
    container: MirandaContainer,
    myCorporateAccountId: Int,
    isAdmin: Boolean,
    windowState: WindowState,
    onLogout: () -> Unit
) {
    var tab by remember { mutableStateOf(MirandaTab.Conversations) }
    var openConversation by remember { mutableStateOf<Pair<Int, String>?>(null) }
    var chatPanelWidened by remember { mutableStateOf(false) }

    LaunchedEffect(openConversation, tab) {
        val shouldBeOpen = tab == MirandaTab.Conversations && openConversation != null
        if (shouldBeOpen && !chatPanelWidened) {
            windowState.size = DpSize(windowState.size.width + CHAT_PANEL_WIDTH, windowState.size.height)
            chatPanelWidened = true
        } else if (!shouldBeOpen && chatPanelWidened) {
            windowState.size = DpSize(windowState.size.width - CHAT_PANEL_WIDTH, windowState.size.height)
            chatPanelWidened = false
        }
    }

    // §F плана — всплывающие уведомления о сообщениях. /miranda/ws — один
    // сокет на ВЕСЬ аккаунт (не per-conversation; MirandaChatScreen.kt
    // открывает свой собственный listen() и фильтрует кадры клиентски по
    // conversationId уже открытого чата) — здесь он же слушается на
    // уровне всего приложения, не привязан к конкретному открытому
    // экрану, поэтому ловит сообщения из ЛЮБОГО диалога пользователя.
    // Не уведомляем о собственных сообщениях и о сообщениях в диалоге,
    // который прямо сейчас открыт на фокусированном окне.
    val tabState = rememberUpdatedState(tab)
    val openConversationState = rememberUpdatedState(openConversation)
    LaunchedEffect(Unit) {
        var retry = 5000L
        while (isActive) {
            runCatching {
                container.mirandaApi.listen(
                    onOpen = { retry = 5000L },
                    onFrame = { f ->
                        if (f["type"]?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content } == "message") {
                            (f["message"] as? kotlinx.serialization.json.JsonObject)?.let { m ->
                                runCatching { kotlinx.serialization.json.Json { ignoreUnknownKeys = true }.decodeFromJsonElement(MirandaMessage.serializer(), m) }
                                    .getOrNull()?.let { message ->
                                        if (message.sender.corporateAccountId == myCorporateAccountId) return@let
                                        val viewingThisConversation = tabState.value == MirandaTab.Conversations &&
                                            openConversationState.value?.first == message.conversationId
                                        if (MirandaAppWindow.isFocused && viewingThisConversation) return@let
                                        val preview = message.body?.take(120) ?: if (message.attachments.isNotEmpty()) "Вложение" else ""
                                        MirandaNotifier.notify(message.sender.displayName, preview)
                                    }
                            }
                        }
                    }
                )
            }
            delay(retry)
            retry = (retry * 3 / 2).coerceAtMost(60000L)
        }
    }

    Row(Modifier.fillMaxSize().background(T2Colors.bg)) {
        Column(
            modifier = Modifier.width(220.dp).fillMaxHeight().background(T2Colors.surface).padding(16.dp)
        ) {
            Text("T2 Miranda", fontSize = 18.sp, fontWeight = FontWeight.ExtraBold, color = T2Colors.text)
            Spacer(Modifier.height(20.dp))
            NavItem("Диалоги", tab == MirandaTab.Conversations) { tab = MirandaTab.Conversations }
            Spacer(Modifier.height(4.dp))
            NavItem("Настройки", tab == MirandaTab.Settings) { tab = MirandaTab.Settings }
            if (isAdmin) {
                Spacer(Modifier.height(4.dp))
                NavItem("Админ", tab == MirandaTab.Admin) { tab = MirandaTab.Admin }
            }
            Spacer(Modifier.weight(1f, fill = true))
        }

        when (tab) {
            MirandaTab.Admin -> Box(Modifier.fillMaxSize()) {
                MirandaAdminScreen(mirandaApi = container.mirandaApi, adminCenterApi = container.adminCenterApi)
            }
            // §G плана — «Выйти» переехало внутрь «Настроек» (было отдельным
            // пунктом навигации), там же самостоятельное переименование.
            MirandaTab.Settings -> Box(Modifier.fillMaxSize()) {
                MirandaSettingsScreen(api = container.mirandaApi, onLogout = onLogout)
            }
            MirandaTab.Conversations -> {
                Box(Modifier.width(320.dp).fillMaxHeight()) {
                    ContactsTreeScreen(
                        api = container.mirandaApi,
                        myCorporateAccountId = myCorporateAccountId,
                        isAdmin = isAdmin,
                        onOpenConversation = { id, title -> openConversation = id to title }
                    )
                }
                Box(Modifier.width(1.dp).fillMaxHeight().background(T2Colors.border))
                Box(Modifier.weight(1f).fillMaxHeight()) {
                    val open = openConversation
                    if (open == null) {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text("Выберите контакт, чтобы открыть чат", color = T2Colors.hint, fontSize = 14.sp)
                        }
                    } else {
                        Column(Modifier.fillMaxSize()) {
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(16.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text("✕", fontSize = 16.sp, color = T2Colors.text, modifier = Modifier.clickable { openConversation = null }.padding(end = 12.dp))
                                Text(open.second, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = T2Colors.text)
                            }
                            Box(Modifier.fillMaxSize()) {
                                MirandaChatScreen(api = container.mirandaApi, conversationId = open.first, myCorporateAccountId = myCorporateAccountId)
                            }
                        }
                    }
                }
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

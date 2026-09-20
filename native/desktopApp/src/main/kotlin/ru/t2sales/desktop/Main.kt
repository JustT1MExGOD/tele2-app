package ru.t2sales.desktop

import ru.t2sales.desktop.system.SystemTheme
import ru.t2sales.desktop.quick.QuickSaleHost
import ru.t2sales.desktop.quick.QuickSale
import ru.t2sales.desktop.ui.shell.AppNav
import ru.t2sales.desktop.support.Diagnostics
import ru.t2sales.desktop.system.WindowPrefs
import ru.t2sales.desktop.system.TrayPrefs
import ru.t2sales.desktop.system.SingleInstance
import ru.t2sales.desktop.system.NotificationWatcher
import ru.t2sales.desktop.system.GlobalHotkey
import ru.t2sales.desktop.system.Autostart
import ru.t2sales.desktop.system.AppWindow
import ru.t2sales.desktop.system.AppNotifier
import kotlinx.coroutines.flow.debounce
import androidx.compose.ui.window.Notification
import androidx.compose.ui.window.rememberTrayState
import androidx.compose.ui.window.Tray
import androidx.compose.runtime.snapshotFlow
import ru.t2sales.desktop.ui.boot.SplashScreen
import ru.t2sales.desktop.ui.boot.BootSequence
import androidx.compose.ui.window.rememberWindowState
import androidx.compose.ui.window.WindowPosition
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.Box
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.type
import androidx.compose.ui.window.Window
import androidx.compose.foundation.window.WindowDraggableArea
import androidx.compose.ui.window.application
import ru.t2sales.desktop.di.AppContainer
import ru.t2sales.desktop.ui.home.HomeScreen
import ru.t2sales.desktop.ui.login.LoginScreen
import ru.t2sales.desktop.ui.cash.CashScreen
import ru.t2sales.desktop.ui.admin.AuditScreen
import ru.t2sales.desktop.ui.admincenter.AdminCenterScreen
import ru.t2sales.desktop.ui.bfq.BfqScreen
import ru.t2sales.desktop.ui.history.HistoryScreen
import ru.t2sales.desktop.ui.analytics.ForecastScreen
import ru.t2sales.desktop.ui.analytics.HeatmapScreen
import ru.t2sales.desktop.ui.analytics.LiveScreen
import ru.t2sales.desktop.ui.analytics.StoreProfileScreen
import ru.t2sales.desktop.ui.info.AlertsScreen
import ru.t2sales.desktop.ui.info.AnnounceScreen
import ru.t2sales.desktop.ui.info.SupportScreen
import ru.t2sales.desktop.ui.plans.MonthPlanScreen
import ru.t2sales.desktop.ui.plans.NetMonthScreen
import ru.t2sales.desktop.ui.admin.DealersScreen
import ru.t2sales.desktop.ui.admin.OrgsScreen
import ru.t2sales.desktop.ui.chat.ChatScreen
import ru.t2sales.desktop.ui.supervisor.SupervisorScreen
import ru.t2sales.desktop.ui.supervisor.SvTab
import ru.t2sales.desktop.ui.commandcenter.CommandCenterScreen
import ru.t2sales.desktop.ui.profile.ProfileScreen
import ru.t2sales.desktop.ui.reports.ReportsScreen
import ru.t2sales.desktop.ui.schedule.ScheduleScreen
import ru.t2sales.desktop.ui.shell.AppShell
import ru.t2sales.desktop.ui.tasks.TasksScreen
import ru.t2sales.desktop.ui.team.TeamScreen
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.navigation.Screen
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Theme
import ru.t2sales.desktop.ui.shell.ThemePrefs

@OptIn(kotlinx.coroutines.FlowPreview::class)
fun main(args: Array<String>) {
    // "--tray" is what Windows autostart passes: start hidden, live in the tray until the user opens the window
    val startHidden = "--tray" in args
    // One copy of the installed app: a second start just brings the first one forward. A development run is never restricted.
    if (ru.t2sales.desktop.update.UpdateConfig.isPackaged && !SingleInstance.acquire(onShow = { AppWindow.show() })) return
    if (startHidden) AppWindow.visible = false

    application {
        val container = remember { AppContainer() }
        remember { T2Colors.dark = ThemePrefs.isDark() }

        val icon = remember { androidx.compose.ui.graphics.painter.BitmapPainter(androidx.compose.ui.res.useResource("icon.png", ::loadImageBitmapFrom)) }

        // Launch like Discord: a small splash checks the connection, installs a pending update, signs in - and only then the client opens.
        val boot = remember { BootSequence(container) }
        var booted by remember { mutableStateOf(false) }
        LaunchedEffect(Unit) { boot.run(); booted = true }

        // follow Windows' light/dark setting while "theme as in Windows" is on (checked every 20 s: the setting rarely changes)
        LaunchedEffect(ThemePrefs.auto) {
            while (ThemePrefs.auto) {
                SystemTheme.isDark()?.let { dark -> if (dark != T2Colors.dark) { T2Colors.dark = dark; ThemePrefs.setDark(dark) } }
                kotlinx.coroutines.delay(20_000)
            }
        }
        // unsent sales, visible without opening the window: in the tray tooltip and in the window title
        val queued = container.outbox.pendingCount + container.outbox.reviewCount

        // ---- tray: the app lives here when its window is closed; system notifications come from it
        val trayState = rememberTrayState()
        var autostart by remember { mutableStateOf(Autostart.enabled()) }
        var hideOnClose by remember { mutableStateOf(TrayPrefs.hideOnClose) }
        LaunchedEffect(Unit) {
            AppNotifier.send = { title, text -> trayState.sendNotification(Notification(title, text, Notification.Type.Info)) }
        }
        Tray(
            icon = icon,
            state = trayState,
            tooltip = if (queued > 0) "T2 Sales · продаж в очереди: $queued" else "T2 Sales",
            onAction = { AppWindow.show() },
            menu = {
                Item("Открыть T2 Sales", onClick = { AppWindow.show() })
                Item("Быстрая продажа  (${GlobalHotkey.LABEL})", onClick = { QuickSale.open() })
                Separator()
                if (Autostart.available) {
                    CheckboxItem("Запускать вместе с Windows", checked = autostart, onCheckedChange = { on -> if (Autostart.set(on)) autostart = on })
                }
                CheckboxItem("Тема как в Windows", checked = ThemePrefs.auto, onCheckedChange = { on -> ThemePrefs.auto = on })
                CheckboxItem("Закрытие окна сворачивает в трей", checked = hideOnClose, onCheckedChange = { on -> hideOnClose = on; TrayPrefs.hideOnClose = on })
                Item("Сохранить диагностику на рабочий стол", onClick = {
                    runCatching { Diagnostics.export(container) }
                        .onSuccess { trayState.sendNotification(Notification("T2 Sales", "Диагностика сохранена: ${it.fileName}", Notification.Type.Info)) }
                        .onFailure { trayState.sendNotification(Notification("T2 Sales", "Не удалось сохранить диагностику", Notification.Type.Error)) }
                })
                Separator()
                Item("Выйти", onClick = ::exitApplication)
            }
        )

        QuickSaleHost(container, icon)

        // background helpers start once the app is up
        LaunchedEffect(booted) {
            if (!booted) return@LaunchedEffect
            // Ctrl+Alt+P: the small quick-sale window over whatever is on screen (the sign-in screen when signed out)
            GlobalHotkey.register { QuickSale.open() }
            NotificationWatcher(container).start()
        }

        if (!booted) {
            if (!startHidden) {
                Window(
                    onCloseRequest = ::exitApplication, title = "T2 Sales", icon = icon,
                    undecorated = true, transparent = true, resizable = false, alwaysOnTop = true,
                    state = rememberWindowState(size = DpSize(480.dp, 520.dp), position = WindowPosition.Aligned(Alignment.Center))
                ) {
                    WindowDraggableArea { SplashScreen(boot.state) }
                }
            }
            return@application
        }

        val saved = remember { WindowPrefs.load() }
        val windowState = rememberWindowState(
            size = saved?.let { DpSize(it.width.dp, it.height.dp) } ?: DpSize(1100.dp, 760.dp),
            position = if (saved != null && saved.x != Int.MIN_VALUE) WindowPosition(saved.x.dp, saved.y.dp) else WindowPosition.PlatformDefault,
            placement = if (saved?.maximized == true) androidx.compose.ui.window.WindowPlacement.Maximized else androidx.compose.ui.window.WindowPlacement.Floating
        )
        LaunchedEffect(windowState) {
            // remember the size and place a moment after the last change (not on every pixel of a drag)
            snapshotFlow { listOf(windowState.size.width.value.toInt(), windowState.size.height.value.toInt(), windowState.position.x.value.toInt(), windowState.position.y.value.toInt(), if (windowState.placement == androidx.compose.ui.window.WindowPlacement.Maximized) 1 else 0) }
                .debounce(700)
                .collect { v ->
                    val maximized = v[4] == 1
                    // a maximised window keeps the size it had before, so only the flag is stored then
                    if (maximized) WindowPrefs.load()?.let { WindowPrefs.save(it.width, it.height, it.x, it.y, true) }
                    else if (windowState.position.isSpecified) WindowPrefs.save(v[0], v[1], v[2], v[3], false)
                }
        }

        Window(
            visible = AppWindow.visible,
            state = windowState,
            onCloseRequest = {
                if (TrayPrefs.hideOnClose) {
                    AppWindow.visible = false
                    if (!TrayPrefs.noticeShown) {
                        TrayPrefs.noticeShown = true
                        AppNotifier.send("T2 Sales продолжает работать", "Приложение осталось в трее и сообщит о новых алертах и объявлениях. Выход: правая кнопка по значку.")
                    }
                } else {
                    exitApplication()
                }
            },
            title = if (queued > 0) "($queued) T2 Sales" else "T2 Sales", icon = icon,
            onPreviewKeyEvent = { ev ->
                // window-wide shortcuts: Ctrl+K palette, Ctrl+N new sale. Signed-out they are harmless: the shell closes the palette on entry.
                if (ev.type == androidx.compose.ui.input.key.KeyEventType.KeyDown && ev.isCtrlPressed && ru.t2sales.desktop.ui.shell.AppNav.signedIn) {
                    when (ev.key) {
                        androidx.compose.ui.input.key.Key.K -> { ru.t2sales.desktop.ui.shell.CommandPalette.toggle(); true }
                        androidx.compose.ui.input.key.Key.N -> { ru.t2sales.desktop.ui.sales.AddSaleState.open(); true }
                        else -> false
                    }
                } else false
            }
        ) {
            LaunchedEffect(Unit) { AppWindow.awt = window }
            // the splash (always on top), the tray, a hotkey or a second start asked for the client: bring it to the front
            LaunchedEffect(AppWindow.frontTick) {
                if (AppWindow.visible) { window.isMinimized = false; window.toFront(); window.requestFocus() }
            }
            T2Theme {
                MainEntrance { AppRoot(container, boot.me) }
            }
        }
    }
}

/** The client "arrives" once the splash is gone: a short fade with a hint of scale, so the hand-over does not feel like a cut. */
@Composable
private fun MainEntrance(content: @Composable () -> Unit) {
    val a = remember { Animatable(0f) }
    LaunchedEffect(Unit) { a.animateTo(1f, tween(520, easing = androidx.compose.animation.core.CubicBezierEasing(0.2f, 0f, 0f, 1f))) }
    Box(Modifier.fillMaxSize().graphicsLayer { alpha = a.value; val sc = 0.985f + 0.015f * a.value; scaleX = sc; scaleY = sc }) { content() }
}

@Composable
private fun AppRoot(container: AppContainer, initialMe: MeResponse?) {
    var me by remember { mutableStateOf(initialMe) }

    // The connection, update check and session lookup already happened on the splash (BootSequence); from here on only the periodic
    // update timers run (first one ~15 s after launch, then every 4 h; a no-op when no update server is configured).
    LaunchedEffect(Unit) {
        container.updates.start()
        container.outbox.onSent = { n ->
            ru.t2sales.desktop.ui.components.T2Toast.show("Из очереди отправлено: $n")
            AppNotifier.whenAway("T2 Sales", "Из очереди отправлено продаж: $n")
            ru.t2sales.desktop.ui.sales.AddSaleState.refreshTick++
        }
        container.outbox.start()
        // development only: `T2_SHIFT_RESULT_DEMO=1` shows the closed-shift card with sample numbers (nothing is sent to the server)
        if (!ru.t2sales.desktop.update.UpdateConfig.isPackaged && System.getenv("T2_SHIFT_RESULT_DEMO") == "1") {
            ru.t2sales.desktop.ui.shift.ShiftUi.result = kotlinx.serialization.json.Json.parseToJsonElement(
                """{"score":92,"ideal_shift":"true","fact":{"sim":7,"mnp":2,"pa":1,"combo":1},"day_plan":{"sim":7,"mnp":2,"pa":1,"combo":1},"ideal_missing":[],"ai_summary":"Отличная смена: план по всем четырём метрикам закрыт, лучший час пришёлся на вечер.","gamification":{"title":"Мастер","level":4,"xp":1180,"next_level_xp":1500,"xp_gained":120,"leveled_up":"true","streak_days":6},"rewarded":"true"}"""
            ) as kotlinx.serialization.json.JsonObject
        }
        if (!ru.t2sales.desktop.update.UpdateConfig.isPackaged && System.getenv("T2_OUTBOX_DEMO") == "1") container.outbox.seedDemoForReview()
    }

    if (me == null) {
        LoginScreen(
            authRepository = container.authRepository,
            onLoggedIn = { loggedInMe -> me = loggedInMe }
        )
    } else {
        var selected by remember { mutableStateOf<Screen>(Screen.Home) }
        ru.t2sales.desktop.ui.shell.AppNav.signedIn = true
        ru.t2sales.desktop.ui.shell.AppNav.myEmployeeId = me!!.employee_id
        ru.t2sales.desktop.ui.shell.AppNav.canManageSales = me!!.role == "manager" || me!!.role == "admin" || me!!.is_manager == true
        androidx.compose.runtime.DisposableEffect(Unit) { onDispose { ru.t2sales.desktop.ui.shell.AppNav.signedIn = false; ru.t2sales.desktop.ui.shell.AppNav.myEmployeeId = null } }
        ru.t2sales.desktop.ui.shell.AppNav.go = { selected = it }
        ru.t2sales.desktop.ui.shell.AppNav.current = selected
        AppShell(
            selected = selected,
            onSelect = { selected = it },
            container = container,
            me = me!!
        ) { screen ->
            when (screen) {
                Screen.Home -> HomeScreen(container = container, me = me!!, onNavigate = { selected = it })
                Screen.StoreProfile -> StoreProfileScreen(container, me = me!!, onNavigate = { selected = it })
                Screen.ReportImg -> ru.t2sales.desktop.ui.reports.ReportImgScreen(container)
                Screen.PlanDay -> ru.t2sales.desktop.ui.plans.PlanDayScreen(container)
                Screen.Live -> LiveScreen(container)
                Screen.Heatmap -> HeatmapScreen(container)
                Screen.Replay -> ru.t2sales.desktop.ui.replay.ReplayScreen(container)
                Screen.Forecast -> ForecastScreen(container, me = me!!)
                Screen.Alerts -> AlertsScreen(container, onNavigate = { selected = it })
                Screen.Announce -> AnnounceScreen(container, me = me!!)
                Screen.Support -> SupportScreen(container, me = me!!)
                Screen.MonthPlan -> MonthPlanScreen(container, me = me!!)
                Screen.NetMonth -> NetMonthScreen(container)
                Screen.History -> HistoryScreen(container.salesApi, me = me!!)
                Screen.Bfq -> BfqScreen(container, me = me!!)
                Screen.AdminCenter -> AdminCenterScreen(container)
                Screen.Orgs -> OrgsScreen(container.adminApi)
                Screen.Audit -> AuditScreen(container.adminApi)
                Screen.Dealers -> DealersScreen(container.adminApi)
                Screen.SvOverview -> SupervisorScreen(container.supervisorApi, container.salesApi, SvTab.Overview)
                Screen.SvStores -> SupervisorScreen(container.supervisorApi, container.salesApi, SvTab.Stores)
                Screen.SvPeople -> SupervisorScreen(container.supervisorApi, container.salesApi, SvTab.People)
                Screen.SvTrend -> SupervisorScreen(container.supervisorApi, container.salesApi, SvTab.Trend)
                Screen.Chat -> ChatScreen(container = container, me = me!!)
                Screen.Cash -> CashScreen(container = container)
                Screen.CommandCenter -> CommandCenterScreen(container = container, me = me!!, onNavigate = { selected = it })
                Screen.Profile -> ProfileScreen(
                    me = me!!,
                    container = container,
                    onNavigate = { selected = it },
                    onLogout = { me = null }
                )
                Screen.Team -> TeamScreen(
                    teamApi = container.teamApi,
                    scheduleApi = container.scheduleApi,
                    salesApi = container.salesApi,
                    adminApi = container.adminApi,
                    me = me,
                    onNavigate = { selected = it }
                )
                Screen.Tasks -> TasksScreen(tasksApi = container.tasksApi, myEmployeeId = me?.employee_id, role = me?.role, isManagerFlag = me?.is_manager == true)
                Screen.Schedule -> ScheduleScreen(cache = container.readCache, scheduleApi = container.scheduleApi, teamApi = container.teamApi, myEmployeeId = me?.employee_id, role = me?.role, canEdit = me?.role == "manager" || me?.role == "admin" || me?.is_manager == true)
                Screen.Reports -> ReportsScreen(
                    reportsApi = container.reportsApi,
                    teamApi = container.teamApi,
                    isAdmin = me?.role == "admin",
                    canManage = me?.role == "manager" || me?.role == "admin" || me?.is_manager == true,
                    onOpenReportImg = { selected = Screen.ReportImg }
                )
                Screen.Login -> Unit
            }
        }
    }
}

private fun loadImageBitmapFrom(stream: java.io.InputStream) = androidx.compose.ui.res.loadImageBitmap(stream)

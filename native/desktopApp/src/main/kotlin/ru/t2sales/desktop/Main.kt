package ru.t2sales.desktop

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

fun main() = application {
    val container = remember { AppContainer() }
    remember { T2Colors.dark = ThemePrefs.isDark() }

    val icon = remember { androidx.compose.ui.graphics.painter.BitmapPainter(androidx.compose.ui.res.useResource("icon.png", ::loadImageBitmapFrom)) }

    // Launch like Discord: a small splash checks the connection, installs a pending update, signs in - and only then the client opens.
    val boot = remember { BootSequence(container) }
    var booted by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { boot.run(); booted = true }

    if (!booted) {
        Window(
            onCloseRequest = ::exitApplication, title = "T2 Sales", icon = icon,
            undecorated = true, transparent = true, resizable = false, alwaysOnTop = true,
            state = rememberWindowState(size = DpSize(480.dp, 520.dp), position = WindowPosition.Aligned(Alignment.Center))
        ) {
            WindowDraggableArea { SplashScreen(boot.state) }
        }
        return@application
    }

    Window(
        onCloseRequest = ::exitApplication, title = "T2 Sales", icon = icon,
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
        // the splash (always on top) has just closed: bring the client to the front instead of letting it open behind other windows
        LaunchedEffect(Unit) { window.toFront(); window.requestFocus() }
        T2Theme {
            MainEntrance { AppRoot(container, boot.me) }
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
    LaunchedEffect(Unit) { container.updates.start() }

    if (me == null) {
        LoginScreen(
            authRepository = container.authRepository,
            onLoggedIn = { loggedInMe -> me = loggedInMe }
        )
    } else {
        var selected by remember { mutableStateOf<Screen>(Screen.Home) }
        ru.t2sales.desktop.ui.shell.AppNav.signedIn = true
        androidx.compose.runtime.DisposableEffect(Unit) { onDispose { ru.t2sales.desktop.ui.shell.AppNav.signedIn = false } }
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
                Screen.Schedule -> ScheduleScreen(scheduleApi = container.scheduleApi, teamApi = container.teamApi, myEmployeeId = me?.employee_id, role = me?.role, canEdit = me?.role == "manager" || me?.role == "admin" || me?.is_manager == true)
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

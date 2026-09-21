package ru.t2sales.android.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.t2sales.android.AppContainer
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.navigation.Screen
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Radius

/** Screens that open over the tabs (the web's switchPage targets that are not in the bottom navigation). */
enum class Page(val title: String) {
    Bfq("BFQ"), Heatmap("Heatmap часов"), Replay("Повтор месяца"), Forecast("Прогноз и what-if"), Announce("Объявления"),
    ReportImg("Отчёт-картинка"), Reports("Отчёты"), Live("Сеть live"), CommandCenter("Command Center"), Tasks("Задачи"),
    Alerts("Алерты"), Cash("Касса"), MonthPlan("Планы и факт за месяц"), NetMonth("Динамика выполнения"), Support("Поддержка"),
    History("История продаж"), StoreProfile("Профиль точки"), AdminCenter("Admin Center"), Orgs("Сети"), Audit("История действий"),
    Dealers("Дилеры/Секторы"), SvOverview("Обзор"), SvStores("Точки"), SvPeople("Люди"), SvTrend("Тренд")
}

/** The stack of open pages: the last one is on top, Back pops it. */
object Nav {
    /** The selected bottom tab (a Tab name in Shell.kt). */
    var tab by androidx.compose.runtime.mutableStateOf("Home")
    val stack = mutableStateListOf<Page>()
    fun open(page: Page) {
        if (stack.lastOrNull() != page) stack.add(page)
    }
    fun back() {
        if (stack.isNotEmpty()) stack.removeAt(stack.lastIndex)
    }
    fun clear() = stack.clear()
}

/** Draws the page on top of the stack over the tab content; a page slides in from the right and slides away when closed. */
@Composable
fun PageHost(container: AppContainer, me: MeResponse) {
    val page = Nav.stack.lastOrNull()
    val depth = Nav.stack.size
    var previousDepth by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(depth) }
    val forward = depth >= previousDepth
    androidx.compose.runtime.SideEffect { previousDepth = depth }
    if (page != null) BackHandler { Nav.back() }
    androidx.compose.animation.AnimatedContent(
        targetState = page,
        transitionSpec = {
            if (forward) {
                (androidx.compose.animation.slideInHorizontally(androidx.compose.animation.core.tween(280, easing = Motion.Emphasized)) { it / 3 } + androidx.compose.animation.fadeIn(androidx.compose.animation.core.tween(220))) togetherWith
                    androidx.compose.animation.fadeOut(androidx.compose.animation.core.tween(140))
            } else {
                androidx.compose.animation.fadeIn(androidx.compose.animation.core.tween(160)) togetherWith
                    (androidx.compose.animation.slideOutHorizontally(androidx.compose.animation.core.tween(240, easing = Motion.Emphasized)) { it / 3 } + androidx.compose.animation.fadeOut(androidx.compose.animation.core.tween(200)))
            }
        },
        label = "page"
    ) { target -> if (target != null) PageContent(target, container, me) }
}

@Composable
private fun PageContent(page: Page, container: AppContainer, me: MeResponse) {
    androidx.compose.runtime.key(page) {
        when (page) {
            Page.Bfq -> BfqPage(container, me)
            Page.Tasks -> PageScaffold(page.title) { TasksScreen(tasksApi = container.tasksApi, myEmployeeId = me.employee_id, role = me.role, isManagerFlag = me.is_manager == true) }
            Page.History -> PageScaffold(page.title) { HistoryScreen(container.salesApi, me = me) }
            Page.Cash -> PageScaffold(page.title) { CashScreen(container = container) }
            Page.Alerts -> PageScaffold(page.title) { AlertsScreen(container, onNavigate = { AppNav.go(it) }) }
            Page.Announce -> PageScaffold(page.title) { AnnounceScreen(container, me = me) }
            Page.Support -> PageScaffold(page.title) { SupportScreen(container, me = me) }
            Page.CommandCenter -> PageScaffold(page.title) { CommandCenterScreen(container = container, me = me, onNavigate = { AppNav.go(it) }) }
            Page.StoreProfile -> PageScaffold(page.title) { StoreProfileScreen(container, me = me, onNavigate = { AppNav.go(it) }) }
            Page.ReportImg -> PageScaffold(page.title) { ReportImgScreen(container) }
            Page.Live -> PageScaffold(page.title) { LiveScreen(container) }
            Page.Heatmap -> PageScaffold(page.title) { HeatmapScreen(container) }
            Page.Replay -> PageScaffold(page.title) { ReplayScreen(container) }
            Page.Forecast -> PageScaffold(page.title) { ForecastScreen(container, me = me) }
            Page.MonthPlan -> PageScaffold(page.title) { MonthPlanScreen(container, me = me) }
            Page.NetMonth -> PageScaffold(page.title) { NetMonthScreen(container) }
            Page.Reports -> PageScaffold(page.title) {
                ReportsScreen(
                    reportsApi = container.reportsApi, teamApi = container.teamApi, isAdmin = me.role == "admin",
                    canManage = me.role == "manager" || me.role == "admin" || me.is_manager == true, onOpenReportImg = { AppNav.go(Screen.ReportImg) }
                )
            }
            Page.AdminCenter -> PageScaffold(page.title) { AdminCenterScreen(container) }
            Page.Orgs -> PageScaffold(page.title) { OrgsScreen(container.adminApi) }
            Page.Audit -> PageScaffold(page.title) { AuditScreen(container.adminApi) }
            Page.Dealers -> PageScaffold(page.title) { DealersScreen(container.adminApi) }
            Page.SvOverview -> PageScaffold(page.title) { SupervisorScreen(container.supervisorApi, container.salesApi, SvTab.Overview) }
            Page.SvStores -> PageScaffold(page.title) { SupervisorScreen(container.supervisorApi, container.salesApi, SvTab.Stores) }
            Page.SvPeople -> PageScaffold(page.title) { SupervisorScreen(container.supervisorApi, container.salesApi, SvTab.People) }
            Page.SvTrend -> PageScaffold(page.title) { SupervisorScreen(container.supervisorApi, container.salesApi, SvTab.Trend) }
            else -> PageScaffold(page.title) {
                Text("Экран в работе", color = T2Colors.hint, fontSize = 14.sp, modifier = Modifier.padding(24.dp))
            }
        }
    }
}

/** A page with the back header (‹ and the title) under the status bar; the body scrolls. */
@Composable
fun PageScaffold(title: String, scroll: Boolean = true, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxSize().background(T2Colors.bg).statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            val shape = RoundedCornerShape(T2Radius.sm)
            Box(Modifier.size(40.dp).clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape).clickable { Nav.back() }, contentAlignment = Alignment.Center) {
                Text("‹", fontSize = 22.sp)
            }
            Spacer(Modifier.width(12.dp))
            Text(title, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1)
        }
        val body = if (scroll) Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()) else Modifier.weight(1f).fillMaxWidth()
        Column(body.padding(horizontal = 16.dp)) {
            content()
            if (scroll) Spacer(Modifier.height(32.dp))
        }
    }
}

/** Lets deep widgets (drop cards, hints) switch screens without threading callbacks everywhere: the PC client's AppNav on the phone. */
object AppNav {
    /** The signed-in employee (owner of the on-disk caches); null when signed out. */
    var myEmployeeId: Int? = null

    /** Opens a screen by the shared navigation model: a bottom tab, or a page over the tabs. */
    fun go(screen: Screen) {
        val tabOf = when (screen) {
            Screen.Home -> "Home"
            Screen.PlanDay -> "Plan"
            Screen.Schedule -> "Schedule"
            Screen.Profile -> "Profile"
            Screen.Team -> "Team"
            Screen.Chat -> "Chat"
            else -> null
        }
        if (tabOf != null) { Nav.clear(); Nav.tab = tabOf; return }
        val page = when (screen) {
            Screen.Bfq -> Page.Bfq
            Screen.Heatmap -> Page.Heatmap
            Screen.Replay -> Page.Replay
            Screen.Forecast -> Page.Forecast
            Screen.Announce -> Page.Announce
            Screen.ReportImg -> Page.ReportImg
            Screen.Reports -> Page.Reports
            Screen.Live -> Page.Live
            Screen.CommandCenter -> Page.CommandCenter
            Screen.Tasks -> Page.Tasks
            Screen.Alerts -> Page.Alerts
            Screen.Cash -> Page.Cash
            Screen.MonthPlan -> Page.MonthPlan
            Screen.NetMonth -> Page.NetMonth
            Screen.Support -> Page.Support
            Screen.History -> Page.History
            Screen.StoreProfile -> Page.StoreProfile
            Screen.AdminCenter -> Page.AdminCenter
            Screen.Orgs -> Page.Orgs
            Screen.Audit -> Page.Audit
            Screen.Dealers -> Page.Dealers
            Screen.SvOverview -> Page.SvOverview
            Screen.SvStores -> Page.SvStores
            Screen.SvPeople -> Page.SvPeople
            Screen.SvTrend -> Page.SvTrend
            else -> null
        }
        if (page != null) Nav.open(page)
    }

    var storeProfileId by androidx.compose.runtime.mutableStateOf<String?>(null)

    fun openStore(storeId: String) {
        if (storeId.isEmpty()) return
        storeProfileId = storeId
        go(Screen.StoreProfile)
    }

    fun back() = Nav.back()

    /** "Предложить перенос": opens "Прогноз и what-if" with the receiving store and date preselected. */
    var whatIfToStore by androidx.compose.runtime.mutableStateOf<String?>(null)
    var whatIfDate by androidx.compose.runtime.mutableStateOf<String?>(null)

    fun proposeMove(storeId: String, date: String? = null) {
        whatIfToStore = storeId
        whatIfDate = date
        go(Screen.Forecast)
    }
}

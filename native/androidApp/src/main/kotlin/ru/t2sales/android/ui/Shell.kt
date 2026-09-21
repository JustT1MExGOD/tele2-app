package ru.t2sales.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.Divider
import androidx.compose.material.Icon
import androidx.compose.material.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Person
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.runtime.LaunchedEffect
import kotlinx.coroutines.delay
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.t2sales.android.AppContainer
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Radius
import ru.t2sales.shared.theme.T2Spacing

/** The six tabs of the web app's mobile #bottomNavMain, in the same order and with the same captions. */
private enum class Tab(val label: String, val icon: ImageVector) {
    Home("Главная", Icons.Outlined.Home),
    Plan("План", Icons.Outlined.BarChart),
    Schedule("График", Icons.Outlined.CalendarMonth),
    Profile("Профиль", Icons.Outlined.Person),
    Team("Команда", Icons.Outlined.Group),
    Chat("Чат", Icons.Outlined.ChatBubbleOutline)
}

@Composable
fun Shell(container: AppContainer, me: MeResponse, onLogout: () -> Unit) {
    if (me.role == "supervisor") { SupervisorShell(container, me, onLogout); return }
    AppNav.myEmployeeId = me.employee_id
    val current = Tab.valueOf(Nav.tab)
    Box(Modifier.fillMaxSize().background(T2Colors.bg)) {
    Column(Modifier.fillMaxSize().imePadding()) {
        Box(Modifier.weight(1f).fillMaxWidth()) {
            TabEnter(current) { when (current) {
                Tab.Home -> HomeScreen(container, me)
                Tab.Schedule -> ScheduleScreen(container, me)
                Tab.Team -> TeamScreen(container, me)
                Tab.Plan -> PlanDayScreen(container)
                Tab.Chat -> ChatScreen(container, me)
                Tab.Profile -> ProfileScreen(container, me, onOpenSchedule = { Nav.tab = Tab.Schedule.name }, onLogout = onLogout)
                else -> ComingSoon(current.label)
            } }
            PageHost(container, me)
            if (current != Tab.Chat && Nav.stack.isEmpty()) Fab(Modifier.align(Alignment.BottomEnd).padding(end = 16.dp, bottom = 16.dp)) { AppState.openAddSale() }
            ToastHost(Modifier.align(Alignment.BottomCenter).padding(bottom = 88.dp, start = 16.dp, end = 16.dp))
        }
        // the keyboard takes the bottom of the screen: the content rises above it and the tab bar steps aside
        val keyboardOpen = WindowInsets.ime.getBottom(androidx.compose.ui.platform.LocalDensity.current) > 0
        if (!keyboardOpen) BottomNav(current) { Nav.tab = it.name; Nav.clear() }
    }
    // sheets are drawn over everything, bottom navigation included
    if (AppState.addSaleVisible) AddSaleSheet(container, me.employee_id, me.full_name, me.role, AppState.presetEmployeeId) { AppState.addSaleVisible = false }
    ShiftSheetHost(container)
    ToolSheetHost(container)
    SheetLayer()
    }
}

@Composable
private fun ComingSoon(title: String) {
    Box(Modifier.fillMaxSize().statusBarsPadding(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(title, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
            Text("Экран в работе", color = T2Colors.hint, fontSize = 14.sp, modifier = Modifier.padding(top = 6.dp))
        }
    }
}

/** The web's .bottom-nav: a surface bar with a hairline on top, icon over caption, the active one in the primary colour (it fades in and the icon hops). */
@Composable
private fun BottomNav(current: Tab, onSelect: (Tab) -> Unit) {
    Column(Modifier.fillMaxWidth().background(T2Colors.surface).navigationBarsPadding()) {
        Divider(color = T2Colors.border, thickness = 1.dp)
        Row(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
            Tab.entries.forEach { t ->
                val active = t == current
                val tint by androidx.compose.animation.animateColorAsState(if (active) T2Colors.primary else T2Colors.hint, androidx.compose.animation.core.tween(200))
                val lift by androidx.compose.animation.core.animateFloatAsState(if (active) 1.12f else 1f, pressSpring())
                Column(
                    Modifier.weight(1f).clip(RoundedCornerShape(T2Radius.sm)).bouncyClickable(to = 0.9f) { onSelect(t) }.padding(vertical = 6.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Icon(t.icon, contentDescription = t.label, tint = tint, modifier = Modifier.size(22.dp).graphicsLayer { scaleX = lift; scaleY = lift })
                    Text(t.label, color = tint, fontSize = 10.sp, fontWeight = if (active) FontWeight.Bold else FontWeight.Medium, maxLines = 1, modifier = Modifier.padding(top = 2.dp))
                }
            }
        }
    }
}

/** The web's .fab: a round "+" over the content, bottom right; it pops in and sinks when pressed. */
@Composable
private fun Fab(modifier: Modifier, onClick: () -> Unit) {
    val pop = remember { androidx.compose.animation.core.Animatable(0f) }
    androidx.compose.runtime.LaunchedEffect(Unit) { pop.animateTo(1f, androidx.compose.animation.core.spring(dampingRatio = 0.55f, stiffness = 320f)) }
    Box(
        modifier.graphicsLayer { scaleX = pop.value; scaleY = pop.value }.size(56.dp).clip(CircleShape).background(T2Colors.primary).bouncyClickable(to = 0.9f, onClick = onClick),
        contentAlignment = Alignment.Center
    ) { Text("+", color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.Light, modifier = Modifier.offset(y = (-2).dp)) }
}

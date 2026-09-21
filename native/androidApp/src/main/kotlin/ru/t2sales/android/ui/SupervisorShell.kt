package ru.t2sales.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.Divider
import androidx.compose.material.Icon
import androidx.compose.material.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Store
import androidx.compose.material.icons.outlined.TrendingUp
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.t2sales.android.AppContainer
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Radius

/** The supervisor's own bottom navigation of the web (#bottomNavSupervisor): the four sector views, plus the profile for signing out. */
private enum class SvNav(val label: String, val icon: ImageVector) {
    Overview("Обзор", Icons.Outlined.Dashboard),
    Stores("Точки", Icons.Outlined.Store),
    People("Люди", Icons.Outlined.Group),
    Trend("Тренд", Icons.Outlined.TrendingUp),
    Profile("Профиль", Icons.Outlined.Person)
}

@Composable
fun SupervisorShell(container: AppContainer, me: MeResponse, onLogout: () -> Unit) {
    AppNav.myEmployeeId = me.employee_id
    var tab by rememberSaveable { mutableStateOf(SvNav.Overview.name) }
    val current = SvNav.valueOf(tab)
    Box(Modifier.fillMaxSize().background(T2Colors.bg)) {
        Column(Modifier.fillMaxSize().imePadding()) {
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when (current) {
                    SvNav.Overview -> Column(Modifier.statusBarsPadding()) { SupervisorScreen(container.supervisorApi, container.salesApi, SvTab.Overview) }
                    SvNav.Stores -> Column(Modifier.statusBarsPadding()) { SupervisorScreen(container.supervisorApi, container.salesApi, SvTab.Stores) }
                    SvNav.People -> Column(Modifier.statusBarsPadding()) { SupervisorScreen(container.supervisorApi, container.salesApi, SvTab.People) }
                    SvNav.Trend -> Column(Modifier.statusBarsPadding()) { SupervisorScreen(container.supervisorApi, container.salesApi, SvTab.Trend) }
                    SvNav.Profile -> ProfileScreen(container, me, onOpenSchedule = {}, onLogout = onLogout)
                }
                ToastHost(Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp, start = 16.dp, end = 16.dp))
            }
            if (WindowInsets.ime.getBottom(androidx.compose.ui.platform.LocalDensity.current) == 0) {
                Column(Modifier.fillMaxWidth().background(T2Colors.surface).navigationBarsPadding()) {
                    Divider(color = T2Colors.border, thickness = 1.dp)
                    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                        SvNav.entries.forEach { t ->
                            val tint = if (t == current) T2Colors.primary else T2Colors.hint
                            Column(Modifier.weight(1f).clip(RoundedCornerShape(T2Radius.sm)).clickable { tab = t.name }.padding(vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                                Icon(t.icon, contentDescription = t.label, tint = tint, modifier = Modifier.size(22.dp))
                                Text(t.label, color = tint, fontSize = 10.sp, fontWeight = if (t == current) FontWeight.Bold else FontWeight.Medium, maxLines = 1, modifier = Modifier.padding(top = 2.dp))
                            }
                        }
                    }
                }
            }
        }
        SheetLayer()
    }
}

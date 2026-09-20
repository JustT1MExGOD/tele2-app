package ru.t2sales.desktop.ui.shell

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.hoverable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.Icon
import androidx.compose.material.MaterialTheme
import androidx.compose.material.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AdminPanelSettings
import androidx.compose.material.icons.outlined.Assignment
import androidx.compose.material.icons.outlined.Business
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.Chat
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Insights
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.PointOfSale
import androidx.compose.material.icons.outlined.Public
import androidx.compose.material.icons.outlined.Store
import androidx.compose.material.icons.outlined.TrendingUp
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ru.t2sales.shared.navigation.Screen
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Radius
import ru.t2sales.shared.theme.T2Spacing

/** One nav-item entry. [screen] is non-null only for destinations that are
 * actually wired up so far (Главная, and Reports off-sidebar via Home) —
 * everything else is rendered for visual completeness (per the real
 * desktop-shell sidebar, index.html:216-297) but isn't clickable yet. */
private data class NavEntry(
    val label: String,
    val icon: ImageVector,
    val screen: Screen? = null
)

private data class NavSection(val title: String, val items: List<NavEntry>, val visible: (String, Boolean) -> Boolean = { _, _ -> true })

/** Mirrors the real web app's full desktop-shell sidebar (index.html:216-297,
 * styles.css:2261-2387) section-for-section and item-for-item, including
 * the sections/items not wired up yet — added for visual completeness per
 * explicit user request, not because those destinations work yet. */
// "Отчёты" is deliberately absent here — the real sidebar has no such item
// (index.html:216-297); the real /reports page is only reachable from a row
// on the Home page (index.html:578). This milestone's pilot screen has no
// sidebar entry of its own, matching the real app exactly.
private val SECTIONS = listOf(
    NavSection(
        "Обзор",
        listOf(
            NavEntry("Главная", Icons.Outlined.Home, Screen.Home),
            NavEntry("Профиль", Icons.Outlined.Person, Screen.Profile),
            NavEntry("Задачи", Icons.Outlined.Assignment, Screen.Tasks),
            NavEntry("График", Icons.Outlined.CalendarToday, Screen.Schedule),
            NavEntry("Команда", Icons.Outlined.Group, Screen.Team),
            NavEntry("Чат", Icons.Outlined.Chat, Screen.Chat)
        )
    ),
    NavSection(
        "Аналитика",
        listOf(NavEntry("Command Center", Icons.Outlined.Insights, Screen.CommandCenter)),
        visible = { role, _ -> role == "manager" || role == "admin" || role == "supervisor" }
    ),
    NavSection(
        "Управление",
        listOf(NavEntry("Касса", Icons.Outlined.PointOfSale, Screen.Cash)),
        visible = { role, isManager -> role == "manager" || role == "admin" || isManager }
    ),
    NavSection(
        "Супервайзер",
        listOf(
            NavEntry("Обзор", Icons.Outlined.Visibility, Screen.SvOverview),
            NavEntry("Точки", Icons.Outlined.Store, Screen.SvStores),
            NavEntry("Люди", Icons.Outlined.People, Screen.SvPeople),
            NavEntry("Тренд", Icons.Outlined.TrendingUp, Screen.SvTrend)
        ),
        visible = { role, _ -> role == "supervisor" || role == "admin" }
    ),
    NavSection(
        "Администрирование",
        listOf(
            NavEntry("Сети", Icons.Outlined.Public, Screen.Orgs),
            NavEntry("История действий", Icons.Outlined.History, Screen.Audit),
            NavEntry("Дилеры/Секторы", Icons.Outlined.Business, Screen.Dealers),
            NavEntry("Admin Center", Icons.Outlined.AdminPanelSettings, Screen.AdminCenter)
        ),
        visible = { role, _ -> role == "admin" }
    )
)

/** Every sidebar destination the user may open, as (section, label, screen) - the command palette searches these. */
fun navigationTargets(role: String, isManager: Boolean): List<Triple<String, String, Screen>> =
    SECTIONS.filter { it.visible(role, isManager) }.flatMap { s -> s.items.mapNotNull { e -> e.screen?.let { Triple(s.title, e.label, it) } } }

/** Ported 1:1 from the web app's desktop-shell sidebar (styles.css:2261-2387,
 * `@media (min-width: 860px) .sidebar`/`.sidebar-brand`/`.sidebar .nav-item`)
 * — same 248px width (set in AppShell), --surface background, --border
 * right edge, --primary-soft active fill + 3px left accent bar. No user
 * name/role block — the real sidebar (index.html:216-297) doesn't have one,
 * that info lives in the Home page's welcome card instead. */
@Composable
fun Sidebar(
    selected: Screen,
    onSelect: (Screen) -> Unit,
    role: String,
    isManager: Boolean,
    modifier: Modifier = Modifier
) {
    Row(modifier = modifier) {
        Column(
            modifier = Modifier
                .fillMaxHeight()
                .weight(1f)
                .background(T2Colors.surface)
                .padding(top = T2Spacing.sp4)
        ) {
            Text(
                "🍉 T2 Sales",
                color = T2Colors.text,
                fontWeight = FontWeight.W800,
                style = MaterialTheme.typography.subtitle1,
                modifier = Modifier.padding(horizontal = T2Spacing.sp2)
            )

            androidx.compose.foundation.layout.Spacer(Modifier.padding(top = T2Spacing.sp4))

            LazyColumn(modifier = Modifier.padding(horizontal = T2Spacing.sp2)) {
                SECTIONS.filter { it.visible(role, isManager) }.forEach { section ->
                    item {
                        Text(
                            text = section.title.uppercase(),
                            color = T2Colors.hint,
                            fontWeight = FontWeight.Bold,
                            style = MaterialTheme.typography.overline,
                            modifier = Modifier.padding(horizontal = T2Spacing.sp2, vertical = T2Spacing.sp1)
                        )
                    }
                    items(section.items) { entry ->
                        NavItem(
                            entry,
                            isSelected = entry.screen != null && entry.screen == selected,
                            onClick = { entry.screen?.let(onSelect) }
                        )
                    }
                    item { androidx.compose.foundation.layout.Spacer(Modifier.padding(top = T2Spacing.sp2)) }
                }
            }
        }
        // 1px right border (--border, styles.css:2325).
        Box(modifier = Modifier.width(1.dp).fillMaxHeight().background(T2Colors.border))
    }
}

@Composable
private fun NavItem(entry: NavEntry, isSelected: Boolean, onClick: () -> Unit) {
    val source = remember { MutableInteractionSource() }
    val hovered by source.collectIsHoveredAsState()
    val bg by animateColorAsState(
        when {
            isSelected -> T2Colors.primarySoft
            hovered && entry.screen != null -> T2Colors.surface2
            else -> Color.Transparent
        },
        tween(180)
    )
    val tint by animateColorAsState(if (isSelected) T2Colors.primary else T2Colors.hint, tween(200))
    val labelColor by animateColorAsState(if (isSelected) T2Colors.primary else T2Colors.text, tween(200))
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(T2Radius.sm))
            .background(bg)
            .hoverable(source)
            .clickable(interactionSource = source, indication = LocalIndication.current, enabled = entry.screen != null, onClick = onClick)
    ) {
        AnimatedVisibility(
            visible = isSelected,
            modifier = Modifier.align(Alignment.CenterStart),
            enter = fadeIn(tween(200)) + scaleIn(tween(260), initialScale = 0.2f),
            exit = fadeOut(tween(120))
        ) {
            Box(
                modifier = Modifier
                    .width(3.dp)
                    .height(24.dp)
                    .background(T2Colors.primary, shape = RoundedCornerShape(topEnd = 3.dp, bottomEnd = 3.dp))
            )
        }
        Row(
            modifier = Modifier.padding(horizontal = T2Spacing.sp2, vertical = 10.dp),
        ) {
            Icon(
                entry.icon,
                contentDescription = null,
                tint = tint,
                modifier = Modifier.padding(end = T2Spacing.sp3).width(18.dp).height(18.dp)
            )
            Text(
                text = entry.label,
                color = labelColor,
                style = MaterialTheme.typography.body2
            )
        }
    }
}

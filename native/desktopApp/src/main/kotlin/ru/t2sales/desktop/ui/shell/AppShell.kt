package ru.t2sales.desktop.ui.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.MaterialTheme
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.layout.height
import ru.t2sales.desktop.ui.components.betaPress
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import ru.t2sales.desktop.di.AppContainer
import ru.t2sales.desktop.ui.components.AvatarImage
import ru.t2sales.desktop.ui.components.ScreenEnter
import ru.t2sales.desktop.ui.sales.AddSaleDialog
import ru.t2sales.desktop.ui.sales.AddSaleState
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.desktop.ui.components.ToastHost
import ru.t2sales.shared.api.HomeApi
import ru.t2sales.shared.api.MeDayResponse
import ru.t2sales.shared.api.TeamApi
import ru.t2sales.shared.navigation.Screen
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Radius
import ru.t2sales.shared.theme.T2Spacing

/**
 * Sidebar + the web's shell-main: app-header (avatar, breadcrumb, theme and
 * refresh buttons, "Сегодня"/"Точка" pills — index.html:301-323) above the
 * rounded .sheet that holds the page.
 */
@Composable
fun AppShell(
    selected: Screen,
    onSelect: (Screen) -> Unit,
    container: AppContainer,
    me: MeResponse,
    content: @Composable (Screen) -> Unit
) {
    val homeApi = container.homeApi
    val teamApi = container.teamApi
    val myEmployeeId = me.employee_id
    val canManage = me.role == "manager" || me.role == "admin" || me.is_manager == true
    var reload by remember { mutableStateOf(0) }
    LaunchedEffect(Unit) { CommandPalette.close() }
    var myDay by remember { mutableStateOf<MeDayResponse?>(null) }
    LaunchedEffect(reload) {
        runCatching { homeApi.getMyDay() }.onSuccess { myDay = it }
    }

    Row(modifier = Modifier.fillMaxSize()) {
        Sidebar(
            selected = selected,
            onSelect = onSelect,
            role = me.role ?: "employee",
            isManager = me.is_manager == true,
            // Matches --sidebar-width: 248px (styles.css:2262).
            modifier = Modifier.width(248.dp).fillMaxHeight()
        )
        Box(modifier = Modifier.fillMaxSize().background(T2Colors.surface2)) {
            if (selected == Screen.Chat) {
                Column(modifier = Modifier.fillMaxSize()) {
                    AppHeader(selected, myDay, teamApi, myEmployeeId, container.network, container.outbox, onRefresh = { reload++ })
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                            .background(T2Colors.bg)
                    ) { key(reload) { content(selected) } }
                }
            } else if (T2Colors.uiBeta) {
                // Beta UI 3.0: flat canvas, large title in the content, sticky glass bar on top (title fades in once the large one scrolls away)
                val scrollState = rememberScrollState()
                Box(modifier = Modifier.fillMaxSize().background(T2Colors.bg)) {
                    Column(modifier = Modifier.fillMaxSize().verticalScroll(scrollState)) {
                        Spacer(Modifier.height(BETA_BAR_HEIGHT))
                        Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
                            Column(modifier = Modifier.widthIn(max = 1200.dp).fillMaxWidth().padding(start = 24.dp, end = 24.dp, bottom = 96.dp)) {
                                BetaLargeTitle(selected, myDay)
                                ScreenEnter(selected) { key(reload, AddSaleState.refreshTick) { content(selected) } }
                            }
                        }
                    }
                    BetaBar(selected, scrollState.value, teamApi, myEmployeeId, container.network, container.outbox, onRefresh = { reload++ })
                    androidx.compose.foundation.VerticalScrollbar(
                        adapter = androidx.compose.foundation.rememberScrollbarAdapter(scrollState),
                        modifier = Modifier.align(Alignment.CenterEnd).fillMaxHeight()
                    )
                }
            } else {
                val scrollState = rememberScrollState()
                Box(modifier = Modifier.fillMaxSize()) {
                    Column(modifier = Modifier.fillMaxSize().verticalScroll(scrollState)) {
                        AppHeader(selected, myDay, teamApi, myEmployeeId, container.network, container.outbox, onRefresh = { reload++ })
                        Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
                            Column(
                                modifier = Modifier
                                    .widthIn(max = 1400.dp)
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                                    .background(T2Colors.bg)
                                    .padding(T2Spacing.sp4)
                            ) {
                                ScreenEnter(selected) { key(reload, AddSaleState.refreshTick) { content(selected) } }
                            }
                        }
                    }
                    androidx.compose.foundation.VerticalScrollbar(
                        adapter = androidx.compose.foundation.rememberScrollbarAdapter(scrollState),
                        modifier = Modifier.align(Alignment.CenterEnd).fillMaxHeight()
                    )
                }
            }
            if (selected != Screen.Chat) Fab(Modifier.align(Alignment.BottomEnd).padding(end = 24.dp, bottom = 24.dp)) { AddSaleState.open() }
            UpdateCard(container.updates, Modifier.align(Alignment.BottomStart).padding(start = 16.dp, bottom = 16.dp))
            ToastHost(Modifier.align(Alignment.BottomCenter).padding(bottom = 32.dp))
            CommandPaletteHost(container, me.role ?: "employee", me.is_manager == true, canManage, onRefresh = { reload++ })
            ru.t2sales.desktop.ui.tools.ToolDialogHost(container)
            ru.t2sales.desktop.ui.shift.ShiftDialogHost(container)
            if (AddSaleState.visible) {
                AddSaleDialog(
                    teamApi = teamApi,
                    scheduleApi = container.scheduleApi,
                    salesApi = container.salesApi,
                    outbox = container.outbox,
                    formCache = container.saleFormCache,
                    myEmployeeId = myEmployeeId,
                    myName = me.full_name,
                    canManage = canManage,
                    presetEmployeeId = AddSaleState.presetEmployeeId,
                    homeApi = homeApi,
                    onDismiss = { AddSaleState.visible = false }
                )
            }
        }
    }
}

@Composable
private fun AppHeader(selected: Screen, myDay: MeDayResponse?, teamApi: TeamApi, myEmployeeId: Int?, network: ru.t2sales.desktop.network.NetworkManager, outbox: ru.t2sales.desktop.offline.SalesOutbox, onRefresh: () -> Unit) {
    Column(modifier = Modifier.fillMaxWidth().background(T2Colors.bg).padding(horizontal = T2Spacing.sp4, vertical = T2Spacing.sp3)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            AvatarImage(teamApi, myEmployeeId, "T2", size = 44.dp)
            Spacer(Modifier.width(T2Spacing.sp3))
            Text(selected.label, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, color = T2Colors.text, modifier = Modifier.weight(1f))
            OutboxPill(outbox)
            NetworkIndicator(network)
            Spacer(Modifier.width(T2Spacing.sp2))
            HeaderButton("\u25D0") {
                ThemePrefs.auto = false // a hand-picked theme wins over "as in Windows"
                T2Colors.dark = !T2Colors.dark
                ThemePrefs.setDark(T2Colors.dark)
            }
            Spacer(Modifier.width(T2Spacing.sp2))
            HeaderButton("\u21BB", onRefresh)
        }
        Spacer(Modifier.padding(top = T2Spacing.sp3))
        Row(horizontalArrangement = Arrangement.spacedBy(T2Spacing.sp4)) {
            val today = remember { LocalDate.now(ZoneId.of("Europe/Moscow")) }
            Pill("Сегодня", today.format(DateTimeFormatter.ofPattern("dd.MM.yyyy")), null, Modifier.weight(1f))
            val shift = myDay?.shift
            val code = shift?.store_code ?: shift?.store_name
            if (code != null) Pill("Точка", code, shift?.store_address, Modifier.weight(1f))
        }
    }
}

@Composable
private fun Pill(label: String, value: String, sub: String?, modifier: Modifier) {
    val shape = RoundedCornerShape(T2Radius.md)
    Column(
        modifier = modifier
            .clip(shape)
            .background(T2Colors.surface)
            .border(1.dp, T2Colors.border, shape)
            .padding(horizontal = T2Spacing.sp4, vertical = T2Spacing.sp3)
    ) {
        Text(label.uppercase(), color = T2Colors.hint, fontWeight = FontWeight.SemiBold, fontSize = 11.sp, letterSpacing = 0.5.sp)
        Text(value, fontSize = 20.sp, fontWeight = FontWeight.Black, color = T2Colors.text)
        if (!sub.isNullOrBlank()) Text(sub, color = T2Colors.hint, fontSize = 12.sp)
    }
}

@Composable
private fun HeaderButton(label: String, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .size(44.dp)
            .clip(CircleShape)
            .background(T2Colors.surface)
            .border(1.dp, T2Colors.border, CircleShape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) { Text(label, color = T2Colors.text, style = MaterialTheme.typography.subtitle1) }
}

private val BETA_BAR_HEIGHT = 60.dp

/** Beta UI 3.0 large title: 34/700 with the date and the store as a lede (Home has its own greeting, so it skips this). */
@Composable
private fun BetaLargeTitle(selected: Screen, myDay: MeDayResponse?) {
    if (selected == Screen.Home) return
    val today = remember { LocalDate.now(ZoneId.of("Europe/Moscow")) }
    val date = today.format(DateTimeFormatter.ofPattern("EEEE, d MMMM", java.util.Locale("ru"))).replaceFirstChar { it.uppercase() }
    val store = myDay?.shift?.let { it.store_name ?: it.store_code }
    ru.t2sales.desktop.ui.components.LargeTitle(selected.label, listOfNotNull(date, store?.let { "«$it»" }).joinToString(", "))
}

/** Beta UI 3.0 header: a translucent bar that stays on top; the compact title appears after 56 px of scroll, like iOS. */
@Composable
private fun BetaBar(selected: Screen, scrolled: Int, teamApi: TeamApi, myEmployeeId: Int?, network: ru.t2sales.desktop.network.NetworkManager, outbox: ru.t2sales.desktop.offline.SalesOutbox, onRefresh: () -> Unit) {
    val titleAlpha by androidx.compose.animation.core.animateFloatAsState(
        if (scrolled > 56 || selected == Screen.Home && scrolled > 80) 1f else 0f,
        androidx.compose.animation.core.tween(ru.t2sales.shared.theme.T2Motion.short, easing = ru.t2sales.shared.theme.T2Motion.easeOut)
    )
    val glassy = scrolled > 4
    Column(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(BETA_BAR_HEIGHT)
                .background(if (glassy) T2Colors.glass else T2Colors.bg)
                .padding(horizontal = 24.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            AvatarImage(teamApi, myEmployeeId, "T2", size = 32.dp)
            Spacer(Modifier.width(T2Spacing.sp3))
            Text(
                selected.label, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = T2Colors.text,
                modifier = Modifier.weight(1f).graphicsLayer { alpha = titleAlpha }
            )
            OutboxPill(outbox)
            NetworkIndicator(network)
            Spacer(Modifier.width(T2Spacing.sp2))
            BetaIconButton(if (T2Colors.dark) "☾" else "☀", "Сменить тему") {
                ThemePrefs.auto = false
                T2Colors.dark = !T2Colors.dark
                ThemePrefs.setDark(T2Colors.dark)
            }
            Spacer(Modifier.width(T2Spacing.sp2))
            BetaIconButton("↻", "Обновить", onRefresh)
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(if (glassy) T2Colors.border else Color.Transparent))
    }
}

/** .ib: 36px round icon button on a cell, hit area padded to 44. */
@Composable
private fun BetaIconButton(glyph: String, label: String, onClick: () -> Unit) {
    val src = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }
    Box(Modifier.size(T2Spacing.hit).clip(CircleShape).clickable(interactionSource = src, indication = null, onClick = onClick), contentAlignment = Alignment.Center) {
        Box(
            Modifier.betaPress(src, 0.92f).size(36.dp).clip(CircleShape).background(T2Colors.surface).border(1.dp, T2Colors.border, CircleShape),
            contentAlignment = Alignment.Center
        ) { Text(glyph, color = T2Colors.text, fontSize = 16.sp) }
    }
}

/** The web's .fab (styles.css:735): 58px blue gradient "+" bottom-right. In the beta: flat [T2Colors.primary] with [T2Colors.onPrimary]. */
@Composable
private fun Fab(modifier: Modifier, onClick: () -> Unit) {
    if (T2Colors.uiBeta) {
        val src = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }
        Box(
            modifier = modifier
                .betaPress(src, 0.92f)
                .size(56.dp)
                .shadow(12.dp, CircleShape, ambientColor = Color.Black, spotColor = Color.Black)
                .clip(CircleShape)
                .background(T2Colors.primary)
                .clickable(interactionSource = src, indication = null, onClick = onClick),
            contentAlignment = Alignment.Center
        ) { Text("+", color = T2Colors.onPrimary, fontSize = 28.sp, fontWeight = FontWeight.Normal) }
        return
    }
    Box(
        modifier = modifier
            .size(58.dp)
            .shadow(14.dp, CircleShape, ambientColor = T2Colors.blue, spotColor = T2Colors.blue)
            .clip(CircleShape)
            .background(Brush.linearGradient(listOf(T2Colors.primary, T2Colors.blueDeep)))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) { Text("+", color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.Light) }
}

object ThemePrefs {
    private val prefs = java.util.prefs.Preferences.userRoot().node("ru/t2sales/desktop")
    fun isDark() = prefs.getBoolean("dark", true)
    fun setDark(value: Boolean) = prefs.putBoolean("dark", value)

    private var autoState by mutableStateOf(prefs.getBoolean("themeAuto", false))

    /** The theme follows Windows (light or dark as the system is). Choosing a theme by hand switches this off. */
    var auto: Boolean
        get() = autoState
        set(v) { autoState = v; prefs.putBoolean("themeAuto", v) }

    /** Beta UI 3.0 «Ночная смена»: off by default, like the web; turned on in Профиль or the command palette. */
    fun isUiBeta() = prefs.getBoolean("uiBeta", false)
    fun setUiBeta(value: Boolean) { T2Colors.uiBeta = value; prefs.putBoolean("uiBeta", value) }
}

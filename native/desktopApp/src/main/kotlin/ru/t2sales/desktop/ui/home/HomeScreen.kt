package ru.t2sales.desktop.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.CircularProgressIndicator
import ru.t2sales.desktop.ui.components.SkeletonBlock
import ru.t2sales.desktop.ui.components.animatedFloat
import ru.t2sales.desktop.ui.components.animatedInt
import ru.t2sales.desktop.ui.components.reveal
import androidx.compose.material.Icon
import androidx.compose.material.MaterialTheme
import androidx.compose.material.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Assignment
import androidx.compose.material.icons.outlined.Calculate
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.EmojiEvents
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Insights
import androidx.compose.material.icons.outlined.LocalOffer
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.PointOfSale
import androidx.compose.material.icons.outlined.School
import androidx.compose.material.icons.outlined.Sensors
import androidx.compose.material.icons.outlined.Store
import androidx.compose.material.icons.outlined.SupportAgent
import androidx.compose.material.icons.outlined.Timeline
import androidx.compose.material.icons.outlined.TrendingUp
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.text.NumberFormat
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.Locale
import kotlin.math.roundToInt
import kotlinx.coroutines.launch
import ru.t2sales.desktop.di.AppContainer
import ru.t2sales.desktop.ui.components.SheetDialog
import ru.t2sales.desktop.ui.components.T2Toast
import ru.t2sales.desktop.ui.components.MainButton
import ru.t2sales.desktop.ui.sales.AddSaleState
import ru.t2sales.shared.api.DashboardLeaderRow
import ru.t2sales.shared.api.MeDayResponse
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.api.SupervisorHealthResponse
import ru.t2sales.shared.navigation.Screen
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Radius
import ru.t2sales.shared.theme.T2Spacing

private val MOSCOW = ZoneId.of("Europe/Moscow")
private val APP_VERSION = ru.t2sales.desktop.update.AppVersion.current

private val METRIC_SHORT_LABEL = mapOf(
    "sim" to "SIM", "mnp" to "MNP", "pa" to "ПА", "combo" to "Комбо", "phones" to "Тел", "accessories" to "Аксы",
    "settings" to "Доп", "insurance" to "Страх", "wink" to "Wink", "shpd" to "ШПД", "focus" to "ФО",
    "credit_request" to "Кр.з", "credit_issued" to "Кр.в", "plotter" to "Плот", "hb" to "НВ"
)
private fun metricShort(id: String) = METRIC_SHORT_LABEL[id] ?: id

private val ROLE_LABELS = mapOf(
    "trainee" to "Стажёр", "employee" to "Продавец", "senior" to "Старший продавец",
    "manager" to "Руководитель", "supervisor" to "Супервайзер", "admin" to "Администратор"
)

private fun greetingByHour(): String {
    val h = ZonedDateTime.now(MOSCOW).hour
    return when {
        h < 6 -> "Доброй ночи"
        h < 12 -> "Доброе утро"
        h < 18 -> "Добрый день"
        else -> "Добрый вечер"
    }
}

/** Port of the desktop dashboard of pages/home + index.html #page-home (≥1200px layout). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun HomeScreen(container: AppContainer, me: MeResponse, onNavigate: (Screen) -> Unit) {
    val role = me.role
    val viewModel = remember { HomeViewModel(container.homeApi, container.reportsApi, container.readCache) }
    var uiState by remember { mutableStateOf<HomeUiState>(HomeUiState.Loading) }
    var shiftOpen by remember { mutableStateOf<Boolean?>(null) }
    var replacementOpen by remember { mutableStateOf(false) }
    var daysOffText by remember { mutableStateOf("Внеси продажу — начни стрик") }
    var about by remember { mutableStateOf(false) }
    var refresh by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(role, refresh) {
        // the last saved copy first (instant), then the fresh data replaces it
        if (uiState is HomeUiState.Loading) viewModel.cachedContent(role)?.let { uiState = it }
        uiState = viewModel.load(role)
    }
    LaunchedEffect(Unit) {
        val today = LocalDate.now(MOSCOW)
        val cur = runCatching { container.profileApi.getShiftCurrent() }.getOrNull()
        if (cur != null) { shiftOpen = cur.session != null; replacementOpen = cur.session?.work_mode == "REPLACEMENT" }
        val sch = runCatching { container.scheduleApi.getScheduleMonth(today.toString().take(7)) }.getOrNull()
        if (sch != null && me.employee_id != null) {
            val work = sch.items.filter { it.employee_id == me.employee_id && (it.hours ?: 0.0) > 0 }.map { it.work_date.take(10) }.toSet()
            var until: Int? = null
            for (i in 0..31) {
                if (today.plusDays(i.toLong()).toString() !in work) { until = i; break }
            }
            daysOffText = when (until) {
                0 -> "Сегодня выходной"
                null -> "Внеси продажу — начни стрик"
                else -> "$until дн. до выходного"
            }
        }
    }

    val firstName = me.full_name?.split(" ")?.let { it.getOrNull(1) ?: it.getOrNull(0) } ?: "команда"
    Box(Modifier.reveal(0)) { Greeting(firstName, role, shiftOpen, daysOffText) }
    Spacer(Modifier.height(T2Spacing.sp4))

    when (val state = uiState) {
        HomeUiState.Loading -> HomeSkeleton()
        is HomeUiState.Content -> {
            val t = state.networkTotals
            state.staleSince?.let { at ->
                val shown = java.time.format.DateTimeFormatter.ofPattern("dd.MM HH:mm").format(at.atZone(MOSCOW))
                Text("Нет связи с сервером: показаны данные от $shown", color = T2Colors.warning, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(bottom = 10.dp))
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(T2Spacing.sp3), verticalArrangement = Arrangement.spacedBy(T2Spacing.sp3), maxItemsInEachRow = 6) {
                listOf("SIM" to t.sim, "MNP" to t.mnp, "ПА" to t.pa, "Комбо" to t.combo, "Телефоны" to t.phones, "Аксы" to t.accessories).forEachIndexed { i, (l, v) ->
                    StatChip(l, v.roundToInt(), Modifier.weight(1f).reveal(1 + i, 45))
                }
            }
            Spacer(Modifier.height(T2Spacing.sp4))

            BoxWithConstraints {
                val twoCols = maxWidth >= 680.dp
                val left: @Composable () -> Unit = {
                    Box(Modifier.reveal(3)) { MyDaySection(state.myDay, shiftOpen, replacementOpen, container, onNavigate, onTaskDone = { refresh++ }) }
                    Spacer(Modifier.height(T2Spacing.sp4))
                    Box(Modifier.reveal(4)) { PaceSection(state.myDay, container) }
                    Spacer(Modifier.height(T2Spacing.sp4))
                    Box(Modifier.reveal(5)) { TopLeadersSection(state.topLeaders) { onNavigate(Screen.Team) } }
                }
                val right: @Composable () -> Unit = {
                    Box(Modifier.reveal(4)) { NetworkPulseSection(t) }
                    if (state.showAnalytics) {
                        Spacer(Modifier.height(T2Spacing.sp4))
                        Box(Modifier.reveal(6)) { CommandCenterSection(state.health) { onNavigate(Screen.CommandCenter) } }
                    }
                    Spacer(Modifier.height(T2Spacing.sp4))
                    Box(Modifier.reveal(7)) { CalcSection() }
                    Spacer(Modifier.height(T2Spacing.sp4))
                    Box(Modifier.reveal(8)) { QuickActionsSection(onNavigate) }
                }
                if (twoCols) {
                    Row(horizontalArrangement = Arrangement.spacedBy(T2Spacing.sp4), verticalAlignment = Alignment.Top) {
                        Column(modifier = Modifier.weight(1f)) { left() }
                        Column(modifier = Modifier.weight(1f)) { right() }
                    }
                } else {
                    Column { left(); Spacer(Modifier.height(T2Spacing.sp4)); right() }
                }
            }
            Spacer(Modifier.height(T2Spacing.sp4))
            Box(Modifier.reveal(9)) { ToolsSection(onNavigate, onAbout = { about = true }) }
        }
    }

    if (about) AboutDialog(container) { about = false }
}

/** Placeholder while the dashboard loads: the same layout, shimmering, instead of a spinner. */
@Composable
private fun HomeSkeleton() {
    Column(verticalArrangement = Arrangement.spacedBy(T2Spacing.sp3)) {
        Row(horizontalArrangement = Arrangement.spacedBy(T2Spacing.sp3)) {
            repeat(6) { SkeletonBlock(Modifier.weight(1f).height(64.dp), 12.dp) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(T2Spacing.sp4)) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(T2Spacing.sp4)) {
                SkeletonBlock(Modifier.fillMaxWidth().height(220.dp), 20.dp)
                SkeletonBlock(Modifier.fillMaxWidth().height(180.dp), 20.dp)
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(T2Spacing.sp4)) {
                SkeletonBlock(Modifier.fillMaxWidth().height(110.dp), 20.dp)
                SkeletonBlock(Modifier.fillMaxWidth().height(160.dp), 20.dp)
                SkeletonBlock(Modifier.fillMaxWidth().height(120.dp), 20.dp)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Greeting(firstName: String, role: String?, shiftOpen: Boolean?, daysOff: String) {
    val shape = RoundedCornerShape(T2Radius.default)
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(Brush.linearGradient(listOf(Color(0xFF0A0A0B), Color(0xFF12121A), Color(0xFF0C1A28))))
            .border(1.dp, Color(0x0FFFFFFF), shape)
            .padding(T2Spacing.sp4)
    ) {
        Column {
            Text(greetingByHour(), color = Color(0xBFFFFFFF), fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Text(firstName, color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(bottom = 10.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                GreetBadge("T2 Sales v$APP_VERSION")
                GreetBadge(daysOff)
                if (role != null) GreetBadge(ROLE_LABELS[role] ?: role)
            }
        }
        if (shiftOpen != null) {
            val open = shiftOpen
            val fg = if (open) Color(0xFF34C759) else Color(0xBFFFFFFF)
            Row(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .clip(RoundedCornerShape(20.dp))
                    .background(if (open) Color(0x3334C759) else Color(0x1AFFFFFF))
                    .border(1.dp, if (open) Color(0x5234C759) else Color(0x1FFFFFFF), RoundedCornerShape(20.dp))
                    .padding(start = 8.dp, end = 10.dp, top = 5.dp, bottom = 5.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(Modifier.size(7.dp).clip(CircleShape).background(if (open) Color(0xFF34C759) else Color(0x59FFFFFF)))
                Spacer(Modifier.width(6.dp))
                Text(if (open) "Смена открыта" else "Смена закрыта", color = fg, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun GreetBadge(text: String) {
    Text(
        text,
        color = Color.White,
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier
            .clip(RoundedCornerShape(20.dp))
            .background(Color(0x1FFFFFFF))
            .border(1.dp, Color(0x1AFFFFFF), RoundedCornerShape(20.dp))
            .padding(horizontal = 10.dp, vertical = 5.dp)
    )
}

@Composable
private fun StatChip(label: String, value: Int, modifier: Modifier) {
    val shape = RoundedCornerShape(T2Radius.sm)
    val shown = animatedInt(value)
    Column(
        modifier = modifier.clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape).padding(horizontal = 8.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(shown.toString(), fontSize = 20.sp, fontWeight = FontWeight.Black)
        Text(label.uppercase(), color = T2Colors.hint, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.4.sp, modifier = Modifier.padding(top = 3.dp))
    }
}

/** The web's .section: surface card, radius 20, border, uppercase title. */
@Composable
internal fun Section(title: String, content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(T2Radius.default)
    Column(
        modifier = Modifier.fillMaxWidth().clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape).padding(vertical = 6.dp)
    ) {
        Text(
            title.uppercase(),
            color = T2Colors.hint,
            fontWeight = FontWeight.Bold,
            fontSize = 11.sp,
            letterSpacing = 0.7.sp,
            modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 8.dp)
        )
        content()
    }
}

@Composable
private fun ListRow(icon: ImageVector?, iconText: String? = null, title: String, sub: String?, value: String? = null, chevron: Boolean = true, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        val shape = RoundedCornerShape(T2Radius.sm)
        Box(
            modifier = Modifier.size(42.dp).clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape),
            contentAlignment = Alignment.Center
        ) {
            if (icon != null) Icon(icon, contentDescription = null, tint = T2Colors.textSecondary, modifier = Modifier.size(20.dp))
            else Text(iconText ?: "", color = T2Colors.textSecondary, fontSize = 16.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.width(T2Spacing.sp3))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
            if (sub != null) Text(sub, color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp))
        }
        if (value != null) Text(value, fontSize = 15.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 8.dp))
        if (chevron) Text("›", color = T2Colors.hint, fontSize = 18.sp, modifier = Modifier.padding(start = 8.dp))
    }
}

@Composable
private fun MyDaySection(myDay: MeDayResponse?, shiftOpen: Boolean?, replacement: Boolean, container: AppContainer, onNavigate: (Screen) -> Unit, onTaskDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    Section("Мой день") {
        when {
            myDay == null -> Text("Не удалось загрузить «Мой день»", color = T2Colors.hint, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
            !myDay.bound -> Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                Text("Аккаунт не привязан", color = T2Colors.hint)
                Spacer(Modifier.height(8.dp))
                MainButton("Привязать себя", enabled = true) { onNavigate(Screen.Profile) }
            }
            else -> {
                val shift = myDay.shift
                Column(modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 10.dp)) {
                    if (shift != null && replacement) Text("ТОЧКА ЗАМЕНЫ", color = T2Colors.hint, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    Text(shift?.let { it.store_code ?: it.store_name ?: "" } ?: "Выходной", fontSize = 15.sp, fontWeight = FontWeight.Bold)
                    val addr = shift?.store_address
                    if (!addr.isNullOrBlank()) Text(addr, color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp))
                    if (shift != null && replacement) Text(
                        "Замена · другая сеть",
                        color = Color.White,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(top = 4.dp).clip(RoundedCornerShape(8.dp)).background(T2Colors.accent).padding(horizontal = 8.dp, vertical = 2.dp)
                    )
                    if (shiftOpen == false) {
                        Text(
                            "Сменить точку",
                            color = T2Colors.onAccent,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier
                                .padding(top = 6.dp)
                                .clip(RoundedCornerShape(T2Radius.md))
                                .background(T2Colors.accent)
                                .clickable { ru.t2sales.desktop.ui.shift.ShiftUi.changeStore = true }
                                .padding(horizontal = 12.dp, vertical = 6.dp)
                        )
                    } else if (shiftOpen == true) {
                        Text("Закройте смену, чтобы сменить точку", color = T2Colors.hint, fontSize = 11.sp, modifier = Modifier.padding(top = 6.dp))
                    }
                }
                Column(modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 14.dp)) {
                    if (shift != null) {
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 10.dp)) {
                            val shape = RoundedCornerShape(T2Radius.sm)
                            Box(
                                modifier = Modifier.size(42.dp).clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape),
                                contentAlignment = Alignment.Center
                            ) { Icon(Icons.Outlined.Store, contentDescription = null, tint = T2Colors.textSecondary, modifier = Modifier.size(20.dp)) }
                            Spacer(Modifier.width(T2Spacing.sp3))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(shift.store_name ?: "Точка", fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                                Text("${shift.shift_text ?: ""} · ${shift.hours?.let { "${it.roundToInt()}" } ?: ""}ч", color = T2Colors.hint, fontSize = 13.sp)
                            }
                            Text("${(myDay.total?.pct ?: 0.0).roundToInt()}%", fontSize = 15.sp, fontWeight = FontWeight.Bold)
                        }
                    } else {
                        Text("Сегодня выходной / нет в графике", color = T2Colors.hint, modifier = Modifier.padding(bottom = 10.dp))
                    }
                    myDay.progress?.filterValues { it.plan > 0 }?.forEach { (metric, entry) ->
                        ProgressRow(metricShort(metric), entry.fact, entry.plan)
                    }
                    Spacer(Modifier.height(8.dp))
                    MainButton("+ Продажа", enabled = true) { AddSaleState.open() }
                }
                val tasks = myDay.tasks.orEmpty()
                if (tasks.isNotEmpty()) {
                    Text("МОИ ЗАДАЧИ", color = T2Colors.hint, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.7.sp, modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 4.dp))
                    tasks.forEach { task ->
                        val sub = listOfNotNull(task.store_name?.takeIf { it.isNotBlank() }, if (task.status == "in_progress") "В работе" else "Открыта", task.due_at?.let { "до ${it.take(10)}" }).joinToString(" · ")
                        Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            val shape = RoundedCornerShape(T2Radius.sm)
                            Box(
                                modifier = Modifier.size(42.dp).clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape),
                                contentAlignment = Alignment.Center
                            ) { Icon(Icons.Outlined.Assignment, contentDescription = null, tint = T2Colors.textSecondary, modifier = Modifier.size(20.dp)) }
                            Spacer(Modifier.width(T2Spacing.sp3))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(task.title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                                Text(sub, color = T2Colors.hint, fontSize = 13.sp)
                            }
                            val chipShape = RoundedCornerShape(12.dp)
                            Text(
                                "Готово",
                                fontWeight = FontWeight.Bold,
                                fontSize = 13.sp,
                                modifier = Modifier
                                    .clip(chipShape).background(T2Colors.surface2).border(1.dp, T2Colors.border, chipShape)
                                    .clickable {
                                        scope.launch {
                                            runCatching { container.tasksApi.changeStatus(task.id, "done") }
                                                .onSuccess { T2Toast.show("Задача выполнена"); onTaskDone() }
                                                .onFailure { T2Toast.show("Не удалось отметить задачу", true) }
                                        }
                                    }
                                    .padding(horizontal = 12.dp, vertical = 12.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun pctTone(percent: Int): Color = when {
    percent >= 100 -> T2Colors.success
    percent >= 70 -> T2Colors.warning
    else -> T2Colors.danger
}

@Composable
fun ProgressRow(label: String, fact: Double, plan: Double) {
    val percent = if (plan > 0) ((fact / plan) * 100).roundToInt() else if (fact > 0) 100 else 0
    val width = percent.coerceIn(0, 100)
    val filled = animatedFloat(width / 100f, 900)          // the bar grows to its value
    val shownFact = animatedInt(fact.roundToInt(), 900)    // and the numbers settle with it
    val shownPct = animatedInt(percent, 900)
    Column(modifier = Modifier.padding(vertical = T2Spacing.sp1)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.body2)
            Text(
                "$shownFact / ${plan.roundToInt()}" + if (plan > 0) " · $shownPct%" else "",
                color = T2Colors.hint,
                style = MaterialTheme.typography.body2
            )
        }
        Box(modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(99.dp)).background(T2Colors.surface3)) {
            Box(modifier = Modifier.fillMaxWidth(filled.coerceIn(0f, 1f)).height(6.dp).clip(RoundedCornerShape(99.dp)).background(pctTone(percent)))
        }
    }
}

@Composable
private fun TopLeadersSection(leaders: List<DashboardLeaderRow>, onOpen: () -> Unit) {
    Section("Топ за 7 дней") {
        if (leaders.isEmpty()) {
            Text("Нет данных за 7 дней", color = T2Colors.hint, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
            return@Section
        }
        val medals = listOf("🥇", "🥈", "🥉")
        leaders.take(7).forEachIndexed { i, row ->
            val total = row.sim + row.mnp + row.pa + row.combo
            ListRow(null, medals.getOrNull(i) ?: (i + 1).toString(), row.full_name, "SIM ${row.sim.roundToInt()} · MNP ${row.mnp.roundToInt()} · ПА ${row.pa.roundToInt()}", total.roundToInt().toString(), true, onOpen)
        }
    }
}

@Composable
private fun NetworkPulseSection(t: NetworkTotals) {
    val nf = NumberFormat.getInstance(Locale("ru", "RU"))
    Section("Сеть сегодня") {
        Row(
            modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            PulseChip("Единицы", t.units.roundToInt(), { it.toString() }, Modifier.weight(1f))
            PulseChip("${metricShort("phones")} ₽", t.phones.roundToInt(), { nf.format(it) }, Modifier.weight(1f))
            PulseChip("${metricShort("accessories")} ₽", t.accessories.roundToInt(), { nf.format(it) }, Modifier.weight(1f))
        }
    }
}

@Composable
private fun PulseChip(label: String, value: Int, format: (Int) -> String, modifier: Modifier) {
    val shown = animatedInt(value)
    Column(modifier = modifier.clip(RoundedCornerShape(12.dp)).background(T2Colors.surface2).padding(horizontal = 12.dp, vertical = 10.dp)) {
        Text(label.uppercase(), color = T2Colors.hint, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.3.sp)
        Text(format(shown), fontSize = 16.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(top = 2.dp))
    }
}

@Composable
private fun CommandCenterSection(health: SupervisorHealthResponse?, onOpen: () -> Unit) {
    Section("Сеть за минуту") {
        if (health == null) {
            Text("Недоступно", color = T2Colors.hint, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
            return@Section
        }
        Column(modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 10.dp)) {
            val tone = when {
                health.health >= 75 -> Color(0xFF30D158)
                health.health >= 45 -> Color(0xFFFF9F0A)
                else -> Color(0xFFFF453A)
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Box(
                    modifier = Modifier.size(52.dp).clip(CircleShape).background(tone.copy(alpha = 0.13f)).border(2.dp, tone.copy(alpha = 0.27f), CircleShape),
                    contentAlignment = Alignment.Center
                ) { Text(health.health.roundToInt().toString(), color = tone, fontWeight = FontWeight.ExtraBold, fontSize = 18.sp) }
                Column(modifier = Modifier.weight(1f)) {
                    Text("${health.overall_pct.roundToInt()}% план дня", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    val pace = health.pace_delta.roundToInt()
                    Text((if (pace >= 0) "+$pace" else "$pace") + "% к темпу дня", color = if (pace >= 0) T2Colors.success else T2Colors.danger, fontSize = 13.sp)
                }
                Text("›", color = T2Colors.hint, fontSize = 20.sp, modifier = Modifier.clickable(onClick = onOpen))
            }
            if (health.drops.isEmpty()) {
                Text("Критических просадок нет — сеть в ритме", color = T2Colors.hint, modifier = Modifier.padding(top = 10.dp))
            } else {
                health.drops.take(3).forEach { d ->
                    val warn = d.severity != "critical"
                    val c = if (warn) Color(0xFFFF9F0A) else Color(0xFFFF453A)
                    val shape = RoundedCornerShape(16.dp)
                    Row(
                        modifier = Modifier
                            .padding(top = 8.dp)
                            .fillMaxWidth()
                            .clip(shape)
                            .background(Brush.linearGradient(listOf(c.copy(alpha = 0.12f), c.copy(alpha = 0.04f))))
                            .border(1.dp, c.copy(alpha = if (warn) 0.30f else 0.25f), shape)
                            .padding(horizontal = 14.dp, vertical = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Text(if (warn) "⚠️" else "🔴", fontSize = 18.sp)
                        Column(modifier = Modifier.weight(1f)) {
                            Text(d.store_name ?: "Точка", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                            Text(d.message ?: "", color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp))
                            if (!d.ai_comment.isNullOrBlank()) {
                                Text("✨ ${d.ai_comment}", color = T2Colors.hint, fontSize = 12.sp, fontStyle = FontStyle.Italic, modifier = Modifier.padding(top = 4.dp))
                            }
                            if (d.store_id != null) {
                                val chip = RoundedCornerShape(12.dp)
                                Text(
                                    "Предложить перенос",
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 13.sp,
                                    modifier = Modifier
                                        .padding(top = 6.dp)
                                        .clip(chip).background(T2Colors.surface2).border(1.dp, T2Colors.border, chip)
                                        .clickable { ru.t2sales.desktop.ui.shell.AppNav.proposeMove(d.store_id ?: "") }
                                        .padding(horizontal = 12.dp, vertical = 10.dp)
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CalcSection() {
    Section("Калькуляторы") {
        Row(modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            MChip("Комбо", Icons.Outlined.Calculate, Modifier.weight(1f)) { ru.t2sales.desktop.ui.tools.ToolDialogs.open("combo") }
            MChip("Школа", Icons.Outlined.School, Modifier.weight(1f)) { ru.t2sales.desktop.ui.tools.ToolDialogs.open("school") }
        }
        Box(modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp)) {
            MChip("Промокоды РТК", Icons.Outlined.LocalOffer, Modifier.fillMaxWidth()) { ru.t2sales.desktop.ui.tools.ToolDialogs.open("promos") }
        }
    }
}

@Composable
private fun MChip(label: String, icon: ImageVector, modifier: Modifier, onClick: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Row(
        modifier = modifier.clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape).clickable(onClick = onClick).padding(vertical = 12.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(icon, contentDescription = null, tint = T2Colors.text, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(6.dp))
        Text(label, fontWeight = FontWeight.Bold, fontSize = 13.sp)
    }
}

@Composable
private fun QuickActionsSection(onNavigate: (Screen) -> Unit) {
    Section("Быстрые действия") {
        ListRow(Icons.Outlined.PointOfSale, null, "Касса", "Факт / 1С / плюс-минус по точкам") { onNavigate(Screen.Cash) }
        ListRow(Icons.Outlined.CalendarMonth, null, "Планы и факт за месяц", "видно всей команде") { onNavigate(Screen.MonthPlan) }
        ListRow(Icons.Outlined.TrendingUp, null, "Динамика выполнения", "все метрики · сотрудники и точки") { onNavigate(Screen.NetMonth) }
        ListRow(Icons.Outlined.SupportAgent, null, "Поддержка", null) { onNavigate(Screen.Support) }
    }
}

@Composable
private fun ToolsSection(onNavigate: (Screen) -> Unit, onAbout: () -> Unit) {
    Section("Инструменты") {
        ListRow(Icons.Outlined.EmojiEvents, null, "BFQ", "Рейтинг качества за месяц") { onNavigate(Screen.Bfq) }
        ListRow(Icons.Outlined.Calculate, null, "Расчёт комбо", "Телефон − скидка + 28% + 1950") { ru.t2sales.desktop.ui.tools.ToolDialogs.open("combo") }
        ListRow(Icons.Outlined.School, null, "Калькулятор школа", "Телефон − 70% + 30% + 3600 + 3490") { ru.t2sales.desktop.ui.tools.ToolDialogs.open("school") }
        ListRow(Icons.Outlined.LocalOffer, null, "Промокоды РТК", "Общий пул · скрытый список") { ru.t2sales.desktop.ui.tools.ToolDialogs.open("promos") }
        ListRow(Icons.Outlined.GridView, null, "Heatmap часов", "Когда ставить сильного") { onNavigate(Screen.Heatmap) }
        ListRow(Icons.Outlined.TrendingUp, null, "Повтор месяца", "Гонка сотрудников по дням") { onNavigate(Screen.Replay) }
        ListRow(Icons.Outlined.Timeline, null, "Прогноз и what-if", "7 дней · сценарии смен") { onNavigate(Screen.Forecast) }
        ListRow(Icons.Outlined.Campaign, null, "Объявления", "Прочитал · обязательно") { onNavigate(Screen.Announce) }
        ListRow(Icons.Outlined.Image, null, "Отчёт-картинка", "SVG итог дня") { onNavigate(Screen.ReportImg) }
        ListRow(Icons.Outlined.Description, null, "Отчёты", "Сводка по сети · экспорт") { onNavigate(Screen.Reports) }
        ListRow(Icons.Outlined.Sensors, null, "Сеть live", "Кто на смене · % плана · касса") { onNavigate(Screen.Live) }
        ListRow(Icons.Outlined.Insights, null, "Command Center", "Что происходит · где проблема · что делать") { onNavigate(Screen.CommandCenter) }
        ListRow(Icons.Outlined.Assignment, null, "Задачи", "Кто что делает по сети") { onNavigate(Screen.Tasks) }
        ListRow(Icons.Outlined.NotificationsActive, null, "Алерты", "Полный жизненный цикл, не только открытые") { onNavigate(Screen.Alerts) }
        ListRow(Icons.Outlined.Info, null, "О приложении", "T2 Sales v$APP_VERSION", onClick = onAbout)
    }
}

@Composable
private fun AboutDialog(container: AppContainer, onDismiss: () -> Unit) {
    val updates = container.updates
    val scope = rememberCoroutineScope()
    SheetDialog("О приложении", onDismiss) {
        Text("T2 Sales", fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
        Text("версия $APP_VERSION · десктоп · МСК", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(bottom = 14.dp))
        listOf(
            "Личный кабинет · мульти-метрики · BFQ\nПланы месяца · график · задачи\nКасса: Δ = факт − (1С + 2000)\nПромокоды РТК · поддержка · роли",
            "Стек\nKotlin Multiplatform · Compose Desktop · Ktor",
            "Точки\nКосмонавтов 20А · Калинина 2 · Калинина 11"
        ).forEach { block ->
            Text(block, fontSize = 13.sp, color = T2Colors.textSecondary, modifier = Modifier.padding(bottom = 12.dp))
        }
        val st = updates.status
        val updateLine = when (st.state) {
            ru.t2sales.desktop.update.UpdateState.NotConfigured -> "Проверка обновлений отключена (запуск для разработки)"
            ru.t2sales.desktop.update.UpdateState.Checking -> "Проверяем обновления…"
            ru.t2sales.desktop.update.UpdateState.UpToDate -> "Установлена последняя версия" + (st.lastCheckedAt?.let { " · проверено " + it.replace('T', ' ').take(16) } ?: "")
            ru.t2sales.desktop.update.UpdateState.UpdateAvailable -> "Доступна версия ${st.availableManifest?.version} — карточка обновления слева внизу"
            ru.t2sales.desktop.update.UpdateState.Downloading, ru.t2sales.desktop.update.UpdateState.Verifying -> "Загружаем обновление…"
            ru.t2sales.desktop.update.UpdateState.ReadyToInstall -> "Обновление готово к установке"
            ru.t2sales.desktop.update.UpdateState.Error -> st.errorMessage ?: "Ошибка обновления"
        }
        Text(updateLine, color = T2Colors.textSecondary, fontSize = 13.sp, modifier = Modifier.padding(bottom = 12.dp))
        if (st.state != ru.t2sales.desktop.update.UpdateState.NotConfigured) {
            MainButton("Проверить обновления", enabled = st.state != ru.t2sales.desktop.update.UpdateState.Checking) { scope.launch { updates.checkNow() } }
            Spacer(Modifier.height(8.dp))
        }
        MainButton("Закрыть", enabled = true, onClick = onDismiss)
        Spacer(Modifier.height(8.dp))
        MainButton("Сохранить диагностику на рабочий стол", enabled = true) {
            runCatching { ru.t2sales.desktop.support.Diagnostics.export(container) }
                .onSuccess { ru.t2sales.desktop.ui.components.T2Toast.show("Сохранено на рабочем столе: ${it.fileName}") }
                .onFailure { ru.t2sales.desktop.ui.components.T2Toast.show("Не удалось сохранить диагностику", true) }
        }
    }
}

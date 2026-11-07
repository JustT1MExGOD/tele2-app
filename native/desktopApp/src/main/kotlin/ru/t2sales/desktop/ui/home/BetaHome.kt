package ru.t2sales.desktop.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Analytics
import androidx.compose.material.icons.outlined.Assignment
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Calculate
import androidx.compose.material.icons.outlined.EmojiEvents
import androidx.compose.material.icons.outlined.FlashOn
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.PointOfSale
import androidx.compose.material.icons.outlined.Receipt
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material.icons.outlined.Sensors
import androidx.compose.material.icons.outlined.Store
import androidx.compose.material.icons.outlined.SwapHoriz
import androidx.compose.material.icons.outlined.Terminal
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
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.text.NumberFormat
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt
import kotlinx.coroutines.launch
import ru.t2sales.desktop.di.AppContainer
import ru.t2sales.desktop.ui.components.BetaCell
import ru.t2sales.desktop.ui.components.BetaHero
import ru.t2sales.desktop.ui.components.BetaPie
import ru.t2sales.desktop.ui.components.BetaRing
import ru.t2sales.desktop.ui.components.BetaTile
import ru.t2sales.desktop.ui.components.Group
import ru.t2sales.desktop.ui.components.GroupHead
import ru.t2sales.desktop.ui.components.GroupSeparator
import ru.t2sales.desktop.ui.components.HeroNumber
import ru.t2sales.desktop.ui.components.LargeTitle
import ru.t2sales.desktop.ui.components.RoundAction
import ru.t2sales.desktop.ui.components.SkeletonBlock
import ru.t2sales.desktop.ui.components.Sparkline
import ru.t2sales.desktop.ui.components.T2Toast
import ru.t2sales.desktop.ui.components.animatedInt
import ru.t2sales.desktop.ui.components.betaTone
import ru.t2sales.desktop.ui.components.reveal
import ru.t2sales.desktop.ui.sales.AddSaleState
import ru.t2sales.shared.api.HistorySale
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.navigation.Screen
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Hero

private val MSK = ZoneId.of("Europe/Moscow")
private val NFR = NumberFormat.getInstance(Locale("ru", "RU"))

private val BETA_METRIC = mapOf(
    "sim" to "SIM", "mnp" to "MNP", "pa" to "ПА", "combo" to "Комбо", "phones" to "Телефоны", "accessories" to "Аксессуары",
    "settings" to "Настройки", "insurance" to "Страховки", "wink" to "Wink", "shpd" to "ШПД", "focus" to "ФО",
    "credit_request" to "Кредит з.", "credit_issued" to "Кредит в.", "plotter" to "Плоттер", "hb" to "НВ"
)
/** Money metrics are shown as an accessory-style bar row, not a ring (the mock: «Аксессуары 8 420 из 12 000 ₽»). */
/** What «12 из 16» counts: the same unit metrics as NetworkTotals.units. */
private val HERO_UNITS = setOf("sim", "mnp", "pa", "combo")
private val MONEY = setOf("phones", "accessories", "settings", "insurance", "wink", "focus", "credit_issued")

/**
 * Beta UI 3.0 «Мой день» (design-system/ui3/v5-team, frame 1): large greeting, hero mesh card with today's
 * fact/plan and a sparkline, round quick actions, plan rings, the day feed, the network today.
 */
@Composable
internal fun BetaHome(
    uiState: HomeUiState,
    firstName: String,
    shiftOpen: Boolean?,
    container: AppContainer,
    me: MeResponse,
    onNavigate: (Screen) -> Unit,
    onTaskDone: () -> Unit,
    onAbout: () -> Unit
) {
    val today = remember { LocalDate.now(MSK) }
    var feed by remember { mutableStateOf<List<HistorySale>?>(null) }
    LaunchedEffect(me.employee_id) {
        runCatching { container.salesApi.getHistory(today.minusDays(1).toString(), today.toString(), me.employee_id) }
            .onSuccess { feed = it.items }.onFailure { feed = emptyList() }
    }

    val state = uiState as? HomeUiState.Content
    val myDay = state?.myDay
    val shift = myDay?.shift
    val date = today.format(DateTimeFormatter.ofPattern("EEEE, d MMMM", Locale("ru"))).replaceFirstChar { it.uppercase() }
    val lede = listOfNotNull(date, shift?.let { "«${it.store_name ?: it.store_code ?: ""}»" }, shift?.shift_text?.takeIf { it.isNotBlank() }?.let { "смена $it" })
        .joinToString(", ") + if (shift == null && myDay?.bound == true) ", выходной" else ""
    Box(Modifier.reveal(0)) { LargeTitle("Привет, $firstName", lede) }

    if (state == null) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SkeletonBlock(Modifier.fillMaxWidth().height(190.dp), 22.dp)
            SkeletonBlock(Modifier.fillMaxWidth().height(80.dp), 22.dp)
            SkeletonBlock(Modifier.fillMaxWidth().height(160.dp), 22.dp)
        }
        return
    }
    state.staleSince?.let { at ->
        Text("Нет связи с сервером: данные от ${DateTimeFormatter.ofPattern("dd.MM HH:mm").format(at.atZone(MSK))}", color = T2Colors.warning, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 4.dp, bottom = 10.dp))
    }

    BoxWithConstraints {
        val twoCols = maxWidth >= 860.dp
        val left: @Composable () -> Unit = {
            Box(Modifier.reveal(1)) { DayHero(state, feed, shiftOpen) }
            Box(Modifier.reveal(2)) { QuickRow(onNavigate) }
            Box(Modifier.reveal(3)) { PlanRings(state, onNavigate) }
            val tasks = myDay?.tasks.orEmpty()
            if (tasks.isNotEmpty()) Box(Modifier.reveal(4)) { TaskGroup(tasks, container, onTaskDone) }
        }
        val right: @Composable () -> Unit = {
            Box(Modifier.reveal(4)) { DayFeed(feed, today) }
            Box(Modifier.reveal(5)) { NetToday(state) }
            if (state.topLeaders.isNotEmpty()) Box(Modifier.reveal(6)) { TopGroup(state, onNavigate) }
            Box(Modifier.reveal(7)) { ToolsGroup(onNavigate, onAbout) }
        }
        if (twoCols) Row(horizontalArrangement = Arrangement.spacedBy(24.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1.1f)) { left() }
            Column(Modifier.weight(1f)) { right() }
        } else Column { left(); right() }
    }
}

@Composable
private fun DayHero(state: HomeUiState.Content, feed: List<HistorySale>?, shiftOpen: Boolean?) {
    val day = state.myDay
    // units only (SIM/MNP/ПА/Комбо + other шт metrics); money metrics would swamp "12 из 16"
    val units = day?.progress?.filterKeys { it in HERO_UNITS }.orEmpty()
    val fact = units.values.sumOf { it.fact }.roundToInt()
    val plan = units.values.sumOf { it.plan }.roundToInt()
    val shown = animatedInt(fact, 640)
    val left = (plan - fact).coerceAtLeast(0)
    val hoursLeft = remember { (21 - ZonedDateTime.now(MSK).hour).coerceAtLeast(0) }
    val chip = when (shiftOpen) { true -> "смена открыта"; false -> "смена закрыта"; null -> null }
    BetaHero("Продажи сегодня", chip) {
        HeroNumber(shown.toString(), if (plan > 0) "из $plan" else null, T2Hero.onHero)
        val sub = when {
            day == null -> "Не удалось загрузить «Мой день»"
            !day.bound -> "Аккаунт не привязан: привяжи себя в Профиле"
            plan == 0 -> "Плана на сегодня нет"
            left == 0 -> "План дня выполнен"
            else -> "Ещё $left до плана" + if (hoursLeft > 0) ", до конца смены около $hoursLeft ч" else ""
        }
        Text(sub, color = T2Hero.onHero2, fontSize = 15.sp, modifier = Modifier.padding(top = 4.dp, bottom = 12.dp))
        // cumulative units over today's checks (feed is newest-first per day, so it is reversed); flat line when there are none yet
        val today = LocalDate.now(MSK).toString()
        val checks = feed.orEmpty().filter { it.sale_date.take(10) == today }.reversed()
        var acc = 0f
        val points = listOf(0f) + checks.map { acc += ((it.sim ?: 0.0) + (it.mnp ?: 0.0) + (it.pa ?: 0.0)).toFloat(); acc }
        Sparkline(if (points.size >= 2) points else listOf(0f, fact.toFloat()), plan.toFloat(), T2Hero.onHero, dashed = T2Hero.onHeroLine)
    }
}

@Composable
private fun QuickRow(onNavigate: (Screen) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
        RoundAction(Icons.Outlined.Add, "Продажа", primary = true, modifier = Modifier.weight(1f)) { AddSaleState.open() }
        // same order as the web (pages/home renderU3Top): Продажа / План / Касса / Комбо
        RoundAction(Icons.Outlined.BarChart, "План", modifier = Modifier.weight(1f)) { onNavigate(Screen.MonthPlan) }
        RoundAction(Icons.Outlined.PointOfSale, "Касса", modifier = Modifier.weight(1f)) { onNavigate(Screen.Cash) }
        RoundAction(Icons.Outlined.FlashOn, "Комбо", modifier = Modifier.weight(1f)) { ru.t2sales.desktop.ui.tools.ToolDialogs.open("combo") }
    }
}

@Composable
private fun PlanRings(state: HomeUiState.Content, onNavigate: (Screen) -> Unit) {
    GroupHead("План дня", "Месяц") { onNavigate(Screen.MonthPlan) }
    val prog = state.myDay?.progress?.filterValues { it.plan > 0 }.orEmpty()
    Group {
        if (prog.isEmpty()) {
            Text("На сегодня плана нет", color = T2Colors.hint, fontSize = 15.sp, modifier = Modifier.padding(16.dp))
            return@Group
        }
        val rings = prog.filterKeys { it !in MONEY }.entries.toList()
        rings.chunked(5).forEach { chunk ->
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 14.dp)) {
                chunk.forEach { (id, e) ->
                    Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                        BetaRing((e.fact / e.plan).toFloat(), e.fact.roundToInt().toString(), size = 48.dp)
                        Text(BETA_METRIC[id] ?: id, color = T2Colors.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 6.dp))
                        Text("из ${e.plan.roundToInt()}", color = T2Colors.hint, fontSize = 12.sp)
                    }
                }
                repeat(5 - chunk.size) { Spacer(Modifier.weight(1f)) }
            }
        }
        prog.filterKeys { it in MONEY }.forEach { (id, e) ->
            GroupSeparator()
            val p = (e.fact / e.plan).toFloat()
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(BETA_METRIC[id] ?: id, color = T2Colors.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                    Column(horizontalAlignment = Alignment.End) {
                        Text(NFR.format(e.fact.roundToInt()), color = T2Colors.text, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                        Text("из ${NFR.format(e.plan.roundToInt())} ₽", color = T2Colors.hint, fontSize = 12.sp)
                    }
                }
                val filled = ru.t2sales.desktop.ui.components.animatedFloat(p.coerceIn(0f, 1f), 720)
                Box(Modifier.padding(top = 6.dp).fillMaxWidth(0.62f).height(4.dp).background(T2Colors.track, 99)) {
                    Box(Modifier.fillMaxWidth(filled).height(4.dp).background(betaTone(p), 99))
                }
            }
        }
    }
}

private fun Modifier.background(c: androidx.compose.ui.graphics.Color, r: Int): Modifier =
    this.clip(androidx.compose.foundation.shape.RoundedCornerShape(r.dp)).background(c)

@Composable
private fun DayFeed(feed: List<HistorySale>?, today: LocalDate) {
    val list = feed
    val t = today.toString()
    val y = today.minusDays(1).toString()
    val todayItems = list.orEmpty().filter { it.sale_date.take(10) == t }
    val yItems = list.orEmpty().filter { it.sale_date.take(10) == y }
    fun units(l: List<HistorySale>) = l.sumOf { (it.sim ?: 0.0) + (it.mnp ?: 0.0) + (it.pa ?: 0.0) }.roundToInt()
    GroupHead("Сегодня", if (list == null) null else "${todayItems.size} чеков, ${units(todayItems)} продаж")
    Group {
        when {
            list == null -> Box(Modifier.padding(16.dp)) { SkeletonBlock(Modifier.fillMaxWidth().height(40.dp), 10.dp) }
            todayItems.isEmpty() -> Text("Продаж пока нет. Первая продажа запустит ленту дня.", color = T2Colors.hint, fontSize = 15.sp, modifier = Modifier.padding(16.dp))
            else -> todayItems.take(8).forEachIndexed { i, s -> if (i > 0) GroupSeparator(60.dp); FeedCell(s) }
        }
    }
    if (yItems.isNotEmpty()) {
        GroupHead("Вчера", "${units(yItems)} продаж")
        Group { yItems.take(4).forEachIndexed { i, s -> if (i > 0) GroupSeparator(60.dp); FeedCell(s) } }
    }
}

@Composable
private fun FeedCell(s: HistorySale) {
    val parts = listOfNotNull(
        s.sim?.takeIf { it > 0 }?.let { "SIM ${it.roundToInt()}" },
        s.mnp?.takeIf { it > 0 }?.let { "MNP ${it.roundToInt()}" },
        s.pa?.takeIf { it > 0 }?.let { "ПА ${it.roundToInt()}" }
    )
    val n = ((s.sim ?: 0.0) + (s.mnp ?: 0.0) + (s.pa ?: 0.0)).roundToInt()
    val time = s.sale_date.drop(11).take(5).takeIf { it.length == 5 }
    BetaCell(
        title = parts.joinToString(", ").ifEmpty { "Продажа" },
        sub = listOfNotNull(s.store_name, time).joinToString(" · ").ifEmpty { null },
        leading = { BetaTile(Icons.Outlined.Receipt, tone = if (n > 0) T2Colors.primary else null) },
        value = if (n > 0) "+$n" else null
    )
}

@Composable
private fun NetToday(state: HomeUiState.Content) {
    val t = state.networkTotals
    GroupHead("Сеть сегодня")
    Group {
        BetaCell("${t.units.roundToInt()} продаж", "SIM ${t.sim.roundToInt()} · MNP ${t.mnp.roundToInt()} · ПА ${t.pa.roundToInt()} · Комбо ${t.combo.roundToInt()}",
            leading = { BetaTile(Icons.Outlined.TrendingUp) },
            trailing = state.health?.let { h -> { BetaPie((h.overall_pct / 100).toFloat(), 22.dp) } })
        GroupSeparator(60.dp)
        BetaCell("Телефоны", null, leading = { BetaTile(Icons.Outlined.Store) }, value = "${NFR.format(t.phones.roundToInt())} ₽")
        GroupSeparator(60.dp)
        BetaCell("Аксессуары", null, leading = { BetaTile(Icons.Outlined.Sensors) }, value = "${NFR.format(t.accessories.roundToInt())} ₽")
        state.health?.let { h ->
            GroupSeparator(60.dp)
            val pace = h.pace_delta.roundToInt()
            BetaCell("${h.overall_pct.roundToInt()}% плана дня по сети", (if (pace >= 0) "+$pace" else "$pace") + "% к темпу" + if (h.drops.isNotEmpty()) ", просадок: ${h.drops.size}" else "",
                leading = { BetaTile(Icons.Outlined.Info, tone = if (h.drops.isEmpty()) T2Colors.success else T2Colors.warning) })
        }
    }
}

@Composable
private fun TopGroup(state: HomeUiState.Content, onNavigate: (Screen) -> Unit) {
    GroupHead("Топ за 7 дней", "Команда") { onNavigate(Screen.Team) }
    Group {
        state.topLeaders.take(5).forEachIndexed { i, r ->
            if (i > 0) GroupSeparator(60.dp)
            val total = (r.sim + r.mnp + r.pa + r.combo).roundToInt()
            BetaCell(r.full_name, "SIM ${r.sim.roundToInt()} · MNP ${r.mnp.roundToInt()} · ПА ${r.pa.roundToInt()}",
                leading = { BetaTile(null, (i + 1).toString(), tone = if (i == 0) T2Colors.primary else null) }, value = total.toString()) { onNavigate(Screen.Team) }
        }
    }
}

@Composable
private fun TaskGroup(tasks: List<ru.t2sales.shared.api.TaskItem>, container: AppContainer, onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    GroupHead("Мои задачи", "${tasks.size}")
    Group {
        tasks.forEachIndexed { i, task ->
            if (i > 0) GroupSeparator(60.dp)
            val sub = listOfNotNull(task.store_name?.takeIf { it.isNotBlank() }, if (task.status == "in_progress") "В работе" else "Открыта", task.due_at?.let { "до ${it.take(10)}" }).joinToString(" · ")
            BetaCell(task.title, sub, leading = { BetaTile(Icons.Outlined.Assignment) }, trailing = {
                Text("Готово", color = T2Colors.accentText, fontSize = 15.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.clip(androidx.compose.foundation.shape.RoundedCornerShape(10.dp)).clickable {
                        scope.launch {
                            runCatching { container.tasksApi.changeStatus(task.id, "done") }
                                .onSuccess { T2Toast.show("Задача выполнена"); onDone() }
                                .onFailure { T2Toast.show("Не удалось отметить задачу", true) }
                        }
                    }.padding(horizontal = 10.dp, vertical = 10.dp))
            })
        }
    }
}

@Composable
private fun ToolsGroup(onNavigate: (Screen) -> Unit, onAbout: () -> Unit) {
    GroupHead("Инструменты")
    Group {
        val rows = listOf<Triple<androidx.compose.ui.graphics.vector.ImageVector, String, () -> Unit>>(
            Triple(Icons.Outlined.CalendarMonth, "Планы и факт за месяц") { onNavigate(Screen.MonthPlan) },
            Triple(Icons.Outlined.EmojiEvents, "BFQ") { onNavigate(Screen.Bfq) },
            Triple(Icons.Outlined.Calculate, "Калькулятор школа") { ru.t2sales.desktop.ui.tools.ToolDialogs.open("school") },
            Triple(Icons.Outlined.Receipt, "Промокоды РТК") { ru.t2sales.desktop.ui.tools.ToolDialogs.open("promos") },
            Triple(Icons.Outlined.Info, "О приложении", onAbout)
        )
        rows.forEachIndexed { i, (ic, title, go) ->
            if (i > 0) GroupSeparator(60.dp)
            BetaCell(title, leading = { BetaTile(ic) }, chevron = true, onClick = go)
        }
    }
    Spacer(Modifier.height(18.dp))
    GroupHead("Доп услуги")
    Group {
        BetaCell(
            "5G iPhone",
            leading = { BetaTile(Icons.Outlined.Sensors) },
            chevron = true,
            onClick = { ru.t2sales.desktop.ui.tools.ToolDialogs.open("carrier5g") }
        )
        GroupSeparator(60.dp)
        BetaCell(
            "Приём б/у",
            leading = { BetaTile(Icons.Outlined.Receipt) },
            chevron = true,
            onClick = { ru.t2sales.desktop.ui.tools.ToolDialogs.open("tradein") }
        )
        GroupSeparator(60.dp)
        BetaCell(
            "Диагностика",
            leading = { BetaTile(Icons.Outlined.Analytics) },
            chevron = true,
            onClick = { ru.t2sales.desktop.ui.tools.ToolDialogs.open("diag") }
        )
        GroupSeparator(60.dp)
        BetaCell(
            "ADB-терминал",
            leading = { BetaTile(Icons.Outlined.Terminal) },
            chevron = true,
            onClick = { ru.t2sales.desktop.ui.tools.ToolDialogs.open("adbterm") }
        )
        GroupSeparator(60.dp)
        BetaCell(
            "Перенос контактов",
            leading = { BetaTile(Icons.Outlined.Group) },
            chevron = true,
            onClick = { ru.t2sales.desktop.ui.tools.ToolDialogs.open("contacts") }
        )
        GroupSeparator(60.dp)
        BetaCell(
            "Чистка и защита",
            leading = { BetaTile(Icons.Outlined.Security) },
            chevron = true,
            onClick = { ru.t2sales.desktop.ui.tools.ToolDialogs.open("cleanguard") }
        )
        GroupSeparator(60.dp)
        BetaCell(
            "Перенос телефона",
            leading = { BetaTile(Icons.Outlined.SwapHoriz) },
            chevron = true,
            onClick = { ru.t2sales.desktop.ui.tools.ToolDialogs.open("phonemove") }
        )
    }
}

package ru.t2sales.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import ru.t2sales.shared.api.DashboardResponse
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.async
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.text.NumberFormat
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.Locale
import kotlin.math.roundToInt
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive
import ru.t2sales.android.AppContainer
import ru.t2sales.shared.api.DashboardLeaderRow
import ru.t2sales.shared.api.MeDayResponse
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Radius
import ru.t2sales.shared.theme.T2Spacing

private val MOSCOW = ZoneId.of("Europe/Moscow")

private val METRIC_SHORT_LABEL = mapOf(
    "sim" to "SIM", "mnp" to "MNP", "pa" to "ПА", "combo" to "Комбо", "phones" to "Тел", "accessories" to "Аксы",
    "settings" to "Доп", "insurance" to "Страх", "wink" to "Wink", "shpd" to "ШПД", "focus" to "ФО",
    "credit_request" to "Кр.з", "credit_issued" to "Кр.в", "plotter" to "Плот", "hb" to "НВ"
)

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

private class Totals(val sim: Double, val mnp: Double, val pa: Double, val combo: Double, val phones: Double, val accessories: Double)

private class HomeData(
    val myDay: MeDayResponse?,
    val totals: Totals,
    val leaders: List<DashboardLeaderRow>,
    val shiftOpen: Boolean?
)

private fun sumTotals(stats: JsonArray): Totals {
    fun sum(key: String) = stats.sumOf { (it as? JsonObject)?.get(key)?.jsonPrimitive?.doubleOrNull ?: 0.0 }
    return Totals(sum("sim"), sum("mnp"), sum("pa"), sum("combo"), sum("phones"), sum("accessories"))
}

/**
 * Mobile port of pages/home + index.html #page-home: header, greeting card, "Мой день", "Сеть сегодня", "Топ за 7 дней".
 * Every widget loads on its own, so one failing request does not blank the rest (the web page's per-widget try/catch).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun HomeScreen(container: AppContainer, me: MeResponse) {
    var data by remember { mutableStateOf<HomeData?>(null) }
    var refresh by remember { mutableStateOf(0) }
    var about by remember { mutableStateOf(false) }

    LaunchedEffect(refresh, AppState.refreshTick) {
        val cache = container.readCache
        if (data == null) {
            // the last saved answers first: the screen is filled at once (no waiting for the network), the fresh data then replaces them
            val cMyDay = cache.get("home.myday", MeDayResponse.serializer())?.value
            val cStats = cache.get("home.stats", JsonArray.serializer())?.value
            val cDash = cache.get("home.dashboard", DashboardResponse.serializer())?.value
            if (cMyDay != null || cStats != null || cDash != null) {
                data = HomeData(cMyDay, cStats?.let(::sumTotals) ?: Totals(0.0, 0.0, 0.0, 0.0, 0.0, 0.0), cDash?.top.orEmpty().ifEmpty { cDash?.top7.orEmpty() }, null)
            }
        }
        // the four requests go out together: the wait is the slowest one, not the sum
        coroutineScope {
            val aMyDay = async { runCatching { container.homeApi.getMyDay() }.getOrNull() }
            val aStats = async { runCatching { container.reportsApi.getStatsDaily(LocalDate.now(MOSCOW).toString()) }.getOrNull() }
            val aDash = async { runCatching { container.reportsApi.getDashboard() }.getOrNull() }
            val aShift = async { runCatching { container.profileApi.getShiftCurrent() }.getOrNull() }
            val myDay = aMyDay.await()
            val stats = aStats.await()
            val dashboard = aDash.await()
            val shift = aShift.await()
            myDay?.let { cache.put("home.myday", MeDayResponse.serializer(), it) }
            stats?.let { cache.put("home.stats", JsonArray.serializer(), it) }
            dashboard?.let { cache.put("home.dashboard", DashboardResponse.serializer(), it) }
            val before = data
            data = HomeData(
                myDay = myDay ?: before?.myDay,
                totals = stats?.let(::sumTotals) ?: before?.totals ?: Totals(0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
                leaders = if (dashboard != null) dashboard.top.orEmpty().ifEmpty { dashboard.top7.orEmpty() } else before?.leaders.orEmpty(),
                shiftOpen = shift?.let { it.session != null }
            )
        }
    }

    if (about) AboutSheet { about = false }
    Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(bottom = 96.dp)) {
        AppHeader(me, data?.myDay, container) { refresh++ }
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.reveal(0)) { Greeting(me.full_name?.split(" ")?.getOrNull(1) ?: me.full_name.orEmpty(), me.role, data?.shiftOpen) }
            val d = data
            if (d == null) {
                Section("Мой день") { LoadingBlock(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), lines = 4) }
            } else {
                Box(Modifier.reveal(1)) { MyDay(d.myDay, d.shiftOpen) }
                Box(Modifier.reveal(2)) { NetworkPulse(d.totals) }
                Box(Modifier.reveal(3)) { CalcSection() }
                Box(Modifier.reveal(4)) { QuickActionsSection() }
                Box(Modifier.reveal(5)) { TopLeaders(d.leaders) }
                Box(Modifier.reveal(6)) { ToolsSection(onAbout = { about = true }) }
            }
        }
    }
}

/** The web's .app-header: avatar with the initials, the date and the store pills. */
@Composable
private fun AppHeader(me: MeResponse, myDay: MeDayResponse?, container: AppContainer, onRefresh: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            val initials = me.full_name.orEmpty().split(" ").filter { it.isNotBlank() }.take(2).joinToString("") { it.take(1) }.ifEmpty { "T2" }
            Box(Modifier.size(40.dp).clip(CircleShape).background(T2Colors.primarySoft), contentAlignment = Alignment.Center) {
                Text(initials, color = T2Colors.primary, fontWeight = FontWeight.ExtraBold, fontSize = 14.sp)
            }
            Spacer(Modifier.width(8.dp))
            OutboxPill(container.outbox)
            Spacer(Modifier.weight(1f))
            HeaderButton("◐") { T2Colors.dark = !T2Colors.dark }
            Spacer(Modifier.width(8.dp))
            HeaderButton("↻", onRefresh)
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Pill("Сегодня", today())
            myDay?.shift?.let { s -> Pill("Точка", s.store_code ?: s.store_name ?: "—") }
        }
    }
}

private fun today(): String {
    val d = LocalDate.now(MOSCOW)
    val months = listOf("января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря")
    return "${d.dayOfMonth} ${months[d.monthValue - 1]}"
}

/** The web's .icon-btn. */
@Composable
private fun HeaderButton(glyph: String, onClick: () -> Unit) {
    val shape = RoundedCornerShape(T2Radius.sm)
    Box(Modifier.size(40.dp).clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Text(glyph, fontSize = 18.sp, color = T2Colors.textSecondary)
    }
}

@Composable
private fun Pill(label: String, value: String) {
    val shape = RoundedCornerShape(T2Radius.sm)
    Column(Modifier.clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape).padding(horizontal = 12.dp, vertical = 7.dp)) {
        Text(label.uppercase(), color = T2Colors.hint, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp)
        Text(value, fontSize = 14.sp, fontWeight = FontWeight.ExtraBold)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Greeting(firstName: String, role: String?, shiftOpen: Boolean?) {
    val shape = RoundedCornerShape(T2Radius.default)
    Box(
        Modifier.fillMaxWidth().clip(shape)
            .background(Brush.linearGradient(listOf(Color(0xFF0A0A0B), Color(0xFF12121A), Color(0xFF0C1A28))))
            .border(1.dp, Color(0x0FFFFFFF), shape)
            .padding(T2Spacing.sp4)
    ) {
        Column {
            Text(greetingByHour(), color = Color(0xBFFFFFFF), fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Text(firstName, color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(bottom = 10.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (role != null) GreetBadge(ROLE_LABELS[role] ?: role)
            }
        }
        if (shiftOpen != null) {
            val fg = if (shiftOpen) Color(0xFF34C759) else Color(0xBFFFFFFF)
            Row(
                Modifier.align(Alignment.TopEnd).clip(RoundedCornerShape(20.dp))
                    .background(if (shiftOpen) Color(0x3334C759) else Color(0x1AFFFFFF))
                    .border(1.dp, if (shiftOpen) Color(0x5234C759) else Color(0x1FFFFFFF), RoundedCornerShape(20.dp))
                    .padding(start = 8.dp, end = 10.dp, top = 5.dp, bottom = 5.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(Modifier.size(7.dp).clip(CircleShape).background(if (shiftOpen) Color(0xFF34C759) else Color(0x59FFFFFF)))
                Spacer(Modifier.width(6.dp))
                Text(if (shiftOpen) "Смена открыта" else "Смена закрыта", color = fg, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun GreetBadge(text: String) {
    Text(
        text, color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold,
        modifier = Modifier.clip(RoundedCornerShape(20.dp)).background(Color(0x1FFFFFFF)).border(1.dp, Color(0x1AFFFFFF), RoundedCornerShape(20.dp)).padding(horizontal = 10.dp, vertical = 5.dp)
    )
}

@Composable
private fun MyDay(myDay: MeDayResponse?, shiftOpen: Boolean?) {
    Section("Мой день") {
        when {
            myDay == null -> Text("Не удалось загрузить «Мой день»", color = T2Colors.hint, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
            !myDay.bound -> Text("Аккаунт не привязан", color = T2Colors.hint, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
            else -> {
                val shift = myDay.shift
                Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 14.dp)) {
                    Text(shift?.let { it.store_code ?: it.store_name ?: "" } ?: "Выходной", fontSize = 15.sp, fontWeight = FontWeight.Bold)
                    val addr = shift?.store_address
                    if (!addr.isNullOrBlank()) Text(addr, color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp))
                    if (shiftOpen == false) {
                        Text(
                            "Сменить точку", color = T2Colors.onAccent, fontSize = 12.sp, fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(top = 6.dp).clip(RoundedCornerShape(T2Radius.md)).background(T2Colors.accent).clickable { ShiftUi.changeStore = true }.padding(horizontal = 12.dp, vertical = 6.dp)
                        )
                    } else if (shiftOpen == true) {
                        Text("Закройте смену, чтобы сменить точку", color = T2Colors.hint, fontSize = 11.sp, modifier = Modifier.padding(top = 6.dp))
                    }
                    Spacer(Modifier.height(10.dp))
                    if (shift != null) {
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 10.dp)) {
                            Column(Modifier.weight(1f)) {
                                Text(shift.store_name ?: "Точка", fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                                Text("${shift.shift_text ?: ""} · ${shift.hours?.let { "${it.roundToInt()}" } ?: ""}ч", color = T2Colors.hint, fontSize = 13.sp)
                            }
                            Text("${(myDay.total?.pct ?: 0.0).roundToInt()}%", fontSize = 15.sp, fontWeight = FontWeight.Bold)
                        }
                    } else {
                        Text("Сегодня выходной / нет в графике", color = T2Colors.hint, modifier = Modifier.padding(bottom = 10.dp))
                    }
                    myDay.progress?.filterValues { it.plan > 0 }?.forEach { (metric, entry) ->
                        ProgressRow(METRIC_SHORT_LABEL[metric] ?: metric, entry.fact, entry.plan)
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
    val filled = animatedFloat(percent.coerceIn(0, 100) / 100f, 900) // the bar grows to its value
    val shownFact = animatedInt(fact.roundToInt(), 900)               // and the numbers settle with it
    val shownPct = animatedInt(percent, 900)
    Column(Modifier.padding(vertical = T2Spacing.sp1)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
            Text("$shownFact / ${plan.roundToInt()}" + if (plan > 0) " · $shownPct%" else "", color = T2Colors.hint, fontSize = 13.sp)
        }
        Box(Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(99.dp)).background(T2Colors.surface3)) {
            Box(Modifier.fillMaxWidth(filled.coerceIn(0f, 1f)).height(6.dp).clip(RoundedCornerShape(99.dp)).background(pctTone(percent)))
        }
    }
}

@Composable
private fun NetworkPulse(t: Totals) {
    Section("Сеть сегодня") {
        Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatChip("SIM", t.sim.roundToInt(), Modifier.weight(1f))
                StatChip("MNP", t.mnp.roundToInt(), Modifier.weight(1f))
                StatChip("ПА", t.pa.roundToInt(), Modifier.weight(1f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatChip("Комбо", t.combo.roundToInt(), Modifier.weight(1f))
                StatChip("Телефоны", t.phones.roundToInt(), Modifier.weight(1f))
                StatChip("Аксы", t.accessories.roundToInt(), Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun StatChip(label: String, value: Int, modifier: Modifier) {
    val shape = RoundedCornerShape(T2Radius.sm)
    val text = NumberFormat.getInstance(Locale("ru", "RU")).format(animatedInt(value))
    Column(
        modifier.clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape).padding(horizontal = 8.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(text, fontSize = 20.sp, fontWeight = FontWeight.Black)
        Text(label.uppercase(), color = T2Colors.hint, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.4.sp, modifier = Modifier.padding(top = 3.dp))
    }
}

@Composable
private fun TopLeaders(leaders: List<DashboardLeaderRow>) {
    Section("Топ за 7 дней") {
        if (leaders.isEmpty()) {
            Text("Нет данных за 7 дней", color = T2Colors.hint, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
            return@Section
        }
        val medals = listOf("🥇", "🥈", "🥉")
        leaders.take(7).forEachIndexed { i, row ->
            val total = row.sim + row.mnp + row.pa + row.combo
            ListRow(medals.getOrNull(i) ?: (i + 1).toString(), row.full_name, "SIM ${row.sim.roundToInt()} · MNP ${row.mnp.roundToInt()} · ПА ${row.pa.roundToInt()}", total.roundToInt().toString(), chevron = false)
        }
    }
}

@Composable
private fun CalcSection() {
    Section("Калькуляторы") {
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            MChip("Комбо", Modifier.weight(1f)) { ToolUi.open("combo") }
            MChip("Школа", Modifier.weight(1f)) { ToolUi.open("school") }
        }
        Box(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp)) { MChip("Промокоды РТК", Modifier.fillMaxWidth()) { ToolUi.open("promos") } }
    }
}

@Composable
private fun MChip(label: String, modifier: Modifier, onClick: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Row(modifier.clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape).clickable(onClick = onClick).padding(vertical = 12.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
        Text(label, fontWeight = FontWeight.Bold, fontSize = 13.sp)
    }
}

@Composable
private fun QuickActionsSection() {
    Section("Быстрые действия") {
        ListRow("₽", "Касса", "Факт / 1С / плюс-минус по точкам") { Nav.open(Page.Cash) }
        ListRow("▦", "Планы и факт за месяц", "видно всей команде") { Nav.open(Page.MonthPlan) }
        ListRow("↗", "Динамика выполнения", "все метрики · сотрудники и точки") { Nav.open(Page.NetMonth) }
        ListRow("?", "Поддержка", null) { Nav.open(Page.Support) }
    }
}

@Composable
private fun ToolsSection(onAbout: () -> Unit) {
    Section("Инструменты") {
        ListRow("★", "BFQ", "Рейтинг качества за месяц") { Nav.open(Page.Bfq) }
        ListRow("÷", "Расчёт комбо", "Телефон − скидка + 28% + 1950") { ToolUi.open("combo") }
        ListRow("÷", "Калькулятор школа", "Телефон − 70% + 30% + 3600 + 3490") { ToolUi.open("school") }
        ListRow("%", "Промокоды РТК", "Общий пул · скрытый список") { ToolUi.open("promos") }
        ListRow("▦", "Heatmap часов", "Когда ставить сильного") { Nav.open(Page.Heatmap) }
        ListRow("↻", "Повтор месяца", "Гонка сотрудников по дням") { Nav.open(Page.Replay) }
        ListRow("↗", "Прогноз и what-if", "7 дней · сценарии смен") { Nav.open(Page.Forecast) }
        ListRow("!", "Объявления", "Прочитал · обязательно") { Nav.open(Page.Announce) }
        ListRow("▣", "Отчёт-картинка", "SVG итог дня") { Nav.open(Page.ReportImg) }
        ListRow("≡", "Отчёты", "Сводка по сети · экспорт") { Nav.open(Page.Reports) }
        ListRow("●", "Сеть live", "Кто на смене · % плана · касса") { Nav.open(Page.Live) }
        ListRow("◎", "Command Center", "Что происходит · где проблема · что делать") { Nav.open(Page.CommandCenter) }
        ListRow("☑", "Задачи", "Кто что делает по сети") { Nav.open(Page.Tasks) }
        ListRow("!", "Алерты", "Полный жизненный цикл, не только открытые") { Nav.open(Page.Alerts) }
        ListRow("i", "О приложении", "T2 Sales v${ru.t2sales.android.BuildConfig.VERSION_NAME}", chevron = true, onClick = onAbout)
    }
}

@Composable
fun AboutSheet(onDismiss: () -> Unit) {
    BottomSheet("О приложении", onDismiss = onDismiss) {
        Text("T2 Sales", fontSize = 18.sp, fontWeight = FontWeight.ExtraBold)
        Text("Версия ${ru.t2sales.android.BuildConfig.VERSION_NAME}", color = T2Colors.hint, fontSize = 14.sp, modifier = Modifier.padding(top = 4.dp))
        Text("Нативное приложение для Android. Те же данные и тот же сервер, что в веб-версии.", color = T2Colors.textSecondary, fontSize = 13.sp, lineHeight = 19.sp, modifier = Modifier.padding(top = 12.dp))
    }
}

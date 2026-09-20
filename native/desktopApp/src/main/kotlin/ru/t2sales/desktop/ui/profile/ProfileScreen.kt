package ru.t2sales.desktop.ui.profile

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.Icon
import androidx.compose.material.MaterialTheme
import androidx.compose.material.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccessTime
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Assignment
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.FlashOn
import androidx.compose.material.icons.outlined.Receipt
import androidx.compose.material.icons.outlined.Sensors
import androidx.compose.material.icons.outlined.Smartphone
import androidx.compose.material.icons.outlined.Store
import androidx.compose.material.icons.outlined.Today
import androidx.compose.material.icons.outlined.Logout
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.awt.FileDialog
import java.io.ByteArrayOutputStream
import java.io.File
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID
import javax.imageio.IIOImage
import javax.imageio.ImageIO
import javax.imageio.ImageWriteParam
import kotlin.math.roundToInt
import kotlinx.coroutines.launch
import ru.t2sales.desktop.di.AppContainer
import ru.t2sales.desktop.ui.components.AvatarImage
import ru.t2sales.desktop.ui.components.AvatarVersion
import ru.t2sales.desktop.ui.components.Field
import ru.t2sales.desktop.ui.components.MainButton
import ru.t2sales.desktop.ui.components.SheetDialog
import ru.t2sales.desktop.ui.components.T2Toast
import ru.t2sales.desktop.ui.home.ProgressRow
import ru.t2sales.desktop.ui.sales.AddSaleState
import ru.t2sales.shared.api.BfqItem
import ru.t2sales.shared.api.MeDayResponse
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.api.MonthSummaryRow
import ru.t2sales.shared.api.MyInsightResponse
import ru.t2sales.shared.api.ScheduleRow
import ru.t2sales.shared.api.SelfStatsResponse
import ru.t2sales.shared.api.SessionListItem
import ru.t2sales.shared.api.ShiftCurrentResponse
import ru.t2sales.shared.navigation.Screen
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Radius
import ru.t2sales.shared.theme.T2Spacing

private val MOSCOW = ZoneId.of("Europe/Moscow")
private const val WEB_ONLY = "Этот раздел пока доступен только в веб-версии"

private val ROLE_LABELS = mapOf(
    "trainee" to "Стажёр", "employee" to "Продавец", "senior" to "Старший продавец",
    "manager" to "Руководитель", "supervisor" to "Супервайзер", "admin" to "Администратор"
)
private val METRIC_LABELS = mapOf(
    "sim" to "SIM", "mnp" to "MNP", "pa" to "ПА", "hb" to "НВ", "combo" to "Комбо", "phones" to "Телефоны",
    "accessories" to "Аксессуары", "insurance" to "Страховки", "wink" to "Wink", "shpd" to "ШПД", "focus" to "ФО"
)
private val MONTH_GROUPS = listOf(
    "Блок GI" to listOf("sim" to null, "mnp" to null, "pa" to null, "hb" to null),
    "Товарка" to listOf("combo" to null, "phones" to null, "accessories" to null, "insurance" to null),
    "Ростелеком" to listOf("wink" to null, "shpd" to null, "focus" to null),
    "Кредиты" to listOf("credit_request" to "Заявка", "credit_issued" to "Выданный")
)
private val STORE_COLORS = mapOf("kosmonavtov" to 0xFF6D9EEB, "kalinina2" to 0xFFFF6D01, "kalinina11" to 0xFFFFD966)
private fun storeColor(id: String) = Color(STORE_COLORS[id] ?: 0xFF2AABEE)

private fun pctColor(p: Int) = when {
    p >= 100 -> T2Colors.success
    p >= 70 -> T2Colors.warning
    else -> T2Colors.danger
}

/** Port of pages/my-plan («Мой план»): the personal cabinet, sections in the web's order (index.html #lkRoot). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ProfileScreen(me: MeResponse, container: AppContainer, onNavigate: (Screen) -> Unit, onLogout: () -> Unit) {
    val empId = me.employee_id
    val api = container.profileApi
    val scope = rememberCoroutineScope()
    val today = remember { LocalDate.now(MOSCOW) }
    val month = today.toString().take(7)

    var myDay by remember { mutableStateOf<MeDayResponse?>(null) }
    var monthRow by remember { mutableStateOf<MonthSummaryRow?>(null) }
    var monthLoaded by remember { mutableStateOf(false) }
    var mySchedule by remember { mutableStateOf<Map<String, ScheduleRow>>(emptyMap()) }
    var bfq by remember { mutableStateOf<List<BfqItem>>(emptyList()) }
    var shift by remember { mutableStateOf<ShiftCurrentResponse?>(null) }
    var insight by remember { mutableStateOf<MyInsightResponse?>(null) }
    var self by remember { mutableStateOf<SelfStatsResponse?>(null) }
    var sessions by remember { mutableStateOf<List<SessionListItem>>(emptyList()) }
    var sessionsKey by remember { mutableStateOf(0) }
    var phone by remember { mutableStateOf(me.phone) }
    var linkPhone by remember { mutableStateOf(false) }
    var quickSale by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        runCatching { container.homeApi.getMyDay() }.onSuccess { myDay = it }
        runCatching { api.getMonthPlans(month) }.onSuccess { r -> monthRow = r.rows.firstOrNull { it.employee_id == empId } }
        monthLoaded = true
        runCatching { container.scheduleApi.getScheduleMonth(month) }.onSuccess { r ->
            mySchedule = r.items.filter { it.employee_id == empId }.associateBy { it.work_date.take(10) }
        }
        runCatching { api.getBfq(month) }.onSuccess { bfq = it.items }
        runCatching { api.getShiftCurrent() }.onSuccess { shift = it }
        runCatching { api.getInsight() }.onSuccess { insight = it }
        runCatching { api.getSelfStats() }.onSuccess { self = it }
    }
    LaunchedEffect(sessionsKey) {
        runCatching { api.listSessions() }.onSuccess { sessions = it.sessions }
    }

    val day = myDay
    val store = day?.shift
    val storeName = store?.store_name ?: store?.store_id
    val dayPct = day?.total?.let { t -> t.pct.roundToInt().takeIf { t.pct > 0 } ?: if (t.plan > 0) ((t.fact / t.plan) * 100).roundToInt() else 0 } ?: 0

    // --- hero
    val heroShape = RoundedCornerShape(T2Radius.default)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(heroShape)
            .background(Brush.linearGradient(listOf(Color(0xFF0A0A0B), Color(0xFF141422), Color(0xFF0E1C2E))))
            .border(1.dp, Color(0x0FFFFFFF), heroShape)
            .padding(start = T2Spacing.sp4, end = T2Spacing.sp4, top = T2Spacing.sp5, bottom = T2Spacing.sp4)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box {
                AvatarImage(container.teamApi, empId, (me.full_name ?: "T").take(1).uppercase(), size = 64.dp)
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .size(22.dp)
                        .clip(CircleShape)
                        .background(T2Colors.primary)
                        .clickable { pickAvatar(container, empId, scope) },
                    contentAlignment = Alignment.Center
                ) { Icon(Icons.Outlined.Edit, contentDescription = "Сменить аватарку", tint = Color.White, modifier = Modifier.size(12.dp)) }
            }
            Spacer(Modifier.width(14.dp))
            Column {
                Text(me.full_name ?: "Сотрудник", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold)
                Spacer(Modifier.height(4.dp))
                val manager = me.role == "manager" || me.role == "admin"
                Text(
                    ROLE_LABELS[me.role ?: "employee"] ?: (me.role ?: "Продавец"),
                    color = if (manager) Color(0xFFFFD60A) else Color(0xE6FFFFFF),
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier
                        .clip(RoundedCornerShape(20.dp))
                        .background(if (manager) Color(0x33FFD60A) else Color(0x1FFFFFFF))
                        .padding(horizontal = 10.dp, vertical = 4.dp)
                )
            }
        }
        Spacer(Modifier.height(14.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (storeName != null) HeroPill(Icons.Outlined.Store, storeName, null) else HeroPill(null, "Сегодня выходной", null)
            store?.shift_text?.takeIf { it.isNotBlank() }?.let {
                HeroPill(Icons.Outlined.AccessTime, it, store.hours?.let { h -> " · ${h.toInt()}ч" })
            }
            HeroPill(Icons.Outlined.Today, today.format(DateTimeFormatter.ofPattern("dd.MM.yyyy")), null)
        }
    }
    Spacer(Modifier.height(T2Spacing.sp3))

    // --- shift (lkShift)
    val sess = shift?.session
    if (shift != null) {
        Card {
            if (sess != null) {
                CardTitle("Смена открыта")
                Text(
                    "${sess.store_name ?: sess.store_id ?: ""} · с ${moscowTime(sess.opened_at)} МСК",
                    color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(bottom = 10.dp)
                )
                listOf("sim", "mnp", "pa", "combo").forEach { m ->
                    ProgressRow(METRIC_LABELS[m] ?: m, shift?.fact?.get(m) ?: 0.0, shift?.day_plan?.get(m) ?: 0.0)
                }
                Spacer(Modifier.height(10.dp))
                MainButton("Закрыть смену", enabled = true, container = Color(0xFFE74C3C), content = Color.White) { ru.t2sales.desktop.ui.shift.ShiftUi.closing = true }
            } else {
                CardTitle("Смена")
                Text("Открой смену на точке — зафиксируем время и гео", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(bottom = 10.dp))
                MainButton("Открыть смену", enabled = true) { ru.t2sales.desktop.ui.shift.ShiftUi.open(container, scope) }
            }
        }
        Spacer(Modifier.height(T2Spacing.sp3))
    }

    // --- insight (lkInsight)
    insight?.insight?.let { i ->
        Card {
            CardTitle("Фокус сейчас")
            Text(i.message, fontSize = 14.sp)
            i.focus.forEach { Text("• $it", fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp)) }
            val projected = i.projected_total
            if (projected != null) {
                val onTrack = i.on_track == true
                Text(
                    "При текущем темпе к концу дня: ~${projected.roundToInt()} (план ${(i.plan_total ?: 0.0).roundToInt()})" + if (onTrack) "" else " — вероятно, не хватит",
                    color = if (onTrack) T2Colors.hint else Color(0xFFE74C3C),
                    fontSize = 12.sp,
                    modifier = Modifier.padding(top = 10.dp)
                )
            }
        }
        Spacer(Modifier.height(T2Spacing.sp3))
    }

    // --- today ring (lkToday): only on a working day
    if (storeName != null) {
        SectionLabel("Сегодня")
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(T2Radius.default))
                .background(T2Colors.surface)
                .padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Ring(dayPct)
            Column {
                Text("Смена на точке", fontSize = 15.sp, fontWeight = FontWeight.ExtraBold)
                Text("Выполнение дневного плана по ключевым метрикам.", color = T2Colors.textSecondary, fontSize = 13.sp)
                Spacer(Modifier.height(8.dp))
                Row(
                    modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(T2Colors.surface2).padding(horizontal = 10.dp, vertical = 5.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(Modifier.size(8.dp).clip(CircleShape).background(storeColor(store?.store_id ?: "")))
                    Spacer(Modifier.width(6.dp))
                    Text(storeName + (store?.shift_text?.let { " · $it" } ?: ""), fontSize = 12.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
        Spacer(Modifier.height(T2Spacing.sp3))
    }

    // --- month (lkMonth)
    SectionLabel("Прогресс за месяц")
    Card {
        val row = monthRow
        if (row != null) {
            Text("Месяц $month", fontWeight = FontWeight.Bold, fontSize = 15.sp)
            Text("Смен: ${row.shifts ?: 0} · осталось: ${row.remaining_shifts ?: 0}", color = T2Colors.hint, fontSize = 11.sp, modifier = Modifier.padding(bottom = 6.dp))
            MONTH_GROUPS.forEach { (group, rows) ->
                SectionLabel(group)
                rows.forEach { (id, label) -> ProgressRow(label ?: METRIC_LABELS[id] ?: id, row.fact[id] ?: 0.0, row.plan[id] ?: 0.0) }
            }
        } else {
            Text("Месяц $month", fontWeight = FontWeight.Bold, fontSize = 15.sp, modifier = Modifier.padding(bottom = 8.dp))
            Text(
                if (monthLoaded) "Месячный план подтянется, когда будут данные" else "Загрузка…",
                color = T2Colors.hint, modifier = Modifier.padding(vertical = 8.dp)
            )
        }
    }
    Spacer(Modifier.height(T2Spacing.sp3))

    // --- week (lkWeek)
    SectionLabel("Моя неделя")
    val monday = today.minusDays((today.dayOfWeek.value - 1).toLong())
    Row(modifier = Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        val wd = listOf("пн", "вт", "ср", "чт", "пт", "сб", "вс")
        (0..6).forEach { i ->
            val d = monday.plusDays(i.toLong())
            val sch = mySchedule[d.toString()]
            val isToday = d == today
            val shape = RoundedCornerShape(14.dp)
            Column(
                modifier = Modifier
                    .width(52.dp)
                    .clip(shape)
                    .background(T2Colors.surface)
                    .border(2.dp, if (isToday) T2Colors.primary else Color.Transparent, shape)
                    .padding(horizontal = 6.dp, vertical = 10.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(wd[i].uppercase(), color = T2Colors.hint, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                Text(d.dayOfMonth.toString(), fontSize = 16.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(vertical = 4.dp))
                Box(Modifier.size(10.dp).clip(CircleShape).background(if (sch != null) storeColor(sch.store_id) else T2Colors.surface2))
            }
        }
    }
    Text("Цвет точки = смена · серый = выходной", color = T2Colors.hint, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp, bottom = 12.dp))

    // --- BFQ (lkBfq)
    val sorted = bfq.sortedByDescending { it.total ?: 0.0 }
    val myBfq = bfq.firstOrNull { it.employee_id == empId }
    val rank = if (myBfq != null) sorted.indexOfFirst { it.employee_id == empId } + 1 else null
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(T2Radius.default))
            .background(Brush.linearGradient(listOf(Color(0xFF1A1A2E), Color(0xFF0F3460))))
            .clickable { onNavigate(Screen.Bfq) }
            .padding(horizontal = 18.dp, vertical = 16.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column {
            Text("BFQ ЗА МЕСЯЦ", color = Color(0xB3FFFFFF), fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp)
            Text(myBfq?.total?.let { fmtNum(it) } ?: "—", color = Color.White, fontSize = 32.sp, fontWeight = FontWeight.ExtraBold)
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(if (rank != null) "#$rank в сети" else "Нет рейтинга", color = Color(0xD9FFFFFF), fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Text("открыть →", color = Color(0x99FFFFFF), fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp))
        }
    }
    Spacer(Modifier.height(T2Spacing.sp3))

    // --- gamification (lkGamification)
    self?.gamification?.let { g ->
        Card {
            CardTitle("Прогресс")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                DarkPill("lvl ${g.level} ${g.title ?: ""}")
                DarkPill("XP ${g.xp}" + (g.next_level_xp?.let { " / $it" } ?: ""))
                DarkPill("🔥 ${g.streak_days} дн.")
            }
            self?.best_shift?.let { b ->
                Text("Лучшая смена: ${b.date} · score ${fmtNum(b.score)}", color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
            }
        }
        Spacer(Modifier.height(T2Spacing.sp3))
    }

    // --- actions (lkActions)
    SectionLabel("Действия")
    val actions = listOf(
        Action(Icons.Outlined.Add, "Продажа", "Внести метрики") { AddSaleState.open(empId) },
        Action(Icons.Outlined.CalendarToday, "График", "Месяц целиком") { onNavigate(Screen.Schedule) },
        Action(Icons.Outlined.Assignment, "План дня", "Все точки") { onNavigate(Screen.PlanDay) },
        Action(null, "Смена", "Открыть / закрыть") { if (sess != null) ru.t2sales.desktop.ui.shift.ShiftUi.closing = true else ru.t2sales.desktop.ui.shift.ShiftUi.open(container, scope) },
        Action(Icons.Outlined.FlashOn, "Быстрый ввод", "«две симки mnp»") { quickSale = true },
        Action(Icons.Outlined.Sensors, "Сеть live", "Все точки") { onNavigate(Screen.Live) },
        Action(Icons.Outlined.Receipt, "История продаж", "Твои продажи") { ru.t2sales.desktop.ui.history.HistoryFilter.employeeId = empId; onNavigate(Screen.History) }
    )
    actions.chunked(4).forEach { chunk ->
        Row(modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            chunk.forEach { a -> ActionTile(a, Modifier.weight(1f)) }
            repeat(4 - chunk.size) { Spacer(Modifier.weight(1f)) }
        }
    }
    Spacer(Modifier.height(T2Spacing.sp2))

    // --- phone auth (lkPhoneAuth)
    Card {
        CardTitle("Вход с компьютера")
        val ph = phone
        if (ph != null) {
            ListRow(Icons.Outlined.Smartphone, "Подключено", ph, chevron = false, onClick = null)
        } else {
            ListRow(Icons.Outlined.Smartphone, "Привязать телефон и пароль", "Понадобится, если Telegram недоступен", chevron = true) { linkPhone = true }
        }
        ListRow(Icons.Outlined.Logout, "Выйти", null, chevron = false) {
            scope.launch {
                runCatching { api.logout() }
                onLogout()
            }
        }
    }
    Spacer(Modifier.height(T2Spacing.sp3))

    // --- sessions (lkSessions)
    if (sessions.isNotEmpty()) {
        Card {
            CardTitle("Активные сессии")
            sessions.forEach { s ->
                val device = describeUserAgent(s.user_agent)
                val location = listOfNotNull(s.city, s.country).filter { it.isNotBlank() }.joinToString(", ")
                val subtitle = if (s.current) listOf(location, "сейчас активна").filter { it.isNotEmpty() }.joinToString(" · ")
                else listOf(location, "посл. активность " + fmtDateTime(s.last_seen_at)).filter { it.isNotEmpty() }.joinToString(" · ")
                Row(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(device + if (s.current) " · это устройство" else "", fontWeight = FontWeight.ExtraBold, fontSize = 15.sp)
                        Text(subtitle, color = T2Colors.hint, fontSize = 12.sp)
                    }
                    if (!s.current) {
                        SmallChip("Завершить") {
                            scope.launch {
                                runCatching { api.revokeSession(s.id) }
                                    .onSuccess { T2Toast.show("Сессия завершена"); sessionsKey++ }
                                    .onFailure { T2Toast.show(it.message ?: "Не удалось завершить сессию", true) }
                            }
                        }
                    }
                }
            }
            if (sessions.size > 1) {
                ListRow(null, "Завершить остальные", null, chevron = false) {
                    scope.launch {
                        runCatching { api.revokeOtherSessions() }
                            .onSuccess { T2Toast.show("Остальные сессии завершены"); sessionsKey++ }
                            .onFailure { T2Toast.show(it.message ?: "Не удалось завершить сессии", true) }
                    }
                }
            }
        }
    }

    if (linkPhone) {
        LinkPhoneDialog(onDismiss = { linkPhone = false }) { p, pw ->
            scope.launch {
                runCatching { api.linkPhone(p, pw) }
                    .onSuccess { T2Toast.show("Телефон привязан"); phone = p; linkPhone = false }
                    .onFailure { T2Toast.show(it.message ?: "Не удалось привязать телефон", true) }
            }
        }
    }
    if (quickSale) QuickSaleDialog(api = api, onDismiss = { quickSale = false })
}

private class Action(val icon: ImageVector?, val title: String, val sub: String, val onClick: () -> Unit)

@Composable
private fun ActionTile(a: Action, modifier: Modifier) {
    val shape = RoundedCornerShape(T2Radius.sm)
    Column(
        modifier = modifier
            .clip(shape)
            .background(T2Colors.surface)
            .clickable(onClick = a.onClick)
            .padding(horizontal = 12.dp, vertical = 14.dp)
    ) {
        Box(modifier = Modifier.height(26.dp), contentAlignment = Alignment.CenterStart) {
            if (a.icon != null) Icon(a.icon, contentDescription = null, tint = T2Colors.text, modifier = Modifier.size(20.dp))
            else Box(Modifier.size(10.dp).clip(CircleShape).background(T2Colors.success))
        }
        Text(a.title, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold)
        Text(a.sub, color = T2Colors.textSecondary, fontSize = 11.sp, modifier = Modifier.padding(top = 2.dp))
    }
}

@Composable
private fun Card(content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(T2Radius.default)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(T2Colors.surface)
            .border(1.dp, T2Colors.border, shape)
            .padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 14.dp)
    ) { content() }
}

@Composable
private fun CardTitle(text: String) {
    Text(text.uppercase(), color = T2Colors.hint, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.6.sp, modifier = Modifier.padding(bottom = 8.dp))
}

@Composable
private fun SectionLabel(text: String) {
    Text(text.uppercase(), color = T2Colors.hint, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.6.sp, modifier = Modifier.padding(top = 4.dp, bottom = 8.dp))
}

@Composable
private fun HeroPill(icon: ImageVector?, text: String, suffix: String?) {
    val shape = RoundedCornerShape(12.dp)
    Row(
        modifier = Modifier.clip(shape).background(Color(0x1AFFFFFF)).border(1.dp, Color(0x1FFFFFFF), shape).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = Color(0xE6FFFFFF), modifier = Modifier.size(14.dp))
            Spacer(Modifier.width(6.dp))
        }
        Text(text, color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.ExtraBold)
        if (suffix != null) Text(suffix, color = Color(0xE6FFFFFF), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun DarkPill(text: String) {
    val shape = RoundedCornerShape(12.dp)
    Text(
        text,
        color = Color.White,
        fontSize = 12.sp,
        fontWeight = FontWeight.ExtraBold,
        modifier = Modifier.clip(shape).background(Color(0xFF1C1C24)).padding(horizontal = 12.dp, vertical = 8.dp)
    )
}

@Composable
private fun SmallChip(label: String, onClick: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Text(
        label,
        fontWeight = FontWeight.Bold,
        fontSize = 13.sp,
        modifier = Modifier.clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 12.dp)
    )
}

@Composable
private fun ListRow(icon: ImageVector?, title: String, sub: String?, chevron: Boolean, onClick: (() -> Unit)?) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(T2Radius.sm))
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (icon != null) {
            val shape = RoundedCornerShape(T2Radius.sm)
            Box(
                modifier = Modifier.size(48.dp).clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape),
                contentAlignment = Alignment.Center
            ) { Icon(icon, contentDescription = null, tint = T2Colors.text, modifier = Modifier.size(22.dp)) }
            Spacer(Modifier.width(T2Spacing.sp4))
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.ExtraBold, fontSize = 15.sp)
            if (sub != null) Text(sub, color = T2Colors.hint, fontSize = 12.sp)
        }
        if (chevron) Text("›", color = T2Colors.hint, fontSize = 22.sp)
    }
}

@Composable
private fun Ring(pct: Int) {
    val p = pct.coerceIn(0, 100)
    val bg = T2Colors.surface2
    val fg = pctColor(p)
    Box(modifier = Modifier.size(88.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(88.dp)) {
            val stroke = 8.dp.toPx()
            val arcSize = Size(size.width - stroke, size.height - stroke)
            val topLeft = Offset(stroke / 2, stroke / 2)
            drawArc(bg, -90f, 360f, false, topLeft, arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
            drawArc(fg, -90f, 360f * p / 100f, false, topLeft, arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("$p%", fontWeight = FontWeight.ExtraBold, fontSize = 20.sp)
            Text("ПЛАН", color = T2Colors.hint, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun LinkPhoneDialog(onDismiss: () -> Unit, onSave: (String, String) -> Unit) {
    var phone by remember { mutableStateOf("") }
    var pw by remember { mutableStateOf("") }
    var pw2 by remember { mutableStateOf("") }
    SheetDialog("Вход с компьютера", onDismiss) {
        Text(
            "Придумай телефон и пароль — так можно будет войти в T2 Sales с компьютера или телефона без Telegram.",
            color = T2Colors.hint, fontSize = 14.sp, modifier = Modifier.padding(bottom = 16.dp)
        )
        Field("Телефон", phone, { phone = it }, fill = T2Colors.surface2)
        Spacer(Modifier.height(12.dp))
        Field("Пароль", pw, { pw = it }, password = true, fill = T2Colors.surface2)
        Spacer(Modifier.height(12.dp))
        Field("Повторите пароль", pw2, { pw2 = it }, password = true, fill = T2Colors.surface2)
        Spacer(Modifier.height(16.dp))
        MainButton("Привязать", enabled = true) {
            when {
                phone.isBlank() -> T2Toast.show("Введите телефон", true)
                pw.length < 8 -> T2Toast.show("Пароль должен быть от 8 символов", true)
                pw != pw2 -> T2Toast.show("Пароли не совпадают", true)
                else -> onSave(phone.trim(), pw)
            }
        }
    }
}

@Composable
private fun QuickSaleDialog(api: ru.t2sales.shared.api.ProfileApi, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf("") }
    var preview by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val clientId = remember { UUID.randomUUID().toString() }
    SheetDialog("Быстрый ввод", onDismiss) {
        Text("Пример: две симки и одно mnp · 3 sim 1 па", color = T2Colors.hint, fontSize = 14.sp, modifier = Modifier.padding(bottom = 12.dp))
        Field("Фраза", text, { text = it }, fill = T2Colors.surface2)
        preview?.let { Text(it, color = T2Colors.textSecondary, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp)) }
        Spacer(Modifier.height(16.dp))
        MainButton(if (busy) "Записываем…" else "Разобрать и записать", enabled = !busy) {
            if (text.isBlank()) {
                T2Toast.show("Введи фразу", true)
                return@MainButton
            }
            busy = true
            scope.launch {
                runCatching { api.quickSale(text, clientId) }
                    .onSuccess { r ->
                        val m = r.parsed?.metrics.orEmpty()
                        T2Toast.show("Записано: " + m.entries.joinToString(", ") { "${it.key} ${fmtNum(it.value)}" })
                        AddSaleState.refreshTick++
                        onDismiss()
                    }
                    .onFailure { T2Toast.show(it.message ?: "Ошибка", true); busy = false }
            }
        }
        Spacer(Modifier.height(8.dp))
        Text(
            "Только разобрать",
            color = T2Colors.text,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable {
                scope.launch {
                    runCatching { api.parseSale(text) }.onSuccess { p ->
                        preview = if (p.metrics.isEmpty()) "Не разобрано"
                        else p.metrics.entries.joinToString(", ") { "${it.key}: ${fmtNum(it.value)}" } + " · confidence " + ((p.confidence ?: 0.0) * 100).roundToInt() + "%"
                    }.onFailure { T2Toast.show(it.message ?: "Ошибка", true) }
                }
            }.padding(vertical = 12.dp)
        )
    }
}

private fun fmtNum(v: Double) = if (v % 1.0 == 0.0) v.toLong().toString() else "%.1f".format(v)

private fun moscowTime(iso: String?): String = runCatching {
    OffsetDateTime.parse(iso).atZoneSameInstant(MOSCOW).format(DateTimeFormatter.ofPattern("HH:mm"))
}.getOrDefault("—")

private fun fmtDateTime(iso: String): String = runCatching {
    OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("dd.MM.yyyy, HH:mm"))
}.getOrDefault(iso)

/** Port of shared/device-label.ts describeUserAgent: "🌐/📱/💻 Browser, OS". */
private fun describeUserAgent(ua: String?): String {
    if (ua.isNullOrBlank()) return "🌐 Неизвестное устройство"
    val tablet = "iPad" in ua || ("Android" in ua && "Mobile" !in ua)
    val mobile = Regex("Mobi|Android|iPhone|iPod").containsMatchIn(ua) || tablet
    val os = when {
        "iPad" in ua -> "iPadOS"
        "iPhone" in ua -> "iOS"
        "iPod" in ua -> "iOS (iPod touch)"
        "Android" in ua -> Regex("Android [\\d.]+;\\s*([^;)]+?)(?:\\s+Build/|\\))").find(ua)?.groupValues?.get(1)?.trim()?.takeIf { it.length > 1 }?.let { "Android ($it)" } ?: "Android"
        "Windows" in ua -> "Windows"
        "Mac OS X" in ua -> "macOS"
        "Linux" in ua -> "Linux"
        else -> "Неизвестная ОС"
    }
    val browser = when {
        "YaBrowser" in ua -> "Яндекс Браузер"
        "Edg/" in ua -> "Edge"
        "OPR/" in ua || "Opera" in ua -> "Opera"
        "Firefox" in ua -> "Firefox"
        "Chrome" in ua -> "Chrome"
        "Safari" in ua -> "Safari"
        else -> "Браузер"
    }
    return (if (mobile) "📱 " else "💻 ") + "$browser, $os"
}

private fun pickAvatar(container: AppContainer, empId: Int?, scope: kotlinx.coroutines.CoroutineScope) {
    val dlg = FileDialog(null as java.awt.Frame?, "Выберите фото", FileDialog.LOAD)
    dlg.isVisible = true
    val name = dlg.file ?: return
    val file = File(dlg.directory, name)
    scope.launch {
        runCatching {
            val src = ImageIO.read(file) ?: error("image")
            val scale = minOf(1.0, 256.0 / maxOf(src.width, src.height))
            val w = (src.width * scale).roundToInt().coerceAtLeast(1)
            val h = (src.height * scale).roundToInt().coerceAtLeast(1)
            val out = java.awt.image.BufferedImage(w, h, java.awt.image.BufferedImage.TYPE_INT_RGB)
            val g = out.createGraphics()
            g.setRenderingHint(java.awt.RenderingHints.KEY_INTERPOLATION, java.awt.RenderingHints.VALUE_INTERPOLATION_BILINEAR)
            g.drawImage(src, 0, 0, w, h, null)
            g.dispose()
            val writer = ImageIO.getImageWritersByFormatName("jpeg").next()
            val param = writer.defaultWriteParam.apply { compressionMode = ImageWriteParam.MODE_EXPLICIT; compressionQuality = 0.85f }
            val bytes = ByteArrayOutputStream()
            writer.output = ImageIO.createImageOutputStream(bytes)
            writer.write(null, IIOImage(out, null, null), param)
            writer.dispose()
            container.profileApi.uploadAvatar(bytes.toByteArray())
        }.onSuccess {
            empId?.let { container.teamApi.forgetAvatar(it) }
            AvatarVersion.v++
            T2Toast.show("Аватарка обновлена")
        }.onFailure { T2Toast.show("Не удалось загрузить фото", true) }
    }
}

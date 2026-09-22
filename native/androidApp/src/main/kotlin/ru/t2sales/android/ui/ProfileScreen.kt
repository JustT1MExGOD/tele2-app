package ru.t2sales.android.ui

import android.graphics.BitmapFactory
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
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
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import kotlinx.coroutines.coroutineScope
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
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
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.roundToInt
import kotlinx.coroutines.launch
import ru.t2sales.android.AppContainer
import ru.t2sales.shared.api.BfqItem
import ru.t2sales.shared.api.MeDayResponse
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.api.MonthSummaryRow
import ru.t2sales.shared.api.MyInsightResponse
import ru.t2sales.shared.api.ScheduleRow
import ru.t2sales.shared.api.SelfStatsResponse
import ru.t2sales.shared.api.SessionListItem
import ru.t2sales.shared.api.ShiftCurrentResponse
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Radius
import ru.t2sales.shared.theme.T2Spacing

private val MOSCOW = ZoneId.of("Europe/Moscow")

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

/** Mobile port of pages/my-plan («Мой план»): the personal cabinet, sections in the web's order (index.html #lkRoot). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ProfileScreen(container: AppContainer, me: MeResponse, onOpenSchedule: () -> Unit, onLogout: () -> Unit) {
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

    // every block loads on its own and independently: the page fills in as the answers arrive, nothing waits for the slowest one
    LaunchedEffect(AppState.refreshTick) {
        coroutineScope {
            launch { runCatching { container.homeApi.getMyDay() }.onSuccess { myDay = it } }
            launch { runCatching { api.getMonthPlans(month) }.onSuccess { r -> monthRow = r.rows.firstOrNull { it.employee_id == empId } }; monthLoaded = true }
            launch {
                runCatching { container.scheduleApi.getScheduleMonth(month) }.onSuccess { r ->
                    mySchedule = r.items.filter { it.employee_id == empId }.associateBy { it.work_date.take(10) }
                }
            }
            launch { runCatching { api.getBfq(month) }.onSuccess { bfq = it.items } }
            launch { runCatching { api.getShiftCurrent() }.onSuccess { shift = it } }
            launch { runCatching { api.getInsight() }.onSuccess { insight = it } }
            launch { runCatching { api.getSelfStats() }.onSuccess { self = it } }
        }
    }
    LaunchedEffect(sessionsKey) { runCatching { api.listSessions() }.onSuccess { sessions = it.sessions } }

    val day = myDay
    val store = day?.shift
    val storeName = store?.store_name ?: store?.store_id
    val dayPct = day?.total?.let { t -> t.pct.roundToInt().takeIf { t.pct > 0 } ?: if (t.plan > 0) ((t.fact / t.plan) * 100).roundToInt() else 0 } ?: 0
    val sess = shift?.session

    Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 12.dp)) {
        // --- hero
        val heroShape = RoundedCornerShape(T2Radius.default)
        Column(
            Modifier.fillMaxWidth().clip(heroShape).background(Brush.linearGradient(listOf(Color(0xFF0A0A0B), Color(0xFF141422), Color(0xFF0E1C2E))))
                .border(1.dp, Color(0x0FFFFFFF), heroShape).padding(start = T2Spacing.sp4, end = T2Spacing.sp4, top = T2Spacing.sp5, bottom = T2Spacing.sp4)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box {
                    AvatarImage(container, empId, (me.full_name ?: "T").take(1).uppercase(), 64.dp)
                    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
                        if (uri != null) pickAvatar(container, empId, scope, uri)
                    }
                    Box(
                        Modifier.align(Alignment.BottomEnd).size(22.dp).clip(CircleShape).background(T2Colors.primary)
                            .clickable { picker.launch("image/*") },
                        contentAlignment = Alignment.Center
                    ) { Text("✎", color = Color.White, fontSize = 11.sp) }
                }
                Spacer(Modifier.width(14.dp))
                Column {
                    Text(me.full_name ?: "Сотрудник", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold)
                    Spacer(Modifier.height(4.dp))
                    val manager = me.role == "manager" || me.role == "admin"
                    Text(
                        ROLE_LABELS[me.role ?: "employee"] ?: (me.role ?: "Продавец"),
                        color = if (manager) Color(0xFFFFD60A) else Color(0xE6FFFFFF), fontSize = 12.sp, fontWeight = FontWeight.Bold,
                        modifier = Modifier.clip(RoundedCornerShape(20.dp)).background(if (manager) Color(0x33FFD60A) else Color(0x1FFFFFFF)).padding(horizontal = 10.dp, vertical = 4.dp)
                    )
                }
            }
            Spacer(Modifier.height(14.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                HeroPill(storeName ?: "Сегодня выходной")
                store?.shift_text?.takeIf { it.isNotBlank() }?.let { HeroPill(it + (store.hours?.let { h -> " · ${h.toInt()}ч" } ?: "")) }
                HeroPill(today.format(DateTimeFormatter.ofPattern("dd.MM.yyyy")))
            }
        }
        Spacer(Modifier.height(T2Spacing.sp3))

        // --- shift (lkShift)
        if (shift != null) {
            Card {
                if (sess != null) {
                    CardTitle("Смена открыта")
                    Text("${sess.store_name ?: sess.store_id ?: ""} · с ${moscowTime(sess.opened_at)} МСК", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(bottom = 10.dp))
                    listOf("sim", "mnp", "pa", "combo").forEach { m -> ProgressRow(METRIC_LABELS[m] ?: m, shift?.fact?.get(m) ?: 0.0, shift?.day_plan?.get(m) ?: 0.0) }
                    Spacer(Modifier.height(10.dp))
                    MainButton("Закрыть смену", container = Color(0xFFE74C3C), content = Color.White) { ShiftUi.closing = true }
                } else {
                    CardTitle("Смена")
                    Text("Открой смену на точке — зафиксируем время", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(bottom = 10.dp))
                    MainButton("Открыть смену") { ShiftUi.open(container, scope) }
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
                i.projected_total?.let { projected ->
                    val onTrack = i.on_track == true
                    Text(
                        "При текущем темпе к концу дня: ~${projected.roundToInt()} (план ${(i.plan_total ?: 0.0).roundToInt()})" + if (onTrack) "" else " — вероятно, не хватит",
                        color = if (onTrack) T2Colors.hint else Color(0xFFE74C3C), fontSize = 12.sp, modifier = Modifier.padding(top = 10.dp)
                    )
                }
            }
            Spacer(Modifier.height(T2Spacing.sp3))
        }

        // --- today ring (lkToday): only on a working day
        if (storeName != null) {
            SectionLabel("Сегодня")
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(T2Radius.default)).background(T2Colors.surface).padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically
            ) {
                Ring(dayPct)
                Column {
                    Text("Смена на точке", fontSize = 15.sp, fontWeight = FontWeight.ExtraBold)
                    Text("Выполнение дневного плана по ключевым метрикам.", color = T2Colors.textSecondary, fontSize = 13.sp)
                    Spacer(Modifier.height(8.dp))
                    Row(Modifier.clip(RoundedCornerShape(10.dp)).background(T2Colors.surface2).padding(horizontal = 10.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
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
                Text(if (monthLoaded) "Месячный план подтянется, когда будут данные" else "Загрузка…", color = T2Colors.hint, modifier = Modifier.padding(vertical = 8.dp))
            }
        }
        Spacer(Modifier.height(T2Spacing.sp3))

        // --- week (lkWeek)
        SectionLabel("Моя неделя")
        val monday = today.minusDays((today.dayOfWeek.value - 1).toLong())
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            val wd = listOf("пн", "вт", "ср", "чт", "пт", "сб", "вс")
            (0..6).forEach { i ->
                val d = monday.plusDays(i.toLong())
                val sch = mySchedule[d.toString()]
                val shape = RoundedCornerShape(14.dp)
                Column(
                    Modifier.width(52.dp).clip(shape).background(T2Colors.surface).border(2.dp, if (d == today) T2Colors.primary else Color.Transparent, shape).padding(horizontal = 6.dp, vertical = 10.dp),
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
            Modifier.fillMaxWidth().clip(RoundedCornerShape(T2Radius.default)).background(Brush.linearGradient(listOf(Color(0xFF1A1A2E), Color(0xFF0F3460)))).padding(horizontal = 18.dp, vertical = 16.dp),
            horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text("BFQ ЗА МЕСЯЦ", color = Color(0xB3FFFFFF), fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp)
                Text(myBfq?.total?.let { fmtNum(it) } ?: "—", color = Color.White, fontSize = 32.sp, fontWeight = FontWeight.ExtraBold)
            }
            Text(if (rank != null) "#$rank в сети" else "Нет рейтинга", color = Color(0xD9FFFFFF), fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        }
        Spacer(Modifier.height(T2Spacing.sp3))

        // --- gamification (lkGamification)
        self?.gamification?.let { g ->
            Card {
                CardTitle("Прогресс")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    DarkPill("lvl ${g.level} ${g.title ?: ""}")
                    DarkPill("XP ${g.xp}" + (g.next_level_xp?.let { " / $it" } ?: ""))
                    DarkPill("🔥 ${g.streak_days} дн.")
                }
                self?.best_shift?.let { b -> Text("Лучшая смена: ${b.date} · score ${fmtNum(b.score)}", color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp)) }
            }
            Spacer(Modifier.height(T2Spacing.sp3))
        }

        // --- actions (lkActions): only the ones whose screens exist on the phone so far
        SectionLabel("Действия")
        Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ActionTile(NavIcons.plus, "Продажа", "Внести метрики", Modifier.weight(1f)) { AppState.openAddSale() }
            ActionTile(NavIcons.schedule, "График", "Месяц целиком", Modifier.weight(1f), onOpenSchedule)
            ActionTile("⏱", "Смена", "Открыть / закрыть", Modifier.weight(1f)) { if (sess != null) ShiftUi.closing = true else ShiftUi.open(container, scope) }
        }
        Spacer(Modifier.height(T2Spacing.sp2))

        // --- account (lkPhoneAuth): the phone is already the login here, so only sign-out
        Card {
            CardTitle("Аккаунт")
            me.phone?.let { ListRow(NavIcons.smartphone, "Вход по телефону", it, chevron = false) }
            ListRow(NavIcons.logOut, "Выйти", null, chevron = false) {
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
                    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(device + if (s.current) " · это устройство" else "", fontWeight = FontWeight.ExtraBold, fontSize = 15.sp)
                            Text(subtitle, color = T2Colors.hint, fontSize = 12.sp)
                        }
                        if (!s.current) {
                            val shape = RoundedCornerShape(12.dp)
                            Text(
                                "Завершить", fontWeight = FontWeight.Bold, fontSize = 13.sp,
                                modifier = Modifier.clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape).clickable {
                                    scope.launch {
                                        runCatching { api.revokeSession(s.id) }
                                            .onSuccess { Toaster.show("Сессия завершена"); sessionsKey++ }
                                            .onFailure { Toaster.show(it.message ?: "Не удалось завершить сессию", true) }
                                    }
                                }.padding(horizontal = 12.dp, vertical = 12.dp)
                            )
                        }
                    }
                }
                if (sessions.size > 1) ListRow("×", "Завершить остальные", null, chevron = false) {
                    scope.launch {
                        runCatching { api.revokeOtherSessions() }
                            .onSuccess { Toaster.show("Остальные сессии завершены"); sessionsKey++ }
                            .onFailure { Toaster.show(it.message ?: "Не удалось завершить сессии", true) }
                    }
                }
            }
        }
        Spacer(Modifier.height(96.dp)) // clears the "+" button
    }
}

@Composable
private fun Card(content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(T2Radius.default)
    Column(Modifier.fillMaxWidth().clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape).padding(16.dp)) { content() }
}

@Composable
private fun CardTitle(text: String) = Text(text, fontSize = 15.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(bottom = 8.dp))

@Composable
private fun SectionLabel(text: String) =
    Text(text.uppercase(), color = T2Colors.hint, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.7.sp, modifier = Modifier.padding(top = 4.dp, bottom = 8.dp))

@Composable
private fun HeroPill(text: String) {
    Text(text, color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.clip(RoundedCornerShape(20.dp)).background(Color(0x1FFFFFFF)).padding(horizontal = 10.dp, vertical = 5.dp))
}

@Composable
private fun DarkPill(text: String) {
    Text(text, fontSize = 12.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clip(RoundedCornerShape(20.dp)).background(T2Colors.surface2).padding(horizontal = 10.dp, vertical = 6.dp))
}

@Composable
private fun ActionTile(glyph: String, title: String, sub: String, modifier: Modifier, onClick: () -> Unit) {
    ActionTile(modifier, onClick, title, sub) { Text(glyph, fontSize = 20.sp, color = T2Colors.primary, fontWeight = FontWeight.Bold) }
}

/** "Продажа" and "График" have real web icons ("+" and the calendar the bottom-nav "График" tab already uses); "Смена" doesn't (the
 * desktop client's own reference for this row has no icon either), so it keeps its plain glyph via the overload above. */
@Composable
private fun ActionTile(icon: androidx.compose.ui.graphics.Path, title: String, sub: String, modifier: Modifier, onClick: () -> Unit) {
    ActionTile(modifier, onClick, title, sub) { NavIcon(icon, contentDescription = title, tint = T2Colors.primary, size = 20.dp) }
}

@Composable
private fun ActionTile(modifier: Modifier, onClick: () -> Unit, title: String, sub: String, icon: @Composable () -> Unit) {
    val shape = RoundedCornerShape(T2Radius.md)
    Column(
        modifier.clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape).clickable(onClick = onClick).padding(horizontal = 8.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        icon()
        Text(title, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(top = 4.dp), maxLines = 1)
        Text(sub, color = T2Colors.hint, fontSize = 10.sp, maxLines = 1)
    }
}

@Composable
private fun Ring(pct: Int) {
    val target = pct.coerceIn(0, 100)
    val sweep = animatedFloat(target / 100f, 900) // the ring fills up when it appears
    val p = animatedInt(target, 900)
    val bg = T2Colors.surface2
    val fg = pctColor(p)
    Box(Modifier.size(88.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(88.dp)) {
            val stroke = 8.dp.toPx()
            val arcSize = Size(size.width - stroke, size.height - stroke)
            val topLeft = Offset(stroke / 2, stroke / 2)
            drawArc(bg, -90f, 360f, false, topLeft, arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
            drawArc(fg, -90f, 360f * sweep, false, topLeft, arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("$p%", fontWeight = FontWeight.ExtraBold, fontSize = 20.sp)
            Text("ПЛАН", color = T2Colors.hint, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

/** Reads the picked photo, downsizes it to the PC client's own limit (256px on the long side) and re-encodes as JPEG before
 * uploading — the source file from a phone's camera can be several megabytes, nobody needs that for a 64dp avatar circle. */
private fun pickAvatar(container: AppContainer, employeeId: Int?, scope: kotlinx.coroutines.CoroutineScope, uri: android.net.Uri) {
    scope.launch {
        runCatching {
            val ctx = ru.t2sales.shared.auth.AndroidPlatform.appContext
            val src = ctx.contentResolver.openInputStream(uri)?.use { android.graphics.BitmapFactory.decodeStream(it) } ?: error("image")
            val scale = minOf(1f, 256f / maxOf(src.width, src.height))
            val w = (src.width * scale).roundToInt().coerceAtLeast(1)
            val h = (src.height * scale).roundToInt().coerceAtLeast(1)
            val scaled = android.graphics.Bitmap.createScaledBitmap(src, w, h, true)
            val out = java.io.ByteArrayOutputStream()
            scaled.compress(android.graphics.Bitmap.CompressFormat.JPEG, 85, out)
            container.profileApi.uploadAvatar(out.toByteArray())
        }.onSuccess {
            employeeId?.let { container.teamApi.forgetAvatar(it) }
            AvatarVersion.v++
            Toaster.show("Аватар обновлён")
        }.onFailure { Toaster.show("Не удалось загрузить фото", true) }
    }
}

/** The employee's photo when there is one, otherwise the first letter. */
@Composable
fun AvatarImage(container: AppContainer, employeeId: Int?, fallback: String, size: Dp) {
    val bitmap by produceState<ImageBitmap?>(null, employeeId, AvatarVersion.v) {
        value = employeeId?.let { id ->
            container.teamApi.getAvatar(id)?.let { bytes -> runCatching { BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap() }.getOrNull() }
        }
    }
    Box(Modifier.size(size).clip(CircleShape).background(T2Colors.surface2).border(1.dp, T2Colors.border, CircleShape), contentAlignment = Alignment.Center) {
        val bmp = bitmap
        if (bmp != null) Image(bmp, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.size(size))
        else Text(fallback, fontWeight = FontWeight.Bold, color = T2Colors.text, fontSize = 20.sp)
    }
}

private fun fmtNum(v: Double) = if (v % 1.0 == 0.0) v.toLong().toString() else "%.1f".format(java.util.Locale.US, v)

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
        "T2Sales/" in ua -> "Приложение T2 Sales"
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

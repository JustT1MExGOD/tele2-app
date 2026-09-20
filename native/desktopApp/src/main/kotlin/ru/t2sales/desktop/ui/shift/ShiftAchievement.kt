package ru.t2sales.desktop.ui.shift

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.roundToInt
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import ru.t2sales.desktop.di.AppContainer
import ru.t2sales.desktop.ui.components.MainButton
import ru.t2sales.desktop.ui.components.Motion
import ru.t2sales.desktop.ui.components.SheetDialog
import ru.t2sales.desktop.ui.components.T2Toast
import ru.t2sales.desktop.ui.components.animatedFloat
import ru.t2sales.desktop.ui.components.animatedInt
import ru.t2sales.desktop.ui.components.reveal
import ru.t2sales.desktop.ui.components.shimmer
import ru.t2sales.desktop.ui.home.ProgressRow
import ru.t2sales.desktop.ui.shell.AppNav
import ru.t2sales.shared.theme.T2Colors

private fun JsonElement?.obj(): JsonObject = this as? JsonObject ?: JsonObject(emptyMap())
private fun JsonElement?.num(): Double = (this as? JsonPrimitive)?.doubleOrNull ?: 0.0
private fun JsonElement?.text(): String = (this as? JsonPrimitive)?.contentOrNull ?: ""
private fun JsonElement?.list(): List<JsonElement> = (this as? JsonArray) ?: emptyList()
/** One decimal with the Russian comma, whatever the computer's locale is. */
private fun one(v: Double) = String.format(java.util.Locale("ru", "RU"), "%.1f", v)

private fun fmt(v: Double) = if (v % 1.0 == 0.0) v.toLong().toString() else one(v)

private val MOSCOW = ZoneId.of("Europe/Moscow")
private val UNIT_KEYS = listOf("sim", "mnp", "pa", "combo")

/** Units (SIM + MNP + ПА + комбо) one employee sold on a day, from the day's raw rows. */
internal fun unitsOf(rows: JsonArray, employeeId: Int): Int = rows.sumOf { el ->
    val o = el as? JsonObject ?: return@sumOf 0
    if ((o["employee_id"] as? JsonPrimitive)?.intOrNull != employeeId) 0 else UNIT_KEYS.sumOf { (o[it] as? JsonPrimitive)?.doubleOrNull ?: 0.0 }.roundToInt()
}

/** The plain-text summary of a closed shift, for pasting into a chat. */
internal fun shiftSummaryText(data: JsonObject): String {
    val fact = data["fact"].obj(); val plan = data["day_plan"].obj(); val gam = data["gamification"].obj()
    val parts = mutableListOf<String>()
    parts += (if ((data["ideal_shift"] as? JsonPrimitive)?.content == "true") "🏆 Идеальная смена" else "Смена закрыта") + " · итог ${fmt(data["score"].num())}"
    parts += listOf("sim" to "SIM", "mnp" to "MNP", "pa" to "ПА", "combo" to "Комбо").filter { plan[it.first].num() > 0 || fact[it.first].num() > 0 }
        .joinToString(", ") { (id, l) -> "$l ${fmt(fact[id].num())}/${fmt(plan[id].num())}" }
    if (gam["xp_gained"].num() > 0) parts += "+${fmt(gam["xp_gained"].num())} XP"
    if (gam["streak_days"].num() > 0) parts += "🔥 ${gam["streak_days"].num().toInt()} дн. подряд"
    return parts.filter { it.isNotBlank() }.joinToString(" · ")
}

/**
 * The card you get when a shift is closed: the score counts up, the day's plan bars fill, the XP bar fills to the new level, the streak
 * flame burns, a new level or a perfect shift gets its own moment. The numbers come from the server's answer to closing the shift.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ShiftResultCard(data: JsonObject, container: AppContainer, onDismiss: () -> Unit) {
    val fact = data["fact"].obj(); val plan = data["day_plan"].obj(); val gam = data["gamification"].obj()
    val missing = data["ideal_missing"].list().map { it.text() }
    val ideal = (data["ideal_shift"] as? JsonPrimitive)?.content == "true"
    val score = data["score"].num()
    val levelUp = (gam["leveled_up"] as? JsonPrimitive)?.content == "true"
    val streak = gam["streak_days"].num().toInt()

    // today against yesterday, for this employee (two read-only requests)
    var vsYesterday by remember { mutableStateOf<Int?>(null) }
    LaunchedEffect(Unit) {
        val me = AppNav.myEmployeeId ?: return@LaunchedEffect
        val today = LocalDate.now(MOSCOW)
        val a = runCatching { container.teamApi.getSales(today.toString()) }.getOrNull()
        val b = runCatching { container.teamApi.getSales(today.minusDays(1).toString()) }.getOrNull()
        if (a != null && b != null) vsYesterday = unitsOf(a, me) - unitsOf(b, me)
    }

    SheetDialog(if (ideal) "🏆 Идеальная смена" else "Смена закрыта", onDismiss) {
        // ---- the score
        val heroShape = RoundedCornerShape(22.dp)
        Box(
            Modifier.fillMaxWidth().clip(heroShape)
                .background(Brush.verticalGradient(if (ideal) listOf(Color(0x33FFD60A), Color(0x0FFFD60A)) else listOf(T2Colors.primarySoft, Color.Transparent)))
                .then(if (ideal) Modifier.shimmer() else Modifier)
                .padding(vertical = 18.dp),
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                val shown = animatedFloat(score.toFloat(), 1300)
                Text(if (score % 1.0 == 0.0) shown.roundToInt().toString() else one(shown.toDouble()), fontSize = 54.sp, fontWeight = FontWeight.Black, color = if (ideal) Color(0xFFFFB800) else T2Colors.text)
                Text("итоговый score", color = T2Colors.hint, fontSize = 12.sp)
            }
        }
        Spacer(Modifier.height(12.dp))

        // ---- chips: against yesterday, the streak
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            vsYesterday?.let { d ->
                val text = when { d > 0 -> "▲ +$d к вчера"; d < 0 -> "▼ $d к вчера"; else -> "= как вчера" }
                Box(Modifier.reveal(1)) { Pill(text, if (d > 0) T2Colors.success else if (d < 0) T2Colors.danger else T2Colors.hint, if (d > 0) T2Colors.successSoft else T2Colors.surface2) }
            }
            if (streak > 0) Box(Modifier.reveal(2)) { StreakPill(streak) }
        }
        Spacer(Modifier.height(10.dp))

        // ---- plan vs fact: the bars fill in
        Column(Modifier.reveal(2)) {
            listOf("sim" to "SIM", "mnp" to "MNP", "pa" to "ПА", "combo" to "Комбо").forEach { (id, l) -> ProgressRow(l, fact[id].num(), plan[id].num()) }
        }
        if (!ideal && missing.isNotEmpty()) Text("До идеальной смены: ${missing.joinToString(", ")}", color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 10.dp))
        data["ai_summary"].text().takeIf { it.isNotEmpty() }?.let { ai ->
            Spacer(Modifier.height(12.dp))
            Text(ai, fontSize = 13.sp, lineHeight = 19.sp, modifier = Modifier.reveal(3).fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(T2Colors.surface2).padding(12.dp))
        }
        Spacer(Modifier.height(12.dp))

        // ---- level and XP
        Column(Modifier.reveal(4).fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(T2Colors.surface2).padding(14.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("${gam["title"].text()} · ур. ${gam["level"].num().toInt().coerceAtLeast(1)}", fontWeight = FontWeight.Bold)
                val gained = animatedInt(gam["xp_gained"].num().roundToInt(), 1000)
                if (gam["xp_gained"].num() > 0) Text("+$gained XP", color = T2Colors.success, fontWeight = FontWeight.ExtraBold)
            }
            val next = (gam["next_level_xp"] as? JsonPrimitive)?.doubleOrNull
            if (next != null && next > 0) {
                val filled = animatedFloat((gam["xp"].num() / next).toFloat().coerceIn(0f, 1f), 1200)
                Box(Modifier.padding(top = 10.dp).fillMaxWidth().height(8.dp).clip(RoundedCornerShape(99.dp)).background(T2Colors.surface3)) {
                    Box(Modifier.fillMaxWidth(filled).height(8.dp).clip(RoundedCornerShape(99.dp)).background(Brush.horizontalGradient(listOf(T2Colors.primary.copy(alpha = 0.7f), T2Colors.primary))))
                }
                Text("${fmt(gam["xp"].num())} / ${fmt(next)} XP", color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
            } else {
                Text("${fmt(gam["xp"].num())} XP", color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
            }
            if (levelUp) LevelUp(gam["level"].num().toInt())
            if ((data["rewarded"] as? JsonPrimitive)?.content == "false") Text("Смена на эту дату уже была закрыта и награждена сегодня — XP не начисляется повторно.", color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
        }

        Spacer(Modifier.height(16.dp))
        MainButton("Скопировать итог", enabled = true, container = T2Colors.surface2, content = T2Colors.text) {
            runCatching { java.awt.Toolkit.getDefaultToolkit().systemClipboard.setContents(java.awt.datatransfer.StringSelection(shiftSummaryText(data)), null) }
                .onSuccess { T2Toast.show("Итог смены скопирован") }
                .onFailure { T2Toast.show("Не удалось скопировать", true) }
        }
        Spacer(Modifier.height(8.dp))
        MainButton("Понятно", enabled = true, onClick = onDismiss)
    }
}

@Composable
private fun Pill(text: String, color: Color, bg: Color) {
    Text(text, color = color, fontSize = 13.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clip(RoundedCornerShape(99.dp)).background(bg).padding(horizontal = 12.dp, vertical = 6.dp))
}

/** The streak: a flame that breathes. */
@Composable
private fun StreakPill(days: Int) {
    val pulse by rememberInfiniteTransition().animateFloat(1f, 1.22f, infiniteRepeatable(tween(900, easing = LinearEasing), RepeatMode.Reverse))
    Row(Modifier.clip(RoundedCornerShape(99.dp)).background(Color(0x22FF9F0A)).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("🔥", fontSize = 14.sp, modifier = Modifier.graphicsLayer { scaleX = pulse; scaleY = pulse })
        Text("  $days ${dayWord(days)} подряд", color = Color(0xFFFF9F0A), fontSize = 13.sp, fontWeight = FontWeight.Bold)
    }
}

private fun dayWord(n: Int) = when { n % 100 in 11..14 -> "дней"; n % 10 == 1 -> "день"; n % 10 in 2..4 -> "дня"; else -> "дней" }

/** A new level pops in with a little bounce. */
@Composable
private fun LevelUp(level: Int) {
    val s = remember { Animatable(0.4f) }
    LaunchedEffect(Unit) { s.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow)) }
    Text(
        "🎉 Новый уровень: $level", color = Color(0xFF1B1B1F), fontSize = 14.sp, fontWeight = FontWeight.ExtraBold,
        modifier = Modifier.padding(top = 12.dp).graphicsLayer { scaleX = s.value; scaleY = s.value; alpha = s.value.coerceIn(0f, 1f) }
            .clip(RoundedCornerShape(12.dp)).background(Brush.horizontalGradient(listOf(Color(0xFFFFD60A), Color(0xFFFF9F0A)))).padding(horizontal = 14.dp, vertical = 8.dp)
    )
}

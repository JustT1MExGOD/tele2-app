package ru.t2sales.desktop.ui.home

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Column
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalTime
import java.time.ZoneId
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonObject
import ru.t2sales.desktop.di.AppContainer
import ru.t2sales.desktop.ui.analytics.arr
import ru.t2sales.desktop.ui.analytics.dbl
import ru.t2sales.desktop.ui.analytics.obj
import ru.t2sales.desktop.ui.components.Motion
import ru.t2sales.desktop.ui.components.animatedInt
import ru.t2sales.shared.api.MeDayResponse
import ru.t2sales.shared.theme.T2Colors

private val MOSCOW = ZoneId.of("Europe/Moscow")
private const val OPEN = 9.0
private const val CLOSE = 21.0
private val UNIT_METRICS = listOf("sim", "mnp", "pa", "combo")

/** Result of the pace calculation, kept separate from the drawing so it can be tested. */
internal class Pace(
    val plan: Double,
    val fact: Double,
    /** Where the day should be by now, on the store's usual rhythm. */
    val expectedNow: Double,
    /** The day's end if the rest of it goes like the usual rhythm from here; null while too little of the day has passed to say. */
    val projected: Double?,
    val hour: Double
) {
    /** "Will you make the plan": projected end / plan, in percent. */
    val chancePct: Int? get() = projected?.let { (it / plan * 100).roundToInt().coerceIn(0, 999) }
    val delta: Double get() = fact - expectedNow
}

/** Share of the day's sales done by [hour] (0..1) from the hourly profile; hour is fractional (14.5 = 14:30). */
internal fun shareBy(profile: Map<Int, Double>, hour: Double): Double {
    val total = (OPEN.toInt() until CLOSE.toInt()).sumOf { (profile[it] ?: 0.0).coerceAtLeast(0.0) }
    if (total <= 0.0) return ((hour - OPEN) / (CLOSE - OPEN)).coerceIn(0.0, 1.0) // no history yet: an even day
    var acc = 0.0
    for (h in OPEN.toInt() until CLOSE.toInt()) {
        val v = (profile[h] ?: 0.0).coerceAtLeast(0.0)
        acc += when {
            hour >= h + 1 -> v
            hour > h -> v * (hour - h)
            else -> 0.0
        }
    }
    return (acc / total).coerceIn(0.0, 1.0)
}

/** Minimum share of the day that must have passed before an end-of-day projection is worth showing (otherwise one sale swings it wildly). */
private const val MIN_SHARE = 0.12

internal fun computePace(plan: Double, fact: Double, profile: Map<Int, Double>, hour: Double): Pace? {
    if (plan <= 0.0) return null
    val share = shareBy(profile, hour)
    val expected = plan * share
    val projected = if (share >= MIN_SHARE) (if (share >= 1.0) fact else fact / share) else null
    return Pace(plan, fact, expected, projected, hour)
}

/** The store's usual sales by hour, from the heatmap answer (hours 9-21). */
internal fun hourProfile(d: JsonObject): Map<Int, Double> {
    val rows = d["hours"].arr().ifEmpty { d["by_hour"].arr() }
    return rows.mapNotNull { r ->
        val o = r.obj()
        val h = o["hour"].dbl().toInt()
        val v = o["total"].dbl().takeIf { it != 0.0 } ?: o["value"].dbl().takeIf { it != 0.0 } ?: o["count"].dbl()
        if (h in 9..21) h to v else null
    }.toMap()
}

/**
 * "Темп дня": the day's rhythm as a curve - where the plan should be by each hour (from the store's usual pattern), a marker for
 * where you are now, and an end-of-day projection with a "will you make the plan" percentage. The numbers are an estimate from the
 * usual rhythm, not a promise: it says so.
 */
@Composable
fun PaceSection(myDay: MeDayResponse?, container: AppContainer) {
    val shift = myDay?.shift ?: return
    val storeId = shift.store_id ?: return
    val progress = myDay.progress ?: return
    val units = UNIT_METRICS.mapNotNull { progress[it] }
    val plan = units.sumOf { it.plan }
    val fact = units.sumOf { it.fact }
    if (plan <= 0.0) return

    var profile by remember(storeId) { mutableStateOf<Map<Int, Double>?>(null) }
    LaunchedEffect(storeId) { profile = runCatching { hourProfile(container.analyticsApi.heatmap(storeId)) }.getOrDefault(emptyMap()) }
    var hour by remember { mutableStateOf(nowHour()) }
    LaunchedEffect(Unit) { while (true) { delay(60_000); hour = nowHour() } }

    val p = profile ?: return
    val pace = computePace(plan, fact, p, hour) ?: return
    Section("Темп дня") {
        PaceBody(pace, p, shift.store_name)
    }
}

/** Moscow time as a fractional hour. `T2_PACE_HOUR=14.5` (development run only) pretends it is 14:30, to look at the daytime states at night. */
private fun nowHour(): Double =
    System.getenv("T2_PACE_HOUR")?.toDoubleOrNull()?.takeIf { !ru.t2sales.desktop.update.UpdateConfig.isPackaged }
        ?: LocalTime.now(MOSCOW).let { it.hour + it.minute / 60.0 }

@Composable
private fun PaceBody(pace: Pace, profile: Map<Int, Double>, storeName: String?) {
    val tone = when {
        pace.chancePct == null -> T2Colors.hint
        pace.chancePct!! >= 100 -> T2Colors.success
        pace.chancePct!! >= 80 -> T2Colors.warning
        else -> T2Colors.danger
    }
    val chance = pace.chancePct
    val shown = animatedInt(chance ?: 0)
    Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 14.dp)) {
        Row(verticalAlignment = Alignment.Bottom) {
            if (chance != null) {
                Text("$shown%", fontSize = 40.sp, fontWeight = FontWeight.Black, color = tone)
                Text("  успеешь к плану", fontSize = 14.sp, color = T2Colors.hint, modifier = Modifier.padding(bottom = 8.dp))
            } else {
                Text(if (pace.hour < OPEN) "День ещё не начался" else "Мало данных для прогноза", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = T2Colors.hint)
            }
        }
        val d = pace.delta.roundToInt()
        Text(
            when {
                pace.hour < OPEN -> "Ожидаемый темп появится с 9:00"
                d > 0 -> "Факт ${pace.fact.roundToInt()} · вы впереди обычного темпа на $d"
                d < 0 -> "Факт ${pace.fact.roundToInt()} · отстаёте от обычного темпа на ${abs(d)}"
                else -> "Факт ${pace.fact.roundToInt()} · ровно по обычному темпу"
            },
            color = T2Colors.textSecondary, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp, bottom = 10.dp)
        )
        PaceChart(pace, profile, tone)
        Text(
            "Оценка по обычному ритму ${storeName ?: "точки"}: единицы (SIM, MNP, ПА, комбо). Это прогноз, а не обещание.",
            color = T2Colors.hint, fontSize = 11.sp, modifier = Modifier.padding(top = 8.dp)
        )
    }
}

@Composable
private fun PaceChart(pace: Pace, profile: Map<Int, Double>, tone: Color) {
    val draw = remember { Animatable(0f) }
    LaunchedEffect(Unit) { draw.animateTo(1f, tween(1100, easing = Motion.Emphasized)) }
    val grid = T2Colors.border
    val primary = T2Colors.primary
    val hint = T2Colors.hint
    Canvas(Modifier.fillMaxWidth().height(150.dp)) {
        val left = 0f
        val right = size.width
        val top = 10.dp.toPx()
        val bottom = size.height - 18.dp.toPx()
        val yMax = maxOf(pace.plan, pace.projected ?: 0.0, pace.fact) * 1.12
        fun x(h: Double) = left + ((h - OPEN) / (CLOSE - OPEN)).toFloat().coerceIn(0f, 1f) * (right - left)
        fun y(v: Double) = bottom - (v / yMax).toFloat().coerceIn(0f, 1f) * (bottom - top)

        // horizontal guides + hour ticks
        for (i in 0..3) drawLine(grid, Offset(left, top + (bottom - top) * i / 3f), Offset(right, top + (bottom - top) * i / 3f), 1.dp.toPx())
        // plan line (the goal)
        drawLine(hint.copy(alpha = 0.55f), Offset(left, y(pace.plan)), Offset(right, y(pace.plan)), 1.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(10f, 8f)))

        // expected pace: where you should be by each hour, drawn in from the left
        val steps = 48
        val shownSteps = (steps * draw.value).toInt()
        val curve = Path()
        val fill = Path()
        for (i in 0..shownSteps) {
            val h = OPEN + (CLOSE - OPEN) * i / steps
            val px = x(h); val py = y(pace.plan * shareBy(profile, h))
            if (i == 0) { curve.moveTo(px, py); fill.moveTo(px, bottom); fill.lineTo(px, py) } else { curve.lineTo(px, py); fill.lineTo(px, py) }
        }
        if (shownSteps > 0) {
            fill.lineTo(x(OPEN + (CLOSE - OPEN) * shownSteps / steps), bottom); fill.close()
            drawPath(fill, Brush.verticalGradient(listOf(primary.copy(alpha = 0.22f), Color.Transparent), startY = top, endY = bottom))
            drawPath(curve, primary, style = Stroke(3.dp.toPx(), cap = StrokeCap.Round))
        }

        val nowX = x(pace.hour.coerceIn(OPEN, CLOSE))
        if (pace.hour in OPEN..CLOSE) {
            drawLine(hint.copy(alpha = 0.5f), Offset(nowX, top), Offset(nowX, bottom), 1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(4f, 6f)))
            // projection to the end of the day
            pace.projected?.let { end ->
                drawLine(tone, Offset(nowX, y(pace.fact)), Offset(right, y(end)), 2.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(12f, 9f)), alpha = draw.value)
                drawCircle(tone.copy(alpha = 0.35f * draw.value), 8.dp.toPx(), Offset(right, y(end)))
                drawCircle(tone.copy(alpha = draw.value), 4.dp.toPx(), Offset(right, y(end)))
            }
            // where you are now: a glowing dot on the fact
            val c = Offset(nowX, y(pace.fact))
            drawCircle(tone.copy(alpha = 0.25f * draw.value), 13.dp.toPx(), c)
            drawCircle(Color.White, 6.5.dp.toPx(), c)
            drawCircle(tone, 4.5.dp.toPx(), c)
        }
    }
    Row(Modifier.fillMaxWidth()) {
        listOf("9", "12", "15", "18", "21").forEachIndexed { i, t ->
            Text(t + ":00", color = T2Colors.hint, fontSize = 10.sp, modifier = Modifier.weight(1f), textAlign = if (i == 4) androidx.compose.ui.text.style.TextAlign.End else if (i == 0) androidx.compose.ui.text.style.TextAlign.Start else androidx.compose.ui.text.style.TextAlign.Center)
        }
    }
}

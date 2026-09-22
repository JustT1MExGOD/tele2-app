package ru.t2sales.android.ui

import android.graphics.Path as APath
import android.graphics.RectF
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asComposePath
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.unit.Dp
import androidx.core.graphics.PathParser

/**
 * The bottom navigation icons, pixel-for-pixel the same Lucide outlines the web app uses (index.html's `.nav-item .ico svg`), not
 * an approximate Material substitute — a generic "bar chart" for "План" or a filled Material bubble for "Чат" read as visibly
 * different icons on the same five-tab bar a manager already knows from the phone/web app.
 *
 * Each icon is one merged android.graphics.Path: <path> children are parsed straight from their `d` attribute (SVG path data and
 * Android's path-data mini-language are the same grammar), <rect>/<circle> children are added as native primitives — then the
 * whole thing is stroked once, matching the source's shared stroke-width/round-cap/round-join style.
 */
private fun icon(build: APath.() -> Unit): Path = APath().apply(build).asComposePath()

private fun APath.d(pathData: String) = addPath(PathParser.createPathFromPathData(pathData))
private fun APath.rect(x: Float, y: Float, w: Float, h: Float, r: Float) = addRoundRect(RectF(x, y, x + w, y + h), r, r, APath.Direction.CW)
private fun APath.circle(cx: Float, cy: Float, r: Float) = addCircle(cx, cy, r, APath.Direction.CW)
private fun APath.line(x1: Float, y1: Float, x2: Float, y2: Float) { moveTo(x1, y1); lineTo(x2, y2) }
private fun APath.polyline(vararg points: Float) {
    moveTo(points[0], points[1])
    var i = 2
    while (i < points.size) { lineTo(points[i], points[i + 1]); i += 2 }
}

/** viewBox 0 0 24 24, exactly as index.html's bottom-nav SVGs. */
object NavIcons {
    val home = icon {
        d("M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8")
        d("M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z")
    }
    val plan = icon {
        rect(8f, 2f, 8f, 4f, 1f)
        d("M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2")
        d("M12 11h4"); d("M12 16h4"); d("M8 11h.01"); d("M8 16h.01")
    }
    val schedule = icon {
        d("M8 2v3"); d("M16 2v3")
        rect(3f, 3f, 18f, 18f, 2f)
        d("M3 9h18")
    }
    val profile = icon {
        d("M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2")
        circle(12f, 7f, 4f)
    }
    val team = icon {
        d("M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2")
        d("M16 3.128a4 4 0 0 1 0 7.744")
        d("M22 21v-2a4 4 0 0 0-3-3.87")
        circle(9f, 7f, 4f)
    }
    val chat = icon { d("M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z") }

    // supervisor's own bottom nav (index.html #bottomNavSupervisor)
    val svOverview = icon {
        d("M4.9 16.1C1 12.2 1 5.8 4.9 1.9")
        d("M7.8 4.7a6.14 6.14 0 0 0-.8 7.5")
        circle(12f, 9f, 2f)
        d("M16.2 4.8c2 2 2.26 5.11.8 7.47")
        d("M19.1 1.9a9.96 9.96 0 0 1 0 14.1")
        d("M9.5 18h5")
        d("m8 22 4-11 4 11")
    }
    val svStores = icon {
        d("M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5")
        d("M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244")
        d("M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05")
    }
    val svPeople = icon {
        d("M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2")
        d("M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2")
        d("M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3")
        d("M4 22h16")
        d("M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z")
        d("M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3")
    }
    val svTrend = icon {
        d("M16 7h6v6")
        d("m22 7-8.5 8.5-5-5L2 17")
    }

    // The home screen's «Быстрые действия» / «Инструменты» rows and their team/profile counterparts
    // (index.html #homeQuickSection / #homeToolsSection / #managerTools, my-plan/index.ts's lkPhoneAuth) — same source, same rule:
    // copy the `d` verbatim, never approximate with a similar-looking Material icon.
    val cash = icon {
        d("M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1")
        d("M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4")
    }
    val monthPlan = icon {
        d("M3 3v16a2 2 0 0 0 2 2h16"); d("M18 17V9"); d("M13 17V5"); d("M8 17v-3")
    }
    /** "Динамика выполнения" and "Прогноз и what-if" are literally the same icon in the web app (both point at [svTrend]). */
    val trend get() = svTrend
    val support = icon { d("M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719") }
    /** "BFQ" (home + team) — the same trophy-like icon the web happens to reuse for the supervisor's "Люди" tab. */
    val bfq get() = svPeople
    val comboCalc = icon { rect(5f, 2f, 14f, 20f, 2f); d("M12 18h.01") }
    /** The profile's "Вход по телефону" / "Привязать телефон и пароль" rows — same smartphone shape as [comboCalc]. */
    val smartphone get() = comboCalc
    val schoolCalc = icon {
        d("M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z")
        d("M8 10h8"); d("M8 18h8"); d("M8 22v-6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v6"); d("M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2")
    }
    val promos = icon {
        d("M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z")
        d("M13 5v2"); d("M13 17v2"); d("M13 11v2")
    }
    val heatmap = icon { d("M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4") }
    val announce = icon {
        d("M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z")
        d("M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14")
        d("M8 6v8")
    }
    val reportImg = icon {
        rect(3f, 3f, 18f, 18f, 2f); circle(9f, 9f, 2f); d("m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21")
    }
    /** "Отчёты", "Задачи" and the bottom-nav "План" tab all share this exact clipboard-list icon in the web app. */
    val clipboardList get() = plan
    val live = icon {
        d("M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z")
        d("M15 5.764v15"); d("M9 3.236v15")
    }
    val commandCenter = icon {
        circle(12f, 12f, 10f)
        d("m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z")
    }
    val alerts = icon {
        d("M7 18v-6a5 5 0 1 1 10 0v6")
        d("M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z")
        d("M21 12h1"); d("M18.5 4.5 18 5"); d("M2 12h1"); d("M12 2v1"); d("m4.929 4.929.707.707"); d("M12 12v6")
    }
    val history = icon {
        d("M19 17V5a2 2 0 0 0-2-2H4")
        d("M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3")
    }
    val download = icon { d("M12 15V3"); d("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"); d("m7 10 5 5 5-5") }
    val plus = icon { d("M5 12h14"); d("M12 5v14") }
    val globe = icon { circle(12f, 12f, 10f); d("M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"); d("M2 12h20") }
    val auditClock = icon { d("M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"); d("M3 3v5h5"); d("M12 7v5l4 2") }
    val dealers = icon {
        d("M3 21h18"); d("M5 21V7l8-4v18"); d("M19 21V11l-6-4")
        d("M9 9v.01"); d("M9 12v.01"); d("M9 15v.01"); d("M9 18v.01")
    }
    val newMetric = icon {
        d(
            "M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"
        )
    }
    /** No web equivalent (Повтор месяца/Admin Center are native-only screens) — a plain, consistent stand-in, not a copy of a web icon. */
    val repeat = icon { d("m17 2 4 4-4 4"); d("M3 11v-1a4 4 0 0 1 4-4h14"); d("m7 22-4-4 4-4"); d("M21 13v1a4 4 0 0 1-4 4H3") }
    val settings = icon {
        circle(12f, 12f, 3f)
        d(
            "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
        )
    }
    /** "О приложении" — the web's row used a plain ℹ️ emoji here (inconsistent with every other row's vector icon and rendered
     * differently per device/font); both now use this info-circle instead. */
    val info = icon { circle(12f, 12f, 10f); d("M12 16v-4"); d("M12 8h.01") }
    val checkmark = icon { d("M20 6 9 17l-5-5") }
    /** The header's "Обновить" button (the theme toggle next to it is a plain "◐" glyph in the web app too, nothing to fix there). */
    val refresh = icon {
        d("M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"); d("M21 3v5h-5")
        d("M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"); d("M8 16H3v5")
    }
    val logOut = icon {
        d("M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4")
        polyline(16f, 17f, 21f, 12f, 16f, 7f)
        line(21f, 12f, 9f, 12f)
    }
}

/** Draws one [NavIcons] path, scaled from its 24x24 source viewBox to [size], stroked (never filled) like the web's SVGs. */
@Composable
fun NavIcon(path: Path, contentDescription: String?, tint: Color, size: Dp, modifier: Modifier = Modifier) {
    Canvas(modifier.size(size)) {
        val s = this.size.width / 24f
        scale(s, s, pivot = Offset.Zero) {
            drawPath(path, color = tint, style = Stroke(width = 2f, cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
    }
}

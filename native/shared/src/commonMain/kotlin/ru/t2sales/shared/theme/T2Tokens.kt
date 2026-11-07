package ru.t2sales.shared.theme

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Ported from backend/frontend/styles.css:57-181 (the :root design-token
 * block). Values are copied verbatim, not redesigned.
 *
 * Second layer, Beta UI 3.0 «Ночная смена» (design-system/ui3/v5-team/NOTES.md, "Перенос в Compose";
 * web: backend/frontend/ui3/base.css): while [uiBeta] is on, the same getters return the beta palette,
 * so every existing call site picks it up without changes. Off by default, like the web
 * (body[data-ui="beta"]); each client persists and sets the flag itself.
 */
object T2Colors {
    val black = Color(0xFF0A0A0B)
    val blue = Color(0xFF2AABEE)
    val blueDeep = Color(0xFF1A8FD1)

    /** Dark by default, like the web app's dark theme (styles.css:185). */
    var dark by mutableStateOf(true)

    /** Beta UI 3.0 «Ночная смена». Default OFF (matches web); the user turns it on in Профиль. */
    var uiBeta by mutableStateOf(false)

    private fun pick(light: Color, darkColor: Color) = if (dark) darkColor else light

    /** (light, dark) for the current UI layer: the beta pair when [uiBeta], the classic pair otherwise. */
    private fun layer(light: Color, darkColor: Color, betaLight: Color, betaDark: Color) =
        if (uiBeta) pick(betaLight, betaDark) else pick(light, darkColor)

    val bg get() = layer(Color(0xFFF4F4F6), Color(0xFF000000), Color(0xFFF2F2F7), Color(0xFF08090A))
    val surface get() = layer(Color(0xFFFFFFFF), Color(0xFF141416), Color(0xFFFFFFFF), Color(0xFF111214))
    val surface2 get() = layer(Color(0xFFF0F0F3), Color(0xFF1C1C1F), Color(0xFFF2F2F7), Color(0xFF18191C))
    val surface3 get() = layer(Color(0xFFE8E8ED), Color(0xFF26262B), Color(0xFFE5E5EA), Color(0xFF202125))
    val text get() = layer(Color(0xFF0A0A0B), Color(0xFFF5F5F7), Color(0xFF0B0C0E), Color(0xFFF7F8F8))
    val textSecondary get() = layer(Color(0xFF5C5C66), Color(0xFFA1A1AA), Color(0xFF55585F), Color(0xFFB0B3BA))
    val hint get() = layer(Color(0xFF6E6E78), Color(0xFF7E7E87), Color(0xFF6C6F76), Color(0xFF8A8F98))

    val primary get() = layer(blue, Color(0xFF3BB8F5), Color(0xFF106FA3), Color(0xFF2AABEE))
    val primarySoft get() = layer(Color(0x242AABEE), Color(0x2E3BB8F5), Color(0x1C1990D2), Color(0x242AABEE))

    /**
     * styles.css --primary-text-bg: AA-safe blue for white text on it (same value in both themes).
     * Kept #106FA3 in beta too: existing call sites pair it with Color.White. Beta fills use [primary] + [onPrimary].
     */
    val primaryTextBg get() = Color(0xFF106FA3)
    val success get() = layer(Color(0xFF22C55E), Color(0xFF30D158), Color(0xFF1E8449), Color(0xFF3FC07A))
    val danger get() = layer(Color(0xFFEF4444), Color(0xFFFF453A), Color(0xFFC9262C), Color(0xFFF2555A))
    val warning get() = layer(Color(0xFFF59E0B), Color(0xFFFF9F0A), Color(0xFF945400), Color(0xFFF5A524))
    val successSoft get() = layer(Color(0x2922C55E), Color(0x2930D158), Color(0x1C1E8449), Color(0x243FC07A))
    val dangerSoft get() = layer(Color(0x29EF4444), Color(0x29FF453A), Color(0x1AC9262C), Color(0x24F2555A))
    val warningSoft get() = layer(Color(0x29F59E0B), Color(0x29FF9F0A), Color(0x21D68200), Color(0x24F5A524))
    val border get() = layer(Color(0x120A0A0B), Color(0x14FFFFFF), Color(0x12000000), Color(0x12FFFFFF))
    val accent get() = layer(Color(0xFF0A0A0B), Color(0xFFFFFFFF), Color(0xFF0B0C0E), Color(0xFFF7F8F8))
    val onAccent get() = layer(Color(0xFFFFFFFF), Color(0xFF111111), Color(0xFFFFFFFF), Color(0xFF08090A))

    // ---- new in UI 3.0 (meaningful in both layers, tuned for beta) ----

    /** --line-2: a stronger hairline (selected segment, grabber). */
    val borderStrong get() = layer(Color(0x240A0A0B), Color(0x24FFFFFF), Color(0x24000000), Color(0x21FFFFFF))
    /** --sep: inset list separators. */
    val separator get() = layer(Color(0x120A0A0B), Color(0x14FFFFFF), Color(0x243C3C43), Color(0x14FFFFFF))
    /** --on-primary: text/icons on a [primary] fill (7.3:1 dark, 5.5:1 light). */
    val onPrimary get() = layer(Color(0xFFFFFFFF), Color(0xFFFFFFFF), Color(0xFFFFFFFF), Color(0xFF03141F))
    /** --accent-text: blue for text/links on a cell. */
    val accentText get() = layer(Color(0xFF106FA3), Color(0xFF3BB8F5), Color(0xFF0D6DA6), Color(0xFF5CC2F5))
    /** --glass: translucent bars (tab bar, toasts). */
    val glass get() = layer(Color(0xEBFFFFFF), Color(0xEB141416), Color(0xBDFFFFFF), Color(0xB318191C))
    /** --scrim: dim behind sheets. */
    val scrim get() = layer(Color(0x66000000), Color(0x99000000), Color(0x52000000), Color(0x8F000000))
    /** --track: empty part of bars, rings and pies. */
    val track get() = layer(Color(0xFFE8E8ED), Color(0xFF26262B), Color(0x14000000), Color(0x1AFFFFFF))
}

/** The one gradient surface of UI 3.0 (--u-hero*): T2 blue family, same in both themes. */
object T2Hero {
    val c1 = Color(0xFF147CB8)
    val c2 = Color(0xFF106FA3)
    val c3 = Color(0xFF0A4B7A)
    val c4 = Color(0xFF062238)
    /** Light spot in the top-right corner, used at up to 30% alpha. */
    val spot = Color(0xFF7FD3FF)
    val onHero = Color(0xFFEFF9FF)
    val onHero2 = Color(0xEBFFFFFF)
    val onHeroLine = Color(0x38FFFFFF)
    val onHeroFill = Color(0x24FFFFFF)
    val chip = Color(0x47062238)

    /** The base 160° linear layer of the mesh; clients add the c1 and [spot] radial layers on top. */
    val linear: Brush get() = Brush.linearGradient(listOf(c2, c3, c4))
}

object T2Radius {
    val xs = 8.dp
    val sm = 12.dp
    val md = 16.dp
    val default = 20.dp
    val lg = 24.dp
    val xl = 28.dp
    /** UI 3.0: segmented-control thumb. */
    val seg = 8.dp
    /** UI 3.0: grouped cell / card (--u-r-lg). */
    val cell = 22.dp
}

object T2Spacing {
    val sp1 = 4.dp
    val sp2 = 8.dp
    val sp3 = 12.dp
    val sp4 = 16.dp
    val sp5 = 20.dp
    val sp6 = 24.dp
    val sp8 = 32.dp
    val sp10 = 40.dp
    val sp12 = 48.dp
    /** Minimum touch target. */
    val hit = 44.dp
}

object T2FontSize {
    val xs = 11.sp
    val sm = 13.sp
    val md = 15.sp
    val lg = 17.sp
    val xl = 20.sp
    val xxl = 24.sp
    val xxxl = 28.sp
    val cap = 12.sp
    val large = 34.sp
    val heroSm = 40.sp
    val hero = 56.sp
}

/** UI 3.0 motion tokens (NOTES.md "Моушн"). Spring easing is demo-only on web and is not exported. */
object T2Motion {
    val easeOut = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)
    val drawer = CubicBezierEasing(0.32f, 0.72f, 0f, 1f)
    const val micro = 120
    const val short = 200
    const val seg = 240
    const val sheet = 360
    const val count = 640
    const val fill = 720
}

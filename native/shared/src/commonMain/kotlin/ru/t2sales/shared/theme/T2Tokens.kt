package ru.t2sales.shared.theme

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Ported from backend/frontend/styles.css:57-181 (the :root design-token
 * block). Values are copied verbatim, not redesigned.
 */
object T2Colors {
    val black = Color(0xFF0A0A0B)
    val blue = Color(0xFF2AABEE)
    val blueDeep = Color(0xFF1A8FD1)

    /** Dark by default, like the web app's dark theme (styles.css:185). */
    var dark by mutableStateOf(true)

    private fun pick(light: Color, darkColor: Color) = if (dark) darkColor else light

    val bg get() = pick(Color(0xFFF4F4F6), Color(0xFF000000))
    val surface get() = pick(Color(0xFFFFFFFF), Color(0xFF141416))
    val surface2 get() = pick(Color(0xFFF0F0F3), Color(0xFF1C1C1F))
    val surface3 get() = pick(Color(0xFFE8E8ED), Color(0xFF26262B))
    val text get() = pick(Color(0xFF0A0A0B), Color(0xFFF5F5F7))
    val textSecondary get() = pick(Color(0xFF5C5C66), Color(0xFFA1A1AA))
    val hint get() = pick(Color(0xFF6E6E78), Color(0xFF7E7E87))

    val primary get() = pick(blue, Color(0xFF3BB8F5))
    val primarySoft get() = pick(Color(0x242AABEE), Color(0x2E3BB8F5))
    val success get() = pick(Color(0xFF22C55E), Color(0xFF30D158))
    val danger get() = pick(Color(0xFFEF4444), Color(0xFFFF453A))
    val warning get() = pick(Color(0xFFF59E0B), Color(0xFFFF9F0A))
    val successSoft get() = pick(Color(0x2922C55E), Color(0x2930D158))
    val dangerSoft get() = pick(Color(0x29EF4444), Color(0x29FF453A))
    val warningSoft get() = pick(Color(0x29F59E0B), Color(0x29FF9F0A))
    val border get() = pick(Color(0x120A0A0B), Color(0x14FFFFFF))
    val accent get() = pick(Color(0xFF0A0A0B), Color(0xFFFFFFFF))
    val onAccent get() = pick(Color(0xFFFFFFFF), Color(0xFF111111))
}

object T2Radius {
    val xs = 8.dp
    val sm = 12.dp
    val md = 16.dp
    val default = 20.dp
    val lg = 24.dp
    val xl = 28.dp
}

object T2Spacing {
    val sp1 = 4.dp
    val sp2 = 8.dp
    val sp3 = 12.dp
    val sp4 = 16.dp
    val sp5 = 20.dp
    val sp6 = 24.dp
    val sp8 = 32.dp
}

object T2FontSize {
    val xs = 11.sp
    val sm = 13.sp
    val md = 15.sp
    val lg = 17.sp
    val xl = 20.sp
    val xxl = 24.sp
    val xxxl = 28.sp
}

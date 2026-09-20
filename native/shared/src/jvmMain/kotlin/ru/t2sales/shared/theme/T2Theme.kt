package ru.t2sales.shared.theme

import androidx.compose.material.MaterialTheme
import androidx.compose.material.Typography
import androidx.compose.material.Surface
import androidx.compose.material.darkColors
import androidx.compose.material.lightColors
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.platform.Font
import java.io.File
import androidx.compose.ui.text.font.FontWeight

/**
 * Google Sans (styles.css --font) isn't bundled — no license check has been
 * done for this milestone. Instead of the Skia default (which doesn't match
 * any font in the web app's own fallback chain), this loads "Segoe UI" by
 * name — the same OS-installed font styles.css itself falls back to on
 * Windows (`--font: 'Google Sans', ..., 'Segoe UI', ...`), so the rendered
 * glyphs match what a Windows user already sees in the browser. There's no
 * Compose Desktop API to reference an installed system font purely by name
 * (unlike Android's expect signature) — it has to be loaded from its file,
 * so this points directly at the Windows font file. Null (falls back to
 * Skia's default) if it isn't there, e.g. a non-Windows dev machine.
 */
private val t2FontFamily: FontFamily? = run {
    val windowsFontsDir = File(System.getenv("WINDIR") ?: "C:\\Windows", "Fonts")
    val segoeUi = File(windowsFontsDir, "segoeui.ttf")
    if (segoeUi.exists()) FontFamily(Font(segoeUi)) else null
}

private val t2Typography = Typography(
    body1 = TextStyle(fontFamily = t2FontFamily, fontSize = T2FontSize.md, fontWeight = FontWeight.W500),
    body2 = TextStyle(fontFamily = t2FontFamily, fontSize = T2FontSize.sm, fontWeight = FontWeight.W500),
    h1 = TextStyle(fontFamily = t2FontFamily, fontSize = T2FontSize.xxxl, fontWeight = FontWeight.W700),
    h2 = TextStyle(fontFamily = t2FontFamily, fontSize = T2FontSize.xxl, fontWeight = FontWeight.W700),
    subtitle1 = TextStyle(fontFamily = t2FontFamily, fontSize = T2FontSize.lg, fontWeight = FontWeight.W600),
    caption = TextStyle(fontFamily = t2FontFamily, fontSize = T2FontSize.xs, fontWeight = FontWeight.W500),
    overline = TextStyle(fontFamily = t2FontFamily, fontSize = T2FontSize.xs, fontWeight = FontWeight.W700)
)

@Composable
fun T2Theme(content: @Composable () -> Unit) {
    val colors = (if (T2Colors.dark) darkColors() else lightColors()).copy(
        primary = T2Colors.primary,
        background = T2Colors.bg,
        surface = T2Colors.surface,
        onBackground = T2Colors.text,
        onSurface = T2Colors.text,
        error = T2Colors.danger
    )
    MaterialTheme(colors = colors, typography = t2Typography) {
        Surface(color = T2Colors.bg, contentColor = T2Colors.text, content = content)
    }
}

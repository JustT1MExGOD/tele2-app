package ru.t2sales.shared.theme

import androidx.compose.material.MaterialTheme
import androidx.compose.material.Typography
import androidx.compose.material.Surface
import androidx.compose.material.darkColors
import androidx.compose.material.lightColors
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight

/** The UI font: the OS font that styles.css falls back to on the platform (null = the platform default). */
internal expect val t2FontFamily: FontFamily?

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

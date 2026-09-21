package ru.t2sales.shared.theme

import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.platform.Font
import java.io.File

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
internal actual val t2FontFamily: FontFamily? = run {
    val windowsFontsDir = File(System.getenv("WINDIR") ?: "C:\\Windows", "Fonts")
    val segoeUi = File(windowsFontsDir, "segoeui.ttf")
    if (segoeUi.exists()) FontFamily(Font(segoeUi)) else null
}

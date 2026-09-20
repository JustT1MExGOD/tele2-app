package ru.t2sales.desktop.system

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class SystemThemeTest {
    private val windows = System.getProperty("os.name").orEmpty().startsWith("Windows")

    @Test fun readsTheSameValueAsTheRegistryTool() {
        if (!windows) { assertNull(SystemTheme.isDark()); return }
        val out = ProcessBuilder("reg", "query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", "/v", "AppsUseLightTheme")
            .redirectErrorStream(true).start().let { p -> p.inputStream.readBytes().toString(Charsets.ISO_8859_1).also { p.waitFor() } }
        val light = Regex("0x([0-9a-fA-F]+)").find(out)?.groupValues?.get(1)?.toInt(16)
        val dark = assertNotNull(SystemTheme.isDark(), "the setting exists on Windows 10/11")
        assertEquals(light == 0, dark)
    }
}

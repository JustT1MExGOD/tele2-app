package ru.t2sales.desktop.system

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.sun.jna.platform.win32.User32
import com.sun.jna.platform.win32.WinUser
import java.awt.GraphicsEnvironment
import java.net.BindException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.prefs.Preferences
import kotlin.concurrent.thread
import ru.t2sales.desktop.update.UpdateConfig

/** Where the main window is right now, and how to bring it forward from anywhere (tray, hotkey, a second start). */
object AppWindow {
    /** False while the app lives only in the tray. */
    var visible by mutableStateOf(true)

    /** Bumped to ask the window to come to the front (it also restores from minimised). */
    var frontTick by mutableStateOf(0)

    /** The real window, for "is the user looking at the app right now". */
    @Volatile var awt: java.awt.Window? = null

    val isFocused: Boolean get() = visible && awt?.isActive == true

    fun show() {
        visible = true
        frontTick++
    }
}

/** Sends a system (Windows) notification through the tray icon. Set by Main; a no-op until then. */
object AppNotifier {
    @Volatile var send: (title: String, text: String) -> Unit = { _, _ -> }

    /** Notify only when the user is not already looking at the app. */
    fun whenAway(title: String, text: String) {
        if (!AppWindow.isFocused) send(title, text)
    }
}

/** Tray behaviour settings. */
object TrayPrefs {
    private val prefs = Preferences.userRoot().node("ru/t2sales/desktop")

    /** Closing the window hides the app to the tray instead of quitting (default). */
    var hideOnClose: Boolean
        get() = prefs.getBoolean("hideOnClose", true)
        set(v) = prefs.putBoolean("hideOnClose", v)

    /** The one-time "the app keeps running in the tray" explanation was shown. */
    var noticeShown: Boolean
        get() = prefs.getBoolean("trayNoticeShown", false)
        set(v) = prefs.putBoolean("trayNoticeShown", v)
}

/**
 * Only one copy of the installed app runs: a second start (a double click, or Windows autostart on top of a running app) just asks
 * the first one to come forward. A development run from sources is never restricted.
 */
object SingleInstance {
    private const val PORT = 47613 // loopback only

    /** True when this process is the only copy (it now listens for "show yourself"); false when another copy was told to show itself. */
    fun acquire(onShow: () -> Unit, port: Int = PORT): Boolean {
        return try {
            val server = ServerSocket(port, 8, InetAddress.getLoopbackAddress())
            thread(name = "single-instance", isDaemon = true) {
                while (!server.isClosed) {
                    runCatching { server.accept().use { it.getInputStream().read(); onShow() } }
                }
            }
            true
        } catch (e: BindException) {
            runCatching { Socket(InetAddress.getLoopbackAddress(), port).use { it.getOutputStream().write('S'.code); it.getOutputStream().flush() } }
            false
        } catch (e: Exception) {
            true // cannot decide: better two windows than none
        }
    }
}

/** Start with Windows: a value under HKCU\...\Run pointing at the installed launcher with `--tray` (starts hidden, in the tray). */
object Autostart {
    private const val KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"
    private const val NAME = "T2 Sales Native"

    /** Only an installed app has a launcher to point at. */
    val available: Boolean get() = UpdateConfig.isPackaged && System.getProperty("jpackage.app-path") != null

    fun enabled(): Boolean = available && run("query", KEY, "/v", NAME) == 0

    fun set(on: Boolean): Boolean {
        if (!available) return false
        return if (on) {
            val exe = System.getProperty("jpackage.app-path")
            run("add", KEY, "/v", NAME, "/t", "REG_SZ", "/d", "\"$exe\" --tray", "/f") == 0
        } else {
            run("delete", KEY, "/v", NAME, "/f") == 0 || !enabled()
        }
    }

    private fun run(vararg args: String): Int = runCatching {
        val p = ProcessBuilder(listOf("reg") + args).redirectErrorStream(true).start()
        p.inputStream.readBytes()
        p.waitFor()
    }.getOrDefault(-1)
}

/** A system-wide hotkey (works while another program is in front). Windows only, through JNA. */
object GlobalHotkey {
    private const val ID = 0x7532
    private const val MOD_ALT = 0x0001
    private const val MOD_CONTROL = 0x0002
    private const val MOD_NOREPEAT = 0x4000
    private const val WM_HOTKEY = 0x0312

    /** Ctrl+Alt+P ("Продажа"). */
    const val LABEL = "Ctrl+Alt+P"
    private const val VK_P = 0x50

    /** False when the combination is already taken by another program (the app then simply has no global hotkey). */
    fun register(onPressed: () -> Unit): Boolean {
        if (!System.getProperty("os.name").orEmpty().startsWith("Windows")) return false
        val ready = CompletableFuture<Boolean>()
        thread(name = "global-hotkey", isDaemon = true) {
            // the hotkey is registered on the thread that reads its messages: WM_HOTKEY goes to the registering thread's queue
            val ok = runCatching { User32.INSTANCE.RegisterHotKey(null, ID, MOD_CONTROL or MOD_ALT or MOD_NOREPEAT, VK_P) }.getOrDefault(false)
            ready.complete(ok)
            if (!ok) return@thread
            val msg = WinUser.MSG()
            while (User32.INSTANCE.GetMessage(msg, null, 0, 0) > 0) {
                if (msg.message == WM_HOTKEY) runCatching(onPressed)
            }
            User32.INSTANCE.UnregisterHotKey(null, ID)
        }
        return runCatching { ready.get(2, TimeUnit.SECONDS) }.getOrDefault(false)
    }
}

/** The main window's size and place, kept between runs. */
object WindowPrefs {
    private val prefs = Preferences.userRoot().node("ru/t2sales/desktop")

    class Saved(val width: Int, val height: Int, val x: Int, val y: Int, val maximized: Boolean)

    fun load(): Saved? {
        val w = prefs.getInt("win.w", 0)
        val h = prefs.getInt("win.h", 0)
        if (w < 640 || h < 480) return null
        val saved = Saved(w, h, prefs.getInt("win.x", Int.MIN_VALUE), prefs.getInt("win.y", Int.MIN_VALUE), prefs.getBoolean("win.max", false))
        // a monitor may be gone since last time: a window that would open off-screen falls back to the default place
        return if (saved.x != Int.MIN_VALUE && !onSomeScreen(saved.x, saved.y, saved.width)) Saved(w, h, Int.MIN_VALUE, Int.MIN_VALUE, saved.maximized) else saved
    }

    fun save(width: Int, height: Int, x: Int, y: Int, maximized: Boolean) {
        if (width < 640 || height < 480) return
        prefs.putInt("win.w", width); prefs.putInt("win.h", height)
        prefs.putInt("win.x", x); prefs.putInt("win.y", y)
        prefs.putBoolean("win.max", maximized)
    }

    private fun onSomeScreen(x: Int, y: Int, width: Int): Boolean = runCatching {
        GraphicsEnvironment.getLocalGraphicsEnvironment().screenDevices.any {
            val b = it.defaultConfiguration.bounds
            // the title bar (its left part) must be reachable
            x + 120 in b.x..(b.x + b.width) && y in b.y..(b.y + b.height - 80) && width > 0
        }
    }.getOrDefault(true)
}

/** Whether Windows itself is set to dark mode for apps ("Settings > Personalization > Colors"). Null when it cannot be read. */
object SystemTheme {
    private const val KEY = "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"

    fun isDark(): Boolean? {
        if (!System.getProperty("os.name").orEmpty().startsWith("Windows")) return null
        return runCatching {
            com.sun.jna.platform.win32.Advapi32Util.registryGetIntValue(com.sun.jna.platform.win32.WinReg.HKEY_CURRENT_USER, KEY, "AppsUseLightTheme") == 0
        }.getOrNull()
    }
}

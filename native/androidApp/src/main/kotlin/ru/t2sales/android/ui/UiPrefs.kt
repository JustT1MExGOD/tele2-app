package ru.t2sales.android.ui

import android.content.Context
import ru.t2sales.shared.theme.T2Colors

/** Small local UI preferences (SharedPreferences "t2_ui"). Only the Beta UI 3.0 flag for now. */
object UiPrefs {
    private const val FILE = "t2_ui"
    private const val KEY_BETA = "ui_beta"

    private fun prefs() = ru.t2sales.shared.auth.AndroidPlatform.appContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /** Reads the saved flag into [T2Colors.uiBeta]; call once before the first frame. */
    fun load() {
        T2Colors.uiBeta = runCatching { prefs().getBoolean(KEY_BETA, false) }.getOrDefault(false)
    }

    fun setBeta(on: Boolean) {
        T2Colors.uiBeta = on
        runCatching { prefs().edit().putBoolean(KEY_BETA, on).apply() }
    }
}

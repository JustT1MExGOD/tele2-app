package ru.t2sales.android.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/** Global UI switches, the phone counterparts of the web's window.openAddSale / loadPage refresh. */
object AppState {
    var addSaleVisible by mutableStateOf(false)
    var presetEmployeeId by mutableStateOf<Int?>(null)

    /** Bumped after every successful write, so the screen on top reloads (web: loadPage(page)). */
    var refreshTick by mutableStateOf(0)

    fun openAddSale(presetEmployeeId: Int? = null) {
        this.presetEmployeeId = presetEmployeeId
        addSaleVisible = true
    }
}

/** Kept for the screens written first; the toast itself is [T2Toast], shared with the ported screens. */
object Toaster {
    fun show(text: String, error: Boolean = false) = T2Toast.show(text, error)
}

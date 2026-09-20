package ru.t2sales.desktop.ui.sales

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/** Global "open the add-sale modal" switch (window.openAddSale in the web app) and page-refresh tick. */
object AddSaleState {
    var visible by mutableStateOf(false)
    var presetEmployeeId by mutableStateOf<Int?>(null)

    /** Bumped after a successful write so the current screen reloads (web: loadPage(page)). */
    var refreshTick by mutableStateOf(0)

    fun open(presetEmployeeId: Int? = null) {
        this.presetEmployeeId = presetEmployeeId
        visible = true
    }
}

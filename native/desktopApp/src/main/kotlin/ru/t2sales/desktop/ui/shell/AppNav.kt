package ru.t2sales.desktop.ui.shell

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ru.t2sales.shared.navigation.Screen

/** Lets deep widgets (drop cards, hints) switch screens without threading callbacks everywhere. */
object AppNav {
    var go: (Screen) -> Unit = {}

    /** True while the signed-in shell is on screen; window-wide shortcuts (Ctrl+K / Ctrl+N) only fire then. */
    var signedIn = false

    /** The signed-in employee (owner of the offline queue); null when signed out. */
    var myEmployeeId: Int? = null

    /** Manager or admin: may enter a colleague's sale (the quick-sale window then understands "фамилия 3 аксы"). */
    var canManageSales: Boolean = false

    /** Current and previous screen — «Назад» on detail pages (goBack in the web). */
    var current: Screen = Screen.Home
    var previous: Screen = Screen.Home
    var storeProfileId by mutableStateOf<String?>(null)

    fun openStore(storeId: String) {
        if (storeId.isEmpty()) return
        storeProfileId = storeId
        previous = current
        go(Screen.StoreProfile)
    }

    fun back() = go(previous)

    /** «Предложить перенос»: opens «Прогноз и what-if» with the receiving store and date preselected. */
    var whatIfToStore by mutableStateOf<String?>(null)
    var whatIfDate by mutableStateOf<String?>(null)

    fun proposeMove(storeId: String, date: String? = null) {
        whatIfToStore = storeId
        whatIfDate = date
        go(Screen.Forecast)
    }
}

package ru.t2sales.desktop.system

import java.util.prefs.Preferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import ru.t2sales.desktop.di.AppContainer
import ru.t2sales.desktop.ui.shell.AppNav

/**
 * Tells you about new things while the app is in the tray or behind other windows: new open alerts and new announcements.
 * It polls the same endpoints the screens use, once a minute, only while signed in. The first look after a fresh install only
 * remembers what is already there, so nothing old is announced as new. A screen you are looking at is never doubled by a popup.
 */
class NotificationWatcher(private val container: AppContainer, private val intervalMs: Long = 60_000) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val prefs = Preferences.userRoot().node("ru/t2sales/desktop/notify")

    fun start() {
        scope.launch {
            delay(20_000) // let the app finish starting first
            while (isActive) {
                if (AppNav.myEmployeeId != null) runCatching { poll() }
                delay(intervalMs)
            }
        }
    }

    private suspend fun poll() {
        val me = AppNav.myEmployeeId ?: return
        // alerts are a manager's tool: for other roles the server answers "no", which just means there is nothing to announce
        runCatching { container.alertsApi.list("open") }.getOrNull()?.let { list ->
            val fresh = fresh("alerts.$me", list.map { it.id })
            val items = list.filter { it.id in fresh }
            when {
                items.isEmpty() -> Unit
                items.size <= 3 -> items.forEach { AppNotifier.whenAway("Алерт", listOfNotNull(it.title, it.store_name).joinToString(" · ")) }
                else -> AppNotifier.whenAway("Новые алерты", "Новых алертов: ${items.size}")
            }
        }
        runCatching { container.infoApi.announcements() }.getOrNull()?.let { list ->
            val unread = list.filter { !it.is_read }
            val fresh = fresh("announce.$me", unread.map { it.id })
            unread.filter { it.id in fresh }.take(3).forEach { AppNotifier.whenAway(if (it.required) "Обязательное объявление" else "Объявление", it.title) }
        }
    }

    /** Ids not seen before. The very first call for a key seeds the set silently. */
    private fun fresh(key: String, ids: List<Int>): Set<Int> {
        val seenRaw = prefs.get(key, null)
        val seen = seenRaw?.split(',')?.mapNotNull { it.toIntOrNull() }?.toSet().orEmpty()
        val new = if (seenRaw == null) emptySet() else ids.filter { it !in seen }.toSet()
        // remember what is on screen now (plus recent history, so an id that briefly drops out is not announced again)
        prefs.put(key, (ids + seen).distinct().take(300).joinToString(","))
        return new
    }
}

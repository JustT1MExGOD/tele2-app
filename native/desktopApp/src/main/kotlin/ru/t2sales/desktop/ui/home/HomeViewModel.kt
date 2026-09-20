package ru.t2sales.desktop.ui.home

import java.time.LocalDate
import java.time.ZoneId
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive
import ru.t2sales.shared.api.HomeApi
import ru.t2sales.shared.api.ReportsApi

private val MOSCOW_ZONE = ZoneId.of("Europe/Moscow")

/** analytics/supervisor.ts's canViewAnalytics() gate (backend/frontend/src/
 * app/core.ts) — Command Center widget is manager/supervisor/admin-only,
 * deliberately excluding senior. */
private val ANALYTICS_ROLES = setOf("manager", "admin", "supervisor")

class HomeViewModel(
    private val homeApi: HomeApi,
    private val reportsApi: ReportsApi,
    private val cache: ru.t2sales.desktop.offline.ReadCache
) {
    private companion object {
        const val MY_DAY = "home.myday"
        const val HEALTH = "home.health"
        const val STATS = "home.stats"
        const val DASHBOARD = "home.dashboard"
    }

    /**
     * What the dashboard shows from the last saved copies, with no network at all - painted at once while the fresh data loads.
     * Null when nothing was saved yet (first run, or another employee signed in).
     */
    fun cachedContent(role: String?): HomeUiState.Content? {
        val myDay = cache.get(MY_DAY, ru.t2sales.shared.api.MeDayResponse.serializer())?.value
        val stats = cache.get(STATS, JsonArray.serializer())?.value
        val dashboard = cache.get(DASHBOARD, ru.t2sales.shared.api.DashboardResponse.serializer())?.value
        if (myDay == null && stats == null && dashboard == null) return null
        val showAnalytics = role in ANALYTICS_ROLES
        val health = if (showAnalytics) cache.get(HEALTH, ru.t2sales.shared.api.SupervisorHealthResponse.serializer())?.value else null
        return HomeUiState.Content(myDay, showAnalytics, health, stats?.let(::sumTotals) ?: NetworkTotals(), dashboard?.top.orEmpty().ifEmpty { dashboard?.top7.orEmpty() })
    }

    suspend fun load(role: String?): HomeUiState.Content {
        var staleSince: java.time.Instant? = null

        /** The fresh answer (saved for next time); when the server did not answer at all, the saved copy. A server "no" stays a "no". */
        suspend fun <T> fetch(key: String, serializer: kotlinx.serialization.KSerializer<T>, call: suspend () -> T): T? {
            val attempt = runCatching { call() }
            attempt.getOrNull()?.let { cache.put(key, serializer, it); return it }
            if (attempt.exceptionOrNull() is ru.t2sales.shared.api.ApiException) return null
            return cache.get(key, serializer)?.also { c -> if (staleSince == null || c.savedAt < staleSince) staleSince = c.savedAt }?.value
        }

        val myDay = fetch(MY_DAY, ru.t2sales.shared.api.MeDayResponse.serializer()) { homeApi.getMyDay() }

        val showAnalytics = role in ANALYTICS_ROLES
        val health = if (showAnalytics) fetch(HEALTH, ru.t2sales.shared.api.SupervisorHealthResponse.serializer()) { homeApi.getSupervisorHealth() } else null

        val today = LocalDate.now(MOSCOW_ZONE).toString()
        val stats = fetch(STATS, JsonArray.serializer()) { reportsApi.getStatsDaily(today) }
        val totals = stats?.let(::sumTotals) ?: NetworkTotals()

        val dashboard = fetch(DASHBOARD, ru.t2sales.shared.api.DashboardResponse.serializer()) { reportsApi.getDashboard() }
        val topLeaders = dashboard?.top.orEmpty().ifEmpty { dashboard?.top7.orEmpty() }

        return HomeUiState.Content(
            myDay = myDay,
            showAnalytics = showAnalytics,
            health = health,
            networkTotals = totals,
            topLeaders = topLeaders,
            staleSince = staleSince
        )
    }

    private fun sumTotals(stats: JsonArray): NetworkTotals {
        fun sum(key: String) = stats.sumOf { row ->
            (row as? JsonObject)?.get(key)?.jsonPrimitive?.doubleOrNull ?: 0.0
        }
        return NetworkTotals(
            sim = sum("sim"),
            mnp = sum("mnp"),
            pa = sum("pa"),
            combo = sum("combo"),
            phones = sum("phones"),
            accessories = sum("accessories")
        )
    }
}

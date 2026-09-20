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
    private val reportsApi: ReportsApi
) {
    suspend fun load(role: String?): HomeUiState.Content {
        val myDay = runCatching { homeApi.getMyDay() }.getOrNull()

        val showAnalytics = role in ANALYTICS_ROLES
        val health = if (showAnalytics) runCatching { homeApi.getSupervisorHealth() }.getOrNull() else null

        val today = LocalDate.now(MOSCOW_ZONE).toString()
        val stats = runCatching { reportsApi.getStatsDaily(today) }.getOrNull()
        val totals = stats?.let(::sumTotals) ?: NetworkTotals()

        val dashboard = runCatching { reportsApi.getDashboard() }.getOrNull()
        val topLeaders = dashboard?.top.orEmpty().ifEmpty { dashboard?.top7.orEmpty() }

        return HomeUiState.Content(
            myDay = myDay,
            showAnalytics = showAnalytics,
            health = health,
            networkTotals = totals,
            topLeaders = topLeaders
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

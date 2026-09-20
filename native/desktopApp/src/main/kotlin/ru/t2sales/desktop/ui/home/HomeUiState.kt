package ru.t2sales.desktop.ui.home

import ru.t2sales.shared.api.DashboardLeaderRow
import ru.t2sales.shared.api.MeDayResponse
import ru.t2sales.shared.api.SupervisorHealthResponse

/** Aggregated network-wide totals for today, summed client-side from
 * GET /stats/daily (backend/frontend/src/pages/home/index.ts's own
 * `list.reduce(...)` over the same response) — only the subset of metrics
 * the real "Пульс сети" widget shows. */
data class NetworkTotals(
    val sim: Double = 0.0,
    val mnp: Double = 0.0,
    val pa: Double = 0.0,
    val combo: Double = 0.0,
    val phones: Double = 0.0,
    val accessories: Double = 0.0
) {
    val units: Double get() = sim + mnp + pa + combo
}

sealed class HomeUiState {
    data object Loading : HomeUiState()

    /**
     * Each field is independently nullable/empty on its own fetch failure —
     * mirrors the real page's per-widget try/catch (one widget failing
     * doesn't blank the rest), not one all-or-nothing screen error.
     */
    data class Content(
        val myDay: MeDayResponse?,
        val showAnalytics: Boolean,
        val health: SupervisorHealthResponse?,
        val networkTotals: NetworkTotals,
        val topLeaders: List<DashboardLeaderRow>
    ) : HomeUiState()
}

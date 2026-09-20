package ru.t2sales.desktop.network

/** Port of desktop/src/main/network/types.ts. */

/** The mode the user has SET; the effective state below is what is actually happening. */
enum class NetworkPreference(val id: String) {
    Auto("auto"), DirectOnly("direct_only"), Relay("relay");

    companion object {
        fun parse(v: String?): NetworkPreference? = entries.firstOrNull { it.id == v }
    }
}

enum class EffectiveState(val id: String) { Direct("direct"), Relay("relay"), Offline("offline"), Checking("checking") }

/** Honest, evidence-based categories - never a theory about the cause ("DPI detected"). */
enum class Outcome { OK, DNS_FAILURE, TCP_FAILURE, TLS_FAILURE, HTTP_FAILURE, TIMEOUT, OFFLINE, UNKNOWN }

data class LayerResult(val layer: String, val outcome: Outcome, val durationMs: Long)

data class DiagnosticsReport(val timestamp: String, val overall: Outcome, val layers: List<LayerResult>)

enum class RelayReachability { NotConfigured, NotChecked, Checking, Reachable, Unreachable }

data class NetworkStatus(
    val effective: EffectiveState = EffectiveState.Checking,
    val preference: NetworkPreference = NetworkPreference.Auto,
    val lastDiagnostics: DiagnosticsReport? = null,
    val lastRelayReachability: RelayReachability = RelayReachability.NotConfigured,
    /** Hostname only - never the full URL, path or query. */
    val relayHost: String? = null,
    val lastChangedAt: String = ""
)

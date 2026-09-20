package ru.t2sales.desktop.network

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.time.Instant
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import ru.t2sales.shared.api.ApiConfig

/** Port of desktop/src/main/config.ts (network part): the one place the relay address and the initial mode are decided. */
object NetworkConfig {
    /** The same public T2 Edge Relay the Electron build uses (`DEFAULT_PRODUCTION_RELAY_URL`). */
    const val DEFAULT_RELAY_URL = "https://relay.vincere-mortem.ru"

    private val prefs = java.util.prefs.Preferences.userRoot().node("ru/t2sales/desktop")

    val canonicalOrigin: String = ApiConfig.PROD_API_BASE

    /** T2_RELAY_URL wins, otherwise the production relay. https only (http only for a local dev relay on loopback). */
    val relayUrl: String = run {
        val raw = System.getenv("T2_RELAY_URL")?.takeIf { it.isNotBlank() } ?: DEFAULT_RELAY_URL
        runCatching {
            val u = URI(raw)
            val loopbackHttp = u.scheme == "http" && (u.host == "127.0.0.1" || u.host == "localhost")
            if (u.scheme == "https" || loopbackHttp) "${u.scheme}://${u.authority}" else ""
        }.getOrDefault("")
    }

    val relayHost: String? = relayUrl.takeIf { it.isNotEmpty() }?.let { URI(it).host }

    /** T2_NETWORK_MODE (start-up override) > the mode chosen in the panel last time > auto. */
    fun initialPreference(): NetworkPreference =
        NetworkPreference.parse(System.getenv("T2_NETWORK_MODE")) ?: NetworkPreference.parse(prefs.get("networkMode", null)) ?: NetworkPreference.Auto

    fun savePreference(p: NetworkPreference) = prefs.put("networkMode", p.id)
}

/**
 * Port of network/manager.ts: wires diagnostics + state machine, tracks the effective [NetworkStatus] (observable from Compose)
 * and exposes [relayActive], which the OkHttp [RelayInterceptor] reads on every request.
 */
class NetworkManager(
    private val canonicalOrigin: String = NetworkConfig.canonicalOrigin,
    private val relayUrl: String = NetworkConfig.relayUrl
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build()

    @Volatile var relayActive = false
        private set
    var status by mutableStateOf(
        NetworkStatus(
            preference = NetworkConfig.initialPreference(),
            lastRelayReachability = if (relayUrl.isEmpty()) RelayReachability.NotConfigured else RelayReachability.NotChecked,
            relayHost = NetworkConfig.relayHost,
            lastChangedAt = Instant.now().toString()
        )
    )
        private set

    private val machine: NetworkStateMachine = NetworkStateMachine(
        scope = scope,
        probeDirect = {
            val report = runDiagnostics(canonicalOrigin)
            status = status.copy(lastDiagnostics = report)
            report
        },
        isRelayAvailable = { checkRelay() },
        onState = { state ->
            relayActive = state == EffectiveState.Relay
            status = status.copy(effective = state, lastChangedAt = Instant.now().toString())
        }
    )

    private suspend fun checkRelay(): Boolean {
        if (relayUrl.isEmpty()) {
            status = status.copy(lastRelayReachability = RelayReachability.NotConfigured)
            return false
        }
        status = status.copy(lastRelayReachability = RelayReachability.Checking)
        val ok = runCatching {
            withContext(Dispatchers.IO) {
                val req = HttpRequest.newBuilder(URI("$relayUrl/healthz")).timeout(Duration.ofSeconds(5)).GET().build()
                http.send(req, HttpResponse.BodyHandlers.discarding()).statusCode() in 200..299
            }
        }.getOrDefault(false)
        status = status.copy(lastRelayReachability = if (ok) RelayReachability.Reachable else RelayReachability.Unreachable)
        return ok
    }

    /** Must finish BEFORE the first API call - whichever mode is decided here is what the first request already uses. */
    suspend fun start() {
        machine.start(NetworkConfig.initialPreference())
        status = status.copy(preference = machine.preference)
    }

    suspend fun setPreference(mode: NetworkPreference) {
        NetworkConfig.savePreference(mode)
        status = status.copy(preference = mode)
        machine.setPreference(mode)
        status = status.copy(preference = machine.preference)
    }

    suspend fun retryDirect() {
        machine.retryDirectNow()
        status = status.copy(preference = machine.preference)
    }

    suspend fun runDiagnosticsNow() {
        status = status.copy(lastDiagnostics = runDiagnostics(canonicalOrigin))
    }

    /** Fire-and-forget entry points for UI callbacks. */
    fun launch(block: suspend NetworkManager.() -> Unit) { scope.launch { block() } }

    fun dispose() {
        machine.dispose()
    }
}

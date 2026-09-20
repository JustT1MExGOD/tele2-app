package ru.t2sales.desktop.network

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class StateMachineConfig(
    /** Probes taken before declaring DIRECT failed (bounded retry). */
    val directFailureConfirmProbes: Int = 3,
    val confirmProbeBackoffMs: Long = 1500,
    /** Consecutive successful DIRECT probes, while on RELAY, before going back to DIRECT (hysteresis, AUTO only). */
    val directRecoveryConsecutiveSuccesses: Int = 3,
    /** How often DIRECT is re-probed in the background while on RELAY (AUTO only). */
    val backgroundRecheckIntervalMs: Long = 30_000
)

/**
 * Port of network/state-machine.ts.
 *  AUTO        - DIRECT probes -> success: DIRECT; confirmed failure: RELAY if reachable, else OFFLINE; while on RELAY re-probes DIRECT
 *                in the background and returns after N consecutive successes (never flips on one lucky probe).
 *  DIRECT_ONLY - one honest DIRECT probe (direct/offline), never touches the relay.
 *  RELAY       - forced: honest relay reachability check, then stays there without background recovery.
 */
class NetworkStateMachine(
    private val scope: CoroutineScope,
    private val probeDirect: suspend () -> DiagnosticsReport,
    private val isRelayAvailable: suspend () -> Boolean,
    private val onState: (EffectiveState) -> Unit,
    private val config: StateMachineConfig = StateMachineConfig()
) {
    @Volatile private var generation = 0
    @Volatile var state: EffectiveState = EffectiveState.Checking
        private set
    @Volatile var preference: NetworkPreference = NetworkPreference.Auto
        private set
    private var consecutiveDirectSuccesses = 0
    private var backgroundJob: Job? = null

    private fun setState(next: EffectiveState) {
        if (state == next) return
        state = next
        onState(next)
    }

    private suspend fun probeOnce() = probeDirect().overall == Outcome.OK

    suspend fun start(preference: NetworkPreference) {
        this.preference = preference
        evaluate()
    }

    suspend fun setPreference(preference: NetworkPreference) {
        this.preference = preference
        stopBackground()
        evaluate()
    }

    private suspend fun evaluate() {
        val gen = ++generation
        when (preference) {
            NetworkPreference.DirectOnly -> {
                setState(EffectiveState.Checking)
                val ok = probeOnce()
                if (gen != generation) return
                setState(if (ok) EffectiveState.Direct else EffectiveState.Offline)
            }
            NetworkPreference.Relay -> {
                setState(EffectiveState.Checking)
                val available = isRelayAvailable()
                if (gen != generation) return
                setState(if (available) EffectiveState.Relay else EffectiveState.Offline)
            }
            NetworkPreference.Auto -> runAuto(gen)
        }
    }

    private suspend fun runAuto(gen: Int) {
        setState(EffectiveState.Checking)
        val directAvailable = probeOnce()
        if (gen != generation) return
        if (directAvailable) {
            consecutiveDirectSuccesses = 1
            setState(EffectiveState.Direct)
            return
        }
        for (i in 1 until config.directFailureConfirmProbes) {
            delay(config.confirmProbeBackoffMs)
            if (gen != generation) return
            val ok = probeOnce()
            if (gen != generation) return
            if (ok) { setState(EffectiveState.Direct); return }
        }
        val relayAvailable = isRelayAvailable()
        if (gen != generation) return
        if (relayAvailable) {
            setState(EffectiveState.Relay)
            startBackgroundRecovery()
        } else {
            setState(EffectiveState.Offline)
        }
    }

    private fun startBackgroundRecovery() {
        stopBackground()
        consecutiveDirectSuccesses = 0
        backgroundJob = scope.launch {
            while (isActive) {
                delay(config.backgroundRecheckIntervalMs)
                backgroundTick()
            }
        }
    }

    private fun stopBackground() {
        backgroundJob?.cancel()
        backgroundJob = null
    }

    private suspend fun backgroundTick() {
        val gen = generation
        if (state != EffectiveState.Relay || preference != NetworkPreference.Auto) return
        val ok = probeOnce()
        if (gen != generation) return
        if (ok) {
            consecutiveDirectSuccesses++
            if (consecutiveDirectSuccesses >= config.directRecoveryConsecutiveSuccesses) {
                stopBackground()
                setState(EffectiveState.Direct)
            }
        } else {
            consecutiveDirectSuccesses = 0
        }
    }

    /** "Check now", not "force-switch now": under a forced preference it probes but never switches. */
    suspend fun retryDirectNow(): Boolean {
        val gen = generation
        val ok = probeOnce()
        if (gen != generation) return false
        if (preference == NetworkPreference.DirectOnly) {
            setState(if (ok) EffectiveState.Direct else EffectiveState.Offline)
            return ok
        }
        if (preference != NetworkPreference.Auto) return ok
        if (ok && state != EffectiveState.Direct) {
            consecutiveDirectSuccesses++
            if (state != EffectiveState.Relay || consecutiveDirectSuccesses >= config.directRecoveryConsecutiveSuccesses) {
                stopBackground()
                setState(EffectiveState.Direct)
            }
        }
        return ok
    }

    fun dispose() {
        generation++
        stopBackground()
    }
}

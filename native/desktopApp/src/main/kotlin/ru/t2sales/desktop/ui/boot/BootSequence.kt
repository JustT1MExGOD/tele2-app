package ru.t2sales.desktop.ui.boot

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlin.system.exitProcess
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull
import ru.t2sales.desktop.di.AppContainer
import ru.t2sales.desktop.update.CheckTrigger
import ru.t2sales.desktop.update.UpdateConfig
import ru.t2sales.desktop.update.UpdateState
import ru.t2sales.shared.api.MeResponse

/** What the splash shows. `progress == null` means "working, no measurable progress" (an indeterminate bar). */
class BootState {
    var message by mutableStateOf("Запускаемся…")
    var detail by mutableStateOf<String?>(null)
    var progress by mutableStateOf<Float?>(null)
    var finishing by mutableStateOf(false)
}

/**
 * The launch sequence, Discord-style: connection -> update (installed at once when there is one) -> session -> main client.
 * It never blocks the launch on a problem: an unreachable update server, a failed download or a bad signature all fall through
 * to starting the version that is already installed. When an update IS installed the installer takes over (it closes this process
 * and relaunches the new version), so [run] then never returns.
 */
class BootSequence(private val container: AppContainer) {
    val state = BootState()

    /** The signed-in user found during boot; null = show the sign-in screen. */
    var me: MeResponse? = null
        private set

    /** Dev-only preview of the whole update leg without a server: `T2_BOOT_DEMO=update` with `gradle run`. Ignored in an installed app. */
    private val demoUpdate = !UpdateConfig.isPackaged && System.getenv("T2_BOOT_DEMO") == "update"

    suspend fun run() {
        val started = System.currentTimeMillis()

        state.message = "Проверяем соединение…"
        val stepAt = System.currentTimeMillis()
        withTimeoutOrNull(12_000) { runCatching { container.network.start() } }
        holdAtLeast(stepAt, 700)

        if (demoUpdate) demoUpdateLeg() else if (UpdateConfig.baseUrl.isNotEmpty()) updateLeg()

        state.message = "Входим в аккаунт…"
        state.detail = null
        state.progress = null
        val signInAt = System.currentTimeMillis()
        me = container.authRepository.currentSession()
        holdAtLeast(signInAt, 500)

        state.message = "Готово"
        // never a flash: even on a fast machine the splash is on screen long enough to read
        holdAtLeast(started, 2_200)
        state.finishing = true
        delay(FADE_OUT_MS)
    }

    private suspend fun holdAtLeast(since: Long, ms: Long) {
        val left = ms - (System.currentTimeMillis() - since)
        if (left > 0) delay(left)
    }

    private suspend fun note(text: String) {
        state.message = text
        state.detail = null
        state.progress = null
        delay(1_600)
    }

    private suspend fun updateLeg() {
        val u = container.updates
        state.message = "Ищем обновления…"
        val checkAt = System.currentTimeMillis()
        withTimeoutOrNull(12_000) { u.checkNow(CheckTrigger.Startup) }
        holdAtLeast(checkAt, 700)

        val offer = u.status.availableManifest ?: return
        if (u.status.state == UpdateState.UpdateAvailable) u.downloadUpdate()

        val deadline = System.currentTimeMillis() + 15 * 60_000L
        while (System.currentTimeMillis() < deadline) {
            val st = u.status
            when (st.state) {
                UpdateState.Downloading -> {
                    val p = st.progress
                    state.message = "Загружаем обновление ${offer.version}"
                    if (p != null && p.totalBytes > 0) {
                        state.progress = (p.receivedBytes.toFloat() / p.totalBytes).coerceIn(0f, 1f)
                        state.detail = "${(state.progress!! * 100).toInt()}% · ${mb(p.receivedBytes)} из ${mb(p.totalBytes)}"
                    }
                }
                UpdateState.Verifying -> { state.message = "Проверяем подлинность файла…"; state.progress = null; state.detail = null }
                UpdateState.ReadyToInstall -> break
                UpdateState.Error -> { note("Не удалось обновиться — запускаем текущую версию"); return }
                UpdateState.UpdateAvailable, UpdateState.Checking -> Unit // a tick before the download state lands
                else -> return
            }
            delay(100)
        }
        if (u.status.state != UpdateState.ReadyToInstall) { note("Обновление не загрузилось — запускаем текущую версию"); return }

        state.message = "Устанавливаем обновление ${offer.version}…"
        state.detail = "приложение перезапустится само"
        state.progress = null
        try {
            u.installUpdate()
        } catch (e: Exception) {
            note("Не удалось установить — запускаем текущую версию")
            return
        }
        // the installer is up: it closes this process itself; leave it a moment, then make sure we are gone
        delay(1_500)
        exitProcess(0)
        @Suppress("UNREACHABLE_CODE") awaitCancellation()
    }

    /** Same screens as the real update leg, with a fake download. Only reachable from a development run. */
    private suspend fun demoUpdateLeg() {
        state.message = "Ищем обновления…"
        delay(1_000)
        val total = 58L * 1024 * 1024
        state.message = "Загружаем обновление 1.0.1"
        for (i in 0..100) {
            state.progress = i / 100f
            state.detail = "$i% · ${mb(total * i / 100)} из ${mb(total)}"
            delay(45)
        }
        state.message = "Проверяем подлинность файла…"; state.progress = null; state.detail = null
        delay(1_100)
        state.message = "Устанавливаем обновление 1.0.1…"
        state.detail = "демо: на самом деле ничего не ставим"
        delay(1_400)
    }

    private fun mb(bytes: Long) = "%.1f МБ".format(bytes / 1024.0 / 1024.0)

    companion object {
        const val FADE_OUT_MS = 380L
    }
}

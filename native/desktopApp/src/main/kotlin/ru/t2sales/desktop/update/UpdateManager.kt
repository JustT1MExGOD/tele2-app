package ru.t2sales.desktop.update

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.net.URI
import java.nio.file.Path
import java.nio.file.Paths
import java.time.Instant
import javax.net.ssl.SSLContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** Port of main/config.ts (update part): same resolution rules as the Electron client. */
object UpdateConfig {
    const val DEFAULT_UPDATE_BASE_URL = "https://updates.vincere-mortem.ru"

    /** An installed app (jpackage launcher) vs a `gradle run` development run: development never reaches the real update server on its own. */
    val isPackaged: Boolean = System.getProperty("jpackage.app-path") != null

    private fun validated(raw: String): String = runCatching {
        val u = URI(raw)
        val loopbackHttp = u.scheme == "http" && (u.host == "127.0.0.1" || u.host == "localhost")
        if (u.scheme == "https" || loopbackHttp) originOf(u) else ""
    }.getOrDefault("")

    /** T2_UPDATE_BASE_URL wins; otherwise the production server for an installed app; otherwise '' = update checking disabled. */
    val baseUrl: String = (System.getenv("T2_UPDATE_BASE_URL")?.takeIf { it.isNotBlank() } ?: if (isPackaged) DEFAULT_UPDATE_BASE_URL else "").let { if (it.isEmpty()) "" else validated(it) }

    val channel: String = System.getenv("T2_UPDATE_CHANNEL")?.takeIf { it == "stable" || it == "beta" } ?: "stable"

    private val localAppData: Path = Paths.get(System.getenv("LOCALAPPDATA") ?: System.getProperty("java.io.tmpdir"), "T2 Sales Native")
    val cacheDir: Path = localAppData.resolve("updates")
    val logFile: Path = localAppData.resolve("logs").resolve("updater.log")
}

enum class UpdateState { NotConfigured, Checking, UpToDate, UpdateAvailable, Downloading, Verifying, ReadyToInstall, Error }

/** Which structural step failed - lets the UI and the log identify it without parsing the message. */
enum class UpdateErrorStage { Download, Sha256, Authenticode, SignaturePolicy, InstallRecheckSha256, InstallRecheckAuthenticode }

enum class VerificationStage { Sha256, Authenticode }

/** Everything here is safe to show: public release metadata and short hand-written messages, never a path, credential or stack. */
data class UpdateStatus(
    val state: UpdateState,
    val currentVersion: String,
    val channel: String,
    val availableManifest: UpdateManifest? = null,
    val progress: DownloadProgress? = null,
    val errorMessage: String? = null,
    val errorStage: UpdateErrorStage? = null,
    val verificationStage: VerificationStage? = null,
    val signatureWarning: String? = null,
    val lastCheckedAt: String? = null,
    val readyToInstall: Boolean = false
)

enum class CheckTrigger { Manual, Automatic, Startup }

/**
 * Port of updater/manager.ts. A single observable [status]; failures never throw out to the UI - every path lands in
 * `Error` with a short sanitized message. The installer is only ever launched by an explicit user action, and only the exact
 * file this manager downloaded and verified (re-verified immediately before launch).
 */
class UpdateManager(
    private val updateBaseUrl: String = UpdateConfig.baseUrl,
    private val channel: String = UpdateConfig.channel,
    private val currentVersion: String = AppVersion.current,
    private val cacheDir: Path = UpdateConfig.cacheDir,
    private val checkIntervalMs: Long = 4 * 60 * 60 * 1000L,
    private val initialDelayMs: Long = 15_000L,
    private val sslContext: SSLContext? = null, // test-only: trusts an extra CA, never disables verification
    private val verifySignature: suspend (Path) -> AuthenticodeResult = { verifyAuthenticodeSignature(it) },
    private val launch: (Path) -> Unit = { launchInstaller(it) }
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val allowedOrigin: String? = updateBaseUrl.takeIf { it.isNotEmpty() }?.let { originOf(URI(it)) }

    var status by mutableStateOf(UpdateStatus(if (allowedOrigin != null) UpdateState.UpToDate else UpdateState.NotConfigured, currentVersion, channel))
        private set

    private var manifest: UpdateManifest? = null
    private var downloadedFile: Path? = null
    private var timers: Job? = null
    private var downloadJob: Job? = null
    @Volatile private var installStarted = false

    private fun update(block: UpdateStatus.() -> UpdateStatus) {
        status = status.block().let { it.copy(readyToInstall = it.state == UpdateState.ReadyToInstall && downloadedFile != null) }
    }

    /** Never schedules anything without a configured server (a dev run does zero timers and zero network). Idempotent. */
    fun start() {
        if (allowedOrigin == null) return
        timers?.cancel()
        timers = scope.launch {
            delay(initialDelayMs) // never blocks the app's own start-up on a slow or unreachable server
            checkNow(CheckTrigger.Startup)
            while (isActive) {
                delay(checkIntervalMs)
                checkNow(CheckTrigger.Automatic)
            }
        }
    }

    /**
     * Failures land in `state = Error`, never thrown. A check already in flight or an active download/verify is a no-op, and the
     * background timers never disturb a pending, already-verified install (only a manual check may revisit it).
     */
    suspend fun checkNow(trigger: CheckTrigger = CheckTrigger.Manual) {
        if (allowedOrigin == null) return
        val s = status.state
        if (s == UpdateState.Checking || s == UpdateState.Downloading || s == UpdateState.Verifying) return
        if (s == UpdateState.ReadyToInstall && trigger != CheckTrigger.Manual) return
        update { copy(state = UpdateState.Checking) }
        UpdaterLog.write("CHECK", "currentVersion" to currentVersion, "channel" to channel, "trigger" to trigger.name.lowercase())
        try {
            val m = fetchManifest(updateBaseUrl, channel, sslContext = sslContext)
            val now = Instant.now().toString()
            UpdaterLog.write("MANIFEST", "currentVersion" to currentVersion, "targetVersion" to m.version, "channel" to channel,
                "installerBasename" to m.filename, "expectedSize" to m.size, "expectedSha256Prefix" to m.sha256.take(8))
            if (Versions.isNewer(currentVersion, m.version)) {
                if (downloadedFile != null && manifest?.version != m.version) downloadedFile = null // a stale file is never paired with a new manifest
                manifest = m
                update { copy(state = if (downloadedFile != null) UpdateState.ReadyToInstall else UpdateState.UpdateAvailable, availableManifest = m, errorMessage = null, errorStage = null, lastCheckedAt = now) }
            } else {
                manifest = null
                downloadedFile = null // nothing newer is offered any more - nothing stays "ready"
                update { copy(state = UpdateState.UpToDate, availableManifest = null, errorMessage = null, errorStage = null, lastCheckedAt = now) }
            }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: ManifestFetchError) {
            if (e.notPublished) {
                UpdaterLog.write("MANIFEST", "currentVersion" to currentVersion, "channel" to channel, "category" to "not_published")
                manifest = null
                downloadedFile = null
                update { copy(state = UpdateState.UpToDate, availableManifest = null, errorMessage = null, errorStage = null, lastCheckedAt = Instant.now().toString()) }
            } else {
                update { copy(state = UpdateState.Error, errorMessage = sanitize(e), errorStage = null, lastCheckedAt = Instant.now().toString()) }
            }
        } catch (e: Exception) {
            update { copy(state = UpdateState.Error, errorMessage = sanitize(e), errorStage = null, lastCheckedAt = Instant.now().toString()) }
        }
    }

    /** Downloads and verifies (size, SHA-256, Authenticode policy) the offered installer. No-op without an offer or while already busy. */
    fun downloadUpdate() {
        val m = manifest ?: return
        val origin = allowedOrigin ?: return
        if (status.state == UpdateState.Downloading || status.state == UpdateState.Verifying) return
        update { copy(state = UpdateState.Downloading, progress = DownloadProgress(0, m.size), signatureWarning = null, errorStage = null, verificationStage = null) }
        UpdaterLog.write("DOWNLOAD", "currentVersion" to currentVersion, "targetVersion" to m.version, "channel" to channel, "installerBasename" to m.filename, "expectedSize" to m.size)
        downloadJob = scope.launch { runDownload(m, origin) }
    }

    private suspend fun runDownload(m: UpdateManifest, origin: String) {
        val startedAt = System.currentTimeMillis()
        val file = try {
            downloadAndVerifyInstaller(m, cacheDir, origin, sslContext = sslContext) { p -> update { copy(progress = p) } }
        } catch (e: Exception) {
            failDownload(if ((e as? DownloadError)?.stage == DownloadError.Stage.Sha256) UpdateErrorStage.Sha256 else UpdateErrorStage.Download, e, startedAt, m)
            return
        }
        // diagnostic-only snapshot right before the step most likely to fail on a real machine; it decides nothing
        update { copy(state = UpdateState.Verifying, verificationStage = VerificationStage.Sha256) }
        val snap = snapshotFile(file)
        UpdaterLog.write("SHA256", "targetVersion" to m.version, "expectedSize" to m.size, "receivedSize" to snap.size, "expectedSha256Prefix" to m.sha256.take(8),
            "actualSha256Prefix" to snap.sha256Prefix?.takeIf { it != m.sha256.take(8) }, "fileExists" to snap.exists)

        update { copy(verificationStage = VerificationStage.Authenticode) }
        val sig = try {
            verifySignature(file)
        } catch (e: Exception) {
            failDownload(UpdateErrorStage.Authenticode, e, startedAt, m)
            return
        }
        UpdaterLog.write("AUTHENTICODE", "targetVersion" to m.version, "authenticodeStatus" to categorizeAuthenticode(sig.status))
        val block = evaluateSignaturePolicy(channel, sig)
        if (block != null) {
            UpdaterLog.write("SIGNATURE_POLICY", "errorName" to "SignaturePolicyBlocked", "targetVersion" to m.version, "authenticodeStatus" to categorizeAuthenticode(sig.status))
            downloadedFile = null
            update { copy(state = UpdateState.Error, errorMessage = block, errorStage = UpdateErrorStage.SignaturePolicy, verificationStage = null) }
            return
        }
        downloadedFile = file
        update {
            copy(state = UpdateState.ReadyToInstall, errorMessage = null, errorStage = null, verificationStage = null,
                signatureWarning = if (!sig.signed) "Обновление не имеет цифровой подписи (${sig.status}). Проверено только по контрольной сумме (SHA-256)." else null)
        }
        UpdaterLog.write("READY_TO_INSTALL", "targetVersion" to m.version, "channel" to channel)
    }

    private fun failDownload(stage: UpdateErrorStage, e: Exception, startedAt: Long, m: UpdateManifest) {
        UpdaterLog.write(stage.name.uppercase(), "errorName" to e::class.simpleName, "targetVersion" to m.version, "channel" to channel,
            "expectedSize" to m.size, "receivedSize" to status.progress?.receivedBytes, "expectedSha256Prefix" to m.sha256.take(8),
            "category" to (e as? AuthenticodeError)?.category, "durationMs" to (System.currentTimeMillis() - startedAt))
        downloadedFile = null
        update { copy(state = UpdateState.Error, errorMessage = sanitize(e), errorStage = stage, verificationStage = null) }
    }

    fun cancelDownload() { downloadJob?.cancel() }

    /**
     * Launches ONLY the file this manager downloaded and verified. The file waited for an unbounded human click, so immediately
     * before launch its size + SHA-256 and signature policy are checked again (TOCTOU): a file that fails is never launched.
     * Resolves once the installer process was started; `onLaunched` (e.g. exit the app after a short delay) runs after that.
     */
    suspend fun installUpdate(onLaunched: () -> Unit = {}) {
        val file = downloadedFile
        val m = manifest
        if (status.state != UpdateState.ReadyToInstall || file == null || m == null) throw IllegalStateException("нет проверенного обновления для установки")
        if (installStarted) return // a double click must not start the installer twice
        installStarted = true

        fun fail(stage: UpdateErrorStage, message: String, e: Exception?): Nothing {
            UpdaterLog.write(if (stage == UpdateErrorStage.SignaturePolicy) "SIGNATURE_POLICY" else "INSTALL_RECHECK_" + stage.name.removePrefix("InstallRecheck").uppercase(),
                "errorName" to e?.let { it::class.simpleName }, "targetVersion" to m.version, "channel" to channel, "category" to (e as? AuthenticodeError)?.category)
            downloadedFile = null
            update { copy(state = UpdateState.Error, errorMessage = message, errorStage = stage) }
            installStarted = false
            throw IllegalStateException(message)
        }
        try {
            verifyFileIntegrity(file, m.sha256, m.size)
        } catch (e: Exception) {
            fail(UpdateErrorStage.InstallRecheckSha256, sanitize(e), e)
        }
        val sig = try { verifySignature(file) } catch (e: Exception) { fail(UpdateErrorStage.InstallRecheckAuthenticode, sanitize(e), e) }
        evaluateSignaturePolicy(channel, sig)?.let { fail(UpdateErrorStage.SignaturePolicy, it, null) }

        UpdaterLog.write("INSTALL_LAUNCH_START", "targetVersion" to m.version, "channel" to channel)
        try {
            launch(file)
        } catch (e: Exception) {
            UpdaterLog.write("INSTALL_LAUNCH_START", "errorName" to e::class.simpleName, "targetVersion" to m.version, "channel" to channel)
            downloadedFile = null
            update { copy(state = UpdateState.Error, errorMessage = sanitize(e), errorStage = null) }
            installStarted = false
            throw e
        }
        UpdaterLog.write("INSTALL_PROCESS_STARTED", "targetVersion" to m.version, "channel" to channel)
        onLaunched()
    }

    fun dispose() {
        timers?.cancel()
        downloadJob?.cancel()
    }

    /** Only our own hand-written short messages reach the user - never a raw exception text, path or stack. */
    private fun sanitize(e: Exception): String = when (e) {
        is ManifestFetchError, is DownloadError, is ManifestValidationError, is AuthenticodeError -> e.message ?: "Не удалось проверить обновление"
        is InstallLaunchError -> "Не удалось запустить установщик обновления"
        else -> "Не удалось проверить обновление"
    }
}

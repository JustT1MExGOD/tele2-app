package ru.t2sales.desktop.update

import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

// ---------------------------------------------------------------- Authenticode (port of updater/signature.ts)

enum class SignatureStatus { Valid, NotSigned, HashMismatch, NotTrusted, UnknownError, Invalid }

data class AuthenticodeResult(val status: SignatureStatus, val subject: String?) {
    val signed: Boolean get() = status == SignatureStatus.Valid
}

/** Fine-grained reason the check itself could not produce a result - for the diagnostic log only, never shown verbatim. */
class AuthenticodeError(message: String, val category: String) : Exception(message)

// The path is passed as a script ARGUMENT ($args[0]) to `-File`, never interpolated into the script text or a shell command line.
private val POWERSHELL_SCRIPT = listOf(
    "\$ErrorActionPreference = \"Stop\"",
    "try {",
    "  \$sig = Get-AuthenticodeSignature -LiteralPath \$args[0]",
    "  \$subject = \$null",
    "  if (\$sig.SignerCertificate) { \$subject = \$sig.SignerCertificate.Subject }",
    "  [PSCustomObject]@{ status = \$sig.Status.ToString(); subject = \$subject } | ConvertTo-Json -Compress",
    "} catch {",
    "  [PSCustomObject]@{ status = \"UnknownError\"; subject = \$null } | ConvertTo-Json -Compress",
    "}"
).joinToString("; ")

private val scriptPath: Path by lazy {
    val dir = Files.createTempDirectory("t2sales-authenticode-") // unpredictable directory: no pre-planted link at a guessable path
    dir.resolve("check-signature.ps1").also { Files.writeString(it, POWERSHELL_SCRIPT) }
}

suspend fun verifyAuthenticodeSignature(file: Path, timeoutSec: Long = 15): AuthenticodeResult = withContext(Dispatchers.IO) {
    val script = try { scriptPath } catch (e: Exception) { throw AuthenticodeError("Не удалось запустить проверку цифровой подписи Windows", "temp_script_create_failed") }
    val proc = try {
        ProcessBuilder("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script.toString(), file.toString())
            .redirectErrorStream(false).start()
    } catch (e: Exception) {
        throw AuthenticodeError("Не удалось запустить проверку цифровой подписи Windows", "powershell_not_found")
    }
    val stdout = StringBuilder()
    val reader = Thread { runCatching { stdout.append(proc.inputStream.readBytes().toString(Charsets.UTF_8)) } }.also { it.isDaemon = true; it.start() }
    Thread { runCatching { proc.errorStream.readBytes() } }.also { it.isDaemon = true; it.start() } // drained, never shown
    if (!proc.waitFor(timeoutSec, TimeUnit.SECONDS)) {
        proc.destroyForcibly()
        throw AuthenticodeError("Проверка цифровой подписи Windows превысила время ожидания", "powershell_timeout")
    }
    reader.join(2000)
    if (proc.exitValue() != 0) throw AuthenticodeError("Не удалось запустить проверку цифровой подписи Windows", "powershell_execution_failed")
    val cleaned = stdout.toString().removePrefix("﻿").trim()
    if (cleaned.isEmpty()) throw AuthenticodeError("Проверка цифровой подписи Windows вернула пустой результат", "powershell_empty_output")
    val obj = runCatching { Json.parseToJsonElement(cleaned) as JsonObject }.getOrElse {
        throw AuthenticodeError("Проверка цифровой подписи вернула некорректный результат", "powershell_invalid_json")
    }
    val status = SignatureStatus.entries.firstOrNull { it.name == (obj["status"] as? JsonPrimitive)?.contentOrNull } ?: SignatureStatus.UnknownError
    AuthenticodeResult(status, if (status == SignatureStatus.Valid) (obj["subject"] as? JsonPrimitive)?.contentOrNull else null)
}

enum class SignaturePolicy { Required, Warn }

/** The one named place to flip once a certificate exists: `stable = Required` rejects unsigned installers outright. */
val AUTHENTICODE_POLICY: Map<String, SignaturePolicy> = mapOf("stable" to SignaturePolicy.Warn, "beta" to SignaturePolicy.Warn)

/**
 * null = the install may proceed, otherwise the user-facing reason. SHA-256 is always required regardless (enforced in the
 * downloader). "NotSigned" is the only status a `Warn` channel tolerates; a signature that IS present but fails verification, or
 * an inconclusive check, is always rejected - a file claiming an authenticity it does not have is worse than one that claims none.
 */
fun evaluateSignaturePolicy(channel: String, result: AuthenticodeResult): String? {
    if (result.signed) return null
    if (result.status != SignatureStatus.NotSigned) return "Цифровая подпись повреждена или недействительна — установка отменена"
    if (AUTHENTICODE_POLICY[channel] == SignaturePolicy.Required) return "Сборка не подписана, а этот канал обновлений требует подписи"
    return null
}

fun categorizeAuthenticode(status: SignatureStatus) = "authenticode_" + when (status) {
    SignatureStatus.Valid -> "valid"
    SignatureStatus.NotSigned -> "not_signed"
    SignatureStatus.HashMismatch -> "hash_mismatch"
    SignatureStatus.NotTrusted -> "not_trusted"
    SignatureStatus.Invalid -> "invalid"
    SignatureStatus.UnknownError -> "unknown"
}

// ---------------------------------------------------------------- launcher (port of updater/install-launcher.ts)

class InstallLaunchError(message: String) : Exception(message)

/** Every native installer is named exactly like this (update-prepare.mjs enforces the same shape) - matched again at the launch boundary. */
val SAFE_INSTALLER_FILENAME_RE = Regex("^T2SalesNative-Setup-x64-\\d+\\.\\d+\\.\\d+\\.exe$")

/**
 * The only input is a path this process itself produced (the verified final file). No command line is ever built from manifest
 * data: the single argument is the constant [INSTALLER_UPDATE_FLAG]. It is NOT a silent install - the installer shows its animated
 * progress window, but skips the welcome page, installs at once, relaunches the app and closes (a Discord-style update).
 * The process is started with an argument vector (no shell), so there is no command-line boundary to inject into.
 */
const val INSTALLER_UPDATE_FLAG = "/UPDATE"

fun launchInstaller(installer: Path, open: (java.io.File) -> Unit = { ProcessBuilder(it.absolutePath, INSTALLER_UPDATE_FLAG).start() }) {
    if (!installer.isAbsolute) throw InstallLaunchError("installer path must be absolute")
    if (!installer.fileName.toString().lowercase().endsWith(".exe")) throw InstallLaunchError("installer must be a .exe")
    if (!SAFE_INSTALLER_FILENAME_RE.matches(installer.fileName.toString())) throw InstallLaunchError("installer has an unexpected filename shape")
    if (!Files.isRegularFile(installer)) throw InstallLaunchError("installer file not found")
    try {
        open(installer.toFile())
    } catch (e: Exception) {
        throw InstallLaunchError("failed to launch installer")
    }
}

// ---------------------------------------------------------------- local diagnostic log (port of updater/diagnostic-log.ts)

/** Append-only `updater.log` so ONE small file shows which stage failed. Only short structural fields - never a path, URL, stack or credential. */
object UpdaterLog {
    @Volatile var file: Path? = null

    fun write(stage: String, vararg fields: Pair<String, Any?>) {
        val target = file ?: return
        runCatching {
            Files.createDirectories(target.parent)
            val obj = buildString {
                append("{\"ts\":\"").append(java.time.Instant.now()).append("\",\"stage\":\"").append(stage).append('"')
                for ((k, v) in fields) {
                    if (v == null) continue
                    append(",\"").append(k).append("\":")
                    if (v is Number || v is Boolean) append(v) else append('"').append(v.toString().replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ")).append('"')
                }
                append("}\n")
            }
            Files.writeString(target, obj, java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.APPEND)
        }
    }
}

package ru.t2sales.shared.auth

import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/**
 * Persists the Miranda device secret the same way FileCookiesStorage.kt
 * persists t2_session: DPAPI-sealed on disk at ~/.t2sales/miranda-device.enc,
 * sharing the same config dir/trust boundary as the session cookie (Miranda
 * shares backend auth with T2 Sales, so there is no reason to invent a
 * second secret-storage location). Loss of the DPAPI key (e.g. file copied
 * to another machine/user) makes the file unreadable - treated as "not yet
 * registered", matching FileCookiesStorage's "copied file = not signed in".
 */
class MirandaDeviceSecretStore(private val protector: SecretProtector? = platformSecretProtector()) {
    private val file = File(platformConfigDir()).apply { mkdirs() }.resolve("miranda-device.enc")

    fun load(): String? {
        if (!file.exists()) return null
        return runCatching {
            val raw = file.readBytes()
            if (!raw.startsWith(MAGIC)) return raw.decodeToString() // legacy unencrypted write
            val sealed = java.util.Base64.getDecoder().decode(raw.copyOfRange(MAGIC.size, raw.size).decodeToString().trim())
            protector?.unprotect(sealed)?.decodeToString()
        }.getOrNull()
    }

    fun save(secret: String) {
        val tmp = File(file.path + ".tmp")
        if (protector == null) {
            tmp.writeText(secret)
        } else {
            val sealed = java.util.Base64.getEncoder().encodeToString(protector.protect(secret.toByteArray(Charsets.UTF_8)))
            tmp.writeBytes(MAGIC + sealed.toByteArray(Charsets.US_ASCII))
        }
        Files.move(tmp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING)
    }

    fun clear() {
        file.delete()
    }

    private fun ByteArray.startsWith(prefix: ByteArray) = size >= prefix.size && prefix.indices.all { this[it] == prefix[it] }

    private companion object {
        val MAGIC = "T2DPAPI1:".toByteArray(Charsets.US_ASCII)
    }
}

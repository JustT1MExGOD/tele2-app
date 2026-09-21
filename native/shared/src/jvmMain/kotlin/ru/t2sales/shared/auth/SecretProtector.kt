package ru.t2sales.shared.auth

import com.sun.jna.platform.win32.Crypt32Util

/**
 * Windows DPAPI: the key is tied to the signed-in Windows account, so nothing but that account on that PC can read the data. The
 * entropy adds a second, app-specific factor. No password or key is stored by the app.
 */
object WindowsDpapi : SecretProtector {
    private val entropy = "T2 Sales Native / cookies v1".toByteArray(Charsets.UTF_8)

    override fun protect(plain: ByteArray): ByteArray = Crypt32Util.cryptProtectData(plain, entropy, 0, "T2 Sales Native", null)

    override fun unprotect(sealed: ByteArray): ByteArray? = runCatching { Crypt32Util.cryptUnprotectData(sealed, entropy, 0, null) }.getOrNull()
}

/** DPAPI where it exists; no protection elsewhere (the file then stays readable JSON, as before). */
actual fun platformSecretProtector(): SecretProtector? =
    if (System.getProperty("os.name").orEmpty().startsWith("Windows")) runCatching { WindowsDpapi.also { it.protect(ByteArray(1)) } }.getOrNull() else null

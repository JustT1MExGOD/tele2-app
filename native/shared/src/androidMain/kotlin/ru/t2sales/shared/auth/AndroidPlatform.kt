package ru.t2sales.shared.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Set once from Application.onCreate: the shared code needs the app's private storage directory. */
object AndroidPlatform {
    lateinit var appContext: Context
        private set

    fun init(context: Context) {
        appContext = context.applicationContext
    }
}

actual fun platformConfigDir(): String = AndroidPlatform.appContext.filesDir.resolve("t2sales").apply { mkdirs() }.absolutePath

/**
 * Android Keystore (AES-256-GCM): the key never leaves the device's secure hardware/TEE, so a copied cookies.json is useless anywhere
 * else. Stored form: 12-byte IV followed by the ciphertext. Anything that cannot be opened (key lost after a reset, tampered data)
 * means "not signed in".
 */
object AndroidKeystoreProtector : SecretProtector {
    private const val ALIAS = "t2sales-session-key"
    private const val PROVIDER = "AndroidKeyStore"

    private fun key(): SecretKey {
        val store = KeyStore.getInstance(PROVIDER).apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }

    override fun protect(plain: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        return cipher.iv + cipher.doFinal(plain)
    }

    override fun unprotect(sealed: ByteArray): ByteArray? = runCatching {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed.copyOfRange(0, 12))) }
        cipher.doFinal(sealed, 12, sealed.size - 12)
    }.getOrNull()
}

actual fun platformSecretProtector(): SecretProtector? = AndroidKeystoreProtector

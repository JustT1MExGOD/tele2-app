package ru.t2sales.shared.auth

/** Encrypts small secrets (the sign-in cookies) so that a copied file is useless anywhere else. */
interface SecretProtector {
    fun protect(plain: ByteArray): ByteArray

    /** Null when the data cannot be opened here (another Windows user or another PC): the caller treats that as "not signed in". */
    fun unprotect(sealed: ByteArray): ByteArray?
}

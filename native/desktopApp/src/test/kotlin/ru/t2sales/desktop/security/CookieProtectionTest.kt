package ru.t2sales.desktop.security

import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import ru.t2sales.shared.auth.WindowsDpapi
import ru.t2sales.shared.auth.platformSecretProtector

class CookieProtectionTest {
    private val windows = System.getProperty("os.name").orEmpty().startsWith("Windows")

    @Test fun dpapiRoundTripAndTheSealedBytesHideTheSecret() {
        if (!windows) return
        val secret = "t2_session=SUPER-SECRET-VALUE-123".toByteArray()
        val sealed = WindowsDpapi.protect(secret)
        assertFalse(String(sealed, Charsets.ISO_8859_1).contains("SUPER-SECRET-VALUE"), "the secret must not appear in what is written to disk")
        assertContentEquals(secret, WindowsDpapi.unprotect(sealed))
    }

    @Test fun garbageOrTamperedDataIsRefusedNotCrashed() {
        if (!windows) return
        assertNull(WindowsDpapi.unprotect(byteArrayOf(1, 2, 3, 4, 5)))
        val sealed = WindowsDpapi.protect("abc".toByteArray())
        sealed[sealed.size / 2] = (sealed[sealed.size / 2].toInt() xor 0x55).toByte()
        assertNull(WindowsDpapi.unprotect(sealed), "a modified file counts as 'not signed in'")
    }

    @Test fun windowsGetsAProtector() {
        if (windows) assertNotNull(platformSecretProtector()) else assertNull(platformSecretProtector())
    }

    @Test fun cookieStoreEncryptsMigratesAndSurvivesAReopen() {
        if (!windows) return
        // FileCookiesStorage keeps its file under user.home/.t2sales, so run it against a throw-away home
        val realHome = System.getProperty("user.home")
        val home = Files.createTempDirectory("t2home")
        System.setProperty("user.home", home.toString())
        try {
            val dir = home.resolve(".t2sales").also { Files.createDirectories(it) }
            val file = dir.resolve("cookies.json")
            // an older, plain file (what version 1.0/1.1 wrote)
            Files.writeString(file, """[{"name":"t2_session","value":"OLD-PLAIN-VALUE","domain":"example.com","path":"/"}]""")

            val migrated = ru.t2sales.shared.api.FileCookiesStorage()
            val onDisk = Files.readAllBytes(file)
            assertTrue(String(onDisk, Charsets.US_ASCII).startsWith("T2DPAPI1:"), "the plain file was rewritten encrypted")
            assertFalse(String(onDisk, Charsets.ISO_8859_1).contains("OLD-PLAIN-VALUE"))
            val got = kotlinx.coroutines.runBlocking { migrated.get(io.ktor.http.Url("https://example.com/x")) }
            assertEquals("OLD-PLAIN-VALUE", got.single { it.name == "t2_session" }.value)

            // a new cookie is stored encrypted too, and a fresh instance (a restart) reads both back
            kotlinx.coroutines.runBlocking { migrated.addCookie(io.ktor.http.Url("https://example.com/"), io.ktor.http.Cookie("t2_csrf", "CSRF-VALUE", domain = "example.com", path = "/")) }
            assertFalse(String(Files.readAllBytes(file), Charsets.ISO_8859_1).contains("CSRF-VALUE"))
            val reopened = ru.t2sales.shared.api.FileCookiesStorage()
            val both = kotlinx.coroutines.runBlocking { reopened.get(io.ktor.http.Url("https://example.com/y")) }.associate { it.name to it.value }
            assertEquals(mapOf("t2_session" to "OLD-PLAIN-VALUE", "t2_csrf" to "CSRF-VALUE"), both)

            // a damaged encrypted file must not crash the app: it just means "sign in again"
            Files.write(file, "T2DPAPI1:not-base64-!!!".toByteArray())
            assertEquals(0, kotlinx.coroutines.runBlocking { ru.t2sales.shared.api.FileCookiesStorage().get(io.ktor.http.Url("https://example.com/z")) }.size)
        } finally {
            System.setProperty("user.home", realHome)
        }
    }
}

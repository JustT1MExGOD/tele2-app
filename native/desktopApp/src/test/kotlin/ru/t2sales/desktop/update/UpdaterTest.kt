package ru.t2sales.desktop.update

import com.sun.net.httpserver.HttpsConfigurator
import com.sun.net.httpserver.HttpsServer
import java.net.InetSocketAddress
import java.nio.file.Files
import java.nio.file.Path
import java.security.KeyStore
import java.security.MessageDigest
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

private fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

class VersionTest {
    @Test fun numericNotLexicographic() {
        assertTrue(Versions.isNewer("20.55.2", "20.55.10"))
        assertFalse(Versions.isNewer("20.55.10", "20.55.2"))
        assertTrue(Versions.isNewer("1.0.0", "1.0.1"))
        assertTrue(Versions.isNewer("1.9.9", "2.0.0"))
    }

    @Test fun equalOlderAndMalformedNeverUpdate() {
        assertFalse(Versions.isNewer("1.0.0", "1.0.0"))
        assertFalse(Versions.isNewer("1.2.0", "1.1.9")) // never a downgrade
        for (bad in listOf("", "v1.0.0", "1.0.0-beta.1", "1..0", "1.0.x", "-1.0.0", " ")) {
            assertNull(Versions.parse(bad), "should not parse: '$bad'")
            assertFalse(Versions.isNewer("1.0.0", bad))
        }
        assertNull(Versions.compare("1.0.0", "garbage"))
    }
}

class ManifestValidationTest {
    private val origin = "https://updates.example.com"
    private val good = """
        {"schemaVersion":1,"channel":"stable","version":"1.2.3","publishedAt":"2026-09-20T12:00:00Z","mandatory":false,
         "installer":{"filename":"T2SalesNative-Setup-x64-1.2.3.exe","url":"https://updates.example.com/native/releases/T2SalesNative-Setup-x64-1.2.3.exe",
         "sha256":"${"a".repeat(64)}","size":1234},"releaseNotes":"Исправления","minSupportedVersion":"1.0.0"}
    """.trimIndent()

    private fun parse(json: String): JsonElement = Json.parseToJsonElement(json)
    private fun bad(json: String, channel: String = "stable") = assertFailsWith<ManifestValidationError> { validateManifest(parse(json), channel, origin) }
    private fun mutate(from: String, to: String) = good.replace(from, to).also { assertTrue(it != good, "mutation did not apply: $from") }

    @Test fun acceptsAValidManifest() {
        val m = validateManifest(parse(good), "stable", origin)
        assertEquals("1.2.3", m.version)
        assertEquals(1234L, m.size)
        assertEquals("T2SalesNative-Setup-x64-1.2.3.exe", m.filename)
        assertEquals("Исправления", m.releaseNotes)
        assertFalse(m.mandatory)
    }

    @Test fun rejectsWrongChannelAndUnsupportedSchema() {
        bad(good, channel = "beta")
        bad(mutate("\"schemaVersion\":1", "\"schemaVersion\":2"))
        bad(mutate("\"channel\":\"stable\"", "\"channel\":\"nightly\""))
    }

    @Test fun rejectsForeignOriginNonHttpsAndWrongPath() {
        bad(mutate("https://updates.example.com/native/releases/", "https://evil.example.com/native/releases/"))
        bad(mutate("https://updates.example.com/native/releases/", "http://updates.example.com/native/releases/"))
        bad(mutate("/native/releases/T2SalesNative", "/releases/T2SalesNative")) // the Electron subtree is not accepted
        bad(mutate("/native/releases/T2SalesNative", "/native/stable/../releases/T2SalesNative"))
        bad(mutate("/native/releases/T2SalesNative-Setup-x64-1.2.3.exe\"", "/native/releases/Other-1.2.3.exe\"")) // url filename != installer.filename
    }

    @Test fun rejectsUnsafeFilenames() {
        for (name in listOf("../evil.exe", "a/b.exe", "a\\b.exe", "CON.exe", "con.v2.exe", "setup.msi", "-rf.exe", "a b.exe", ".exe")) {
            bad(mutate("\"filename\":\"T2SalesNative-Setup-x64-1.2.3.exe\"", "\"filename\":\"${name.replace("\\", "\\\\")}\""))
        }
    }

    @Test fun rejectsBadHashSizeAndTypes() {
        bad(mutate("a".repeat(64), "z".repeat(64)))
        bad(mutate("a".repeat(64), "a".repeat(63)))
        bad(mutate("\"size\":1234", "\"size\":0"))
        bad(mutate("\"size\":1234", "\"size\":-5"))
        bad(mutate("\"size\":1234", "\"size\":${500L * 1024 * 1024 + 1}"))
        bad(mutate("\"size\":1234", "\"size\":12.5"))
        bad(mutate("\"size\":1234", "\"size\":\"1234\""))
        bad(mutate("\"mandatory\":false", "\"mandatory\":\"false\""))
        bad(mutate("\"version\":\"1.2.3\"", "\"version\":\"1.2.3-beta\""))
        bad(mutate("2026-09-20T12:00:00Z", "yesterday"))
        bad(mutate("\"minSupportedVersion\":\"1.0.0\"", "\"minSupportedVersion\":\"x\""))
    }

    @Test fun boundsReleaseNotesAndIgnoresUnknownFieldsWithoutCarryingThem() {
        bad(mutate("\"releaseNotes\":\"Исправления\"", "\"releaseNotes\":\"${"x".repeat(8001)}\""))
        val m = validateManifest(parse(mutate("\"mandatory\":false", "\"mandatory\":true,\"command\":\"calc.exe\",\"args\":[\"/S\"]")), "stable", origin)
        assertTrue(m.mandatory)
        // the returned type has no command / arguments / local-path field at all: unknown keys cannot become executable input
        assertEquals(setOf("channel", "version", "publishedAt", "mandatory", "filename", "url", "sha256", "size", "releaseNotes", "minSupportedVersion"),
            UpdateManifest::class.java.declaredFields.map { it.name }.filter { !it.startsWith("\$") && it != "Companion" }.toSet())
    }
}

class LauncherTest {
    @Test fun refusesAnythingButTheExactInstallerShape() {
        val dir = Files.createTempDirectory("t2launch")
        val good = dir.resolve("T2SalesNative-Setup-x64-1.0.1.exe").also { Files.write(it, byteArrayOf(1, 2, 3)) }
        var opened: java.io.File? = null
        launchInstaller(good) { opened = it }
        assertEquals(good.toFile(), opened)

        fun refused(p: Path) { var called = false; assertFailsWith<InstallLaunchError> { launchInstaller(p) { called = true } }; assertFalse(called, "must not run: $p") }
        refused(Path.of("T2SalesNative-Setup-x64-1.0.1.exe")) // relative
        refused(dir.resolve("T2SalesNative-Setup-x64-1.0.1.msi").also { Files.write(it, byteArrayOf(1)) })
        refused(dir.resolve("evil.exe").also { Files.write(it, byteArrayOf(1)) })
        refused(dir.resolve("T2Sales-Setup-x64-1.0.1.exe").also { Files.write(it, byteArrayOf(1)) }) // the Electron installer is not ours
        refused(dir.resolve("T2SalesNative-Setup-x64-9.9.9.exe")) // does not exist
        assertFailsWith<InstallLaunchError> { launchInstaller(good) { throw RuntimeException("boom") } }
    }
}

class SignaturePolicyTest {
    @Test fun policyMatchesTheElectronClient() {
        assertNull(evaluateSignaturePolicy("stable", AuthenticodeResult(SignatureStatus.Valid, "CN=x")))
        assertNull(evaluateSignaturePolicy("stable", AuthenticodeResult(SignatureStatus.NotSigned, null))) // warn: allowed
        assertNull(evaluateSignaturePolicy("beta", AuthenticodeResult(SignatureStatus.NotSigned, null)))
        for (s in listOf(SignatureStatus.HashMismatch, SignatureStatus.NotTrusted, SignatureStatus.Invalid, SignatureStatus.UnknownError)) {
            assertNotNull(evaluateSignaturePolicy("stable", AuthenticodeResult(s, null)), "$s must be blocked")
        }
    }

    /** Runs the REAL PowerShell path: a genuinely signed Windows binary is Valid, a non-PE file renamed .exe is never treated as "just unsigned". */
    @Test fun realPowerShellVerification() = runBlocking {
        val notepad = Path.of(System.getenv("SystemRoot") ?: "C:\\Windows", "System32", "notepad.exe")
        if (Files.exists(notepad)) {
            val r = verifyAuthenticodeSignature(notepad)
            assertEquals(SignatureStatus.Valid, r.status)
            assertNotNull(r.subject)
        }
        // a real, genuinely unsigned PE (our own build output, if it exists here) must come back as plain NotSigned - the case the warn policy tolerates
        val ours = Path.of(System.getProperty("user.dir")).resolve("build/compose/binaries/main/app/T2 Sales Native/T2 Sales Native.exe")
        if (Files.exists(ours)) assertEquals(SignatureStatus.NotSigned, verifyAuthenticodeSignature(ours).status)
        val fake = Files.createTempFile("t2fake", ".exe").also { Files.writeString(it, "not a real executable") }
        val r2 = verifyAuthenticodeSignature(fake)
        assertFalse(r2.signed)
        println("real PowerShell on a non-PE .exe -> ${r2.status}")
    }
}

/** Real end-to-end: a local HTTPS update server (real TLS, self-signed cert trusted only by the test client) and the real UpdateManager. */
class UpdateManagerE2ETest {
    private lateinit var server: HttpsServer
    private lateinit var ssl: SSLContext
    private lateinit var base: String
    private lateinit var cache: Path
    private var installerBytes = ByteArray(0)
    private var manifestVersion = "1.1.0"
    private var manifestChannel = "stable"
    private var advertisedSha: String? = null
    private var serveBytes: ByteArray? = null
    private var redirect = false
    private var manifestMissing = false
    private val launched = mutableListOf<Path>()

    private fun manifestJson(): String {
        val fn = "T2SalesNative-Setup-x64-$manifestVersion.exe"
        val sha = advertisedSha ?: sha256(installerBytes)
        return """{"schemaVersion":1,"channel":"$manifestChannel","version":"$manifestVersion","publishedAt":"2026-09-20T12:00:00Z","mandatory":false,
            "installer":{"filename":"$fn","url":"$base/native/releases/$fn","sha256":"$sha","size":${installerBytes.size}},"releaseNotes":"Тест"}"""
    }

    @BeforeTest fun setUp() {
        val dir = Files.createTempDirectory("t2e2e")
        cache = dir.resolve("updates")
        val ks = dir.resolve("ks.p12")
        val keytool = Path.of(System.getProperty("java.home"), "bin", "keytool.exe").let { if (Files.exists(it)) it.toString() else "keytool" }
        val p = ProcessBuilder(keytool, "-genkeypair", "-alias", "t", "-keyalg", "RSA", "-keysize", "2048", "-validity", "2", "-storetype", "PKCS12",
            "-keystore", ks.toString(), "-storepass", "changeit", "-dname", "CN=localhost", "-ext", "san=dns:localhost,ip:127.0.0.1").redirectErrorStream(true).start()
        val out = p.inputStream.readBytes().toString(Charsets.UTF_8)
        check(p.waitFor() == 0) { "keytool failed: $out" }
        val store = KeyStore.getInstance("PKCS12").also { s -> Files.newInputStream(ks).use { s.load(it, "changeit".toCharArray()) } }
        val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).also { it.init(store, "changeit".toCharArray()) }
        val tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).also { it.init(store) }
        ssl = SSLContext.getInstance("TLS").also { it.init(kmf.keyManagers, tmf.trustManagers, null) }

        installerBytes = ByteArray(300_000) { (it * 31 + 7).toByte() }
        server = HttpsServer.create(InetSocketAddress("localhost", 0), 0)
        server.httpsConfigurator = HttpsConfigurator(SSLContext.getInstance("TLS").also { it.init(kmf.keyManagers, null, null) })
        server.createContext("/") { ex ->
            val path = ex.requestURI.path
            when {
                redirect && path.startsWith("/native/releases/") -> { ex.responseHeaders.add("Location", "https://evil.example.com/x.exe"); ex.sendResponseHeaders(302, -1) }
                manifestMissing && path.endsWith("/manifest.json") -> ex.sendResponseHeaders(404, -1)
                path == "/native/stable/manifest.json" || path == "/native/beta/manifest.json" -> {
                    val b = manifestJson().toByteArray(); ex.responseHeaders.add("Content-Type", "application/json"); ex.sendResponseHeaders(200, b.size.toLong()); ex.responseBody.use { it.write(b) }
                }
                path.startsWith("/native/releases/") -> {
                    val b = serveBytes ?: installerBytes; ex.sendResponseHeaders(200, b.size.toLong()); ex.responseBody.use { it.write(b) }
                }
                else -> ex.sendResponseHeaders(404, -1)
            }
            ex.close()
        }
        server.start()
        base = "https://localhost:${server.address.port}"
    }

    @AfterTest fun tearDown() { server.stop(0) }

    private fun manager(current: String = "1.0.0", signature: AuthenticodeResult = AuthenticodeResult(SignatureStatus.NotSigned, null)) =
        UpdateManager(updateBaseUrl = base, channel = "stable", currentVersion = current, cacheDir = cache, sslContext = ssl,
            verifySignature = { signature }, launch = { launched.add(it) })

    private fun awaitState(m: UpdateManager, vararg want: UpdateState) {
        val end = System.currentTimeMillis() + 15_000
        while (System.currentTimeMillis() < end && m.status.state !in want) Thread.sleep(25)
        assertTrue(m.status.state in want, "expected ${want.toList()} but was ${m.status.state}: ${m.status.errorMessage}")
    }

    @Test fun upToDateWhenServerIsNotNewer() = runBlocking {
        val m = manager(current = "1.1.0")
        m.checkNow()
        assertEquals(UpdateState.UpToDate, m.status.state)
        assertNull(m.status.availableManifest)
        manifestVersion = "1.0.5" // an older manifest never downgrades
        m.checkNow()
        assertEquals(UpdateState.UpToDate, m.status.state)
    }

    @Test fun fullHappyPathCheckDownloadVerifyInstall() = runBlocking {
        val m = manager()
        m.checkNow()
        assertEquals(UpdateState.UpdateAvailable, m.status.state)
        assertEquals("1.1.0", m.status.availableManifest?.version)

        m.downloadUpdate()
        awaitState(m, UpdateState.ReadyToInstall)
        assertTrue(m.status.readyToInstall)
        assertNotNull(m.status.signatureWarning, "an unsigned installer must show the SHA-256-only warning")
        val file = cache.resolve("T2SalesNative-Setup-x64-1.1.0.exe")
        assertTrue(Files.exists(file))
        assertTrue(Files.list(cache).use { s -> s.noneMatch { it.fileName.toString().endsWith(".download") } }, "no temp file may be left behind")
        assertEquals(sha256(installerBytes), sha256(Files.readAllBytes(file)))

        var exited = false
        m.installUpdate { exited = true }
        assertEquals(listOf(file), launched)
        assertTrue(exited)
        m.installUpdate { kotlin.test.fail("a second call must not start the installer twice") } // installStarted guard
        assertEquals(1, launched.size)
    }

    @Test fun installerIsLaunchedOnlyAfterAnExplicitCall() = runBlocking {
        val m = manager()
        m.checkNow(); m.downloadUpdate(); awaitState(m, UpdateState.ReadyToInstall)
        m.checkNow(CheckTrigger.Automatic); m.checkNow(CheckTrigger.Startup)
        assertEquals(UpdateState.ReadyToInstall, m.status.state, "background checks must not disturb a pending verified install")
        assertTrue(launched.isEmpty(), "nothing may launch by itself")
        assertFailsWith<IllegalStateException> { manager().installUpdate() } // nothing verified -> refuse
    }

    @Test fun wrongHashIsRejectedAndNothingIsLeftBehind() = runBlocking {
        advertisedSha = "b".repeat(64)
        val m = manager()
        m.checkNow(); m.downloadUpdate(); awaitState(m, UpdateState.Error)
        assertEquals(UpdateErrorStage.Sha256, m.status.errorStage)
        assertFalse(m.status.readyToInstall)
        assertFalse(Files.exists(cache.resolve("T2SalesNative-Setup-x64-1.1.0.exe")), "an unverified file must never get the runnable name")
        assertTrue(Files.list(cache).use { s -> s.count() } == 0L, "the temp file must be removed")
        assertFailsWith<IllegalStateException> { m.installUpdate() }
        assertTrue(launched.isEmpty())
    }

    @Test fun serverSendingDifferentSizeOrMoreBytesIsRejected() = runBlocking {
        serveBytes = installerBytes + byteArrayOf(9, 9, 9)
        val m = manager()
        m.checkNow(); m.downloadUpdate(); awaitState(m, UpdateState.Error)
        assertTrue(launched.isEmpty())
        assertFalse(Files.exists(cache.resolve("T2SalesNative-Setup-x64-1.1.0.exe")))
    }

    @Test fun redirectsAreNeverFollowed() = runBlocking {
        val m = manager()
        m.checkNow()
        redirect = true
        m.downloadUpdate(); awaitState(m, UpdateState.Error)
        assertTrue(m.status.errorMessage!!.contains("перенаправление"))
    }

    @Test fun fileSwappedWhileWaitingForTheClickIsNeverLaunched() = runBlocking {
        val m = manager()
        m.checkNow(); m.downloadUpdate(); awaitState(m, UpdateState.ReadyToInstall)
        val file = cache.resolve("T2SalesNative-Setup-x64-1.1.0.exe")
        Files.write(file, ByteArray(installerBytes.size) { 0x41 }) // same size, different content
        assertFailsWith<IllegalStateException> { m.installUpdate() }
        assertEquals(UpdateState.Error, m.status.state)
        assertEquals(UpdateErrorStage.InstallRecheckSha256, m.status.errorStage)
        assertTrue(launched.isEmpty(), "a swapped file must never reach the OS")
    }

    @Test fun brokenSignatureBlocksButMissingSignatureDoesNot() = runBlocking {
        for (bad in listOf(SignatureStatus.HashMismatch, SignatureStatus.NotTrusted, SignatureStatus.Invalid, SignatureStatus.UnknownError)) {
            val m = manager(signature = AuthenticodeResult(bad, null))
            m.checkNow(); m.downloadUpdate(); awaitState(m, UpdateState.Error)
            assertEquals(UpdateErrorStage.SignaturePolicy, m.status.errorStage, "$bad")
        }
        val signed = manager(signature = AuthenticodeResult(SignatureStatus.Valid, "CN=T2"))
        signed.checkNow(); signed.downloadUpdate(); awaitState(signed, UpdateState.ReadyToInstall)
        assertNull(signed.status.signatureWarning, "a valid signature shows no warning")
    }

    @Test fun manifestForAnotherChannelOrUnreachableServerLandsInErrorNotACrash() = runBlocking {
        manifestChannel = "beta"
        val m = manager()
        m.checkNow()
        assertEquals(UpdateState.Error, m.status.state)
        assertNotNull(m.status.errorMessage)

        val dead = UpdateManager(updateBaseUrl = "https://localhost:1", channel = "stable", currentVersion = "1.0.0", cacheDir = cache, sslContext = ssl)
        dead.checkNow()
        assertEquals(UpdateState.Error, dead.status.state)
        val untrusted = UpdateManager(updateBaseUrl = base, channel = "stable", currentVersion = "1.0.0", cacheDir = cache) // system trust store only
        untrusted.checkNow()
        assertEquals(UpdateState.Error, untrusted.status.state, "a certificate the system does not trust must fail, not be accepted")
    }

    @Test fun nothingPublishedYetIsNotAnError() = runBlocking {
        manifestMissing = true
        val m = manager()
        m.checkNow()
        assertEquals(UpdateState.UpToDate, m.status.state, "HTTP 404 on the manifest = no native release published yet")
        assertNull(m.status.errorMessage)
    }

    @Test fun notConfiguredDoesNothingAtAll() = runBlocking {
        val m = UpdateManager(updateBaseUrl = "", channel = "stable", currentVersion = "1.0.0", cacheDir = cache)
        assertEquals(UpdateState.NotConfigured, m.status.state)
        m.start(); m.checkNow(); m.downloadUpdate()
        assertEquals(UpdateState.NotConfigured, m.status.state)
    }
}

/** The publishing script and the client validator must agree: what update-prepare.mjs writes has to pass validateManifest. */
class PrepareScriptTest {
    @Test fun preparedManifestPassesTheClientValidator() {
        val script = Path.of(System.getProperty("user.dir")).resolve("../scripts/update-prepare.mjs").normalize()
        val nodeOk = runCatching { ProcessBuilder("node", "--version").redirectErrorStream(true).start().also { it.inputStream.readBytes() }.waitFor() == 0 }.getOrDefault(false)
        if (!nodeOk || !Files.exists(script)) { println("skipped: node or the script is not available"); return }

        val dir = Files.createTempDirectory("t2prepare")
        val fake = dir.resolve("T2 Sales-2.3.4.exe").also { Files.write(it, ByteArray(5000) { i -> (i * 13).toByte() }) } // jpackage-style name, with a space
        val out = dir.resolve("out")
        fun run(vararg extra: String): Pair<Int, String> {
            val p = ProcessBuilder(listOf("node", script.toString(), "--channel", "beta", "--installer", fake.toString(), "--out", out.toString(),
                "--notes", "Новое", "--min-supported", "1.0.0", "--mandatory") + extra).redirectErrorStream(true).start()
            val text = p.inputStream.readBytes().toString(Charsets.UTF_8); return p.waitFor() to text
        }
        val (code, text) = run()
        assertEquals(0, code, text)

        val manifestFile = out.resolve("native/beta/manifest.json")
        val m = validateManifest(Json.parseToJsonElement(Files.readString(manifestFile)), "beta", "https://updates.vincere-mortem.ru")
        assertEquals("2.3.4", m.version)
        assertEquals("T2SalesNative-Setup-x64-2.3.4.exe", m.filename, "the published name has no spaces and matches what the client launches")
        assertTrue(SAFE_INSTALLER_FILENAME_RE.matches(m.filename))
        assertTrue(m.mandatory)
        assertEquals(5000L, m.size)
        val staged = out.resolve("native/releases/${m.filename}")
        assertEquals(m.sha256, sha256(Files.readAllBytes(staged)))
        // the beta manifest is refused by a client on the stable channel (channel mismatch)
        assertFailsWith<ManifestValidationError> { validateManifest(Json.parseToJsonElement(Files.readString(manifestFile)), "stable", "https://updates.vincere-mortem.ru") }

        assertTrue(run("--update-base-url", "http://insecure.example.com").first != 0, "an http update server must be refused")
        assertTrue(run("--version", "2.3").first != 0, "a malformed version must be refused")
    }
}

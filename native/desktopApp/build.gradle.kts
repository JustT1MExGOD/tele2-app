import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.jetbrains.compose.desktop.application.dsl.TargetFormat
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlinJvm)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
}

// The native (PC) app is versioned on its own, independently of the web/backend version.
// Single source: this value feeds the installer (packageVersion) and the runtime (app-version.properties -> AppVersion).
val appVersion = "1.2.0"

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(project(":shared"))
    implementation(compose.desktop.currentOs)
    implementation(compose.materialIconsExtended)
    implementation(libs.kotlinx.coroutines.swing)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.jna)
    implementation(libs.jna.platform)

    testImplementation(kotlin("test"))
}

tasks.processResources {
    inputs.property("appVersion", appVersion)
    filesMatching("app-version.properties") { expand(mapOf("appVersion" to appVersion)) }
}

tasks.test {
    useJUnitPlatform()
}

// The Windows installer: ONE .exe = [WPF stub][payload.zip = the jpackage app image][meta][trailer] (see installer/setup/*.cs).
// The stub is compiled with the C# compiler that ships with Windows (no SDK needed); it opens instantly, shows the animated
// wizard in the look of the app's sign-in screen and unpacks the payload with real progress. Per-user, no administrator rights.
// Output: build/installer/T2SalesNative-Setup-x64-<appVersion>.exe - already the exact name the updater launches.
val setupSrc = rootProject.file("installer/setup")
val setupBuild = layout.buildDirectory.dir("setup")

val compileSetupStub = tasks.register<Exec>("compileSetupStub") {
    group = "distribution"
    description = "Compiles the setup stub (WPF, C# 5, csc from the .NET Framework that ships with Windows)"
    val fw = File(System.getenv("windir") ?: "C:/Windows", "Microsoft.NET/Framework64/v4.0.30319")
    val out = setupBuild.map { it.file("stub.exe").asFile }
    inputs.dir(setupSrc)
    outputs.file(out)
    doFirst { out.get().parentFile.mkdirs() }
    val sources = setupSrc.listFiles { f -> f.extension == "cs" }!!.map { it.absolutePath }.sorted()
    commandLine(
        listOf(
            File(fw, "csc.exe").absolutePath, "/nologo", "/target:winexe", "/optimize+", "/warn:4",
            "/out:${out.get().absolutePath}",
            "/win32icon:${File(setupSrc, "icon.ico").absolutePath}",
            "/win32manifest:${File(setupSrc, "app.manifest").absolutePath}",
            "/r:${File(fw, "WPF/PresentationCore.dll").absolutePath}",
            "/r:${File(fw, "WPF/PresentationFramework.dll").absolutePath}",
            "/r:${File(fw, "WPF/WindowsBase.dll").absolutePath}",
            "/r:${File(fw, "System.Xaml.dll").absolutePath}",
            "/r:${File(fw, "System.IO.Compression.dll").absolutePath}",
            "/r:${File(fw, "System.IO.Compression.FileSystem.dll").absolutePath}",
            "/resource:${File(setupSrc, "melon.png").absolutePath},melon.png",
            "/resource:${File(setupSrc, "icon.png").absolutePath},icon.png"
        ) + sources
    )
}

val setupPayloadZip = tasks.register<Zip>("setupPayloadZip") {
    group = "distribution"
    description = "Zips the jpackage app image - the payload the setup unpacks"
    dependsOn("createDistributable")
    from(layout.buildDirectory.dir("compose/binaries/main/app/T2 Sales Native"))
    archiveFileName.set("payload.zip")
    destinationDirectory.set(setupBuild)
    isZip64 = true
    entryCompression = ZipEntryCompression.DEFLATED
}

tasks.register("packageSetup") {
    group = "distribution"
    description = "Builds build/installer/T2SalesNative-Setup-x64-<version>.exe (animated per-user installer)"
    dependsOn(compileSetupStub, setupPayloadZip)
    val stub = setupBuild.map { it.file("stub.exe").asFile }
    val zip = setupBuild.map { it.file("payload.zip").asFile }
    val out = layout.buildDirectory.file("installer/T2SalesNative-Setup-x64-$appVersion.exe")
    val version = appVersion
    inputs.files(stub, zip)
    inputs.property("version", version)
    outputs.file(out)
    doLast {
        val stubBytes = stub.get().readBytes()
        val zipFile = zip.get()
        val meta = listOf("version=$version", "name=T2 Sales Native", "exe=T2 Sales Native.exe").joinToString("\n", postfix = "\n").toByteArray(Charsets.UTF_8)
        val trailer = ByteBuffer.allocate(32).order(ByteOrder.LITTLE_ENDIAN)
            .put("T2SETUP1".toByteArray(Charsets.US_ASCII))
            .putLong(stubBytes.size.toLong()).putLong(zipFile.length()).putLong(meta.size.toLong())
            .array()
        val target = out.get().asFile
        target.parentFile.mkdirs()
        target.outputStream().buffered(1 shl 20).use { o ->
            o.write(stubBytes)
            zipFile.inputStream().use { it.copyTo(o) }
            o.write(meta)
            o.write(trailer)
        }
        println("Installer: ${target.absolutePath} (${target.length() / (1024 * 1024)} MiB)")
    }
}

compose.desktop {
    application {
        mainClass = "ru.t2sales.desktop.MainKt"

        nativeDistributions {
            targetFormats(TargetFormat.Msi, TargetFormat.Exe)
            // Own name (=> own install folder, shortcuts and Add/Remove entry): the Electron desktop app is installed as "T2 Sales" in
            // "C:\Program Files\T2 Sales", and two products sharing that folder corrupt each other. Window title stays "T2 Sales".
            packageName = "T2 Sales Native"
            vendor = "T2 Sales"
            description = "T2 Sales desktop app"
            // The installed app runs on a trimmed JVM: only these modules exist there (a `gradle run` uses the full JDK and hides missing ones).
            // java.net.http = updates + relay diagnostics; java.naming = OkHttp's TLS host-name check; jdk.unsupported = coroutines/okio internals.
            modules("java.net.http", "java.naming", "jdk.unsupported", "java.management")
            packageVersion = appVersion

            windows {
                // the T2 logo: icon of the .exe / installer and of the Start-menu + desktop shortcuts
                iconFile.set(project.file("icons/icon.ico"))
                shortcut = true          // desktop shortcut
                menu = true              // Start menu entry
                menuGroup = "T2 Sales"
                // Per-machine install (Program Files, UAC prompt): a per-user MSI failed on Windows with error 2503/2502
                // ("Called RunScript when not marked in progress", access denied to C:\Windows\Installer\inprogressinstallinfo.ipi).
                perUserInstall = false
                dirChooser = true
                // fixed id: lets a newer installer upgrade an installed copy in place instead of installing next to it
                upgradeUuid = "6f3c1c8e-5b1a-4d0e-9b7a-2f4a7c1d9e10"
            }
        }
    }
}

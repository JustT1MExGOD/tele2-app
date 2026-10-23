import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.jetbrains.compose.desktop.application.dsl.TargetFormat
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlinJvm)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
}

// T2 Miranda is versioned independently of T2 Sales Native and of the backend/web version.
val appVersion = "1.0.0"

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

compose.desktop {
    application {
        mainClass = "ru.t2sales.miranda.MainKt"

        nativeDistributions {
            targetFormats(TargetFormat.Msi, TargetFormat.Exe)
            // Own identity (=> own install folder, shortcuts, Add/Remove entry), distinct from both
            // "T2 Sales" (Electron, C:\Program Files\T2 Sales) and "T2 Sales Native" (desktopApp) —
            // see native/desktopApp/build.gradle.kts's own warning about two products sharing a folder.
            packageName = "T2 Miranda"
            vendor = "T2 Sales"
            description = "T2 Miranda — corporate messenger"
            modules("java.net.http", "java.naming", "jdk.unsupported", "java.management")
            packageVersion = appVersion

            windows {
                iconFile.set(project.file("icons/icon.ico"))
                shortcut = true
                menu = true
                menuGroup = "T2 Miranda"
                perUserInstall = false
                dirChooser = true
                // Own fixed id (distinct from desktopApp's 6f3c1c8e-...), so a newer Miranda installer
                // upgrades Miranda in place without touching the unrelated T2 Sales Native install.
                upgradeUuid = "a1e4f2d6-7c9b-4e3a-8f1d-5b6c0a2e9d44"
            }
        }
    }
}

// The Windows installer for T2 Miranda: ONE .exe = [WPF stub][payload.zip = the jpackage app image][meta][trailer].
// Same pattern as T2 Sales Native's :desktopApp:packageSetup, same C# 5 WPF stub compiled by the Windows-shipped csc,
// same layout: opens instantly, animated wizard, real progress. Own product identity (T2 Miranda, own registry keys,
// own process name) — see installer-miranda/setup/*.cs.
val mirandaSetupSrc = rootProject.file("installer-miranda/setup")
val mirandaSetupBuild = layout.buildDirectory.dir("setup")

val compileMirandaSetupStub = tasks.register<Exec>("compileMirandaSetupStub") {
    group = "distribution"
    description = "Compiles the Miranda setup stub (WPF, C# 5, csc from the .NET Framework that ships with Windows)"
    val fw = File(System.getenv("windir") ?: "C:/Windows", "Microsoft.NET/Framework64/v4.0.30319")
    val out = mirandaSetupBuild.map { it.file("stub.exe").asFile }
    inputs.dir(mirandaSetupSrc)
    outputs.file(out)
    doFirst { out.get().parentFile.mkdirs() }
    val sources = mirandaSetupSrc.listFiles { f -> f.extension == "cs" }!!.map { it.absolutePath }.sorted()
    commandLine(
        listOf(
            File(fw, "csc.exe").absolutePath, "/nologo", "/target:winexe", "/optimize+", "/warn:4",
            "/out:${out.get().absolutePath}",
            "/win32icon:${File(mirandaSetupSrc, "icon.ico").absolutePath}",
            "/win32manifest:${File(mirandaSetupSrc, "app.manifest").absolutePath}",
            "/r:${File(fw, "WPF/PresentationCore.dll").absolutePath}",
            "/r:${File(fw, "WPF/PresentationFramework.dll").absolutePath}",
            "/r:${File(fw, "WPF/WindowsBase.dll").absolutePath}",
            "/r:${File(fw, "System.Xaml.dll").absolutePath}",
            "/r:${File(fw, "System.IO.Compression.dll").absolutePath}",
            "/r:${File(fw, "System.IO.Compression.FileSystem.dll").absolutePath}",
            "/resource:${File(mirandaSetupSrc, "melon.png").absolutePath},melon.png",
            "/resource:${File(mirandaSetupSrc, "icon.png").absolutePath},icon.png"
        ) + sources
    )
}

val mirandaPayloadZip = tasks.register<Zip>("mirandaPayloadZip") {
    group = "distribution"
    description = "Zips the jpackage app image - the payload the setup unpacks"
    dependsOn("createDistributable")
    from(layout.buildDirectory.dir("compose/binaries/main/app/T2 Miranda"))
    archiveFileName.set("payload.zip")
    destinationDirectory.set(mirandaSetupBuild)
    isZip64 = true
    entryCompression = ZipEntryCompression.DEFLATED
}

tasks.register("packageSetup") {
    group = "distribution"
    description = "Builds build/installer/T2Miranda-Setup-x64-<version>.exe (animated per-user installer)"
    dependsOn(compileMirandaSetupStub, mirandaPayloadZip)
    val stub = mirandaSetupBuild.map { it.file("stub.exe").asFile }
    val zip = mirandaSetupBuild.map { it.file("payload.zip").asFile }
    val out = layout.buildDirectory.file("installer/T2Miranda-Setup-x64-$appVersion.exe")
    val version = appVersion
    inputs.files(stub, zip)
    inputs.property("version", version)
    outputs.file(out)
    doLast {
        val stubBytes = stub.get().readBytes()
        val zipFile = zip.get()
        val meta = listOf("version=$version", "name=T2 Miranda", "exe=T2 Miranda.exe").joinToString("\n", postfix = "\n").toByteArray(Charsets.UTF_8)
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

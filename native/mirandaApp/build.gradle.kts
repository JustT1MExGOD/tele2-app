import org.jetbrains.compose.desktop.application.dsl.TargetFormat
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlinJvm)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
}

// T2 Miranda is versioned independently of T2 Sales Native and of the backend/web version.
val appVersion = "0.1.0"

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

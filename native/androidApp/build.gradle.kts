import java.util.Properties

plugins {
    alias(libs.plugins.androidApplication)
    alias(libs.plugins.kotlinAndroid)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
}

// The native Android client. It shares the network layer, models, sign-in and theme with the PC client (:shared) and has its own
// phone UI (bottom navigation, touch), ported block by block from the web app's mobile layout.
// applicationId and signing key are the same as the Capacitor app's, so RuStore accepts it as an update of that app;
// versionCode continues from there (the Capacitor app is at 2).
// The release is signed with the same keystore as the Capacitor app (android/android/keystore.properties, gitignored). Without the file the
// release build is unsigned and the build does not fail.
val keystoreFile = rootProject.file("../android/android/keystore.properties")
val keystoreProps = Properties().apply { if (keystoreFile.exists()) keystoreFile.inputStream().use { load(it) } }

android {
    namespace = "ru.t2sales.android"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.t2sales.android"
        minSdk = 24
        targetSdk = 35
        versionCode = 10
        versionName = "2.0.0"
    }
    signingConfigs {
        create("release") {
            if (keystoreFile.exists()) {
                storeFile = keystoreFile.parentFile.resolve(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        debug { applicationIdSuffix = ".native" } // side by side with the installed Capacitor app while both exist
        release {
            // R8: unused code and resources (most of the icon set, unused Ktor engines) are removed, the rest is optimised: smaller and faster
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = if (keystoreFile.exists()) signingConfigs.getByName("release") else null
        }
        // the release optimisations under its own id and the debug key: to measure speed on a phone that has the store app installed
        create("perf") {
            initWith(getByName("release"))
            applicationIdSuffix = ".perf"
            signingConfig = signingConfigs.getByName("debug")
            matchingFallbacks += "release"
        }
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        isCoreLibraryDesugaringEnabled = true // java.time on Android 7 (minSdk 24)
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.3")
    implementation(project(":shared"))
    implementation(compose.foundation)
    implementation(compose.material)
    implementation(compose.materialIconsExtended)
    implementation(libs.androidx.activity.compose)
    implementation(libs.ktor.client.okhttp)
    implementation("com.caverock:androidsvg-aar:1.4") // the report pictures are SVG
}

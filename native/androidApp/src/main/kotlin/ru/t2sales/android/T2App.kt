package ru.t2sales.android

import android.app.Application
import ru.t2sales.shared.auth.AndroidPlatform

class T2App : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        AndroidPlatform.init(this)
        container = AppContainer()
    }
}

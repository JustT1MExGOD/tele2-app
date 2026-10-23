package ru.t2sales.miranda.di

import io.ktor.client.engine.okhttp.OkHttp
import ru.t2sales.shared.api.AdminCenterApi
import ru.t2sales.shared.api.AuthApi
import ru.t2sales.shared.api.FileCookiesStorage
import ru.t2sales.shared.api.MirandaApi
import ru.t2sales.shared.api.createHttpClient
import ru.t2sales.shared.auth.AuthRepository
import ru.t2sales.shared.auth.MirandaDeviceSecretStore
import ru.t2sales.miranda.session.PointSessionStore

/**
 * Manual DI, same approach as desktopApp's AppContainer — no Hilt/Koin for
 * a small app. Deliberately simpler than desktopApp's container: no
 * DIRECT/RELAY network switching, no in-app updater, no offline outbox —
 * Miranda is a thin messenger client, those concerns are out of scope for
 * this first cut (flagged to the user, not silently dropped).
 */
class MirandaContainer {
    // Отдельный файл кук от T2 Sales (desktopApp) — оба приложения делят
    // один platformConfigDir(), общий cookies.json приводил к тому, что
    // T2 Sales затирал t2_point_session куку Miranda при любой своей
    // записи (разные процессы, каждый со своим in-memory снимком и
    // last-writer-wins перезаписью всего файла) — аккаунт точки
    // "вылетал" при каждом входе в T2 Sales на той же машине.
    private val httpClient = createHttpClient(FileCookiesStorage(fileName = "miranda-cookies.json"), OkHttp.create())

    val authApi = AuthApi(httpClient)
    val adminCenterApi = AdminCenterApi(httpClient) // only used for issueStepUp() on device approval
    val mirandaApi = MirandaApi(httpClient)
    val authRepository = AuthRepository(authApi)
    val deviceSecretStore = MirandaDeviceSecretStore()
    val pointSessionStore = PointSessionStore()
}

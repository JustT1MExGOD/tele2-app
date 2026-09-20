package ru.t2sales.desktop.di

import io.ktor.client.engine.okhttp.OkHttp
import ru.t2sales.desktop.network.NetworkConfig
import ru.t2sales.desktop.update.UpdateManager
import ru.t2sales.desktop.network.NetworkManager
import ru.t2sales.desktop.network.RelayInterceptor
import ru.t2sales.shared.api.AdminApi
import ru.t2sales.shared.api.AlertsApi
import ru.t2sales.shared.api.AnalyticsApi
import ru.t2sales.shared.api.InfoApi
import ru.t2sales.shared.api.AdminCenterApi
import ru.t2sales.shared.api.AuthApi
import ru.t2sales.shared.api.CashApi
import ru.t2sales.shared.api.ChatApi
import ru.t2sales.shared.api.CommandCenterApi
import ru.t2sales.shared.api.FileCookiesStorage
import ru.t2sales.shared.api.HomeApi
import ru.t2sales.shared.api.PlansApi
import ru.t2sales.shared.api.ProfileApi
import ru.t2sales.shared.api.ReportsApi
import ru.t2sales.shared.api.SalesApi
import ru.t2sales.shared.api.ScheduleApi
import ru.t2sales.shared.api.SupervisorApi
import ru.t2sales.shared.api.TasksApi
import ru.t2sales.shared.api.TeamApi
import ru.t2sales.shared.api.createHttpClient
import ru.t2sales.shared.auth.AuthRepository

/**
 * Manual dependency wiring — a Hilt/Koin-scale DI framework isn't justified
 * for a desktop-only, one-screen milestone.
 */
class AppContainer {
    /** DIRECT / RELAY network layer (port of the Electron network manager); the interceptor reads its live state. */
    val network = NetworkManager()

    /** In-app updates (port of the Electron updater): checks the update server, downloads and verifies, installs only on a click. */
    val updates = UpdateManager().also { ru.t2sales.desktop.update.UpdaterLog.file = ru.t2sales.desktop.update.UpdateConfig.logFile }
    private val httpClient = createHttpClient(
        FileCookiesStorage(),
        OkHttp.create { addInterceptor(RelayInterceptor(network, NetworkConfig.canonicalOrigin, NetworkConfig.relayUrl)) }
    )

    val authApi = AuthApi(httpClient)
    val reportsApi = ReportsApi(httpClient)
    val homeApi = HomeApi(httpClient)
    val tasksApi = TasksApi(httpClient)
    val scheduleApi = ScheduleApi(httpClient)
    val teamApi = TeamApi(httpClient)
    val salesApi = SalesApi(httpClient)
    val profileApi = ProfileApi(httpClient)
    val commandCenterApi = CommandCenterApi(httpClient)
    val cashApi = CashApi(httpClient)
    val chatApi = ChatApi(httpClient)
    val supervisorApi = SupervisorApi(httpClient)
    val adminApi = AdminApi(httpClient)
    val analyticsApi = AnalyticsApi(httpClient)
    val alertsApi = AlertsApi(httpClient)
    val infoApi = InfoApi(httpClient)
    val plansApi = PlansApi(httpClient)
    val adminCenterApi = AdminCenterApi(httpClient)
    val authRepository = AuthRepository(authApi)
}

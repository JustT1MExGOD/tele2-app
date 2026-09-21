package ru.t2sales.android

import io.ktor.client.engine.okhttp.OkHttp
import ru.t2sales.shared.api.AuthApi
import ru.t2sales.shared.api.TasksApi
import ru.t2sales.shared.api.SupervisorApi
import ru.t2sales.shared.api.InfoApi
import ru.t2sales.shared.api.CommandCenterApi
import ru.t2sales.shared.api.CashApi
import ru.t2sales.shared.api.AnalyticsApi
import ru.t2sales.shared.api.AlertsApi
import ru.t2sales.shared.api.AdminCenterApi
import ru.t2sales.shared.api.AdminApi
import ru.t2sales.shared.api.ChatApi
import ru.t2sales.shared.api.FileCookiesStorage
import ru.t2sales.shared.api.HomeApi
import ru.t2sales.shared.api.PlansApi
import ru.t2sales.shared.api.ProfileApi
import ru.t2sales.shared.api.ReportsApi
import ru.t2sales.shared.api.SalesApi
import ru.t2sales.shared.api.ScheduleApi
import ru.t2sales.shared.api.TeamApi
import ru.t2sales.shared.api.createHttpClient
import ru.t2sales.shared.auth.AuthRepository

/** Manual wiring, like the PC client's AppContainer: one HTTP client (cookies in the Keystore-encrypted file), one API class per area. */
class AppContainer {
    private val httpClient = createHttpClient(FileCookiesStorage(), OkHttp.create {
        // the app names itself: the server lists it in "Активные сессии" as an app on this phone, not as an unknown browser
        addInterceptor { chain ->
            chain.proceed(chain.request().newBuilder().header("User-Agent", "T2Sales/${BuildConfig.VERSION_NAME} (Linux; Android ${android.os.Build.VERSION.RELEASE}; ${android.os.Build.MODEL}) Mobile").build())
        }
    })

    val authApi = AuthApi(httpClient)
    val homeApi = HomeApi(httpClient)
    val reportsApi = ReportsApi(httpClient)
    val profileApi = ProfileApi(httpClient)
    val salesApi = SalesApi(httpClient)
    val plansApi = PlansApi(httpClient)
    val chatApi = ChatApi(httpClient)
    val tasksApi = TasksApi(httpClient)
    val supervisorApi = SupervisorApi(httpClient)
    val infoApi = InfoApi(httpClient)
    val commandCenterApi = CommandCenterApi(httpClient)
    val cashApi = CashApi(httpClient)
    val analyticsApi = AnalyticsApi(httpClient)
    val alertsApi = AlertsApi(httpClient)
    val adminCenterApi = AdminCenterApi(httpClient)
    val adminApi = AdminApi(httpClient)
    val teamApi = TeamApi(httpClient)
    val scheduleApi = ScheduleApi(httpClient)
    val authRepository = AuthRepository(authApi)
    /** Sales entered without a connection wait here (on disk) and are sent when the server answers again. */
    val outbox = ru.t2sales.android.offline.SalesOutbox(
        file = java.io.File(ru.t2sales.shared.auth.platformConfigDir(), "pending-sales.json"),
        owner = { ru.t2sales.android.ui.AppNav.myEmployeeId },
        send = { salesApi.createSale(it) }
    ).also { it.start() }
    val readCache = ru.t2sales.android.offline.ReadCache(java.io.File(ru.t2sales.shared.auth.platformConfigDir(), "cache")) { ru.t2sales.android.ui.AppNav.myEmployeeId }
}

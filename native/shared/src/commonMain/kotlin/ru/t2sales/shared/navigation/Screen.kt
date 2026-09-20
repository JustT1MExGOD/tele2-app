package ru.t2sales.shared.navigation

/**
 * Sealed set of app destinations, kept in :shared so a future Android app
 * can reuse the same navigation model. Adding a new destination is purely
 * additive.
 */
sealed class Screen(val label: String) {
    data object Login : Screen("Вход")
    data object Home : Screen("Главная")
    data object Reports : Screen("Отчёты")
    data object Tasks : Screen("Задачи")
    data object Schedule : Screen("График")
    data object Team : Screen("Команда")
    data object Profile : Screen("Профиль")
    data object CommandCenter : Screen("Command Center")
    data object Cash : Screen("Касса")
    data object Chat : Screen("Чат")
    data object Orgs : Screen("Сети")
    data object Audit : Screen("История действий")
    data object Dealers : Screen("Дилеры/Секторы")
    data object StoreProfile : Screen("Профиль точки")
    data object PlanDay : Screen("План дня")
    data object ReportImg : Screen("Отчёт-картинка")
    data object Live : Screen("Сеть live")
    data object Heatmap : Screen("Heatmap часов")
    data object Forecast : Screen("Прогноз и what-if")
    data object Alerts : Screen("Алерты")
    data object Announce : Screen("Объявления")
    data object Support : Screen("Поддержка")
    data object MonthPlan : Screen("Планы и факт за месяц")
    data object NetMonth : Screen("Динамика выполнения")
    data object History : Screen("История продаж")
    data object Bfq : Screen("BFQ")
    data object AdminCenter : Screen("Admin Center")
    data object SvOverview : Screen("Обзор")
    data object SvStores : Screen("Точки")
    data object SvPeople : Screen("Люди")
    data object SvTrend : Screen("Тренд")
    data object Replay : Screen("Повтор месяца")
}

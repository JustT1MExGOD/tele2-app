package ru.t2sales.miranda.system

/**
 * §F плана — всплывающие уведомления о новых сообщениях (нативный тост
 * ОС через Tray, см. Main.kt). Тот же минимальный паттерн, что
 * desktopApp/system/System.kt::AppWindow/AppNotifier, без трея-скрытия
 * окна (Miranda всегда видна, в отличие от T2 Sales) — нужен только
 * "смотрит ли пользователь на окно прямо сейчас".
 */
object MirandaAppWindow {
    @Volatile var awt: java.awt.Window? = null
    val isFocused: Boolean get() = awt?.isActive == true
}

/** Отправка системного (Windows) уведомления через иконку в трее —
 * выставляется один раз в Main.kt; до этого момента no-op. */
object MirandaNotifier {
    @Volatile var send: (title: String, text: String) -> Unit = { _, _ -> }

    /** Уведомляем, только если пользователь сейчас НЕ смотрит на это же
     * окно/диалог — вызывающая сторона (Main.kt) уже решила это для
     * конкретного входящего сообщения (окно не в фокусе ИЛИ открыт
     * другой/никакой диалог). */
    fun notify(title: String, text: String) {
        send(title, text)
    }
}

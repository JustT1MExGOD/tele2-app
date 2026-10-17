package ru.t2sales.miranda.settings

import java.util.prefs.Preferences

/** Чисто клиентские UI-предпочтения отображения дерева контактов, не синхронизируются с backend. */
object MirandaSettingsStore {
    private val prefs = Preferences.userRoot().node("ru/t2sales/miranda")

    /** "store" (по точке, легаси-поведение) | "custom" (личные группы). */
    var groupByMode: String
        get() = prefs.get("groupByMode", "store")
        set(v) = prefs.put("groupByMode", v)

    var showOfflineContacts: Boolean
        get() = prefs.getBoolean("showOfflineContacts", true)
        set(v) = prefs.putBoolean("showOfflineContacts", v)

    var sortOnlineFirst: Boolean
        get() = prefs.getBoolean("sortOnlineFirst", true)
        set(v) = prefs.putBoolean("sortOnlineFirst", v)
}

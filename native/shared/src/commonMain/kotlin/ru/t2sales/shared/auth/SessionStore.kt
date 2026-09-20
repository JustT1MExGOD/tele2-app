package ru.t2sales.shared.auth

/**
 * Where the persistent cookie-jar file lives. A native app has no browser-
 * style cookie store, so Ktor's HttpCookies plugin is backed by a file at
 * this path (see HttpClient.kt) — platformConfigDir() is an expect/actual
 * seam so a future Android target can supply its own storage location
 * without touching any shared networking logic.
 */
expect fun platformConfigDir(): String

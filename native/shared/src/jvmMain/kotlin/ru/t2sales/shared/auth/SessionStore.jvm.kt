package ru.t2sales.shared.auth

actual fun platformConfigDir(): String {
    val home = System.getProperty("user.home")
    return "$home/.t2sales"
}

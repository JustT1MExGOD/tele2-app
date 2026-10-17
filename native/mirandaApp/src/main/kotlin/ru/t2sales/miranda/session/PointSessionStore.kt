package ru.t2sales.miranda.session

import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import ru.t2sales.shared.auth.platformConfigDir

/**
 * Persists which point account (Этап B) was last logged in, so cold start
 * can skip straight to the messenger instead of always showing the login
 * screen. Not a secret store (no DPAPI) - the actual trust anchor is the
 * t2_point_session cookie in FileCookiesStorage; this file is only a label
 * for it and is re-verified against the server on every cold start (see
 * MirandaRoot in Main.kt), so tampering with it at most gets you a 401.
 */
class PointSessionStore {
    private val file = File(platformConfigDir()).apply { mkdirs() }.resolve("miranda-point-session.txt")

    fun load(): PointSessionInfo? {
        if (!file.exists()) return null
        return runCatching {
            val lines = file.readText().split("\n", limit = 2)
            val id = lines.getOrNull(0)?.toIntOrNull() ?: return null
            val name = lines.getOrNull(1) ?: ""
            PointSessionInfo(id, name)
        }.getOrNull()
    }

    fun save(info: PointSessionInfo) {
        val tmp = File(file.path + ".tmp")
        tmp.writeText("${info.corporateAccountId}\n${info.accountName}")
        Files.move(tmp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING)
    }

    fun clear() {
        file.delete()
    }
}

data class PointSessionInfo(val corporateAccountId: Int, val accountName: String)

package ru.t2sales.shared.auth

import ru.t2sales.shared.api.AuthApi
import ru.t2sales.shared.api.MeResponse

sealed class LoginResult {
    data class LoggedIn(val me: MeResponse) : LoginResult()
    data class MfaRequired(val mfaToken: String, val methods: List<String>) : LoginResult()
}

/**
 * Orchestrates login/mfa-login/me exactly as the web app's auth flow does:
 * a successful POST /auth/login either sets session cookies directly, or
 * (mfa_required branch) sets none yet and requires POST /auth/mfa/login
 * first. Either way, GET /me is the definitive "am I actually logged in"
 * check — a persisted cookie file existing is not proof by itself.
 */
class AuthRepository(private val authApi: AuthApi) {

    suspend fun login(phone: String, password: String): LoginResult {
        val response = authApi.login(phone, password)
        if (response.mfa_required == true) {
            return LoginResult.MfaRequired(
                mfaToken = response.mfa_token.orEmpty(),
                methods = response.mfa_methods ?: emptyList()
            )
        }
        return LoginResult.LoggedIn(authApi.me())
    }

    suspend fun submitMfaCode(mfaToken: String, method: String, code: String): LoginResult {
        authApi.loginMfa(mfaToken, method, code)
        return LoginResult.LoggedIn(authApi.me())
    }

    /** Cold-start check: are there persisted cookies that still resolve to
     * a live session? Never trust "a cookie file exists" alone. */
    suspend fun currentSession(): MeResponse? = runCatching { authApi.me() }.getOrNull()
        ?.takeIf { it.bound }
}

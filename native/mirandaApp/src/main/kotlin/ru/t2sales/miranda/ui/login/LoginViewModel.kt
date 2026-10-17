package ru.t2sales.miranda.ui.login

import ru.t2sales.shared.api.ApiException
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.api.MirandaApi
import ru.t2sales.shared.auth.AuthRepository
import ru.t2sales.shared.auth.LoginResult

sealed class LoginUiState {
    data object PhonePassword : LoginUiState()
    data class MfaCode(val mfaToken: String, val methods: List<String>) : LoginUiState()
    data class Error(val message: String, val previous: LoginUiState) : LoginUiState()
}

/** Личный аккаунт (сотрудник, /auth/login) или аккаунт точки (Этап B, /miranda/accounts/login). */
enum class LoginMode { EMPLOYEE, POINT }

sealed class LoginOutcome {
    data class LoggedIn(val me: MeResponse) : LoginOutcome()
    data class PointLoggedIn(val corporateAccountId: Int, val accountName: String) : LoginOutcome()
    data class NextState(val state: LoginUiState) : LoginOutcome()
}

class LoginViewModel(private val authRepository: AuthRepository, private val mirandaApi: MirandaApi) {

    suspend fun submitPhonePassword(phone: String, password: String): LoginOutcome =
        try {
            when (val result = authRepository.login(phone, password)) {
                is LoginResult.LoggedIn -> LoginOutcome.LoggedIn(result.me)
                is LoginResult.MfaRequired -> LoginOutcome.NextState(LoginUiState.MfaCode(result.mfaToken, result.methods))
            }
        } catch (e: ApiException) {
            LoginOutcome.NextState(LoginUiState.Error(e.message, LoginUiState.PhonePassword))
        }

    suspend fun submitPointLogin(phone: String, password: String): LoginOutcome =
        try {
            val result = mirandaApi.pointLogin(phone, password)
            LoginOutcome.PointLoggedIn(result.corporateAccountId, result.accountName ?: "")
        } catch (e: ApiException) {
            LoginOutcome.NextState(LoginUiState.Error(e.message, LoginUiState.PhonePassword))
        }

    suspend fun submitMfaCode(mfaToken: String, method: String, code: String): LoginOutcome =
        try {
            val result = authRepository.submitMfaCode(mfaToken, method, code) as LoginResult.LoggedIn
            LoginOutcome.LoggedIn(result.me)
        } catch (e: ApiException) {
            LoginOutcome.NextState(LoginUiState.Error(e.message, LoginUiState.MfaCode(mfaToken, listOf(method))))
        }
}

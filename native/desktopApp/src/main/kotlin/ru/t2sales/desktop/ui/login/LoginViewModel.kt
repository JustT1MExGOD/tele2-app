package ru.t2sales.desktop.ui.login

import ru.t2sales.shared.api.ApiException
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.auth.AuthRepository
import ru.t2sales.shared.auth.LoginResult

sealed class LoginUiState {
    data object PhonePassword : LoginUiState()
    data class MfaCode(val mfaToken: String, val methods: List<String>) : LoginUiState()
    data class Error(val message: String, val previous: LoginUiState) : LoginUiState()
}

sealed class LoginOutcome {
    data class LoggedIn(val me: MeResponse) : LoginOutcome()
    data class NextState(val state: LoginUiState) : LoginOutcome()
}

class LoginViewModel(private val authRepository: AuthRepository) {

    suspend fun submitPhonePassword(phone: String, password: String): LoginOutcome =
        try {
            when (val result = authRepository.login(phone, password)) {
                is LoginResult.LoggedIn -> LoginOutcome.LoggedIn(result.me)
                is LoginResult.MfaRequired -> LoginOutcome.NextState(LoginUiState.MfaCode(result.mfaToken, result.methods))
            }
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

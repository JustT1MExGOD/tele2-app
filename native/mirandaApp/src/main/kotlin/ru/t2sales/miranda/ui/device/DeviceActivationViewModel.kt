package ru.t2sales.miranda.ui.device

import ru.t2sales.shared.api.ApiException
import ru.t2sales.shared.api.MirandaApi
import ru.t2sales.shared.api.MirandaAvailableAccountRow
import ru.t2sales.shared.api.MirandaRegisterDeviceRequest
import ru.t2sales.shared.auth.MirandaDeviceSecretStore

sealed class DeviceState {
    data object Checking : DeviceState()
    data object Pending : DeviceState()
    data class Active(val corporateAccountId: Int, val displayLabel: String?) : DeviceState()
    data class Error(val message: String) : DeviceState()
}

/**
 * §3.3/§3.4 of the plan: every start re-resolves the binding from the
 * server, never trusts a local cached "already active" flag. A device
 * secret existing on disk only means "ask the server again" - the server
 * decides active/pending/unknown_device fresh, every time.
 */
class DeviceActivationViewModel(
    private val api: MirandaApi,
    private val secretStore: MirandaDeviceSecretStore
) {
    suspend fun checkOrRegister(): DeviceState {
        val existing = secretStore.load()
        if (existing == null) return registerFresh()
        return try {
            val res = api.activateDevice(existing)
            when (res.status) {
                "active" -> DeviceState.Active(res.corporateAccountId!!, res.displayLabel)
                "pending" -> DeviceState.Pending
                else -> registerFresh() // unknown_device (revoked/other machine) -> re-register
            }
        } catch (e: ApiException) {
            DeviceState.Error(e.message)
        }
    }

    private suspend fun registerFresh(): DeviceState = try {
        val reg = api.registerDevice(MirandaRegisterDeviceRequest(platform = "windows"))
        secretStore.save(reg.deviceSecret)
        if (reg.status == "active") {
            // immediately re-activate to learn the corporateAccountId/displayLabel
            val activated = api.activateDevice(reg.deviceSecret)
            if (activated.status == "active") DeviceState.Active(activated.corporateAccountId!!, activated.displayLabel) else DeviceState.Pending
        } else {
            DeviceState.Pending
        }
    } catch (e: ApiException) {
        DeviceState.Error(e.message)
    }

    suspend fun listAvailableAccountsForSwitch(): List<MirandaAvailableAccountRow> =
        try { api.listAvailableAccounts(secretStore.load()).items } catch (e: ApiException) { emptyList() }

    suspend fun switchTo(corporateAccountId: Int): Boolean =
        try { api.switchAccount(corporateAccountId); true } catch (e: ApiException) { false }
}

package ru.t2sales.shared.api

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.client.request.forms.formData
import io.ktor.client.request.forms.submitFormWithBinaryData
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.websocket.readText
import kotlinx.serialization.json.JsonObject

/**
 * REST + WS client for the /miranda routes — device registration/activation,
 * admin device-approval queue and account-switch grants, and the conversations/
 * messages/attachments messenger. Mirrors backend/src/api/routes/miranda.
 */
class MirandaApi(private val client: HttpClient) {

    // --- devices / activation (any logged-in employee) ---

    suspend fun registerDevice(req: MirandaRegisterDeviceRequest): MirandaRegisterDeviceResponse =
        client.post(apiUrl("/miranda/devices/register")) {
            contentType(ContentType.Application.Json)
            setBody(req)
        }.body()

    suspend fun activateDevice(deviceSecret: String): MirandaActivateDeviceResponse =
        client.post(apiUrl("/miranda/devices/activate")) {
            contentType(ContentType.Application.Json)
            setBody(MirandaActivateDeviceRequest(deviceSecret))
        }.body()

    // --- admin: device approval queue ---

    suspend fun listPendingDevices(): MirandaPendingBindingsListResponse =
        client.get(apiUrl("/miranda/devices")).body()

    suspend fun approveDevice(bindingId: Int, stepUpToken: String) {
        client.post(apiUrl("/miranda/devices/$bindingId/approve")) {
            header("X-Step-Up-Token", stepUpToken)
            contentType(ContentType.Application.Json)
            setBody(JsonObject(emptyMap()))
        }
    }

    suspend fun revokeDevice(bindingId: Int) {
        client.post(apiUrl("/miranda/devices/$bindingId/revoke")) {
            contentType(ContentType.Application.Json)
            setBody(JsonObject(emptyMap()))
        }
    }

    // --- admin: account-switch grants ---

    suspend fun listAllCorporateAccounts(): MirandaCorporateAccountsListResponse =
        client.get(apiUrl("/miranda/accounts")).body()

    suspend fun createAccount(employeeId: Int, storeId: String?, displayLabel: String?): MirandaCreateAccountResponse =
        client.post(apiUrl("/miranda/accounts")) {
            contentType(ContentType.Application.Json)
            setBody(MirandaCreateAccountRequest(employeeId, storeId, displayLabel))
        }.body()

    suspend fun listAvailableAccounts(deviceSecret: String? = null): MirandaAvailableAccountsResponse =
        client.get(apiUrl("/miranda/accounts/available" + (deviceSecret?.let { "?deviceSecret=$it" } ?: ""))).body()

    suspend fun switchAccount(corporateAccountId: Int) {
        client.post(apiUrl("/miranda/session/switch")) {
            contentType(ContentType.Application.Json)
            setBody(MirandaSwitchAccountRequest(corporateAccountId))
        }
    }

    suspend fun grantAdminAccount(adminEmployeeId: Int, corporateAccountId: Int) {
        client.post(apiUrl("/miranda/admin-grants")) {
            contentType(ContentType.Application.Json)
            setBody(MirandaGrantAccountRequest(adminEmployeeId, corporateAccountId))
        }
    }

    /** Точка/касса → true (ровно одно одновременно активное устройство,
     * enforced на approve). Личный аккаунт → false (несколько устройств разрешены). */
    suspend fun setAccountDeviceExclusive(corporateAccountId: Int, deviceExclusive: Boolean) {
        client.patch(apiUrl("/miranda/accounts/$corporateAccountId/device-exclusive")) {
            contentType(ContentType.Application.Json)
            setBody(MirandaSetDeviceExclusiveRequest(deviceExclusive))
        }
    }

    // --- contacts (regular user; not admin-gated) ---

    suspend fun searchContacts(q: String): MirandaContactsResponse =
        client.get(apiUrl("/miranda/contacts?q=" + java.net.URLEncoder.encode(q, "UTF-8"))).body()

    // --- conversations / messages ---

    suspend fun listConversations(): MirandaConversationsListResponse =
        client.get(apiUrl("/miranda/conversations")).body()

    suspend fun createDirect(targetCorporateAccountId: Int): MirandaConversationIdResponse =
        client.post(apiUrl("/miranda/conversations/direct")) {
            contentType(ContentType.Application.Json)
            setBody(MirandaCreateDirectRequest(targetCorporateAccountId))
        }.body()

    suspend fun createGroup(title: String, memberCorporateAccountIds: List<Int>): MirandaConversationIdResponse =
        client.post(apiUrl("/miranda/conversations/group")) {
            contentType(ContentType.Application.Json)
            setBody(MirandaCreateGroupRequest(title, memberCorporateAccountIds))
        }.body()

    suspend fun getMembers(conversationId: Int): MirandaConversationMembersResponse =
        client.get(apiUrl("/miranda/conversations/$conversationId/members")).body()

    suspend fun markRead(conversationId: Int, messageId: String) {
        client.post(apiUrl("/miranda/conversations/$conversationId/read")) {
            contentType(ContentType.Application.Json)
            setBody(MirandaMarkReadRequest(messageId))
        }
    }

    suspend fun getMessages(conversationId: Int, cursor: String? = null, limit: Int = 50): MirandaMessagesPageResponse =
        client.get(apiUrl("/miranda/conversations/$conversationId/messages?limit=$limit" + (cursor?.let { "&cursor=$it" } ?: ""))).body()

    suspend fun getMessagesAfter(conversationId: Int, afterId: String, limit: Int = 50): MirandaMessagesPageResponse =
        client.get(apiUrl("/miranda/conversations/$conversationId/messages?after=$afterId&limit=$limit")).body()

    suspend fun postMessage(conversationId: Int, req: MirandaPostMessageRequest): MirandaMessage =
        client.post(apiUrl("/miranda/conversations/$conversationId/messages")) {
            contentType(ContentType.Application.Json)
            setBody(req)
        }.body()

    // --- attachments ---

    suspend fun uploadAttachment(name: String, mime: String, bytes: ByteArray): MirandaUploadedAttachment =
        client.submitFormWithBinaryData(
            apiUrl("/miranda/attachments"),
            formData {
                append("file", bytes, io.ktor.http.Headers.build {
                    append(io.ktor.http.HttpHeaders.ContentType, mime)
                    append(io.ktor.http.HttpHeaders.ContentDisposition, "filename=\"" + name.replace("\"", "") + "\"")
                })
            }
        ).body()

    suspend fun downloadAttachment(id: String): ByteArray =
        client.get(apiUrl("/miranda/attachments/$id")).body()

    // --- realtime ---

    /** GET /miranda/ws — push-only; frames are {type:"message", message: MirandaMessage}. */
    suspend fun listen(onOpen: suspend () -> Unit, onFrame: suspend (JsonObject) -> Unit) {
        client.webSocket(urlString = apiUrl("/miranda/ws").replaceFirst("http", "ws")) {
            onOpen()
            for (frame in incoming) {
                if (frame is io.ktor.websocket.Frame.Text) {
                    val el = runCatching { kotlinx.serialization.json.Json.parseToJsonElement(frame.readText()) }.getOrNull()
                    (el as? JsonObject)?.let { onFrame(it) }
                }
            }
        }
    }
}

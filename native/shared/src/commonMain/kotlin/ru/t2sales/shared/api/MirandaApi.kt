package ru.t2sales.shared.api

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.client.request.forms.formData
import io.ktor.client.request.forms.submitFormWithBinaryData
import io.ktor.client.request.delete
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

    // 20.78.0 — backend показывает очередь всего дилера (как /miranda/accounts):
    // org_id параметр необязателен, без него берётся своя сеть и её дилерская
    // группа. Админ видит pending-устройства всех сетей дилера, не только своей.
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

    suspend fun listAllCorporateAccounts(includeInactive: Boolean = false): MirandaCorporateAccountsListResponse =
        client.get(apiUrl("/miranda/accounts" + if (includeInactive) "?include_inactive=1" else "")).body()

    // 20.76.0 (§C плана, "деактивация — не удаление") — бэкенд-роуты
    // существовали с 20.72.0, нативного клиента не было вообще.
    suspend fun deactivateAccount(corporateAccountId: Int) {
        client.post(apiUrl("/miranda/accounts/$corporateAccountId/deactivate")) {
            contentType(ContentType.Application.Json)
            setBody(JsonObject(emptyMap()))
        }
    }

    suspend fun reactivateAccount(corporateAccountId: Int) {
        client.post(apiUrl("/miranda/accounts/$corporateAccountId/reactivate")) {
            contentType(ContentType.Application.Json)
            setBody(JsonObject(emptyMap()))
        }
    }

    suspend fun createAccount(employeeId: Int, storeId: String?, displayLabel: String?): MirandaCreateAccountResponse =
        client.post(apiUrl("/miranda/accounts")) {
            contentType(ContentType.Application.Json)
            setBody(MirandaCreateAccountRequest(employeeId, storeId, displayLabel))
        }.body()

    // Этап B (вариант B) — аккаунт точки/кассы: собственный вход по телефону+паролю.
    suspend fun createPointAccount(phone: String, password: String, accountName: String, storeId: String?): MirandaCreateAccountResponse =
        client.post(apiUrl("/miranda/accounts")) {
            contentType(ContentType.Application.Json)
            setBody(MirandaCreatePointAccountRequest(phone, password, accountName, storeId))
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

    // --- point-account login (Этап B, вариант B) — независимый от /auth/login
    // вход по телефону+паролю для аккаунтов точек/касс, пишет отдельную
    // cookie t2_point_session (см. backend/.../miranda/accounts-login.ts). ---

    suspend fun pointLogin(phone: String, password: String): MirandaPointLoginResponse =
        client.post(apiUrl("/miranda/accounts/login")) {
            contentType(ContentType.Application.Json)
            setBody(MirandaPointLoginRequest(phone, password))
        }.body()

    suspend fun pointLogout() {
        client.post(apiUrl("/miranda/accounts/logout")) {
            contentType(ContentType.Application.Json)
            setBody(JsonObject(emptyMap()))
        }
    }

    // --- contacts (regular user; not admin-gated) ---

    suspend fun searchContacts(q: String): MirandaContactsResponse =
        client.get(apiUrl("/miranda/contacts?q=" + java.net.URLEncoder.encode(q, "UTF-8"))).body()

    /** Полное дерево контактов сети (не поиск) - для главного экрана мессенджера. */
    suspend fun listAllContacts(): MirandaAllContactsResponse =
        client.get(apiUrl("/miranda/contacts/all")).body()

    // --- presence (свой статус "в сети") ---

    suspend fun setPresence(status: String) {
        client.patch(apiUrl("/miranda/presence")) {
            contentType(ContentType.Application.Json)
            setBody(MirandaSetPresenceRequest(status))
        }
    }

    // --- §G плана — самостоятельное переименование (свой display_label, любой принципал) ---

    suspend fun getOwnAccount(): MirandaOwnAccountResponse =
        client.get(apiUrl("/miranda/accounts/me")).body()

    suspend fun setOwnDisplayLabel(displayLabel: String?) {
        client.patch(apiUrl("/miranda/accounts/me")) {
            contentType(ContentType.Application.Json)
            setBody(MirandaSetDisplayLabelRequest(displayLabel))
        }
    }

    // --- общие для сети группы контактов, настраивает администратор; вложенные (не групповые чаты — см. MirandaCreateGroupRequest ниже) ---

    suspend fun listContactGroups(): MirandaContactGroupsListResponse =
        client.get(apiUrl("/miranda/groups")).body()

    suspend fun createContactGroup(name: String, parentGroupId: Int? = null): MirandaCreateContactGroupResponse =
        client.post(apiUrl("/miranda/groups")) {
            contentType(ContentType.Application.Json)
            setBody(MirandaCreateContactGroupRequest(name, parentGroupId))
        }.body()

    suspend fun renameContactGroup(groupId: Int, name: String) {
        client.patch(apiUrl("/miranda/groups/$groupId")) {
            contentType(ContentType.Application.Json)
            setBody(MirandaCreateContactGroupRequest(name))
        }
    }

    suspend fun deleteContactGroup(groupId: Int) {
        client.delete(apiUrl("/miranda/groups/$groupId"))
    }

    suspend fun addContactToGroup(groupId: Int, corporateAccountId: Int) {
        client.post(apiUrl("/miranda/groups/$groupId/members")) {
            contentType(ContentType.Application.Json)
            setBody(MirandaAddGroupMemberRequest(corporateAccountId))
        }
    }

    suspend fun removeContactFromGroup(groupId: Int, corporateAccountId: Int) {
        client.delete(apiUrl("/miranda/groups/$groupId/members/$corporateAccountId"))
    }

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

package ru.t2sales.shared.api

import kotlinx.serialization.Serializable

/**
 * Hand-ported from backend/src/api/routes/miranda and
 * backend/src/shared/api-types.ts's "T2 Miranda" section. Field names kept
 * verbatim (snake_case/camelCase mixed per the actual wire shape), same
 * convention as ApiTypes.kt.
 */

@Serializable
data class MirandaRegisterDeviceRequest(
    val platform: String, // "windows" (Miranda desktop is Windows-only)
    val storeId: String? = null,
    val label: String? = null
)

@Serializable
data class MirandaRegisterDeviceResponse(
    val deviceId: Int,
    val deviceSecret: String,
    val status: String // "pending" | "active"
)

@Serializable
data class MirandaActivateDeviceRequest(
    val deviceSecret: String
)

@Serializable
data class MirandaActivateDeviceResponse(
    val status: String, // "active" | "pending" | "unknown_device"
    val corporateAccountId: Int? = null,
    val displayLabel: String? = null
)

@Serializable
data class MirandaPendingBindingRow(
    val binding_id: Int,
    val device_id: Int,
    val platform: String,
    val device_label: String? = null,
    val corporate_account_id: Int,
    val employee_id: Int,
    val employee_full_name: String,
    val store_id: String? = null,
    val created_at: String
)

@Serializable
data class MirandaPendingBindingsListResponse(val items: List<MirandaPendingBindingRow>)

@Serializable
data class MirandaCorporateAccountListItem(
    val corporate_account_id: Int,
    val employee_id: Int? = null, // null для аккаунта точки (Этап B) — employee_full_name тогда падает на account_name
    val employee_full_name: String,
    val store_id: String? = null,
    val store_name: String? = null, // человекочитаемая группа для дерева контактов (store_id - технический код)
    val display_label: String? = null,
    val device_exclusive: Boolean = false,
    val presence_override: String? = null, // "online" | "offline" | null (авто)
    val online: Boolean = false
)

// ---------- Группы контактов (общие для сети, настраивает администратор; вложенные) ----------

@Serializable
data class MirandaContactGroup(
    val id: Int,
    val org_id: String = "",
    val parent_group_id: Int? = null,
    val name: String,
    val sort_order: Int = 0,
    val member_corporate_account_ids: List<Int> = emptyList()
)

@Serializable
data class MirandaContactGroupsListResponse(val items: List<MirandaContactGroup>)

@Serializable
data class MirandaCreateContactGroupRequest(val name: String, val parentGroupId: Int? = null)

@Serializable
data class MirandaCreateContactGroupResponse(val item: MirandaContactGroup)

@Serializable
data class MirandaAddGroupMemberRequest(val corporateAccountId: Int)

// ---------- Presence ----------

@Serializable
data class MirandaSetPresenceRequest(val status: String) // "online" | "offline" | "auto"

@Serializable
data class MirandaCorporateAccountsListResponse(val items: List<MirandaCorporateAccountListItem>)

@Serializable
data class MirandaContactsResponse(val items: List<MirandaCorporateAccountListItem>)

/** GET /miranda/contacts/all - полное дерево контактов сети (не поиск), доступно и сотруднику, и аккаунту точки. */
@Serializable
data class MirandaAllContactsResponse(val items: List<MirandaCorporateAccountListItem>)

// ---------- Самостоятельное переименование (§G плана) ----------

/** GET /miranda/accounts/me - сырая строка corporate_accounts (не
 * joined-вид MirandaCorporateAccountListItem) - для предзаполнения поля
 * "моё отображаемое имя" в Settings. */
@Serializable
data class MirandaOwnAccount(
    val id: Int,
    val org_id: String = "",
    val employee_id: Int? = null,
    val store_id: String? = null,
    val display_label: String? = null,
    val is_active: Boolean = true,
    val device_exclusive: Boolean = false,
    val phone: String? = null,
    val account_name: String? = null,
    val presence_override: String? = null
)

@Serializable
data class MirandaOwnAccountResponse(val item: MirandaOwnAccount)

@Serializable
data class MirandaSetDisplayLabelRequest(val displayLabel: String?)

@Serializable
data class MirandaAvailableAccountRow(
    val corporate_account_id: Int,
    val employee_id: Int,
    val employee_full_name: String,
    val store_id: String? = null,
    val display_label: String? = null,
    val is_default_for_device: Boolean = false
)

@Serializable
data class MirandaAvailableAccountsResponse(val items: List<MirandaAvailableAccountRow>)

@Serializable
data class MirandaSwitchAccountRequest(val corporateAccountId: Int)

@Serializable
data class MirandaGrantAccountRequest(val adminEmployeeId: Int, val corporateAccountId: Int)

@Serializable
data class MirandaSetDeviceExclusiveRequest(val deviceExclusive: Boolean)

@Serializable
data class MirandaCreateAccountRequest(
    val employeeId: Int,
    val storeId: String? = null,
    val displayLabel: String? = null
)

// Этап B (вариант B) — аккаунт точки/кассы: собственный вход по телефону+паролю.
@Serializable
data class MirandaCreatePointAccountRequest(
    val phone: String,
    val password: String,
    val accountName: String,
    val storeId: String? = null
)

@Serializable
data class MirandaPointLoginRequest(val phone: String, val password: String)

@Serializable
data class MirandaPointLoginResponse(
    val ok: Boolean,
    val corporateAccountId: Int,
    val accountName: String? = null
)

@Serializable
data class MirandaCorporateAccountRow(
    val id: Int,
    val org_id: String = "",
    val employee_id: Int? = null,
    val store_id: String? = null,
    val display_label: String? = null,
    val is_active: Boolean = true,
    val device_exclusive: Boolean = false
)

@Serializable
data class MirandaCreateAccountResponse(val item: MirandaCorporateAccountRow)

// ---------- Messenger ----------

@Serializable
data class MirandaConversationListItem(
    val id: Int,
    val type: String, // "direct" | "group"
    val title: String? = null, // null for direct conversations - derive from members
    val last_read_message_id: Int? = null,
    val last_message_id: Int? = null,
    val last_message_body: String? = null,
    val last_message_created_at: String? = null,
    val unread_count: Int = 0
)

@Serializable
data class MirandaConversationsListResponse(val items: List<MirandaConversationListItem>)

@Serializable
data class MirandaConversationMember(
    val corporate_account_id: Int,
    val employee_id: Int,
    val employee_full_name: String,
    val store_id: String? = null,
    val display_label: String? = null
)

@Serializable
data class MirandaConversationMembersResponse(val items: List<MirandaConversationMember>)

@Serializable
data class MirandaCreateDirectRequest(val targetCorporateAccountId: Int)

@Serializable
data class MirandaCreateGroupRequest(val title: String, val memberCorporateAccountIds: List<Int>)

@Serializable
data class MirandaConversationIdResponse(val conversationId: Int)

@Serializable
data class MirandaMessageSender(
    val corporateAccountId: Int,
    val employeeId: Int? = null, // null для отправителя-точки (Этап B, без привязанного сотрудника)
    val displayName: String
)

@Serializable
data class MirandaAttachment(
    val id: String,
    val originalFilename: String,
    val mimeType: String,
    val sizeBytes: Long
)

@Serializable
data class MirandaMessage(
    val id: Int,
    val conversationId: Int,
    val clientMessageId: String,
    val body: String? = null,
    val createdAt: String,
    val sender: MirandaMessageSender,
    val attachments: List<MirandaAttachment> = emptyList()
)

@Serializable
data class MirandaMessagesPageResponse(
    val items: List<MirandaMessage>,
    val nextCursor: String? = null
)

@Serializable
data class MirandaPostMessageRequest(
    val clientMessageId: String,
    val body: String? = null,
    val attachmentIds: List<String>? = null
)

@Serializable
data class MirandaMarkReadRequest(val messageId: String)

@Serializable
data class MirandaUploadedAttachment(
    val id: String,
    val originalFilename: String,
    val mimeType: String,
    val sizeBytes: Long,
    val expiresAt: String? = null
)

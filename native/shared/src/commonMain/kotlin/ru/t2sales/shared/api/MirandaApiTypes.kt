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
    val employee_id: Int,
    val employee_full_name: String,
    val store_id: String? = null,
    val display_label: String? = null,
    val device_exclusive: Boolean = false
)

@Serializable
data class MirandaCorporateAccountsListResponse(val items: List<MirandaCorporateAccountListItem>)

@Serializable
data class MirandaContactsResponse(val items: List<MirandaCorporateAccountListItem>)

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
    val employeeId: Int,
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

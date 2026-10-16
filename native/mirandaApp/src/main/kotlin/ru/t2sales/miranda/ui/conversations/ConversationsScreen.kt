package ru.t2sales.miranda.ui.conversations

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.CircularProgressIndicator
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ru.t2sales.miranda.ui.components.Field
import ru.t2sales.miranda.ui.components.MainButton
import ru.t2sales.miranda.ui.components.SheetDialog
import ru.t2sales.shared.api.MirandaApi
import ru.t2sales.shared.api.MirandaContactsResponse
import ru.t2sales.shared.api.MirandaConversationListItem
import ru.t2sales.shared.api.MirandaCorporateAccountListItem
import ru.t2sales.shared.theme.T2Colors

/**
 * §4 of the plan: conversations list. `title` is null for direct
 * conversations (the list query doesn't expose the other participant's
 * identity - see messenger.ts repository), so for each direct conversation
 * this screen separately resolves a display name via GET
 * /miranda/conversations/:id/members and caches it in memory.
 */
@Composable
fun ConversationsScreen(
    api: MirandaApi,
    myCorporateAccountId: Int,
    onOpenConversation: (Int, String) -> Unit
) {
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<MirandaConversationListItem>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var showNewChat by remember { mutableStateOf(false) }
    val titleCache = remember { mutableStateMapOf<Int, String>() }

    suspend fun resolveTitle(conv: MirandaConversationListItem): String {
        conv.title?.let { return it }
        titleCache[conv.id]?.let { return it }
        val members = runCatching { api.getMembers(conv.id).items }.getOrDefault(emptyList())
        val other = members.firstOrNull { it.corporate_account_id != myCorporateAccountId }
        val label = other?.display_label ?: other?.employee_full_name ?: "Диалог"
        titleCache[conv.id] = label
        return label
    }

    suspend fun refresh() {
        runCatching { api.listConversations().items }.onSuccess { items = it }
        loaded = true
    }

    LaunchedEffect(Unit) {
        refresh()
        while (true) {
            delay(15000)
            refresh()
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("Диалоги", fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, color = T2Colors.text)
            MainButton("+ Новый диалог", enabled = true) { showNewChat = true }
        }

        when {
            !loaded -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            items.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Пока нет диалогов", color = T2Colors.hint, fontSize = 14.sp)
            }
            else -> LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(items, key = { it.id }) { conv ->
                    var title by remember(conv.id) { mutableStateOf(conv.title ?: "…") }
                    LaunchedEffect(conv.id) { title = resolveTitle(conv) }
                    ConversationRow(conv, title) { onOpenConversation(conv.id, title) }
                }
            }
        }
    }

    if (showNewChat) {
        NewConversationDialog(
            api = api,
            onDismiss = { showNewChat = false },
            onCreated = { id, title ->
                showNewChat = false
                scope.launch { refresh() }
                onOpenConversation(id, title)
            }
        )
    }
}

@Composable
private fun ConversationRow(conv: MirandaConversationListItem, title: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = T2Colors.text)
            val preview = conv.last_message_body
            if (!preview.isNullOrEmpty()) {
                Spacer(Modifier.height(2.dp))
                Text(preview, fontSize = 13.sp, color = T2Colors.hint, maxLines = 1)
            }
        }
        if (conv.unread_count > 0) {
            Box(
                modifier = Modifier.size(22.dp).clip(CircleShape).background(T2Colors.primary),
                contentAlignment = Alignment.Center
            ) { Text(conv.unread_count.toString(), fontSize = 11.sp, color = T2Colors.onAccent, fontWeight = FontWeight.Bold) }
        }
    }
}

@Composable
private fun NewConversationDialog(api: MirandaApi, onDismiss: () -> Unit, onCreated: (Int, String) -> Unit) {
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<MirandaContactsResponse?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(query) {
        if (query.trim().length < 2) { results = null; return@LaunchedEffect }
        delay(250)
        results = runCatching { api.searchContacts(query.trim()) }.getOrNull()
    }

    SheetDialog("Новый диалог", onDismiss) {
        Field("Контакт", query, { query = it }, placeholder = "Имя сотрудника")
        Spacer(Modifier.height(12.dp))
        results?.items?.forEach { contact: MirandaCorporateAccountListItem ->
            val shape = RoundedCornerShape(12.dp)
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 6.dp)
                    .clip(shape)
                    .background(T2Colors.surface2)
                    .border(1.dp, T2Colors.border, shape)
                    .clickable {
                        scope.launch {
                            runCatching { api.createDirect(contact.corporate_account_id) }
                                .onSuccess { onCreated(it.conversationId, contact.display_label ?: contact.employee_full_name) }
                        }
                    }
                    .padding(12.dp)
            ) {
                Column {
                    Text(contact.display_label ?: contact.employee_full_name, color = T2Colors.text, fontWeight = FontWeight.SemiBold)
                    Text(contact.store_id ?: "без точки", color = T2Colors.hint, fontSize = 12.sp)
                }
            }
        }
    }
}

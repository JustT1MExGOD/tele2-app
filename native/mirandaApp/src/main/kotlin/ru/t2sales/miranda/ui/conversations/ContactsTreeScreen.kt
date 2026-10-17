package ru.t2sales.miranda.ui.conversations

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import ru.t2sales.shared.api.MirandaApi
import ru.t2sales.shared.api.MirandaCorporateAccountListItem
import ru.t2sales.shared.theme.T2Colors

private const val NO_STORE_GROUP = "Без точки"

/**
 * Дерево контактов всей сети (аналог главного окна Miranda NG) -
 * группировка по точке (store_name), раскрывающиеся группы, двойной клик
 * по контакту открывает/создаёт прямой диалог. В отличие от легаси-
 * скрина, отделы внутри офиса не выделяются отдельным уровнем - в модели
 * данных нет понятия "отдел сотрудника", только store_id.
 */
@Composable
fun ContactsTreeScreen(
    api: MirandaApi,
    myCorporateAccountId: Int,
    onOpenConversation: (Int, String) -> Unit
) {
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<MirandaCorporateAccountListItem>?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    val expanded = remember { mutableStateMapOf<String, Boolean>() }

    LaunchedEffect(Unit) {
        runCatching { api.listAllContacts().items }
            .onSuccess { items = it }
            .onFailure { loadError = it.toString() }
    }

    fun openContact(contact: MirandaCorporateAccountListItem) {
        val title = contact.display_label ?: contact.employee_full_name
        scope.launch {
            runCatching { api.createDirect(contact.corporate_account_id) }
                .onSuccess { onOpenConversation(it.conversationId, title) }
        }
    }

    val loaded = items
    if (loaded == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            if (loadError != null) {
                Text(loadError!!, color = T2Colors.text, fontSize = 12.sp)
            } else {
                CircularProgressIndicator()
            }
        }
        return
    }

    val groups = loaded
        .filter { it.corporate_account_id != myCorporateAccountId }
        .groupBy { it.store_name?.takeIf { s -> s.isNotBlank() } ?: NO_STORE_GROUP }
        .toSortedMap(compareBy { if (it == NO_STORE_GROUP) "￿" else it })

    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("Контакты", fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, color = T2Colors.text)
        }

        if (groups.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Нет контактов", color = T2Colors.hint, fontSize = 14.sp)
            }
            return
        }

        LazyColumn(modifier = Modifier.fillMaxSize()) {
            groups.forEach { (groupName, accounts) ->
                val isExpanded = expanded[groupName] ?: true
                val rows: List<Any> = listOf(GroupHeader(groupName, accounts.size)) +
                    if (isExpanded) accounts else emptyList()
                items(
                    rows,
                    key = { entry -> if (entry is GroupHeader) "group:${entry.name}" else "acc:${(entry as MirandaCorporateAccountListItem).corporate_account_id}" }
                ) { entry ->
                    when (entry) {
                        is GroupHeader -> GroupHeaderRow(entry.name, entry.count, isExpanded) {
                            expanded[groupName] = !isExpanded
                        }
                        is MirandaCorporateAccountListItem -> ContactLeafRow(entry, onDoubleClick = { openContact(entry) })
                    }
                }
            }
        }
    }
}

private data class GroupHeader(val name: String, val count: Int)

@Composable
private fun GroupHeaderRow(name: String, count: Int, expanded: Boolean, onToggle: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(T2Colors.surface)
            .padding(horizontal = 16.dp, vertical = 10.dp)
            .pointerInput(name) { detectTapGestures(onTap = { onToggle() }) },
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(if (expanded) "▾" else "▸", color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.width(18.dp))
        Text(name, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = T2Colors.text)
        Spacer(Modifier.width(6.dp))
        Text("($count)", fontSize = 12.sp, color = T2Colors.hint)
    }
}

@Composable
private fun ContactLeafRow(contact: MirandaCorporateAccountListItem, onDoubleClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 34.dp, end = 16.dp, top = 8.dp, bottom = 8.dp)
            .pointerInput(contact.corporate_account_id) { detectTapGestures(onDoubleTap = { onDoubleClick() }) },
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text("●", color = T2Colors.primary, fontSize = 10.sp, modifier = Modifier.width(18.dp))
        Text(
            contact.display_label ?: contact.employee_full_name,
            fontSize = 14.sp,
            color = T2Colors.text
        )
    }
}

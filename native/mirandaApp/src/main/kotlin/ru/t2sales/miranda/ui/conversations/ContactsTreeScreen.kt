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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import ru.t2sales.miranda.settings.MirandaSettingsStore
import ru.t2sales.miranda.ui.components.SheetDialog
import ru.t2sales.shared.api.MirandaApi
import ru.t2sales.shared.api.MirandaContactGroup
import ru.t2sales.shared.api.MirandaCorporateAccountListItem
import ru.t2sales.shared.theme.T2Colors

private const val NO_STORE_GROUP = "Без точки"
private const val NO_CUSTOM_GROUP = "Без группы"
private const val PRESENCE_POLL_MS = 20_000L

/**
 * Дерево контактов всей сети (аналог главного окна Miranda NG) -
 * группировка по точке (store_name) либо по личным группам контакт-листа
 * (MirandaSettingsStore.groupByMode), раскрывающиеся группы, статус
 * в сети/не в сети, сортировка "в сети - вверху", двойной клик по
 * контакту открывает/создаёт прямой диалог.
 */
@Composable
fun ContactsTreeScreen(
    api: MirandaApi,
    myCorporateAccountId: Int,
    onOpenConversation: (Int, String) -> Unit
) {
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<MirandaCorporateAccountListItem>?>(null) }
    var customGroups by remember { mutableStateOf<List<MirandaContactGroup>>(emptyList()) }
    var loadError by remember { mutableStateOf<String?>(null) }
    val expanded = remember { mutableStateMapOf<String, Boolean>() }

    var groupByCustom by remember { mutableStateOf(MirandaSettingsStore.groupByMode == "custom") }
    var showOffline by remember { mutableStateOf(MirandaSettingsStore.showOfflineContacts) }
    var sortOnlineFirst by remember { mutableStateOf(MirandaSettingsStore.sortOnlineFirst) }

    var createGroupDialog by remember { mutableStateOf(false) }
    var manageGroupDialogFor by remember { mutableStateOf<MirandaContactGroup?>(null) }
    var membershipDialogFor by remember { mutableStateOf<MirandaCorporateAccountListItem?>(null) }

    suspend fun reloadContacts() {
        runCatching { api.listAllContacts().items }
            .onSuccess { items = it; loadError = null }
            .onFailure { loadError = it.toString() }
    }

    suspend fun reloadGroups() {
        if (groupByCustom) {
            runCatching { api.listContactGroups().items }.onSuccess { customGroups = it }
        }
    }

    LaunchedEffect(Unit) {
        reloadContacts()
        reloadGroups()
    }

    // Переодический опрос presence - без отдельного WS-канала, тот же
    // уровень свежести, что polling-fallback уже применяется в ReportsApi.
    LaunchedEffect(Unit) {
        while (isActive) {
            delay(PRESENCE_POLL_MS)
            reloadContacts()
        }
    }

    LaunchedEffect(groupByCustom) { reloadGroups() }

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

    val visible = loaded
        .filter { it.corporate_account_id != myCorporateAccountId }
        .filter { showOffline || it.online }

    val groups: Map<String, List<MirandaCorporateAccountListItem>> = if (groupByCustom) {
        val byId = visible.associateBy { it.corporate_account_id }
        val grouped = linkedMapOf<String, List<MirandaCorporateAccountListItem>>()
        val inAnyGroup = mutableSetOf<Int>()
        customGroups.sortedBy { it.sort_order }.forEach { g ->
            val members = g.member_corporate_account_ids.mapNotNull { byId[it] }
            inAnyGroup.addAll(g.member_corporate_account_ids)
            grouped[g.name] = members
        }
        val ungrouped = visible.filter { it.corporate_account_id !in inAnyGroup }
        if (ungrouped.isNotEmpty() || grouped.isEmpty()) grouped[NO_CUSTOM_GROUP] = ungrouped
        grouped
    } else {
        visible
            .groupBy { it.store_name?.takeIf { s -> s.isNotBlank() } ?: NO_STORE_GROUP }
            .toSortedMap(compareBy { if (it == NO_STORE_GROUP) "￿" else it })
    }

    fun sortedMembers(members: List<MirandaCorporateAccountListItem>): List<MirandaCorporateAccountListItem> {
        val byName = compareBy<MirandaCorporateAccountListItem> { it.display_label ?: it.employee_full_name }
        return if (sortOnlineFirst) {
            members.sortedWith(compareByDescending<MirandaCorporateAccountListItem> { it.online }.then(byName))
        } else {
            members.sortedWith(byName)
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("Контакты", fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, color = T2Colors.text)
            if (groupByCustom) {
                Text(
                    "+",
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    color = T2Colors.primary,
                    modifier = Modifier.pointerInput(Unit) { detectTapGestures(onTap = { createGroupDialog = true }) }
                )
            }
        }

        if (groups.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Нет контактов", color = T2Colors.hint, fontSize = 14.sp)
            }
        } else {
            LazyColumn(modifier = Modifier.fillMaxSize()) {
                groups.forEach { (groupName, accountsRaw) ->
                    val accounts = sortedMembers(accountsRaw)
                    val isExpanded = expanded[groupName] ?: true
                    val customGroup = if (groupByCustom) customGroups.find { it.name == groupName } else null
                    val rows: List<Any> = listOf(GroupHeader(groupName, accounts.size)) +
                        if (isExpanded) accounts else emptyList()
                    items(
                        rows,
                        key = { entry -> if (entry is GroupHeader) "group:${entry.name}" else "acc:${(entry as MirandaCorporateAccountListItem).corporate_account_id}" }
                    ) { entry ->
                        when (entry) {
                            is GroupHeader -> GroupHeaderRow(
                                entry.name,
                                entry.count,
                                isExpanded,
                                manageable = customGroup != null,
                                onToggle = { expanded[groupName] = !isExpanded },
                                onManage = { manageGroupDialogFor = customGroup }
                            )
                            is MirandaCorporateAccountListItem -> ContactLeafRow(
                                entry,
                                showManage = groupByCustom,
                                onDoubleClick = { openContact(entry) },
                                onManage = { membershipDialogFor = entry }
                            )
                        }
                    }
                }
            }
        }
    }

    if (createGroupDialog) {
        CreateGroupDialog(
            onDismiss = { createGroupDialog = false },
            onCreate = { name ->
                scope.launch {
                    runCatching { api.createContactGroup(name) }.onSuccess { reloadGroups() }
                    createGroupDialog = false
                }
            }
        )
    }

    manageGroupDialogFor?.let { group ->
        ManageGroupDialog(
            group = group,
            onDismiss = { manageGroupDialogFor = null },
            onRename = { newName ->
                scope.launch {
                    runCatching { api.renameContactGroup(group.id, newName) }.onSuccess { reloadGroups() }
                    manageGroupDialogFor = null
                }
            },
            onDelete = {
                scope.launch {
                    runCatching { api.deleteContactGroup(group.id) }.onSuccess { reloadGroups() }
                    manageGroupDialogFor = null
                }
            }
        )
    }

    membershipDialogFor?.let { contact ->
        MembershipDialog(
            contact = contact,
            groups = customGroups,
            onDismiss = { membershipDialogFor = null },
            onToggleMembership = { group, add ->
                scope.launch {
                    if (add) {
                        runCatching { api.addContactToGroup(group.id, contact.corporate_account_id) }
                    } else {
                        runCatching { api.removeContactFromGroup(group.id, contact.corporate_account_id) }
                    }
                    reloadGroups()
                }
            }
        )
    }
}

private data class GroupHeader(val name: String, val count: Int)

@Composable
private fun GroupHeaderRow(
    name: String,
    count: Int,
    expanded: Boolean,
    manageable: Boolean,
    onToggle: () -> Unit,
    onManage: () -> Unit
) {
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
        if (manageable) {
            Spacer(Modifier.width(8.dp).weight(1f))
            Text(
                "⋯",
                color = T2Colors.hint,
                fontSize = 14.sp,
                modifier = Modifier.pointerInput(name) { detectTapGestures(onTap = { onManage() }) }
            )
        }
    }
}

@Composable
private fun ContactLeafRow(
    contact: MirandaCorporateAccountListItem,
    showManage: Boolean,
    onDoubleClick: () -> Unit,
    onManage: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 34.dp, end = 16.dp, top = 8.dp, bottom = 8.dp)
            .pointerInput(contact.corporate_account_id) { detectTapGestures(onDoubleTap = { onDoubleClick() }) },
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(9.dp)
                .clip(CircleShape)
                .background(if (contact.online) T2Colors.success else T2Colors.hint)
        )
        Spacer(Modifier.width(9.dp))
        Text(
            contact.display_label ?: contact.employee_full_name,
            fontSize = 14.sp,
            color = T2Colors.text,
            modifier = Modifier.weight(1f)
        )
        if (showManage) {
            Text(
                "⋯",
                color = T2Colors.hint,
                fontSize = 14.sp,
                modifier = Modifier.pointerInput(contact.corporate_account_id) { detectTapGestures(onTap = { onManage() }) }
            )
        }
    }
}

@Composable
private fun CreateGroupDialog(onDismiss: () -> Unit, onCreate: (String) -> Unit) {
    var name by remember { mutableStateOf("") }
    SheetDialog(title = "Новая группа", onDismiss = onDismiss) {
        ru.t2sales.miranda.ui.components.Field(label = "Название", value = name, onChange = { name = it })
        Spacer(Modifier.height(16.dp))
        ru.t2sales.miranda.ui.components.MainButton(text = "Создать", enabled = name.isNotBlank()) { onCreate(name.trim()) }
    }
}

@Composable
private fun ManageGroupDialog(group: MirandaContactGroup, onDismiss: () -> Unit, onRename: (String) -> Unit, onDelete: () -> Unit) {
    var name by remember { mutableStateOf(group.name) }
    SheetDialog(title = "Группа «${group.name}»", onDismiss = onDismiss) {
        ru.t2sales.miranda.ui.components.Field(label = "Название", value = name, onChange = { name = it })
        Spacer(Modifier.height(16.dp))
        ru.t2sales.miranda.ui.components.MainButton(text = "Переименовать", enabled = name.isNotBlank() && name != group.name) { onRename(name.trim()) }
        Spacer(Modifier.height(12.dp))
        ru.t2sales.miranda.ui.components.MainButton(text = "Удалить группу", enabled = true, container = T2Colors.danger) { onDelete() }
    }
}

@Composable
private fun MembershipDialog(
    contact: MirandaCorporateAccountListItem,
    groups: List<MirandaContactGroup>,
    onDismiss: () -> Unit,
    onToggleMembership: (MirandaContactGroup, Boolean) -> Unit
) {
    SheetDialog(title = contact.display_label ?: contact.employee_full_name, onDismiss = onDismiss) {
        if (groups.isEmpty()) {
            Text("Сначала создайте группу", color = T2Colors.hint, fontSize = 13.sp)
        }
        groups.forEach { group ->
            val member = group.member_corporate_account_ids.contains(contact.corporate_account_id)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .pointerInput(group.id) { detectTapGestures(onTap = { onToggleMembership(group, !member) }) }
                    .padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                androidx.compose.material.Checkbox(
                    checked = member,
                    onCheckedChange = { onToggleMembership(group, it) },
                    colors = androidx.compose.material.CheckboxDefaults.colors(checkedColor = T2Colors.primary)
                )
                Spacer(Modifier.width(8.dp))
                Text(group.name, fontSize = 14.sp, color = T2Colors.text)
            }
        }
    }
}

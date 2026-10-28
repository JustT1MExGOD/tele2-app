package ru.t2sales.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.material.Checkbox
import androidx.compose.material.RadioButton
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import ru.t2sales.android.AppContainer
import ru.t2sales.shared.api.AcEmployeeHit
import ru.t2sales.shared.api.MirandaAvailableAccountRow
import ru.t2sales.shared.api.MirandaContactGroup
import ru.t2sales.shared.api.MirandaCorporateAccountListItem
import ru.t2sales.shared.api.MirandaPendingBindingRow
import ru.t2sales.shared.api.SheetImportPendingRow
import ru.t2sales.shared.theme.T2Colors

/**
 * Port of backend/frontend/src/pages/admin-center/miranda-devices.ts + the
 * desktop client's admincenter/AcMiranda.kt: device approval queue,
 * personal/point account creation, device-exclusive toggle, deactivate /
 * reactivate, account-switch grants, contact groups (create / rename /
 * delete / members) and renaming any corporate account. The group + rename
 * controls mirror the web (20.79.x); they land on Android before the PC
 * client gets them, so this file is the reference implementation.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun MirandaDevicesTab(container: AppContainer) {
    val mirandaApi = container.mirandaApi
    val scope = rememberCoroutineScope()
    var pending by remember { mutableStateOf<List<MirandaPendingBindingRow>?>(null) }
    var accounts by remember { mutableStateOf<List<MirandaCorporateAccountListItem>?>(null) }
    var available by remember { mutableStateOf<List<MirandaAvailableAccountRow>?>(null) }
    var groups by remember { mutableStateOf<List<MirandaContactGroup>?>(null) }
    var pendingFailed by remember { mutableStateOf(false) }
    var accountsFailed by remember { mutableStateOf(false) }
    var availableFailed by remember { mutableStateOf(false) }
    var groupsFailed by remember { mutableStateOf(false) }
    var reload by remember { mutableStateOf(0) }
    var stepUpTarget by remember { mutableStateOf<Int?>(null) }

    var grantQuery by remember { mutableStateOf("") }
    var grantResults by remember { mutableStateOf<List<AcEmployeeHit>>(emptyList()) }
    var selectedAdmin by remember { mutableStateOf<AcEmployeeHit?>(null) }
    var selectedAccountId by remember { mutableStateOf<Int?>(null) }

    var createQuery by remember { mutableStateOf("") }
    var createResults by remember { mutableStateOf<List<AcEmployeeHit>>(emptyList()) }
    var selectedCreateEmployee by remember { mutableStateOf<AcEmployeeHit?>(null) }
    var createStoreId by remember { mutableStateOf("") }
    var createLabel by remember { mutableStateOf("") }
    var createIsPoint by remember { mutableStateOf(false) }
    var createPhone by remember { mutableStateOf("") }
    var createPassword by remember { mutableStateOf("") }
    var createAccountName by remember { mutableStateOf("") }
    var showInactive by remember { mutableStateOf(false) }

    // groups
    var selectedGroupAccountId by remember { mutableStateOf<Int?>(null) }
    var newGroupName by remember { mutableStateOf("") }
    var renameGroupTarget by remember { mutableStateOf<MirandaContactGroup?>(null) }
    var deleteGroupTarget by remember { mutableStateOf<MirandaContactGroup?>(null) }
    var renameAccountTarget by remember { mutableStateOf<MirandaCorporateAccountListItem?>(null) }

    LaunchedEffect(reload, showInactive) {
        runCatching { mirandaApi.listPendingDevices().items }
            .onSuccess { pending = it; pendingFailed = false }
            .onFailure { pending = null; pendingFailed = true }
        runCatching { mirandaApi.listAllCorporateAccounts(showInactive).items }
            .onSuccess { accounts = it; accountsFailed = false }
            .onFailure { accounts = null; accountsFailed = true }
        runCatching { mirandaApi.listAvailableAccounts().items }
            .onSuccess { available = it; availableFailed = false }
            .onFailure { available = null; availableFailed = true }
        // admin-scoped read: works even when the admin has no active Miranda account on this device
        runCatching { mirandaApi.adminListContactGroups().items }
            .onSuccess { groups = it; groupsFailed = false }
            .onFailure { groups = null; groupsFailed = true }
    }
    LaunchedEffect(grantQuery) {
        if (grantQuery.trim().length < 2) { grantResults = emptyList(); return@LaunchedEffect }
        kotlinx.coroutines.delay(250)
        grantResults = runCatching { container.adminCenterApi.search(grantQuery.trim()).employees }.getOrDefault(emptyList())
    }
    LaunchedEffect(createQuery) {
        if (createQuery.trim().length < 2) { createResults = emptyList(); return@LaunchedEffect }
        kotlinx.coroutines.delay(250)
        createResults = runCatching { container.adminCenterApi.search(createQuery.trim()).employees }.getOrDefault(emptyList())
    }

    PageSection("Устройства Miranda — очередь подтверждения") {
        val list = pending
        when {
            pendingFailed -> ErrorState("Не удалось загрузить очередь устройств", onRetry = { reload++ })
            list == null -> LoadingBlock(Modifier.padding(16.dp))
            list.isEmpty() -> EmptyText("Нет устройств, ожидающих подтверждения")
            else -> list.forEach { row ->
                AcListRow(
                    "${row.employee_full_name} · ${row.platform}" + (row.device_label?.let { " · $it" } ?: ""),
                    "${row.store_id ?: "без точки"} · заявка от ${row.created_at}"
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        MChipButton("Подтвердить") { stepUpTarget = row.binding_id }
                        MChipButton("Отклонить", danger = true) {
                            scope.launch {
                                runCatching { mirandaApi.revokeDevice(row.binding_id) }
                                    .onSuccess { T2Toast.show("Привязка отклонена"); reload++ }
                                    .onFailure { T2Toast.show("Не удалось отклонить привязку", true) }
                            }
                        }
                    }
                }
            }
        }
    }

    Spacer(Modifier.height(12.dp))
    PageSection("Корпоративные аккаунты — привязка к устройству") {
        Text(
            "Точка/касса — пометьте «только одно устройство»: подтвердить второе одновременно " +
                "активное устройство для такого аккаунта нельзя, пока не отозвать прежнее. " +
                "Личный аккаунт сотрудника можно не ограничивать.",
            color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
        )
        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                RadioButton(selected = !createIsPoint, onClick = { createIsPoint = false })
                Text("Личный аккаунт", fontSize = 13.sp, modifier = Modifier.padding(end = 16.dp))
                RadioButton(selected = createIsPoint, onClick = { createIsPoint = true })
                Text("Аккаунт точки", fontSize = 13.sp)
            }
            Spacer(Modifier.height(6.dp))
            if (createIsPoint) {
                Field("", createPhone, { createPhone = it }, placeholder = "Телефон точки (например, +79991234567)", fill = T2Colors.surface2)
                Spacer(Modifier.height(6.dp))
                Field("", createPassword, { createPassword = it }, placeholder = "Пароль (минимум 8 символов)", fill = T2Colors.surface2)
                Spacer(Modifier.height(6.dp))
                Field("", createAccountName, { createAccountName = it }, placeholder = "Название аккаунта (например, «Касса Космонавтов 20А»)", fill = T2Colors.surface2)
            } else {
                Field("", createQuery, { createQuery = it; selectedCreateEmployee = null }, placeholder = "Сотрудник для нового аккаунта — поиск по имени", fill = T2Colors.surface2)
                selectedCreateEmployee?.let { emp ->
                    Spacer(Modifier.height(6.dp))
                    Text("Выбран: ${emp.full_name} (#${emp.id})", color = T2Colors.hint, fontSize = 12.sp)
                }
                if (createResults.isNotEmpty() && selectedCreateEmployee == null) {
                    Spacer(Modifier.height(6.dp))
                    createResults.forEach { emp ->
                        Box(Modifier.fillMaxWidth().padding(bottom = 4.dp)) {
                            NavRow(emp.full_name, emp.role) { selectedCreateEmployee = emp; createQuery = ""; createResults = emptyList() }
                        }
                    }
                }
                Spacer(Modifier.height(6.dp))
                Field("", createLabel, { createLabel = it }, placeholder = "Название аккаунта (необязательно)", fill = T2Colors.surface2)
            }
            Spacer(Modifier.height(6.dp))
            Field("", createStoreId, { createStoreId = it }, placeholder = "ID точки (необязательно)", fill = T2Colors.surface2)
            Spacer(Modifier.height(10.dp))
            Box(Modifier.fillMaxWidth()) {
                MainButton("Создать аккаунт", enabled = true) {
                    if (createIsPoint) {
                        val phone = createPhone.trim()
                        val password = createPassword
                        val accountName = createAccountName.trim()
                        if (phone.isEmpty() || password.isEmpty() || accountName.isEmpty()) {
                            T2Toast.show("Заполните телефон, пароль и название аккаунта", true)
                        } else {
                            scope.launch {
                                runCatching {
                                    mirandaApi.createPointAccount(phone, password, accountName, createStoreId.trim().ifBlank { null })
                                }.onSuccess {
                                    T2Toast.show("Аккаунт точки создан")
                                    createPhone = ""; createPassword = ""; createAccountName = ""; createStoreId = ""
                                    reload++
                                }.onFailure { err ->
                                    val conflict = (err as? io.ktor.client.plugins.ResponseException)?.response?.status?.value == 409
                                    T2Toast.show(
                                        if (conflict) "Аккаунт с таким телефоном уже существует в вашей сети" else "Не удалось создать аккаунт",
                                        true
                                    )
                                }
                            }
                        }
                    } else {
                        val employee = selectedCreateEmployee
                        if (employee == null) {
                            T2Toast.show("Выберите сотрудника", true)
                        } else {
                            scope.launch {
                                runCatching {
                                    mirandaApi.createAccount(employee.id, createStoreId.trim().ifBlank { null }, createLabel.trim().ifBlank { null })
                                }.onSuccess {
                                    T2Toast.show("Корпоративный аккаунт создан")
                                    selectedCreateEmployee = null; createStoreId = ""; createLabel = ""
                                    reload++
                                }.onFailure { err ->
                                    val conflict = (err as? io.ktor.client.plugins.ResponseException)?.response?.status?.value == 409
                                    T2Toast.show(
                                        if (conflict) "Такой аккаунт уже существует (этот сотрудник + точка)" else "Не удалось создать аккаунт",
                                        true
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
        Row(modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = showInactive, onCheckedChange = { showInactive = it })
            Text("Показывать деактивированные", color = T2Colors.hint, fontSize = 12.sp)
        }
        val list = accounts
        when {
            accountsFailed -> ErrorState("Не удалось загрузить корпоративные аккаунты", onRetry = { reload++ })
            list == null -> LoadingBlock(Modifier.padding(16.dp))
            list.isEmpty() -> EmptyText("Корпоративных аккаунтов пока нет")
            else -> list.forEach { acc ->
                AcListRow(
                    (acc.display_label ?: "${acc.employee_full_name} · ${acc.store_id ?: "без точки"}") + if (!acc.is_active) " · деактивирован" else "",
                    acc.store_id ?: "без точки"
                ) {
                    Column(horizontalAlignment = Alignment.End) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = acc.device_exclusive, enabled = acc.is_active, onCheckedChange = { checked ->
                                scope.launch {
                                    runCatching { mirandaApi.setAccountDeviceExclusive(acc.corporate_account_id, checked) }
                                        .onSuccess { reload++ }
                                        .onFailure { T2Toast.show("Не удалось изменить настройку", true) }
                                }
                            })
                            Text("одно устройство", color = T2Colors.hint, fontSize = 11.sp)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            MChipButton(if (selectedGroupAccountId == acc.corporate_account_id) "Выбран" else "В группу") {
                                selectedGroupAccountId = if (selectedGroupAccountId == acc.corporate_account_id) null else acc.corporate_account_id
                            }
                            MChipButton("Имя") { renameAccountTarget = acc }
                            if (acc.is_active) {
                                MChipButton("Выкл.", danger = true) {
                                    scope.launch {
                                        runCatching { mirandaApi.deactivateAccount(acc.corporate_account_id) }
                                            .onSuccess { T2Toast.show("Аккаунт деактивирован"); reload++ }
                                            .onFailure { T2Toast.show("Не удалось деактивировать аккаунт", true) }
                                    }
                                }
                            } else {
                                MChipButton("Вкл.") {
                                    scope.launch {
                                        runCatching { mirandaApi.reactivateAccount(acc.corporate_account_id) }
                                            .onSuccess { T2Toast.show("Аккаунт восстановлен"); reload++ }
                                            .onFailure { T2Toast.show("Не удалось восстановить аккаунт", true) }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Spacer(Modifier.height(12.dp))
    // ---------- Группы контактов (общие для дилера) ----------
    PageSection("Группы контактов Miranda") {
        Text(
            "Состав задаётся по корпоративным аккаунтам. Выберите аккаунт кнопкой «В группу» в списке выше, " +
                "затем нажмите «+ аккаунт» у нужной группы.",
            color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
        )
        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
            Field("", newGroupName, { newGroupName = it }, placeholder = "Название новой группы", fill = T2Colors.surface2)
            Spacer(Modifier.height(8.dp))
            Box(Modifier.fillMaxWidth()) {
                MainButton("Создать группу", enabled = true) {
                    val name = newGroupName.trim()
                    if (name.isEmpty()) {
                        T2Toast.show("Введите название группы", true)
                    } else {
                        scope.launch {
                            runCatching { mirandaApi.createContactGroup(name) }
                                .onSuccess { T2Toast.show("Группа создана"); newGroupName = ""; reload++ }
                                .onFailure { err ->
                                    val conflict = (err as? io.ktor.client.plugins.ResponseException)?.response?.status?.value == 409
                                    T2Toast.show(if (conflict) "Группа с таким названием уже существует" else "Не удалось создать группу", true)
                                }
                        }
                    }
                }
            }
        }
        val glist = groups
        val accountById = accounts.orEmpty().associateBy { it.corporate_account_id }
        when {
            groupsFailed -> ErrorState("Не удалось загрузить группы Miranda", onRetry = { reload++ })
            glist == null -> LoadingBlock(Modifier.padding(16.dp))
            glist.isEmpty() -> EmptyText("Групп пока нет — создайте первую выше")
            else -> glist.forEach { g ->
                val members = g.member_corporate_account_ids.mapNotNull { accountById[it] }
                Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
                    Text(
                        g.name + if (g.parent_group_id != null) " · вложенная" else "",
                        fontSize = 15.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold
                    )
                    Text(
                        "${g.org_id} · " + if (members.isEmpty()) "пустая" else "${members.size} контакт(ов)",
                        color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp)
                    )
                    if (members.isNotEmpty()) {
                        FlowRow(modifier = Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            members.forEach { m ->
                                MChipButton("${m.display_label ?: m.employee_full_name}  ×") {
                                    scope.launch {
                                        runCatching { mirandaApi.removeContactFromGroup(g.id, m.corporate_account_id) }
                                            .onSuccess { T2Toast.show("Аккаунт убран из группы"); reload++ }
                                            .onFailure { T2Toast.show("Не удалось убрать аккаунт из группы", true) }
                                    }
                                }
                            }
                        }
                    }
                    Row(modifier = Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        MChipButton("+ аккаунт") {
                            val sel = selectedGroupAccountId
                            if (sel == null) {
                                T2Toast.show("Сначала выберите корпоративный аккаунт кнопкой «В группу» в списке выше", true)
                            } else {
                                scope.launch {
                                    runCatching { mirandaApi.addContactToGroup(g.id, sel) }
                                        .onSuccess { T2Toast.show("Аккаунт добавлен в группу"); reload++ }
                                        .onFailure { T2Toast.show("Не удалось добавить аккаунт в группу", true) }
                                }
                            }
                        }
                        MChipButton("Переименовать") { renameGroupTarget = g }
                        MChipButton("Удалить", danger = true) { deleteGroupTarget = g }
                    }
                }
            }
        }
    }

    Spacer(Modifier.height(12.dp))
    PageSection("Переключение аккаунтов — выдача гранта") {
        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
            Field("", grantQuery, { grantQuery = it; selectedAdmin = null }, placeholder = "Админ, которому выдать грант — поиск по имени", fill = T2Colors.surface2)
            selectedAdmin?.let { admin ->
                Spacer(Modifier.height(6.dp))
                Text("Выбран: ${admin.full_name} (#${admin.id})", color = T2Colors.hint, fontSize = 12.sp)
            }
            if (grantResults.isNotEmpty() && selectedAdmin == null) {
                Spacer(Modifier.height(6.dp))
                grantResults.forEach { emp ->
                    Box(Modifier.fillMaxWidth().padding(bottom = 4.dp)) {
                        NavRow(emp.full_name, emp.role) { selectedAdmin = emp; grantQuery = ""; grantResults = emptyList() }
                    }
                }
            }
            Spacer(Modifier.height(10.dp))
            // грант на переключение имеет смысл только на активный аккаунт.
            val accs = accounts.orEmpty().filter { it.is_active }
            if (accs.isEmpty()) {
                EmptyText("Корпоративных аккаунтов пока нет")
            } else {
                accs.forEach { acc ->
                    val isSelected = selectedAccountId == acc.corporate_account_id
                    Box(Modifier.fillMaxWidth().padding(bottom = 4.dp)) {
                        NavRow(
                            (acc.display_label ?: "${acc.employee_full_name} · ${acc.store_id ?: "без точки"}") + if (isSelected) " ✓" else "",
                            null
                        ) { selectedAccountId = acc.corporate_account_id }
                    }
                }
            }
            Spacer(Modifier.height(10.dp))
            Box(Modifier.fillMaxWidth()) {
                MainButton("Выдать грант", enabled = true) {
                    val admin = selectedAdmin
                    val accountId = selectedAccountId
                    when {
                        admin == null -> T2Toast.show("Выберите администратора", true)
                        accountId == null -> T2Toast.show("Выберите корпоративный аккаунт", true)
                        else -> scope.launch {
                            runCatching { mirandaApi.grantAdminAccount(admin.id, accountId) }
                                .onSuccess { T2Toast.show("Грант выдан"); reload++ }
                                .onFailure { T2Toast.show("Не удалось выдать грант", true) }
                        }
                    }
                }
            }
        }
        Text(
            "Доступные вам аккаунты для переключения".uppercase(), color = T2Colors.hint, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold,
            fontSize = 11.sp, letterSpacing = 0.7.sp, modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 4.dp)
        )
        val avail = available
        when {
            availableFailed -> ErrorState("Не удалось загрузить доступные аккаунты", onRetry = { reload++ })
            avail == null -> LoadingBlock(Modifier.padding(16.dp))
            avail.isEmpty() -> EmptyText("Вам не выдано ни одного гранта на переключение")
            else -> avail.forEach { acc ->
                AcListRow(acc.display_label ?: acc.employee_full_name, (acc.store_id ?: "без точки") + if (acc.is_default_for_device) " · по умолчанию на этом устройстве" else "", null)
            }
        }
    }

    // ---------- dialogs ----------
    val target = stepUpTarget
    if (target != null) {
        StepUpDialog(
            api = container.adminCenterApi,
            onDismiss = { stepUpTarget = null },
            onTicket = { ticket ->
                scope.launch {
                    runCatching { mirandaApi.approveDevice(target, ticket) }
                        .onSuccess { T2Toast.show("Устройство подтверждено"); stepUpTarget = null; reload++ }
                        .onFailure { err ->
                            val conflict = (err as? io.ktor.client.plugins.ResponseException)?.response?.status?.value == 409
                            T2Toast.show(
                                if (conflict) "Этот аккаунт уже привязан к другому устройству — сначала отозвать прежнюю привязку"
                                else "Не удалось подтвердить устройство",
                                true
                            )
                            stepUpTarget = null
                        }
                }
            }
        )
    }

    renameGroupTarget?.let { g ->
        TextInputDialog(
            title = "Переименовать группу",
            initial = g.name,
            confirmLabel = "Сохранить",
            onDismiss = { renameGroupTarget = null },
            onConfirm = { name ->
                if (name.isNotBlank() && name != g.name) {
                    scope.launch {
                        runCatching { mirandaApi.renameContactGroup(g.id, name.trim()) }
                            .onSuccess { T2Toast.show("Группа переименована"); reload++ }
                            .onFailure { err ->
                                val conflict = (err as? io.ktor.client.plugins.ResponseException)?.response?.status?.value == 409
                                T2Toast.show(if (conflict) "Группа с таким названием уже существует" else "Не удалось переименовать группу", true)
                            }
                    }
                }
            }
        )
    }

    deleteGroupTarget?.let { g ->
        SheetDialog("Удалить группу", onDismiss = { deleteGroupTarget = null }) {
            Text("Удалить группу «${g.name}»? Контакты останутся в списке вне групп.", color = T2Colors.hint, fontSize = 14.sp)
            Spacer(Modifier.height(16.dp))
            MainButton("Удалить", enabled = true) {
                scope.launch {
                    runCatching { mirandaApi.deleteContactGroup(g.id) }
                        .onSuccess { T2Toast.show("Группа удалена"); deleteGroupTarget = null; reload++ }
                        .onFailure { T2Toast.show("Не удалось удалить группу", true); deleteGroupTarget = null }
                }
            }
        }
    }

    renameAccountTarget?.let { acc ->
        TextInputDialog(
            title = "Имя контакта",
            initial = acc.display_label ?: "",
            confirmLabel = "Сохранить",
            hint = "Пустое — вернуть стандартное имя",
            onDismiss = { renameAccountTarget = null },
            onConfirm = { name ->
                scope.launch {
                    val label = name.trim().ifBlank { null }
                    runCatching { mirandaApi.renameCorporateAccount(acc.corporate_account_id, label) }
                        .onSuccess { T2Toast.show(if (label != null) "Имя контакта обновлено" else "Возвращено стандартное имя"); reload++ }
                        .onFailure { T2Toast.show("Не удалось переименовать аккаунт", true) }
                }
            }
        )
    }
}

/** One row with title + sub on the left and a free-form action slot on the right (ported screens use this instead of the desktop's trailing-lambda ListRow). */
@Composable
private fun AcListRow(title: String, sub: String?, action: (@Composable () -> Unit)?) {
    Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, fontSize = 15.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold)
            if (!sub.isNullOrEmpty()) Text(sub, color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp))
        }
        action?.invoke()
    }
}

/** Single text field bottom sheet — used for rename / create where the web shows window.prompt(). */
@Composable
private fun TextInputDialog(title: String, initial: String, confirmLabel: String, hint: String? = null, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var value by remember { mutableStateOf(initial) }
    SheetDialog(title, onDismiss) {
        if (!hint.isNullOrEmpty()) {
            Text(hint, color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(bottom = 8.dp))
        }
        Field("", value, { value = it }, fill = T2Colors.surface2)
        Spacer(Modifier.height(16.dp))
        MainButton(confirmLabel, enabled = true) { onConfirm(value) }
    }
}

/** Port of backend/frontend/src/pages/admin-center/sheet-import.ts. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun SheetImportTab(container: AppContainer) {
    val api = container.adminCenterApi
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<SheetImportPendingRow>?>(null) }
    var reload by remember { mutableStateOf(0) }
    var picks by remember { mutableStateOf<Map<Int, Int>>(emptyMap()) }
    var queries by remember { mutableStateOf<Map<Int, String>>(emptyMap()) }
    var results by remember { mutableStateOf<Map<Int, List<AcEmployeeHit>>>(emptyMap()) }

    LaunchedEffect(reload) {
        runCatching { api.sheetImportPending().items }
            .onSuccess { list ->
                items = list
                picks = list.mapNotNull { r -> r.candidate_employee_id?.let { r.id to it } }.toMap()
                queries = list.associate { it.id to (it.candidate_full_name ?: "") }
            }
            .onFailure { items = emptyList() }
    }

    PageSection("Импорт графика из Таблиц") {
        Text(
            "Строки, для которых имя из таблицы не совпало с сотрудником один-в-один. Точные совпадения применяются сами, сюда не попадают.",
            color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
        )
        val list = items
        when {
            list == null -> LoadingBlock(Modifier.padding(16.dp))
            list.isEmpty() -> EmptyText("Очередь пуста — всё сопоставлено")
            else -> list.forEach { row ->
                val scorePct = row.candidate_score?.let { (it * 100).toInt() }
                val candidateHint = if (row.candidate_full_name != null)
                    "Похоже на: ${row.candidate_full_name}" + (scorePct?.let { " ($it%)" } ?: "")
                else "Похожего сотрудника не нашлось"

                Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
                    Text("«${row.sheet_name_raw}» · ${row.work_date} · ${row.shift_raw ?: "—"}", fontSize = 14.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold)
                    Text("${row.store_name ?: "точка не указана"} · $candidateHint", color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp, bottom = 6.dp))

                    val query = queries[row.id] ?: ""
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.width(180.dp)) {
                            Field("", query, { v ->
                                queries = queries + (row.id to v)
                                picks = picks - row.id
                                scope.launch {
                                    kotlinx.coroutines.delay(250)
                                    if (queries[row.id] != v) return@launch
                                    if (v.trim().length < 2) { results = results + (row.id to emptyList()); return@launch }
                                    val found = runCatching { container.adminCenterApi.search(v.trim()).employees }.getOrDefault(emptyList())
                                    results = results + (row.id to found)
                                }
                            }, placeholder = "искать…", fill = T2Colors.surface2)
                        }
                        MChipButton("ОК") {
                            val employeeId = picks[row.id]
                            if (employeeId == null) {
                                T2Toast.show("Выберите сотрудника", true)
                            } else {
                                scope.launch {
                                    runCatching { api.confirmSheetImportPending(row.id, employeeId) }
                                        .onSuccess { T2Toast.show("Подтверждено, применено к графику"); reload++ }
                                        .onFailure { T2Toast.show("Ошибка подтверждения", true) }
                                }
                            }
                        }
                        MChipButton("×", danger = true) {
                            scope.launch {
                                runCatching { api.rejectSheetImportPending(row.id) }
                                    .onSuccess { T2Toast.show("Отклонено"); reload++ }
                                    .onFailure { T2Toast.show("Ошибка отклонения", true) }
                            }
                        }
                    }
                    val found = results[row.id].orEmpty()
                    if (found.isNotEmpty() && picks[row.id] == null) {
                        Row(modifier = Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            found.take(5).forEach { emp ->
                                MChipButton(emp.full_name) {
                                    picks = picks + (row.id to emp.id)
                                    queries = queries + (row.id to emp.full_name)
                                    results = results + (row.id to emptyList())
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

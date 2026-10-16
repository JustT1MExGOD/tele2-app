package ru.t2sales.miranda.ui.admin

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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
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
import ru.t2sales.miranda.ui.components.T2Toast
import ru.t2sales.shared.api.AcEmployeeHit
import ru.t2sales.shared.api.AdminCenterApi
import ru.t2sales.shared.api.MirandaApi
import ru.t2sales.shared.api.MirandaAvailableAccountRow
import ru.t2sales.shared.api.MirandaCorporateAccountListItem
import ru.t2sales.shared.api.MirandaPendingBindingRow
import ru.t2sales.shared.theme.T2Colors

/**
 * Porting the UX of backend/frontend/src/pages/admin-center/miranda-devices.ts:
 * (1) device-approval queue (approve requires fresh step-up, revoke doesn't),
 * (2) account-switch grant issuance (search admin by name via /admin/search,
 * pick a corporate account, grant), (3) accounts available to the current admin.
 */
@Composable
fun MirandaAdminScreen(mirandaApi: MirandaApi, adminCenterApi: AdminCenterApi) {
    val scope = rememberCoroutineScope()
    var pending by remember { mutableStateOf<List<MirandaPendingBindingRow>>(emptyList()) }
    var accounts by remember { mutableStateOf<List<MirandaCorporateAccountListItem>>(emptyList()) }
    var available by remember { mutableStateOf<List<MirandaAvailableAccountRow>>(emptyList()) }
    var stepUpTarget by remember { mutableStateOf<Int?>(null) }

    suspend fun loadPending() {
        pending = runCatching { mirandaApi.listPendingDevices().items }.getOrDefault(emptyList())
    }
    suspend fun loadAccounts() {
        accounts = runCatching { mirandaApi.listAllCorporateAccounts().items }.getOrDefault(emptyList())
    }
    suspend fun loadAvailable() {
        available = runCatching { mirandaApi.listAvailableAccounts().items }.getOrDefault(emptyList())
    }

    LaunchedEffect(Unit) {
        loadPending(); loadAccounts(); loadAvailable()
        while (true) {
            delay(20000)
            loadPending()
        }
    }

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        SectionTitle("Устройства Miranda — очередь подтверждения")
        if (pending.isEmpty()) {
            Empty("Нет устройств, ожидающих подтверждения")
        } else {
            pending.forEach { row ->
                PendingRow(
                    row = row,
                    onApprove = { stepUpTarget = row.binding_id },
                    onRevoke = {
                        scope.launch {
                            runCatching { mirandaApi.revokeDevice(row.binding_id) }
                                .onSuccess { T2Toast.show("Привязка отклонена", false); loadPending() }
                                .onFailure { T2Toast.show("Не удалось отклонить привязку", true) }
                        }
                    }
                )
            }
        }

        Spacer(Modifier.height(24.dp))
        SectionTitle("Корпоративные аккаунты — привязка к устройству")
        Text(
            "Точка/касса — пометьте «только одно устройство»: подтвердить второе одновременно " +
                "активное устройство для такого аккаунта нельзя, пока не отозвать прежнее. " +
                "Личный аккаунт сотрудника можно не ограничивать.",
            color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(bottom = 10.dp)
        )
        if (accounts.isEmpty()) {
            Empty("Корпоративных аккаунтов пока нет")
        } else {
            accounts.forEach { acc ->
                DeviceExclusiveRow(acc) { checked ->
                    scope.launch {
                        runCatching { mirandaApi.setAccountDeviceExclusive(acc.corporate_account_id, checked) }
                            .onSuccess { loadAccounts() }
                            .onFailure { T2Toast.show("Не удалось изменить настройку", true) }
                    }
                }
            }
        }

        Spacer(Modifier.height(24.dp))
        SectionTitle("Переключение аккаунтов — выдача гранта")
        GrantForm(adminCenterApi = adminCenterApi, accounts = accounts) { adminEmployeeId, corporateAccountId ->
            scope.launch {
                runCatching { mirandaApi.grantAdminAccount(adminEmployeeId, corporateAccountId) }
                    .onSuccess { T2Toast.show("Грант выдан", false); loadAvailable() }
                    .onFailure { T2Toast.show("Не удалось выдать грант", true) }
            }
        }

        Spacer(Modifier.height(24.dp))
        SectionTitle("Доступные вам аккаунты для переключения")
        if (available.isEmpty()) {
            Empty("Вам не выдано ни одного гранта на переключение")
        } else {
            available.forEach { acc ->
                AvailableAccountRow(acc)
            }
        }
    }

    val target = stepUpTarget
    if (target != null) {
        StepUpDialog(
            api = adminCenterApi,
            onDismiss = { stepUpTarget = null },
            onTicket = { ticket ->
                scope.launch {
                    runCatching { mirandaApi.approveDevice(target, ticket) }
                        .onSuccess { T2Toast.show("Устройство подтверждено", false); stepUpTarget = null; loadPending() }
                        .onFailure { err ->
                            val conflict = (err as? io.ktor.client.plugins.ResponseException)?.response?.status?.value == 409
                            T2Toast.show(
                                if (conflict) "Этот аккаунт уже привязан к другому устройству — сначала отозвать прежнюю привязку"
                                else "Не удалось подтвердить устройство",
                                true
                            )
                        }
                }
            }
        )
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = T2Colors.text, modifier = Modifier.padding(bottom = 10.dp))
}

@Composable
private fun Empty(text: String) {
    Text(text, fontSize = 13.sp, color = T2Colors.hint, modifier = Modifier.padding(bottom = 8.dp))
}

@Composable
private fun PendingRow(row: MirandaPendingBindingRow, onApprove: () -> Unit, onRevoke: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp).clip(shape).background(T2Colors.surface2)
            .border(1.dp, T2Colors.border, shape).padding(14.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                "${row.employee_full_name} · ${row.platform}" + (row.device_label?.let { " · $it" } ?: ""),
                color = T2Colors.text, fontWeight = FontWeight.SemiBold, fontSize = 14.sp
            )
            Spacer(Modifier.height(4.dp))
            Text("${row.store_id ?: "без точки"} · заявка от ${row.created_at}", color = T2Colors.hint, fontSize = 12.sp)
        }
        Row {
            MainButton("Подтвердить", enabled = true, onClick = onApprove)
            Spacer(Modifier.width(8.dp))
            MainButton("Отклонить", enabled = true, container = T2Colors.surface, content = T2Colors.text, onClick = onRevoke)
        }
    }
}

@Composable
private fun AvailableAccountRow(acc: MirandaAvailableAccountRow) {
    val shape = RoundedCornerShape(12.dp)
    Column(
        modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp).clip(shape).background(T2Colors.surface2)
            .border(1.dp, T2Colors.border, shape).padding(14.dp)
    ) {
        Text(acc.display_label ?: acc.employee_full_name, color = T2Colors.text, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
        Spacer(Modifier.height(4.dp))
        Text(
            (acc.store_id ?: "без точки") + if (acc.is_default_for_device) " · по умолчанию на этом устройстве" else "",
            color = T2Colors.hint, fontSize = 12.sp
        )
    }
}

@Composable
private fun DeviceExclusiveRow(acc: MirandaCorporateAccountListItem, onToggle: (Boolean) -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp).clip(shape).background(T2Colors.surface2)
            .border(1.dp, T2Colors.border, shape).padding(14.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                acc.display_label ?: "${acc.employee_full_name} · ${acc.store_id ?: "без точки"}",
                color = T2Colors.text, fontWeight = FontWeight.SemiBold, fontSize = 14.sp
            )
            Spacer(Modifier.height(4.dp))
            Text(acc.store_id ?: "без точки", color = T2Colors.hint, fontSize = 12.sp)
        }
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            androidx.compose.material.Checkbox(checked = acc.device_exclusive, onCheckedChange = onToggle)
            Text("только одно устройство", color = T2Colors.hint, fontSize = 12.sp)
        }
    }
}

@Composable
private fun GrantForm(
    adminCenterApi: AdminCenterApi,
    accounts: List<MirandaCorporateAccountListItem>,
    onGrant: (adminEmployeeId: Int, corporateAccountId: Int) -> Unit
) {
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<AcEmployeeHit>>(emptyList()) }
    var selectedAdmin by remember { mutableStateOf<AcEmployeeHit?>(null) }
    var selectedAccountId by remember { mutableStateOf<Int?>(null) }

    LaunchedEffect(query) {
        if (query.trim().length < 2) { results = emptyList(); return@LaunchedEffect }
        delay(250)
        results = runCatching { adminCenterApi.search(query.trim()).employees }.getOrDefault(emptyList())
    }

    Column {
        Field("Админ, которому выдать грант", query, { query = it; selectedAdmin = null }, placeholder = "Поиск по имени")
        selectedAdmin?.let { admin ->
            Spacer(Modifier.height(6.dp))
            Text("Выбран: ${admin.full_name} (#${admin.id})", color = T2Colors.hint, fontSize = 12.sp)
        }
        if (results.isNotEmpty() && selectedAdmin == null) {
            Spacer(Modifier.height(6.dp))
            results.forEach { emp ->
                val shape = RoundedCornerShape(10.dp)
                Box(
                    modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp).clip(shape).background(T2Colors.surface2)
                        .clickable { selectedAdmin = emp; query = ""; results = emptyList() }.padding(10.dp)
                ) {
                    Column {
                        Text(emp.full_name, color = T2Colors.text, fontWeight = FontWeight.Medium, fontSize = 13.sp)
                        Text(emp.role, color = T2Colors.hint, fontSize = 11.sp)
                    }
                }
            }
        }

        Spacer(Modifier.height(10.dp))
        Text("Корпоративный аккаунт", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = T2Colors.hint, modifier = Modifier.padding(bottom = 6.dp))
        if (accounts.isEmpty()) {
            Empty("Корпоративных аккаунтов пока нет")
        } else {
            LazyColumn(modifier = Modifier.fillMaxWidth().height(160.dp)) {
                items(accounts, key = { it.corporate_account_id }) { acc ->
                    val isSelected = selectedAccountId == acc.corporate_account_id
                    val shape = RoundedCornerShape(10.dp)
                    Box(
                        modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp).clip(shape)
                            .background(if (isSelected) T2Colors.primarySoft else T2Colors.surface2)
                            .clickable { selectedAccountId = acc.corporate_account_id }.padding(10.dp)
                    ) {
                        Text(
                            acc.display_label ?: "${acc.employee_full_name} · ${acc.store_id ?: "без точки"}",
                            color = T2Colors.text, fontSize = 13.sp
                        )
                    }
                }
            }
        }

        Spacer(Modifier.height(12.dp))
        MainButton("Выдать грант", enabled = true) {
            val admin = selectedAdmin
            val accountId = selectedAccountId
            when {
                admin == null -> T2Toast.show("Выберите администратора", true)
                accountId == null -> T2Toast.show("Выберите корпоративный аккаунт", true)
                else -> onGrant(admin.id, accountId)
            }
        }
    }
}

@Composable
private fun StepUpDialog(api: AdminCenterApi, onDismiss: () -> Unit, onTicket: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var code by remember { mutableStateOf("") }
    SheetDialog("Подтверждение MFA", onDismiss) {
        Text(
            "Подтверждение устройства требует свежего подтверждения через приложение-аутентификатор.",
            color = T2Colors.hint, fontSize = 14.sp, modifier = Modifier.padding(bottom = 12.dp)
        )
        Field("", code, { code = it }, placeholder = "Код из приложения", fill = T2Colors.surface2)
        Spacer(Modifier.height(16.dp))
        MainButton("Подтвердить", enabled = true) {
            if (code.isBlank()) {
                T2Toast.show("Введите код", true)
                return@MainButton
            }
            scope.launch {
                runCatching { api.issueStepUp(code.trim()) }
                    .onSuccess { onTicket(it) }
                    .onFailure { T2Toast.show("Неверный код", true) }
            }
        }
    }
}

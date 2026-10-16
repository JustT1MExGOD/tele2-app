package ru.t2sales.miranda.ui.device

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import ru.t2sales.miranda.ui.components.MainButton
import ru.t2sales.miranda.ui.components.SheetDialog
import ru.t2sales.shared.api.MirandaAvailableAccountRow
import ru.t2sales.shared.theme.T2Colors

/**
 * §3.3/§3.4: shown while the device binding is "pending" (waiting for
 * admin approval in the Admin Control Center / Miranda admin screen) or on
 * any activation error. Admins get an escape hatch: §3.4's account-switch
 * is independent of device-binding state (requireAdmin + an explicit grant
 * only), so an admin isn't blocked by their own device still being pending.
 */
@Composable
fun DeviceActivationScreen(
    viewModel: DeviceActivationViewModel,
    state: DeviceState,
    isAdmin: Boolean,
    onRetry: () -> Unit,
    onActive: (Int, String?) -> Unit
) {
    var showSwitcher by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Box(Modifier.fillMaxSize().background(T2Colors.bg), contentAlignment = Alignment.Center) {
        Column(
            modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            when (state) {
                is DeviceState.Pending -> {
                    Text("⏳", fontSize = 40.sp)
                    Spacer(Modifier.height(12.dp))
                    Text("Ожидаем подтверждения", fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, color = T2Colors.text)
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Это устройство ожидает одобрения администратора в Admin Control Center.",
                        fontSize = 14.sp, color = T2Colors.hint
                    )
                    Spacer(Modifier.height(20.dp))
                    MainButton("Проверить снова", enabled = true, onClick = onRetry)
                    if (isAdmin) {
                        Spacer(Modifier.height(12.dp))
                        MainButton("Войти под другим аккаунтом", enabled = true, container = T2Colors.surface2, content = T2Colors.text) {
                            showSwitcher = true
                        }
                    }
                }

                is DeviceState.Error -> {
                    Text("⚠️", fontSize = 40.sp)
                    Spacer(Modifier.height(12.dp))
                    Text("Не удалось активировать устройство", fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, color = T2Colors.text)
                    Spacer(Modifier.height(8.dp))
                    Text(state.message, fontSize = 14.sp, color = T2Colors.danger)
                    Spacer(Modifier.height(20.dp))
                    MainButton("Повторить", enabled = true, onClick = onRetry)
                }

                else -> {
                    Text("Проверяем устройство…", fontSize = 16.sp, color = T2Colors.hint)
                }
            }
        }
    }

    if (showSwitcher) {
        AccountSwitcherDialog(
            viewModel = viewModel,
            onDismiss = { showSwitcher = false },
            onPicked = { account ->
                scope.launch {
                    if (viewModel.switchTo(account.corporate_account_id)) {
                        showSwitcher = false
                        onActive(account.corporate_account_id, account.display_label ?: account.employee_full_name)
                    }
                }
            }
        )
    }
}

@Composable
private fun AccountSwitcherDialog(
    viewModel: DeviceActivationViewModel,
    onDismiss: () -> Unit,
    onPicked: (MirandaAvailableAccountRow) -> Unit
) {
    var items by remember { mutableStateOf<List<MirandaAvailableAccountRow>>(emptyList()) }
    LaunchedEffect(Unit) { items = viewModel.listAvailableAccountsForSwitch() }

    SheetDialog("Переключение аккаунта", onDismiss) {
        if (items.isEmpty()) {
            Text("Вам не выдано ни одного гранта на переключение.", color = T2Colors.hint, fontSize = 14.sp)
        } else {
            items.forEach { acc ->
                val shape = RoundedCornerShape(14.dp)
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 8.dp)
                        .clip(shape)
                        .background(T2Colors.surface2)
                        .padding(14.dp)
                ) {
                    Column {
                        Text(acc.display_label ?: acc.employee_full_name, color = T2Colors.text, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(4.dp))
                        Text(acc.store_id ?: "без точки", color = T2Colors.hint, fontSize = 12.sp)
                        Spacer(Modifier.height(10.dp))
                        MainButton("Выбрать", enabled = true) { onPicked(acc) }
                    }
                }
            }
        }
    }
}

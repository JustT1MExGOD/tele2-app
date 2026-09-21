package ru.t2sales.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.t2sales.shared.api.CreateStoreRequest
import ru.t2sales.shared.theme.T2Colors

private val ROLE_LABELS = mapOf(
    "trainee" to "Стажёр", "employee" to "Продавец", "senior" to "Старший продавец",
    "manager" to "Руководитель", "supervisor" to "Супервайзер", "admin" to "Администратор"
)
private fun roleName(role: String) = ROLE_LABELS[role] ?: role.ifBlank { "Продавец" }

/** The forms behind «Добавить сотрудника» / «Добавить точку» of the team page's "Управление" block. */
@Composable
fun AddEmployeeSheet(roles: List<String>, onDismiss: () -> Unit, onCreate: (String, String) -> Unit) {
    var name by remember { mutableStateOf("") }
    var role by remember { mutableStateOf(if ("employee" in roles) "employee" else roles.first()) }
    var error by remember { mutableStateOf<String?>(null) }
    BottomSheet("Новый сотрудник", onDismiss = onDismiss, footer = {
        MainButton("Создать") { if (name.isBlank()) error = "Укажите ФИО" else onCreate(name.trim(), role) }
    }) {
        Field("ФИО", name, { name = it })
        Spacer(Modifier.height(16.dp))
        SelectField("Роль", roleName(role), roles.map(::roleName)) { picked -> roles.firstOrNull { roleName(it) == picked }?.let { role = it } }
        error?.let { Text(it, color = T2Colors.danger, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp)) }
    }
}

@Composable
fun AddStoreSheet(onDismiss: () -> Unit, onCreate: (CreateStoreRequest) -> Unit) {
    var id by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var color by remember { mutableStateOf("#6d9eeb") }
    var workTime by remember { mutableStateOf("10-21") }
    var hours by remember { mutableStateOf("11") }
    var openTime by remember { mutableStateOf("09:00") }
    var closeTime by remember { mutableStateOf("21:00") }
    var allDay by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    BottomSheet("Новая точка", onDismiss = onDismiss, footer = {
        MainButton("Создать") {
            if (id.isBlank() || name.isBlank()) error = "ID и название обязательны"
            else onCreate(
                CreateStoreRequest(
                    id = id.trim(), name = name.trim(), code = code.trim(), color = color.trim(),
                    work_time = if (allDay) "круглосуточно" else workTime.trim().ifEmpty { null },
                    hours = if (allDay) 24 else (hours.toIntOrNull() ?: 11),
                    close_time_weekday = closeTime.trim().ifEmpty { null }, close_time_sunday = closeTime.trim().ifEmpty { null },
                    open_time_weekday = openTime.trim().ifEmpty { null }, open_time_sunday = openTime.trim().ifEmpty { null }
                )
            )
        }
    }) {
        Field("ID (латиница)", id, { id = it }); Spacer(Modifier.height(12.dp))
        Field("Название", name, { name = it }); Spacer(Modifier.height(12.dp))
        Field("Код", code, { code = it }); Spacer(Modifier.height(12.dp))
        Field("Цвет", color, { color = it }); Spacer(Modifier.height(12.dp))
        if (!allDay) {
            Field("Часы работы (например 10-21)", workTime, { workTime = it }); Spacer(Modifier.height(12.dp))
            Field("Часов в смене", hours, { hours = it.filter(Char::isDigit).take(2) }, keyboard = KeyboardType.Number); Spacer(Modifier.height(12.dp))
        }
        Field("Время открытия", openTime, { openTime = it }); Spacer(Modifier.height(12.dp))
        Field("Время итога дня", closeTime, { closeTime = it }); Spacer(Modifier.height(12.dp))
        Row(Modifier.clip(RoundedCornerShape(8.dp)).clickable { allDay = !allDay }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(if (allDay) "☑" else "☐", fontSize = 20.sp, color = T2Colors.primary)
            Spacer(Modifier.width(8.dp))
            Text("Круглосуточно")
        }
        error?.let { Text(it, color = T2Colors.danger, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp)) }
    }
}

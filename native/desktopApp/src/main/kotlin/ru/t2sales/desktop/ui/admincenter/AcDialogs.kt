package ru.t2sales.desktop.ui.admincenter

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import ru.t2sales.desktop.ui.components.Field
import ru.t2sales.desktop.ui.components.MainButton
import ru.t2sales.desktop.ui.components.SheetDialog
import ru.t2sales.desktop.ui.components.T2Toast
import ru.t2sales.shared.api.AdminCenterApi
import ru.t2sales.shared.theme.T2Colors

/** confirmDangerousAction from admin-center/shared/dialogs: description + mandatory reason. */
@Composable
fun DangerDialog(title: String, description: String, confirmLabel: String = "Подтвердить", preview: String? = null, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var reason by remember { mutableStateOf("") }
    SheetDialog(title, onDismiss) {
        Text(description, color = T2Colors.hint, fontSize = 14.sp, modifier = Modifier.padding(bottom = 12.dp))
        if (!preview.isNullOrEmpty()) {
            Text(
                preview, fontSize = 12.sp, fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp).background(T2Colors.surface2, androidx.compose.foundation.shape.RoundedCornerShape(8.dp)).padding(10.dp)
            )
        }
        Field("", reason, { reason = it }, placeholder = "Причина (обязательно)", fill = T2Colors.surface2)
        Spacer(Modifier.height(16.dp))
        MainButton(confirmLabel, enabled = true) {
            if (reason.isBlank()) T2Toast.show("Укажите причину", true) else onConfirm(reason.trim())
        }
    }
}

/** requestStepUpTicket: TOTP code -> step-up ticket via POST /auth/mfa/step-up. */
@Composable
fun StepUpDialog(api: AdminCenterApi, onDismiss: () -> Unit, onTicket: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var code by remember { mutableStateOf("") }
    SheetDialog("Подтверждение MFA", onDismiss) {
        Text("Это опасное действие требует свежего подтверждения через приложение-аутентификатор.", color = T2Colors.hint, fontSize = 14.sp, modifier = Modifier.padding(bottom = 12.dp))
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

/** promptMetricCorrection: new numeric value + mandatory reason. */
@Composable
fun MetricCorrectionDialog(label: String, currentValue: Double, onDismiss: () -> Unit, onSave: (Double, String) -> Unit) {
    var value by remember { mutableStateOf(if (currentValue % 1.0 == 0.0) currentValue.toLong().toString() else currentValue.toString()) }
    var reason by remember { mutableStateOf("") }
    SheetDialog("Изменить метрику: $label", onDismiss) {
        Field("Новое значение", value, { v -> value = v.filter { it.isDigit() || it == '.' } }, fill = T2Colors.surface2)
        Spacer(Modifier.height(14.dp))
        Field("", reason, { reason = it }, placeholder = "Причина (обязательно)", fill = T2Colors.surface2)
        Spacer(Modifier.height(16.dp))
        MainButton("Сохранить", enabled = true) {
            val v = value.toDoubleOrNull()
            when {
                v == null || v < 0 -> T2Toast.show("Укажите корректное значение", true)
                reason.isBlank() -> T2Toast.show("Укажите причину", true)
                else -> onSave(v, reason.trim())
            }
        }
    }
}

/** promptFieldCorrection: N labelled fields (select / date / number / text) + mandatory reason. */
class CorrectionField(val id: String, val label: String, val kind: String, val value: String = "", val options: List<Pair<String, String>> = emptyList())

@Composable
fun FieldCorrectionDialog(title: String, fields: List<CorrectionField>, confirmLabel: String = "Сохранить", onDismiss: () -> Unit, onSave: (Map<String, String>, String) -> Unit) {
    val values = remember { androidx.compose.runtime.mutableStateMapOf<String, String>().also { m -> fields.forEach { m[it.id] = it.value } } }
    var reason by remember { mutableStateOf("") }
    SheetDialog(title, onDismiss) {
        fields.forEach { f ->
            if (f.kind == "select") {
                ru.t2sales.desktop.ui.components.SelectField(f.label, f.options.firstOrNull { it.first == values[f.id] }?.second ?: "", f.options.map { it.second }) { picked ->
                    f.options.firstOrNull { it.second == picked }?.let { values[f.id] = it.first }
                }
            } else {
                Field(f.label, values[f.id] ?: "", { v -> values[f.id] = if (f.kind == "number") v.filter { it.isDigit() || it == '.' } else v }, placeholder = if (f.kind == "date") "ГГГГ-ММ-ДД" else "", fill = T2Colors.surface2)
            }
            Spacer(Modifier.height(14.dp))
        }
        Field("", reason, { reason = it }, placeholder = "Причина (обязательно)", fill = T2Colors.surface2)
        Spacer(Modifier.height(16.dp))
        MainButton(confirmLabel, enabled = true) {
            if (reason.isBlank()) T2Toast.show("Укажите причину", true) else onSave(values.toMap(), reason.trim())
        }
    }
}

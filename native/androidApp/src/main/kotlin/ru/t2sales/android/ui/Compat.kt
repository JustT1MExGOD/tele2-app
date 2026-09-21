package ru.t2sales.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.ui.composed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.DropdownMenu
import androidx.compose.material.DropdownMenuItem
import androidx.compose.material.MaterialTheme
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.t2sales.shared.api.TeamApi
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Radius

/*
 * The building blocks of the PC client's screens under the same names, so the screens ported from it (tasks, cash, alerts, ...) keep
 * their code and only their layout is adapted to a phone. Sheets are bottom sheets, selects are dropdown menus, fields are the web's
 * .field with the label above.
 */

@Composable
fun FieldLabel(label: String) {
    Text(label.uppercase(), fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.6.sp, color = T2Colors.hint, modifier = Modifier.padding(bottom = 6.dp))
}

/** Input-shaped box that opens something on click (dropdown trigger). */
@Composable
fun FieldBox(onClick: () -> Unit, content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(14.dp)
    Box(Modifier.fillMaxWidth().clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape).clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 14.dp)) { content() }
}

@Composable
fun Field(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    password: Boolean = false,
    fill: Color? = null,
    numeric: Boolean = false,
    placeholder: String = "",
    keyboard: KeyboardType = KeyboardType.Text
) {
    var focused by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth()) {
        FieldLabel(label)
        val shape = RoundedCornerShape(14.dp)
        BasicTextField(
            value = value,
            onValueChange = onChange,
            singleLine = true,
            textStyle = TextStyle(color = T2Colors.text, fontSize = 16.sp),
            cursorBrush = SolidColor(T2Colors.primary),
            visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = when { password -> KeyboardType.Password; numeric -> KeyboardType.Number; else -> keyboard }),
            decorationBox = { inner -> Box { if (value.isEmpty() && placeholder.isNotEmpty()) Text(placeholder, color = T2Colors.hint, fontSize = 16.sp); inner() } },
            modifier = Modifier.fillMaxWidth().onFocusChanged { focused = it.isFocused }.clip(shape).background(fill ?: T2Colors.surface2)
                .border(if (focused) 2.dp else 1.dp, if (focused) T2Colors.primary else T2Colors.border, shape).padding(horizontal = 16.dp, vertical = 14.dp)
        )
    }
}

/** The web's .main-btn: full width, radius 14, the accent colour. */
@Composable
fun MainButton(text: String, enabled: Boolean = true, container: Color? = null, content: Color? = null, onClick: () -> Unit) {
    Box(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background((container ?: T2Colors.accent).copy(alpha = if (enabled) 1f else 0.5f))
            .bouncyClickable(enabled = enabled, onClick = onClick).padding(vertical = 14.dp),
        contentAlignment = Alignment.Center
    ) { Text(text, color = content ?: T2Colors.onAccent, fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.body1) }
}

/** One row of a [DropdownField]. [key] identifies it (defaults to the label); [color] tints special rows such as "Замена". */
class DropdownItem(val label: String, val key: Any = label, val color: Color? = null)

@Composable
fun DropdownField(value: String, options: List<DropdownItem>, selected: Any? = null, enabled: Boolean = true, valueColor: Color? = null, onPick: (DropdownItem) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxWidth()) {
        FieldBox(onClick = { if (enabled) open = true }) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(value, fontSize = 16.sp, color = valueColor ?: if (enabled) T2Colors.text else T2Colors.hint, modifier = Modifier.weight(1f))
                if (enabled) Text("▾", color = T2Colors.hint, fontSize = 14.sp)
            }
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, modifier = Modifier.background(T2Colors.surface).heightIn(max = 360.dp)) {
            if (options.isEmpty()) Text("Нет вариантов", color = T2Colors.hint, modifier = Modifier.padding(16.dp))
            options.forEach { item ->
                val on = item.key == selected || (selected == null && item.label == value)
                DropdownMenuItem(onClick = { open = false; onPick(item) }) {
                    Text(item.label, color = item.color ?: T2Colors.text, fontWeight = if (on) FontWeight.Bold else FontWeight.Medium, fontSize = 15.sp)
                }
            }
        }
    }
}

/** Convenience overload for plain string options. */
@Composable
fun DropdownField(value: String, options: List<String>, enabled: Boolean = true, onPick: (String) -> Unit) =
    DropdownField(value, options.map { DropdownItem(it) }, selected = value, enabled = enabled) { onPick(it.label) }

@Composable
fun SelectField(label: String, value: String, options: List<String>, onPick: (String) -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        if (label.isNotEmpty()) FieldLabel(label)
        DropdownField(value, options, onPick = onPick)
    }
}

/** The web's .section: surface card, radius 20, border, uppercase title. */
@Composable
fun PageSection(title: String?, content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(T2Radius.default)
    Column(Modifier.fillMaxWidth().clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape).padding(vertical = 6.dp)) {
        if (title != null) {
            Text(title.uppercase(), color = T2Colors.hint, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.7.sp, modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 8.dp))
        }
        content()
    }
}

/** The web's .mchip button. */
@Composable
fun MChipButton(label: String, danger: Boolean = false, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Text(
        label, color = if (danger) T2Colors.danger else T2Colors.text, fontWeight = FontWeight.Bold, fontSize = 13.sp,
        modifier = modifier.clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape).bouncyClickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 12.dp)
    )
}

/** The web's .sheet-modal as a bottom sheet: title, scrolling body. */
@Composable
fun SheetDialog(title: String, onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    BottomSheet(title, onDismiss = onDismiss) { Column { content() } }
}

/** The employee's photo (or the first letter); the PC client's signature, for the ported screens. */
@Composable
fun AvatarImage(teamApi: TeamApi, employeeId: Int?, fallback: String, size: androidx.compose.ui.unit.Dp = 36.dp, active: Boolean = false) {
    val bitmap by androidx.compose.runtime.produceState<androidx.compose.ui.graphics.ImageBitmap?>(null, employeeId) {
        value = employeeId?.let { id ->
            teamApi.getAvatar(id)?.let { bytes -> runCatching { android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap() }.getOrNull() }
        }
    }
    val border = if (active) T2Colors.success else T2Colors.border
    Box(
        Modifier.size(size).clip(androidx.compose.foundation.shape.CircleShape).background(if (active) T2Colors.successSoft else T2Colors.surface2).border(1.dp, border, androidx.compose.foundation.shape.CircleShape),
        contentAlignment = Alignment.Center
    ) {
        val bmp = bitmap
        if (bmp != null) androidx.compose.foundation.Image(bmp, contentDescription = null, contentScale = androidx.compose.ui.layout.ContentScale.Crop, modifier = Modifier.size(size))
        else Text(fallback, fontWeight = FontWeight.Bold, color = if (active) T2Colors.success else T2Colors.text)
    }
}

@Composable
fun ConfirmDialog(title: String, text: String, confirmLabel: String, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    BottomSheet(title, onDismiss = onDismiss, footer = { MainButton(confirmLabel, onClick = onConfirm) }) {
        Text(text, color = T2Colors.hint, fontSize = 14.sp)
    }
}

/** A table that keeps a readable width and scrolls sideways on a phone (the PC client's tables are laid out for a wide window). */
@Composable
fun WideTable(minWidth: androidx.compose.ui.unit.Dp, content: @Composable ColumnScope.() -> Unit) {
    Box(Modifier.androidx_horizontalScroll()) { Column(Modifier.width(minWidth)) { content() } }
}

private fun Modifier.androidx_horizontalScroll(): Modifier = composed { this.horizontalScroll(rememberScrollState()) }

package ru.t2sales.desktop.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.hoverable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.t2sales.shared.theme.T2Colors

/** Web-style form controls (.gate-card .field / .btn-main in styles.css). */
@Composable
fun FieldLabel(label: String) {
    Text(
        label.uppercase(),
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = 0.6.sp,
        color = T2Colors.hint,
        modifier = Modifier.padding(bottom = 6.dp)
    )
}

/** Input-shaped box that opens something on click (dropdown trigger). */
@Composable
fun FieldBox(onClick: () -> Unit, content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(14.dp)
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(T2Colors.surface2)
            .border(1.dp, T2Colors.border, shape)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp)
    ) { content() }
}

@Composable
fun Field(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    password: Boolean = false,
    fill: Color? = null,
    numeric: Boolean = false,
    placeholder: String = ""
) {
    var focused by remember { mutableStateOf(false) }
    Column(modifier = Modifier.fillMaxWidth()) {
        Text(
            label.uppercase(),
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 0.6.sp,
            color = T2Colors.hint,
            modifier = Modifier.padding(bottom = 6.dp)
        )
        val shape = RoundedCornerShape(14.dp)
        BasicTextField(
            value = value,
            onValueChange = onChange,
            singleLine = true,
            textStyle = TextStyle(color = T2Colors.text, fontSize = 16.sp),
            cursorBrush = SolidColor(T2Colors.primary),
            visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions.Default,
            decorationBox = { inner ->
                Box {
                    if (value.isEmpty() && placeholder.isNotEmpty()) Text(placeholder, color = T2Colors.hint, fontSize = 16.sp)
                    inner()
                }
            },
            modifier = Modifier
                .fillMaxWidth()
                .onFocusChanged { focused = it.isFocused }
                .clip(shape)
                .background(fill ?: T2Colors.surface)
                .border(if (focused) 2.dp else 1.dp, if (focused) T2Colors.primary else T2Colors.border, shape)
                .padding(horizontal = 16.dp, vertical = 14.dp)
        )
    }
}

@Composable
fun MainButton(text: String, enabled: Boolean, container: Color? = null, content: Color? = null, onClick: () -> Unit) {
    val source = remember { MutableInteractionSource() }
    val hovered by source.collectIsHoveredAsState()
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed && enabled) 0.97f else 1f, pressSpring())
    val hover by animateFloatAsState(if (hovered && enabled) 0.12f else 0f)
    val base = (container ?: T2Colors.accent).copy(alpha = if (enabled) 1f else 0.5f)
    Box(
        modifier = Modifier
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(lerp(base, T2Colors.primary, hover))
            .hoverable(source)
            .clickable(interactionSource = source, indication = LocalIndication.current, enabled = enabled, onClick = onClick)
            .padding(vertical = 14.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(text, color = content ?: T2Colors.onAccent, fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.body1)
    }
}


/** Dropdown styled like the web's select fields. */
@Composable
fun SelectField(label: String, value: String, options: List<String>, onPick: (String) -> Unit) {
    Column(modifier = Modifier.fillMaxWidth()) {
        if (label.isNotEmpty()) FieldLabel(label)
        DropdownField(value, options, onPick = onPick)
    }
}

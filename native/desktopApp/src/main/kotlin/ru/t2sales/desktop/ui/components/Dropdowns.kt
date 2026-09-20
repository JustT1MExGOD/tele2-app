package ru.t2sales.desktop.ui.components

import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.focusable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.hoverable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.Icon
import androidx.compose.material.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import ru.t2sales.shared.theme.T2Colors

/** One row of a [DropdownField]. [key] identifies it (defaults to the label); [color] tints special rows such as "Замена". */
class DropdownItem(val label: String, val key: Any = label, val color: Color? = null)

/**
 * The app's select: a field-shaped trigger with a chevron, and a menu that opens right under it at the field's own width
 * (rounded, shadowed, hover highlight, tick on the current value) - instead of Material's narrow floating default.
 */
@Composable
fun DropdownField(
    value: String,
    options: List<DropdownItem>,
    selected: Any? = null,
    enabled: Boolean = true,
    valueColor: Color? = null,
    onPick: (DropdownItem) -> Unit
) {
    var open by remember { mutableStateOf(false) }
    var active by remember { mutableStateOf(0) }
    var size by remember { mutableStateOf(androidx.compose.ui.unit.IntSize.Zero) }
    val chevron by animateFloatAsState(if (open) 180f else 0f, tween(200))
    Box(Modifier.fillMaxWidth().onSizeChanged { size = it }) {
        FieldBox(onClick = {
            if (enabled) {
                // opening: the keyboard cursor starts on the current value
                if (!open) active = options.indexOfFirst { it.key == selected || (selected == null && it.label == value) }.coerceAtLeast(0)
                open = !open
            }
        }) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(value, fontSize = 16.sp, color = valueColor ?: if (enabled) T2Colors.text else T2Colors.hint, modifier = Modifier.weight(1f))
                Icon(Icons.Outlined.KeyboardArrowDown, null, tint = T2Colors.hint, modifier = Modifier.graphicsLayer { rotationZ = chevron })
            }
        }
        if (open) {
            val gap = with(LocalDensity.current) { 6.dp.roundToPx() }
            MenuPopup(
                alignment = Alignment.TopStart,
                offset = IntOffset(0, size.height + gap),
                width = with(LocalDensity.current) { size.width.toDp() },
                onDismiss = { open = false },
                onKey = { ev ->
                    if (ev.type != KeyEventType.KeyDown || options.isEmpty()) false else when (ev.key) {
                        Key.DirectionDown -> { active = (active + 1) % options.size; true }
                        Key.DirectionUp -> { active = (active - 1 + options.size) % options.size; true }
                        Key.Enter, Key.NumPadEnter -> { open = false; onPick(options[active.coerceIn(0, options.lastIndex)]); true }
                        else -> false
                    }
                }
            ) {
                if (options.isEmpty()) Text("Нет вариантов", color = T2Colors.hint, modifier = Modifier.padding(16.dp))
                options.forEachIndexed { i, item ->
                    MenuRow(item, item.key == selected || (selected == null && item.label == value), active = i == active, onHover = { active = i }) { open = false; onPick(item) }
                }
            }
        }
    }
}

/** Convenience overload for plain string options. */
@Composable
fun DropdownField(value: String, options: List<String>, enabled: Boolean = true, onPick: (String) -> Unit) =
    DropdownField(value, options.map { DropdownItem(it) }, selected = value, enabled = enabled) { onPick(it.label) }

/** A floating panel anchored to its parent (network status etc.): same look as the dropdown menu, any content inside. */
@Composable
fun PopoverPanel(anchorHeightPx: Int, onDismiss: () -> Unit, alignment: Alignment = Alignment.TopEnd, width: androidx.compose.ui.unit.Dp = 300.dp, content: @Composable () -> Unit) {
    val gap = with(LocalDensity.current) { 8.dp.roundToPx() }
    MenuPopup(alignment = alignment, offset = IntOffset(0, anchorHeightPx + gap), width = width, onDismiss = onDismiss) { content() }
}

@Composable
private fun MenuPopup(
    alignment: Alignment,
    offset: IntOffset,
    width: androidx.compose.ui.unit.Dp?,
    minWidth: androidx.compose.ui.unit.Dp = 0.dp,
    onDismiss: () -> Unit,
    onKey: ((KeyEvent) -> Boolean)? = null,
    content: @Composable () -> Unit
) {
    val shape = RoundedCornerShape(16.dp)
    val focus = remember { FocusRequester() }
    val enter = remember { Animatable(0f) }
    LaunchedEffect(Unit) { enter.animateTo(1f, tween(Motion.MenuMs, easing = Motion.Emphasized)) }
    Popup(alignment = alignment, offset = offset, onDismissRequest = onDismiss, properties = PopupProperties(focusable = true)) {
        // inside the popup: only here is the requester attached to a node
        LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
        Column(
            Modifier
                .then(if (width != null) Modifier.width(width) else Modifier.widthIn(min = minWidth))
                .focusRequester(focus)
                .onPreviewKeyEvent { onKey?.invoke(it) ?: false }
                .focusable()
                .graphicsLayer {
                    alpha = enter.value
                    translationY = (1f - enter.value) * -8.dp.toPx()
                    scaleY = 0.94f + 0.06f * enter.value
                    transformOrigin = TransformOrigin(0.5f, 0f)
                }
                .shadow(16.dp, shape, ambientColor = Color.Black.copy(alpha = 0.25f), spotColor = Color.Black.copy(alpha = 0.25f))
                .clip(shape)
                .background(T2Colors.surface)
                .border(1.dp, T2Colors.border, shape)
                .heightIn(max = 320.dp)
                .verticalScroll(rememberScrollState())
                .padding(6.dp)
        ) { content() }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun MenuRow(item: DropdownItem, isSelected: Boolean, active: Boolean, onHover: () -> Unit, onClick: () -> Unit) {
    val source = remember { MutableInteractionSource() }
    val hovered by source.collectIsHoveredAsState()
    LaunchedEffect(hovered) { if (hovered) onHover() }
    val visible = remember { BringIntoViewRequester() }
    LaunchedEffect(active) { if (active) visible.bringIntoView() }
    val bg by animateColorAsState(
        when {
            isSelected -> T2Colors.primarySoft
            active -> T2Colors.surface2
            else -> Color.Transparent
        },
        tween(120)
    )
    Row(
        Modifier.fillMaxWidth().bringIntoViewRequester(visible).clip(RoundedCornerShape(10.dp)).background(bg)
            .hoverable(source)
            .clickable(interactionSource = source, indication = null, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            item.label,
            fontSize = 15.sp,
            fontWeight = if (isSelected || item.color != null) FontWeight.SemiBold else FontWeight.Normal,
            color = item.color ?: if (isSelected) T2Colors.primary else T2Colors.text,
            modifier = Modifier.weight(1f)
        )
        if (isSelected) Text("✓", color = T2Colors.primary, fontSize = 15.sp, fontWeight = FontWeight.Bold)
    }
}

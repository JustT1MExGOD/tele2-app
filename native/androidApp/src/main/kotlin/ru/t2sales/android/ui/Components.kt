package ru.t2sales.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.graphics.graphicsLayer
import kotlinx.coroutines.launch
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.MaterialTheme
import androidx.compose.material.OutlinedTextField
import androidx.compose.material.Text
import androidx.compose.material.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Radius
import ru.t2sales.shared.theme.T2Spacing

/** Waiting for the first answer of the server (the session check): the background of the app, nothing else. */
@Composable
fun SplashBox() {
    Box(Modifier.fillMaxSize().background(T2Colors.bg))
}

/** The web's .section: a surface card, radius 20, hairline border, an uppercase title. */
@Composable
fun Section(title: String, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(T2Radius.default)
    Column(modifier.fillMaxWidth().clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape).padding(vertical = 6.dp)) {
        Text(
            title.uppercase(),
            color = T2Colors.hint,
            fontWeight = FontWeight.Bold,
            fontSize = 11.sp,
            letterSpacing = 0.7.sp,
            modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 8.dp)
        )
        content()
    }
}

/** The web's .row: a 42dp icon tile, title + sub, an optional value and chevron. */
@Composable
fun ListRow(iconText: String, title: String, sub: String?, value: String? = null, chevron: Boolean = true, onClick: (() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().let { if (onClick != null) it.bouncyClickable(to = 0.985f, onClick = onClick) else it }.padding(horizontal = 16.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        val shape = RoundedCornerShape(T2Radius.sm)
        Box(Modifier.size(42.dp).clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape), contentAlignment = Alignment.Center) {
            Text(iconText, color = T2Colors.textSecondary, fontSize = 16.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.width(T2Spacing.sp3))
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
            if (sub != null) Text(sub, color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp))
        }
        if (value != null) Text(value, fontSize = 15.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 8.dp))
        if (chevron) Text("›", color = T2Colors.hint, fontSize = 18.sp, modifier = Modifier.padding(start = 8.dp))
    }
}

/** The same row, with the web's own vector icon (from [NavIcons]) instead of a text glyph tile — used wherever the web has a real `<svg>` for this row. */
@Composable
fun ListRow(icon: androidx.compose.ui.graphics.Path, title: String, sub: String?, value: String? = null, chevron: Boolean = true, onClick: (() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().let { if (onClick != null) it.bouncyClickable(to = 0.985f, onClick = onClick) else it }.padding(horizontal = 16.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        val shape = RoundedCornerShape(T2Radius.sm)
        Box(Modifier.size(42.dp).clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape), contentAlignment = Alignment.Center) {
            NavIcon(icon, contentDescription = title, tint = T2Colors.textSecondary, size = 20.dp)
        }
        Spacer(Modifier.width(T2Spacing.sp3))
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
            if (sub != null) Text(sub, color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp))
        }
        if (value != null) Text(value, fontSize = 15.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 8.dp))
        if (chevron) Text("›", color = T2Colors.hint, fontSize = 18.sp, modifier = Modifier.padding(start = 8.dp))
    }
}

/** One open sheet: its content is drawn by [SheetLayer] at the root of the app, so it covers the bottom navigation and the "+" button. */
class SheetEntry {
    var content by androidx.compose.runtime.mutableStateOf<@Composable () -> Unit>({})
}

object SheetStack {
    val items = androidx.compose.runtime.mutableStateListOf<SheetEntry>()
}

/** Draws every open sheet; placed once, last, in the root box of the shell. */
@Composable
fun SheetLayer() {
    SheetStack.items.toList().forEach { entry -> androidx.compose.runtime.key(entry) { entry.content() } }
}

/**
 * A sheet that rises from the bottom over a dimmed screen (the web's .modal): handle, title, scrolling body, an optional pinned footer.
 * It is drawn by [SheetLayer] inside the app's own layout, not in a separate dialog window: the window insets (gesture bar, keyboard)
 * apply the same way as for the bottom navigation, whichever screen opened it. Back closes it.
 */
@Composable
fun BottomSheet(title: String, busy: Boolean = false, onDismiss: () -> Unit, footer: (@Composable () -> Unit)? = null, content: @Composable () -> Unit) {
    val entry = remember { SheetEntry() }
    androidx.compose.runtime.SideEffect { entry.content = { SheetSurface(title, busy, onDismiss, footer, content) } }
    androidx.compose.runtime.DisposableEffect(entry) {
        SheetStack.items.add(entry)
        onDispose { SheetStack.items.remove(entry) }
    }
}

@Composable
private fun SheetSurface(title: String, busy: Boolean, onDismiss: () -> Unit, footer: (@Composable () -> Unit)?, content: @Composable () -> Unit) {
    // the sheet rises from the bottom over a scrim that fades in; closing by the user plays it backwards
    val progress = remember { androidx.compose.animation.core.Animatable(0f) }
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    androidx.compose.runtime.LaunchedEffect(Unit) { progress.animateTo(1f, androidx.compose.animation.core.tween(Motion.DialogMs + 40, easing = Motion.Emphasized)) }
    fun close() {
        scope.launch {
            progress.animateTo(0f, androidx.compose.animation.core.tween(180))
            onDismiss()
        }
    }
    androidx.activity.compose.BackHandler(enabled = !busy) { close() }

    // drag-to-dismiss: dragging the handle/title down (the web app's own gesture on its sheet-modal) follows the finger,
    // then either springs back or finishes the dismiss, matching the tap-outside-to-close that already existed
    val density = androidx.compose.ui.platform.LocalDensity.current
    var dragPx by remember { mutableStateOf(0f) }
    val dismissThresholdPx = with(density) { 120.dp.toPx() }
    val draggableState = androidx.compose.foundation.gestures.rememberDraggableState { delta -> if (!busy) dragPx = (dragPx + delta).coerceAtLeast(0f) }

    Box(
        Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color(0x99000000).copy(alpha = 0.6f * progress.value * (1f - (dragPx / (dismissThresholdPx * 3f)).coerceIn(0f, 1f))))
            .clickable(enabled = !busy, indication = null, interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }) { close() },
        contentAlignment = Alignment.BottomCenter
    ) {
        val shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)
        Column(
            Modifier.fillMaxWidth().statusBarsPadding().padding(top = 24.dp).heightIn(max = 720.dp)
                .graphicsLayer { translationY = (1f - progress.value) * size.height * 0.35f + dragPx; alpha = progress.value.coerceIn(0f, 1f) }
                .clip(shape).background(T2Colors.surface)
                .clickable(enabled = false) {}.navigationBarsPadding().imePadding().padding(horizontal = 16.dp)
        ) {
            Column(
                Modifier.fillMaxWidth().draggable(
                    state = draggableState,
                    orientation = androidx.compose.foundation.gestures.Orientation.Vertical,
                    enabled = !busy,
                    onDragStopped = { velocity ->
                        if (dragPx > dismissThresholdPx || velocity > 1000f) {
                            androidx.compose.animation.core.animate(dragPx, with(density) { 1000.dp.toPx() }, animationSpec = androidx.compose.animation.core.tween(180)) { v, _ -> dragPx = v }
                            onDismiss()
                        } else {
                            androidx.compose.animation.core.animate(dragPx, 0f, animationSpec = androidx.compose.animation.core.spring(dampingRatio = androidx.compose.animation.core.Spring.DampingRatioLowBouncy)) { v, _ -> dragPx = v }
                        }
                    }
                )
            ) {
                Box(Modifier.padding(vertical = 10.dp).width(40.dp).height(4.dp).clip(RoundedCornerShape(2.dp)).background(T2Colors.surface3).align(Alignment.CenterHorizontally))
                Text(title, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(bottom = 12.dp))
            }
            Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState())) { content() }
            if (footer != null) {
                Spacer(Modifier.height(12.dp))
                footer()
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}

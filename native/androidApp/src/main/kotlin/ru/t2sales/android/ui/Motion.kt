package ru.t2sales.android.ui

import androidx.compose.foundation.layout.height
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import kotlinx.coroutines.delay
import ru.t2sales.shared.theme.T2Colors

/**
 * The app's motion vocabulary: one place for durations and easing, so every screen moves the same way.
 * Rules: help the eye follow a change (a screen arriving, a number settling), never make the user wait -
 * 150-450 ms for regular UI, everything plays once when the thing appears.
 */
object Motion {
    /** Fast start, long soft landing (Material "emphasized decelerate"). */
    val Emphasized = CubicBezierEasing(0.2f, 0f, 0f, 1f)
    const val ScreenMs = 380
    const val RevealMs = 460
    const val ValueMs = 1000
    const val PaletteMs = 220
    const val MenuMs = 180
    const val DialogMs = 260
}

/** A screen (or a page of it) arriving: fades in while sliding up a few pixels. Replays whenever [key] changes. */
@Composable
fun ScreenEnter(key: Any?, content: @Composable () -> Unit) {
    val progress = remember(key) { Animatable(0f) }
    LaunchedEffect(key) { progress.animateTo(1f, tween(Motion.ScreenMs, easing = Motion.Emphasized)) }
    // A Column, not a Box: screens emit several siblings that the caller's Column used to stack vertically.
    Column(Modifier.fillMaxWidth().graphicsLayer { alpha = progress.value; translationY = (1f - progress.value) * 18.dp.toPx() }) { content() }
}

/** Cascade: blocks appear one after another ([index] * [stepMs] delay), fade + slide up. Plays once per appearance. */
fun Modifier.reveal(index: Int = 0, stepMs: Int = 60): Modifier = composed {
    val a = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        delay((index * stepMs).toLong())
        a.animateTo(1f, tween(Motion.RevealMs, easing = Motion.Emphasized))
    }
    graphicsLayer { alpha = a.value; translationY = (1f - a.value) * 22.dp.toPx() }
}

/** A number that counts up from 0 to [target] when it first appears and glides to every new value after that. */
@Composable
fun animatedInt(target: Int, durationMs: Int = Motion.ValueMs): Int {
    val a = remember { Animatable(0f) }
    LaunchedEffect(target) { a.animateTo(target.toFloat(), tween(durationMs, easing = Motion.Emphasized)) }
    return a.value.roundToInt()
}

/** 0 -> [target] on first appearance, then glides on change (bars, arcs). */
@Composable
fun animatedFloat(target: Float, durationMs: Int = Motion.ValueMs): Float {
    val a = remember { Animatable(0f) }
    LaunchedEffect(target) { a.animateTo(target, tween(durationMs, easing = Motion.Emphasized)) }
    return a.value
}

/** Soft light sweep across a placeholder while data loads - reads as "alive", unlike a spinner. */
fun Modifier.shimmer(): Modifier = composed {
    val t = rememberInfiniteTransition()
    val x by t.animateFloat(-0.6f, 1.6f, infiniteRepeatable(tween(1300, easing = LinearEasing), RepeatMode.Restart))
    drawWithContent {
        drawContent()
        val w = size.width
        drawRect(
            Brush.linearGradient(
                listOf(Color.Transparent, Color(0x22FFFFFF), Color.Transparent),
                start = Offset(w * x, 0f),
                end = Offset(w * (x + 0.45f), size.height * 0.4f)
            )
        )
    }
}

/** A grey rounded block that shimmers - the building brick of loading skeletons. */
@Composable
fun SkeletonBlock(modifier: Modifier = Modifier, radius: Dp = 16.dp) {
    Box(modifier.clip(RoundedCornerShape(radius)).background(T2Colors.surface2).shimmer())
}

/** Spring used for press feedback: quick and slightly bouncy. */
fun pressSpring() = spring<Float>(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium)

/** A dialog "grows" into place: fades in while rising a few pixels from slightly smaller. Dialogs are separate windows, so this animates their content. */
@Composable
fun DialogEnter(content: @Composable () -> Unit) {
    val a = remember { Animatable(0f) }
    LaunchedEffect(Unit) { a.animateTo(1f, tween(Motion.DialogMs, easing = Motion.Emphasized)) }
    Box(Modifier.graphicsLayer {
        alpha = a.value
        translationY = (1f - a.value) * 16.dp.toPx()
        val sc = 0.94f + 0.06f * a.value
        scaleX = sc; scaleY = sc
    }) { content() }
}

/** Standard "loading" placeholder for a list or card: a few shimmering bars of different width. Replaces spinners everywhere. */
@Composable
fun LoadingBlock(modifier: Modifier = Modifier, lines: Int = 3) {
    androidx.compose.foundation.layout.Column(
        modifier.fillMaxWidth(),
        verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(10.dp)
    ) {
        val widths = listOf(1f, 0.82f, 0.64f, 0.9f, 0.7f)
        repeat(lines) { i ->
            SkeletonBlock(Modifier.fillMaxWidth(widths[i % widths.size]).height(if (i == 0) 44.dp else 20.dp), 10.dp)
        }
    }
}

/** Press feedback: the element sinks a little while it is pressed and springs back. */
fun Modifier.pressScale(source: MutableInteractionSource, to: Float = 0.96f): Modifier = composed {
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) to else 1f, pressSpring())
    graphicsLayer { scaleX = scale; scaleY = scale }
}

/** clickable with press feedback (and the platform ripple). */
fun Modifier.bouncyClickable(enabled: Boolean = true, to: Float = 0.96f, onClick: () -> Unit): Modifier = composed {
    val source = remember { MutableInteractionSource() }
    this.pressScale(source, to).clickable(interactionSource = source, indication = LocalIndication.current, enabled = enabled, onClick = onClick)
}

/** A bottom tab arriving: a short fade with a small rise. Replays whenever [key] changes. */
@Composable
fun TabEnter(key: Any?, content: @Composable () -> Unit) {
    val progress = remember(key) { Animatable(0f) }
    LaunchedEffect(key) { progress.animateTo(1f, tween(260, easing = Motion.Emphasized)) }
    Box(Modifier.fillMaxSize().graphicsLayer { alpha = progress.value; translationY = (1f - progress.value) * 14.dp.toPx() }) { content() }
}

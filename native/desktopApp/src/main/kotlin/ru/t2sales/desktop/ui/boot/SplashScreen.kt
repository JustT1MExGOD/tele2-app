package ru.t2sales.desktop.ui.boot

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.loadImageBitmap
import androidx.compose.ui.res.useResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.animation.core.Animatable
import ru.t2sales.desktop.update.AppVersion

// The splash always wears the dark brand look, whatever theme the main window uses: it is the app's "front door".
private val Ink = Color(0xFF0A0B0E)
private val InkTop = Color(0xFF10202C)
private val Sky = Color(0xFF3BB8F5)
private val TextMain = Color(0xFFF5F5F7)
private val TextHint = Color(0xFFA6A6B0)

/** Content of the borderless splash window (the window itself is created in Main.kt). */
@Composable
fun SplashScreen(state: BootState) {
    val enter = remember { Animatable(0f) }
    LaunchedEffect(Unit) { enter.animateTo(1f, tween(320)) }
    val leave by animateFloatAsState(if (state.finishing) 1f else 0f, tween(BootSequence.FADE_OUT_MS.toInt()))

    // the window is transparent: this 14dp margin is where the card's soft shadow lives
    Box(Modifier.fillMaxSize().padding(14.dp)) {
        val shape = RoundedCornerShape(28.dp)
        Box(
            Modifier
                .fillMaxSize()
                .graphicsLayer {
                    val s = (0.96f + 0.04f * enter.value) * (1f - 0.04f * leave)
                    scaleX = s; scaleY = s
                    alpha = enter.value * (1f - leave)
                }
                .shadow(22.dp, shape, ambientColor = Color.Black, spotColor = Color.Black)
                .clip(shape)
                .background(Brush.verticalGradient(listOf(InkTop, Ink)))
                .border(1.dp, Color.White.copy(alpha = 0.08f), shape),
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(horizontal = 36.dp)) {
                LogoRing()
                Spacer(Modifier.height(26.dp))
                Text("T2 Sales", color = TextMain, fontSize = 26.sp, fontWeight = FontWeight.ExtraBold)
                Spacer(Modifier.height(10.dp))
                Box(Modifier.height(24.dp), contentAlignment = Alignment.Center) {
                    Crossfade(state.message, animationSpec = tween(260)) { msg ->
                        Text(msg, color = TextMain.copy(alpha = 0.9f), fontSize = 15.sp, textAlign = TextAlign.Center)
                    }
                }
                Spacer(Modifier.height(18.dp))
                LoadingBar(state.progress)
                Box(Modifier.height(22.dp).padding(top = 8.dp), contentAlignment = Alignment.TopCenter) {
                    Crossfade(state.detail ?: "", animationSpec = tween(200)) { d ->
                        Text(d, color = TextHint, fontSize = 12.sp, textAlign = TextAlign.Center)
                    }
                }
            }
            Text(
                "Версия ${AppVersion.current}",
                color = TextHint.copy(alpha = 0.7f), fontSize = 11.sp,
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 20.dp)
            )
        }
    }
}

/** The T2 mark that breathes, with a comet of light circling it and a soft glow that pulses behind. */
@Composable
private fun LogoRing() {
    val icon = remember { useResource("icon.png") { loadImageBitmap(it) } }
    val t = rememberInfiniteTransition()
    val angle by t.animateFloat(0f, 360f, infiniteRepeatable(tween(1500, easing = LinearEasing), RepeatMode.Restart))
    val breathe by t.animateFloat(0f, 1f, infiniteRepeatable(tween(1800), RepeatMode.Reverse))
    Box(Modifier.size(150.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            // glow
            drawCircle(
                Brush.radialGradient(listOf(Sky.copy(alpha = 0.10f + 0.14f * breathe), Color.Transparent), center = center, radius = size.minDimension / 2f),
                radius = size.minDimension / 2f
            )
            // track + comet
            val stroke = 3.dp.toPx()
            val inset = 14.dp.toPx()
            val arcSize = Size(size.width - inset * 2, size.height - inset * 2)
            drawArc(Color.White.copy(alpha = 0.07f), 0f, 360f, false, topLeft = Offset(inset, inset), size = arcSize, style = Stroke(stroke))
            rotate(angle, pivot = center) {
                drawArc(
                    Brush.sweepGradient(0f to Color.Transparent, 0.7f to Sky.copy(alpha = 0.9f), 1f to Sky, center = center),
                    startAngle = 0f, sweepAngle = 250f, useCenter = false,
                    topLeft = Offset(inset, inset), size = arcSize, style = Stroke(stroke, cap = StrokeCap.Round)
                )
            }
        }
        Image(
            icon, null,
            modifier = Modifier.size(78.dp).graphicsLayer { val s = 1f + 0.05f * breathe; scaleX = s; scaleY = s }.clip(RoundedCornerShape(20.dp))
        )
    }
}

/** Determinate when the work can be measured (a download), otherwise a light segment that keeps sliding. */
@Composable
private fun LoadingBar(progress: Float?) {
    val shape = RoundedCornerShape(99.dp)
    val slide by rememberInfiniteTransition().animateFloat(-0.4f, 1.0f, infiniteRepeatable(tween(1300, easing = LinearEasing), RepeatMode.Restart))
    val filled by animateFloatAsState(progress ?: 0f, tween(180))
    BoxWithConstraints(Modifier.width(260.dp).height(5.dp).clip(shape).background(Color.White.copy(alpha = 0.09f))) {
        if (progress != null) {
            Box(Modifier.fillMaxHeight().width(maxWidth * filled).clip(shape).background(Brush.horizontalGradient(listOf(Sky.copy(alpha = 0.7f), Sky))))
        } else {
            Box(
                Modifier.fillMaxHeight().width(maxWidth * 0.4f)
                    .graphicsLayer { translationX = slide * this@BoxWithConstraints.maxWidth.toPx() }
                    .clip(shape).background(Brush.horizontalGradient(listOf(Color.Transparent, Sky, Color.Transparent)))
            )
        }
    }
}

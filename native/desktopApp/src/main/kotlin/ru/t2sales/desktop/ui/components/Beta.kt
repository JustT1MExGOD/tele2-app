package ru.t2sales.desktop.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.Icon
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Hero
import ru.t2sales.shared.theme.T2Motion
import ru.t2sales.shared.theme.T2Radius

/*
 * Beta UI 3.0 «Ночная смена» building blocks (design-system/ui3/v5-team). Used only inside
 * `if (T2Colors.uiBeta)` branches; the classic UI never calls these.
 */

/** Ok / warn / bad tone of a 0..1 progress, the only meaning colour has in the beta. */
fun betaTone(p: Float): Color = when {
    p >= 1f -> T2Colors.success
    p >= 0.7f -> T2Colors.primary
    p >= 0.4f -> T2Colors.warning
    else -> T2Colors.danger
}

/** The hero mesh (--u-hero): linear 160° base + c1 glow top-left + light spot top-right. */
fun Modifier.heroMesh(): Modifier = drawBehind {
    val w = size.width; val h = size.height
    drawRect(Brush.linearGradient(0f to T2Hero.c2, 0.55f to T2Hero.c3, 1f to T2Hero.c4, start = Offset(w * 0.68f, 0f), end = Offset(w * 0.32f, h)))
    drawRect(Brush.radialGradient(0f to T2Hero.c1, 0.6f to Color.Transparent, center = Offset(0f, 0f), radius = maxOf(w * 1.2f, h * 0.9f, 1f)))
    drawRect(Brush.radialGradient(0f to T2Hero.spot.copy(alpha = 0.30f), 0.7f to Color.Transparent, center = Offset(w, 0f), radius = maxOf(w * 0.7f, h * 0.6f, 1f)))
}

/** .hero (mesh) or .hero.flat (plain cell with a hairline): label row, big number, sub line, optional chart. */
@Composable
fun BetaHero(
    label: String,
    chip: String?,
    flat: Boolean = false,
    chipWarn: Boolean = false,
    content: @Composable ColumnScope.() -> Unit
) {
    val shape = RoundedCornerShape(T2Radius.cell)
    val base = Modifier.fillMaxWidth().clip(shape)
    Column(
        (if (flat) base.background(T2Colors.surface).border(1.dp, T2Colors.border, shape) else base.heroMesh())
            .padding(start = 20.dp, end = 20.dp, top = 18.dp, bottom = 16.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, color = if (flat) T2Colors.textSecondary else T2Hero.onHero2, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            if (chip != null) {
                val bg = when { chipWarn -> T2Colors.warningSoft; flat -> T2Colors.surface2; else -> T2Hero.chip }
                val fg = when { chipWarn -> T2Colors.warning; flat -> T2Colors.textSecondary; else -> T2Hero.onHero }
                Text(chip, color = fg, fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clip(CircleShape).background(bg).padding(horizontal = 10.dp, vertical = 4.dp))
            }
        }
        content()
    }
}

/** Big number with a smaller tail ("12 из 16", "51 %"). */
@Composable
fun HeroNumber(value: String, tail: String?, color: Color, size: Int = 56) {
    Row(verticalAlignment = Alignment.Bottom, modifier = Modifier.padding(top = 6.dp)) {
        Text(value, color = color, fontSize = size.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.045 * size).sp, lineHeight = size.sp)
        if (tail != null) Text(" $tail", color = color.copy(alpha = 0.8f), fontSize = (size * 0.42f).sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(bottom = (size * 0.1f).dp))
    }
}

/** .spark: cumulative fact line (solid, marker on the last point) + soft fill; the plan is a straight ramp 0→[plan]. */
@Composable
fun Sparkline(points: List<Float>, plan: Float, color: Color, modifier: Modifier = Modifier.fillMaxWidth().height(44.dp), dashed: Color = color.copy(alpha = 0.35f)) {
    val grow = animatedFloat(1f, T2Motion.fill)
    Canvas(modifier) {
        if (points.size < 2) return@Canvas
        val top = maxOf(points.max(), plan, 1f)
        val stepX = size.width / (points.size - 1)
        fun y(v: Float) = size.height - (v / top) * size.height * 0.92f
        if (plan > 0f) drawLine(dashed, Offset(0f, y(0f)), Offset(size.width, y(plan)), 1.5f.dp.toPx())
        val line = Path()
        val upto = ((points.size - 1) * grow).coerceAtLeast(1f)
        points.forEachIndexed { i, v -> if (i <= upto) { if (i == 0) line.moveTo(0f, y(v)) else line.lineTo(i * stepX, y(v)) } }
        val endX = minOf(upto, (points.size - 1).toFloat()) * stepX
        val fill = Path().apply { addPath(line); lineTo(endX, size.height); lineTo(0f, size.height); close() }
        drawPath(fill, Brush.verticalGradient(listOf(color.copy(alpha = 0.28f), Color.Transparent)))
        drawPath(line, color, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round))
        // the dot on the last drawn point marks "now" (the newest check of the day)
        drawCircle(color, radius = 3.dp.toPx(), center = Offset(endX, y(points[kotlin.math.floor(upto).toInt().coerceAtMost(points.size - 1)])))
    }
}

/** .ring: progress ring with the value inside. */
@Composable
fun BetaRing(p: Float, label: String, size: Dp = 44.dp, stroke: Dp = 4.dp, tone: Color = betaTone(p)) {
    val shown = animatedFloat(p.coerceIn(0f, 1f), T2Motion.fill)
    val track = T2Colors.track
    val edge = T2Colors.borderStrong
    Box(Modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(size)) {
            val s = stroke.toPx()
            val r = Size(this.size.width - s, this.size.height - s)
            drawArc(track, 0f, 360f, false, Offset(s / 2, s / 2), r, style = Stroke(s))
            // hairlines on both edges of the track: at 0 the ring still reads as a finished "zero", not as a loading placeholder
            val h = 1.dp.toPx()
            val mid = (this.size.width - s) / 2f
            drawCircle(edge, radius = mid + s / 2f - h / 2f, style = Stroke(h))
            drawCircle(edge, radius = mid - s / 2f + h / 2f, style = Stroke(h))
            drawArc(tone, -90f, 360f * shown, false, Offset(s / 2, s / 2), r, style = Stroke(s, cap = StrokeCap.Round))
        }
        Text(label, fontSize = (size.value * 0.3f).sp, fontWeight = FontWeight.Bold, color = T2Colors.text)
    }
}

/** .pie: Linear-style status pie (outline + filled sector); full = check-marked filled disc. */
@Composable
fun BetaPie(p: Float, size: Dp = 18.dp, tone: Color = betaTone(p)) {
    val shown = animatedFloat(p.coerceIn(0f, 1f), T2Motion.fill)
    val track = T2Colors.track
    val onP = T2Colors.onPrimary
    Canvas(Modifier.size(size)) {
        val s = 1.5.dp.toPx()
        drawCircle(track, style = Stroke(s))
        drawCircle(tone, style = Stroke(s))
        if (shown >= 0.999f) {
            drawCircle(tone)
            val w = this.size.width
            val check = Path().apply { moveTo(w * 0.28f, w * 0.52f); lineTo(w * 0.44f, w * 0.68f); lineTo(w * 0.73f, w * 0.36f) }
            drawPath(check, onP, style = Stroke(1.6.dp.toPx(), cap = StrokeCap.Round))
        } else {
            val inset = s * 2f
            drawArc(tone, -90f, 360f * shown, true, Offset(inset, inset), Size(this.size.width - inset * 2, this.size.height - inset * 2))
        }
    }
}

/** Press feedback of the beta: scale on press, 120 ms ease-out. */
@Composable
fun Modifier.betaPress(source: MutableInteractionSource, scale: Float): Modifier {
    val pressed by source.collectIsPressedAsState()
    val sc by animateFloatAsState(if (pressed) scale else 1f, tween(T2Motion.micro, easing = T2Motion.easeOut))
    return this.graphicsLayer { scaleX = sc; scaleY = sc }
}

/** .qa round action: 52px circle (primary for the main one) with a caption under it. */
@Composable
fun RoundAction(icon: ImageVector, label: String, primary: Boolean = false, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val src = remember { MutableInteractionSource() }
    Column(modifier.clip(RoundedCornerShape(T2Radius.sm)).clickable(interactionSource = src, indication = null, onClick = onClick).padding(vertical = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier.betaPress(src, 0.92f).size(52.dp).clip(CircleShape)
                .background(if (primary) T2Colors.primary else T2Colors.surface)
                .then(if (primary) Modifier else Modifier.border(1.dp, T2Colors.border, CircleShape)),
            contentAlignment = Alignment.Center
        ) { Icon(icon, contentDescription = label, tint = if (primary) T2Colors.onPrimary else T2Colors.text, modifier = Modifier.size(22.dp)) }
        Text(label, color = T2Colors.textSecondary, fontSize = 12.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 6.dp))
    }
}

/** .g-head: section title above a group, optional right-hand link. */
@Composable
fun GroupHead(title: String, link: String? = null, onLink: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 4.dp, top = 20.dp, bottom = 8.dp), verticalAlignment = Alignment.Bottom) {
        Text(title, color = T2Colors.text, fontSize = 20.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.4).sp, modifier = Modifier.weight(1f))
        if (link != null) Text(link, color = T2Colors.accentText, fontSize = 13.sp, fontWeight = FontWeight.Medium, modifier = if (onLink != null) Modifier.clickable(onClick = onLink) else Modifier)
    }
}

/** .group: grouped cells on one rounded surface, separated by inset hairlines. */
@Composable
fun Group(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val shape = RoundedCornerShape(T2Radius.cell)
    Column(modifier.fillMaxWidth().clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape), content = content)
}

@Composable
fun GroupSeparator(inset: Dp = 16.dp) {
    Box(Modifier.padding(start = inset).fillMaxWidth().height(1.dp).background(T2Colors.separator))
}

/** .tile: 32px rounded square with an icon or text, tinted by [tone] (neutral when null). */
@Composable
fun BetaTile(icon: ImageVector?, text: String? = null, tone: Color? = null) {
    val shape = RoundedCornerShape(9.dp)
    Box(
        Modifier.size(32.dp).clip(shape).background(tone?.copy(alpha = 0.14f) ?: T2Colors.surface2),
        contentAlignment = Alignment.Center
    ) {
        val c = tone ?: T2Colors.textSecondary
        if (icon != null) Icon(icon, contentDescription = null, tint = c, modifier = Modifier.size(17.dp))
        else Text(text ?: "", color = c, fontSize = 12.sp, fontWeight = FontWeight.Bold)
    }
}

/** .cell: tile + title/sub + right value/sub, optional chevron. */
@Composable
fun BetaCell(
    title: String,
    sub: String? = null,
    leading: (@Composable () -> Unit)? = null,
    value: String? = null,
    valueSub: String? = null,
    valueColor: Color = T2Colors.text,
    chevron: Boolean = false,
    background: Color = Color.Transparent,
    trailing: (@Composable () -> Unit)? = null,
    onClick: (() -> Unit)? = null
) {
    val src = remember { MutableInteractionSource() }
    Row(
        Modifier.fillMaxWidth().background(background)
            .then(if (onClick != null) Modifier.clickable(interactionSource = src, indication = androidx.compose.foundation.LocalIndication.current, onClick = onClick) else Modifier)
            .padding(horizontal = 16.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (leading != null) { leading(); Spacer(Modifier.width(12.dp)) }
        Column(Modifier.weight(1f)) {
            Text(title, color = T2Colors.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
            if (sub != null) Text(sub, color = T2Colors.hint, fontSize = 13.sp, maxLines = 2, modifier = Modifier.padding(top = 1.dp))
        }
        if (value != null || valueSub != null) Column(horizontalAlignment = Alignment.End, modifier = Modifier.padding(start = 8.dp)) {
            if (value != null) Text(value, color = valueColor, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            if (valueSub != null) Text(valueSub, color = T2Colors.hint, fontSize = 12.sp)
        }
        if (trailing != null) { Spacer(Modifier.width(8.dp)); trailing() }
        if (chevron) Text("›", color = T2Colors.hint, fontSize = 20.sp, modifier = Modifier.padding(start = 8.dp))
    }
}

/** .seg: iOS segmented control with a sliding thumb (240 ms drawer curve). */
@Composable
fun Segmented(options: List<String>, selected: Int, modifier: Modifier = Modifier, onSelect: (Int) -> Unit) {
    val shape = RoundedCornerShape(T2Radius.seg + 3.dp)
    BoxWithConstraints(modifier.fillMaxWidth().clip(shape).background(T2Colors.surface2).padding(3.dp)) {
        val w = maxWidth / options.size.coerceAtLeast(1)
        val x by animateDpAsState(w * selected, tween(T2Motion.seg, easing = T2Motion.drawer))
        Box(Modifier.offset(x = x).width(w).height(32.dp).clip(RoundedCornerShape(T2Radius.seg)).background(if (T2Colors.dark) T2Colors.surface3 else T2Colors.surface).border(1.dp, T2Colors.borderStrong, RoundedCornerShape(T2Radius.seg)))
        Row(Modifier.fillMaxWidth().height(32.dp)) {
            options.forEachIndexed { i, o ->
                val c by animateColorAsState(if (i == selected) T2Colors.text else T2Colors.textSecondary, tween(T2Motion.short))
                Box(Modifier.weight(1f).fillMaxHeight().clip(RoundedCornerShape(T2Radius.seg)).clickable(indication = null, interactionSource = remember { MutableInteractionSource() }) { onSelect(i) }, contentAlignment = Alignment.Center) {
                    Text(o, color = c, fontSize = 13.sp, fontWeight = if (i == selected) FontWeight.SemiBold else FontWeight.Medium, maxLines = 1)
                }
            }
        }
    }
}

/** .stepper: − value +, 44px hit targets, value rolls on change. */
@Composable
fun Stepper(value: Int, onChange: (Int) -> Unit, min: Int = 0, max: Int = 999) {
    val shape = RoundedCornerShape(T2Radius.sm)
    Row(Modifier.clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape), verticalAlignment = Alignment.CenterVertically) {
        StepBtn("−", value > min) { onChange((value - 1).coerceAtLeast(min)) }
        val roll = animatedFloat(value.toFloat(), ROLL_MS)
        Text(
            value.toString(), color = if (value > 0) T2Colors.text else T2Colors.hint, fontSize = 16.sp, fontWeight = FontWeight.Bold,
            modifier = Modifier.width(30.dp).graphicsLayer { translationY = (roll - value) * 0.3f * 20.dp.toPx(); alpha = 1f - kotlin.math.abs(roll - value).coerceAtMost(0.7f) },
            textAlign = androidx.compose.ui.text.style.TextAlign.Center
        )
        StepBtn("+", value < max) { onChange((value + 1).coerceAtMost(max)) }
    }
}

@Composable
private fun StepBtn(label: String, enabled: Boolean, onClick: () -> Unit) {
    val src = remember { MutableInteractionSource() }
    Box(
        Modifier.size(44.dp, 36.dp).clickable(interactionSource = src, indication = null, enabled = enabled, onClick = onClick).betaPress(src, 0.94f),
        contentAlignment = Alignment.Center
    ) { Text(label, color = if (enabled) T2Colors.text else T2Colors.hint.copy(alpha = 0.5f), fontSize = 20.sp, fontWeight = FontWeight.Medium) }
}

/** Primary filled button of the beta (btn-pri): [primary] fill, [onPrimary] text, scale .97 on press. */
@Composable
fun BetaButton(text: String, enabled: Boolean = true, secondary: Boolean = false, modifier: Modifier = Modifier.fillMaxWidth(), onClick: () -> Unit) {
    val src = remember { MutableInteractionSource() }
    val shape = RoundedCornerShape(14.dp)
    Box(
        modifier.betaPress(src, 0.97f).height(50.dp).clip(shape)
            .background(if (secondary) T2Colors.surface2 else T2Colors.primary.copy(alpha = if (enabled) 1f else 0.5f))
            .then(if (secondary) Modifier.border(1.dp, T2Colors.border, shape) else Modifier)
            .clickable(interactionSource = src, indication = null, enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center
    ) { Text(text, color = if (secondary) T2Colors.text else T2Colors.onPrimary, fontSize = 16.sp, fontWeight = FontWeight.SemiBold) }
}

/** iOS-style switch (51×31), green when on, thumb slides 240 ms. */
@Composable
fun BetaSwitch(checked: Boolean, onChange: (Boolean) -> Unit) {
    val x by animateDpAsState(if (checked) 20.dp else 0.dp, tween(T2Motion.seg, easing = T2Motion.easeOut))
    val bg by animateColorAsState(if (checked) T2Colors.success else T2Colors.surface3, tween(T2Motion.short, easing = T2Motion.easeOut))
    Box(
        Modifier.size(51.dp, 31.dp).clip(CircleShape).background(bg).clickable { onChange(!checked) }.padding(2.dp)
    ) {
        Box(Modifier.offset(x = x).size(27.dp).clip(CircleShape).background(Color.White))
    }
}

/** Large title (34/700, tight tracking) with an optional lede under it. */
@Composable
fun LargeTitle(text: String, lede: String? = null) {
    Column(Modifier.padding(start = 4.dp, bottom = 12.dp)) {
        Text(text, color = T2Colors.text, fontSize = 34.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.75).sp)
        if (lede != null) Text(lede, color = T2Colors.textSecondary, fontSize = 15.sp, modifier = Modifier.padding(top = 2.dp))
    }
}

/** Avatar initials in a soft circle (podium, leaderboard rows). */
@Composable
fun Initials(name: String, size: Dp = 36.dp, highlight: Boolean = false) {
    val ini = name.trim().split(Regex("\\s+")).take(2).mapNotNull { it.firstOrNull()?.uppercaseChar() }.joinToString("")
    Box(
        Modifier.size(size).clip(CircleShape).background(if (highlight) T2Colors.primarySoft else T2Colors.surface2),
        contentAlignment = Alignment.Center
    ) { Text(ini, color = if (highlight) T2Colors.accentText else T2Colors.textSecondary, fontSize = (size.value * 0.34f).sp, fontWeight = FontWeight.Bold) }
}

/** Arrangement used by beta rows of equal items. */
val BetaGap = Arrangement.spacedBy(12.dp)

/** Stepper digit roll, NOTES.md «Моушн» (not in shared T2Motion). */
private const val ROLL_MS = 160

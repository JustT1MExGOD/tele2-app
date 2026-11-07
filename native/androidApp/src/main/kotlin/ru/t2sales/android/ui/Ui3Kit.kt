package ru.t2sales.android.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2FontSize
import ru.t2sales.shared.theme.T2Hero
import ru.t2sales.shared.theme.T2Motion
import ru.t2sales.shared.theme.T2Radius
import ru.t2sales.shared.theme.T2Spacing

/*
 * Beta UI 3.0 «Ночная смена» building blocks (design-system/ui3/v5-team). Used only inside
 * `if (T2Colors.uiBeta)` branches; the classic UI never calls them.
 * Rules from NOTES.md: one gradient surface per screen (U3Hero), everything else flat with hairlines,
 * colour only for state (ok/warn/bad), tabular numbers, hit targets >= T2Spacing.hit.
 */

/** Status tone for a percentage, same thresholds as the classic UI. */
fun u3Tone(pct: Int): Color = when {
    pct >= 100 -> T2Colors.success
    pct >= 70 -> T2Colors.warning
    else -> T2Colors.danger
}

/** iOS large title + optional lede (web .large / .lede). */
@Composable
fun U3LargeTitle(title: String, lede: String? = null) {
    Column(Modifier.padding(top = 4.dp, bottom = T2Spacing.sp4)) {
        Text(title, color = T2Colors.text, fontSize = T2FontSize.xxxl, fontWeight = FontWeight.Bold, letterSpacing = (-0.6).sp, lineHeight = 34.sp)
        if (lede != null) Text(lede, color = T2Colors.hint, fontSize = T2FontSize.md, modifier = Modifier.padding(top = 4.dp))
    }
}

/** The mesh background of the hero card: 160° c2→c3→c4, a c1 glow top-left, the light spot top-right. */
fun Modifier.u3HeroMesh(): Modifier = this.drawBehind {
    drawRect(Brush.linearGradient(listOf(T2Hero.c2, T2Hero.c3, T2Hero.c4), start = Offset(size.width * 0.33f, 0f), end = Offset(size.width * 0.67f, size.height)))
    drawRect(Brush.radialGradient(listOf(T2Hero.c1, T2Hero.c1.copy(alpha = 0f)), center = Offset.Zero, radius = size.width * 0.9f))
    drawRect(Brush.radialGradient(listOf(T2Hero.spot.copy(alpha = 0.30f), T2Hero.spot.copy(alpha = 0f)), center = Offset(size.width, 0f), radius = size.width * 0.55f))
}

/** Revolut-style hero card: the only gradient on a screen. */
@Composable
fun U3Hero(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val shape = RoundedCornerShape(T2Radius.xl)
    Column(
        modifier.fillMaxWidth().clip(shape).u3HeroMesh().border(1.dp, Color(0x1AFFFFFF), shape).padding(horizontal = 20.dp, vertical = 18.dp),
        content = content
    )
}

/** Hero top row: a quiet label on the left, an optional chip on the right. */
@Composable
fun U3HeroRow(label: String, chip: String? = null, chipColor: Color = T2Hero.chip, chipText: Color = T2Hero.onHero) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = T2Hero.onHero2, fontSize = T2FontSize.sm, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        if (chip != null) Text(
            chip, color = chipText, fontSize = T2FontSize.cap, fontWeight = FontWeight.SemiBold, maxLines = 1,
            modifier = Modifier.clip(CircleShape).background(chipColor).padding(horizontal = 10.dp, vertical = 4.dp)
        )
    }
}

/** The big hero number: "12 из 16" with the tail smaller. */
@Composable
fun U3HeroNumber(main: String, tail: String?, color: Color = T2Hero.onHero) {
    Row(verticalAlignment = Alignment.Bottom, modifier = Modifier.padding(top = 6.dp)) {
        Text(main, color = color, fontSize = T2FontSize.hero, fontWeight = FontWeight.Bold, letterSpacing = (-2.4).sp, lineHeight = 58.sp)
        if (tail != null) Text(" $tail", color = T2Hero.onHero2, fontSize = T2FontSize.xxl, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(bottom = 9.dp))
    }
}

/** A sparkline over the hero: line in onHero, soft fill under it. Values are drawn left to right, scaled to their max. */
@Composable
fun U3Sparkline(values: List<Float>, modifier: Modifier = Modifier, height: Dp = 44.dp, line: Color = T2Hero.onHero, fill: Color = T2Hero.onHeroFill) {
    if (values.size < 2) return
    val grow = animatedFloat(1f, T2Motion.fill)
    Canvas(modifier.fillMaxWidth().height(height)) {
        val max = (values.maxOrNull() ?: 0f).coerceAtLeast(1f)
        val stepX = size.width / (values.size - 1)
        val pad = 3.dp.toPx()
        fun y(v: Float) = size.height - pad - (v / max) * (size.height - pad * 2) * grow
        val p = Path().apply { values.forEachIndexed { i, v -> if (i == 0) moveTo(0f, y(v)) else lineTo(i * stepX, y(v)) } }
        val area = Path().apply { addPath(p); lineTo(size.width, size.height); lineTo(0f, size.height); close() }
        drawPath(area, Brush.verticalGradient(listOf(fill, fill.copy(alpha = 0f))))
        drawPath(p, line, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
        drawCircle(line, 3.dp.toPx(), Offset((values.size - 1) * stepX, y(values.last())))
    }
}

/** Section header above a group (web .g-head): text-3 label left, optional accent link right. */
@Composable
fun U3GroupHead(title: String, trailing: String? = null, onTrailing: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 4.dp, top = T2Spacing.sp5, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, color = T2Colors.hint, fontSize = T2FontSize.sm, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        if (trailing != null) Text(
            trailing, color = if (onTrailing != null) T2Colors.accentText else T2Colors.hint, fontSize = T2FontSize.sm, fontWeight = FontWeight.Medium,
            modifier = if (onTrailing != null) Modifier.heightIn(min = T2Spacing.hit).bouncyClickable(to = 0.95f, onClick = onTrailing).padding(horizontal = 4.dp, vertical = 12.dp) else Modifier
        )
    }
}

/** Apple inset-grouped card (web .group): cell background, 22dp radius, hairline in dark only. */
@Composable
fun U3Group(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val shape = RoundedCornerShape(T2Radius.cell)
    Column(
        modifier.fillMaxWidth().clip(shape).background(T2Colors.surface).border(1.dp, if (T2Colors.dark) T2Colors.border else Color.Transparent, shape),
        content = content
    )
}

/** Inset separator between cells (starts after the leading tile). */
@Composable
fun U3Sep(inset: Dp = 66.dp) {
    Box(Modifier.fillMaxWidth().padding(start = inset).height(1.dp).background(T2Colors.separator))
}

/** One cell of a group: optional leading slot, title + sub, trailing slot. Min height 52dp (>= hit). */
@Composable
fun U3Cell(
    title: String, sub: String? = null, modifier: Modifier = Modifier, highlight: Boolean = false,
    leading: (@Composable () -> Unit)? = null, trailing: (@Composable () -> Unit)? = null, onClick: (() -> Unit)? = null
) {
    Row(
        modifier.fillMaxWidth().heightIn(min = 52.dp)
            .let { if (highlight) it.background(T2Colors.primarySoft) else it }
            .let { if (onClick != null) it.bouncyClickable(to = 0.985f, onClick = onClick) else it }
            .padding(horizontal = T2Spacing.sp4, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (leading != null) { leading(); Spacer(Modifier.width(T2Spacing.sp3)) }
        Column(Modifier.weight(1f)) {
            Text(title, color = T2Colors.text, fontSize = T2FontSize.md, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (sub != null) Text(sub, color = T2Colors.hint, fontSize = T2FontSize.sm, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp))
        }
        if (trailing != null) { Spacer(Modifier.width(T2Spacing.sp2)); trailing() }
    }
}

/** 38dp rounded tile for a cell's leading slot: a glyph or two letters on cell-2. */
@Composable
fun U3Tile(text: String, tint: Color = T2Colors.textSecondary, bg: Color = T2Colors.surface2) {
    Box(Modifier.size(38.dp).clip(RoundedCornerShape(11.dp)).background(bg), contentAlignment = Alignment.Center) {
        Text(text, color = tint, fontSize = T2FontSize.sm, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

@Composable
fun U3IconTile(icon: androidx.compose.ui.graphics.Path, tint: Color = T2Colors.textSecondary, bg: Color = T2Colors.surface2) {
    Box(Modifier.size(38.dp).clip(RoundedCornerShape(11.dp)).background(bg), contentAlignment = Alignment.Center) {
        NavIcon(icon, contentDescription = null, tint = tint, size = 20.dp)
    }
}

/** Trailing tabular number in a cell. */
@Composable
fun U3Value(text: String, color: Color = T2Colors.text) {
    Text(text, color = color, fontSize = T2FontSize.md, fontWeight = FontWeight.SemiBold, maxLines = 1)
}

/**
 * Segmented control (web .seg): a sliding thumb on cell-2, drawer curve 240ms.
 * Each segment is at least 36dp tall visually; the row itself is 44dp so the touch target stays >= hit.
 */
@Composable
fun U3Segmented(options: List<String>, selected: Int, modifier: Modifier = Modifier, onSelect: (Int) -> Unit) {
    if (options.isEmpty()) return
    val shape = RoundedCornerShape(T2Radius.seg + 2.dp)
    BoxWithConstraints(modifier.fillMaxWidth().height(T2Spacing.hit).clip(shape).background(T2Colors.surface2).padding(3.dp)) {
        val segW = maxWidth / options.size
        val x by animateDpAsState(segW * selected.coerceIn(0, options.lastIndex), tween(T2Motion.seg, easing = T2Motion.drawer))
        Box(
            Modifier.offset(x = x).width(segW).fillMaxHeight().clip(RoundedCornerShape(T2Radius.seg))
                .background(if (T2Colors.dark) T2Colors.surface3 else T2Colors.surface).border(1.dp, T2Colors.border, RoundedCornerShape(T2Radius.seg))
        )
        Row(Modifier.fillMaxWidth().fillMaxHeight()) {
            options.forEachIndexed { i, label ->
                val on = i == selected
                val c by animateColorAsState(if (on) T2Colors.text else T2Colors.textSecondary, tween(T2Motion.short, easing = T2Motion.easeOut))
                Box(
                    Modifier.weight(1f).fillMaxHeight().clip(RoundedCornerShape(T2Radius.seg))
                        .semantics { role = Role.Tab; stateDescription = if (on) "выбрано" else "" }
                        .bouncyClickable(to = 0.97f) { onSelect(i) },
                    contentAlignment = Alignment.Center
                ) { Text(label, color = c, fontSize = T2FontSize.sm, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium, maxLines = 1) }
            }
        }
    }
}

/** iOS stepper pill: − value +, each button 44x36 inside a 44dp-tall capsule. */
@Composable
fun U3Stepper(value: Int, onChange: (Int) -> Unit, label: String, min: Int = 0, max: Int = 999) {
    val shape = CircleShape
    Row(Modifier.height(T2Spacing.hit).clip(shape).background(T2Colors.surface2), verticalAlignment = Alignment.CenterVertically) {
        StepBtn("−", "$label, меньше", enabled = value > min) { onChange((value - 1).coerceAtLeast(min)) }
        Text(
            value.toString(), color = T2Colors.text, fontSize = T2FontSize.lg, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(min = 32.dp)
        )
        StepBtn("+", "$label, больше", enabled = value < max) { onChange((value + 1).coerceAtMost(max)) }
    }
}

@Composable
private fun StepBtn(glyph: String, desc: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.width(T2Spacing.hit).fillMaxHeight().clip(CircleShape)
            .semantics { contentDescription = desc; role = Role.Button }
            .bouncyClickable(enabled = enabled, to = 0.94f, onClick = onClick),
        contentAlignment = Alignment.Center
    ) { Text(glyph, color = if (enabled) T2Colors.text else T2Colors.hint.copy(alpha = 0.5f), fontSize = 20.sp, fontWeight = FontWeight.Medium) }
}

/** Linear-style status pie: outline circle + filled sector by pct, tone by state. Fills once (720ms). */
@Composable
fun U3Pie(pct: Int, size: Dp = 18.dp, tone: Color = u3Tone(pct)) {
    val sweep = animatedFloat(pct.coerceIn(0, 100) / 100f, T2Motion.fill)
    val track = T2Colors.track
    Canvas(Modifier.size(size)) {
        val stroke = 1.5.dp.toPx()
        drawCircle(tone, radius = this.size.minDimension / 2 - stroke / 2, style = Stroke(stroke))
        drawCircle(track, radius = this.size.minDimension / 2 - stroke * 2)
        val inset = stroke * 2
        drawArc(tone, -90f, 360f * sweep, true, Offset(inset, inset), Size(this.size.width - inset * 2, this.size.height - inset * 2))
    }
}

/** Activity ring with the percent inside and a caption under it. */
@Composable
fun U3Ring(pct: Int, caption: String, modifier: Modifier = Modifier, size: Dp = 56.dp) {
    val sweep = animatedFloat(pct.coerceIn(0, 100) / 100f, T2Motion.fill)
    val shown = animatedInt(pct, T2Motion.count)
    val tone = u3Tone(pct)
    val track = T2Colors.track
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(size), contentAlignment = Alignment.Center) {
            Canvas(Modifier.size(size)) {
                val stroke = 6.dp.toPx()
                val arc = Size(this.size.width - stroke, this.size.height - stroke)
                val tl = Offset(stroke / 2, stroke / 2)
                drawArc(track, -90f, 360f, false, tl, arc, style = Stroke(stroke))
                // 1dp borderStrong edges on the track (desktop BetaRing): an empty ring still reads as a ring, not a grey disc
                val edge = 1.dp.toPx()
                val outer = Size(this.size.width - edge, this.size.height - edge)
                drawArc(T2Colors.borderStrong, -90f, 360f, false, Offset(edge / 2, edge / 2), outer, style = Stroke(edge))
                val inner = Size(this.size.width - 2 * stroke + edge, this.size.height - 2 * stroke + edge)
                drawArc(T2Colors.borderStrong, -90f, 360f, false, Offset(stroke - edge / 2, stroke - edge / 2), inner, style = Stroke(edge))
                drawArc(tone, -90f, 360f * sweep, false, tl, arc, style = Stroke(stroke, cap = StrokeCap.Round))
            }
            Text("$shown%", color = T2Colors.text, fontSize = T2FontSize.cap, fontWeight = FontWeight.Bold)
        }
        Text(caption, color = T2Colors.hint, fontSize = T2FontSize.xs, fontWeight = FontWeight.Medium, maxLines = 1, modifier = Modifier.padding(top = 6.dp))
    }
}

/** Round quick action (web .qa .round): 56dp circle + label; the primary one is filled. */
@Composable
fun U3RoundAction(label: String, glyph: String? = null, icon: androidx.compose.ui.graphics.Path? = null, primary: Boolean = false, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Column(modifier.bouncyClickable(to = 0.92f, onClick = onClick).padding(vertical = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        val bg = if (primary) T2Colors.primary else T2Colors.surface
        val fg = if (primary) T2Colors.onPrimary else T2Colors.text
        Box(Modifier.size(56.dp).clip(CircleShape).background(bg).border(1.dp, if (primary) Color.Transparent else T2Colors.border, CircleShape), contentAlignment = Alignment.Center) {
            if (icon != null) NavIcon(icon, contentDescription = null, tint = fg, size = 22.dp)
            else Text(glyph ?: "", color = fg, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
        }
        Text(label, color = T2Colors.textSecondary, fontSize = T2FontSize.cap, fontWeight = FontWeight.Medium, maxLines = 1, modifier = Modifier.padding(top = 6.dp))
    }
}

/** Primary CTA (web .btn-pri): primary fill, onPrimary text, 50dp tall, 14dp radius. */
@Composable
fun U3PrimaryButton(text: String, enabled: Boolean = true, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier.fillMaxWidth().heightIn(min = 50.dp).clip(RoundedCornerShape(14.dp)).background(T2Colors.primary.copy(alpha = if (enabled) 1f else 0.5f))
            .bouncyClickable(enabled = enabled, to = 0.97f, onClick = onClick),
        contentAlignment = Alignment.Center
    ) { Text(text, color = T2Colors.onPrimary, fontSize = T2FontSize.lg, fontWeight = FontWeight.SemiBold) }
}

/** Secondary button (web .btn-sec): cell-2 fill with hairline. */
@Composable
fun U3SecondaryButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier.fillMaxWidth().heightIn(min = 50.dp).clip(RoundedCornerShape(14.dp)).background(T2Colors.surface2).border(1.dp, T2Colors.border, RoundedCornerShape(14.dp))
            .bouncyClickable(to = 0.97f, onClick = onClick),
        contentAlignment = Alignment.Center
    ) { Text(text, color = T2Colors.text, fontSize = T2FontSize.lg, fontWeight = FontWeight.SemiBold) }
}

/** iOS switch 51x31 (web .beta-ui-switch): success when on. Put it inside a clickable row for the 44dp target. */
@Composable
fun U3Switch(checked: Boolean) {
    val x by animateDpAsState(if (checked) 20.dp else 0.dp, tween(T2Motion.seg, easing = T2Motion.easeOut))
    val bg by animateColorAsState(if (checked) T2Colors.success else T2Colors.surface3, tween(T2Motion.short, easing = T2Motion.easeOut))
    Box(Modifier.width(51.dp).height(31.dp).clip(CircleShape).background(bg).padding(2.dp)) {
        Box(Modifier.offset(x = x).size(27.dp).clip(CircleShape).background(Color.White))
    }
}

/** Horizontal row of filter chips (web .filters .chip): pill on surface2, selected one on primary. Scrollable when they overflow. */
@Composable
fun U3FilterChips(options: List<Pair<String, String>>, selected: String, modifier: Modifier = Modifier, onSelect: (String) -> Unit) {
    Row(
        modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        options.forEach { (id, label) ->
            val active = id == selected
            Box(
                Modifier.heightIn(min = T2Spacing.hit).bouncyClickable(to = 0.95f) { onSelect(id) },
                contentAlignment = Alignment.Center
            ) {
                Text(
                    label, color = if (active) T2Colors.onPrimary else T2Colors.textSecondary,
                    fontWeight = FontWeight.SemiBold, fontSize = T2FontSize.sm,
                    modifier = Modifier.clip(CircleShape).background(if (active) T2Colors.primary else T2Colors.surface2)
                        .padding(horizontal = 14.dp, vertical = 8.dp)
                )
            }
        }
    }
}

/** Warning row (cash): warning-soft fill, a dot and a message. */
@Composable
fun U3WarnRow(text: String, tone: Color = T2Colors.warning, soft: Color = T2Colors.warningSoft) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = T2Spacing.hit).clip(RoundedCornerShape(T2Radius.md)).background(soft).padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Text("!", color = tone, fontWeight = FontWeight.Black, fontSize = 15.sp, modifier = Modifier.size(20.dp).clip(CircleShape).border(1.5.dp, tone, CircleShape).padding(top = 0.dp), textAlign = TextAlign.Center)
        Text(text, color = T2Colors.text, fontSize = T2FontSize.sm, fontWeight = FontWeight.Medium)
    }
}

package ru.t2sales.desktop.ui.reports

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Arrangement
import ru.t2sales.desktop.ui.components.MChipButton
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.CircularProgressIndicator
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import org.jetbrains.skia.Data
import org.jetbrains.skia.Font
import org.jetbrains.skia.FontMgr
import org.jetbrains.skia.FontStyle
import org.jetbrains.skia.Paint
import org.jetbrains.skia.Typeface
import org.jetbrains.skia.TextLine
import org.jetbrains.skia.svg.SVGDOM
import ru.t2sales.desktop.di.AppContainer
import ru.t2sales.desktop.ui.analytics.obj
import ru.t2sales.desktop.ui.analytics.str
import ru.t2sales.desktop.ui.components.Field
import ru.t2sales.desktop.ui.components.MainButton
import ru.t2sales.desktop.ui.components.PageSection
import ru.t2sales.desktop.ui.components.SelectField
import ru.t2sales.shared.api.StoreInfo
import ru.t2sales.shared.theme.T2Colors

/** Port of #page-reportimg: store + date -> GET /reports/day/:store, SVG frames (story: План / Факт / Завтра) rendered via Skia. */
@Composable
fun ReportImgScreen(container: AppContainer) {
    val scope = rememberCoroutineScope()
    var stores by remember { mutableStateOf<List<StoreInfo>>(emptyList()) }
    var storeId by remember { mutableStateOf<String?>(null) }
    var date by remember { mutableStateOf(LocalDate.now(ZoneId.of("Europe/Moscow")).toString()) }
    var frames by remember { mutableStateOf<List<Pair<String?, String>>?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        runCatching { container.scheduleApi.getOrgStores().stores }.onSuccess { stores = it; storeId = it.firstOrNull()?.id }
    }

    PageSection("Картинка-отчёт (SVG)") {
        Column(modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 12.dp)) {
            SelectField("Точка", stores.firstOrNull { it.id == storeId }?.name ?: "", stores.map { it.name }) { n -> stores.firstOrNull { it.name == n }?.let { storeId = it.id } }
            Spacer(Modifier.height(12.dp))
            Field("Дата", date, { date = it }, placeholder = "ГГГГ-ММ-ДД", fill = T2Colors.surface2)
            Spacer(Modifier.height(12.dp))
            MainButton(if (busy) "Генерируем…" else "Сгенерировать", enabled = !busy) {
                val sid = storeId
                if (sid == null) { frames = null; message = "Выбери точку"; return@MainButton }
                busy = true; frames = null; message = null
                scope.launch {
                    runCatching {
                        val d: JsonObject = container.reportsApi.getReportDay(sid, date.trim().ifEmpty { LocalDate.now(ZoneId.of("Europe/Moscow")).toString() })
                        val svgs = d["svgs"] as? JsonObject
                        if (svgs != null) listOf("План" to svgs["plan"].str(), "Факт" to svgs["fact"].str(), "Завтра" to svgs["tomorrow"].str())
                        else d["svg"].str().takeIf { it.isNotEmpty() }?.let { listOf<Pair<String?, String>>(null to it) } ?: error("Пустой svg в ответе")
                    }.onSuccess { frames = it }.onFailure { message = "Не удалось сгенерировать\n" + (it.message ?: it.toString()) }
                    busy = false
                }
            }
        }
        when {
            busy -> CircularProgressIndicator(modifier = Modifier.padding(16.dp))
            message != null -> Text(message!!, color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(24.dp))
            frames != null -> Column(modifier = Modifier.padding(12.dp)) {
                frames!!.forEach { (label, svg) ->
                    Column(modifier = Modifier.padding(bottom = 12.dp)) {
                        if (label != null) Text(label, color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(start = 2.dp, bottom = 6.dp))
                        SvgFrame(svg)
                        Row(modifier = Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            MChipButton("Копировать") { copyPng(svg) }
                            MChipButton("Сохранить PNG") { savePng(svg, (stores.firstOrNull { it.id == storeId }?.name ?: "точка") + "-" + date.trim() + (label?.let { "-$it" } ?: "")) }
                        }
                    }
                }
            }
        }
    }
}

private val VIEWBOX = Regex("""viewBox\s*=\s*"\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)\s*"""")
private val WIDTH = Regex("""<svg[^>]*\swidth\s*=\s*"([\d.]+)""")
private val HEIGHT = Regex("""<svg[^>]*\sheight\s*=\s*"([\d.]+)""")
private val TEXT_TAG = Regex("""<text(?=[\s>])([^>]*)>(.*?)</text>""", RegexOption.DOT_MATCHES_ALL)
private val ATTR = Regex("""([\w:-]+)\s*=\s*"([^"]*)"""")

/** Skiko's SVGDOM has no font manager, so <text> is dropped - the text runs are pulled out and drawn by hand. */
private class SvgText(val x: Float, val y: Float, val text: String, val color: Int, val size: Float, val bold: Boolean, val anchorEnd: Boolean)

private fun parseColor(hex: String?, opacity: Float): Int {
    val h = (hex ?: "#FFFFFF").removePrefix("#").let { if (it.length == 3) it.map { c -> "$c$c" }.joinToString("") else it }
    val rgb = h.toLongOrNull(16)?.toInt() ?: 0xFFFFFF
    val a = (opacity.coerceIn(0f, 1f) * 255).toInt()
    return (a shl 24) or (rgb and 0xFFFFFF)
}

private fun unescape(t: String) = t.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&apos;", "'").replace("&amp;", "&")

private fun extractTexts(svg: String): Pair<String, List<SvgText>> {
    val texts = mutableListOf<SvgText>()
    val stripped = TEXT_TAG.replace(svg) { m ->
        val a = ATTR.findAll(m.groupValues[1]).associate { it.groupValues[1] to it.groupValues[2] }
        val body = unescape(m.groupValues[2].replace(Regex("<[^>]+>"), ""))
        texts += SvgText(
            a["x"]?.toFloatOrNull() ?: 0f, a["y"]?.toFloatOrNull() ?: 0f, body,
            parseColor(a["fill"], a["fill-opacity"]?.toFloatOrNull() ?: 1f),
            a["font-size"]?.toFloatOrNull() ?: 14f,
            (a["font-weight"]?.toIntOrNull() ?: 400) >= 600,
            a["text-anchor"] == "end"
        )
        ""
    }
    return stripped to texts
}

private val FONT_MGR by lazy { FontMgr.default }
private fun typeface(bold: Boolean): Typeface {
    val style = if (bold) FontStyle.BOLD else FontStyle.NORMAL
    return listOf("Segoe UI", "Arial", "DejaVu Sans").firstNotNullOfOrNull { FONT_MGR.matchFamilyStyle(it, style) } ?: FONT_MGR.legacyMakeTypeface("", style) ?: Font().typeface ?: error("Нет системных шрифтов")
}

@Composable
private fun SvgFrame(svg: String) {
    val (geometry, texts) = remember(svg) { extractTexts(svg) }
    val dom = remember(geometry) { runCatching { SVGDOM(Data.makeFromBytes(geometry.toByteArray(Charsets.UTF_8))) }.getOrNull() }
    val (w, h) = remember(svg) {
        val vb = VIEWBOX.find(svg)
        val vw = vb?.groupValues?.get(1)?.toFloatOrNull() ?: WIDTH.find(svg)?.groupValues?.get(1)?.toFloatOrNull() ?: 1080f
        val vh = vb?.groupValues?.get(2)?.toFloatOrNull() ?: HEIGHT.find(svg)?.groupValues?.get(1)?.toFloatOrNull() ?: 1080f
        vw to vh
    }
    if (dom == null) { Text("Не удалось отобразить SVG", color = T2Colors.hint, fontSize = 13.sp); return }
    Box(modifier = Modifier.widthIn(max = 440.dp).fillMaxWidth().aspectRatio(w / h).clip(RoundedCornerShape(16.dp)).background(Color(0xFF0A0A0B))) {
        Canvas(modifier = Modifier.matchParentSize()) {
            drawIntoCanvas { c ->
                val native = c.nativeCanvas
                native.save()
                native.scale(size.width / w, size.height / h)
                dom.setContainerSize(w, h)
                dom.render(native)
                texts.forEach { t ->
                    val font = Font(typeface(t.bold), t.size)
                    val paint = Paint().apply { color = t.color }
                    val line = TextLine.make(t.text, font)
                    native.drawTextLine(line, if (t.anchorEnd) t.x - line.width else t.x, t.y, paint)
                }
                native.restore()
            }
        }
    }
}


/** Draws the frame into a bitmap of its own size (the same drawing as on screen) and returns it as PNG bytes. */
private fun renderPng(svg: String): ByteArray {
    val (geometry, texts) = extractTexts(svg)
    val dom = SVGDOM(Data.makeFromBytes(geometry.toByteArray(Charsets.UTF_8)))
    val vb = VIEWBOX.find(svg)
    val w = vb?.groupValues?.get(1)?.toFloatOrNull() ?: WIDTH.find(svg)?.groupValues?.get(1)?.toFloatOrNull() ?: 1080f
    val h = vb?.groupValues?.get(2)?.toFloatOrNull() ?: HEIGHT.find(svg)?.groupValues?.get(1)?.toFloatOrNull() ?: 1080f
    val surface = org.jetbrains.skia.Surface.makeRasterN32Premul(w.toInt(), h.toInt())
    val canvas = surface.canvas
    canvas.clear(0xFF0A0A0B.toInt())
    dom.setContainerSize(w, h)
    dom.render(canvas)
    texts.forEach { t ->
        val font = Font(typeface(t.bold), t.size)
        val paint = Paint().apply { color = t.color }
        val line = TextLine.make(t.text, font)
        canvas.drawTextLine(line, if (t.anchorEnd) t.x - line.width else t.x, t.y, paint)
    }
    return surface.makeImageSnapshot().encodeToData(org.jetbrains.skia.EncodedImageFormat.PNG)?.bytes ?: error("не удалось получить PNG")
}

/** Puts the picture on the clipboard: paste it straight into Telegram or a document. */
private fun copyPng(svg: String) {
    runCatching {
        val image = javax.imageio.ImageIO.read(java.io.ByteArrayInputStream(renderPng(svg)))
        val transferable = object : java.awt.datatransfer.Transferable {
            override fun getTransferDataFlavors() = arrayOf(java.awt.datatransfer.DataFlavor.imageFlavor)
            override fun isDataFlavorSupported(f: java.awt.datatransfer.DataFlavor) = f == java.awt.datatransfer.DataFlavor.imageFlavor
            override fun getTransferData(f: java.awt.datatransfer.DataFlavor): Any = if (isDataFlavorSupported(f)) image else throw java.awt.datatransfer.UnsupportedFlavorException(f)
        }
        java.awt.Toolkit.getDefaultToolkit().systemClipboard.setContents(transferable, null)
    }.onSuccess { ru.t2sales.desktop.ui.components.T2Toast.show("Картинка скопирована: вставьте её в чат") }
        .onFailure { ru.t2sales.desktop.ui.components.T2Toast.show("Не удалось скопировать картинку", true) }
}

/** Saves the picture as a PNG on the desktop. */
private fun savePng(svg: String, name: String) {
    runCatching {
        val safe = name.replace(Regex("""[\\/:*?"<>|\s]+"""), "_")
        val desktop = java.nio.file.Paths.get(System.getProperty("user.home"), "Desktop").takeIf { java.nio.file.Files.isDirectory(it) } ?: java.nio.file.Paths.get(System.getProperty("user.home"))
        val file = desktop.resolve("T2-report-$safe.png")
        java.nio.file.Files.write(file, renderPng(svg))
        file
    }.onSuccess { ru.t2sales.desktop.ui.components.T2Toast.show("Сохранено на рабочем столе: ${it.fileName}") }
        .onFailure { ru.t2sales.desktop.ui.components.T2Toast.show("Не удалось сохранить картинку", true) }
}

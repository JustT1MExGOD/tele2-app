package ru.t2sales.android.ui

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color as AColor
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.caverock.androidsvg.SVG
import java.io.ByteArrayOutputStream
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import ru.t2sales.android.AppContainer
import ru.t2sales.shared.api.StoreInfo
import ru.t2sales.shared.theme.T2Colors

/** Renders the server's SVG to a bitmap [width] px wide (AndroidSVG draws text with the system fonts). Null when the SVG cannot be read. */
private fun renderSvg(svg: String, width: Int = 1080): Bitmap? = runCatching {
    val doc = SVG.getFromString(svg)
    val w = doc.documentWidth.takeIf { it > 0f } ?: doc.documentViewBox?.width() ?: 1080f
    val h = doc.documentHeight.takeIf { it > 0f } ?: doc.documentViewBox?.height() ?: 1920f
    val scale = width / w
    val bmp = Bitmap.createBitmap(width, (h * scale).toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bmp)
    canvas.drawColor(AColor.TRANSPARENT)
    canvas.scale(scale, scale)
    doc.renderToCanvas(canvas)
    bmp
}.getOrNull()

private fun png(bmp: Bitmap): ByteArray = ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()

/** Port of #page-reportimg: store + date -> GET /reports/day/:store, SVG frames (story: План / Факт / Завтра), each can be shared as a PNG. */
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
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 12.dp)) {
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
            busy -> Text("Генерируем…", color = T2Colors.hint, modifier = Modifier.padding(16.dp))
            message != null -> Text(message!!, color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(24.dp))
            frames != null -> Column(Modifier.padding(12.dp)) {
                frames!!.forEach { (label, svg) ->
                    val bmp = remember(svg) { renderSvg(svg) }
                    Column(Modifier.padding(bottom = 12.dp)) {
                        if (label != null) Text(label, color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(start = 2.dp, bottom = 6.dp))
                        if (bmp != null) Image(bmp.asImageBitmap(), contentDescription = label, contentScale = ContentScale.FillWidth, modifier = Modifier.fillMaxWidth())
                        else Text("Не удалось нарисовать картинку", color = T2Colors.danger, fontSize = 13.sp)
                        Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            MChipButton("Поделиться PNG") {
                                if (bmp == null) return@MChipButton
                                val name = (stores.firstOrNull { it.id == storeId }?.name ?: "точка") + "-" + date.trim() + (label?.let { "-$it" } ?: "")
                                FileShare.share("T2-report-$name.png", "image/png", png(bmp))
                            }
                        }
                    }
                }
            }
        }
    }
}

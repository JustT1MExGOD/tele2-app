package ru.t2sales.desktop.ui.analytics

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.CircularProgressIndicator
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import ru.t2sales.desktop.di.AppContainer
import ru.t2sales.desktop.ui.components.PageSection
import ru.t2sales.desktop.ui.components.T2Toast
import ru.t2sales.shared.theme.T2Colors

internal fun JsonElement?.obj(): JsonObject = this as? JsonObject ?: JsonObject(emptyMap())
internal fun JsonElement?.arr(): List<JsonElement> = (this as? JsonArray) ?: emptyList()
internal fun JsonElement?.dbl(): Double = (this as? JsonPrimitive)?.doubleOrNull ?: 0.0
internal fun JsonElement?.str(): String = (this as? JsonPrimitive)?.contentOrNull ?: ""
internal fun fmtN(v: Double) = if (v % 1.0 == 0.0) v.toLong().toString() else "%.1f".format(v)
internal fun colorOf(hex: String?): Color? = hex?.takeIf { it.isNotEmpty() }?.let { runCatching { Color(("FF" + it.removePrefix("#")).toLong(16)) }.getOrNull() }

/** Port of #page-live («Сеть сейчас»): a card per store with status color, plan %, staff, SIM/MNP and cash delta. */
@Composable
fun LiveScreen(container: AppContainer) {
    var data by remember { mutableStateOf<JsonObject?>(null) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { runCatching { container.analyticsApi.live() }.onSuccess { data = it }.onFailure { failed = true } }

    PageSection("Сеть сейчас") {
        val d = data
        when {
            failed -> Text("\uD83C\uDF49 Живая карта сети сейчас недоступна, зайди чуть позже", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
            d == null -> CircularProgressIndicator(modifier = Modifier.padding(16.dp))
            else -> {
                val today = LocalDate.now(ZoneId.of("Europe/Moscow")).toString()
                Text("Дата: ${d["date"].str().ifEmpty { today }} \u00B7 обновление при открытии экрана", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                val stores = d["stores"].arr()
                if (stores.isEmpty()) Text("Нет точек", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
                else BoxWithConstraints(modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 16.dp)) {
                    val cols = ((maxWidth + 10.dp) / (320.dp + 10.dp)).toInt().coerceAtLeast(1)
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        stores.chunked(cols).forEach { row ->
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
                                row.forEach { el -> Box(Modifier.weight(1f)) { StoreLive(el.obj()) } }
                                repeat(cols - row.size) { Spacer(Modifier.weight(1f)) }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StoreLive(st: JsonObject) {
    val status = st["status"].str()
    val statusColor = when (status) { "critical" -> Color(0xFFE74C3C); "warn" -> Color(0xFFF39C12); else -> Color(0xFF2ECC71) }
    val bar = colorOf(st["color"].str()) ?: statusColor
    val staff = st["staff"].arr().joinToString(", ") { s -> s.obj().let { it["short_name"].str().ifEmpty { it["full_name"].str().ifEmpty { it["employee_id"].str() } } } }.ifEmpty { "никого" }
    val fact = st["fact"].obj()
    val plan = st["plan"].obj()
    val cash = st["cash"] as? JsonObject
    Row(modifier = Modifier.fillMaxWidth().height(androidx.compose.foundation.layout.IntrinsicSize.Min).clip(RoundedCornerShape(4.dp)).clickable { ru.t2sales.desktop.ui.shell.AppNav.openStore(st["store_id"].str()) }) {
        Box(Modifier.width(4.dp).fillMaxHeight().background(bar))
        Column(modifier = Modifier.weight(1f).padding(start = 12.dp, top = 4.dp, bottom = 4.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(st["name"].str(), fontWeight = FontWeight.Bold)
                Text("${fmtN(st["plan_pct"].dbl())}%", color = statusColor, fontWeight = FontWeight.Bold)
            }
            Text(staff, color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
            Text("SIM ${fmtN(fact["sim"].dbl())}/${fmtN(plan["sim"].dbl())} \u00B7 MNP ${fmtN(fact["mnp"].dbl())}/${fmtN(plan["mnp"].dbl())}", color = T2Colors.hint, fontSize = 12.sp)
            Text(if (cash != null) "Касса \u0394 ${cash["delta"].str()}" else "Касса \u2014", color = T2Colors.hint, fontSize = 12.sp)
        }
    }
}

package ru.t2sales.desktop.ui.tools

import ru.t2sales.desktop.ui.components.LoadingBlock
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.CircularProgressIndicator
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.roundToLong
import kotlinx.coroutines.launch
import ru.t2sales.desktop.di.AppContainer
import ru.t2sales.desktop.ui.components.Field
import ru.t2sales.desktop.ui.components.MainButton
import ru.t2sales.desktop.ui.components.SheetDialog
import ru.t2sales.desktop.ui.components.T2Toast
import ru.t2sales.shared.api.PromoCardData
import ru.t2sales.shared.api.PromoListItem
import ru.t2sales.shared.theme.T2Colors

/** Global switch for the modal tools that the web opens from anywhere (openComboCalc / openSchoolCalc / openPromos). */
object ToolDialogs {
    var current by mutableStateOf<String?>(null)
    fun open(kind: String) { current = kind }
}

private val NF = NumberFormat.getInstance(Locale("ru", "RU"))
private fun rub(v: Long) = NF.format(v)

@Composable
fun ToolDialogHost(container: AppContainer) {
    when (ToolDialogs.current) {
        "combo" -> ComboCalc { ToolDialogs.current = null }
        "school" -> SchoolCalc { ToolDialogs.current = null }
        "promos" -> PromosDialog(container) { ToolDialogs.current = null }
    }
}

@Composable
private fun ResultCard(big: String, hint: String) {
    val shape = RoundedCornerShape(16.dp)
    Column(
        modifier = Modifier.padding(top = 16.dp).fillMaxWidth().clip(shape)
            .background(Brush.linearGradient(listOf(Color(0x263BB8F5), Color(0x1430D158))))
            .border(1.dp, Color(0x403BB8F5), shape).padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(big, color = T2Colors.primary, fontSize = 28.sp, fontWeight = FontWeight.ExtraBold)
        Text(hint, color = T2Colors.hint, fontSize = 12.sp, textAlign = TextAlign.Center, lineHeight = 17.sp, modifier = Modifier.padding(top = 6.dp))
    }
}

@Composable
private fun ComboCalc(onDismiss: () -> Unit) {
    var price by remember { mutableStateOf("") }
    var discount by remember { mutableStateOf("0") }
    var result by remember { mutableStateOf<Pair<String, String>?>(null) }
    SheetDialog("Расчёт комбо", onDismiss) {
        Text("Формула T2:\nцена \u2212 скидка% + 28% от цены + 1950", color = T2Colors.hint, fontSize = 14.sp, lineHeight = 20.sp, modifier = Modifier.padding(bottom = 12.dp))
        Field("Цена телефона, \u20BD", price, { v -> price = v.filter { it.isDigit() || it == '.' } }, placeholder = "29990", fill = T2Colors.surface2)
        Spacer(Modifier.height(14.dp))
        Field("Скидка, %", discount, { v -> discount = v.filter { it.isDigit() || it == '.' } }, fill = T2Colors.surface2)
        Spacer(Modifier.height(12.dp))
        MainButton("Посчитать", enabled = true) {
            val p = price.toDoubleOrNull() ?: 0.0
            val d = discount.toDoubleOrNull() ?: 0.0
            if (p <= 0) { T2Toast.show("Укажи цену", true); return@MainButton }
            val after = p * (1 - d / 100)
            val total = (after + p * 0.28 + 1950).roundToLong()
            result = "${rub(total)} \u20BD" to "${rub(p.roundToLong())} \u2212 ${d.let { if (it % 1.0 == 0.0) it.toLong().toString() else it.toString() }}% = ${rub(after.roundToLong())}\n+ 28% (${rub((p * 0.28).roundToLong())}) + 1 950"
        }
        result?.let { (big, hint) -> ResultCard(big, hint) }
    }
}

@Composable
private fun SchoolCalc(onDismiss: () -> Unit) {
    var price by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<Pair<String, String>?>(null) }
    SheetDialog("Калькулятор школа", onDismiss) {
        Text("Формула:\nцена \u2212 70% цены + 30% от цены + 3600 + 3490", color = T2Colors.hint, fontSize = 14.sp, lineHeight = 20.sp, modifier = Modifier.padding(bottom = 12.dp))
        Field("Цена телефона, \u20BD", price, { v -> price = v.filter { it.isDigit() || it == '.' } }, placeholder = "29990", fill = T2Colors.surface2)
        Spacer(Modifier.height(12.dp))
        MainButton("Посчитать", enabled = true) {
            val p = price.toDoubleOrNull() ?: 0.0
            if (p <= 0) { T2Toast.show("Укажи цену", true); return@MainButton }
            val afterCut = p - p * 0.7
            val bonus = p * 0.3
            val total = (afterCut + bonus + 3600 + 3490).roundToLong()
            result = "${rub(total)} \u20BD" to "${rub(p.roundToLong())} \u2212 70% = ${rub(afterCut.roundToLong())}\n+ 30% от цены (${rub(bonus.roundToLong())}) + 3 600 + 3 490"
        }
        result?.let { (big, hint) -> ResultCard(big, hint) }
    }
}

private sealed class PromoView {
    data object List : PromoView()
    data object Add : PromoView()
    class Card(val id: Int) : PromoView()
}

/** Port of features/promos: shared pool of masked promo codes, add form and a card revealing the full code. */
@Composable
private fun PromosDialog(container: AppContainer, onDismiss: () -> Unit) {
    val api = container.infoApi
    val scope = rememberCoroutineScope()
    var view by remember { mutableStateOf<PromoView>(PromoView.List) }
    var items by remember { mutableStateOf<kotlin.collections.List<PromoListItem>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var reload by remember { mutableStateOf(0) }
    var card by remember { mutableStateOf<PromoCardData?>(null) }
    var code by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }

    LaunchedEffect(reload) {
        if (view is PromoView.List) runCatching { api.promos().items }.onSuccess { items = it; failed = false }.onFailure { failed = true }
    }
    LaunchedEffect(view) {
        val v = view
        if (v is PromoView.Card) { card = null; runCatching { api.promoCard(v.id) }.onSuccess { card = it }.onFailure { T2Toast.show(it.message ?: "Ошибка", true); view = PromoView.List } }
    }
    fun back() { view = PromoView.List; reload++ }

    val title = when (view) { PromoView.Add -> "Новый промокод РТК"; is PromoView.Card -> "Промокод РТК"; else -> "Промокоды РТК" }
    SheetDialog(title, onDismiss) {
        when (val v = view) {
            PromoView.List -> {
                Text("Общий пул твоей сети. Коды скрыты \u2014 открой карточку, чтобы увидеть. Если использовал \u2014 отметь, код исчезнет из пула.", color = T2Colors.hint, fontSize = 14.sp, lineHeight = 20.sp, modifier = Modifier.padding(bottom = 12.dp))
                MainButton("+ Добавить промокод", enabled = true) { code = ""; note = ""; view = PromoView.Add }
                Spacer(Modifier.height(14.dp))
                val list = items
                when {
                    failed -> Text("\uD83C\uDF49 Промокоды сейчас недоступны, зайди чуть позже", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(16.dp))
                    list == null -> LoadingBlock()
                    list.isEmpty() -> Text("Пока пусто \u2014 добавь первый код", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(16.dp))
                    else -> list.forEach { it ->
                        val shape = RoundedCornerShape(14.dp)
                        Row(
                            modifier = Modifier.padding(bottom = 8.dp).fillMaxWidth().clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape).clickable { view = PromoView.Card(it.id) }.padding(14.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(it.mask.ifEmpty { "\u2022\u2022\u2022\u2022" }, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                                Text("${it.created_by_name ?: ""} \u00B7 ${it.created_at.take(10)}", color = T2Colors.hint, fontSize = 11.sp)
                            }
                            Text("\u203A", color = T2Colors.hint)
                        }
                    }
                }
            }
            PromoView.Add -> {
                Field("Промокод", code, { code = it }, placeholder = "XXXX-XXXX", fill = T2Colors.surface2)
                Spacer(Modifier.height(14.dp))
                Field("Заметка (необязательно)", note, { note = it }, placeholder = "откуда / для чего", fill = T2Colors.surface2)
                Spacer(Modifier.height(16.dp))
                MainButton("Сохранить", enabled = true) {
                    if (code.isBlank()) { T2Toast.show("Введи код", true); return@MainButton }
                    scope.launch {
                        runCatching { api.createPromo(code.trim(), note.trim()) }
                            .onSuccess { T2Toast.show("Добавлено"); back() }
                            .onFailure { T2Toast.show(it.message ?: "Ошибка", true) }
                    }
                }
                Spacer(Modifier.height(8.dp))
                MainButton("Назад к списку", enabled = true, container = T2Colors.surface2, content = T2Colors.text) { back() }
            }
            is PromoView.Card -> {
                val c = card
                if (c == null) LoadingBlock()
                else {
                    Text("Полный код (можно выделить):", color = T2Colors.hint, fontSize = 13.sp)
                    val shape = RoundedCornerShape(14.dp)
                    SelectionContainer {
                        Text(
                            c.code, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, fontFamily = FontFamily.Monospace, letterSpacing = 2.sp, textAlign = TextAlign.Center,
                            modifier = Modifier.padding(vertical = 12.dp).fillMaxWidth().clip(shape).background(Color(0x1F3BB8F5)).border(1.dp, Color(0x593BB8F5), shape).padding(16.dp)
                        )
                    }
                    c.note?.takeIf { it.isNotBlank() }?.let { Text(it, color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(bottom = 4.dp)) }
                    Text(c.created_by_name ?: "", color = T2Colors.hint, fontSize = 11.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp))
                    MainButton("Промокод использован", enabled = true) {
                        scope.launch { runCatching { api.markPromoUsed(v.id) }.onSuccess { T2Toast.show("Списан из пула"); back() }.onFailure { T2Toast.show("Ошибка", true) } }
                    }
                    Spacer(Modifier.height(8.dp))
                    MainButton("Не использован", enabled = true, container = T2Colors.surface2, content = T2Colors.text) {
                        scope.launch { runCatching { api.keepPromo(v.id) }; back() }
                    }
                }
            }
        }
    }
}

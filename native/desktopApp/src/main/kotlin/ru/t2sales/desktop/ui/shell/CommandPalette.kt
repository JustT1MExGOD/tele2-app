package ru.t2sales.desktop.ui.shell

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.t2sales.desktop.di.AppContainer
import ru.t2sales.desktop.ui.components.Motion
import ru.t2sales.desktop.ui.sales.AddSaleState
import ru.t2sales.desktop.ui.tools.ToolDialogs
import ru.t2sales.shared.api.EmployeeListItem
import ru.t2sales.shared.navigation.Screen
import ru.t2sales.shared.theme.T2Colors

/** Ctrl+K: jump to any screen, run an action, or start a sale for a colleague without touching the sidebar. */
object CommandPalette {
    var visible by mutableStateOf(false)
    fun toggle() { visible = !visible }
    fun close() { visible = false }
}

private class Cmd(val title: String, val hint: String, val kind: String, val keywords: String = "", val run: () -> Unit)

@Composable
fun CommandPaletteHost(container: AppContainer, role: String, isManager: Boolean, canManage: Boolean, onRefresh: () -> Unit) {
    if (!CommandPalette.visible) return
    var employees by remember { mutableStateOf<List<EmployeeListItem>>(emptyList()) }
    LaunchedEffect(canManage) {
        if (canManage) runCatching { container.teamApi.getEmployees() }.onSuccess { employees = it.filter { e -> e.is_active } }
    }

    val commands = remember(role, isManager, canManage, employees) {
        val go: (Screen) -> Unit = { AppNav.go(it) }
        buildList {
            navigationTargets(role, isManager).forEach { (section, label, screen) -> add(Cmd(label, section, "Экран") { go(screen) }) }
            fun tool(label: String, hint: String, screen: Screen, kw: String = "") = add(Cmd(label, hint, "Экран", kw) { go(screen) })
            tool("BFQ", "Рейтинг качества за месяц", Screen.Bfq)
            tool("Повтор месяца", "Гонка сотрудников по дням", Screen.Replay, "гонка replay анимация")
            tool("Heatmap часов", "Когда ставить сильного", Screen.Heatmap, "тепловая карта")
            tool("Прогноз и what-if", "7 дней · сценарии смен", Screen.Forecast)
            tool("Объявления", "Прочитал · обязательно", Screen.Announce)
            tool("Отчёт-картинка", "Итог дня", Screen.ReportImg, "svg png")
            tool("Отчёты", "Сводка по сети · экспорт", Screen.Reports, "csv экспорт")
            tool("Сеть live", "Кто на смене · % плана", Screen.Live)
            tool("Алерты", "Жизненный цикл алертов", Screen.Alerts, "уведомления")
            tool("План дня", "План на сегодня", Screen.PlanDay)
            tool("Планы и факт за месяц", "Видно всей команде", Screen.MonthPlan)
            tool("Динамика выполнения", "Все метрики", Screen.NetMonth)
            tool("История продаж", "Продажи по дням", Screen.History)
            tool("Поддержка", "Обращения", Screen.Support)
            add(Cmd("Расчёт комбо", "Телефон − скидка + 28% + 1950", "Инструмент", "калькулятор") { ToolDialogs.open("combo") })
            add(Cmd("Калькулятор школа", "Телефон − 70% + 30% + 3600 + 3490", "Инструмент") { ToolDialogs.open("school") })
            add(Cmd("Промокоды РТК", "Общий пул", "Инструмент") { ToolDialogs.open("promos") })
            add(Cmd("Внести продажу", "Ctrl+N", "Действие", "добавить новая") { AddSaleState.open() })
            add(Cmd("Сменить тему", "Светлая / тёмная", "Действие", "оформление dark light") {
                ThemePrefs.auto = false
                T2Colors.dark = !T2Colors.dark
                ThemePrefs.setDark(T2Colors.dark)
            })
            add(Cmd("Тема как в Windows", "Следовать светлой или тёмной теме системы", "Действие", "оформление авто system") { ThemePrefs.auto = true })
            add(Cmd("Обновить данные", "Перезагрузить экран", "Действие", "refresh") { onRefresh() })
            add(Cmd("Сохранить диагностику", "Файл с версиями и состоянием на рабочий стол", "Действие", "лог журнал debug logs") {
                runCatching { ru.t2sales.desktop.support.Diagnostics.export(container) }
                    .onSuccess { ru.t2sales.desktop.ui.components.T2Toast.show("Сохранено на рабочем столе: ${it.fileName}") }
                    .onFailure { ru.t2sales.desktop.ui.components.T2Toast.show("Не удалось сохранить диагностику", true) }
            })
            if (canManage) employees.forEach { e -> add(Cmd("Продажа: ${e.full_name}", "Внести продажу за сотрудника", "Сотрудник", "продажа") { AddSaleState.open(e.id) }) }
        }
    }

    var query by remember { mutableStateOf("") }
    var index by remember { mutableStateOf(0) }
    val results = remember(query, commands) { rank(commands, query) }
    LaunchedEffect(query) { index = 0 }

    val enter = remember { Animatable(0f) }
    LaunchedEffect(Unit) { enter.animateTo(1f, tween(Motion.PaletteMs, easing = Motion.Emphasized)) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    val listState = rememberLazyListState()
    LaunchedEffect(index) { if (results.isNotEmpty()) listState.animateScrollToItem((index - 3).coerceAtLeast(0)) }

    fun run(cmd: Cmd) { CommandPalette.close(); cmd.run() }

    Box(
        Modifier.fillMaxSize().graphicsLayer { alpha = enter.value }.background(Color.Black.copy(alpha = 0.45f))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { CommandPalette.close() },
        contentAlignment = Alignment.TopCenter
    ) {
        val shape = RoundedCornerShape(20.dp)
        Column(
            Modifier.padding(top = 96.dp).widthIn(max = 620.dp).fillMaxWidth(0.9f)
                .graphicsLayer { translationY = (1f - enter.value) * -14.dp.toPx(); scaleX = 0.97f + 0.03f * enter.value; scaleY = 0.97f + 0.03f * enter.value }
                .clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape)
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}
                .onPreviewKeyEvent { ev ->
                    if (ev.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                    when (ev.key) {
                        Key.Escape -> { CommandPalette.close(); true }
                        Key.DirectionDown -> { if (results.isNotEmpty()) index = (index + 1) % results.size; true }
                        Key.DirectionUp -> { if (results.isNotEmpty()) index = (index - 1 + results.size) % results.size; true }
                        Key.Enter, Key.NumPadEnter -> { results.getOrNull(index)?.let { run(it) }; true }
                        else -> false
                    }
                }
        ) {
            BasicTextField(
                value = query, onValueChange = { query = it }, singleLine = true,
                textStyle = TextStyle(color = T2Colors.text, fontSize = 17.sp), cursorBrush = SolidColor(T2Colors.primary),
                modifier = Modifier.fillMaxWidth().focusRequester(focus).padding(horizontal = 20.dp, vertical = 18.dp),
                decorationBox = { inner ->
                    Box {
                        if (query.isEmpty()) Text("Куда перейти или что сделать…", color = T2Colors.hint, fontSize = 17.sp)
                        inner()
                    }
                }
            )
            Box(Modifier.fillMaxWidth().height(1.dp).background(T2Colors.border))
            if (results.isEmpty()) {
                Text("Ничего не найдено", color = T2Colors.hint, modifier = Modifier.padding(20.dp))
            } else {
                LazyColumn(state = listState, modifier = Modifier.heightIn(max = 380.dp).padding(8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    itemsIndexed(results) { i, cmd ->
                        val sel = i == index
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
                                .background(if (sel) T2Colors.primarySoft else Color.Transparent)
                                .clickable { run(cmd) }.padding(horizontal = 12.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(cmd.title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = if (sel) T2Colors.primary else T2Colors.text)
                                Text(cmd.hint, color = T2Colors.hint, fontSize = 12.sp)
                            }
                            Spacer(Modifier.width(8.dp))
                            Text(cmd.kind.uppercase(), color = T2Colors.hint, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp)
                        }
                    }
                }
            }
            Row(Modifier.fillMaxWidth().background(T2Colors.surface2).padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                listOf("↑↓ выбор", "Enter открыть", "Esc закрыть").forEach { Text(it, color = T2Colors.hint, fontSize = 11.sp) }
            }
        }
    }
}

/** Every query word must appear in the title/hint/keywords; titles that start with the query rank first, then title hits, then the rest. */
private fun rank(all: List<Cmd>, query: String): List<Cmd> {
    val words = query.trim().lowercase().split(' ').filter { it.isNotEmpty() }
    if (words.isEmpty()) return all.filter { it.kind != "Сотрудник" }
    fun score(c: Cmd): Int? {
        val title = c.title.lowercase()
        val hay = "$title ${c.hint.lowercase()} ${c.keywords.lowercase()}"
        if (!words.all { hay.contains(it) }) return null
        return when {
            title.startsWith(words.first()) -> 0
            words.all { title.contains(it) } -> 1
            else -> 2
        }
    }
    return all.mapNotNull { c -> score(c)?.let { c to it } }.sortedBy { it.second }.map { it.first }.take(40)
}

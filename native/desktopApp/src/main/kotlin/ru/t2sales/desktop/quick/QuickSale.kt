package ru.t2sales.desktop.quick

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.ApplicationScope
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.WindowPosition
import androidx.compose.ui.window.rememberWindowState
import java.awt.Toolkit
import java.awt.event.WindowAdapter
import java.awt.event.WindowEvent
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import ru.t2sales.desktop.di.AppContainer
import ru.t2sales.desktop.system.AppWindow
import ru.t2sales.desktop.ui.components.Motion
import ru.t2sales.desktop.ui.components.T2Toast
import ru.t2sales.desktop.ui.components.reveal
import ru.t2sales.desktop.ui.sales.AddSaleState
import ru.t2sales.desktop.ui.shell.AppNav
import ru.t2sales.shared.api.ApiException
import ru.t2sales.shared.api.EmployeeListItem
import ru.t2sales.shared.theme.T2Colors

/** A small "type it and press Enter" window for entering a sale from anywhere (Ctrl+Alt+P), without opening the whole app. */
object QuickSale {
    var visible by mutableStateOf(false)

    /** The program that had the keyboard when the window was called: it gets it back afterwards, like a launcher. */
    private var previous: com.sun.jna.platform.win32.WinDef.HWND? = null

    /** Signed in: show the window. Not signed in: bring the main window (the sign-in screen) forward instead. */
    fun open() {
        if (!AppNav.signedIn) { AppWindow.show(); return }
        if (!visible) previous = runCatching { com.sun.jna.platform.win32.User32.INSTANCE.GetForegroundWindow() }.getOrNull()
        visible = true
    }

    fun close() {
        if (!visible) return
        visible = false
        previous?.let { runCatching { com.sun.jna.platform.win32.User32.INSTANCE.SetForegroundWindow(it) } }
        previous = null
    }
}

private const val WIDTH = 660
private const val HEIGHT = 290
private val MOSCOW = ZoneId.of("Europe/Moscow")

private enum class Stage { Typing, Sending, Done }

@Composable
fun ApplicationScope.QuickSaleHost(container: AppContainer, icon: Painter) {
    if (!QuickSale.visible) return
    val screen = remember { Toolkit.getDefaultToolkit().screenSize }
    val state = rememberWindowState(
        size = DpSize(WIDTH.dp, HEIGHT.dp),
        // upper third of the screen, horizontally centred: where a launcher window belongs
        position = WindowPosition(((screen.width - WIDTH) / 2).coerceAtLeast(0).dp, (screen.height * 0.16).toInt().dp)
    )
    Window(
        onCloseRequest = { QuickSale.close() },
        state = state, title = "Быстрая продажа", icon = icon,
        undecorated = true, transparent = true, resizable = false, alwaysOnTop = true,
        onPreviewKeyEvent = { ev ->
            if (ev.type == KeyEventType.KeyDown && ev.key == Key.Escape) { QuickSale.close(); true } else false
        }
    ) {
        var busy by remember { mutableStateOf(false) }
        // like a launcher: clicking anywhere else dismisses it (unless a send is in flight)
        DisposableEffect(window) {
            val l = object : WindowAdapter() { override fun windowLostFocus(e: WindowEvent) { if (!busy) QuickSale.close() } }
            window.addWindowFocusListener(l)
            onDispose { window.removeWindowFocusListener(l) }
        }
        LaunchedEffect(Unit) { window.toFront(); window.requestFocus() }
        // no T2Theme here: it paints an opaque page background, and this window must stay transparent around the card
        QuickSaleCard(container, onBusy = { busy = it })
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun QuickSaleCard(container: AppContainer, onBusy: (Boolean) -> Unit) {
    val scope = rememberCoroutineScope()
    val me = AppNav.myEmployeeId
    val canManage = AppNav.canManageSales
    var text by remember { mutableStateOf("") }
    var stage by remember { mutableStateOf(Stage.Typing) }
    var error by remember { mutableStateOf<String?>(null) }
    var doneText by remember { mutableStateOf("") }
    var employees by remember { mutableStateOf<List<EmployeeListItem>>(emptyList()) }
    val focus = remember { FocusRequester() }

    // colleagues' names for "иванов 3 аксы": managers only, from the server or (without a connection) the last saved copy
    LaunchedEffect(canManage) {
        if (!canManage) return@LaunchedEffect
        employees = runCatching { container.teamApi.getEmployees() }.getOrNull()
            ?: me?.let { container.saleFormCache.load(it)?.employees }.orEmpty()
    }
    LaunchedEffect(Unit) { delay(60); runCatching { focus.requestFocus() } }

    val target = remember(text, employees, canManage) { if (canManage) SaleText.splitEmployee(text, employees) else SaleText.WithEmployee(null, text) }
    val parsed = remember(target.rest) { SaleText.parse(target.rest) }
    val ready = parsed.metrics.isNotEmpty() && stage == Stage.Typing

    fun finish(message: String) {
        doneText = message
        stage = Stage.Done
        onBusy(false)
        AddSaleState.refreshTick++ // the open screens reload with the new sale
        scope.launch { delay(1200); QuickSale.close() }
    }

    fun submit() {
        if (!ready || me == null) return
        stage = Stage.Sending; error = null; onBusy(true)
        val forOther = target.employee?.id?.takeIf { it != me }
        val employeeId = forOther ?: me
        val clientId = UUID.randomUUID().toString()
        val summary = SaleText.summary(parsed.metrics) + (target.employee?.let { " · ${it.full_name}" } ?: "")
        scope.launch {
            val r = runCatching { container.profileApi.quickSale(target.rest, clientId, forOther) }
            val failure = r.exceptionOrNull()
            when {
                failure == null -> finish("Добавлено: $summary")
                failure is ApiException -> { error = failure.message.takeIf { it.isNotBlank() && it != "fail" } ?: "Сервер не принял продажу"; stage = Stage.Typing; onBusy(false) }
                else -> {
                    // no answer at all: keep the sale and send it when the connection is back (needs the employee's store from the last saved form)
                    val form = container.saleFormCache.load(me)
                    val store = form?.storeByEmployee?.get(employeeId) ?: form?.stores?.firstOrNull()?.id
                    if (store == null) {
                        error = "Нет связи, а точка неизвестна. Внесите продажу через «Добавить продажу», когда связь появится."
                        stage = Stage.Typing; onBusy(false)
                    } else {
                        val body = buildJsonObject {
                            put("employee_id", JsonPrimitive(employeeId))
                            put("store_id", JsonPrimitive(store))
                            put("sale_date", JsonPrimitive(LocalDate.now(MOSCOW).toString()))
                            put("client_id", JsonPrimitive(clientId))
                            parsed.metrics.forEach { (m, v) -> put(m, JsonPrimitive(if (v % 1.0 == 0.0) v.toLong() else v)) }
                        }
                        runCatching { container.outbox.enqueue(body, summary) }
                            .onSuccess { finish("Нет связи: сохранено и отправится само · $summary") }
                            .onFailure { error = "Не удалось сохранить продажу"; stage = Stage.Typing; onBusy(false) }
                    }
                }
            }
        }
    }

    // window-shaped: a soft margin around the card holds the shadow (the window itself is transparent)
    Box(Modifier.fillMaxSize().padding(16.dp)) {
        val shape = RoundedCornerShape(24.dp)
        val enter = remember { Animatable(0f) }
        LaunchedEffect(Unit) { enter.animateTo(1f, tween(Motion.PaletteMs, easing = Motion.Emphasized)) }
        Column(
            Modifier
                .graphicsLayer { alpha = enter.value; val s = 0.96f + 0.04f * enter.value; scaleX = s; scaleY = s; translationY = (1f - enter.value) * -10.dp.toPx() }
                .shadow(20.dp, shape)
                .clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape)
                .fillMaxWidth().padding(horizontal = 22.dp, vertical = 18.dp)
                .onPreviewKeyEvent { ev ->
                    if (ev.type == KeyEventType.KeyDown && (ev.key == Key.Enter || ev.key == Key.NumPadEnter)) { submit(); true } else false
                }
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("🍉", fontSize = 22.sp)
                Spacer(Modifier.width(12.dp))
                Box(Modifier.weight(1f)) {
                    if (text.isEmpty()) Text("2 сим 1 mnp 1 телефон", color = T2Colors.hint, fontSize = 22.sp)
                    BasicTextField(
                        value = text, onValueChange = { if (stage == Stage.Typing) { text = it; error = null } }, singleLine = true,
                        textStyle = TextStyle(color = T2Colors.text, fontSize = 22.sp, fontWeight = FontWeight.Medium),
                        cursorBrush = SolidColor(T2Colors.primary),
                        modifier = Modifier.fillMaxWidth().focusRequester(focus)
                    )
                }
            }
            Spacer(Modifier.height(14.dp))
            Box(Modifier.fillMaxWidth().height(1.dp).background(T2Colors.border))
            Spacer(Modifier.height(14.dp))

            when (stage) {
                Stage.Done -> DoneLine(doneText)
                else -> {
                    if (parsed.metrics.isNotEmpty() || target.employee != null) {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            target.employee?.let { e -> Chip("👤 ${e.full_name}", T2Colors.text, T2Colors.surface3) }
                            parsed.metrics.forEach { (m, v) ->
                                key(m) { Box(Modifier.reveal(0)) { Chip("${SaleText.label(m)} × ${SaleText.amount(v)}", T2Colors.primary, T2Colors.primarySoft) } }
                            }
                        }
                        if (parsed.unmatched.isNotEmpty()) {
                            Text("Не понял: ${parsed.unmatched.joinToString(" ")}", color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 10.dp))
                        }
                    } else if (text.isNotBlank()) {
                        Text("Не понял. Напишите число и что продано: «2 сим 1 mnp», «телефон 1», «аксы 1500».", color = T2Colors.hint, fontSize = 13.sp)
                    } else {
                        Text(
                            if (canManage) "Число и что продано. Для коллеги начните с фамилии: «петров 3 аксы»." else "Число и что продано: «две симки», «аксы 1500».",
                            color = T2Colors.hint, fontSize = 13.sp
                        )
                    }
                    error?.let { Text(it, color = T2Colors.danger, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 10.dp)) }
                }
            }

            Spacer(Modifier.height(16.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    when (stage) { Stage.Sending -> "Отправляем…"; Stage.Done -> ""; else -> if (ready) "Enter — внести" else "Esc — закрыть" },
                    color = if (ready) T2Colors.primary else T2Colors.hint, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f)
                )
                if (ready) Text("Esc — закрыть", color = T2Colors.hint, fontSize = 12.sp)
            }
        }
    }
}

@Composable
private fun Chip(label: String, color: Color, bg: Color) {
    Text(
        label, color = color, fontSize = 15.sp, fontWeight = FontWeight.Bold,
        modifier = Modifier.clip(RoundedCornerShape(12.dp)).background(bg).padding(horizontal = 12.dp, vertical = 8.dp)
    )
}

/** The confirmation: a green tick that draws itself in, then the text. */
@Composable
private fun DoneLine(text: String) {
    val a = remember { Animatable(0f) }
    LaunchedEffect(Unit) { a.animateTo(1f, tween(420, easing = Motion.Emphasized)) }
    Row(Modifier.graphicsLayer { alpha = a.value; translationY = (1f - a.value) * 10.dp.toPx() }, verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(34.dp).clip(RoundedCornerShape(99.dp)).background(T2Colors.successSoft), contentAlignment = Alignment.Center) {
            Text("✓", color = T2Colors.success, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
        }
        Spacer(Modifier.width(12.dp))
        Text(text, color = T2Colors.text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
    }
}

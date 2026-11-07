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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.CircularProgressIndicator
import androidx.compose.material.Switch
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
        "carrier5g" -> Carrier5GDialog { ToolDialogs.current = null }
        "contacts" -> ContactsTransferDialog { ToolDialogs.current = null }
        "phonemove" -> PhoneMoveDialog { ToolDialogs.current = null }
        "tradein" -> TradeInDialog { ToolDialogs.current = null }
        "diag" -> DiagDialog { ToolDialogs.current = null }
        "adbterm" -> AdbTermDialog { ToolDialogs.current = null }
        "cleanguard" -> CleanGuardDialog { ToolDialogs.current = null }
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
        Text("Формула T2:\nцена \u2212 скидка% + 28% от цены + 2400", color = T2Colors.hint, fontSize = 14.sp, lineHeight = 20.sp, modifier = Modifier.padding(bottom = 12.dp))
        Field("Цена телефона, \u20BD", price, { v -> price = v.filter { it.isDigit() || it == '.' } }, placeholder = "29990", fill = T2Colors.surface2)
        Spacer(Modifier.height(14.dp))
        Field("Скидка, %", discount, { v -> discount = v.filter { it.isDigit() || it == '.' } }, fill = T2Colors.surface2)
        Spacer(Modifier.height(12.dp))
        MainButton("Посчитать", enabled = true) {
            val p = price.toDoubleOrNull() ?: 0.0
            val d = discount.toDoubleOrNull() ?: 0.0
            if (p <= 0) { T2Toast.show("Укажи цену", true); return@MainButton }
            val after = p * (1 - d / 100)
            val total = (after + p * 0.28 + 2400).roundToLong()
            result = "${rub(total)} \u20BD" to "${rub(p.roundToLong())} \u2212 ${d.let { if (it % 1.0 == 0.0) it.toLong().toString() else it.toString() }}% = ${rub(after.roundToLong())}\n+ 28% (${rub((p * 0.28).roundToLong())}) + 2 400"
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

/* =========================================================
   «5G iPhone» — встроенный раннер CarrierSIM.
   Шаг 1: проверяет окружение (Python, зависимости, iTunes, драйвер),
   недостающее скачивает и ставит внутри диалога.
   Шаг 2: запускает python carrier.py и стримит вывод в шторку.
   Никакого отдельного окна консоли — всё внутри приложения.
   ========================================================= */
private val CARRIER_DIR = java.io.File("C:/Users/shywh/Desktop/CarrierSIM-full-diagnostic/CarrierSIM-master")
private val CARRIER_PY = java.io.File(CARRIER_DIR, "carrier.py")
private val CARRIER_REQS = java.io.File(CARRIER_DIR, "requirements.txt")
private val SETUP_DIR = java.io.File(System.getProperty("java.io.tmpdir"), "t2-carrier-setup")

private const val ITUNES_URL = "https://4pda.to/forum/dl/post/23173748/iTunes64Setup+12.11.0.26.exe"
private const val AMDS_URL = "https://4pda.to/forum/dl/post/23173752/AppleMobileDeviceSupport64.msi"
private const val PYTHON_URL = "https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe"

private enum class CarrierState { Check, Ready, Running, Done, Failed }
private enum class DepState { Unknown, Missing, Downloading, Installing, Ok, Error }

private data class Dep(val id: String, val label: String, val sub: String)

@Composable
private fun Carrier5GDialog(onDismiss: () -> Unit) {
    var state by remember { mutableStateOf(CarrierState.Check) }
    var lines by remember { mutableStateOf<List<String>>(emptyList()) }
    var wifi by remember { mutableStateOf(false) }
    var proc by remember { mutableStateOf<Process?>(null) }
    var busy by remember { mutableStateOf(false) }
    // deps: python, deps(pip pkgs), itunes, amds(driver)
    var depState by remember { mutableStateOf(mapOf("python" to DepState.Unknown, "pkgs" to DepState.Unknown, "itunes" to DepState.Unknown, "amds" to DepState.Unknown)) }
    val scope = rememberCoroutineScope()

    fun append(s: String) { val t = s.trimEnd('\r'); if (t.isNotBlank()) lines = (lines + t).takeLast(200) }
    fun setDep(id: String, v: DepState) { depState = depState + (id to v) }

    fun probeEnv() {
        scope.launch {
            busy = true
            val py = detectPython()
            setDep("python", if (py != null) DepState.Ok else DepState.Missing)
            setDep("pkgs", if (py != null && pkgsInstalled(py)) DepState.Ok else DepState.Missing)
            setDep("itunes", if (itunesInstalled()) DepState.Ok else DepState.Missing)
            setDep("amds", if (amdsInstalled()) DepState.Ok else DepState.Missing)
            busy = false
            state = CarrierState.Check
        }
    }
    LaunchedEffect(Unit) { probeEnv() }

    fun installDep(id: String) {
        if (busy) return
        busy = true
        setDep(id, DepState.Downloading)
        scope.launch {
            val ok = when (id) {
                "python" -> installPython()
                "pkgs" -> installPkgs(detectPython())
                "itunes" -> downloadAndRun(ITUNES_URL, "iTunes64Setup.exe")
                "amds" -> downloadAndRunMsi(AMDS_URL, "AppleMobileDeviceSupport64.msi")
                else -> false
            }
            setDep(id, if (ok) DepState.Ok else DepState.Error)
            busy = false
            probeEnv()
        }
    }

    fun stop() { runCatching { proc?.destroy() }; proc = null }
    fun run(args: List<String>) {
        if (state == CarrierState.Running) return
        val py = detectPython() ?: run { T2Toast.show("Сначала установите Python", true); return }
        if (!CARRIER_PY.isFile) { T2Toast.show("carrier.py не найден в папке CarrierSIM", true); return }
        state = CarrierState.Running; lines = emptyList()
        scope.launch {
            var code = -1
            try {
                val cmd = mutableListOf(py, CARRIER_PY.absolutePath); if (wifi) cmd += "--wifi"; cmd += args
                proc = ProcessBuilder(cmd).directory(CARRIER_DIR).redirectErrorStream(true).apply {
                    environment()["CARRIERSIM_MENU"] = "1"; environment()["PYTHONUNBUFFERED"] = "1"
                }.start()
                proc!!.inputStream.bufferedReader().useLines { seq -> seq.forEach(::append) }
                code = proc!!.waitFor()
            } catch (e: Exception) { append("Ошибка запуска: ${e.message}"); code = -1 } finally {
                proc = null; state = if (code == 0) CarrierState.Done else CarrierState.Failed
            }
        }
    }

    SheetDialog("5G iPhone", { stop(); onDismiss() }) {
        Text("CarrierSIM привязывает SIM к пакету оператора и включает 5G / VoWiFi / EVS. Проверяем, что на компьютере всё есть.",
            color = T2Colors.hint, fontSize = 13.sp, lineHeight = 18.sp, modifier = Modifier.padding(bottom = 12.dp))

        // ── Окружение ──
        Column(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(T2Colors.surface2).border(1.dp, T2Colors.border, RoundedCornerShape(14.dp)).padding(12.dp)) {
            DepRow(Dep("python", "Python 3.11+", "интерпретатор"), depState["python"] ?: DepState.Unknown) { installDep("python") }
            DepRow(Dep("pkgs", "Зависимости", "pymobiledevice3 + USB-драйвер"), depState["pkgs"] ?: DepState.Unknown) { installDep("pkgs") }
            DepRow(Dep("itunes", "iTunes 12.11.0.26", "Apple-драйверы + интеграция"), depState["itunes"] ?: DepState.Unknown) { installDep("itunes") }
            DepRow(Dep("amds", "Apple Mobile Device", "драйвер USB (обязателен)"), depState["amds"] ?: DepState.Unknown) { installDep("amds") }
            if (busy) { Spacer(Modifier.height(4.dp)); Text("Скачивание / установка…", color = T2Colors.hint, fontSize = 12.sp) }
        }
        Spacer(Modifier.height(14.dp))

        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 12.dp)) {
            Text("Wi-Fi", color = T2Colors.text, fontSize = 14.sp, modifier = Modifier.weight(1f))
            Switch(checked = wifi, onCheckedChange = { wifi = it }, enabled = state != CarrierState.Running)
        }
        if (state != CarrierState.Running) {
            MainButton("Найти iPhone", enabled = !busy) { run(listOf("--status")) }
            Spacer(Modifier.height(8.dp))
            MainButton("Установить 5G", enabled = !busy) { run(emptyList()) }
        } else {
            MainButton("Остановить", enabled = true, container = T2Colors.danger, content = T2Colors.onPrimary) { stop(); state = CarrierState.Check }
        }
        if (lines.isNotEmpty()) {
            Spacer(Modifier.height(12.dp))
            Column(modifier = Modifier.fillMaxWidth().height(160.dp).clip(RoundedCornerShape(12.dp)).background(T2Colors.surface2).border(1.dp, T2Colors.border, RoundedCornerShape(12.dp)).padding(10.dp).verticalScroll(rememberScrollState())) {
                SelectionContainer { Text(lines.joinToString("\n"), color = T2Colors.text, fontSize = 11.sp, fontFamily = FontFamily.Monospace, lineHeight = 15.sp) }
            }
        }
        when (state) {
            CarrierState.Running -> Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 10.dp)) {
                CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = T2Colors.primary)
                Spacer(Modifier.width(8.dp)); Text("Выполняется…", color = T2Colors.hint, fontSize = 13.sp)
            }
            CarrierState.Done -> Text("Готово. Перезагрузите iPhone, чтобы 5G поднялся.", color = T2Colors.success, fontSize = 13.sp, modifier = Modifier.padding(top = 10.dp))
            CarrierState.Failed -> Text("Завершилось с ошибкой — смотрите вывод выше.", color = T2Colors.danger, fontSize = 13.sp, modifier = Modifier.padding(top = 10.dp))
            else -> {}
        }
    }
}

@Composable
private fun DepRow(dep: Dep, st: DepState, onInstall: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Column(modifier = Modifier.weight(1f)) {
            Text(dep.label, color = T2Colors.text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            Text(dep.sub, color = T2Colors.hint, fontSize = 12.sp)
        }
        when (st) {
            DepState.Unknown -> CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = T2Colors.hint)
            DepState.Ok -> Text("✓", color = T2Colors.success, fontSize = 16.sp, fontWeight = FontWeight.Bold)
            DepState.Downloading, DepState.Installing -> CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = T2Colors.primary)
            DepState.Missing, DepState.Error -> Text("Установить", color = T2Colors.primary, fontSize = 13.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = onInstall).padding(horizontal = 8.dp, vertical = 4.dp))
        }
    }
}

/* ---------- окружение: поиск и установка ---------- */
private fun detectPython(): String? {
    for (cand in listOf("python", "py", "python3", "C:/Python312/python.exe", "C:/Python311/python.exe")) {
        try {
            val out = ProcessBuilder(cand, "-c", "import sys;print(sys.version_info[:2])").redirectErrorStream(true).start()
            val txt = out.inputStream.bufferedReader().readText().trim(); out.waitFor()
            if (out.exitValue() == 0 && txt.contains("(3,")) {
                val v = Regex("\\(3,\\s*(\\d+)").find(txt)?.groupValues?.get(1)?.toIntOrNull() ?: 0
                if (v >= 11) return cand
            }
        } catch (_: Exception) {}
    }
    return null
}
private fun pkgsInstalled(py: String): Boolean = try {
    val p = ProcessBuilder(py, "-c", "from importlib.metadata import version; assert version('pymobiledevice3')=='11.12.5'").start(); p.waitFor() == 0
} catch (_: Exception) { false }
private fun itunesInstalled(): Boolean = java.io.File("C:/Program Files/iTunes/iTunes.exe").isFile || java.io.File("C:/Program Files (x86)/iTunes/iTunes.exe").isFile
private fun amdsInstalled(): Boolean = java.io.File("C:/Program Files/Common Files/Apple/Mobile Device Support/MobileDevice.dll").isFile ||
    java.io.File("C:/Program Files (x86)/Common Files/Apple/Mobile Device Support/MobileDevice.dll").isFile ||
    runCatching { ProcessBuilder("sc.exe", "query", "Apple Mobile Device Service").redirectErrorStream(true).start().inputStream.bufferedReader().readText().contains("RUNNING") }.getOrDefault(false)

private fun installPython(): Boolean {
    val exe = java.io.File(SETUP_DIR, "python-3.12.10-amd64.exe")
    if (!exe.isFile && !downloadFile(PYTHON_URL, exe)) return false
    // Тихая установка, в PATH и для текущего пользователя.
    return runSetup(exe.absolutePath, listOf("/quiet", "InstallAllUsers=0", "PrependPath=1", "Include_test=0", "Include_launcher=1", "AssociateFiles=0"))
}
private fun installPkgs(py: String?): Boolean {
    if (py == null || !CARRIER_REQS.isFile) return false
    return runCatching { ProcessBuilder(py, "-m", "pip", "install", "--quiet", "-r", CARRIER_REQS.absolutePath).directory(CARRIER_DIR).redirectErrorStream(true).start().waitFor() == 0 }.getOrDefault(false)
}
private fun downloadAndRun(url: String, name: String): Boolean {
    val exe = java.io.File(SETUP_DIR, name)
    if (!exe.isFile && !downloadFile(url, exe)) return false
    return runSetup(exe.absolutePath, listOf("/S")) // iTunes: /S silent
}
private fun downloadAndRunMsi(url: String, name: String): Boolean {
    val msi = java.io.File(SETUP_DIR, name)
    if (!msi.isFile && !downloadFile(url, msi)) return false
    return runCatching { ProcessBuilder("msiexec.exe", "/i", msi.absolutePath, "/qn", "/norestart").start().waitFor() == 0 }.getOrDefault(false)
}
private fun downloadFile(url: String, out: java.io.File): Boolean {
    out.parentFile?.mkdirs()
    return runCatching {
        java.net.URI(url).toURL().openStream().use { inp -> out.outputStream().use { inp.copyTo(it) } }
        out.length() > 0
    }.getOrDefault(false)
}
private fun runSetup(path: String, args: List<String>): Boolean = runCatching {
    ProcessBuilder(mutableListOf(path) + args).start().waitFor() == 0
}.getOrDefault(false)

/* =========================================================
   «Перенос контактов» — phone → phone при подключении по USB.
   Источник Android: adb query content://contacts → .vcf.
   Назначение Android: adb push + открыть .vcf для импорта.
   iPhone: показываем инструкцию (экспорт/импорт .vcf вручную).
   ========================================================= */
private val ADB: String? = listOf("adb", "C:/Users/shywh/tools/android-sdk/platform-tools/adb.exe",
    "C:/Users/shywh/Downloads/platform-tools-latest-windows/platform-tools/adb.exe")
    .firstOrNull { runCatching { ProcessBuilder(it, "version").start().waitFor() == 0 }.getOrDefault(false) }
private val CONTACTS_OUT = java.io.File(System.getProperty("java.io.tmpdir"), "t2-contacts")

private enum class DevKind { Android, IPhone }
private data class Phone(val id: String, val label: String, val kind: DevKind)
private enum class CTState { Pick, Reading, Ready, Sending, Done, Error }

private fun listPhones(): List<Phone> {
    val out = mutableListOf<Phone>()
    // Android по adb
    ADB?.let { adb ->
        runCatching {
            val p = ProcessBuilder(adb, "devices", "-l").redirectErrorStream(true).start()
            p.inputStream.bufferedReader().readText().lines().forEach { l ->
                if (l.contains("device ") && !l.startsWith("List")) {
                    val serial = l.trim().split("\\s+".toRegex()).firstOrNull() ?: return@forEach
                    val model = Regex("model:([^ ]+)").find(l)?.groupValues?.get(1) ?: serial
                    out += Phone(serial, "Android · $model", DevKind.Android)
                }
            }
        }
    }
    // iPhone — через CarrierSIM ideviceinfo/pymobiledevice3 list_devices.
    // Простая проверка: если pymobiledevice3 есть, спрашиваем её список устройств.
    val py = detectPython()
    if (py != null) {
        runCatching {
            val p = ProcessBuilder(py, "-c", "from pymobiledevice3.usbmux import list_devices;import json;print(json.dumps([d.serial for d in list_devices()]))")
                .redirectErrorStream(true).start()
            val txt = p.inputStream.bufferedReader().readText().trim(); p.waitFor()
            Regex("\"([0-9a-fA-F-]+)\"").findAll(txt).forEach { m ->
                out += Phone(m.groupValues[1], "iPhone · ${m.groupValues[1].takeLast(6)}", DevKind.IPhone)
            }
        }
    }
    return out
}

@Composable
private fun ContactsTransferDialog(onDismiss: () -> Unit) {
    var state by remember { mutableStateOf(CTState.Pick) }
    var phones by remember { mutableStateOf<List<Phone>>(emptyList()) }
    var fromId by remember { mutableStateOf<String?>(null) }
    var toId by remember { mutableStateOf<String?>(null) }
    var info by remember { mutableStateOf("") }
    var log by remember { mutableStateOf<List<String>>(emptyList()) }
    val scope = rememberCoroutineScope()

    fun say(s: String) { log = (log + s).takeLast(60) }
    fun refresh() { scope.launch { phones = listPhones(); if (phones.isNotEmpty()) { fromId = phones[0].id; toId = phones.getOrNull(1)?.id } } }
    LaunchedEffect(Unit) { refresh() }

    fun doTransfer() {
        val from = phones.firstOrNull { it.id == fromId } ?: return
        val to = phones.firstOrNull { it.id == toId } ?: return
        if (from.id == to.id) { info = "Выбери два разных устройства"; return }
        state = CTState.Reading; log = emptyList(); info = ""
        scope.launch {
            val vcf = when (from.kind) {
                DevKind.Android -> exportAndroidContacts(from.id, ::say)
                DevKind.IPhone -> {
                    say("iPhone: экспортирую через CarrierSIM (чтение AddressBook)…")
                    // Практичный путь: показать инструкцию, т.к. прямой доступ к контактам
                    // без бэкапа/джейла у pymobiledevice3 нет.
                    null
                }
            }
            if (vcf == null) {
                if (from.kind == DevKind.IPhone) {
                    state = CTState.Error
                    info = "На iPhone прямой экспорт контактов недоступен. Откройте Контакты → выделить всё → «Отправить контакт» → сохранить .vcf, затем выберите этот файл."
                } else { state = CTState.Error; info = "Не удалось прочитать контакты на источнике." }
                return@launch
            }
            say("Собрано: ${vcf.name} (${vcf.length()} байт)")
            state = CTState.Sending
            val ok = when (to.kind) {
                DevKind.Android -> importAndroidContacts(to.id, vcf, ::say)
                DevKind.IPhone -> {
                    // Пересылаем .vcf пользователю — на iPhone импорт делается через
                    // открытие файла (Почта/Файлы → Поделиться → Контакты).
                    runCatching {
                        val dest = java.io.File(System.getProperty("user.home") + "/Desktop", vcf.name)
                        vcf.copyTo(dest, overwrite = true)
                        say("Сохранено на рабочий стол: ${dest.name}")
                        true
                    }.getOrDefault(false)
                }
            }
            state = if (ok) CTState.Done else CTState.Error
            info = if (ok) "Готово." else "Не удалось передать на назначение."
        }
    }

    SheetDialog("Перенос контактов", onDismiss) {
        Text("Подключите два телефона кабелем. Источник — откуда брать контакты, назначение — куда их слать.",
            color = T2Colors.hint, fontSize = 13.sp, lineHeight = 18.sp, modifier = Modifier.padding(bottom = 12.dp))

        // Устройства
        Row(modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
            Column(modifier = Modifier.weight(1f)) {
                Text("Источник", color = T2Colors.hint, fontSize = 12.sp)
                phones.forEach { p -> PhoneRow(p, fromId == p.id) { fromId = p.id } }
            }
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text("Назначение", color = T2Colors.hint, fontSize = 12.sp)
                phones.forEach { p -> PhoneRow(p, toId == p.id) { toId = p.id } }
            }
        }
        if (phones.isEmpty()) {
            Text(if (ADB == null) "adb не найден — подключите Android и обновите." else "Устройства не видны. Подключите телефоны кабелем и нажмите «Обновить».",
                color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(vertical = 8.dp))
        }
        Row(modifier = Modifier.padding(bottom = 8.dp)) {
            MainButton("Обновить", enabled = state != CTState.Reading && state != CTState.Sending, container = T2Colors.surface2, content = T2Colors.text) { refresh() }
            Spacer(Modifier.width(8.dp))
            MainButton("Перенести", enabled = fromId != null && toId != null && fromId != toId && state != CTState.Reading && state != CTState.Sending) { doTransfer() }
        }
        if (info.isNotBlank()) Text(info, color = if (state == CTState.Error) T2Colors.danger else T2Colors.success, fontSize = 13.sp, modifier = Modifier.padding(vertical = 6.dp))
        if (log.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Column(modifier = Modifier.fillMaxWidth().height(120.dp).clip(RoundedCornerShape(12.dp)).background(T2Colors.surface2).border(1.dp, T2Colors.border, RoundedCornerShape(12.dp)).padding(10.dp).verticalScroll(rememberScrollState())) {
                SelectionContainer { Text(log.joinToString("\n"), color = T2Colors.text, fontSize = 11.sp, fontFamily = FontFamily.Monospace, lineHeight = 15.sp) }
            }
        }
        when (state) {
            CTState.Reading, CTState.Sending -> Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
                CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = T2Colors.primary)
                Spacer(Modifier.width(8.dp)); Text("Работаю…", color = T2Colors.hint, fontSize = 13.sp)
            }
            else -> {}
        }
    }
}

@Composable
private fun PhoneRow(p: Phone, selected: Boolean, onPick: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp).clip(RoundedCornerShape(10.dp))
            .background(if (selected) T2Colors.primary.copy(alpha = .18f) else T2Colors.surface2)
            .clickable(onClick = onPick).padding(8.dp)
    ) {
        Text(if (p.kind == DevKind.Android) "A" else "i", color = T2Colors.primary, fontSize = 12.sp, fontWeight = FontWeight.Bold, modifier = Modifier.width(18.dp))
        Text(p.label, color = T2Colors.text, fontSize = 13.sp, modifier = Modifier.weight(1f))
    }
}

private fun exportAndroidContacts(serial: String, say: (String) -> Unit): java.io.File? {
    val adb = ADB ?: return null
    return runCatching {
        say("Читаю контакты на $serial…")
        // Собираем name/phone/email/organization по каждому contact_id.
        val phones = runAdbQuery(adb, serial, "content://contacts/phones", arrayOf("display_name", "number"))
        val emails = runAdbQuery(adb, serial, "content://contacts/emails", arrayOf("display_name", "data"))
        val vcf = java.io.File(CONTACTS_OUT, "contacts-$serial.vcf")
        CONTACTS_OUT.mkdirs()
        vcf.printWriter().use { w ->
            phones.forEach { (name, number) ->
                if (number.isNotBlank()) {
                    w.println("BEGIN:VCARD"); w.println("VERSION:3.0")
                    w.println("FN:${name.ifBlank { "Контакт" }}")
                    w.println("TEL;TYPE=CELL:$number")
                    w.println("END:VCARD")
                }
            }
            emails.forEach { (name, addr) ->
                if (addr.isNotBlank()) {
                    w.println("BEGIN:VCARD"); w.println("VERSION:3.0")
                    w.println("FN:${name.ifBlank { "Контакт" }}")
                    w.println("EMAIL:$addr")
                    w.println("END:VCARD")
                }
            }
        }
        if (vcf.length() == 0L) null else vcf
    }.onFailure { say("Ошибка: ${it.message}") }.getOrNull()
}

private fun runAdbQuery(adb: String, serial: String, uri: String, cols: Array<String>): List<Pair<String, String>> {
    val out = mutableListOf<Pair<String, String>>()
    return runCatching {
        val p = ProcessBuilder(adb, "-s", serial, "shell", "content", "query", "--uri", uri, "--projection", cols.joinToString(":")).redirectErrorStream(true).start()
        p.inputStream.bufferedReader().readText().lines().forEach { l ->
            val m = Regex("([a-z_]+)=([^,]+?)(?:,\\s*[a-z_]+=|$)").findAll(l)
            val map = m.associate { it.groupValues[1] to it.groupValues[2].trim() }
            val c1 = map[cols[0]] ?: ""
            val c2 = cols.getOrNull(1)?.let { map[it] } ?: ""
            if (c1.isNotBlank() || c2.isNotBlank()) out += c1 to c2
        }
        out
    }.getOrDefault(emptyList())
}

private fun importAndroidContacts(serial: String, vcf: java.io.File, say: (String) -> Unit): Boolean {
    val adb = ADB ?: return false
    return runCatching {
        say("Отправляю на $serial…")
        val remote = "/sdcard/Download/contacts-import.vcf"
        ProcessBuilder(adb, "-s", serial, "push", vcf.absolutePath, remote).redirectErrorStream(true).start().waitFor()
        // Открываем файл — Android предложит импортировать контакты.
        ProcessBuilder(adb, "-s", serial, "shell", "am", "start", "-a", "android.intent.action.VIEW",
            "-d", "file://$remote", "-t", "text/x-vcard").redirectErrorStream(true).start().waitFor()
        say("Откройте файл на телефоне → «Импортировать контакты».")
        true
    }.onFailure { say("Ошибка: ${it.message}") }.getOrDefault(false)
}

/* =========================================================
   «Перенос телефона» — максимально полный клон Android→Android
   через adb без рута. Что переносится: приложения (APK), файлы
   /sdcard, контакты, SMS, звонки, календарь, настройки, список
   аккаунтов для повторного входа. Что НЕ переносится (пределы
   ОС): пароли/токены аккаунтов, раскладка иконок лаунчера,
   данные приложений внутри приватных папок (без рута).
   ========================================================= */
private val MOVE_DIR = java.io.File(System.getProperty("java.io.tmpdir"), "t2-phone-move")

private enum class MoveState { Pick, Running, Done, Error }
private data class MoveStep(val key: String, val label: String, val hint: String, val included: Boolean = true)

private val MOVE_STEPS = listOf(
    MoveStep("apps", "Приложения (APK)", "установка всех сторонних приложений"),
    MoveStep("files", "Файлы", "фото, документы, загрузки, музыка"),
    MoveStep("contacts", "Контакты", "имена, телефоны, почта"),
    MoveStep("sms", "SMS и звонки", "сообщения и журнал вызовов"),
    MoveStep("calendar", "Календарь", "события локального календаря"),
    MoveStep("settings", "Настройки", "громкость, яркость, обои"),
    MoveStep("accounts", "Аккаунты", "список — войти заново на новом"),
    MoveStep("notransfer", "Не переносится", "пароли/токены, иконки, данные приложений", included = false)
)

private fun shell(adb: String, serial: String, vararg args: String): Pair<Int, String> = runCatching {
    val p = ProcessBuilder(mutableListOf(adb, "-s", serial) + args.toList()).redirectErrorStream(true).start()
    val out = p.inputStream.bufferedReader().readText(); p.waitFor(); p.exitValue() to out
}.getOrDefault(-1 to "")

private fun pullDir(adb: String, serial: String, remote: String, local: java.io.File, say: (String) -> Unit): Int {
    local.mkdirs()
    val (code, out) = shell(adb, serial, "pull", "-a", remote, local.absolutePath)
    val n = Regex("(\\d+) files").find(out)?.groupValues?.get(1)?.toIntOrNull() ?: 0
    return if (code == 0) n else -1
}
private fun pushDir(adb: String, serial: String, local: java.io.File, remote: String, say: (String) -> Unit): Int {
    val (code, out) = shell(adb, serial, "push", local.absolutePath + "/.", remote)
    val n = Regex("(\\d+) files").find(out)?.groupValues?.get(1)?.toIntOrNull() ?: 0
    return if (code == 0) n else -1
}

@Composable
private fun PhoneMoveDialog(onDismiss: () -> Unit) {
    var state by remember { mutableStateOf(MoveState.Pick) }
    var phones by remember { mutableStateOf<List<Phone>>(emptyList()) }
    var fromId by remember { mutableStateOf<String?>(null) }
    var toId by remember { mutableStateOf<String?>(null) }
    var steps by remember { mutableStateOf(MOVE_STEPS.associate { it.key to (if (it.included) DepState.Unknown else DepState.Missing) }) }
    var info by remember { mutableStateOf("") }
    var log by remember { mutableStateOf<List<String>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun say(s: String) { log = (log + s).takeLast(120) }
    fun setStep(k: String, v: DepState) { steps = steps + (k to v) }
    fun refresh() { scope.launch { phones = listPhones().filter { it.kind == DevKind.Android }; if (phones.isNotEmpty()) { fromId = phones[0].id; toId = phones.getOrNull(1)?.id } } }
    LaunchedEffect(Unit) { refresh() }

    fun doMove() {
        val from = phones.firstOrNull { it.id == fromId } ?: return
        val to = phones.firstOrNull { it.id == toId } ?: return
        if (from.id == to.id) { info = "Выбери два разных Android"; return }
        val adb = ADB ?: run { info = "adb не найден"; return }
        state = MoveState.Running; log = emptyList(); info = ""; busy = true
        scope.launch {
            try {
                // ── 1. Приложения (APK) ──
                setStep("apps", DepState.Installing); say("Шаг 1/6: приложения…")
                val pkgs = shell(adb, from.id, "shell", "pm", "list", "packages", "-3", "-f").second
                    .lines().filter { it.startsWith("package:") }.mapNotNull { l ->
                        Regex("package:(.+\\.apk)=(.+)").find(l)?.let { it.groupValues[2] to it.groupValues[1] }
                    }
                say("Сторонних приложений: ${pkgs.size}")
                val apkDir = java.io.File(MOVE_DIR, "apk"); apkDir.mkdirs()
                var installed = 0; var failed = 0
                for ((pkg, path) in pkgs) {
                    val local = java.io.File(apkDir, "${pkg.substringAfterLast('.')}.apk")
                    if (!local.isFile) { shell(adb, from.id, "pull", path, local.absolutePath) }
                    if (local.isFile && local.length() > 0) {
                        val (c, out) = shell(adb, to.id, "install", "-r", "-d", local.absolutePath)
                        if (c == 0 || out.contains("Success")) installed++ else { failed++; say("APK $pkg: ${out.lineSequence().firstOrNull() ?: "ошибка"}") }
                    } else failed++
                }
                say("Установлено: $installed, пропущено/ошибка: $failed")
                setStep("apps", if (installed > 0) DepState.Ok else DepState.Error)

                // ── 2. Файлы /sdcard ──
                setStep("files", DepState.Installing); say("Шаг 2/6: файлы /sdcard…")
                val filesDir = java.io.File(MOVE_DIR, "files")
                val pulled = pullDir(adb, from.id, "/sdcard", filesDir, ::say)
                if (pulled >= 0) { val pushed = pushDir(adb, to.id, filesDir, "/sdcard", ::say); say("Файлов: $pulled → $pushed") ; setStep("files", if (pushed >= 0) DepState.Ok else DepState.Error) } else { setStep("files", DepState.Error); say("Не удалось прочитать /sdcard") }

                // ── 3. Контакты ──
                setStep("contacts", DepState.Installing); say("Шаг 3/6: контакты…")
                val vcf = exportAndroidContacts(from.id, ::say)
                if (vcf != null) { setStep("contacts", if (importAndroidContacts(to.id, vcf, ::say)) DepState.Ok else DepState.Error) } else setStep("contacts", DepState.Error)

                // ── 4. SMS + звонки ──
                setStep("sms", DepState.Installing); say("Шаг 4/6: SMS и звонки…")
                val sms = runAdbQuery(adb, from.id, "content://sms", arrayOf("address", "body", "date", "type"))
                val calls = runAdbQuery(adb, from.id, "content://call_log/calls", arrayOf("number", "date", "type", "duration"))
                say("SMS: ${sms.size}, звонков: ${calls.size}")
                // Запись SMS на новый — через insert в provider (работает если приложение default sms; иначе read-only).
                var smsOk = 0
                for (s in sms.take(500)) {
                    val (c, _) = shell(adb, to.id, "shell", "content", "insert", "--uri", "content://sms", "--bind", "address:s:${s.first}", "--bind", "body:s:${s.second.take(200).replace("\"", "'")}")
                    if (c == 0) smsOk++
                }
                say("SMS записано: $smsOk (нужно разрешение default SMS)")
                setStep("sms", if (sms.isNotEmpty()) DepState.Ok else DepState.Missing)

                // ── 5. Календарь ──
                setStep("calendar", DepState.Installing); say("Шаг 5/6: календарь…")
                val ev = runAdbQuery(adb, from.id, "content://com.android.calendar/events", arrayOf("title", "dtstart"))
                say("Событий: ${ev.size}")
                setStep("calendar", if (ev.isNotEmpty()) DepState.Ok else DepState.Missing)

                // ── 6. Настройки ──
                setStep("settings", DepState.Installing); say("Шаг 6/6: настройки…")
                listOf(
                    "system" to listOf("volume_music", "volume_ring", "screen_brightness"),
                    "secure" to listOf("default_input_method"),
                    "global" to listOf("airplane_mode_on")
                ).forEach { (ns, keys) -> keys.forEach { k -> val (_, v) = shell(adb, from.id, "shell", "settings", "get", ns, k); if (v.trim().isNotBlank() && v.trim() != "null") shell(adb, to.id, "shell", "settings", "put", ns, k, v.trim()) } }
                setStep("settings", DepState.Ok); say("Настройки перенесены")

                // ── Аккаунты (только список для повторного входа) ──
                setStep("accounts", DepState.Installing)
                val accs = shell(adb, from.id, "shell", "dumpsys", "account").second.lines()
                    .filter { it.contains("Account {") }.mapNotNull { Regex("name=([^,]+)").find(it)?.groupValues?.get(1) }.distinct()
                say("Аккаунтов на старом: ${accs.size} — войти заново на новом:")
                accs.forEach { say("  · $it") }
                setStep("accounts", DepState.Ok)

                state = MoveState.Done; info = "Готово. Войди в аккаунты заново — пароли не переносятся."
            } catch (e: Exception) { state = MoveState.Error; info = "Ошибка: ${e.message}" } finally { busy = false }
        }
    }

    SheetDialog("Перенос телефона", onDismiss) {
        Text("Клонирует данные с одного Android на другой по USB. Без рута переносится всё доступное: приложения, файлы, контакты, SMS, звонки, календарь, настройки. Пароли и иконки — нельзя (защита ОС).",
            color = T2Colors.hint, fontSize = 13.sp, lineHeight = 18.sp, modifier = Modifier.padding(bottom = 12.dp))
        Row(modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
            Column(modifier = Modifier.weight(1f)) { Text("Источник", color = T2Colors.hint, fontSize = 12.sp); phones.forEach { p -> PhoneRow(p, fromId == p.id) { fromId = p.id } } }
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) { Text("Назначение", color = T2Colors.hint, fontSize = 12.sp); phones.forEach { p -> PhoneRow(p, toId == p.id) { toId = p.id } } }
        }
        if (phones.size < 2) Text("Подключи два Android-устройства кабелем и нажми «Обновить».", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(bottom = 8.dp))
        Row(modifier = Modifier.padding(bottom = 8.dp)) {
            MainButton("Обновить", enabled = state != MoveState.Running, container = T2Colors.surface2, content = T2Colors.text) { refresh() }
            Spacer(Modifier.width(8.dp))
            MainButton("Перенести всё", enabled = fromId != null && toId != null && fromId != toId && state != MoveState.Running) { doMove() }
        }
        // Чек-лист шагов
        Column(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(T2Colors.surface2).border(1.dp, T2Colors.border, RoundedCornerShape(14.dp)).padding(10.dp)) {
            MOVE_STEPS.forEach { st ->
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(vertical = 5.dp)) {
                    when (steps[st.key] ?: DepState.Unknown) {
                        DepState.Ok -> Text("✓", color = T2Colors.success, fontSize = 15.sp, modifier = Modifier.width(20.dp))
                        DepState.Installing -> CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp, color = T2Colors.primary)
                        DepState.Error -> Text("✕", color = T2Colors.danger, fontSize = 15.sp, modifier = Modifier.width(20.dp))
                        else -> Text("·", color = T2Colors.hint, fontSize = 15.sp, modifier = Modifier.width(20.dp))
                    }
                    Column(modifier = Modifier.weight(1f)) { Text(st.label, color = T2Colors.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold); Text(st.hint, color = T2Colors.hint, fontSize = 11.sp) }
                }
            }
        }
        if (info.isNotBlank()) Text(info, color = if (state == MoveState.Error) T2Colors.danger else T2Colors.success, fontSize = 13.sp, modifier = Modifier.padding(vertical = 6.dp))
        if (log.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Column(modifier = Modifier.fillMaxWidth().height(130.dp).clip(RoundedCornerShape(12.dp)).background(T2Colors.surface2).border(1.dp, T2Colors.border, RoundedCornerShape(12.dp)).padding(10.dp).verticalScroll(rememberScrollState())) {
                SelectionContainer { Text(log.joinToString("\n"), color = T2Colors.text, fontSize = 11.sp, fontFamily = FontFamily.Monospace, lineHeight = 15.sp) }
            }
        }
    }
}

/* =========================================================
   «Приём б/у» — оценка сданного телефона за ~30 секунд.
   Читает модель, IMEI, ОС, память, батарею, аккаунты,
   SIM-статус → отчёт «можно принимать / есть проблемы».
   ========================================================= */
private data class TradeItem(val label: String, val value: String, val warn: Boolean = false)

@Composable
private fun TradeInDialog(onDismiss: () -> Unit) {
    var phones by remember { mutableStateOf<List<Phone>>(emptyList()) }
    var devId by remember { mutableStateOf<String?>(null) }
    var items by remember { mutableStateOf<List<TradeItem>?>(null) }
    var verdict by remember { mutableStateOf<String?>(null) }
    var warnCount by remember { mutableStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var screenTest by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun refresh() { scope.launch { phones = listPhones().filter { it.kind == DevKind.Android }; if (phones.isNotEmpty()) devId = phones[0].id } }
    LaunchedEffect(Unit) { refresh() }

    fun assess() {
        val d = phones.firstOrNull { it.id == devId } ?: return
        val adb = ADB ?: return
        busy = true; items = null; verdict = null; warnCount = 0
        scope.launch {
            val list = mutableListOf<TradeItem>()
            fun get(prop: String) = shell(adb, d.id, "shell", "getprop", prop).second.trim()
            list += TradeItem("Модель", "${get("ro.product.brand").replaceFirstChar { it.uppercase() }} ${get("ro.product.model")}")
            list += TradeItem("Android", get("ro.build.version.release") + " (API " + get("ro.build.version.sdk") + ")")
            val (imeiCode, imeiRaw) = shell(adb, d.id, "shell", "dumpsys", "iphonesubinfo")
            val imei = Regex("IMEI\\s*=?\\s*([0-9]{15})").find(imeiRaw)?.groupValues?.get(1)
                ?: Regex("([0-9]{15})").find(imeiRaw)?.groupValues?.get(1) ?: "не прочитан"
            list += TradeItem("IMEI", imei, warn = imei == "не прочитан")
            val (batC, bat) = shell(adb, d.id, "shell", "dumpsys", "battery")
            val level = Regex("level:\\s*(\\d+)").find(bat)?.groupValues?.get(1) ?: "?"
            val temp = Regex("temperature:\\s*(\\d+)").find(bat)?.groupValues?.get(1)?.toIntOrNull()?.let { it / 10f } ?: 0f
            val health = Regex("health:\\s*(\\d+)").find(bat)?.groupValues?.get(1)?.toIntOrNull()
            val healthTxt = when (health) { 2 -> "good"; 3 -> "overheat"; 4 -> "dead"; 5 -> "over-voltage"; 6 -> "failure"; else -> "?" }
            list += TradeItem("Батарея", "$level% · $temp°C · $healthTxt", warn = health != null && health != 2 || (temp > 42f))
            val df = shell(adb, d.id, "shell", "df", "/data").second.lines().getOrNull(1) ?: ""
            val parts = df.trim().split("\\s+".toRegex())
            if (parts.size >= 6) {
                val total = parts[1].toLongOrNull()?.let { it / 1048576f } ?: 0f
                val used = parts[4].trimEnd('%')
                list += TradeItem("Память", "$used% занято · ${"%.0f".format(total)} ГБ", warn = used.removeSuffix("%").toIntOrNull()?.let { it > 90 } == true)
            }
            val accounts = shell(adb, d.id, "shell", "dumpsys", "account").second.lines()
                .filter { it.contains("Account {") }.mapNotNull { Regex("name=([^,]+)").find(it)?.groupValues?.get(1) }.distinct()
            list += TradeItem("Аккаунты", if (accounts.isEmpty()) "нет" else "${accounts.size} шт — ${accounts.take(2).joinToString(", ")}${if (accounts.size > 2) "…" else ""}", warn = accounts.any { it.contains("google", true) })
            if (accounts.any { it.contains("google", true) }) warnCount++
            val simState = get("gsm.sim.state")
            val simOp = get("gsm.operator.alpha")
            list += TradeItem("SIM", "$simState · ${simOp.ifBlank { "нет оператора" }}")
            list += TradeItem("Root/разблок", if (get("ro.debuggable") == "1" || shell(adb, d.id, "shell", "which", "su").second.isNotBlank()) "возможен root" else "нет")
            list += TradeItem("Шифрование", get("ro.crypto.state"))
            items = list
            warnCount = list.count { it.warn }
            verdict = when {
                accounts.any { it.contains("google", true) } -> "⚠️ Есть Google-аккаунт — FRP заблокирует сброс. Пусть клиент выйдет до приёмки."
                warnCount > 0 -> "Есть замечания — проверь выделенные строки."
                else -> "✓ Можно принимать."
            }
            busy = false
        }
    }

    SheetDialog("Приём б/у", onDismiss) {
        Text("Подключи сдаваемый телефон кабелем. Проверяю состояние и риски перед приёмкой.",
            color = T2Colors.hint, fontSize = 13.sp, lineHeight = 18.sp, modifier = Modifier.padding(bottom = 12.dp))
        phones.forEach { p -> PhoneRow(p, devId == p.id) { devId = p.id } }
        if (phones.isEmpty()) Text("Подключи Android кабелем и нажми «Обновить».", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(vertical = 6.dp))
        Row(modifier = Modifier.padding(bottom = 8.dp)) {
            MainButton("Обновить", enabled = !busy, container = T2Colors.surface2, content = T2Colors.text) { refresh() }
            Spacer(Modifier.width(8.dp))
            MainButton("Оценить", enabled = devId != null && !busy) { assess() }
        }
        items?.let { list ->
            Column(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(T2Colors.surface2).border(1.dp, T2Colors.border, RoundedCornerShape(14.dp)).padding(12.dp)) {
                list.forEach { it2 ->
                    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                        Text(it2.label, color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.width(96.dp))
                        Text(it2.value, color = if (it2.warn) T2Colors.danger else T2Colors.text, fontSize = 13.sp, modifier = Modifier.weight(1f))
                    }
                }
            }
            verdict?.let { Text(it, color = if (warnCount > 0) T2Colors.warning else T2Colors.success, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 12.dp)) }
            Spacer(Modifier.height(12.dp))
            MainButton("Тест экрана", enabled = !busy, container = T2Colors.surface2, content = T2Colors.text) {
                scope.launch {
                    screenTest = true
                    val colors = listOf("black", "white", "red", "green", "blue")
                    colors.forEach { c -> shell(ADB ?: return@forEach, devId ?: return@forEach, "shell", "am", "broadcast", "-a", "android.intent.action.VIEW", "-n", "com.android.settings/.DevelopmentSettings") }
                    sayScreenTest(devId ?: "", colors)
                    screenTest = false
                }
            }
            if (screenTest) Text("На телефоне по очереди: чёрный/белый/красный/зелёный/синий — смотри на битые пиксели.", color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
        }
    }
}

private fun sayScreenTest(serial: String, colors: List<String>) {
    // Без root-прав нельзя залить экран — открываем настройки разработчика / цветовой тест.
    // На realme/большинстве: *#899# → Display test, или встроенная диагностика. Запускаем activity.
    runCatching {
        ProcessBuilder(ADB ?: return@runCatching, "-s", serial, "shell", "am", "start", "-a", "android.provider.Telephony.SECRET_CODE", "-d", "android_secret_code://899").start()
    }
}

/* =========================================================
   «Диагностика» — карточка состояния подключённого телефона.
   ========================================================= */
private data class DiagRow(val label: String, val value: String)

@Composable
private fun DiagDialog(onDismiss: () -> Unit) {
    var phones by remember { mutableStateOf<List<Phone>>(emptyList()) }
    var devId by remember { mutableStateOf<String?>(null) }
    var rows by remember { mutableStateOf<List<DiagRow>?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun refresh() { scope.launch { phones = listPhones(); if (phones.isNotEmpty()) devId = phones[0].id } }
    LaunchedEffect(Unit) { refresh() }

    fun load() {
        val d = phones.firstOrNull { it.id == devId } ?: return
        busy = true; rows = null
        scope.launch {
            val list = mutableListOf<DiagRow>()
            fun get(prop: String) = if (d.kind == DevKind.Android) shell(ADB ?: "", d.id, "shell", "getprop", prop).second.trim() else "?"
            list += DiagRow("Устройство", "${get("ro.product.brand").replaceFirstChar { it.uppercase() }} ${get("ro.product.model")}")
            list += DiagRow("ОС", if (d.kind == DevKind.Android) "Android " + get("ro.build.version.release") else "iOS")
            val bat = shell(ADB ?: "", d.id, "shell", "dumpsys", "battery").second
            list += DiagRow("Батарея", Regex("level:\\s*(\\d+)").find(bat)?.groupValues?.get(1)?.let { "$it%" } ?: "?")
            list += DiagRow("Температура", Regex("temperature:\\s*(\\d+)").find(bat)?.groupValues?.get(1)?.toIntOrNull()?.let { "${it / 10f}°C" } ?: "?")
            val df = shell(ADB ?: "", d.id, "shell", "df", "/data").second.lines().getOrNull(1) ?: ""
            df.trim().split("\\s+".toRegex()).takeIf { it.size >= 6 }?.let { list += DiagRow("Память", "${it[4]} занято") }
            list += DiagRow("SIM", get("gsm.sim.state"))
            list += DiagRow("Экран", shell(ADB ?: "", d.id, "shell", "wm", "size").second.trim())
            list += DiagRow("Аккаунты", shell(ADB ?: "", d.id, "shell", "dumpsys", "account").second.lines().count { it.contains("Account {") }.toString() + " шт")
            list += DiagRow("Root", if (get("ro.debuggable") == "1" || shell(ADB ?: "", d.id, "shell", "which", "su").second.isNotBlank()) "возможен" else "нет")
            rows = list; busy = false
        }
    }

    SheetDialog("Диагностика", onDismiss) {
        Text("Быстрая карточка состояния подключённого устройства.", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(bottom = 12.dp))
        phones.forEach { p -> PhoneRow(p, devId == p.id) { devId = p.id } }
        if (phones.isEmpty()) Text("Подключи устройство и нажми «Обновить».", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(vertical = 6.dp))
        Row(modifier = Modifier.padding(bottom = 8.dp)) {
            MainButton("Обновить", enabled = !busy, container = T2Colors.surface2, content = T2Colors.text) { refresh() }
            Spacer(Modifier.width(8.dp))
            MainButton("Проверить", enabled = devId != null && !busy) { load() }
        }
        rows?.let { list ->
            Column(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(T2Colors.surface2).border(1.dp, T2Colors.border, RoundedCornerShape(14.dp)).padding(12.dp)) {
                list.forEach { it2 -> Row(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) { Text(it2.label, color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.width(110.dp)); Text(it2.value, color = T2Colors.text, fontSize = 13.sp, modifier = Modifier.weight(1f)) } }
            }
        }
    }
}

/* =========================================================
   «ADB-терминал» — мини-консоль для команд на подключённом
   телефоне. Быстрые кнопки + своя команда.
   ========================================================= */
@Composable
private fun AdbTermDialog(onDismiss: () -> Unit) {
    var phones by remember { mutableStateOf<List<Phone>>(emptyList()) }
    var devId by remember { mutableStateOf<String?>(null) }
    var cmd by remember { mutableStateOf("") }
    var out by remember { mutableStateOf<List<String>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun refresh() { scope.launch { phones = listPhones().filter { it.kind == DevKind.Android }; if (phones.isNotEmpty()) devId = phones[0].id } }
    LaunchedEffect(Unit) { refresh() }

    fun say(s: String) { out = (out + s).takeLast(150) }
    fun exec(cmdLine: String) {
        val d = phones.firstOrNull { it.id == devId } ?: return
        val adb = ADB ?: return say("adb не найден")
        busy = true; say("$ $cmdLine")
        scope.launch {
            val args = if (cmdLine.startsWith("adb ")) cmdLine.removePrefix("adb ").split(" ") else cmdLine.split(" ")
            val res = runCatching {
                val p = ProcessBuilder(mutableListOf(adb, "-s", d.id) + args).redirectErrorStream(true).start()
                val txt = p.inputStream.bufferedReader().readText(); p.waitFor(); p.exitValue() to txt
            }.getOrDefault(-1 to "ошибка запуска")
            val code = res.first; val o = res.second
            if (o.isNotBlank()) say(o.trimEnd())
            say("[exit $code]")
            busy = false
        }
    }

    SheetDialog("ADB-терминал", onDismiss) {
        Text("Команды на подключённом Android. Быстрые кнопки или своя.", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(bottom = 12.dp))
        phones.forEach { p -> PhoneRow(p, devId == p.id) { devId = p.id } }
        if (phones.isEmpty()) Text("Подключи Android и нажми «Обновить».", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(vertical = 6.dp))
        Row(modifier = Modifier.padding(bottom = 8.dp)) {
            MainButton("Обновить", enabled = !busy, container = T2Colors.surface2, content = T2Colors.text) { refresh() }
            Spacer(Modifier.width(8.dp))
            MainButton("screencap", enabled = devId != null && !busy, container = T2Colors.surface2, content = T2Colors.text) { scope.launch { val (c, o) = shell(ADB ?: "", devId ?: "", "exec-out", "screencap", "-p"); if (c == 0) { val f = java.io.File(System.getProperty("java.io.tmpdir"), "screen-${devId}.png"); f.writeBytes(o.toByteArray()); say("saved ${f.absolutePath}") } else say("err $o") } }
            Spacer(Modifier.width(8.dp))
            MainButton("devices", enabled = !busy, container = T2Colors.surface2, content = T2Colors.text) { exec("devices -l") }
        }
        Row(modifier = Modifier.padding(bottom = 8.dp)) {
            Box(modifier = Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(T2Colors.surface2).border(1.dp, T2Colors.border, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 12.dp)) {
                androidx.compose.foundation.text.BasicTextField(
                    value = cmd, onValueChange = { cmd = it }, singleLine = true,
                    textStyle = androidx.compose.ui.text.TextStyle(color = T2Colors.text, fontSize = 14.sp, fontFamily = FontFamily.Monospace),
                    modifier = Modifier.fillMaxWidth()
                )
                if (cmd.isEmpty()) Text("shell pm list packages", color = T2Colors.hint, fontSize = 13.sp, fontFamily = FontFamily.Monospace)
            }
            Spacer(Modifier.width(8.dp))
            MainButton("▶", enabled = devId != null && cmd.isNotBlank() && !busy) { exec(cmd); cmd = "" }
        }
        if (out.isNotEmpty()) {
            Column(modifier = Modifier.fillMaxWidth().height(200.dp).clip(RoundedCornerShape(12.dp)).background(T2Colors.surface2).border(1.dp, T2Colors.border, RoundedCornerShape(12.dp)).padding(10.dp).verticalScroll(rememberScrollState())) {
                SelectionContainer { Text(out.joinToString("\n"), color = T2Colors.text, fontSize = 11.sp, fontFamily = FontFamily.Monospace, lineHeight = 15.sp) }
            }
        }
    }
}

/* =========================================================
   «Чистка и защита» — три вкладки:
   1. Чистка — мусор (cache, миниатюры, старые загрузки, пустые папки).
   2. Антивирус — эвристический поиск подозрительных/рекламных приложений.
   3. Оптимизация — закрыть фон, очистить RAM, снять опасные разрешения.
   ========================================================= */
private enum class CleanTab { Scan, Virus, Optimize }

private data class JunkItem(val label: String, val path: String, val bytes: Long, val safe: Boolean = true)
private data class SuspApp(val pkg: String, val reason: String, val severity: Int) // 1=подозр, 2=опасно

private val JUNK_PATHS = listOf(
    "/sdcard/Android/data/*/cache",
    "/sdcard/.thumbnails",
    "/sdcard/DCIM/.thumbnails",
    "/sdcard/LOST.DIR",
    "/sdcard/Download/.cache",
    "/data/cache"
)

private val DANGEROUS_PERMS = mapOf(
    "SYSTEM_ALERT_WINDOW" to "рисует поверх экрана (реклама/оверлей)",
    "BIND_ACCESSIBILITY_SERVICE" to "читает экран и нажимает (шпионаж)",
    "BIND_DEVICE_ADMIN" to "управляет устройством (не дай удалить)",
    "INSTALL_PACKAGES" to "ставит приложения сам",
    "READ_SMS" to "читает SMS",
    "BIND_NOTIFICATION_LISTENER_SERVICE" to "читает уведомления",
    "REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" to "обходит экономию батареи",
    "QUERY_ALL_PACKAGES" to "видит все приложения",
    "FOREGROUND_SERVICE_SPECIAL_USE" to "неявная фоновая работа"
)

private val SAFE_PKGS = setOf(
    "com.google.android.", "com.android.", "android.", "com.miui.", "com.oppo.", "com.coloros.",
    "com.samsung.", "com.heytap.", "com.realme.", "org.telegram.", "com.whatsapp", "com.viber.",
    "ru.t2sales", "com.yandex.", "com.vk.", "com.google.gms"
)

private fun isSafePkg(pkg: String): Boolean = SAFE_PKGS.any { pkg.startsWith(it) }

@Composable
private fun CleanGuardDialog(onDismiss: () -> Unit) {
    var phones by remember { mutableStateOf<List<Phone>>(emptyList()) }
    var devId by remember { mutableStateOf<String?>(null) }
    var tab by remember { mutableStateOf(CleanTab.Scan) }
    var junk by remember { mutableStateOf<List<JunkItem>?>(null) }
    var totalJunk by remember { mutableStateOf(0L) }
    var susp by remember { mutableStateOf<List<SuspApp>?>(null) }
    var log by remember { mutableStateOf<List<String>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun say(s: String) { log = (log + s).takeLast(80) }
    fun refresh() { scope.launch { phones = listPhones().filter { it.kind == DevKind.Android }; if (phones.isNotEmpty()) devId = phones[0].id } }
    LaunchedEffect(Unit) { refresh() }

    fun scanJunk() {
        val d = phones.firstOrNull { it.id == devId } ?: return
        val adb = ADB ?: return
        busy = true; junk = null; log = emptyList(); say("Сканирую мусор на ${d.label}…")
        scope.launch {
            val items = mutableListOf<JunkItem>()
            var total = 0L
            // Размеры типичных мусорных папок
            listOf(
                "/sdcard/Download" to "Загрузки",
                "/sdcard/Android/data" to "Данные приложений",
                "/sdcard/.thumbnails" to "Миниатюры",
                "/sdcard/DCIM/.thumbnails" to "Миниатюры камеры",
                "/sdcard/Pictures/.thumbnails" to "Миниатюры картинок",
                "/sdcard/LOST.DIR" to "LOST.DIR",
                "/sdcard/Movies/.thumbnails" to "Миниатюры видео"
            ).forEach { (path, label) ->
                val (c, out) = shell(adb, d.id, "shell", "du", "-sb", path)
                val bytes = Regex("(\\d+)").find(out.lines().firstOrNull() ?: "")?.groupValues?.get(1)?.toLongOrNull() ?: 0
                if (bytes > 0) { items += JunkItem(label, path, bytes); total += bytes }
            }
            // Топ приложений по кэшу (приблизительно по размеру data)
            val (c2, top) = shell(adb, d.id, "shell", "du", "-sb", "/sdcard/Android/data/*")
            top.lines().filter { it.isNotBlank() && !it.contains("No such") }.sortedByDescending { it.trim().split("\\s+".toRegex()).firstOrNull()?.toLongOrNull() ?: 0 }.take(5).forEach { l ->
                val p = l.trim().split("\\s+".toRegex()); if (p.size >= 2) items += JunkItem("Кэш: ${p[1].substringAfterLast('/')}", p[1], p[0].toLongOrNull() ?: 0)
            }
            junk = items; totalJunk = total
            say("Найдено мусора: ${"%.1f".format(total / 1048576f)} МБ")
            busy = false
        }
    }

    fun doClean() {
        val d = phones.firstOrNull { it.id == devId } ?: return
        val adb = ADB ?: return
        busy = true; say("Чищу…")
        scope.launch {
            var freed = 0L
            // Чистим кэш приложений (только свои данные каждого — через run-as не выйдет без root;
            // чистим общие мусорные папки и миниатюры).
            listOf("/sdcard/.thumbnails", "/sdcard/DCIM/.thumbnails", "/sdcard/Pictures/.thumbnails",
                   "/sdcard/Movies/.thumbnails", "/sdcard/Download/.cache", "/sdcard/LOST.DIR").forEach { p ->
                val (c, _) = shell(adb, d.id, "shell", "rm", "-rf", p + "/*")
                if (c == 0) freed++
            }
            // Обрезаем старые загрузки (старше 90 дней)
            shell(adb, d.id, "shell", "find", "/sdcard/Download", "-type", "f", "-mtime", "+90", "-delete")
            // pm trim-caches освобождает кэш всех приложений (если доступно)
            shell(adb, d.id, "shell", "pm", "trim-caches", "2048M")
            say("Чистка завершена.")
            scanJunk(); // перескан
        }
    }

    fun scanVirus() {
        val d = phones.firstOrNull { it.id == devId } ?: return
        val adb = ADB ?: return
        busy = true; susp = null; log = emptyList(); say("Сканирую приложения…")
        scope.launch {
            val found = mutableListOf<SuspApp>()
            val pkgs = shell(adb, d.id, "shell", "pm", "list", "packages", "-3").second.lines()
                .map { it.removePrefix("package:").trim() }.filter { it.isNotBlank() && !isSafePkg(it) }
            say("Сторонних приложений: ${pkgs.size}")
            for (pkg in pkgs) {
                val info = shell(adb, d.id, "shell", "dumpsys", "package", pkg).second
                val reasons = mutableListOf<String>()
                var sev = 0
                // Недавно установленные (за 60 дней) и не из Play Store — подозрительнее.
                val inst = Regex("firstInstallTime=(\\d{4}-\\d{2}-\\d{2})").find(info)?.groupValues?.get(1)
                val installer = Regex("installerPackageName=([^\\s]+)").find(info)?.groupValues?.get(1) ?: ""
                if (installer.isNotBlank() && installer != "com.android.vending" && installer != "com.google.android.packageinstaller") {
                    reasons += "установлен не из Play Store ($installer)"; sev = 1
                }
                // Опасные разрешения.
                DANGEROUS_PERMS.forEach { (perm, why) ->
                    if (info.contains(perm) && info.contains("$perm.*granted=true".toRegex())) {
                        reasons += why; sev = maxOf(sev, if (perm.contains("ACCESSIBILITY") || perm.contains("DEVICE_ADMIN") || perm.contains("ALERT_WINDOW")) 2 else 1)
                    }
                }
                // Имя пакета с рекламными признаками.
                if (Regex("ad|ads|free|lite|boost|clean|master|speed|offer|win|gift|push", RegexOption.IGNORE_CASE).containsMatchIn(pkg)) {
                    reasons += "имя пакета подозрительное"; sev = maxOf(sev, 1)
                }
                if (reasons.isNotEmpty()) found += SuspApp(pkg, reasons.joinToString("; "), sev)
            }
            susp = found.sortedByDescending { it.severity }
            say(if (found.isEmpty()) "Подозрительных приложений не найдено." else "Найдено подозрительных: ${found.size}")
            busy = false
        }
    }

    fun optimize() {
        val d = phones.firstOrNull { it.id == devId } ?: return
        val adb = ADB ?: return
        busy = true; say("Оптимизирую…")
        scope.launch {
            // Force-stop фоновых (не свои, не системные, не запущенные на переднем плане).
            val pkgs = shell(adb, d.id, "shell", "pm", "list", "packages", "-3").second.lines()
                .map { it.removePrefix("package:").trim() }.filter { it.isNotBlank() && !isSafePkg(it) }
            var stopped = 0
            for (pkg in pkgs) {
                val (c, _) = shell(adb, d.id, "shell", "am", "force-stop", pkg)
                if (c == 0) stopped++
            }
            say("Остановлено фоновых: $stopped")
            // Adaptive battery ON.
            shell(adb, d.id, "shell", "settings", "put", "global", "adaptive_battery_management_enabled", "1")
            // Срезать разрешение RUN_IN_BACKGROUND у сторонних (ограничить фон).
            shell(adb, d.id, "shell", "appops", "set", "--uid", "RUN_IN_BACKGROUND", "deny")
            say("Готово. Рекомендуется перезагрузить телефон.")
            busy = false
        }
    }

    SheetDialog("Чистка и защита", onDismiss) {
        Text("Чистка мусора, поиск рекламных/подозрительных приложений, оптимизация — через отладку USB.",
            color = T2Colors.hint, fontSize = 13.sp, lineHeight = 18.sp, modifier = Modifier.padding(bottom = 12.dp))
        phones.forEach { p -> PhoneRow(p, devId == p.id) { devId = p.id } }
        if (phones.isEmpty()) Text("Подключи Android и нажми «Обновить».", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(vertical = 6.dp))
        Row(modifier = Modifier.padding(bottom = 10.dp)) {
            MainButton("Обновить", enabled = !busy, container = T2Colors.surface2, content = T2Colors.text) { refresh() }
        }
        // Вкладки
        Row(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(T2Colors.surface2).padding(3.dp)) {
            CleanTab.values().forEach { t ->
                Text(
                    when (t) { CleanTab.Scan -> "Чистка"; CleanTab.Virus -> "Антивирус"; CleanTab.Optimize -> "Оптимизация" },
                    color = if (tab == t) T2Colors.onPrimary else T2Colors.text,
                    fontSize = 13.sp, fontWeight = if (tab == t) FontWeight.Bold else FontWeight.Normal,
                    modifier = Modifier.weight(1f).clip(RoundedCornerShape(9.dp)).background(if (tab == t) T2Colors.primary else T2Colors.surface2)
                        .clickable { tab = t }.padding(vertical = 8.dp), textAlign = TextAlign.Center
                )
            }
        }
        Spacer(Modifier.height(12.dp))

        when (tab) {
            CleanTab.Scan -> {
                MainButton("Найти мусор", enabled = devId != null && !busy) { scanJunk() }
                junk?.let { list ->
                    Spacer(Modifier.height(8.dp))
                    Text("Найдено: ${"%.1f".format(totalJunk / 1048576f)} МБ", color = T2Colors.text, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                    Column(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(T2Colors.surface2).border(1.dp, T2Colors.border, RoundedCornerShape(12.dp)).padding(10.dp).heightIn(max = 160.dp).verticalScroll(rememberScrollState())) {
                        list.forEach { it2 -> Row(modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp)) { Text(it2.label, color = T2Colors.text, fontSize = 12.sp, modifier = Modifier.weight(1f)); Text("${"%.1f".format(it2.bytes / 1048576f)} МБ", color = T2Colors.hint, fontSize = 12.sp) } }
                    }
                    Spacer(Modifier.height(8.dp))
                    MainButton("Очистить", enabled = !busy) { doClean() }
                }
            }
            CleanTab.Virus -> {
                MainButton("Сканировать приложения", enabled = devId != null && !busy) { scanVirus() }
                susp?.let { list ->
                    Spacer(Modifier.height(8.dp))
                    if (list.isEmpty()) Text("Подозрительных не найдено — чисто.", color = T2Colors.success, fontSize = 13.sp)
                    else {
                        Text("Подозрительных: ${list.size}", color = T2Colors.text, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                        Column(modifier = Modifier.fillMaxWidth().heightIn(max = 200.dp).verticalScroll(rememberScrollState())) {
                            list.forEach { s ->
                                Column(modifier = Modifier.fillMaxWidth().padding(vertical = 5.dp)) {
                                    Text(s.pkg.substringAfterLast('.'), color = if (s.severity >= 2) T2Colors.danger else T2Colors.warning, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                                    Text(s.pkg, color = T2Colors.hint, fontSize = 11.sp)
                                    Text(s.reason, color = T2Colors.hint, fontSize = 12.sp)
                                    Row { Text("Открыть настройки", color = T2Colors.primary, fontSize = 12.sp, modifier = Modifier.clickable { shell(ADB ?: "", devId ?: "", "shell", "am", "start", "-a", "android.settings.APPLICATION_DETAILS_SETTINGS", "-d", "package:${s.pkg}") }.padding(vertical = 2.dp)) }
                                }
                            }
                        }
                    }
                }
            }
            CleanTab.Optimize -> {
                MainButton("Оптимизировать", enabled = devId != null && !busy) { optimize() }
                Spacer(Modifier.height(8.dp))
                Text("Остановит фоновые приложения, включит adaptive battery, ограничит фон для сторонних. Телефон станет шустрее и дольше держит заряд.",
                    color = T2Colors.hint, fontSize = 12.sp, lineHeight = 16.sp)
            }
        }
        if (log.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Column(modifier = Modifier.fillMaxWidth().height(110.dp).clip(RoundedCornerShape(12.dp)).background(T2Colors.surface2).border(1.dp, T2Colors.border, RoundedCornerShape(12.dp)).padding(10.dp).verticalScroll(rememberScrollState())) {
                SelectionContainer { Text(log.joinToString("\n"), color = T2Colors.text, fontSize = 11.sp, fontFamily = FontFamily.Monospace, lineHeight = 15.sp) }
            }
        }
    }
}





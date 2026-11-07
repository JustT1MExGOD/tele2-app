package ru.t2sales.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.max
import kotlin.math.roundToInt
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import ru.t2sales.android.AppContainer
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.navigation.Screen
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Hero

private val HEALTH_LABEL = mapOf("plan" to "План", "trend" to "Темп дня", "staffing" to "Штат", "cash_discipline" to "Касса")

/** Port of #page-store-profile (pages/store-profile): health, today's metrics, trend, tasks and alerts of one store. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun StoreProfileScreen(container: AppContainer, me: MeResponse, onNavigate: (Screen) -> Unit) {
    val storeId = AppNav.storeProfileId
    val canManage = me.role == "manager" || me.role == "admin" || me.is_manager == true
    val scope = rememberCoroutineScope()
    var data by remember(storeId) { mutableStateOf<JsonObject?>(null) }
    var failed by remember(storeId) { mutableStateOf(false) }
    var reload by remember { mutableStateOf(0) }
    var renaming by remember { mutableStateOf(false) }

    LaunchedEffect(storeId, reload) {
        val id = storeId ?: return@LaunchedEffect
        failed = false
        runCatching { container.analyticsApi.storeProfile(id) }.onSuccess { data = it }.onFailure { failed = true }
    }

    Box(
        modifier = Modifier.padding(bottom = 12.dp).size(44.dp).clip(CircleShape).background(T2Colors.surface2).clickable { AppNav.back() },
        contentAlignment = Alignment.Center
    ) { Text("\u2039", fontSize = 22.sp) }

    val d = data
    when {
        storeId == null -> Text("Точка не выбрана", color = T2Colors.hint, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
        failed -> ErrorState("Не удалось загрузить профиль точки", onRetry = { reload++ })
        d == null -> LoadingBlock()
        else -> {
            val store = d["store"].obj()
            val health = d["health"].obj()
            val score = health["score"].dbl()
            val tone = when { score >= 75 -> T2Colors.success; score >= 45 -> T2Colors.warning; else -> T2Colors.danger }
            val comps = health["components"].obj()
            val staff = store["staff"].arr().map { it.obj().let { s -> s["name"].str().ifEmpty { s["full_name"].str() } } }.filter { it.isNotEmpty() }.joinToString(", ")

            if (T2Colors.uiBeta) {
                StoreProfileBeta(d, store, health, score, comps, staff, canManage, onNavigate,
                    onRename = { renaming = true })
                if (renaming) StoreRenameSheet(storeId, store, scope, container, onDismiss = { renaming = false }) { reload++ }
                return
            }
            PageSection(null) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(store["name"].str().ifEmpty { "Точка" }.uppercase(), color = T2Colors.hint, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.7.sp)
                    if (canManage) MChipButton("\u270E Название") { renaming = true }
                }
                Row(modifier = Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Box(
                        modifier = Modifier.size(52.dp).clip(CircleShape).background(tone.copy(alpha = 0.13f)).border(2.dp, tone.copy(alpha = 0.27f), CircleShape),
                        contentAlignment = Alignment.Center
                    ) { Text(fmtN(score), color = tone, fontWeight = FontWeight.ExtraBold, fontSize = 18.sp) }
                    Text("${store["staff_count"].dbl().toInt()} на смене сегодня" + if (staff.isNotEmpty()) ": $staff" else "", fontSize = 13.sp, modifier = Modifier.weight(1f))
                }
                FlowRow(modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    comps.forEach { (k, v) ->
                        val shape = RoundedCornerShape(12.dp)
                        Text("${HEALTH_LABEL[k] ?: k}: ${fmtN(v.obj()["value"].dbl())}%", fontWeight = FontWeight.Bold, fontSize = 13.sp,
                            modifier = Modifier.clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape).padding(horizontal = 12.dp, vertical = 10.dp))
                    }
                }
                Spacer(Modifier.height(8.dp))
            }
            Spacer(Modifier.height(12.dp))

            PageSection("Сегодня") {
                Column(modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 8.dp)) {
                    listOf("sim" to "SIM", "mnp" to "MNP", "pa" to "ПА", "combo" to "Комбо").forEach { (id, label) ->
                        val m = d["today"].obj()["metrics"].obj()[id].obj()
                        ProgressRow(label, m["fact"].dbl(), m["plan"].dbl())
                    }
                }
            }

            val trend = d["trend"].arr().map { it.obj()["units"].dbl() }
            if (trend.isNotEmpty()) {
                Spacer(Modifier.height(12.dp))
                PageSection("Тренд, юниты в день") {
                    if (trend.any { it > 0 }) {
                        val mx = max(1.0, trend.maxOrNull() ?: 1.0)
                        Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 12.dp).height(60.dp), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.Bottom) {
                            trend.forEach { t -> Box(Modifier.weight(1f).height(max(4.0, t / mx * 60.0).dp).clip(RoundedCornerShape(topStart = 2.dp, topEnd = 2.dp)).background(T2Colors.primarySoft)) }
                        }
                    } else Text("Нет продаж за период", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(24.dp))
                }
            }

            val tasks = d["tasks"].arr()
            if (tasks.isNotEmpty()) {
                Spacer(Modifier.height(12.dp))
                PageSection("Задачи по точке") {
                    tasks.forEach { el ->
                        val t = el.obj()
                        Row(modifier = Modifier.fillMaxWidth().clickable { onNavigate(Screen.Tasks) }.padding(horizontal = 16.dp, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(t["title"].str(), fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                                Text(t["assignee_name"].str() + " \u00B7 " + if (t["status"].str() == "in_progress") "В работе" else "Открыта", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp))
                            }
                            Text("\u203A", color = T2Colors.hint, fontSize = 18.sp)
                        }
                    }
                }
            }

            val alerts = d["alerts"].arr()
            if (alerts.isNotEmpty()) {
                Spacer(Modifier.height(12.dp))
                PageSection("Алерты") {
                    Column(modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        alerts.forEach { a ->
                            val c = T2Colors.warning
                            val shape = RoundedCornerShape(16.dp)
                            Row(
                                modifier = Modifier.fillMaxWidth().clip(shape).background(Brush.linearGradient(listOf(c.copy(alpha = 0.12f), c.copy(alpha = 0.04f)))).border(1.dp, c.copy(alpha = 0.3f), shape).padding(horizontal = 14.dp, vertical = 12.dp),
                                horizontalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                Text("\u26A0\uFE0F", fontSize = 18.sp)
                                Text(a.str(), color = T2Colors.hint, fontSize = 12.sp)
                            }
                        }
                    }
                }
            }

            if (renaming) {
                var name by remember { mutableStateOf(store["display_name"].str()) }
                SheetDialog("Название точки", onDismiss = { renaming = false }) {
                    Text("Кастомное название точки (пусто \u2014 вернуть обычное имя):", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(bottom = 12.dp))
                    Field("", name, { name = it }, fill = T2Colors.surface2)
                    Spacer(Modifier.height(16.dp))
                    MainButton("Сохранить", enabled = true) {
                        val id = storeId ?: return@MainButton
                        scope.launch {
                            runCatching { container.analyticsApi.setStoreDisplayName(id, name.trim().ifEmpty { null }) }
                                .onSuccess { T2Toast.show("Название обновлено"); renaming = false; reload++ }
                                .onFailure { T2Toast.show("Ошибка сохранения", true) }
                        }
                    }
                }
            }
        }
    }
}

// ======================= Beta UI 3.0 «Ночная смена» =======================

/** Beta profile: the health ring leads the hero; components, today, trend, tasks and alerts as flat groups. */
@Composable
private fun StoreProfileBeta(
    d: JsonObject, store: JsonObject, health: JsonObject, score: Double, comps: JsonObject, staff: String,
    canManage: Boolean, onNavigate: (Screen) -> Unit, onRename: () -> Unit
) {
    val name = store["name"].str().ifEmpty { "Точка" }
    val staffCount = store["staff_count"].dbl().toInt()
    val pct = score.roundToInt()
    U3Hero {
        U3HeroRow(name, chip = if (canManage) "Переименовать" else null, chipText = T2Hero.onHero)
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
            Column(Modifier.weight(1f)) {
                Text("$staffCount на смене сегодня", color = T2Hero.onHero, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                if (staff.isNotEmpty()) Text(staff, color = T2Hero.onHero2, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp))
            }
            U3Ring(pct, "здоровье", size = 84.dp)
        }
        if (canManage) {
            Spacer(Modifier.height(10.dp))
            U3SecondaryButton("✎ Название", onClick = onRename)
        }
    }
    if (comps.isNotEmpty()) {
        U3GroupHead("Здоровье точки")
        U3Group {
            comps.entries.toList().forEachIndexed { i, (k, v) ->
                if (i > 0) U3Sep()
                val cv = v.obj()["value"].dbl().roundToInt()
                U3Cell(
                    HEALTH_LABEL[k] ?: k, null,
                    leading = { U3Tile((HEALTH_LABEL[k] ?: k).take(1).uppercase(), tint = u3Tone(cv)) },
                    trailing = { U3Value("$cv%", u3Tone(cv)) }
                )
            }
        }
    }

    U3GroupHead("Сегодня")
    U3Group {
        listOf("sim" to "SIM", "mnp" to "MNP", "pa" to "ПА", "combo" to "Комбо").forEachIndexed { i, (id, label) ->
            if (i > 0) U3Sep(inset = 16.dp)
            val m = d["today"].obj()["metrics"].obj()[id].obj()
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
                ProgressRow(label, m["fact"].dbl(), m["plan"].dbl())
            }
        }
    }

    val trend = d["trend"].arr().map { it.obj()["units"].dbl().toFloat() }
    if (trend.isNotEmpty() && trend.any { it > 0f }) {
        U3GroupHead("Тренд, юниты в день")
        U3Group {
            Box(Modifier.padding(16.dp)) { U3Sparkline(trend, height = 64.dp, line = T2Colors.accentText, fill = T2Colors.primarySoft) }
        }
    }

    val tasks = d["tasks"].arr()
    if (tasks.isNotEmpty()) {
        U3GroupHead("Задачи по точке")
        U3Group {
            tasks.forEachIndexed { i, el ->
                if (i > 0) U3Sep()
                val t = el.obj()
                U3Cell(
                    t["title"].str(), t["assignee_name"].str() + " · " + if (t["status"].str() == "in_progress") "В работе" else "Открыта",
                    leading = { U3IconTile(NavIcons.plan, tint = T2Colors.textSecondary) },
                    trailing = { U3Value("›", T2Colors.hint) },
                    onClick = { onNavigate(Screen.Tasks) }
                )
            }
        }
    }

    val alerts = d["alerts"].arr()
    if (alerts.isNotEmpty()) {
        U3GroupHead("Алерты")
        alerts.forEach { a ->
            U3WarnRow(a.str())
            Spacer(Modifier.height(8.dp))
        }
    }
    Spacer(Modifier.height(96.dp))
}

/** The rename sheet, shared shape with the classic one. */
@Composable
private fun StoreRenameSheet(storeId: String?, store: JsonObject, scope: kotlinx.coroutines.CoroutineScope, container: AppContainer, onDismiss: () -> Unit, onSaved: () -> Unit) {
    var name by remember { mutableStateOf(store["display_name"].str()) }
    SheetDialog("Название точки", onDismiss = onDismiss) {
        Text("Кастомное название точки (пусто — вернуть обычное имя):", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(bottom = 12.dp))
        Field("", name, { name = it }, fill = T2Colors.surface2)
        Spacer(Modifier.height(16.dp))
        MainButton("Сохранить", enabled = true) {
            val id = storeId ?: return@MainButton
            scope.launch {
                runCatching { container.analyticsApi.setStoreDisplayName(id, name.trim().ifEmpty { null }) }
                    .onSuccess { T2Toast.show("Название обновлено"); onDismiss(); onSaved() }
                    .onFailure { T2Toast.show("Ошибка сохранения", true) }
            }
        }
    }
}

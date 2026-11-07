package ru.t2sales.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import ru.t2sales.shared.api.AdminApi
import ru.t2sales.shared.api.DealersTree
import ru.t2sales.shared.api.SectorNode
import ru.t2sales.shared.theme.T2Colors

private sealed class Rename {
    class Dealer(val id: Int, val name: String) : Rename()
    class Sector(val id: String, val name: String) : Rename()
}

/** Port of the «Дилеры/Секторы» page: unassigned supervisors, dealer -> sector cards, rename dialogs, sector assignment. */
@Composable
fun DealersScreen(api: AdminApi) {
    val scope = rememberCoroutineScope()
    var tree by remember { mutableStateOf<DealersTree?>(null) }
    var failed by remember { mutableStateOf(false) }
    var reload by remember { mutableStateOf(0) }
    var rename by remember { mutableStateOf<Rename?>(null) }
    var assignFor by remember { mutableStateOf<Pair<Int, String>?>(null) }

    LaunchedEffect(reload) {
        failed = false
        runCatching { api.getDealers() }.onSuccess { tree = it }.onFailure { failed = true }
    }

    val t = tree
    if (T2Colors.uiBeta) {
        DealersBeta(t, failed, { reload++ }, { assignFor = it }, { rename = it })
    } else {
    if (t != null && t.unassigned_supervisors.isNotEmpty()) {
        PageSection("Супервайзеры без сектора") {
            Column(modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 8.dp)) {
                t.unassigned_supervisors.forEach { s ->
                    Row(modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Text(s.full_name, fontWeight = FontWeight.Bold)
                        MChipButton("Назначить сектор") { assignFor = s.id to s.full_name }
                    }
                }
            }
        }
        Spacer(Modifier.height(12.dp))
    }

    PageSection("Дилеры/Секторы") {
        when {
            failed -> ErrorState("Не удалось загрузить дилеров/секторы", onRetry = { reload++ })
            t == null -> LoadingBlock(Modifier.padding(16.dp))
            t.dealers.isEmpty() && t.unassigned_sectors.isEmpty() -> EmptyText("Дилеров пока нет — заведите через форму сети")
            else -> Column(modifier = Modifier.padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                t.dealers.forEach { d ->
                    PageSection(null) {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 8.dp),
                            horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(d.name.uppercase(), color = T2Colors.hint, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.7.sp)
                            MChipButton("Переименовать") { rename = Rename.Dealer(d.id, d.name) }
                        }
                        if (d.sectors.isEmpty()) Text("Секторов пока нет", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(24.dp))
                        else Sectors(d.sectors) { rename = Rename.Sector(it.id, it.name) }
                    }
                }
                if (t.unassigned_sectors.isNotEmpty()) {
                    PageSection("Без дилера") { Sectors(t.unassigned_sectors) { rename = Rename.Sector(it.id, it.name) } }
                }
            }
        }
    }
    }

    val r = rename
    if (r != null) {
        var name by remember(r) { mutableStateOf(if (r is Rename.Dealer) r.name else (r as Rename.Sector).name) }
        SheetDialog(if (r is Rename.Dealer) "Переименовать дилера" else "Переименовать сектор", onDismiss = { rename = null }) {
            Field("Название", name, { name = it }, fill = T2Colors.surface2)
            Spacer(Modifier.height(16.dp))
            MainButton("Сохранить", enabled = true) {
                if (name.isBlank()) {
                    T2Toast.show("Укажите название", true)
                    return@MainButton
                }
                scope.launch {
                    runCatching { if (r is Rename.Dealer) api.renameDealer(r.id, name.trim()) else api.renameSector((r as Rename.Sector).id, name.trim()) }
                        .onSuccess { T2Toast.show("Сохранено"); rename = null; reload++ }
                        .onFailure { T2Toast.show(it.message ?: "Ошибка", true) }
                }
            }
        }
    }

    val a = assignFor
    if (a != null) {
        SectorPickerDialog(
            adminApi = api, title = "Сектор для ${a.second}", currentSectorId = null, allowSkip = false,
            onDismiss = { assignFor = null },
            onPick = { sectorId ->
                scope.launch {
                    runCatching { api.assignSupervisorSector(a.first, sectorId) }
                        .onSuccess { T2Toast.show("Сектор назначен"); assignFor = null; reload++ }
                        .onFailure { T2Toast.show(it.message ?: "Ошибка", true) }
                }
            }
        )
    }
}

@Composable
private fun Sectors(sectors: List<SectorNode>, onRename: (SectorNode) -> Unit) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 16.dp)) {
        val cols = ((maxWidth + 16.dp) / (320.dp + 16.dp)).toInt().coerceAtLeast(1)
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            sectors.chunked(cols).forEach { row ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.Top) {
                    row.forEach { s -> Box(modifier = Modifier.weight(1f)) { SectorCard(s) { onRename(s) } } }
                    repeat(cols - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
    }
}

@Composable
private fun SectorCard(s: SectorNode, onRename: () -> Unit) {
    val shape = RoundedCornerShape(20.dp)
    Row(modifier = Modifier.fillMaxWidth().height(androidx.compose.foundation.layout.IntrinsicSize.Min).clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape)) {
        Box(Modifier.width(4.dp).fillMaxHeight().background(Color(0xFF8B5CF6)))
        Column(modifier = Modifier.weight(1f).padding(14.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(s.name, fontWeight = FontWeight.ExtraBold, fontSize = 15.sp)
                    val n = s.orgs.size
                    Text("$n сет${if (n == 1) "ь" else "и"}", color = Color(0xFFA78BFA), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
                MChipButton("Переименовать", onClick = onRename)
            }
            Text("Сети: " + (s.orgs.joinToString(", ") { it.name }.ifEmpty { "—" }), color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
            Text("Супервайзеры: " + (s.supervisors.joinToString(", ") { it.full_name }.ifEmpty { "не назначен" }), color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
        }
    }
}

// ======================= Beta UI 3.0 «Ночная смена» =======================

private val SECTOR_TINT = Color(0xFFA78BFA)

@Composable
private fun DealersBeta(
    t: DealersTree?, failed: Boolean, onRetry: () -> Unit,
    onAssign: (Pair<Int, String>) -> Unit, onRename: (Rename) -> Unit
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
        U3LargeTitle("Дилеры/Секторы")
        if (t != null && t.unassigned_supervisors.isNotEmpty()) {
            U3GroupHead("Супервайзеры без сектора")
            U3Group {
                t.unassigned_supervisors.forEachIndexed { i, s ->
                    if (i > 0) U3Sep()
                    U3Cell(
                        s.full_name, null,
                        leading = { U3Tile(s.full_name.take(1).uppercase(), tint = T2Colors.warning) },
                        trailing = { Text("Назначить", color = T2Colors.accentText, fontSize = 13.sp, fontWeight = FontWeight.SemiBold) },
                        onClick = { onAssign(s.id to s.full_name) }
                    )
                }
            }
        }
        when {
            failed -> ErrorState("Не удалось загрузить дилеров/секторы", onRetry = onRetry)
            t == null -> SkeletonBlock(Modifier.fillMaxWidth().height(160.dp).padding(top = 12.dp), 28.dp)
            t.dealers.isEmpty() && t.unassigned_sectors.isEmpty() -> EmptyText("Дилеров пока нет — заведите через форму сети")
            else -> {
                t.dealers.forEach { d ->
                    U3GroupHead(d.name, "переименовать", { onRename(Rename.Dealer(d.id, d.name)) })
                    U3Group {
                        if (d.sectors.isEmpty()) U3Cell("Секторов пока нет", null)
                        else d.sectors.forEachIndexed { i, s ->
                            if (i > 0) U3Sep()
                            DealersSectorCell(s) { onRename(Rename.Sector(s.id, s.name)) }
                        }
                    }
                }
                if (t.unassigned_sectors.isNotEmpty()) {
                    U3GroupHead("Без дилера")
                    U3Group {
                        t.unassigned_sectors.forEachIndexed { i, s ->
                            if (i > 0) U3Sep()
                            DealersSectorCell(s) { onRename(Rename.Sector(s.id, s.name)) }
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(96.dp))
    }
}

@Composable
private fun DealersSectorCell(s: SectorNode, onRename: () -> Unit) {
    val n = s.orgs.size
    U3Cell(
        s.name,
        "${n} сет${if (n == 1) "ь" else "и"} · " + (s.supervisors.joinToString(", ") { it.full_name }.ifEmpty { "супервайзер не назначен" }),
        leading = { U3Tile(s.name.take(1).uppercase(), tint = SECTOR_TINT) },
        trailing = { Text("Переименовать", color = T2Colors.accentText, fontSize = 12.sp, fontWeight = FontWeight.SemiBold) },
        onClick = onRename
    )
}

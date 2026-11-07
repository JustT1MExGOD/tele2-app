package ru.t2sales.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.t2sales.shared.api.AdminApi
import ru.t2sales.shared.theme.T2Colors

private class SectorOption(val id: String, val label: String)

/** openSectorPickerModal from pages/team: pick a sector (grouped by dealer); allowSkip = "Пропустить, назначу позже". */
@Composable
fun SectorPickerDialog(
    adminApi: AdminApi,
    title: String,
    currentSectorId: String?,
    allowSkip: Boolean,
    onDismiss: () -> Unit,
    onPick: (String) -> Unit,
    onSkip: (() -> Unit)? = null
) {
    var options by remember { mutableStateOf<List<SectorOption>?>(null) }
    var picked by remember { mutableStateOf<SectorOption?>(null) }

    LaunchedEffect(Unit) {
        runCatching { adminApi.getDealers() }.onSuccess { tree ->
            val list = buildList {
                tree.dealers.forEach { d -> d.sectors.forEach { add(SectorOption(it.id, "${d.name} \u00B7 ${it.name}")) } }
                tree.unassigned_sectors.forEach { add(SectorOption(it.id, "Без дилера \u00B7 ${it.name}")) }
            }
            options = list
            picked = list.firstOrNull { it.id == currentSectorId } ?: list.firstOrNull()
        }.onFailure { options = emptyList() }
    }

    SheetDialog(title, onDismiss) {
        val list = options
        when {
            list == null -> Text("Загрузка секторов\u2026", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(16.dp))
            list.isEmpty() -> Text(
                "Секторов пока нет \u2014 заведите через форму сети или экран «Дилеры/Секторы»",
                color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(16.dp)
            )
            else -> {
                if (T2Colors.uiBeta) {
                    // Beta: tappable grouped list of sectors instead of a dropdown.
                    U3Group {
                        list.forEachIndexed { i, o ->
                            if (i > 0) U3Sep()
                            val on = o.id == picked?.id
                            U3Cell(
                                o.label, null, highlight = on,
                                leading = { U3Tile(o.label.take(1).uppercase(), tint = if (on) T2Colors.primary else T2Colors.textSecondary) },
                                trailing = { if (on) U3Value("✓", T2Colors.primary) },
                                onClick = { picked = o }
                            )
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                    U3PrimaryButton("Назначить", enabled = picked != null) { picked?.let { onPick(it.id) } }
                    if (allowSkip) {
                        Spacer(Modifier.height(8.dp))
                        U3SecondaryButton("Пропустить, назначу позже") { (onSkip ?: onDismiss)() }
                    }
                } else {
                    SelectField("Сектор", picked?.label ?: "", list.map { it.label }) { label -> picked = list.firstOrNull { it.label == label } }
                    Spacer(Modifier.height(16.dp))
                    MainButton("Назначить", enabled = picked != null) { picked?.let { onPick(it.id) } }
                    if (allowSkip) {
                        Text(
                            "Пропустить, назначу позже",
                            fontWeight = FontWeight.Bold, fontSize = 13.sp, textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth().padding(top = 8.dp).clip(RoundedCornerShape(12.dp)).clickable { (onSkip ?: onDismiss)() }.padding(12.dp)
                        )
                    }
                }
            }
        }
    }
}

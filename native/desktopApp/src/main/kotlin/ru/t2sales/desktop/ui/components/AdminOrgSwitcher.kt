package ru.t2sales.desktop.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import ru.t2sales.shared.api.OrgAdminItem
import ru.t2sales.shared.theme.T2Spacing

/**
 * Дилер → Сектор → Сеть каскадный переключатель (20.76.0, "нативный
 * клиент всегда должен соответствовать вебу") — ровно та же логика,
 * что раньше жила только внутри TeamScreen.kt (private OrgSwitcher),
 * вынесена сюда, чтобы Admin Center мог использовать тот же свитчер
 * персистентно на уровне всего экрана, как web (org-switcher в шапке,
 * 20.73.0), а не только на «Команде».
 */
@Composable
fun AdminOrgSwitcher(orgs: List<OrgAdminItem>, currentId: String?, onPick: (String) -> Unit) {
    if (orgs.isEmpty()) return
    fun dealerOf(o: OrgAdminItem) = o.dealer_name ?: "Без дилера"
    fun sectorOf(o: OrgAdminItem) = o.sector_id ?: "default"
    val current = orgs.firstOrNull { it.id == currentId } ?: orgs.first()
    val dealers = orgs.map(::dealerOf).distinct().sorted()
    val sectors = orgs.filter { dealerOf(it) == dealerOf(current) }.map(::sectorOf).distinct().sorted()
    val inSector = orgs.filter { dealerOf(it) == dealerOf(current) && sectorOf(it) == sectorOf(current) }

    Column(modifier = Modifier.fillMaxWidth()) {
        AdminOrgPicker("Дилер", dealerOf(current), dealers) { d ->
            val firstSector = orgs.filter { dealerOf(it) == d }.map(::sectorOf).distinct().sorted().first()
            orgs.firstOrNull { dealerOf(it) == d && sectorOf(it) == firstSector }?.let { onPick(it.id) }
        }
        Spacer(Modifier.height(T2Spacing.sp2))
        AdminOrgPicker("Сектор", sectorOf(current), sectors) { s ->
            orgs.firstOrNull { dealerOf(it) == dealerOf(current) && sectorOf(it) == s }?.let { onPick(it.id) }
        }
        Spacer(Modifier.height(T2Spacing.sp2))
        AdminOrgPicker("Сеть", current.name, inSector.map { it.name }) { n ->
            inSector.firstOrNull { it.name == n }?.let { onPick(it.id) }
        }
    }
}

@Composable
private fun AdminOrgPicker(label: String, value: String, options: List<String>, onPick: (String) -> Unit) {
    Column(modifier = Modifier.fillMaxWidth()) {
        FieldLabel(label)
        DropdownField(value, options, onPick = onPick)
    }
}

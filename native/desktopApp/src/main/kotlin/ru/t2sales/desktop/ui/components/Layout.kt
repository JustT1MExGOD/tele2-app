package ru.t2sales.desktop.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Radius

/** The web's .section: surface card, radius 20, border, uppercase title. */
@Composable
fun PageSection(title: String?, content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(T2Radius.default)
    Column(modifier = Modifier.fillMaxWidth().clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape).padding(vertical = 6.dp)) {
        if (title != null) {
            Text(
                title.uppercase(), color = T2Colors.hint, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.7.sp,
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 8.dp)
            )
        }
        content()
    }
}

/** The web's .mchip button. */
@Composable
fun MChipButton(label: String, danger: Boolean = false, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Text(
        label,
        color = if (danger) T2Colors.danger else T2Colors.text,
        fontWeight = FontWeight.Bold,
        fontSize = 13.sp,
        modifier = modifier.clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 12.dp)
    )
}

package ru.t2sales.desktop.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import ru.t2sales.shared.theme.T2Colors

/** The web's .sheet-modal: drag handle, big title, close button, scrollable body. */
@Composable
fun SheetDialog(title: String, onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Dialog(onDismissRequest = onDismiss) {
        val shape = RoundedCornerShape(28.dp)
        DialogEnter { Column(
            modifier = Modifier
                .width(460.dp)
                .heightIn(max = 760.dp)
                .clip(shape)
                .background(T2Colors.surface)
                .border(1.dp, T2Colors.border, shape)
                .padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 20.dp)
        ) {
            Box(
                modifier = Modifier
                    .align(Alignment.CenterHorizontally)
                    .size(width = 40.dp, height = 4.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(T2Colors.surface3)
            )
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(title, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, color = T2Colors.text, modifier = Modifier.weight(1f))
                Text(
                    "✕",
                    color = T2Colors.hint,
                    fontSize = 20.sp,
                    modifier = Modifier.clip(CircleShape).clickable(onClick = onDismiss).padding(8.dp)
                )
            }
            Column(modifier = Modifier.verticalScroll(rememberScrollState())) { content() }
        } }
    }
}

package ru.t2sales.desktop.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toComposeImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import ru.t2sales.shared.api.TeamApi
import ru.t2sales.shared.theme.T2Colors

/** Bumped after an avatar upload so every AvatarImage refetches. */
object AvatarVersion {
    var v by androidx.compose.runtime.mutableStateOf(0)
}

/** Employee photo (GET /avatars/:id) with an initial-letter fallback, like applyAvatarImg(). */
@Composable
fun AvatarImage(teamApi: TeamApi, employeeId: Int?, fallback: String, size: Dp = 36.dp, active: Boolean = false) {
    val bitmap by produceState<ImageBitmap?>(null, employeeId, AvatarVersion.v) {
        value = employeeId?.let { id ->
            teamApi.getAvatar(id)?.let { bytes ->
                runCatching { org.jetbrains.skia.Image.makeFromEncoded(bytes).toComposeImageBitmap() }.getOrNull()
            }
        }
    }
    val border = if (active) T2Colors.success else T2Colors.border
    Box(
        modifier = Modifier
            .size(size)
            .clip(CircleShape)
            .background(if (active) T2Colors.successSoft else T2Colors.surface2)
            .border(1.dp, border, CircleShape),
        contentAlignment = Alignment.Center
    ) {
        val bmp = bitmap
        if (bmp != null) {
            Image(bmp, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.size(size))
        } else {
            Text(fallback, fontWeight = FontWeight.Bold, color = if (active) T2Colors.success else T2Colors.text)
        }
    }
}

package ru.t2sales.android.ui

import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File
import ru.t2sales.shared.auth.AndroidPlatform

/** Hands a generated file (a CSV export, a report picture) to the phone's share sheet: save to Drive / Downloads, send to Telegram, ... */
object FileShare {
    fun share(name: String, mime: String, bytes: ByteArray) {
        val ctx = AndroidPlatform.appContext
        val dir = File(ctx.cacheDir, "exports").apply { mkdirs() }
        val file = File(dir, name.replace(Regex("""[\/:*?"<>|\s]+"""), "_")).also { it.writeBytes(bytes) }
        val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".files", file)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = mime
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        ctx.startActivity(Intent.createChooser(send, name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}

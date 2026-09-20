package ru.t2sales.desktop.support

import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import ru.t2sales.desktop.di.AppContainer
import ru.t2sales.desktop.update.AppVersion
import ru.t2sales.desktop.update.UpdateConfig

/**
 * One file to send when something is wrong: versions, the state of the connection and the updater, and the update log.
 * It NEVER contains the sign-in cookies, the contents of unsent sales, or any data from the server: only counts and states.
 */
object Diagnostics {
    fun export(container: AppContainer): Path {
        val desktop = Paths.get(System.getProperty("user.home"), "Desktop").takeIf { Files.isDirectory(it) } ?: Paths.get(System.getProperty("user.home"))
        val stamp = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss"))
        val file = desktop.resolve("T2-diagnostics-$stamp.zip")
        ZipOutputStream(Files.newOutputStream(file)).use { zip ->
            zip.putNextEntry(ZipEntry("info.txt"))
            zip.write(info(container).toByteArray(Charsets.UTF_8))
            zip.closeEntry()
            val log = UpdateConfig.logFile
            if (Files.isRegularFile(log)) {
                zip.putNextEntry(ZipEntry("updater.log"))
                val bytes = Files.readAllBytes(log)
                zip.write(if (bytes.size > 200_000) bytes.copyOfRange(bytes.size - 200_000, bytes.size) else bytes) // the last ~200 KB
                zip.closeEntry()
            }
        }
        return file
    }

    fun info(container: AppContainer): String = buildString {
        fun line(k: String, v: Any?) = append(k).append(": ").append(v).append('\n')
        line("Приложение", "T2 Sales Native ${AppVersion.current}")
        line("Установлено (упаковано)", UpdateConfig.isPackaged)
        line("Время", LocalDateTime.now())
        line("Windows", System.getProperty("os.name") + " " + System.getProperty("os.version") + " " + System.getProperty("os.arch"))
        line("Java", System.getProperty("java.version") + " (" + System.getProperty("java.vendor") + ")")
        line("Память JVM, МБ (занято / максимум)", "${(Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory()) shr 20} / ${Runtime.getRuntime().maxMemory() shr 20}")
        val st = container.network.status
        line("Сеть: режим сейчас", st.effective)
        line("Сеть: выбранный режим", st.preference)
        line("Сеть: адрес relay", st.relayHost)
        line("Обновления: сервер настроен", UpdateConfig.baseUrl.isNotEmpty())
        line("Обновления: канал", UpdateConfig.channel)
        line("Обновления: состояние", container.updates.status.state)
        line("Обновления: сообщение об ошибке", container.updates.status.errorMessage)
        line("Очередь продаж: ждут отправки", container.outbox.pendingCount)
        line("Очередь продаж: требуют проверки", container.outbox.reviewCount)
    }
}

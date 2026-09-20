package ru.t2sales.desktop.network

import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.net.http.HttpTimeoutException
import java.time.Duration
import java.time.Instant
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

private const val DEFAULT_TIMEOUT_MS = 5000L

private suspend fun layer(name: String, timeoutMs: Long, failure: Outcome, block: () -> Unit): LayerResult {
    val start = System.currentTimeMillis()
    val outcome = try {
        withTimeout(timeoutMs) { withContext(Dispatchers.IO) { block() } }
        Outcome.OK
    } catch (e: TimeoutCancellationException) {
        Outcome.TIMEOUT
    } catch (e: SocketTimeoutException) {
        Outcome.TIMEOUT
    } catch (e: HttpTimeoutException) {
        Outcome.TIMEOUT
    } catch (e: Exception) {
        failure
    }
    return LayerResult(name, outcome, System.currentTimeMillis() - start)
}

/**
 * Port of network/diagnostics.ts: DNS -> TCP -> TLS -> HTTP (/healthz), stopping at the first failing layer.
 * Real certificate validation everywhere (the system trust store, never a disabled check).
 */
suspend fun runDiagnostics(originUrl: String, timeoutMs: Long = DEFAULT_TIMEOUT_MS): DiagnosticsReport {
    val url = URI(originUrl)
    val host = url.host
    val port = if (url.port != -1) url.port else 443
    val layers = mutableListOf<LayerResult>()
    fun report(overall: Outcome) = DiagnosticsReport(Instant.now().toString(), overall, layers)

    val dns = layer("DNS", timeoutMs, Outcome.DNS_FAILURE) { InetAddress.getByName(host) }
    layers += dns
    if (dns.outcome != Outcome.OK) return report(dns.outcome)

    val tcp = layer("TCP", timeoutMs, Outcome.TCP_FAILURE) {
        Socket().use { it.connect(InetSocketAddress(host, port), timeoutMs.toInt()) }
    }
    layers += tcp
    if (tcp.outcome != Outcome.OK) return report(tcp.outcome)

    val tls = layer("TLS", timeoutMs, Outcome.TLS_FAILURE) {
        val plain = Socket()
        plain.connect(InetSocketAddress(host, port), timeoutMs.toInt())
        plain.soTimeout = timeoutMs.toInt()
        (SSLSocketFactory.getDefault() as SSLSocketFactory).createSocket(plain, host, port, true).use { s ->
            (s as SSLSocket).startHandshake()
        }
    }
    layers += tls
    if (tls.outcome != Outcome.OK) return report(tls.outcome)

    val http = layer("HTTP", timeoutMs, Outcome.HTTP_FAILURE) {
        val client = HttpClient.newBuilder().connectTimeout(Duration.ofMillis(timeoutMs)).build()
        val req = HttpRequest.newBuilder(URI("https://$host${if (port != 443) ":$port" else ""}/healthz")).timeout(Duration.ofMillis(timeoutMs)).GET().build()
        val code = client.send(req, HttpResponse.BodyHandlers.discarding()).statusCode()
        if (code !in 200..299) throw IllegalStateException("HTTP $code")
    }
    layers += http
    return report(http.outcome)
}

package ru.t2sales.desktop.ui.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.t2sales.desktop.network.EffectiveState
import ru.t2sales.desktop.network.NetworkManager
import ru.t2sales.desktop.network.NetworkPreference
import ru.t2sales.desktop.network.Outcome
import ru.t2sales.desktop.network.RelayReachability
import ru.t2sales.shared.theme.T2Colors

private fun outcomeColor(o: Outcome?): Color = when (o) {
    Outcome.OK -> Color(0xFF2E7D32)
    Outcome.TIMEOUT -> Color(0xFFEF6C00)
    Outcome.DNS_FAILURE, Outcome.TCP_FAILURE, Outcome.TLS_FAILURE, Outcome.HTTP_FAILURE, Outcome.OFFLINE -> Color(0xFFC62828)
    else -> Color(0xFF757575)
}

/**
 * Port of preload/network-overlay.ts: a round indicator in the header actions (dot colour = overall DIRECT diagnostics)
 * that opens a panel: mode + preference, DNS/TCP/TLS/HTTP outcomes, relay state, relay host, last change.
 * Added on top of the Electron overlay (which is read-only there and configured by env vars): the preference chips and
 * "Проверить снова" - the native app has no menu/env to force a mode from.
 */
@Composable
fun NetworkIndicator(net: NetworkManager) {
    val st = net.status
    var open by remember { mutableStateOf(false) }
    val overall = st.lastDiagnostics?.overall
    var pillHeight by remember { mutableStateOf(0) }
    Box(Modifier.onSizeChanged { pillHeight = it.height }) {
        // a labelled pill (not a bare dot) so the network / relay button is recognisable: dot = DIRECT diagnostics, text = current transport
        val label = when (st.effective) {
            EffectiveState.Direct -> "Прямое"
            EffectiveState.Relay -> "Relay"
            EffectiveState.Offline -> "Офлайн"
            EffectiveState.Checking -> "Проверка…"
        }
        Row(
            modifier = Modifier.height(44.dp).clip(RoundedCornerShape(22.dp)).background(T2Colors.surface).border(1.dp, T2Colors.border, RoundedCornerShape(22.dp))
                .clickable { open = !open }.padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(Modifier.size(10.dp).clip(CircleShape).background(outcomeColor(overall)))
            Spacer(Modifier.size(8.dp))
            Text(label, color = T2Colors.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        }

        if (open) ru.t2sales.desktop.ui.components.PopoverPanel(anchorHeightPx = pillHeight, onDismiss = { open = false }) {
            Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp)) {
                Text(
                    "Mode: ${st.effective.id.uppercase()} (preference: ${st.preference.id})",
                    fontWeight = FontWeight.Bold, fontSize = 12.sp, modifier = Modifier.padding(bottom = 6.dp)
                )
                listOf("DNS", "TCP", "TLS", "HTTP").forEach { name ->
                    val o = st.lastDiagnostics?.layers?.firstOrNull { it.layer == name }?.outcome
                    PanelRow(name, o?.name ?: "—", outcomeColor(o ?: Outcome.UNKNOWN), bold = true)
                }
                val (relayText, relayColor) = when (st.lastRelayReachability) {
                    RelayReachability.NotConfigured -> "not configured" to Color(0xFF757575)
                    RelayReachability.NotChecked -> "not checked" to Color(0xFF757575)
                    RelayReachability.Checking -> "checking…" to Color(0xFFEF6C00)
                    RelayReachability.Reachable -> "reachable" to Color(0xFF2E7D32)
                    RelayReachability.Unreachable -> "unreachable" to Color(0xFFC62828)
                }
                PanelRow("Relay", relayText, relayColor, bold = true)
                st.relayHost?.let { PanelRow("Relay host", it, T2Colors.text, bold = false, dim = true) }
                Text("updated ${st.lastChangedAt}", color = T2Colors.hint, fontSize = 10.sp, modifier = Modifier.padding(top = 4.dp))

                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    NetworkPreference.entries.forEach { p ->
                        val selected = st.preference == p
                        Text(
                            when (p) { NetworkPreference.Auto -> "Авто"; NetworkPreference.DirectOnly -> "Только прямое"; NetworkPreference.Relay -> "Relay" },
                            fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                            color = if (selected) T2Colors.onAccent else T2Colors.text,
                            modifier = Modifier.clip(RoundedCornerShape(99.dp))
                                .background(if (selected) T2Colors.accent else T2Colors.surface2)
                                .clickable(enabled = !selected) { net.launch { setPreference(p) } }
                                .padding(horizontal = 10.dp, vertical = 5.dp)
                        )
                    }
                }
                Text(
                    "Проверить снова",
                    color = T2Colors.primary, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(top = 10.dp).clickable { net.launch { runDiagnosticsNow(); retryDirect() } }
                )
            }
        }
    }
}

@Composable
private fun PanelRow(label: String, value: String, color: Color, bold: Boolean, dim: Boolean = false) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 1.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, fontSize = 11.sp, color = if (dim) T2Colors.hint else T2Colors.text)
        Spacer(Modifier.size(12.dp))
        Text(value, fontSize = 11.sp, color = color, fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal)
    }
}

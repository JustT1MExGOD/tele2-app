/**
 * Turns a stored User-Agent (see sessions.ts::createSession, snapshotted
 * once at login) into a short "Browser, OS" label + emoji icon for the
 * "active sessions" list (my-plan, admin-center employee detail) — mirrors
 * Telegram's own device list without needing a UA-parsing dependency: this
 * codebase only has phone/password sessions (Telegram mini-app auth never
 * touches employee_sessions), so the realistic UA space is small — a
 * handful of desktop/mobile browsers, not arbitrary bot/crawler strings.
 *
 * Output only ever comes from this fixed set of known labels (never the
 * raw UA string interpolated into HTML), so callers don't need to
 * HTML-escape it.
 */
export interface DeviceInfo {
  icon: string;
  label: string;
}

const UNKNOWN: DeviceInfo = { icon: '🌐', label: 'Неизвестное устройство' };

/** Android UAs put the real hardware model right in the string (e.g.
 * "Linux; Android 14; Pixel 8 Pro Build/..." or "...; SM-G991B)") — the one
 * case a browser UA exposes an actual device model, no extra headers or
 * client-hints round-trip needed. iOS/desktop UAs never contain this
 * (Apple has omitted the iPhone/iPad model since iOS 13; desktop UAs never
 * carried a PC model at all), so there's nothing to extract there. */
function extractAndroidModel(ua: string): string | null {
  const m = ua.match(/Android [\d.]+;\s*([^;)]+?)(?:\s+Build\/|\))/);
  if (!m) return null;
  const model = m[1].trim();
  return model.length > 1 ? model : null;
}

export function describeUserAgent(ua: string | null | undefined): DeviceInfo {
  if (!ua) return UNKNOWN;

  const isTablet = /iPad/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua));
  const isMobile = /Mobi|Android|iPhone|iPod/.test(ua) || isTablet;

  let os = 'Неизвестная ОС';
  if (/iPad/.test(ua)) os = 'iPadOS';
  else if (/iPhone/.test(ua)) os = 'iOS';
  else if (/iPod/.test(ua)) os = 'iOS (iPod touch)';
  else if (/Android/.test(ua)) {
    const model = extractAndroidModel(ua);
    os = model ? `Android (${model})` : 'Android';
  }
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  let browser = 'Браузер';
  if (/YaBrowser/.test(ua)) browser = 'Яндекс Браузер';
  else if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/Firefox/.test(ua)) browser = 'Firefox';
  else if (/Chrome/.test(ua)) browser = 'Chrome';
  else if (/Safari/.test(ua)) browser = 'Safari';

  return {
    icon: isMobile ? '📱' : '💻',
    label: `${browser}, ${os}`
  };
}

export function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

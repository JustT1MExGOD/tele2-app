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

export function describeUserAgent(ua: string | null | undefined): DeviceInfo {
  if (!ua) return UNKNOWN;

  const isMobile = /Mobi|Android|iPhone|iPad/.test(ua);

  let os = 'Неизвестная ОС';
  if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Android/.test(ua)) os = 'Android';
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

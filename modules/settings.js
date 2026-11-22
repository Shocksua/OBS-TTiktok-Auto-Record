export const DEFAULTS = Object.freeze({
  theme: 'dark',
  volume: 0.8,
  repeat: false,
  autoRecord: false,
  height: 0,
  fps: 0,
  quality: 5,
  downloadFolder: 'OBS TTiktok Auto-Record',
  askWhere: false,
  rememberUrl: false,
  lastUrl: '',
  obsHost: '127.0.0.1',
  obsPort: 4455,
  obsAudio: false,
});

const PREFERENCES = 'preferences';
const RECORD_PREFIX = 'record:';

export async function loadSettings() {
  const result = await chrome.storage.local.get(PREFERENCES);
  return { ...DEFAULTS, ...result[PREFERENCES] };
}

export function saveSettings(settings) {
  return chrome.storage.local.set({ [PREFERENCES]: settings });
}

export function recordFolder(value) {
  const folder = value.trim();
  if (!folder) return '';
  const parts = folder.split('/');
  const invalid = /[<>:"\\|?*\x00-\x1f]/;
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  if (folder.length > 120 || parts.some((part) => !part || /^[. ]|[. ]$/.test(part) || invalid.test(part) || reserved.test(part))) {
    throw new Error('Ingresá una subcarpeta de Descargas, como Videos/Station, o dejá el campo vacío.');
  }
  return folder;
}

export function saveRecord(record) {
  return chrome.storage.local.set({ [`${RECORD_PREFIX}${record.id}`]: record });
}

export async function loadRecords() {
  const values = await chrome.storage.local.get(null);
  return Object.entries(values)
    .filter(([key]) => key.startsWith(RECORD_PREFIX))
    .map(([, value]) => value)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function discardRecords(records) {
  return chrome.storage.local.remove(records.map((record) => `${RECORD_PREFIX}${record.id}`));
}

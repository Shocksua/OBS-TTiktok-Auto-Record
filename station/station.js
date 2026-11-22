import { ObsStudio } from '../modules/obs-websocket.js';
import { mediaUrl, Player } from '../modules/player.js';
import { Downloads, Recorder } from '../modules/recorder.js';
import { DEFAULTS, loadRecords, loadSettings, recordFolder, saveSettings } from '../modules/settings.js';
import { wireTikTokGuide } from '../modules/tiktok-guide.js';
import { clock } from '../modules/time.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const player = new Player(video);
const recorder = new Recorder();
const downloads = new Downloads();
const obs = new ObsStudio(chrome.runtime.id);
let preferences = { ...DEFAULTS };
let nextAfterLoad = null;
let finishedSource = null;
let switching = false;
let playbackRequest = 0;
let popupMove;
let historyRefresh = 0;

function notice(message, problem = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', problem);
}

function dialogMessage(id, message = '') {
  $(id).textContent = message;
  $(id).hidden = !message;
}

function persist(patch) {
  preferences = { ...preferences, ...patch };
  saveSettings(preferences).catch(() => notice('Chrome no pudo guardar las preferencias.', true));
}

function on(id, event, callback) {
  $(id).addEventListener(event, callback);
}

function action(id, callback) {
  on(id, 'click', async () => {
    try { await callback(); } catch (error) { notice(error.message, true); }
  });
}

function sourceChanged() {
  if (preferences.rememberUrl) {
    const source = player.source;
    persist({ lastUrl: source?.rememberable ? source.url : '' });
  }
}

function selectSource(index, autoplay = false) {
  playbackRequest++;
  nextAfterLoad = autoplay ? player.queue[index] : null;
  finishedSource = null;
  player.select(index);
  sourceChanged();
  if (player.source) notice(`Fuente seleccionada: ${player.source.name}`);
}

function renderQueue() {
  const list = $('queue');
  list.replaceChildren();
  player.queue.forEach((source, index) => {
    const item = document.createElement('li');
    const select = document.createElement('button');
    const remove = document.createElement('button');
    select.type = remove.type = 'button';
    select.textContent = select.title = source.name;
    remove.textContent = '×';
    remove.title = 'Quitar de la lista';
    remove.setAttribute('aria-label', `Quitar ${source.name} de la lista`);
    select.disabled = remove.disabled = recorder.busy || switching;
    if (index === player.index) {
      item.classList.add('is-current');
      select.setAttribute('aria-current', 'true');
    }
    select.addEventListener('click', () => { if (!recorder.busy && !switching) selectSource(index); });
    remove.addEventListener('click', () => {
      if (recorder.busy || switching) return;
      nextAfterLoad = null;
      const current = player.index === index;
      player.remove(index);
      if (current) sourceChanged();
    });
    item.append(select, remove);
    list.append(item);
  });
  $('queue-empty').hidden = player.queue.length !== 0;
  $('queue-count').textContent = `${player.queue.length} ${player.queue.length === 1 ? 'video' : 'videos'}`;
}

function renderPlayer() {
  const { ready, source } = player;
  const processing = recorder.phase === 'preparing' || recorder.phase === 'finishing' || switching;
  $('source-name').textContent = source?.name ?? 'Sin fuente';
  $('source-name').title = source?.name ?? '';
  const info = [];
  if (video.videoWidth) info.push(`${video.videoWidth} × ${video.videoHeight}`);
  if (player.fps) info.push(`${Math.round(player.fps)} FPS mostrados`);
  if (ready && source.kind === 'url' && !player.useCors) info.push('Grabación local requiere CORS');
  $('source-spec').textContent = info.join(' · ') || 'Resolución y FPS al reproducir';
  const playStatus = player.failed ? 'Incompatible' : ready ? (video.paused ? (video.ended ? 'Finalizado' : 'En pausa') : 'Reproduciendo') : source ? 'Cargando' : 'En espera';
  $('play-state').textContent = playStatus;
  $('play-state').dataset.state = player.failed ? 'error' : ready ? 'ready' : 'idle';
  $('empty-view').hidden = ready;
  $('empty-text').textContent = player.failed ? 'La fuente no está disponible' : source ? 'Cargando video…' : 'Abrí un video para empezar';
  $('elapsed').textContent = clock(video.currentTime);
  $('duration').textContent = clock(video.duration);
  $('seek').disabled = !ready || !Number.isFinite(video.duration) || !video.duration;
  if (!$('seek').disabled) $('seek').value = 100 * video.currentTime / video.duration;
  $('play').disabled = !ready || !video.paused || processing;
  $('pause').disabled = !ready || video.paused;
  $('stop').disabled = !source || switching;
  $('fullscreen').disabled = !ready;
  $('open-files').disabled = $('open-url').disabled = recorder.busy || switching;
  $('open-subtitles').disabled = !ready;
  $('clear-subtitles').hidden = !player.subtitle;
  $('record-start').disabled = !player.recordable || recorder.busy || switching;
  $('record-stop').disabled = recorder.phase !== 'recording';

  if (ready && nextAfterLoad === source) {
    nextAfterLoad = null;
    play().catch((error) => notice(error.message, true));
  }
}

function renderRecorder() {
  const labels = { idle: 'Lista', preparing: 'Preparando…', recording: clock(recorder.seconds), finishing: 'Finalizando…' };
  $('record-state').textContent = labels[recorder.phase];
  $('record-state').dataset.state = recorder.phase === 'recording' ? 'record' : 'idle';
  renderPlayer();
  renderQueue();
}

function renderObs() {
  $('obs-status').textContent = obs.message;
  $('obs-connect').textContent = obs.connected ? 'Actualizar audio y conexión' : 'Conectar';
  $('obs-connect').disabled = obs.phase === 'connecting' || obs.owned;
  $('obs-disconnect').hidden = !obs.connected;
  $('obs-disconnect').disabled = obs.owned || obs.command;
  const select = $('obs-scene');
  const current = select.value;
  const names = Array.from(select.options, (option) => option.value);
  if (names.length !== obs.scenes.length || names.some((name, index) => name !== obs.scenes[index])) {
    select.replaceChildren(...obs.scenes.map((scene) => new Option(scene, scene)));
    if (!obs.scenes.length) select.add(new Option('Conectá OBS', ''));
    else select.value = obs.scenes.includes(current) ? current : obs.scene;
  }
  const available = obs.connected && !obs.command && Boolean(select.value);
  select.disabled = !obs.connected || obs.command;
  $('obs-use-scene').disabled = !available || select.value === obs.scene || obs.recording;
  $('obs-add-source').disabled = !available || obs.recording;
  $('obs-record').disabled = !available || (!obs.owned && (obs.recording || select.value !== obs.scene || !player.ready));
  $('obs-record').textContent = obs.owned ? 'Detener en OBS' : 'Grabar en OBS';
  $('obs-record-state').textContent = obs.recording ? `${obs.owned ? 'Grabando' : 'Grabación en OBS'} · ${clock(obs.duration / 1000)}` : '';
}

async function play() {
  if (!player.ready) return;
  const request = ++playbackRequest;
  if (video.ended) video.currentTime = 0;
  finishedSource = null;
  if (preferences.autoRecord && !recorder.busy && player.recordable) {
    try { await recorder.start(player, preferences); }
    catch (error) { notice(`Auto-Record: ${error.message}`, true); }
  }
  if (request === playbackRequest && player.ready) await video.play();
}

async function stopPlayback() {
  playbackRequest++;
  nextAfterLoad = null;
  finishedSource = null;
  await recorder.stop();
  player.stop();
}

async function mediaEnded() {
  const source = player.source;
  finishedSource = source;
  switching = true;
  renderRecorder();
  await recorder.stop();
  switching = false;
  if (source === player.source && source === finishedSource && player.queue[player.index + 1]) {
    selectSource(player.index + 1, true);
  }
  renderRecorder();
}

async function revealWindow(enterCapture) {
  if (!popupMove) {
    popupMove = (async () => {
      const tab = await chrome.tabs.getCurrent();
      const current = await chrome.windows.get(tab.windowId);
      if (current.type !== 'popup') {
        await chrome.windows.create({ tabId: tab.id, type: 'popup', width: 1180, height: 730, focused: true });
      } else {
        await chrome.windows.update(current.id, { focused: true });
      }
    })().finally(() => { popupMove = null; });
  }
  await popupMove;
  document.body.classList.toggle('capture', enterCapture);
}

function showSettings() {
  $('quality').value = preferences.quality;
  $('record-height').value = preferences.height;
  $('record-fps').value = preferences.fps;
  $('theme').value = preferences.theme;
  $('download-folder').value = preferences.downloadFolder;
  $('ask-where').checked = preferences.askWhere;
  $('remember-url').checked = preferences.rememberUrl;
  dialogMessage('settings-message');
  if (!$('settings-dialog').open) $('settings-dialog').showModal();
}

function applyPreferences() {
  video.volume = preferences.volume;
  video.loop = preferences.repeat;
  $('volume').value = Math.round(video.volume * 100);
  $('volume-value').value = `${$('volume').value} %`;
  $('repeat').checked = video.loop;
  $('auto-record').checked = preferences.autoRecord;
  document.documentElement.dataset.theme = preferences.theme;
}

async function renderHistory() {
  const requested = ++historyRefresh;
  const data = await loadRecords();
  if (requested !== historyRefresh) return;
  const list = $('history-list');
  list.replaceChildren();
  $('history-empty').hidden = data.length !== 0;
  for (const record of data) {
    const item = document.createElement('li');
    const summary = document.createElement('div');
    const title = document.createElement('strong');
    const detail = document.createElement('p');
    title.textContent = record.name;
    const state = { ready: 'Lista para descargar', saving: 'Descargando', saved: 'Guardada' }[record.state];
    detail.className = 'detail';
    detail.textContent = `${new Date(record.startedAt).toLocaleString('es-AR')} · ${clock(record.seconds)} · ${state}`;
    summary.append(title, detail);
    item.append(summary);
    if (record.state === 'ready' || record.state === 'saved') {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = record.state === 'ready' ? 'Descargar' : 'Mostrar carpeta';
      button.addEventListener('click', () => {
        if (record.state === 'ready') downloads.download(record, preferences);
        else chrome.downloads.show(record.downloadId);
      });
      item.append(button);
    }
    list.append(item);
  }
}

document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
action('open-files', () => $('file-input').click());
on('file-input', 'change', () => {
  if ($('file-input').files.length && !recorder.busy) selectSource(player.addFiles($('file-input').files));
  $('file-input').value = '';
});
action('open-url', () => { dialogMessage('url-message'); $('url-dialog').showModal(); });
on('url-form', 'submit', (event) => {
  event.preventDefault();
  try {
    const source = mediaUrl($('url-input').value);
    $('url-input').value = '';
    $('url-dialog').close();
    selectSource(player.append([source]));
  } catch (error) { dialogMessage('url-message', error.message); }
});
action('open-subtitles', () => $('subtitle-input').click());
on('subtitle-input', 'change', () => {
  try { if ($('subtitle-input').files[0]) player.setSubtitles($('subtitle-input').files[0]); }
  catch (error) { notice(error.message, true); }
  $('subtitle-input').value = '';
});
action('clear-subtitles', () => { player.removeSubtitles(); renderPlayer(); });
action('play', play);
action('pause', () => video.pause());
action('stop', stopPlayback);
action('fullscreen', () => video.requestFullscreen());
action('capture-window', () => revealWindow(true));
on('seek', 'input', () => { video.currentTime = video.duration * Number($('seek').value) / 100; });
on('volume', 'input', () => {
  video.volume = Number($('volume').value) / 100;
  $('volume-value').value = `${$('volume').value} %`;
});
on('volume', 'change', () => persist({ volume: video.volume }));
on('repeat', 'change', () => { video.loop = $('repeat').checked; persist({ repeat: video.loop }); });
on('auto-record', 'change', () => persist({ autoRecord: $('auto-record').checked }));

action('record-start', async () => {
  const request = ++playbackRequest;
  if (video.ended) video.currentTime = 0;
  await recorder.start(player, preferences);
  try { if (request === playbackRequest && video.paused) await video.play(); }
  catch (error) { await recorder.stop({ discard: true }); throw error; }
});
action('record-stop', () => recorder.stop());
action('history-button', async () => { await renderHistory(); $('history-dialog').showModal(); });

action('settings-button', showSettings);
action('reset-settings', () => { persist(DEFAULTS); applyPreferences(); showSettings(); notice('Se restauraron los valores predeterminados.'); });
on('settings-form', 'submit', (event) => {
  event.preventDefault();
  try {
    const rememberUrl = $('remember-url').checked;
    persist({
      quality: Number($('quality').value), height: Number($('record-height').value), fps: Number($('record-fps').value),
      theme: $('theme').value, downloadFolder: recordFolder($('download-folder').value), askWhere: $('ask-where').checked,
      rememberUrl, lastUrl: rememberUrl && player.source?.rememberable ? player.source.url : '',
    });
    applyPreferences();
    $('settings-dialog').close();
  } catch (error) { dialogMessage('settings-message', error.message); }
});

action('obs-setup', () => {
  $('obs-host').value = preferences.obsHost;
  $('obs-port').value = preferences.obsPort;
  $('obs-password').value = '';
  $('obs-audio').checked = preferences.obsAudio;
  dialogMessage('obs-dialog-message');
  $('obs-dialog').showModal();
});
on('obs-audio', 'change', () => persist({ obsAudio: $('obs-audio').checked }));
on('obs-form', 'submit', async (event) => {
  event.preventDefault();
  if (obs.phase === 'connecting') return;
  const host = $('obs-host').value.trim();
  const port = Number($('obs-port').value);
  const password = $('obs-password').value;
  $('obs-password').value = '';
  dialogMessage('obs-dialog-message', 'Conectando a OBS…');
  try {
    await obs.connect(host, port, password);
    persist({ obsHost: host, obsPort: port });
    $('obs-dialog').close();
  } catch (error) { dialogMessage('obs-dialog-message', error.message); }
});
on('obs-dialog', 'close', () => { $('obs-password').value = ''; });
action('obs-disconnect', () => { obs.disconnect(); $('obs-dialog').close(); });
on('obs-scene', 'change', renderObs);
action('obs-use-scene', async () => {
  const scene = $('obs-scene').value;
  if (confirm(`¿Activar «${scene}» como escena de programa en OBS?`)) notice(await obs.activateScene(scene, obs.collection));
});
action('obs-add-source', async () => {
  const scene = $('obs-scene').value;
  const collection = obs.collection;
  if (!confirm(`¿Agregar una fuente de captura de Station a la escena «${scene}» de OBS?`)) return;
  await revealWindow(false);
  notice(await obs.addCapture(scene, collection, preferences.obsAudio));
});
action('obs-record', async () => {
  const message = obs.owned ? await obs.stopRecording() : await obs.startRecording($('obs-scene').value, obs.collection);
  notice(message);
});

wireTikTokGuide($('tiktok-button'), $('tiktok-dialog'), revealWindow, notice);
player.addEventListener('queue', renderQueue);
player.addEventListener('change', () => { renderPlayer(); renderObs(); });
player.addEventListener('problem', ({ detail }) => { nextAfterLoad = null; notice(detail, true); });
player.addEventListener('protected', ({ detail }) => { recorder.stop({ discard: true }); notice(detail, true); });
video.addEventListener('ended', () => { if (!video.loop) mediaEnded().catch((error) => notice(error.message, true)); });
recorder.addEventListener('change', renderRecorder);
recorder.addEventListener('problem', ({ detail }) => notice(detail, true));
recorder.addEventListener('saved', ({ detail }) => {
  notice('Grabación WEBM finalizada. Podés seguir la descarga desde Historial.');
  downloads.download(detail, preferences);
});
downloads.addEventListener('change', () => { if ($('history-dialog').open) renderHistory(); });
downloads.addEventListener('problem', ({ detail }) => notice(detail, true));
obs.addEventListener('change', renderObs);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && document.body.classList.contains('capture') && !document.fullscreenElement) {
    document.body.classList.remove('capture');
    $('capture-window').focus();
  }
});
window.addEventListener('beforeunload', (event) => {
  if (!(recorder.busy || downloads.launching.size || obs.owned || obs.command)) return;
  event.preventDefault();
  event.returnValue = '';
});
setInterval(() => { if (recorder.phase === 'recording') $('record-state').textContent = clock(recorder.seconds); }, 500);

try {
  preferences = await loadSettings();
  applyPreferences();
  if (preferences.rememberUrl && preferences.lastUrl) selectSource(player.append([mediaUrl(preferences.lastUrl)]));
  await downloads.recover();
} catch (error) {
  notice(error.message, true);
}
renderRecorder();
renderObs();

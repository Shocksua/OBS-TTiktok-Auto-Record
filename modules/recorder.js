import { discardRecords, loadRecords, saveRecord } from './settings.js';

async function workingFiles() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('recordings', { create: true });
}

function filename(name, date, id) {
  const safe = name.replace(/\.[a-z\d]{1,6}$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 80);
  const stamp = date.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `${stamp}_${safe || 'Video'}_${id.slice(0, 8)}.webm`;
}

export function outputDimensions(width, height, limit) {
  if (!limit || Math.min(width, height) <= limit) return [width, height];
  const scale = limit / Math.min(width, height);
  return [Math.max(2, Math.floor(width * scale / 2) * 2), Math.max(2, Math.floor(height * scale / 2) * 2)];
}

function capture(video, preferences) {
  const origin = video.captureStream();
  if (!origin.getVideoTracks().length) {
    for (const track of origin.getTracks()) track.stop();
    throw new Error('Chrome todavía no ofrece una pista de video para grabar. Probá con el video reproduciéndose.');
  }
  const [width, height] = outputDimensions(video.videoWidth, video.videoHeight, preferences.height);
  if (width === video.videoWidth && height === video.videoHeight && !preferences.fps) {
    return { stream: origin, close: () => origin.getTracks().forEach((track) => track.stop()) };
  }

  let canvasStream;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    const limit = preferences.fps || 60;
    let last = -Infinity;
    let callback;
    const draw = () => {
      const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
      const frameWidth = video.videoWidth * scale;
      const frameHeight = video.videoHeight * scale;
      context.fillStyle = '#000';
      context.fillRect(0, 0, width, height);
      context.drawImage(video, (width - frameWidth) / 2, (height - frameHeight) / 2, frameWidth, frameHeight);
    };
    draw();
    canvasStream = canvas.captureStream(limit);
    const nextFrame = (time) => {
      if (video.readyState >= 2 && time - last >= 1000 / limit - 1) {
        draw();
        last = time;
      }
      callback = video.requestVideoFrameCallback(nextFrame);
    };
    callback = video.requestVideoFrameCallback(nextFrame);
    return {
      stream: new MediaStream([...canvasStream.getVideoTracks(), ...origin.getAudioTracks()]),
      close: () => {
        video.cancelVideoFrameCallback(callback);
        for (const track of [...canvasStream.getTracks(), ...origin.getTracks()]) track.stop();
      },
    };
  } catch (error) {
    for (const track of [...(canvasStream?.getTracks() ?? []), ...origin.getTracks()]) track.stop();
    throw error;
  }
}

export class Recorder extends EventTarget {
  constructor() {
    super();
    this.phase = 'idle';
    this.session = null;
  }

  get busy() { return this.phase !== 'idle'; }
  get seconds() { return this.session?.started ? (performance.now() - this.session.started) / 1000 : 0; }

  state(phase) {
    this.phase = phase;
    this.dispatchEvent(new Event('change'));
  }

  async start(player, preferences) {
    if (this.busy) throw new Error('Ya hay una grabación de Chrome en curso.');
    if (!player.recordable) throw new Error('La grabación en Chrome requiere un video propio o autorizado y acceso al archivo desde el reproductor.');
    if (!player.video.captureStream || !globalThis.MediaRecorder?.isTypeSupported('video/webm')) {
      throw new Error('Esta versión de Chrome no ofrece grabación WEBM para esta fuente.');
    }
    const id = crypto.randomUUID();
    const date = new Date();
    const name = filename(player.source.name, date, id);
    const source = player.source;
    const session = {
      id, cancelled: false, discard: false, error: null, writes: Promise.resolve(),
      record: { id, name, startedAt: date.toISOString(), state: 'ready', seconds: 0, size: 0 },
    };
    session.done = new Promise((resolve) => { session.resolve = resolve; });
    this.session = session;
    this.state('preparing');

    try {
      session.directory = await workingFiles();
      session.file = await session.directory.getFileHandle(name, { create: true });
      session.writer = await session.file.createWritable();
      if (session.cancelled || player.source !== source || !player.recordable) throw new Error('Se canceló la grabación.');
      session.capture = capture(player.video, preferences);
      const mime = 'video/webm;codecs=vp8' + (session.capture.stream.getAudioTracks().length ? ',opus' : '');
      session.encoder = new MediaRecorder(session.capture.stream, {
        mimeType: MediaRecorder.isTypeSupported(mime) ? mime : 'video/webm',
        videoBitsPerSecond: preferences.quality * 1_000_000,
        audioBitsPerSecond: 128_000,
      });
      session.encoder.addEventListener('dataavailable', ({ data }) => this.write(session, data));
      session.encoder.addEventListener('stop', () => this.finalize(session), { once: true });
      session.encoder.addEventListener('error', () => {
        session.error ||= new Error('Chrome encontró un error durante la grabación.');
      });
      session.encoder.start(1000);
      session.started = performance.now();
      this.state('recording');
    } catch (error) {
      session.error = error;
      session.discard = true;
      await this.finalize(session);
      throw error;
    }
  }

  write(session, data) {
    if (!data.size || session.discard) return;
    session.writes = session.writes.then(async () => {
      if (session.error || session.discard) return;
      try {
        await session.writer.write(data);
        session.record.size += data.size;
      } catch {
        session.error = new Error('La grabación no se pudo escribir. Revisá el espacio disponible en Chrome.');
        if (session.encoder.state !== 'inactive') session.encoder.stop();
      }
    });
  }

  stop({ discard = false } = {}) {
    const session = this.session;
    if (!session) return Promise.resolve();
    session.discard ||= discard;
    if (this.phase === 'preparing') session.cancelled = true;
    if (this.phase === 'recording' && session.encoder.state !== 'inactive') {
      this.state('finishing');
      session.encoder.stop();
    }
    return session.done;
  }

  async finalize(session) {
    const { record, capture: tracks } = session;
    record.seconds = this.seconds;
    this.state('finishing');
    tracks?.close();
    try {
      await session.writes;
      if (session.discard || session.error || !record.size) {
        if (session.writer) await session.writer.abort().catch(() => {});
        if (session.file) await session.directory.removeEntry(record.name).catch(() => {});
        if (!session.discard) throw session.error || new Error('No se grabaron fotogramas. Reproducí el video durante unos segundos.');
        return;
      }
      await session.writer.close();
      await saveRecord(record);
      this.dispatchEvent(new CustomEvent('saved', { detail: record }));
    } catch (error) {
      this.dispatchEvent(new CustomEvent('problem', { detail: error.message }));
    } finally {
      this.session = null;
      this.state('idle');
      session.resolve();
    }
  }
}

export class Downloads extends EventTarget {
  constructor() {
    super();
    this.pending = new Map();
    this.launching = new Set();
    chrome.downloads.onChanged.addListener((delta) => {
      if (delta.state && delta.state.current !== 'in_progress') this.complete(delta.id, delta.state.current);
    });
  }

  emitChange() { this.dispatchEvent(new Event('change')); }

  async download(record, settings) {
    if (this.launching.has(record.id) || [...this.pending.values()].some((entry) => entry.record.id === record.id)) return;
    this.launching.add(record.id);
    let url;
    try {
      const dir = await workingFiles();
      const file = await (await dir.getFileHandle(record.name)).getFile();
      url = URL.createObjectURL(file);
      const name = settings.downloadFolder ? `${settings.downloadFolder}/${record.name}` : record.name;
      const id = await chrome.downloads.download({ url, filename: name, conflictAction: 'uniquify', saveAs: settings.askWhere });
      const tracked = { ...record, downloadId: id, state: 'saving' };
      await saveRecord(tracked);
      this.pending.set(id, { record: tracked, url });
      url = null;
      const [item] = await chrome.downloads.search({ id });
      if (item && item.state !== 'in_progress') await this.complete(id, item.state);
    } catch {
      await saveRecord({ ...record, state: 'ready', downloadId: null });
      this.dispatchEvent(new CustomEvent('problem', { detail: 'No se completó la descarga. Podés reintentar desde el historial.' }));
    } finally {
      if (url) URL.revokeObjectURL(url);
      this.launching.delete(record.id);
      this.emitChange();
    }
  }

  async complete(id, state) {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    if (entry.url) URL.revokeObjectURL(entry.url);
    const saved = state === 'complete';
    await saveRecord({ ...entry.record, state: saved ? 'saved' : 'ready', downloadId: saved ? id : null });
    if (saved) {
      const dir = await workingFiles();
      await dir.removeEntry(entry.record.name).catch(() => {});
      const history = await loadRecords();
      await discardRecords(history.filter((record) => record.state === 'saved').slice(30));
    }
    this.emitChange();
  }

  async recover() {
    for (const record of await loadRecords()) {
      if (record.state !== 'saving') continue;
      this.pending.set(record.downloadId, { record });
      const [item] = await chrome.downloads.search({ id: record.downloadId });
      if (item?.state !== 'in_progress') await this.complete(record.downloadId, item?.state);
    }
  }
}

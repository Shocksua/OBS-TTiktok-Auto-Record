export const DRM_MESSAGE = 'Esta fuente utiliza protección de contenido y no se puede capturar en la estación.';
const netflixDomains = ['netflix.com', 'netflix.net', 'nflxvideo.net'];

export function mediaUrl(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Ingresá una URL directa de video que empiece con https:// o http://.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Usá una URL HTTP o HTTPS sin usuario ni contraseña en el enlace.');
  }
  const hostname = url.hostname.replace(/\.$/, '');
  if (netflixDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
    throw new Error(DRM_MESSAGE);
  }
  const segment = url.pathname.replace(/\/$/, '').split('/').at(-1);
  let label = segment || hostname;
  try { label = decodeURIComponent(label); } catch { /* Keep the encoded filename. */ }
  return { kind: 'url', url: url.href, name: label, rememberable: !url.search && !url.hash };
}

export class Player extends EventTarget {
  constructor(video) {
    super();
    this.video = video;
    this.queue = [];
    this.index = -1;
    this.fps = 0;
    this.useCors = false;
    this.protected = false;
    this.failed = false;
    this.fileUrl = null;
    this.subtitleUrl = null;
    this.subtitle = null;
    this.frameBase = null;

    video.addEventListener('encrypted', () => this.blockProtected());
    video.addEventListener('error', () => this.mediaError());
    video.addEventListener('seeked', () => { this.frameBase = null; });
    video.addEventListener('loadeddata', () => {
      if (!video.videoWidth && this.source) {
        this.failed = true;
        this.emit('problem', 'Elegí un archivo o enlace que tenga una pista de video compatible con Chrome.');
      }
      this.emit('change');
    });
    for (const event of ['play', 'playing', 'pause', 'timeupdate', 'durationchange', 'resize', 'waiting']) {
      video.addEventListener(event, () => this.emit('change'));
    }
    video.requestVideoFrameCallback?.((time, frame) => this.countFrame(time, frame));
  }

  get source() { return this.queue[this.index]; }
  get ready() { return !this.failed && Boolean(this.source && this.video.videoWidth && this.video.readyState >= 2); }
  get recordable() { return this.ready && !this.protected && (this.source.kind === 'file' || this.useCors); }

  emit(name, detail) { this.dispatchEvent(new CustomEvent(name, { detail })); }

  addFiles(files) {
    return this.append(Array.from(files, (file) => ({ kind: 'file', file, name: file.name })));
  }

  append(sources) {
    const index = this.queue.length;
    this.queue.push(...sources);
    this.emit('queue');
    return index;
  }

  select(index) {
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    if (this.fileUrl) URL.revokeObjectURL(this.fileUrl);
    this.fileUrl = null;
    this.removeSubtitles();
    this.index = index;
    this.frameBase = null;
    this.fps = 0;
    this.protected = false;
    this.failed = false;
    this.useCors = this.source?.kind === 'url';
    if (this.source) {
      if (this.useCors) {
        this.video.crossOrigin = 'anonymous';
        this.video.src = this.source.url;
      } else {
        this.video.removeAttribute('crossorigin');
        this.fileUrl = URL.createObjectURL(this.source.file);
        this.video.src = this.fileUrl;
      }
    }
    this.emit('queue');
    this.emit('change');
  }

  remove(index) {
    if (index < 0 || index >= this.queue.length) return;
    this.queue.splice(index, 1);
    if (index === this.index) this.select(Math.min(index, this.queue.length - 1));
    else {
      if (index < this.index) this.index--;
      this.emit('queue');
    }
  }

  mediaError() {
    if (!this.source || this.protected || !this.video.error) return;
    if (this.useCors && this.video.error.code === 4) {
      this.useCors = false;
      this.video.removeAttribute('crossorigin');
      this.video.src = this.source.url;
      return;
    }
    this.failed = true;
    this.emit('problem', 'Chrome no pudo abrir el video. Revisá que el enlace apunte al archivo y que sus códecs sean compatibles.');
    this.emit('change');
  }

  blockProtected() {
    if (this.protected) return;
    this.protected = true;
    this.failed = true;
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.emit('protected', DRM_MESSAGE);
    this.emit('change');
  }

  stop() {
    this.video.pause();
    if (this.video.readyState) this.video.currentTime = 0;
    this.emit('change');
  }

  setSubtitles(file) {
    if (!file.name.toLowerCase().endsWith('.vtt')) throw new Error('Elegí un archivo de subtítulos WebVTT (.vtt).');
    this.removeSubtitles();
    this.subtitleUrl = URL.createObjectURL(file);
    this.subtitle = document.createElement('track');
    this.subtitle.kind = 'subtitles';
    this.subtitle.srclang = 'es';
    this.subtitle.label = file.name;
    this.subtitle.src = this.subtitleUrl;
    this.video.append(this.subtitle);
    this.subtitle.track.mode = 'showing';
    this.emit('change');
  }

  removeSubtitles() {
    if (this.subtitle) {
      this.subtitle.track.mode = 'disabled';
      this.subtitle.remove();
    }
    if (this.subtitleUrl) URL.revokeObjectURL(this.subtitleUrl);
    this.subtitle = null;
    this.subtitleUrl = null;
  }

  countFrame(time, frame) {
    const base = this.frameBase;
    if (!base || frame.mediaTime < base.mediaTime) this.frameBase = frame;
    else if (frame.mediaTime - base.mediaTime >= 0.9) {
      this.fps = (frame.presentedFrames - base.presentedFrames) / (frame.mediaTime - base.mediaTime);
      this.frameBase = frame;
      this.emit('change');
    }
    this.video.requestVideoFrameCallback((nextTime, nextFrame) => this.countFrame(nextTime, nextFrame));
  }
}

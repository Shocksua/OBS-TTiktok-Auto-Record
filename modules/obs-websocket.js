export const WINDOW_TITLE = 'OBS TTiktok Auto-Record — STATION';
const CAPTURE_NAME = 'OBS TTiktok Auto-Record · Ventana';
const OUTPUT_EVENTS = 1 << 6;

export function obsAddress(host, port) {
  const location = host.trim().toLowerCase();
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(location)) {
    throw new Error('Ingresá 127.0.0.1, localhost o [::1] para conectar al OBS de esta computadora.');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Ingresá un puerto de OBS entre 1 y 65535.');
  return `ws://${location}:${port}`;
}

async function base64Hash(input) {
  const token = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return btoa(String.fromCharCode(...new Uint8Array(token)));
}

export async function obsAuthentication(password, salt, challenge) {
  return base64Hash(await base64Hash(password + salt) + challenge);
}

export function stationWindow(items) {
  const matches = items.filter((item) => {
    if (!item.itemEnabled || typeof item.itemValue !== 'string') return false;
    const [title, winClass, executable] = item.itemValue.split(':').map((part) => part.replace(/#3A/g, ':').replace(/#22/g, '#'));
    const validTitles = [WINDOW_TITLE, `${WINDOW_TITLE} - Google Chrome`, `${WINDOW_TITLE} - Google Chrome for Testing`, `${WINDOW_TITLE} - Chromium`];
    return validTitles.includes(title) && /^Chrome_WidgetWin_/.test(winClass ?? '') && /^(chrome|chromium)\.exe$/i.test(executable ?? '');
  });
  if (matches.length !== 1) {
    throw new Error(matches.length ? 'Hay más de una ventana de Station. Cerrá las duplicadas y probá de nuevo.' : 'OBS no encontró la ventana. Abrí Ventana de captura y dejala sin minimizar.');
  }
  return matches[0].itemValue;
}

class ObsSocket extends EventTarget {
  constructor() {
    super();
    this.socket = null;
    this.pending = new Map();
    this.ready = false;
  }

  open(address, password) {
    this.close();
    const socket = new WebSocket(address, 'obswebsocket.json');
    this.socket = socket;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail('OBS no respondió. Revisá el puerto y el servidor WebSocket.'), 4500);
      const fail = (message) => {
        clearTimeout(timer);
        reject(new Error(message));
        if (this.socket === socket) this.close(message);
      };
      socket.addEventListener('close', ({ code }) => {
        if (this.socket !== socket) {
          clearTimeout(timer);
          reject(new Error('Se cerró la conexión con OBS.'));
          return;
        }
        const reason = code === 4009 ? 'OBS rechazó la contraseña de WebSocket.' : 'Se interrumpió la conexión con OBS.';
        fail(reason);
      });
      socket.addEventListener('message', async (event) => {
        if (this.socket !== socket) return;
        try {
          const { op, d } = JSON.parse(event.data);
          if (op === 0 && !this.ready) {
            if (d.rpcVersion < 1) throw new Error('Se requiere OBS WebSocket 5.x.');
            const identify = { rpcVersion: 1, eventSubscriptions: OUTPUT_EVENTS };
            if (d.authentication) {
              const { salt, challenge } = d.authentication;
              identify.authentication = await obsAuthentication(password, salt, challenge);
            }
            password = '';
            if (this.socket === socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op: 1, d: identify }));
          } else if (op === 2 && !this.ready) {
            clearTimeout(timer);
            this.ready = true;
            resolve();
          } else if (op === 7) {
            this.answer(d);
          } else if (op === 5) {
            this.dispatchEvent(new CustomEvent('obs-event', { detail: d }));
          }
        } catch (error) {
          fail(error.message);
        }
      });
    });
  }

  request(type, data = {}) {
    if (!this.ready || this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Conectá OBS WebSocket primero.'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`OBS no confirmó ${type}. Revisá el estado en OBS.`));
        this.close('OBS dejó de responder.');
      }, 4500);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ op: 6, d: { requestType: type, requestId: id, requestData: data } }));
    });
  }

  answer(data) {
    const entry = this.pending.get(data.requestId);
    if (!entry) return;
    this.pending.delete(data.requestId);
    clearTimeout(entry.timer);
    if (data.requestStatus.result) entry.resolve(data.responseData ?? {});
    else entry.reject(new Error(`${data.requestType}: ${data.requestStatus.comment || `error ${data.requestStatus.code}`}`));
  }

  close(reason = '') {
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    socket?.close();
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason || 'Se cerró la conexión con OBS.'));
    }
    this.pending.clear();
    if (socket) this.dispatchEvent(new CustomEvent('closed', { detail: reason }));
  }
}

export class ObsStudio extends EventTarget {
  constructor(marker) {
    super();
    this.wire = new ObsSocket();
    this.marker = marker;
    this.phase = 'idle';
    this.message = 'OBS desconectado';
    this.version = '';
    this.scenes = [];
    this.scene = '';
    this.collection = '';
    this.recording = false;
    this.owned = false;
    this.duration = 0;
    this.command = false;
    this.refreshing = null;
    this.generation = 0;

    this.wire.addEventListener('closed', ({ detail }) => {
      clearInterval(this.poll);
      this.generation++;
      this.refreshing = null;
      const priorOwned = this.owned;
      this.phase = 'idle';
      this.message = priorOwned ? 'Se cortó la conexión durante la grabación. Revisá OBS.' : detail || 'OBS desconectado';
      this.recording = this.owned = false;
      this.scenes = [];
      this.scene = this.collection = '';
      this.change();
    });
    this.wire.addEventListener('obs-event', ({ detail }) => {
      if (detail.eventType !== 'RecordStateChanged') return;
      const state = detail.eventData;
      this.recording = state.outputActive;
      if (['OBS_WEBSOCKET_OUTPUT_STOPPING', 'OBS_WEBSOCKET_OUTPUT_STOPPED'].includes(state.outputState)) this.owned = false;
      this.change();
    });
  }

  get connected() { return this.phase === 'connected' && this.wire.ready; }
  change() { this.dispatchEvent(new Event('change')); }
  rpc(name, data) { return this.wire.request(name, data); }

  async connect(host, port, password) {
    const address = obsAddress(host, port);
    this.wire.close();
    this.phase = 'connecting';
    this.message = 'Conectando a OBS…';
    this.change();
    try {
      await this.wire.open(address, password);
      const version = await this.rpc('GetVersion');
      this.version = version.obsVersion;
      this.phase = 'connected';
      this.message = `OBS ${this.version} conectado`;
      await this.refresh();
      this.poll = setInterval(() => {
        if (!this.command) this.refresh().catch(() => {});
      }, 1500);
      this.change();
    } catch (error) {
      this.wire.close(error.message);
      this.phase = 'idle';
      this.message = error.message;
      this.change();
      throw error;
    }
  }

  disconnect() {
    if (this.owned) throw new Error('Detené primero la grabación activa desde OBS o desde la estación.');
    this.wire.close();
  }

  refresh() {
    if (!this.connected) return Promise.resolve();
    if (this.refreshing) return this.refreshing;
    const generation = this.generation;
    const task = Promise.all([this.rpc('GetSceneCollectionList'), this.rpc('GetSceneList'), this.rpc('GetRecordStatus')]);
    this.refreshing = task.then(([collection, scenes, record]) => {
      if (generation !== this.generation) return;
      this.collection = collection.currentSceneCollectionName;
      this.scenes = scenes.scenes.map(({ sceneName }) => sceneName).reverse();
      this.scene = scenes.currentProgramSceneName;
      this.recording = record.outputActive;
      this.duration = record.outputDuration || 0;
      if (!this.recording) this.owned = false;
      this.change();
    }).finally(() => {
      if (generation === this.generation) this.refreshing = null;
    });
    return this.refreshing;
  }

  async run(action) {
    if (this.command || !this.connected) throw new Error('Esperá a que OBS esté conectado y termine la operación anterior.');
    this.command = true;
    this.change();
    try {
      await this.refreshing;
      return await action();
    } finally {
      this.command = false;
      this.change();
      this.refresh().catch(() => {});
    }
  }

  async checkCollection(collection) {
    const current = await this.rpc('GetSceneCollectionList');
    if (current.currentSceneCollectionName !== collection) throw new Error('Cambió la colección de OBS. Volvé a elegir la escena.');
  }

  async checkIdleOutputs() {
    const [stream, recording] = await Promise.all([this.rpc('GetStreamStatus'), this.rpc('GetRecordStatus')]);
    if (stream.outputActive || recording.outputActive) throw new Error('Terminá la salida activa de OBS antes de cambiar la escena o agregar una fuente.');
  }

  activateScene(scene, collection) {
    return this.run(async () => {
      await this.checkCollection(collection);
      await this.checkIdleOutputs();
      await this.rpc('SetCurrentProgramScene', { sceneName: scene });
      return `Escena activa en OBS: ${scene}`;
    });
  }

  addCapture(scene, collection, audio) {
    return this.run(async () => {
      await this.checkCollection(collection);
      await this.checkIdleOutputs();
      const { sceneItems } = await this.rpc('GetSceneItemList', { sceneName: scene });
      let capture;
      for (const item of sceneItems) {
        if (item.inputKind !== 'window_capture' || !item.sourceName.startsWith(CAPTURE_NAME)) continue;
        const { inputSettings } = await this.rpc('GetInputSettings', { inputName: item.sourceName });
        if (inputSettings.station_extension !== this.marker) continue;
        if (inputSettings.window && item.sceneItemEnabled) return `La escena «${scene}» ya tiene una captura de Station.`;
        capture = { name: item.sourceName, id: item.sceneItemId };
        break;
      }

      if (!capture) {
        const { inputs } = await this.rpc('GetInputList');
        const names = new Set(inputs.map(({ inputName }) => inputName));
        let name = CAPTURE_NAME;
        for (let number = 2; names.has(name); number++) name = `${CAPTURE_NAME} ${number}`;
        const { sceneItemId } = await this.rpc('CreateInput', {
          sceneName: scene, inputName: name, inputKind: 'window_capture', sceneItemEnabled: false,
          inputSettings: { station_extension: this.marker },
        });
        capture = { name, id: sceneItemId };
      }
      try {
        const { propertyItems } = await this.rpc('GetInputPropertiesListPropertyItems', { inputName: capture.name, propertyName: 'window' });
        const window = stationWindow(propertyItems);
        const { baseWidth, baseHeight } = await this.rpc('GetVideoSettings');
        await this.checkCollection(collection);
        await this.checkIdleOutputs();
        await this.rpc('SetInputSettings', {
          inputName: capture.name, overlay: true,
          inputSettings: { window, method: 2, priority: 1, cursor: false, client_area: true, capture_audio: audio },
        });
        const target = { sceneName: scene, sceneItemId: capture.id };
        await this.rpc('SetSceneItemTransform', {
          ...target, sceneItemTransform: {
            boundsType: 'OBS_BOUNDS_SCALE_INNER', alignment: 0, boundsAlignment: 0,
            boundsWidth: baseWidth, boundsHeight: baseHeight, positionX: baseWidth / 2, positionY: baseHeight / 2,
          },
        });
        await this.rpc('SetSceneItemEnabled', { ...target, sceneItemEnabled: true });
        return `Captura agregada a «${scene}». Comprobá la imagen y el mezclador en OBS.`;
      } catch (error) {
        throw new Error(`${error.message} La fuente «${capture.name}» quedó disponible para configurarla en OBS.`);
      }
    });
  }

  startRecording(scene, collection) {
    return this.run(async () => {
      await this.checkCollection(collection);
      const [program, status] = await Promise.all([this.rpc('GetCurrentProgramScene'), this.rpc('GetRecordStatus')]);
      if (program.sceneName !== scene && program.currentProgramSceneName !== scene) throw new Error('Activá la escena seleccionada antes de grabar.');
      if (status.outputActive) throw new Error('OBS ya tiene una grabación activa.');
      await this.rpc('StartRecord');
      await this.waitForRecordState(true, 'OBS no activó la grabación. Revisá el codificador y la carpeta de salida en OBS.');
      this.owned = this.recording = true;
      return 'Grabación iniciada en OBS.';
    });
  }

  stopRecording() {
    return this.run(async () => {
      if (!this.owned) throw new Error('Controlá esa grabación desde OBS.');
      const status = await this.rpc('GetRecordStatus');
      if (!status.outputActive || !this.owned) throw new Error('Revisá el estado en el panel de grabación de OBS.');
      const { outputPath } = await this.rpc('StopRecord');
      await this.waitForRecordState(false, 'OBS sigue finalizando la grabación. Verificá su estado en OBS.');
      this.owned = this.recording = false;
      return outputPath ? `OBS guardó la grabación en ${outputPath}` : 'Grabación de OBS detenida.';
    });
  }

  async waitForRecordState(active, message) {
    const deadline = performance.now() + 5000;
    while ((await this.rpc('GetRecordStatus')).outputActive !== active) {
      if (performance.now() >= deadline) throw new Error(message);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}

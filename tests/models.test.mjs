import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { mediaUrl } from '../modules/player.js';
import { obsAddress, obsAuthentication, stationWindow, WINDOW_TITLE } from '../modules/obs-websocket.js';
import { outputDimensions } from '../modules/recorder.js';
import { recordFolder } from '../modules/settings.js';
import { clock } from '../modules/time.js';

test('only direct HTTP and HTTPS links are accepted; protected hosts are rejected', () => {
  assert.throws(() => mediaUrl('https://www.netflix.com/watch/123'), /protección de contenido/);
  assert.throws(() => mediaUrl('https://video.nflxvideo.net./clip.mp4'), /protección de contenido/);
  assert.throws(() => mediaUrl('file:///test.mp4'), /HTTP/);
  assert.throws(() => mediaUrl('https://user:secret@example.com/movie.mp4'), /contraseña/);
  assert.equal(mediaUrl('https://example.com/Prueba%20de%20video.webm').name, 'Prueba de video.webm');
  assert.equal(mediaUrl('https://example.com/authorized.mp4?signature=temporary').rememberable, false);
});

test('OBS address accepts only loopback and a valid port', () => {
  assert.equal(obsAddress('127.0.0.1', 4455), 'ws://127.0.0.1:4455');
  assert.equal(obsAddress('[::1]', 4455), 'ws://[::1]:4455');
  assert.throws(() => obsAddress('127.0.0.1.example.com', 4455), /esta computadora/);
  assert.throws(() => obsAddress('localhost', 65536), /puerto/);
});

test('OBS authentication computes the WebSocket v5 salted challenge', async () => {
  const hash = (text) => createHash('sha256').update(text).digest('base64');
  assert.equal(await obsAuthentication('prueba', 'salt', 'challenge'), hash(hash('pruebasalt') + 'challenge'));
});

test('OBS source matching identifies Station and rejects arbitrary Chrome windows and duplicates', () => {
  const station = { itemEnabled: true, itemValue: `${WINDOW_TITLE} - Google Chrome for Testing:Chrome_WidgetWin_1:chrome.exe` };
  assert.equal(stationWindow([station]), station.itemValue);
  assert.throws(() => stationWindow([{ ...station, itemValue: 'Inicio:Chrome_WidgetWin_1:chrome.exe' }]), /no encontró/);
  assert.throws(() => stationWindow([station, station]), /más de una ventana/);
});

test('recording limits keep the source aspect ratio without upscaling', () => {
  assert.deepEqual(outputDimensions(1920, 1080, 720), [1280, 720]);
  assert.deepEqual(outputDimensions(1080, 1920, 720), [720, 1280]);
  assert.deepEqual(outputDimensions(640, 360, 720), [640, 360]);
  assert.deepEqual(outputDimensions(1920, 1080, 0), [1920, 1080]);
});

test('download filenames use safe browser-relative paths', () => {
  assert.equal(recordFolder('Grabaciones/OBS'), 'Grabaciones/OBS');
  assert.equal(recordFolder(''), '');
  for (const folder of ['../Grabaciones', 'C:/Videos', '\\servidor', 'CON', 'test/']) assert.throws(() => recordFolder(folder));
  assert.equal(clock(3666), '1:01:06');
  assert.equal(clock(Infinity), '—');
});

test('the extension requests storage and downloads only', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url)));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions.sort(), ['downloads', 'storage']);
  for (const key of ['host_permissions', 'content_scripts', 'externally_connectable']) assert.equal(manifest[key], undefined);
});

import argparse
import base64
import hashlib
import io
import json
import os
import tempfile
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from uuid import uuid4

import av
import psutil
import websocket
from PIL import Image
from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]


def mark(text):
    print(text, flush=True)


def wait_for_playable(page):
    expect(page.locator('#play')).to_be_enabled(timeout=12_000)
    assert page.locator('#video').evaluate('(v) => v.videoWidth === 640 && v.videoHeight === 360')


def open_station(context, extension):
    popup = context.new_page()
    popup.goto(f'{extension}/popup/popup.html')
    with context.expect_page() as created:
        popup.locator('#open').click()
    page = created.value
    page.wait_for_url(f'{extension}/station/index.html')
    return page


def recordings(page, expected):
    until = time.monotonic() + 15
    while time.monotonic() < until:
        records = page.evaluate('''() => chrome.storage.local.get(null).then((values) =>
          Object.entries(values).filter(([key]) => key.startsWith('record:')).map(([, record]) => record))''')
        if len(records) == expected and all(record['state'] == 'saved' for record in records):
            return records
        page.wait_for_timeout(150)
    raise AssertionError((records, page.locator('#notice').inner_text(), page.locator('#record-state').inner_text()))


def check_recording(path, sync=False):
    assert path.is_file() and path.stat().st_size > 5_000, path
    with av.open(str(path)) as reader:
        assert reader.streams.video and reader.streams.audio, 'Falta video o audio en el archivo'
        video_stream = reader.streams.video[0]
        assert video_stream.width >= 300 and video_stream.height >= 160
        flashes = []
        for frame in reader.decode(video=0):
            r, g, b = frame.to_image().getpixel((25, 25))
            if r > 135 and r > g + 25 and r > b + 50:
                flashes.append(frame.time)
    if not sync:
        return
    with av.open(str(path)) as reader:
        resampler = av.AudioResampler(format='s16', layout='mono', rate=48_000)
        beeps = []
        for frame in reader.decode(audio=0):
            for mono in resampler.resample(frame):
                samples = memoryview(mono.planes[0]).cast('h')[:mono.samples]
                loud = next((index for index, sample in enumerate(samples) if abs(sample) > 3_000), None)
                if loud is not None:
                    beeps.append(mono.time + loud / mono.sample_rate)
    assert flashes and beeps, (flashes, beeps)
    offset = abs(flashes[0] - beeps[0])
    assert offset < 0.30, f'Desfase audiovisual {offset:.3f} s'
    mark(f'Sincronización en WEBM de prueba: desfase del primer pulso {offset * 1000:.0f} ms')


@contextmanager
def serve_clip(path):
    class ClipHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            data = path.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'video/mp4')
            self.send_header('Content-Length', str(len(data)))
            if self.path == '/con-cors.mp4':
                self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):
            pass

    with ThreadingHTTPServer(('127.0.0.1', 0), ClipHandler) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f'http://127.0.0.1:{server.server_port}'
        finally:
            server.shutdown()
            thread.join()


def check_urls(page, mp4):
    with serve_clip(mp4) as address:
        for endpoint in ('con-cors.mp4', 'solo-reproduccion.mp4'):
            page.locator('#open-url').click()
            page.locator('#url-input').fill(f'{address}/{endpoint}')
            page.locator('#url-form button[type=submit]').click()
            wait_for_playable(page)
            if endpoint == 'con-cors.mp4':
                expect(page.locator('#record-start')).to_be_enabled()
            else:
                expect(page.locator('#record-start')).to_be_disabled()
                expect(page.locator('#source-spec')).to_contain_text('CORS')
            page.locator('#play').click()
            page.wait_for_function('() => document.querySelector("video").currentTime > .30')
            page.locator('#stop').click()
    mark('URL directa HTTP: reproducción con y sin cabecera CORS, y grabación habilitada solo con CORS')


class ObsProbe:
    def __init__(self, port, password):
        self.wire = websocket.create_connection(f'ws://127.0.0.1:{port}', timeout=5, suppress_origin=True)
        hello = self.receive(0)
        identify = {'rpcVersion': 1, 'eventSubscriptions': 0}
        if auth := hello.get('authentication'):
            def digest(value):
                return base64.b64encode(hashlib.sha256(value.encode()).digest()).decode()
            identify['authentication'] = digest(digest(password + auth['salt']) + auth['challenge'])
        self.wire.send(json.dumps({'op': 1, 'd': identify}))
        self.receive(2)

    def receive(self, code):
        while True:
            message = json.loads(self.wire.recv())
            if message['op'] == code:
                return message['d']

    def rpc(self, name, **params):
        request_id = uuid4().hex
        self.wire.send(json.dumps({'op': 6, 'd': {'requestType': name, 'requestId': request_id, 'requestData': params}}))
        answer = self.receive(7)
        assert answer.get('requestId') == request_id and answer['requestStatus']['result'], answer
        return answer.get('responseData', {})


def check_obs(page, port, password, output):
    probe = ObsProbe(port, password)
    try:
        recording_dir = output / 'obs'
        recording_dir.mkdir(exist_ok=True)
        probe.rpc('SetRecordDirectory', recordDirectory=str(recording_dir))
        for name in probe.rpc('GetSpecialInputs').values():
            if name:
                probe.rpc('SetInputMute', inputName=name, inputMuted=True)
        scene = f'Station QA {uuid4().hex[:5]}'
        probe.rpc('CreateScene', sceneName=scene)

        page.locator('#obs-setup').click()
        page.locator('#obs-port').fill(str(port))
        page.locator('#obs-password').fill(password)
        page.locator('#obs-audio').check()
        page.locator('#obs-connect').click()
        expect(page.locator('#obs-status')).to_contain_text('conectado', timeout=10_000)
        expect(page.locator('#obs-dialog')).not_to_be_visible()
        assert password not in page.evaluate('() => chrome.storage.local.get(null).then(JSON.stringify)')
        page.locator('#obs-scene').select_option(scene)
        page.locator('#obs-use-scene').click()
        expect(page.locator('#notice')).to_contain_text('Escena activa en OBS')
        page.locator('#obs-add-source').click()
        try:
            expect(page.locator('#notice')).to_contain_text('Captura agregada', timeout=15_000)
        except AssertionError as error:
            raise AssertionError(page.locator('#notice').inner_text()) from error

        items = probe.rpc('GetSceneItemList', sceneName=scene)['sceneItems']
        assert len(items) == 1 and items[0]['sceneItemEnabled'], items
        name = items[0]['sourceName']
        page.locator('#obs-add-source').click()
        expect(page.locator('#notice')).to_contain_text('ya tiene una captura')
        page.locator('#play').click()
        page.locator('#capture-window').click()
        expect(page.locator('body')).to_have_class('capture')
        page.wait_for_function('() => document.querySelector("video").currentTime > .45')
        picture = probe.rpc('GetSourceScreenshot', sourceName=name, imageFormat='png', imageWidth=480)['imageData']
        image = Image.open(io.BytesIO(base64.b64decode(picture.split(',', 1)[1]))).convert('RGB')
        pixels = image.get_flattened_data()
        colored = sum((g > r + 35 and g > 95) or (r > g + 25 and r > 155) for r, g, b in pixels)
        assert colored / len(pixels) > 0.30, f'Captura sin color de la fuente ({colored} píxeles)'
        image.save(output / 'vista-obs.png')
        page.keyboard.press('Escape')
        expect(page.locator('#obs-record')).to_be_enabled()
        page.locator('#obs-record').click()
        try:
            expect(page.locator('#obs-record')).to_have_text('Detener en OBS', timeout=10_000)
        except AssertionError as error:
            raise AssertionError(page.locator('#notice').inner_text()) from error
        assert probe.rpc('GetRecordStatus')['outputActive']
        page.locator('#capture-window').click()
        page.wait_for_timeout(2200)
        page.keyboard.press('Escape')
        page.locator('#obs-record').click()
        expect(page.locator('#notice')).to_contain_text('OBS guardó la grabación', timeout=10_000)
        assert not probe.rpc('GetRecordStatus')['outputActive']
        paths = list(recording_dir.glob('*.*'))
        assert len(paths) == 1, paths
        check_recording(paths[0])
        mark(f'OBS {probe.rpc("GetVersion")["obsVersion"]} portable: autenticación, escena, captura con imagen, inicio/detención y archivo con audio y video')
    finally:
        probe.wire.close()


def sample_browser(browser, page):
    cdp = browser.new_browser_cdp_session()

    def current():
        values = []
        for row in cdp.send('SystemInfo.getProcessInfo')['processInfo']:
            try:
                process = psutil.Process(row['id'])
                values.append((row['cpuTime'], process.memory_info().rss))
            except psutil.NoSuchProcess:
                continue
        return sum(cpu for cpu, _ in values), sum(rss for _, rss in values)

    start = current()
    page.wait_for_timeout(1900)
    end = current()
    cpu = max(0, end[0] - start[0]) / 1.9 / (psutil.cpu_count() or 1) * 100
    mark(f'Chrome aislado reproduciendo 640x360: {cpu:.1f}% CPU total y {end[1] / 1024**2:.0f} MiB RSS bruta')


def run(args):
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    fixtures = args.fixtures.resolve()
    downloads = output / f'descargas-{uuid4().hex[:6]}'
    downloads.mkdir()
    with tempfile.TemporaryDirectory(prefix='perfil-station-', dir=output) as profile, sync_playwright() as playwright:
        preferences = Path(profile) / 'Default' / 'Preferences'
        preferences.parent.mkdir()
        preferences.write_text(json.dumps({'download': {
            'default_directory': str(downloads), 'prompt_for_download': False, 'directory_upgrade': True,
        }}), encoding='utf-8')
        context = playwright.chromium.launch_persistent_context(
            profile, channel='chromium', headless=False, no_viewport=True,
            args=[f'--disable-extensions-except={ROOT}', f'--load-extension={ROOT}', '--window-size=1250,840'],
        )
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            origin = worker.url.split('/background/')[0]
            page = open_station(context, origin)
            page.on('dialog', lambda dialog: dialog.accept())
            page.on('pageerror', lambda error: mark(f'ERROR JAVASCRIPT: {error}'))
            cdp = context.new_cdp_session(page)
            cdp.send('Browser.setDownloadBehavior', {'behavior': 'default'})
            expect(page.locator('h1')).to_contain_text('OBS TTiktok Auto-Record')
            mark(f'Chrome {context.browser.version}: extensión MV3 instalada y estación abierta desde el popup')

            page.locator('#file-input').set_input_files(str(fixtures / 'Prueba audiovisual.mp4'))
            wait_for_playable(page)
            page.locator('#subtitle-input').set_input_files(str(fixtures / 'Prueba.vtt'))
            page.wait_for_function('() => document.querySelector("track")?.readyState === 2')
            page.locator('#volume').evaluate('e => { e.value = 63; e.dispatchEvent(new Event("input")); e.dispatchEvent(new Event("change")); }')
            assert page.locator('#video').evaluate('v => v.volume') == 0.63
            page.locator('#play').click()
            sample_browser(context.browser, page)
            page.locator('#pause').click()
            assert page.locator('#video').evaluate('v => v.paused')
            page.locator('#stop').click()
            page.wait_for_function('() => document.querySelector("video").currentTime === 0')
            mark('MP4: reproducción, volumen, pausa, detención y subtítulos VTT')

            page.locator('#record-start').click()
            page.wait_for_function('() => document.querySelector("video").currentTime > 3.5', timeout=15_000)
            page.locator('#record-stop').click()
            result = recordings(page, 1)[0]
            path = next(downloads.rglob(result['name']))
            check_recording(path, sync=True)
            mark('MediaRecorder en MP4: descarga WEBM manual con audio y video decodificables')
            page.locator('#stop').click()

            page.locator('#file-input').set_input_files(str(fixtures / 'Prueba audiovisual.webm'))
            wait_for_playable(page)
            page.locator('#settings-button').click()
            page.locator('#record-fps').select_option('24')
            page.locator('#settings-form button[type=submit]').click()
            page.locator('#auto-record').check()
            page.locator('#play').click()
            result = recordings(page, 2)
            for record in result:
                check_recording(next(downloads.rglob(record['name'])), sync=record['name'] != path.name)
            assert page.locator('#video').evaluate('v => v.ended')
            page.locator('#auto-record').uncheck()
            mark('WEBM: auto-grabación al reproducir, límite de FPS seleccionado, detención al final y descarga')

            page.locator('#open-url').click()
            page.locator('#url-input').fill('https://www.netflix.com/watch/100')
            page.locator('#url-form button[type=submit]').click()
            expect(page.locator('#url-message')).to_contain_text('protección de contenido')
            page.locator('#url-form [data-close]').click()
            page.locator('#tiktok-button').click()
            expect(page.locator('#tiktok-dialog')).to_contain_text('Captura de ventana')
            page.locator('#tiktok-dialog [data-close]').click()
            page.screenshot(path=str(output / 'vista-station.png'))
            mark('Validación de URL protegida y asistente TikTok en Chrome')
            check_urls(page, fixtures / 'Prueba audiovisual.mp4')

            page.locator('#queue button').first.click()
            wait_for_playable(page)
            if args.obs_port:
                check_obs(page, args.obs_port, os.environ.get('STATION_TEST_OBS_PASSWORD', ''), output)
            else:
                page.locator('#play').click()
                page.locator('#capture-window').click()
                expect(page.locator('body')).to_have_class('capture')
                tab_type = page.evaluate('() => chrome.tabs.getCurrent().then(t => chrome.windows.get(t.windowId)).then(w => w.type)')
                assert tab_type == 'popup'
                page.keyboard.press('Escape')
            mark('Ventana Chrome independiente con el mismo reproductor y salida del modo captura por Escape')

            page.reload()
            expect(page.locator('#volume-value')).to_have_text('63 %')
            page.locator('#history-button').click()
            expect(page.locator('#history-list li')).to_have_count(2)
            assert page.locator('#video').evaluate('v => v.paused')
            mark('Preferencias e historial conservados al volver a abrir la estación')
        finally:
            context.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--fixtures', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--obs-port', type=int)
    run(parser.parse_args())

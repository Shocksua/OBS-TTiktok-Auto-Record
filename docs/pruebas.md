# Pruebas de V1.0

Pruebas ejecutadas el 22 de noviembre de 2026 en Windows 11 con Chrome for Testing 159.0.8154.6 y una copia aislada de OBS Studio 33.0.1. Se usaron clips sintéticos con marcas de tiempo visuales y pulsos de audio.

| Prueba | Resultado |
| --- | --- |
| Permisos y validaciones | 7 pruebas unitarias pasaron. Se comprobaron la lista de permisos, el rechazo de URLs de Netflix, las rutas de descarga, la autenticación de OBS y el selector de ventana. |
| Instalación y apertura | Se cargó la extensión MV3 en un perfil de prueba y se abrió Station desde el popup. |
| Reproductor | Reproducción MP4 con H.264/AAC y WEBM con VP8/Opus. Se verificaron pausa, detención, volumen y subtítulos WebVTT. |
| Enlaces | Se reprodujo un archivo servido por HTTP local con y sin cabecera CORS. El botón para grabar en Chrome solo quedó habilitado en el caso con CORS. |
| Ventana independiente | Se movió la pestaña a una ventana de Chrome. La reproducción siguió en la misma instancia. Esc devolvió los controles. |
| Grabación manual y automática | Se descargaron dos WEBM y se decodificaron sus pistas de audio y video. Se verificaron el comienzo al pulsar Reproducir y la detención al final del video. |
| Sincronización en Chrome | El primer pulso tuvo un desfase de 133 ms en el ensayo MP4 y de 107 ms en el ensayo WEBM del recorrido final. Los valores corresponden a los clips y el equipo de prueba. |
| OBS WebSocket | Pasaron conexión con autenticación, selección de escena, creación de la fuente y verificación de que repetir la operación no duplicó la captura. |
| Imagen y grabación en OBS | Se comprobó la imagen de Station en una captura de la fuente de OBS. Se inició y detuvo una grabación desde Station y se decodificó el archivo de OBS. En un ensayo se verificaron los pulsos de audio de la aplicación con micrófono y audio del escritorio silenciados en el perfil de prueba. |
| Sesión | Se conservaron volumen e historial tras recargar. Se comprobó que Chrome Storage no contenía la contraseña de OBS. |
| TikTok LIVE Studio | Se comprobó el asistente de Station. La validación de imagen y medidor en una escena de TikTok quedó pendiente. |

Durante un muestreo de 1,9 s reproduciendo 640 × 360, el perfil de Chrome de prueba usó aproximadamente 2,1 % de CPU total y 573 MiB de RAM residente bruta sumada entre sus procesos. La cifra incluye el navegador, el renderizador y la GPU y depende del equipo. Se probaron clips cortos.

## Volver a ejecutar

Para las pruebas unitarias, desde la raíz usá Node.js 22 o posterior.

```powershell
node --test tests/models.test.mjs
```

Para el recorrido del navegador, usá un entorno virtual de Python. El navegador de prueba se instala en la caché de Playwright.

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r tests\requirements.txt
.\.venv\Scripts\python.exe -m playwright install chromium --no-shell
.\.venv\Scripts\python.exe tests\fixtures.py "$env:TEMP\station-clips"
.\.venv\Scripts\python.exe tests\browser_check.py --fixtures "$env:TEMP\station-clips" --output "$env:TEMP\station-pruebas"
```

Para incluir OBS, usá una instancia portable de prueba con un puerto propio. El recorrido crea una escena de prueba, cambia la carpeta de salida a la del ensayo y silencia las entradas especiales de ese perfil. Pasá `--obs-port` con el puerto de esa instancia y definí `STATION_TEST_OBS_PASSWORD` para su contraseña de prueba.

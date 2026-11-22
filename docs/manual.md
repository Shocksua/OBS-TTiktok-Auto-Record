# Manual de uso

## Reproducir

1. En **Abrir video**, elegí uno o varios archivos. En **Abrir URL**, pegá un enlace directo a un video sin DRM que tengas permiso para usar.
2. Seleccioná el video en la lista y pulsá **Reproducir**. Al terminar un video avanza al siguiente. **Repetir** mantiene el video actual en bucle.
3. Usá el control de volumen, la barra de tiempo o **Pantalla completa**. **Subtítulos** carga un archivo WebVTT `.vtt` para el video actual.

## Capturar en OBS y TikTok LIVE Studio

1. Con un video abierto, pulsá **Ventana de captura**. La misma pestaña se mueve a una ventana de Chrome con el video. Pulsá **Esc** dentro de esa ventana para volver a ver los controles.
2. En OBS, creá una **Captura de ventana** o usá **Añadir ventana** desde Station con la conexión configurada. Seleccioná **OBS TTiktok Auto-Record — STATION**.
3. En TikTok LIVE Studio, abrí el editor, elegí **Agregar fuente → Captura de ventana** y seleccioná la misma ventana. Usá **Ver pasos** en Station para abrir el asistente.
4. Dejá la ventana de Chrome sin minimizar. Revisá la imagen y el medidor de cada programa. Para evitar eco en el mezclador, usá una sola entrada de audio para Chrome, por ejemplo el audio de la aplicación o el del escritorio. [Captura de audio en OBS](https://obsproject.com/kb/application-audio-capture-guide)

## Transmitir en directo

1. Reproducí en Station el archivo o enlace autorizado que querés mostrar y pulsá **Ventana de captura**.
2. Elegí **STATION** como fuente en el programa que vaya a emitir. Comprobá la imagen y el medidor de audio antes de iniciar el directo.
3. Iniciá el LIVE en el editor de TikTok LIVE Studio. Si transmitís desde OBS, configurá el servicio de transmisión y usá **Iniciar transmisión** con la escena de Station activa. [Guía de OBS](https://obsproject.com/kb/quick-start-guide/)

Para grabar desde Station durante el directo, pulsá **Grabar WEBM** antes de ocultar los controles. También podés iniciar la grabación desde OBS mientras la ventana de Station está seleccionada como fuente.

## Grabar desde Chrome

- **Grabar WEBM** empieza una grabación del video actual. Si estaba en pausa, comienza a reproducirlo.
- **Grabar al reproducir** inicia el grabador cada vez que empieza un video compatible. Al terminar, se finaliza y descarga la grabación. Si activás **Repetir**, usá **Detener** en la sección de grabación para terminarla.
- En **Ajustes**, elegí calidad, límite de resolución, límite de FPS y una subcarpeta dentro de Descargas. Marcá **Preguntar dónde guardar cada WEBM** para elegir la ubicación al guardar.
- En **Historial** se muestra la duración. Si cancelaste una descarga, podés volver a intentarla desde ahí. Para una grabación guardada, **Mostrar carpeta** abre la ubicación del archivo.

## Grabar desde OBS

1. Configurá la captura en una escena y activala en OBS.
2. En Station, pulsá **Grabar en OBS** y comprobá el contador. OBS graba la escena activa, con el formato y la carpeta seleccionados en sus propios ajustes.
3. Pulsá **Detener en OBS** para finalizar la grabación que empezó desde Station. Si se corta la conexión o cerrás Chrome durante una grabación de OBS, verificá su estado y detenela desde OBS cuando corresponda.

Chrome y OBS tienen controles de grabación independientes. Para usar menos recursos, podés elegir uno de los dos para guardar el archivo mientras mostrás el mismo video en ambos programas.

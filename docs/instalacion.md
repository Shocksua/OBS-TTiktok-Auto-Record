# Instalación en Chrome

Usá Google Chrome de escritorio en Windows. Para capturar la ventana en otras aplicaciones, abrí OBS Studio o TikTok LIVE Studio en la misma computadora. La estación se instala desde una carpeta descomprimida. [Guía oficial de Chrome](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)

1. Extraé `OBS-TTikTok-Auto-Record-Chrome-V1.0.zip` en una carpeta de tu elección.
2. Escribí `chrome://extensions` en la barra de direcciones.
3. Activá **Modo desarrollador** y pulsá **Cargar descomprimida**.
4. Seleccioná la carpeta que contiene `manifest.json`.
5. Abrí el menú de extensiones de Chrome, seleccioná **OBS TTiktok Auto-Record** y pulsá **Abrir estación**. Podés fijar el icono desde ese menú.

Conservá la carpeta descomprimida mientras uses la extensión. Para cargar una actualización de sus archivos en esa carpeta, cerrá la estación y pulsá **Recargar** en su tarjeta de `chrome://extensions`.

## Conexión con OBS Studio

1. En OBS, abrí **Herramientas → Configuración del servidor WebSocket** y habilitá el servidor. Dejá la autenticación activa y copiá el puerto y la contraseña desde esa ventana.
2. En Station, pulsá **Conexión** en el panel **OBS Studio**. Usá `127.0.0.1`, el puerto de OBS (generalmente `4455`) y su contraseña.
3. Si Chrome pide acceso a la red local para conectar con OBS, permitilo para esta extensión. Comprobá que el panel indique **conectado**.
4. Elegí una escena. **Añadir ventana** solicita confirmación y agrega una fuente nueva. **Activar escena** solicita confirmación para cambiar qué escena está en el programa.
5. Si preferís configurar OBS desde su interfaz, agregá **Captura de ventana** en **Fuentes** y elegí **OBS TTiktok Auto-Record — STATION**. Usá **Ventana de captura** en Chrome para mostrar la ventana dedicada.

La dirección y el puerto quedan guardados. Ingresá la contraseña al volver a conectar. Para incorporar audio desde una fuente de ventana, usá OBS 30.1 o una versión compatible posterior. [Protocolo OBS WebSocket 5.x](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md) · [Guía de audio de OBS](https://obsproject.com/kb/application-audio-capture-guide)

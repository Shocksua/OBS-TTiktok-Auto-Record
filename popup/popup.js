const button = document.querySelector('#open');
const status = document.querySelector('#status');

button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    const reply = await chrome.runtime.sendMessage({ type: 'open-station' });
    if (!reply?.ok) throw new Error();
    window.close();
  } catch {
    status.hidden = false;
    status.textContent = 'No se pudo abrir la estación. Volvé a intentarlo.';
    button.disabled = false;
  }
});

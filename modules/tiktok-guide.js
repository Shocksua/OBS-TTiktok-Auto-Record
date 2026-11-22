export function wireTikTokGuide(button, dialog, revealWindow, notify) {
  button.addEventListener('click', () => dialog.showModal());
  dialog.querySelector('[data-reveal]').addEventListener('click', async () => {
    dialog.close();
    try {
      await revealWindow(true);
    } catch (error) {
      notify(error.message, true);
    }
  });
}

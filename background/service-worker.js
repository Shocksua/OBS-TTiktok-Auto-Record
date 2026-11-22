const stationUrl = chrome.runtime.getURL('station/index.html');
let opening;

async function focusStation() {
  const [station] = await chrome.runtime.getContexts({
    contextTypes: ['TAB'],
    documentUrls: [stationUrl],
  });
  if (station?.tabId >= 0) {
    try {
      await chrome.tabs.update(station.tabId, { active: true });
      await chrome.windows.update(station.windowId, { focused: true });
      return;
    } catch {
      // The window can close while the browser is bringing it forward.
    }
  }
  await chrome.tabs.create({ url: stationUrl });
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== 'open-station' || sender.url !== chrome.runtime.getURL('popup/popup.html')) return;
  opening ??= focusStation().finally(() => { opening = null; });
  opening.then(() => reply({ ok: true }), () => reply({ ok: false }));
  return true;
});

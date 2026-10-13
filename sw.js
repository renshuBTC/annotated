// Annotated.com: service worker.
// The bar and the chat come and go together. Click the toolbar icon (or Alt+Shift+S, the icon's
// shortcut) -> the chat opens in the side panel and the bar comes up on the page (no dark screen until
// you press 📷 or 🎥). Click it again -> both close. Opening the chat any other way (Chrome's side panel
// button, Alt+Shift+L, the icon's right-click menu) brings the bar too; closing it (its ×, Chrome's
// side panel button) takes the bar away; the bar's ✕ closes both.
// Alt+Shift+V -> freeze the page and start choosing an area for a video.

const sessions = new Map(); // token -> session (short-lived; the overlay fetches it right away)
// Tabs with Annotated.com open on them (so a click on the icon knows, right in the click, whether to
// open or close). The open overlay keeps this worker awake (it checks in every 20 seconds).
const barTabs = new Set();
const launching = new Set(); // tabs the bar is being opened on right now
const audioTabs = new Set(); // tabs whose recording sound is being played back
let playerReady = null; // one offscreen player shared by all recordings

const BROWSER_PAGE = /^(chrome|chrome-extension|chrome-search|chrome-untrusted|devtools|edge|brave|opera|vivaldi|about|view-source|data|javascript):/i;
const WEB_STORE = /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)(\/|$)/i;

chrome.action.onClicked.addListener((tab) => {
  if (tab && barTabs.has(tab.id)) return closeAll(tab);
  openChat(tab); // first, right in the click: Chrome only opens the side panel as your direct action
  launch(tab, 'bar');
});

// The icon again: the bar and the chat close, at once (like the bar's ✕, or Esc).
async function closeAll(tab) {
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'snip:toggle', mode: 'bar' }, { frameId: 0 });
    if (r && r.handled) return; // the overlay closes itself, then says so (and the chat goes then)
  } catch {
    // The page has no overlay any more.
  }
  barTabs.delete(tab.id);
  closeChat(tab.windowId);
}

// The chat opened (however: the icon, Chrome's side panel button, Alt+Shift+L): the bar comes up on
// the page you're on, if it isn't there already. Chrome lets the bar onto a page once you've pressed
// the icon there; where you haven't, the chat says to.
chrome.sidePanel.onOpened?.addListener(async (info) => {
  if (!info || info.windowId == null) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId: info.windowId }).catch(() => []);
  if (!tab || barTabs.has(tab.id) || launching.has(tab.id)) return;
  launch(tab, 'bar', { ensure: true, quiet: true });
});

// The chat closed (its ×, Chrome's side panel button, Esc in the chat): the bar goes too, in every tab
// of that window. (Every tab is asked: this worker may have been restarted and forgotten which have it;
// a tab without the bar just says so.)
chrome.sidePanel.onClosed?.addListener(async (info) => {
  if (!info || info.windowId == null) return;
  const tabs = await chrome.tabs.query({ windowId: info.windowId }).catch(() => []);
  for (const t of tabs) {
    chrome.tabs.sendMessage(t.id, { type: 'snip:toggle', mode: 'chat-closed' }, { frameId: 0 }).then(
      (r) => r && r.handled === false && barTabs.delete(t.id),
      () => barTabs.delete(t.id)
    );
  }
});

chrome.tabs.onRemoved.addListener((tabId) => barTabs.delete(tabId));
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') barTabs.delete(tabId); // a new page: the overlay went with the old one
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'record') {
    if (tab) launch(tab, 'record');
    else chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => t && launch(t, 'record'));
  } else if (command === 'open-annotations') {
    // (The chat's shortcut keeps its old name so a shortcut you've already set keeps working.)
    openChat(tab);
    if (tab) launch(tab, 'bar', { ensure: true, quiet: true }); // the bar comes too
  }
});

// The chat lives in the side panel. It opens with a click on the icon (with the bar), and with the
// icon's right-click menu, Alt+Shift+L, or Chrome's side panel button (the bar comes up with it).
// Alt+Shift+V (a video, straight away) leaves it as it is.
chrome.runtime.onInstalled.addListener(() => {
  // Start the menu afresh, so an update renames the item.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'open-chat', title: 'Open the chat', contexts: ['action'] }, () => void chrome.runtime.lastError);
  });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'open-chat') return;
  openChat(tab);
  if (tab) launch(tab, 'bar', { ensure: true, quiet: true }); // the bar comes too
});

// Closes the chat in a window (Chrome 141 and later can do it from here; before that the chat page
// closes itself when asked).
function closeChat(windowId) {
  const ask = () => chrome.runtime.sendMessage({ type: 'chat:close', windowId }).catch(() => {});
  try {
    if (windowId != null && chrome.sidePanel.close) {
      chrome.sidePanel.close({ windowId }).catch(ask);
      return;
    }
  } catch {}
  ask();
}

// Called straight from the click or shortcut (no waiting first), so Chrome counts it as your action.
function openChat(tab) {
  if (tab && tab.windowId != null) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    return;
  }
  chrome.windows.getCurrent().then((w) => chrome.sidePanel.open({ windowId: w.id })).catch(() => {});
}

// ensure: bring the bar up if it isn't there (the chat opened), never close it. quiet: the chat opened
// on its own (not your click on the icon), so a page Annotated.com can't open on just stays as it is.
async function launch(tab, mode, { ensure = false, quiet = false } = {}) {
  if (!tab || tab.id == null || tab.id < 0 || launching.has(tab.id)) return;
  launching.add(tab.id);
  try {
    await openBar(tab, mode, { ensure, quiet });
  } finally {
    launching.delete(tab.id);
  }
}

async function openBar(tab, mode, { ensure, quiet }) {
  // Already open on this tab? Let the overlay decide (the icon closes it; Alt+Shift+V stops a recording
  // or starts choosing). Opening the chat only checks that it's there.
  try {
    const r = await chrome.tabs.sendMessage(tab.id, ensure ? { type: 'snip:status' } : { type: 'snip:toggle', mode }, { frameId: 0 });
    if (ensure && r && r.open) return void barTabs.add(tab.id);
    if (!ensure && r && r.handled) return;
  } catch {
    // No overlay script on the page yet: carry on.
  }

  const why = await blockedReason(tab.url || '');
  if (why) return quiet ? undefined : showBlocked(tab, why);

  // Freeze the page exactly as it is right now, before any overlay is drawn. (From the icon, nothing is
  // frozen yet: the bar takes the picture when you press ▭ or ▤.)
  let shot = null;
  let shotError = null;
  if (mode !== 'bar') {
    try {
      shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    } catch (e) {
      shotError = errText(e);
    }
  }

  const token = crypto.randomUUID();
  sessions.set(token, {
    token,
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url || '',
    title: tab.title || '',
    mode,
    shot,
    shotError,
    created: Date.now(),
  });
  // Sessions only need to live until the overlay has loaded them.
  setTimeout(() => sessions.delete(token), 5 * 60 * 1000);

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'snip:open', token, mode }, { frameId: 0 });
    barTabs.add(tab.id);
  } catch (e) {
    sessions.delete(token);
    const msg = errText(e);
    if (quiet) {
      // Chrome hasn't let Annotated.com onto this page yet (that takes a press of the icon here): the
      // chat says so.
      if (/must request permission|cannot access contents of/i.test(msg) && !/chrome:\/\/|chrome-extension:\/\//i.test(msg)) chrome.storage.session.set({ noBar: { windowId: tab.windowId, tabId: tab.id, at: Date.now() } }).catch(() => {});
      return;
    }
    let kind = 'script';
    if (/chrome:\/\/|chrome-extension:\/\/|chrome-search|edge:\/\/|devtools|cannot access contents of the page/i.test(msg)) kind = 'browser';
    else if (/gallery cannot be scripted|webstore/i.test(msg)) kind = 'store';
    else if (/file:\/\//i.test(msg)) kind = 'file';
    showBlocked(tab, kind, kind === 'script' ? msg : '');
  }
}

async function blockedReason(url) {
  if (!url) return null; // Unknown: try anyway, and report a real error if injection fails.
  if (WEB_STORE.test(url)) return 'store';
  if (BROWSER_PAGE.test(url)) return 'browser';
  if (/^file:/i.test(url)) {
    try {
      if (!(await chrome.extension.isAllowedFileSchemeAccess())) return 'file';
    } catch {
      return 'file';
    }
  }
  return null;
}

// Explain, right under the toolbar icon, why nothing happened.
async function showBlocked(tab, why, detail) {
  const q = new URLSearchParams({ why, tab: String(tab.id) });
  if (detail) q.set('detail', detail.slice(0, 300));
  const page = 'blocked.html?' + q.toString();
  try {
    await chrome.action.setPopup({ tabId: tab.id, popup: page });
    await chrome.action.openPopup({ windowId: tab.windowId });
    return;
  } catch {
    await chrome.action.setPopup({ tabId: tab.id, popup: '' }).catch(() => {});
  }
  try {
    await chrome.windows.create({ url: page + '&win=1', type: 'popup', width: 460, height: 320, focused: true });
  } catch {
    // Last resort: a badge so the click is not silently ignored.
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#707070' }).catch(() => {});
    chrome.action.setBadgeText({ tabId: tab.id, text: 'off' }).catch(() => {});
    chrome.action.setTitle({ tabId: tab.id, title: 'Annotated.com' }).catch(() => {});
  }
}

async function ensurePlayer() {
  // Chrome closes an audio page after ~30 s of silence, so check every time.
  if (!playerReady) {
    playerReady = (async () => {
      const has = chrome.offscreen.hasDocument ? await chrome.offscreen.hasDocument() : false;
      if (!has) {
        await chrome.offscreen.createDocument({
          url: 'player.html',
          reasons: ['AUDIO_PLAYBACK'],
          justification: 'Plays the tab sound back to you while the tab is being recorded.',
        });
      }
    })().finally(() => {
      playerReady = null;
    });
  }
  return playerReady;
}

function errText(e) {
  return String((e && e.message) || e || 'Unknown error');
}

const OWN_ORIGIN = self.location.origin;
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('snip:')) return false;
  // The page helper (content.js) only ever says the overlay closed; everything else (pictures of the
  // tab, recording) is for the extension's own pages.
  const own = sender.origin === OWN_ORIGIN || (sender.url || '').startsWith(OWN_ORIGIN + '/');
  if (!own && msg.type !== 'snip:closed') {
    reply({ error: 'Not allowed.' });
    return false;
  }
  handle(msg, sender).then(reply, (e) => reply({ error: errText(e) }));
  return true;
});

async function handle(msg, sender) {
  const tabId = sender.tab && sender.tab.id;
  switch (msg.type) {
    case 'snip:session': {
      const s = sessions.get(msg.token);
      if (!s || s.tabId !== tabId) return { error: 'This snip expired. Click the icon again.' };
      const out = { ...s, zoom: await chrome.tabs.getZoom(tabId).catch(() => 1) };
      s.shot = null; // hand it over once; it can be large
      return out;
    }
    case 'snip:openChat': {
      // The bar's Annotated.com button (send to the chat), if it couldn't open the side panel itself.
      openChat(sender.tab);
      return { ok: true };
    }
    case 'snip:alive': {
      // The open bar checks in (and is known again if this worker was restarted).
      if (tabId != null) barTabs.add(tabId);
      return { ok: true };
    }
    case 'snip:zoom': {
      // The page's zoom: the overlay's bar undoes it, so it keeps its size on screen.
      return { zoom: await chrome.tabs.getZoom(tabId) };
    }
    case 'snip:capture': {
      // A fresh frame of the page (the overlay hides itself first), only while its tab is the one in
      // front (otherwise the picture would be of another tab).
      const t = await chrome.tabs.get(tabId);
      if (!t.active) return { error: 'Switch back to this tab to take its picture.' };
      const shot = await chrome.tabs.captureVisibleTab(t.windowId, { format: 'png' });
      if (!(await chrome.tabs.get(tabId)).active) return { error: 'Switch back to this tab to take its picture.' };
      return { shot };
    }
    case 'snip:streamId': {
      // No consumerTabId: the stream is consumed by our own overlay frame (an extension page).
      return { id: await chrome.tabs.get(tabId).then(() => chrome.tabCapture.getMediaStreamId({ targetTabId: tabId })) };
    }
    case 'snip:audioOn': {
      // Recording a tab mutes it for you; a hidden extension page plays the sound back.
      // (Playing it inside the tab itself would be recorded again and echo.)
      if (!chrome.offscreen) return { error: 'no offscreen' };
      audioTabs.add(tabId);
      await ensurePlayer();
      return { ok: true };
    }
    case 'snip:audioOff': {
      audioTabs.delete(tabId);
      if (!audioTabs.size) {
        try {
          if (chrome.offscreen && (await chrome.offscreen.hasDocument())) await chrome.offscreen.closeDocument();
        } catch {}
      }
      return { ok: true };
    }
    case 'snip:recording': {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#000000' }).catch(() => {});
      await chrome.action.setBadgeText({ tabId, text: msg.on ? 'REC' : '' }).catch(() => {});
      return { ok: true };
    }
    case 'snip:closed': {
      if (msg.token) sessions.delete(msg.token);
      barTabs.delete(tabId);
      if (msg.closeChat && sender.tab) closeChat(sender.tab.windowId); // closed with the icon: the chat goes too
      await chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
      return { ok: true };
    }
    case 'snip:resetPopup': {
      if (msg.tabId != null) await chrome.action.setPopup({ tabId: msg.tabId, popup: '' }).catch(() => {});
      return { ok: true };
    }
    case 'snip:openExtensionSettings': {
      await chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });
      return { ok: true };
    }
    default:
      return { error: 'Unknown message ' + msg.type };
  }
}

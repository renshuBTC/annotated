// Annotated.com: page-side helper. Injected on demand (toolbar click / shortcut) into the top frame.
// It only hosts the overlay frame and answers questions about the page (element rects, video
// positions, the best source link). All drawing, typing, recording and saving happen inside the
// overlay frame (ui.html), which is an extension page, so page scripts can't see or intercept it.
(() => {
  // Already here and still connected to the extension? Then the existing copy handles everything.
  // (After the extension is updated, an old copy stays behind but can't talk to it any more.)
  const prev = window.__annotatedSnip;
  if (prev && prev.alive()) return;
  if (prev) {
    try {
      prev.dispose();
    } catch {}
  }

  const EXT_ORIGIN = new URL(chrome.runtime.getURL('')).origin;
  let ui = null; // { host, frame, port, token, hole, keep, only, scale }
  window.__annotatedSnip = {
    alive: () => {
      try {
        return !!(chrome.runtime && chrome.runtime.id);
      } catch {
        return false;
      }
    },
    dispose: () => teardown(),
  };

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (!msg || typeof msg.type !== 'string') return false;
    if (msg.type === 'snip:toggle') {
      if (!ui) {
        reply({ handled: false });
        return false;
      }
      if (!ui.ready) {
        // The overlay never started (or crashed): remove it and let a fresh one open.
        teardown();
        reply({ handled: false });
        return false;
      }
      const ackId = Math.random();
      ui.pendingAck = ackId;
      ui.port.postMessage({ type: 'toggle', mode: msg.mode, ackId });
      setTimeout(() => {
        if (!ui || ui.pendingAck !== ackId) return;
        // No answer: don't leave a dead overlay on the page (and the icon closes the chat with it).
        const token = ui.token;
        teardown();
        chrome.runtime.sendMessage({ type: 'snip:closed', token, closeChat: msg.mode === 'bar' }).catch(() => {});
      }, 1500);
      reply({ handled: true });
      return false;
    }
    if (msg.type === 'snip:status') {
      reply({ open: !!(ui && ui.ready) });
      return false;
    }
    if (msg.type === 'snip:window') {
      if (ui && ui.ready) ui.port.postMessage({ type: 'window', windowId: msg.windowId });
      reply({ ok: true });
      return false;
    }
    if (msg.type === 'snip:open') {
      if (ui) teardown();
      // (An SVG picture or an XML file opened on its own isn't a web page: there's nowhere to put the bar.)
      const de = document.documentElement;
      if (!de || de.namespaceURI !== 'http://www.w3.org/1999/xhtml') {
        reply({ error: 'notHtml' });
        return false;
      }
      try {
        open(msg.token, msg.mode);
        reply({ ok: true });
      } catch (e) {
        try {
          teardown();
        } catch {}
        reply({ error: String((e && e.message) || e) });
      }
      return false;
    }
    return false;
  });

  function important(el, css) {
    for (const [k, v] of Object.entries(css)) el.style.setProperty(k, v, 'important');
  }

  const HOST_CSS = {
    all: 'initial',
      position: 'fixed',
      inset: '0',
      left: '0',
      top: '0',
      width: '100vw',
      height: '100vh',
      'max-width': 'none',
      'max-height': 'none',
      margin: '0',
      padding: '0',
      border: '0',
      background: 'transparent',
      overflow: 'visible',
      display: 'block',
      'z-index': '2147483647',
      'pointer-events': 'none',
      'color-scheme': 'light',
      opacity: '1',
      visibility: 'visible',
      transform: 'none',
      filter: 'none',
    'clip-path': 'none',
    contain: 'strict',
  };

  function open(token, mode) {
    const host = document.createElement('annotated-snip-overlay');
    host.setAttribute('popover', 'manual');
    important(host, HOST_CSS);
    const root = host.attachShadow({ mode: 'closed' });
    const frame = document.createElement('iframe');
    frame.setAttribute('allow', 'clipboard-write; autoplay; camera; microphone');
    frame.setAttribute('title', 'Annotated.com');
    frame.src = chrome.runtime.getURL('ui.html') + '#' + encodeURIComponent(token) + '|' + encodeURIComponent(mode || 'snip');
    important(frame, {
      all: 'initial',
      position: 'absolute',
      left: '0',
      top: '0',
      width: '100%',
      height: '100%',
      border: '0',
      margin: '0',
      padding: '0',
      background: 'transparent',
      display: 'block',
      'pointer-events': 'auto',
      // Same colour scheme as the overlay page inside it, so Chrome keeps the frame see-through (it
      // paints an opaque backdrop behind a frame whose colour scheme differs).
      'color-scheme': 'dark',
      visibility: 'visible',
    });
    root.append(frame);
    // (Inside the page's open modal dialog, if it has one: see followDialogs. Only where Chrome can move
    // it out again without reloading it.)
    const modal = 'moveBefore' in Element.prototype ? modalDialog() : null;
    (modal || document.documentElement).append(host);
    scrollbarsOn();
    try {
      host.showPopover();
    } catch {
      // Very old pages/engines: fall back to a plain fixed element.
    }

    const channel = new MessageChannel();
    // From the icon (or the chat opening), just the bar comes up on the page as it is: nothing of the
    // overlay takes clicks until the bar is drawn, and then only the bar does. The keyboard stays with
    // the page (and the chat) until you press 📷 or 🎥.
    const fromIcon = mode === 'bar';
    ui = { host, frame, port: channel.port1, token, hole: null, keep: [], only: fromIcon ? [] : null, scale: 1, ready: false, opened: Date.now(), pendingAck: null, dialog: null, modals: [] };
    if (modal) inDialog(modal);
    ui.dialogs = new MutationObserver(onDialogs);
    ui.dialogs.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['open'] });
    window.addEventListener('focusin', onFocusIn, true); // (a dialog in a web component: focus goes into it)
    if (fromIcon) applyHole();
    channel.port1.onmessage = (e) => onUiMessage(e.data);
    let loads = 0;
    frame.addEventListener('load', () => {
      // Loaded again: the page moved the overlay (with the dialog it was in, say) and it started over,
      // with nothing to talk to. It's closed properly rather than left on the page.
      if (loads++) return ui && ui.frame === frame && closedHere();
      frame.contentWindow.postMessage({ type: 'annotated-snip:hello', token }, EXT_ORIGIN, [channel.port2]);
      if (fromIcon) return;
      try {
        frame.focus();
      } catch {}
    });

    window.addEventListener('resize', onResize, true);
    document.addEventListener('fullscreenchange', onFullscreen, true);
    window.addEventListener('pagehide', onPageHide, true);
    window.addEventListener('pointerup', onPagePointerUp, true);
    window.addEventListener('blur', onPageBlur);
    for (const t of ['keydown', 'keypress', 'keyup']) window.addEventListener(t, onPageKey, true);
    window.addEventListener('keydown', onIdleEsc); // (bubbling: after the page's own handlers)
    // The page can't hide or restyle the overlay: what it changes on the host is put back (not what
    // this script changes itself: it stops watching while it does).
    const KEY_CSS = ['position', 'display', 'opacity', 'pointer-events', 'z-index', 'transform', 'filter', 'clip-path', 'visibility'];
    ui.guard = new MutationObserver(() => {
      if (!ui || ui.host !== host) return;
      const want = { ...HOST_CSS, visibility: ui.hidden ? 'hidden' : 'visible' }; // (as the overlay last asked)
      const changed = KEY_CSS.some((k) => host.style.getPropertyValue(k) !== String(want[k]) || host.style.getPropertyPriority(k) !== 'important');
      const popover = host.getAttribute('popover') !== 'manual';
      if (changed || popover) {
        ui.guard.disconnect();
        try {
          if (popover) host.setAttribute('popover', 'manual');
          if (changed) important(host, want);
        } finally {
          ui.guard.observe(host, { attributes: true });
        }
      }
      try {
        if (!host.matches(':popover-open')) host.showPopover();
      } catch {}
    });
    ui.guard.observe(host, { attributes: true });
    host.addEventListener('toggle', (e) => {
      if (ui && ui.host === host && e.newState === 'closed') {
        try {
          host.showPopover();
        } catch {}
      }
    });
    ui.watchdog = setInterval(() => {
      if (!ui) return;
      let alive = true;
      try {
        alive = !!(chrome.runtime && chrome.runtime.id);
      } catch {
        alive = false;
      }
      if (!alive) return teardown(); // the extension was updated or removed
      if (!ui.ready && Date.now() - ui.opened > 9000) return closedHere(); // the overlay never started
      if (!ui.host.isConnected) return closedHere(); // the page took it away
    }, 1500);
  }

  // A modal dialog on the page (a lightbox, say) makes everything outside it unclickable, the overlay
  // too. While one is open, the overlay is inside it (moved, so it isn't reloaded: what you're making
  // stays), shown again above it; when it closes, the overlay goes back out (before the page can take
  // the dialog away).
  // The one on top is the one opened last (ui.modals, in the order they opened while the bar was up);
  // ones already open before that: the last in the page.
  function modalDialog() {
    const isModal = (d) => {
      try {
        return d.isConnected && d.matches(':modal');
      } catch {
        return false;
      }
    };
    const seen = (ui && ui.modals) || [];
    for (let i = seen.length - 1; i >= 0; i--) if (isModal(seen[i])) return seen[i];
    let top = null;
    try {
      for (const d of document.querySelectorAll('dialog')) if (isModal(d)) top = d;
    } catch {}
    return top;
  }
  function onDialogs(records) {
    if (!ui) return;
    for (const r of records || []) {
      const d = r.target;
      if (!d || d.tagName !== 'DIALOG') continue;
      const i = ui.modals.indexOf(d);
      if (i >= 0) ui.modals.splice(i, 1);
      let modal = false;
      try {
        modal = d.matches(':modal');
      } catch {}
      if (modal) ui.modals.push(d);
    }
    if (ui.modals.length > 50) ui.modals.splice(0, ui.modals.length - 50);
    followDialogs();
  }
  function moveHost(to) {
    if (!ui || ui.host.parentNode === to) return;
    if (!to.moveBefore || !ui.host.isConnected) return; // (an older Chrome would reload it: it stays put)
    try {
      to.moveBefore(ui.host, null);
    } catch {
      return;
    }
    try {
      ui.host.hidePopover();
    } catch {}
    try {
      ui.host.showPopover(); // (on top again)
    } catch {}
  }
  function inDialog(d) {
    if (ui.dialog) ui.dialog.removeEventListener('beforetoggle', onDialogToggle);
    ui.dialog = d;
    if (d) d.addEventListener('beforetoggle', onDialogToggle);
  }
  function onDialogToggle(e) {
    if (!ui || e.newState !== 'closed' || e.target !== ui.dialog) return;
    inDialog(null);
    moveHost(document.documentElement);
  }
  function followDialogs() {
    if (!ui) return;
    const d = modalDialog();
    if (d === ui.dialog && (!d || ui.host.parentNode === d)) return;
    if (!d && ui.dialog && ui.dialog.isConnected && ui.dialog.matches(':modal')) return; // (one in a web component)
    moveHost(d || document.documentElement);
    inDialog(d && ui.host.parentNode === d ? d : null);
  }
  // A modal dialog inside a web component (the page's own observer can't see into it): found as focus
  // goes into it.
  function onFocusIn(e) {
    if (!ui || !e.composedPath) return;
    const d = e.composedPath().find((n) => n && n.tagName === 'DIALOG');
    if (!d || d === ui.dialog || !d.matches(':modal')) return;
    moveHost(d);
    if (ui.host.parentNode === d) inDialog(d);
  }

  // The overlay went without the overlay saying so (the page left or removed it): tell the worker, so
  // the icon and the chat know.
  function closedHere() {
    if (!ui) return;
    const token = ui.token;
    teardown();
    try {
      chrome.runtime.sendMessage({ type: 'snip:closed', token, closeChat: false }).catch(() => {});
    } catch {}
  }
  function onPageHide(e) {
    if (e && e.isTrusted === false) return; // (the page's own made-up event: it isn't going anywhere)
    closedHere();
  }

  // Leaving the page while a video is being made, or one is waiting to be saved: Chrome asks first.
  function onLeave(e) {
    if (!ui) return;
    e.preventDefault();
    e.returnValue = ''; // (older Chrome)
  }

  function teardown() {
    if (!ui) return;
    const { host, port, watchdog, guard, dialogs, dialog } = ui;
    ui = null;
    followed = null;
    if (dialogs) dialogs.disconnect();
    if (dialog) dialog.removeEventListener('beforetoggle', onDialogToggle);
    window.removeEventListener('focusin', onFocusIn, true);
    scrollbarsOff();
    clearInterval(watchdog);
    if (guard) guard.disconnect();
    window.removeEventListener('pointerup', onPagePointerUp, true);
    window.removeEventListener('blur', onPageBlur);
    for (const t of ['keydown', 'keypress', 'keyup']) window.removeEventListener(t, onPageKey, true);
    window.removeEventListener('keydown', onIdleEsc);
    try {
      port.close();
    } catch {}
    try {
      host.hidePopover();
    } catch {}
    host.remove();
    window.removeEventListener('resize', onResize, true);
    document.removeEventListener('fullscreenchange', onFullscreen, true);
    window.removeEventListener('pagehide', onPageHide, true);
    window.removeEventListener('beforeunload', onLeave);
  }

  /* ---------- the page's own scrollbar, while Annotated.com is open ---------- */
  // Out of sight until you scroll (or point at it); it fades away a second after. Only the page's own
  // scrollbar, at its own width: anything that scrolls inside the page keeps its look. Put back on close.
  let sb = null; // { style, timer, near, shown, inner }
  function scrollbarsOn() {
    if (sb) return;
    const root = document.documentElement;
    // What the page's own scrollbars inside it get from the page (they keep it).
    let inner = 'auto';
    try {
      inner = getComputedStyle(document.body || root).scrollbarColor || 'auto';
    } catch {}
    sb = { style: document.createElement('style'), timer: 0, near: false, shown: true, inner };
    sb.style.setAttribute('data-annotated', 'scrollbar');
    paintScrollbar(false);
    const gutter = () => window.innerWidth - root.clientWidth;
    const before = gutter();
    (document.head || root).append(sb.style);
    // A page that styled its scrollbar its own way (hidden, or narrower) keeps it: restyling it would
    // change its width, and the page would move (no longer match its picture).
    if (gutter() !== before) sb.style.remove();
    window.addEventListener('scroll', onPageScroll, { capture: true, passive: true });
    window.addEventListener('pointermove', onPagePointer, { capture: true, passive: true });
  }
  function paintScrollbar(show) {
    if (!sb || sb.shown === show) return;
    sb.shown = show;
    const color = show ? 'rgba(128, 128, 128, 0.6) transparent' : 'transparent transparent';
    sb.style.textContent = `html{scrollbar-color:${color}!important}:where(body){scrollbar-color:${sb.inner}}`;
  }
  function scrollbarSeen() {
    paintScrollbar(true);
    clearTimeout(sb.timer);
    sb.timer = setTimeout(() => sb && !sb.near && paintScrollbar(false), 1000);
  }
  function onPageScroll(e) {
    if (!sb) return;
    const t = e.target;
    if (t === document || t === document.documentElement || t === document.body || t === document.scrollingElement) scrollbarSeen();
  }
  function onPagePointer(e) {
    if (!sb) return;
    const near = e.clientX >= document.documentElement.clientWidth - 2; // over the page's scrollbar
    if (near === sb.near) return;
    sb.near = near;
    if (near) {
      clearTimeout(sb.timer);
      paintScrollbar(true);
    } else scrollbarSeen();
  }
  function scrollbarsOff() {
    if (!sb) return;
    clearTimeout(sb.timer);
    sb.style.remove();
    window.removeEventListener('scroll', onPageScroll, true);
    window.removeEventListener('pointermove', onPagePointer, true);
    sb = null;
  }

  function onResize() {
    if (!ui) return;
    applyHole();
    ui.port.postMessage({ type: 'resize', w: window.innerWidth, h: window.innerHeight });
  }

  /* ---------- keep the keyboard on the typing line while recording ---------- */

  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return !/^(button|checkbox|radio|range|submit|reset|file|color|image|hidden)$/i.test(el.type || '');
    return false;
  }

  function deepActive() {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a;
  }

  function refocusUi() {
    if (!ui) return;
    try {
      ui.frame.focus();
    } catch {}
    ui.port.postMessage({ type: 'focusEditor' });
  }

  // Clicking play/pause inside the recording area focuses the page; hand the keyboard back to the
  // typing line right after, unless the click was into one of the page's own text fields.
  function onPagePointerUp(e) {
    if (!ui || !ui.hole || !e.isTrusted) return;
    const path = e.composedPath ? e.composedPath() : [e.target];
    if (path.includes(ui.host)) return;
    if (isEditable(path[0])) return;
    setTimeout(() => {
      if (ui && ui.hole && !isEditable(deepActive())) refocusUi();
    }, 0);
  }

  // Safety net: if the page still has the keyboard, don't let typing trigger its shortcuts
  // (YouTube's k / f / numbers...). Send the keys to the typing line instead.
  function onPageKey(e) {
    if (!ui || !ui.hole || !e.isTrusted) return; // (only your own key presses, never the page's made-up ones)
    const path = e.composedPath ? e.composedPath() : [e.target];
    if (path.includes(ui.host) || isEditable(path[0])) return;
    const printable = e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (!printable && !['Enter', 'Escape', 'Backspace'].includes(e.key)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'keydown') {
      refocusUi();
      ui.port.postMessage({ type: 'key', key: e.key, shiftKey: e.shiftKey, repeat: e.repeat });
    }
  }

  // With just the bar on the page, the page has the keyboard (its arrows and shortcuts work), and Esc
  // still closes the bar and the chat, unless the page used it (closing its own pop-up, say).
  function onIdleEsc(e) {
    if (!ui || ui.hole || !ui.only || e.key !== 'Escape' || !e.isTrusted || e.defaultPrevented || e.repeat) return;
    const path = e.composedPath ? e.composedPath() : [e.target];
    if (path.includes(ui.host) || isEditable(path[0])) return;
    if (pagePopupOpen()) return; // (that Esc closes the page's own pop-up)
    ui.port.postMessage({ type: 'key', key: 'Escape' });
  }

  // The page has a pop-up of its own open (a dialog, a menu): Esc is for that.
  function pagePopupOpen() {
    try {
      if (modalDialog()) return true;
      for (const p of document.querySelectorAll(':popover-open')) if (p !== (ui && ui.host)) return true;
    } catch {}
    return false;
  }

  // While recording, a click into a video player embedded in the page (another site's frame) would
  // take the keyboard there, and your typing would work its controls: the typing line gets it back.
  function onPageBlur() {
    setTimeout(() => {
      if (!ui || !ui.hole) return;
      const a = document.activeElement;
      if (a && a !== ui.host && a.tagName === 'IFRAME' && VIDEO_IFRAME.test(a.src || '')) refocusUi();
    }, 0);
  }

  function onFullscreen() {
    // A page element going fullscreen enters the top layer above us; re-show to stay on top.
    if (!ui) return;
    try {
      ui.host.hidePopover();
      ui.host.showPopover();
    } catch {}
  }

  async function onUiMessage(m) {
    if (!ui || !m) return;
    ui.ready = true;
    if (m.type === 'ack') {
      if (ui.pendingAck === m.ackId) ui.pendingAck = null;
      return;
    }
    let result = null;
    try {
      switch (m.type) {
        case 'info':
          ui.scale = m.uiWidth ? ui.frame.getBoundingClientRect().width / m.uiWidth || 1 : 1;
          result = pageInfo();
          break;
        case 'pick':
          result = pick(m.x * ui.scale, m.y * ui.scale, m.depth == null ? null : m.depth);
          break;
        case 'hlStart':
          hlDrag = m.drag;
          result = { text: highlightFrom(m.x * ui.scale, m.y * ui.scale) };
          break;
        case 'hlTo':
          result = m.drag === hlDrag ? highlightTo(m.x * ui.scale, m.y * ui.scale) : null;
          break;
        case 'hlEnd':
          if (m.drag === hlDrag) hlFrom = null;
          result = true;
          break;
        case 'videos':
          result = listVideos();
          break;
        case 'media':
          result = await followRecording(m.action, m.rect, m);
          break;
        case 'source':
          result = bestSource(m.rect, m);
          break;
        case 'words':
          result = wordsIn(m.rect);
          break;
        case 'wordList':
          // Every word on screen, the moment the page is pictured (your area is chosen afterwards).
          if (m.uiWidth) ui.scale = ui.frame.getBoundingClientRect().width / m.uiWidth || 1;
          result = wordList({ x: 0, y: 0, w: window.innerWidth / ui.scale, h: window.innerHeight / ui.scale });
          break;
        case 'guard':
          if (m.on) window.addEventListener('beforeunload', onLeave);
          else window.removeEventListener('beforeunload', onLeave);
          result = true;
          break;
        case 'hole':
          ui.hole = m.rect || null;
          ui.keep = Array.isArray(m.keep) ? m.keep : [];
          ui.only = Array.isArray(m.only) ? m.only : null;
          applyHole();
          result = true;
          break;
        case 'visible':
          // Hidden for a picture of the page: the frame too (it sets its own visibility, which would
          // otherwise keep it, and the bar, in the picture).
          ui.hidden = !m.visible;
          ui.guard.disconnect(); // (this script's own change: not put back)
          important(ui.host, { visibility: m.visible ? 'visible' : 'hidden' });
          ui.guard.observe(ui.host, { attributes: true });
          important(ui.frame, { visibility: m.visible ? 'visible' : 'hidden' });
          result = true;
          break;
        case 'focus':
          try {
            ui.frame.focus();
          } catch {}
          result = true;
          break;
        case 'blur':
          // Just the bar on the page again: the keyboard goes back to the page (arrows, Page Down...).
          try {
            if (document.activeElement === ui.host) ui.frame.blur(); // (only if the overlay has it)
          } catch {}
          result = true;
          break;
        case 'settle': {
          // After the overlay's shape changed (the bar alone -> the whole screen): two of the page's
          // frames, so Chrome sends the pointer by the new shape. (A press right away could otherwise
          // still land on the page.)
          const id = m.id;
          let sent = false;
          const reply = () => {
            if (sent || !ui) return;
            sent = true;
            ui.port.postMessage({ id, result: true });
          };
          requestAnimationFrame(() => requestAnimationFrame(reply));
          setTimeout(reply, 250);
          return;
        }
        case 'close':
          teardown();
          // Said from here, not from the overlay: its frame is gone now, and a message it had just
          // sent could go with it.
          try {
            chrome.runtime.sendMessage({ type: 'snip:closed', token: m.token, closeChat: !!m.closeChat }).catch(() => {});
          } catch {}
          return;
      }
    } catch (e) {
      if (m.id != null && ui) ui.port.postMessage({ id: m.id, error: String((e && e.message) || e) });
      return;
    }
    if (m.id != null && ui) ui.port.postMessage({ id: m.id, result });
  }

  function pageInfo() {
    return {
      url: location.href,
      title: document.title,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
      videos: listVideos(),
    };
  }

  // Cut a hole in the overlay so the page under the recording area stays visible and clickable, except
  // where the overlay's own controls sit over it (the bar, the typing line...): those stay in front.
  // Non-zero winding: the frame clockwise, the hole anticlockwise, the controls clockwise again.
  // With the bar on the page as it is ("only"), only the bar (and a label or bubble) shows and takes
  // clicks: the rest of the page is yours, and its keys too.
  function applyHole() {
    if (!ui) return;
    const f = ui.frame;
    const k = ui.scale || 1;
    if (ui.only) {
      const d = ui.only.map((c) => `M${c.x * k} ${c.y * k}H${(c.x + c.w) * k}V${(c.y + c.h) * k}H${c.x * k}Z`).join(' ');
      f.style.setProperty('clip-path', d ? `path(nonzero, "${d}")` : 'polygon(0 0, 0 0, 0 0)', 'important');
      return;
    }
    if (!ui.hole) {
      f.style.removeProperty('clip-path');
      return;
    }
    const r = f.getBoundingClientRect();
    const x = ui.hole.x * k;
    const y = ui.hole.y * k;
    const w = ui.hole.w * k;
    const h = ui.hole.h * k;
    const W = r.width;
    const H = r.height;
    let d = `M0 0H${W}V${H}H0Z M${x} ${y}V${y + h}H${x + w}V${y}Z`;
    for (const c of ui.keep || []) {
      const cx = c.x * k;
      const cy = c.y * k;
      d += ` M${cx} ${cy}H${cx + c.w * k}V${cy + c.h * k}H${cx}Z`;
    }
    f.style.setProperty('clip-path', `path(nonzero, "${d}")`, 'important');
  }

  /* ---------- geometry helpers ---------- */

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    const k = ui ? ui.scale : 1;
    return { x: r.left / k, y: r.top / k, w: r.width / k, h: r.height / k };
  }

  function clipToViewport(r) {
    const k = ui ? ui.scale : 1;
    const W = window.innerWidth / k;
    const H = window.innerHeight / k;
    const x = Math.max(0, r.x);
    const y = Math.max(0, r.y);
    const x2 = Math.min(W, r.x + r.w);
    const y2 = Math.min(H, r.y + r.h);
    if (x2 <= x || y2 <= y) return null;
    return { x, y, w: x2 - x, h: y2 - y };
  }

  function overlap(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
  }

  function isShown(el) {
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') > 0.05;
  }

  function deepAll(selector, root = document, out = [], depth = 0) {
    root.querySelectorAll(selector).forEach((e) => out.push(e));
    if (depth > 4) return out;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let n = walker.currentNode;
    while (n) {
      if (n.shadowRoot) deepAll(selector, n.shadowRoot, out, depth + 1);
      n = walker.nextNode();
    }
    return out;
  }

  const VIDEO_IFRAME =
    /(youtube(-nocookie)?\.com\/embed|player\.vimeo\.com|player\.twitch\.tv|dailymotion\.com\/(embed|player)|streamable\.com\/[eo]\/|facebook\.com\/plugins\/video|tiktok\.com\/embed|loom\.com\/embed|fast\.wistia|players\.brightcove|jwplayer|rumble\.com\/embed|bilibili\.com\/.*player|x\.com\/i\/videos|twitter\.com\/i\/videos)/i;

  function listVideos() {
    const out = [];
    for (const v of deepAll('video')) {
      const r = clipToViewport(rectOf(v));
      if (!r || r.w < 80 || r.h < 45 || !isShown(v)) continue;
      out.push({ ...r, kind: 'video', playing: !v.paused && !v.ended, t: v.currentTime || 0 });
    }
    for (const f of document.querySelectorAll('iframe')) {
      if (!VIDEO_IFRAME.test(f.src || '')) continue;
      const r = clipToViewport(rectOf(f));
      if (!r || r.w < 120 || r.h < 68 || !isShown(f)) continue;
      out.push({ ...r, kind: 'embed' });
    }
    return out;
  }

  /* ---------- the video in your area plays along with the recording ---------- */
  // Recording starts (after the countdown) or goes on: the page's video in your area plays. Paused or
  // stopped: it pauses. So you never press both, and the clip starts where the video does. (A player in
  // another site's frame, like a YouTube video embedded in an article, can't be reached from here.)
  let followed = null; // the video playing along with this recording

  // Every <video> on the page, in shadow roots too (a custom element's closed one included).
  function allVideos() {
    const out = [];
    const walk = (root, depth) => {
      root.querySelectorAll('video').forEach((v) => out.push(v));
      if (depth > 4) return;
      const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (ui && n === ui.host) continue;
        const sr = n.shadowRoot || (n.tagName.includes('-') && chrome.dom && chrome.dom.openOrClosedShadowRoot ? chrome.dom.openOrClosedShadowRoot(n) : null);
        if (sr) walk(sr, depth + 1);
      }
    };
    try {
      walk(document, 0);
    } catch {}
    return out;
  }

  // The video your area is on: the one covering most of it. A page's background loop (muted, looping,
  // no controls) only when there's no other.
  function videoToFollow(rect) {
    let best = null;
    let bestScore = 0;
    for (const v of allVideos()) {
      const r = rectOf(v);
      if (r.w < 80 || r.h < 45 || !isShown(v)) continue;
      const a = overlap(r, rect);
      if (!a || Math.max(a / (r.w * r.h), a / (rect.w * rect.h)) < 0.3) continue; // (just a corner of it)
      const score = a * (v.muted && v.loop && !v.controls ? 0.001 : 1);
      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }
    return best;
  }

  // action: 'play' (the recording starts, or goes on: m.from 'start' | 'resume'), 'pause' or 'stop'.
  async function followRecording(action, rect, m = {}) {
    const now = rect ? videoToFollow(rect) : null;
    if (action === 'play') {
      followed = now;
      if (!now) {
        // Only another site's player there (no video of the page's own): it can't be started from here.
        const embed = rect && !!document.querySelector('iframe') && listVideos().some((x) => x.kind === 'embed' && overlap(x, rect) > 0.3 * Math.min(x.w * x.h, rect.w * rect.h));
        return { video: false, embed };
      }
      if (!now.paused) return { video: true, playing: true };
      if (now.ended && m.from === 'resume') return { video: true, playing: false }; // (it finished: it stays at its end)
      try {
        const p = now.play();
        // A refusal comes at once; starting can take longer while it loads (a late failure: nothing to do).
        if (p) {
          p.catch(() => {});
          await Promise.race([p, new Promise((r) => setTimeout(r, 250))]);
        }
      } catch (e) {
        return { video: true, playing: false, blocked: !!e && e.name === 'NotAllowedError' };
      }
      return { video: true, playing: true };
    }
    // Paused or stopped: the video playing along pauses (and one playing in your area now, if it's
    // another: you may have scrolled on to it).
    let paused = 0;
    for (const v of new Set([followed, now])) {
      if (v && !v.paused) {
        v.pause();
        paused++;
      }
    }
    if (action === 'stop') followed = null;
    return { video: !!(followed || now), paused };
  }

  /* ---------- window mode: pick a meaningful element under the pointer ---------- */

  const SEMANTIC = new Set([
    'VIDEO', 'IMG', 'PICTURE', 'CANVAS', 'IFRAME', 'svg', 'SVG', 'FIGURE', 'ARTICLE', 'PRE', 'TABLE', 'BLOCKQUOTE',
    'LI', 'SECTION', 'ASIDE', 'HEADER', 'FOOTER', 'NAV', 'FORM', 'MAIN', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'UL', 'OL', 'DL', 'DIALOG', 'CODE',
  ]);
  const SEMANTIC_SEL =
    '[data-testid="tweet"],[data-testid="tweetPhoto"],[data-testid="videoPlayer"],[role="article"],[role="dialog"],[role="img"],[role="figure"],#movie_player,ytd-player,ytd-rich-item-renderer,ytd-video-renderer,ytd-comment-thread-renderer,shreddit-post,shreddit-comment';

  function isCandidate(el, area) {
    const r = el.getBoundingClientRect();
    if (r.width < 32 || r.height < 18) return false;
    if (r.width * r.height > area * 0.97) return false;
    if (SEMANTIC.has(el.tagName) || el.matches(SEMANTIC_SEL)) return true;
    // A web component with insides of its own (a player, a card), big enough to mean something.
    if (el.shadowRoot && r.width >= 120 && r.height >= 68) return true;
    const cs = getComputedStyle(el);
    if (cs.boxShadow && cs.boxShadow !== 'none') return true;
    if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && parseFloat(cs.borderLeftWidth) > 0) return true;
    if (parseFloat(cs.borderTopLeftRadius) >= 6 && cs.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor)) return true;
    if (cs.backgroundImage && cs.backgroundImage !== 'none' && r.width * r.height > 4000) return true;
    return false;
  }

  function parentOf(n) {
    if (n.parentElement) return n.parentElement;
    const root = n.getRootNode && n.getRootNode();
    return root && root.host ? root.host : null;
  }

  function hitElement(x, y) {
    const ours = (e) => !!ui && (e === ui.host || ui.host.contains(e));
    let el = document.elementsFromPoint(x, y).find((e) => !ours(e)) || null;
    // Step into open shadow roots (custom players, web components): the topmost thing in the component's
    // own tree. Never the overlay (it can be in there too, with a pop-up of the component's).
    for (let i = 0; el && el.shadowRoot && i < 5; i++) {
      const sr = el.shadowRoot;
      const host = el;
      const inner = sr.elementsFromPoint(x, y).find((e) => e !== host && !ours(e) && sr.contains(e));
      if (!inner) break;
      el = inner;
    }
    return el;
  }

  // Things people usually mean when they click: a whole post, image, video, code block, table...
  const STRONG =
    'article,figure,video,img,picture,canvas,iframe,blockquote,pre,table,dialog,[data-testid="tweet"],[role="article"],[role="dialog"],#movie_player,ytd-player,ytd-rich-item-renderer,ytd-video-renderer,ytd-comment-thread-renderer,shreddit-post,shreddit-comment';

  // depth: null = best guess; a number = that many steps out from the innermost candidate.
  function pick(x, y, depth) {
    const el = hitElement(x, y);
    if (!el) return null;
    const area = window.innerWidth * window.innerHeight;
    const chain = [];
    for (let n = el; n && n !== document.documentElement && n !== document.body; n = parentOf(n)) {
      if (isCandidate(n, area)) {
        const r = clipToViewport(rectOf(n));
        if (!r) continue;
        const prev = chain[chain.length - 1];
        // Skip wrappers that are (almost) the same box as the previous candidate.
        if (prev && Math.abs(prev.x - r.x) < 3 && Math.abs(prev.y - r.y) < 3 && Math.abs(prev.w - r.w) < 6 && Math.abs(prev.h - r.h) < 6) {
          if (n.matches(STRONG)) prev.strong = true;
          continue;
        }
        chain.push({ ...r, tag: n.tagName.toLowerCase(), strong: n.matches(STRONG) });
      }
      if (chain.length > 12) break;
    }
    if (!chain.length) {
      const r = clipToViewport(rectOf(el));
      return r ? { ...r, depth: 0, max: 0 } : null;
    }
    let d;
    if (depth == null) {
      const k = ui ? ui.scale : 1;
      const big = (c) => c.w * c.h > (area / (k * k)) * 0.6;
      d = chain.findIndex((c) => c.strong && !big(c));
      if (d < 0) d = 0;
    } else {
      d = Math.max(0, Math.min(depth, chain.length - 1));
    }
    const { strong, ...hit } = chain[d];
    return { ...hit, depth: d, max: chain.length - 1 };
  }

  /* ---------- the words a snip shows (for Ask AI in the chat) ---------- */
  // The page's text that you can see inside `rect` (the overlay's units), in the page's order: each word
  // whose middle is inside the box; a new line where a new block of text starts (a paragraph, a heading, a
  // list item...), a space where a line just wraps. Our own overlay, hidden text, form fields and other
  // frames are left out; open shadow roots are read too. At most `max` letters.
  const NO_WORDS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'SELECT', 'OPTION', 'IFRAME', 'SVG', 'svg', 'CANVAS', 'VIDEO', 'AUDIO']);
  // The words of the page's text in an area, as you see them there: not hidden, not cut off by what
  // they scroll in, and not under something else (a pop-up, a header that stays put). Each, in reading
  // order: [word, x, y (its middle), bottom, block, a space after it, not at its text's start], in the
  // overlay's units.
  const COVERING = new Set(['IMG', 'VIDEO', 'CANVAS', 'IFRAME', 'EMBED', 'OBJECT']);
  // (On a page too big to go through in a moment, none are given (null), and the overlay asks again for
  // just your area when you save; `partial` gives what was found instead.)
  function wordList(rect, maxWords = 20000, { partial = false } = {}) {
    if (!rect) return [];
    const k = ui ? ui.scale : 1;
    const L = rect.x * k;
    const T = rect.y * k;
    const R = (rect.x + rect.w) * k;
    const B = (rect.y + rect.h) * k;
    const range = document.createRange();
    const styles = new Map();
    const style = (e) => {
      let st = styles.get(e);
      if (!st) styles.set(e, (st = getComputedStyle(e)));
      return st;
    };
    const seenVis = new Map(); // element -> can you see it?
    const visible = (elem) => {
      let v = seenVis.get(elem);
      if (v === undefined) {
        v = elem.checkVisibility ? elem.checkVisibility({ opacityProperty: true, visibilityProperty: true, checkOpacity: true, checkVisibilityCSS: true }) : true;
        seenVis.set(elem, v);
      }
      return v;
    };
    const up = (e) => e.assignedSlot || e.parentElement || (e.parentNode && e.parentNode.host) || null;
    const blocks = new Map(); // element -> the block of text it's in (a number)
    let blockCount = 0;
    const blockEls = new Map();
    const blockOf = (elem) => {
      let b = blocks.get(elem);
      if (b === undefined) {
        const d = style(elem).display;
        const host = elem.parentElement || (elem.getRootNode && elem.getRootNode().host);
        b = !host || !/^(inline|contents|ruby)/.test(d) ? elem : blockOf(host);
        blocks.set(elem, b);
      }
      return b;
    };
    const blockId = (b) => {
      let id = blockEls.get(b);
      if (id === undefined) blockEls.set(b, (id = ++blockCount));
      return id;
    };
    // Where an element's content can show (cut off by its own and its ancestors' overflow: hidden,
    // scroll…): { l, t, r, b } on screen, or null for anywhere.
    const clips = new Map();
    const meet = (a, c) => (!a ? c : !c ? a : { l: Math.max(a.l, c.l), t: Math.max(a.t, c.t), r: Math.min(a.r, c.r), b: Math.min(a.b, c.b) });
    const contentClip = (e) => {
      if (!e || e.nodeType !== 1) return null;
      if (clips.has(e)) return clips.get(e);
      clips.set(e, null); // (while working it out)
      const st = style(e);
      let c = boxClip(e, st);
      if (st.display !== 'contents') {
        const cx = st.overflowX !== 'visible' || /paint|strict|content/.test(st.contain || '');
        const cy = st.overflowY !== 'visible' || /paint|strict|content/.test(st.contain || '');
        if (cx || cy) {
          const r = e.getBoundingClientRect();
          c = meet(c, { l: cx ? r.left : -Infinity, t: cy ? r.top : -Infinity, r: cx ? r.right : Infinity, b: cy ? r.bottom : Infinity });
        }
      }
      clips.set(e, c);
      return c;
    };
    // What cuts off an element's own box: what holds it (a box placed absolutely: only the box it's
    // placed in, and up; one fixed on the screen: nothing).
    const boxClip = (e, st) => {
      if (st.position === 'fixed') return null;
      let a = up(e);
      if (st.position === 'absolute') while (a && style(a).position === 'static' && style(a).transform === 'none') a = up(a);
      return contentClip(a);
    };
    // Something over a word: a picture, a video, or anything with a background you can't see through.
    const alpha = (c) => {
      if (!c || c === 'transparent') return 0;
      const sl = c.match(/\/\s*([\d.]+)(%?)\s*\)$/);
      if (sl) return sl[2] ? parseFloat(sl[1]) / 100 : parseFloat(sl[1]);
      const a = c.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/);
      return a ? parseFloat(a[1]) : 1;
    };
    const hiding = new Map();
    const hides = (e) => {
      let h = hiding.get(e);
      if (h === undefined) {
        const st = style(e);
        h = (COVERING.has(e.tagName) || alpha(st.backgroundColor) >= 0.85 || st.backgroundImage !== 'none' || (st.backdropFilter || 'none') !== 'none') && parseFloat(st.opacity) >= 0.5 && visible(e);
        hiding.set(e, h);
      }
      return h;
    };
    const holding = new Map(); // element -> it and everything that holds it
    const holders = (p) => {
      let set = holding.get(p);
      if (!set) {
        set = new Set();
        for (let e = p; e; e = up(e)) set.add(e);
        holding.set(p, set);
      }
      return set;
    };
    const under = (p, x, y) => {
      // (Text that can't be pointed at, a label over a field say, can't be told from what's under it:
      // it's taken as seen. Unless the whole page is like that because a pop-up holds it: then it's asked.)
      if (style(p).pointerEvents === 'none' && style(document.body || document.documentElement).pointerEvents !== 'none') return false;
      const root = p.getRootNode();
      let stack;
      try {
        stack = (root && root !== document && root.elementsFromPoint ? root : document).elementsFromPoint(x, y);
      } catch {
        return false;
      }
      const hold = holders(p);
      for (const e of stack) {
        if (hold.has(e)) return false; // down to the word's own element: nothing over it
        if (ui && e === ui.host) continue;
        if (hides(e)) return true;
        // (A custom element can have its background inside its own shadow tree: a header that stays put.)
        const sr = e.shadowRoot;
        if (sr) {
          try {
            for (const s of sr.elementsFromPoint(x, y)) if (s !== e && sr.contains(s) && hides(s)) return true;
          } catch {}
        }
      }
      return false;
    };
    // Text you can't read in the picture: blurred (behind a paywall, say), or shown as dots.
    const blurs = new Map();
    const blurred = (e) => {
      if (!e || e.nodeType !== 1) return false;
      let b = blurs.get(e);
      if (b === undefined) {
        const m = /blur\(([\d.]+)px\)/.exec(style(e).filter || '');
        b = (m && parseFloat(m[1]) >= 2) || blurred(up(e));
        blurs.set(e, b);
      }
      return b;
    };
    const unreadable = (p) => {
      const dots = style(p).webkitTextSecurity;
      return (dots && dots !== 'none') || blurred(p);
    };
    const out = [];
    let budget = 60000; // places looked at, at most
    let over = false;
    const take = (n) => {
      // (Its element; straight in a web component's shadow root: the component. An element with no box of
      // its own, display: contents, shows its text if what holds it shows: it's asked instead.)
      const p = n.parentElement || (n.parentNode && n.parentNode.host) || null;
      if (!p) return;
      let shown = p;
      while (shown && style(shown).display === 'contents') shown = up(shown);
      if (!shown || !visible(shown) || style(p).visibility !== 'visible' || unreadable(p)) return;
      // Where this text is, all of it (most of a page's text is nowhere near the area).
      range.selectNodeContents(n);
      const nb = range.getBoundingClientRect();
      if (!nb.width || nb.right < L || nb.left > R || nb.bottom < T || nb.top > B) return;
      const clip = contentClip(p);
      if (clip && (clip.r <= clip.l || clip.b <= clip.t || clip.r < L || clip.l > R || clip.b < T || clip.t > B)) return;
      const block = blockOf(p);
      const re = /\S+/g;
      const found = [];
      const measure = (m) => {
        range.setStart(n, m.index);
        range.setEnd(n, m.index + m[0].length);
        return range.getClientRects()[0];
      };
      // A very long text (a log, say): it's looked up from the first line in the area, and left at the
      // last, rather than measured word by word all the way through.
      const long = n.data.length > 3000 && style(p).writingMode === 'horizontal-tb';
      if (long) {
        let lo = 0;
        let hi = n.data.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          re.lastIndex = mid;
          const m = re.exec(n.data);
          if (!m) {
            hi = mid;
            continue;
          }
          const b = measure(m);
          if (b && b.bottom < T) lo = m.index + m[0].length;
          else hi = mid;
        }
        re.lastIndex = lo;
      }
      let m;
      while ((m = re.exec(n.data)) && out.length + found.length < maxWords) {
        const b = measure(m);
        if (!b || b.width < 1) continue;
        if (long && b.top > B) break; // (the rest of it is further down)
        const cx = b.left + b.width / 2;
        const cy = b.top + b.height / 2;
        if (cx < L || cx > R || cy < T || cy > B) continue;
        if (clip && (cx < clip.l || cx > clip.r || cy < clip.t || cy > clip.b)) continue; // cut off
        const end = m.index + m[0].length;
        found.push({ w: [m[0], cx / k, cy / k, b.bottom / k, blockId(block), end < n.data.length ? 1 : 0, m.index > 0 ? 1 : 0], cx, cy });
      }
      // What's over them: asked for every third word of each line and its last (a pop-up in the middle
      // of a line is found too); where anything is over a line, for each of its words.
      for (let i = 0; i < found.length; ) {
        let j = i;
        while (j + 1 < found.length && Math.abs(found[j + 1].cy - found[i].cy) < 1) j++;
        const asked = new Map();
        const ask = (x) => {
          if (!asked.has(x)) asked.set(x, under(p, found[x].cx, found[x].cy));
          return asked.get(x);
        };
        let any = ask(j);
        for (let x = i; x < j; x += 3) if (ask(x)) any = true;
        for (let x = i; x <= j; x++) if (!(any && ask(x))) out.push(found[x].w);
        i = j + 1;
      }
    };
    // Far from the area: nothing in it is there (its words may spill a little out of its box). Except
    // what's on top in the area and everything it's inside: a bar that stays put can be in a footer far
    // down the page, say, and a pop-up in an empty holder at its end.
    const SPILL = 600;
    const near = new Set();
    for (let i = 0; i < 9; i++) {
      for (let j = 0; j < 9; j++) {
        let e = null;
        try {
          e = hitElement(L + ((R - L) * (i + 0.5)) / 9, T + ((B - T) * (j + 0.5)) / 9);
        } catch {}
        for (; e && !near.has(e); e = parentOf(e)) near.add(e);
      }
    }
    const far = (e) => {
      if (near.has(e)) return false;
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) return false; // (no box of its own: display: contents, or a holder for what's put elsewhere)
      return r.bottom < T - SPILL || r.top > B + SPILL || r.right < L - SPILL || r.left > R + SPILL;
    };
    const walk = (root) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => {
          if (n.nodeType !== Node.ELEMENT_NODE) return NodeFilter.FILTER_ACCEPT;
          if (NO_WORDS.has(n.tagName) || (ui && n === ui.host) || far(n)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      for (let n = w.nextNode(); n && out.length < maxWords; n = w.nextNode()) {
        if (--budget <= 0) {
          over = true;
          return;
        }
        if (n.nodeType === Node.TEXT_NODE) {
          if (n.data.trim()) take(n);
        } else {
          const sr = n.shadowRoot || (n.tagName.includes('-') && chrome.dom && chrome.dom.openOrClosedShadowRoot ? chrome.dom.openOrClosedShadowRoot(n) : null);
          if (sr) {
            walk(sr);
            if (over) return;
          }
        }
      }
    };
    try {
      if (document.body) walk(document.body);
    } catch {}
    return over && !partial ? null : out;
  }

  // Words as text: a new line for a new block lower down; a space where the page has one (a link's
  // words and the comma right after it stay together). (The overlay has the same, for the words it was
  // given when the page was pictured.)
  function joinWords(list, area = null, max = 4000) {
    let out = '';
    let last = null;
    for (const [t, x, y, bottom, block, spaceAfter, mid] of list) {
      if (area && (x < area.x || x > area.x + area.w || y < area.y || y > area.y + area.h)) continue;
      if (last) {
        if (block !== last.block && y > last.bottom - 1) out += '\n';
        else if (last.spaceAfter || mid || block !== last.block) out += ' ';
      }
      out += t;
      last = { bottom, block, spaceAfter };
      if (out.length >= max) break;
    }
    return out.replace(/[ \t]+\n/g, '\n').trim().slice(0, max);
  }

  function wordsIn(rect, max = 4000) {
    if (!rect) return '';
    return joinWords(wordList(rect, 2000, { partial: true }), null, max); // (2000 words: well over the 4000 letters kept)
  }

  /* ---------- highlighting text in your snip, like selecting it ---------- */
  // Only text: where you press has to be on a letter of the page's text. As you drag: the lines of text
  // from there to the pointer, one band per line (just the letters' boxes, never the space around
  // them), in the overlay's units. The overlay draws them in the highlighter's colour over your picture.
  let hlFrom = null; // { node, offset }
  let hlDrag = null; // which drag it's for

  // The text position under a point of the page (the overlay lets the hit test through for a moment).
  function caretAt(x, y) {
    const f = ui && ui.frame;
    if (f) f.style.setProperty('pointer-events', 'none', 'important');
    try {
      if (document.caretPositionFromPoint) {
        const p = document.caretPositionFromPoint(x, y);
        return p && p.offsetNode ? { node: p.offsetNode, offset: p.offset } : null;
      }
      if (document.caretRangeFromPoint) {
        const r = document.caretRangeFromPoint(x, y);
        return r ? { node: r.startContainer, offset: r.startOffset } : null;
      }
      return null;
    } catch {
      return null;
    } finally {
      if (f) f.style.setProperty('pointer-events', 'auto', 'important');
    }
  }

  // Is the point on the text itself (a letter next to the caret), not just beside a paragraph?
  function onText(pos, x, y) {
    if (!pos || !pos.node || pos.node.nodeType !== Node.TEXT_NODE || !pos.node.data.trim()) return false;
    const n = pos.node;
    const r = document.createRange();
    for (const i of [pos.offset, pos.offset - 1]) {
      if (i < 0 || i >= n.data.length) continue;
      r.setStart(n, i);
      r.setEnd(n, i + 1);
      for (const b of r.getClientRects()) if (x >= b.left - 4 && x <= b.right + 4 && y >= b.top - 2 && y <= b.bottom + 2) return true;
    }
    return false;
  }

  // The letter under a point, found by measuring the letters themselves: for text that something lies
  // over (a see-through layer, a link's cover, a custom element), where the browser's own caret test
  // stops at that layer. Looks only at the elements under the point (and their open shadow roots).
  function letterAt(x, y) {
    const f = ui && ui.frame;
    if (f) f.style.setProperty('pointer-events', 'none', 'important');
    let stack;
    try {
      stack = document.elementsFromPoint(x, y).filter((e) => !ui || (e !== ui.host && !ui.host.contains(e)));
    } finally {
      if (f) f.style.setProperty('pointer-events', 'auto', 'important');
    }
    const seen = new Set();
    const r = document.createRange();
    let budget = 3000; // text nodes, at most
    for (const top of stack.slice(0, 16)) {
      for (const n of textUnder(top, x, y, seen, 0)) {
        if (--budget < 0) return null;
        if (!n.data.trim()) continue;
        r.selectNodeContents(n);
        if (![...r.getClientRects()].some((b) => x >= b.left - 1 && x <= b.right + 1 && y >= b.top - 1 && y <= b.bottom + 1)) continue;
        const i = letterIn(n, x, y);
        if (i >= 0) return { node: n, offset: i };
      }
    }
    return null;
  }

  // The text nodes in an element whose boxes take in the point (open shadow roots too).
  function* textUnder(root, x, y, seen, depth) {
    if (depth > 60) return;
    if (root.shadowRoot && root !== (ui && ui.host)) yield* textUnder(root.shadowRoot, x, y, seen, depth + 1);
    for (let c = root.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === Node.TEXT_NODE) {
        if (!seen.has(c)) {
          seen.add(c);
          yield c;
        }
        continue;
      }
      if (c.nodeType !== Node.ELEMENT_NODE || (ui && c === ui.host) || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(c.tagName)) continue;
      const b = c.getBoundingClientRect();
      if ((b.width || b.height) && !(x >= b.left - 2 && x <= b.right + 2 && y >= b.top - 2 && y <= b.bottom + 2)) continue;
      yield* textUnder(c, x, y, seen, depth + 1);
    }
  }

  // Which letter of a text node is under the point (its index), or -1.
  function letterIn(n, x, y) {
    const r = document.createRange();
    const len = Math.min(n.data.length, 20000);
    for (let i = 0; i < len; i++) {
      if (!/\S/.test(n.data[i])) continue;
      r.setStart(n, i);
      r.setEnd(n, i + 1);
      for (const b of r.getClientRects()) if (x >= b.left - 1 && x <= b.right + 1 && y >= b.top - 1 && y <= b.bottom + 1) return i;
    }
    return -1;
  }

  // Where you press: on a letter (the browser's caret test, checked against the letters' boxes; or,
  // with something over the text, the letters measured directly). Anywhere else: nothing.
  function highlightFrom(x, y) {
    const pos = caretAt(x, y);
    hlFrom = onText(pos, x, y) ? pos : letterAt(x, y);
    return !!hlFrom;
  }

  // Where the drag has got to: the nearest place in the text (between lines or past a line's end too);
  // with something over the text there, the letter under it.
  function caretNear(x, y) {
    const pos = caretAt(x, y);
    if (pos && pos.node && pos.node.nodeType === Node.TEXT_NODE) return pos;
    return letterAt(x, y) || pos;
  }

  function highlightTo(x, y) {
    if (!hlFrom) return [];
    const to = caretNear(x, y);
    if (!to) return null;
    const range = document.createRange();
    try {
      range.setStart(hlFrom.node, hlFrom.offset);
      range.setEnd(hlFrom.node, hlFrom.offset);
      if (range.comparePoint(to.node, to.offset) < 0) range.setStart(to.node, to.offset);
      else range.setEnd(to.node, to.offset);
    } catch {
      return null;
    }
    // The text in it (not the boxes of the elements it spans), one band per line.
    const k = ui ? ui.scale : 1;
    const parts = [];
    const root = range.commonAncestorContainer.nodeType === Node.TEXT_NODE ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const piece = document.createRange();
    let n = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer : walker.nextNode();
    if (n && n.nodeType === Node.TEXT_NODE) walker.currentNode = n;
    for (let count = 0; n && count < 3000; n = walker.nextNode(), count++) {
      if (!range.intersectsNode(n)) {
        if (range.comparePoint(n, 0) > 0) break; // past the end
        continue;
      }
      if (!n.data.trim()) continue;
      piece.selectNodeContents(n);
      if (n === range.startContainer) piece.setStart(n, range.startOffset);
      if (n === range.endContainer) piece.setEnd(n, range.endOffset);
      for (const q of piece.getClientRects()) if (q.width > 0.5 && q.height > 0.5) parts.push({ x: q.left / k, y: q.top / k, w: q.width / k, h: q.height / k });
    }
    parts.sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for (const q of parts) {
      const line = lines.find((l) => Math.min(l.y + l.h, q.y + q.h) - Math.max(l.y, q.y) > 0.5 * Math.min(l.h, q.h));
      if (!line) {
        lines.push({ ...q });
        continue;
      }
      const x1 = Math.min(line.x, q.x);
      const y1 = Math.min(line.y, q.y);
      line.w = Math.max(line.x + line.w, q.x + q.w) - x1;
      line.h = Math.max(line.y + line.h, q.y + q.h) - y1;
      line.x = x1;
      line.y = y1;
    }
    return lines.slice(0, 300);
  }

  /* ---------- the source link ---------- */

  // The page's link, cleaned for a public picture (cleanurl.js, injected just before this script): logins,
  // tracking tags, secrets and email addresses go. Whatever is after # stays only when it's a quote, an
  // app's own page (#/…), or an anchor on this very page.
  function cleanUrl(href) {
    const same = location.href.split('#')[0] === String(href).split('#')[0];
    return globalThis.annotatedCleanUrl(href, { isAnchor: (id) => same && !!document.getElementById(id) });
  }

  function mainVideoIn(rect) {
    let best = null;
    let bestA = 0;
    for (const v of deepAll('video')) {
      const a = overlap(rectOf(v), rect);
      if (a > bestA) {
        bestA = a;
        best = v;
      }
    }
    return best;
  }

  function bestSource(rect, opts = {}) {
    const href = location.href;
    let u;
    try {
      u = new URL(href);
    } catch {
      return { url: href };
    }
    const host = u.hostname.replace(/^(www|mobile|m)\./, '');
    rect = rect || { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };

    if (host === 'x.com' || host === 'twitter.com') {
      let best = null;
      let bestA = 0;
      for (const p of document.querySelectorAll('article[data-testid="tweet"], article[role="article"]')) {
        const a = overlap(rectOf(p), rect);
        if (a > bestA) {
          bestA = a;
          best = p;
        }
      }
      const fromLink = (a) => {
        try {
          const m = new URL(a.href, href).pathname.match(/^\/([^/]+)\/status\/(\d+)/);
          return m ? `https://x.com/${m[1]}/status/${m[2]}` : null;
        } catch {
          return null;
        }
      };
      if (best) {
        const links = [...best.querySelectorAll('a[href*="/status/"]')];
        const timeLink = links.find((a) => a.querySelector('time'));
        const url = (timeLink && fromLink(timeLink)) || (links[0] && fromLink(links[0]));
        if (url) return { url };
      }
      const m = u.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
      if (m) return { url: `https://x.com/${m[1]}/status/${m[2]}` };
      return { url: cleanUrl(href) };
    }

    if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtu.be') {
      let id = host === 'youtu.be' ? u.pathname.slice(1).split('/')[0] : u.searchParams.get('v');
      if (id && !/^[\w-]{6,20}$/.test(id)) id = null; // (a video's id only: nothing else rides along)
      const shorts = u.pathname.match(/^\/shorts\/([\w-]{6,})/);
      if (id || shorts) {
        let url = id ? `https://www.youtube.com/watch?v=${id}` : `https://www.youtube.com/shorts/${shorts[1]}`;
        if (id) {
          let t = opts.time;
          if (t == null && !opts.frozen) {
            const v = mainVideoIn(rect);
            if (v && v.currentTime > 1) t = v.currentTime;
          }
          if (t != null && t >= 1) url += `&t=${Math.floor(t)}s`;
        }
        return { url };
      }
      return { url: cleanUrl(href) };
    }

    return { url: cleanUrl(href) };
  }
})();

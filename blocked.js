// Explains why Annotated.com can't run on the current page (shown under the toolbar icon).
const q = new URLSearchParams(location.search);
const why = q.get('why');
const tabId = Number(q.get('tab'));
const msg = document.getElementById('msg');
const act = document.getElementById('act');
const detail = document.getElementById('detail');
if (q.get('win')) document.body.classList.add('win');

const text = {
  browser:
    "Chrome doesn't let extensions work on its own pages (like the New Tab page, Settings or chrome://extensions). Open any website, such as youtube.com or x.com, and click the icon again.",
  store: "The Chrome Web Store doesn't allow any extension to run on its pages. Open another website and click the icon again.",
  file: "To snip files opened from your computer, allow it first: open this extension's settings and turn on \"Allow access to file URLs\".",
  script: "Chrome didn't let Annotated.com run on this page. Try reloading the page, or open another website.",
};
msg.textContent = text[why] || text.script;
if (why === 'script' && q.get('detail')) {
  detail.textContent = q.get('detail');
  detail.hidden = false;
}
if (why === 'file') {
  act.textContent = 'Open extension settings';
  act.hidden = false;
  act.onclick = () => chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });
}
// Show this message only once: the next click on a normal page should start a snip again.
if (Number.isFinite(tabId)) chrome.action.setPopup({ tabId, popup: '' }).catch(() => {});

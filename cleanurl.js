// Annotated.com: the source link, made safe for a public picture and the chat. Used by the page script
// (content.js, injected just before it) and by the bar (ui.js imports it), so the link the bar shows
// while it waits for the page is cleaned the same way. A plain script: it only sets
// globalThis.annotatedCleanUrl(href, { isAnchor }) and returns '' when there's no public source.
(() => {
  const TRACKING = /^(utm_[a-z_]+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|yclid|ttclid|twclid|igshid|igsh|mc_cid|mc_eid|_ga|_gl|mkt_tok|spm|vero_id|oly_anon_id|oly_enc_id|rb_clickid|trk|trkCampaign|sc_campaign|hsCtaTracking|__hssc|__hstc|__hsfp|_hsenc|_hsmi|hsa_[a-z]+|ck_subscriber_id|ml_subscriber|ml_subscriber_hash|elqTrackId|elqTrack|ref_src|ref_url|cmpid|ncid|sr_share|share_id|si)$/i;

  // Secrets in an address (it ends up in a public picture and the chat): any parameter whose name has
  // one of these words in it (reset_password_token, oauth_token, key, code + state, rlkey, jwt...), and
  // any value that looks like a key or a login token, whatever its name.
  const SECRET_WORDS = new Set(['token', 'tokens', 'secret', 'password', 'passwd', 'pwd', 'pass', 'passcode', 'pin', 'auth', 'authorization', 'oauth', 'session', 'sessionid', 'sid', 'sig', 'signature', 'key', 'apikey', 'rlkey', 'code', 'ticket', 'jwt', 'otp', 'nonce', 'verifier', 'state', 'credential', 'credentials', 'private', 'access', 'refresh', 'saml', 'assertion', 'magic', 'invite', 'confirmation', 'reset']);
  // (Also run together, as many sites write them: accesstoken, PHPSESSID, JSESSIONID, CFTOKEN, csrf,
  // resourcekey, authkey...)
  const SECRET_PARTS = /token|secret|passw|sessid|sessionid|apikey|csrf|xsrf|credential/;
  const SECRET_FLAT = /^(cfid|zenid|oscsid|resourcekey|authkey|accesskey|secretkey|privatekey|sharekey|appkey|sessionkey|signkey|signingkey|licensekey|encryptionkey|decryptionkey)$/;
  function secretName(name) {
    const words = String(name)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/);
    if (words.some((w) => SECRET_WORDS.has(w)) || /^x-(amz|goog)-/i.test(name)) return true;
    const flat = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
    return SECRET_PARTS.test(flat) || SECRET_FLAT.test(flat);
  }
  // Words someone typed (a search, a file's path): three or more parts, most of them plain words or
  // numbers ("best+laptop+for+2024", "/src/app/v2/Form.tsx"), unlike a key's random run of characters.
  function looksLikeText(v) {
    const parts = String(v).split(/[+\s/._~-]+/).filter(Boolean);
    if (parts.length < 3) return false;
    const wordy = parts.filter((p) => p.length <= 24 && (/^[a-z]+$/i.test(p) || /^\d+$/.test(p))).length;
    return wordy >= parts.length * 0.6;
  }
  // A wallet or contract address on a public block explorer (0x and 40 hex digits): public, not a key.
  const ADDRESS = /^0x[0-9a-f]{40}$/i;
  function secretValue(v) {
    if (/^eyJ[\w-]{6,}\.[\w-]+\.[\w-]*$/.test(v)) return true; // a JWT
    if (ADDRESS.test(v) || looksLikeText(v)) return false;
    return v.length >= 40 && /^[\w\-.~+/=]+$/.test(v) && /\d/.test(v) && /[a-z]/i.test(v); // a long key
  }
  // Free text a person typed (a search box's words): never taken for a key, however long it is.
  const TEXT_NAMES = /^(q|query|search|search_query|searchterm|searchterms|keyword|keywords|text|term|terms|wd)$/i;
  // An email address: never in a public link (?email=…, ?authuser=…, a path like /users/jane@…).
  const EMAIL = /[^\s@/?#&=;:]+@[^\s@/?#&=;:]+\.[a-z]{2,}/i;
  // ...but not someone's public handle on another server (/@jane@mastodon.social) or a picture made for
  // sharp screens (logo@2x.png).
  const emailIn = (seg) => !seg.startsWith('@') && !/@\d+(\.\d+)?x\.[a-z0-9]+$/i.test(seg) && EMAIL.test(seg);
  // A part of the path right after one of these words (or one more part along: /reset/<user>/<code>/) is a
  // one-time code (/reset-password/9f86…, /invite/AbC123…, /team_invite/redeem/…); whole words only (an
  // /author/ isn't /auth/), and never words with dashes between them (/login/how-to-fix-error-404) or an
  // address on a block explorer (/token/0x…).
  const CODE_BEFORE = new Set(['reset', 'password', 'passwd', 'verify', 'verification', 'confirm', 'confirmation', 'activate', 'activation', 'invite', 'invitation', 'magic', 'token', 'unsubscribe', 'login', 'signin', 'auth', 'oauth', 'sso', 'otp', 'redeem', 'accept']);
  function codeWord(seg) {
    return String(seg)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .some((w) => CODE_BEFORE.has(w));
  }
  const raw = (x) => {
    try {
      return decodeURIComponent(x);
    } catch {
      return x;
    }
  };
  const dec = (x) => raw(String(x).replace(/\+/g, ' '));
  const MAX = 2048; // (the longest link the chat takes)

  // The path from an email address, a JWT or a one-time code in it onwards goes.
  function cleanPath(path) {
    const segs = path.split('/');
    for (let i = 1; i < segs.length; i++) {
      const seg = raw(segs[i]);
      const code =
        seg.length >= 16 &&
        /^[\w\-.~+=]+$/.test(seg) &&
        /\d/.test(seg) &&
        /[a-z]/i.test(seg) &&
        !ADDRESS.test(seg) &&
        !looksLikeText(seg) &&
        (codeWord(raw(segs[i - 1])) || (i >= 2 && codeWord(raw(segs[i - 2]))));
      if (emailIn(seg) || /^eyJ[\w-]{6,}\.[\w-]+\.[\w-]*$/.test(seg) || code) return segs.slice(0, i).join('/') + '/';
    }
    return path;
  }
  // The parameters kept stay exactly as they were written.
  function cleanQuery(search, host) {
    const kept = search
      .slice(1)
      .split('&')
      .filter((pair) => {
        if (!pair) return false;
        const eq = pair.indexOf('=');
        const name = dec(eq < 0 ? pair : pair.slice(0, eq));
        const value = eq < 0 ? '' : dec(pair.slice(eq + 1));
        const rawValue = eq < 0 ? '' : raw(pair.slice(eq + 1)); // (a key with + in it: as written)
        if (TRACKING.test(name) || secretName(name) || EMAIL.test(name) || EMAIL.test(value)) return false;
        if (name === 'p' && /(^|\.)teams\.(microsoft|live)\.com$/.test(host)) return false; // (a meeting's passcode)
        if (TEXT_NAMES.test(name)) return true;
        return !(secretValue(value) || secretValue(rawValue));
      });
    return kept.length ? '?' + kept.join('&') : '';
  }

  function cleanUrl(href, { isAnchor = () => false } = {}) {
    let u;
    try {
      u = new URL(href);
    } catch {
      return '';
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return ''; // (a file on your computer has no public source)
    // The link ends up in a public image: drop logins, tracking tags and secrets.
    u.username = '';
    u.password = '';
    // A login kept in the path itself (/page;jsessionid=…) goes too.
    if (u.pathname.includes(';')) u.pathname = u.pathname.replace(/;([^/;=]*)=([^/;]*)/g, (all, n, v) => (secretName(dec(n)) || secretValue(dec(v)) ? '' : all));
    u.pathname = cleanPath(u.pathname);
    u.search = cleanQuery(u.search, u.hostname);
    // After #: a highlighted quote (#:~:text=…), a real anchor on this page, or an app's own page
    // (#/docs/start, #!/item/12), cleaned like the path, stays; anything else goes (some sites keep keys
    // there: #access_token=…, file-sharing links' decryption keys).
    const h = u.hash;
    if (h && emailIn(raw(h).slice(1))) u.hash = '';
    else if (/^#!?\//.test(h)) {
      const bang = h.startsWith('#!') ? '!' : '';
      try {
        const r = new URL(h.slice(1 + bang.length), 'https://route.invalid');
        u.hash = bang + cleanPath(r.pathname) + cleanQuery(r.search, u.hostname);
      } catch {
        u.hash = '';
      }
    } else if (h && !h.startsWith('#:~:')) {
      let anchor = false;
      try {
        const id = decodeURIComponent(h.slice(1));
        anchor = id.length <= 80 && !!isAnchor(id);
      } catch {}
      if (!anchor) u.hash = '';
    }
    const tidy = (s) => (s.endsWith('?') || s.endsWith('#') ? tidy(s.slice(0, -1)) : s);
    let out = tidy(u.toString());
    // Too long for the chat (a dashboard's whole state in its link): the page itself, then just the site,
    // so the picture, its file and the chat all carry the same link.
    if (out.length > MAX) {
      u.hash = '';
      out = tidy(u.toString());
    }
    if (out.length > MAX) {
      u.search = '';
      out = tidy(u.toString());
    }
    if (out.length > MAX) out = u.origin + '/';
    return out;
  }

  globalThis.annotatedCleanUrl = cleanUrl;
})();

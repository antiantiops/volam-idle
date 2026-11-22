'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROUTE_PATH = '/admin/tao-tai-khoan';
const DEFAULT_SECRET_PATH = '/run/secrets/volam-admin-proxy';

function parseAdminConfig(config = {}) {
  const emailRaw = config.allowedEmail !== undefined ? config.allowedEmail : process.env.VL_ADMIN_EMAIL;
  const originRaw = config.allowedOrigin !== undefined ? config.allowedOrigin : process.env.VL_ADMIN_ORIGIN;
  const email = typeof emailRaw === 'string' ? emailRaw.trim() : '';
  const originInput = typeof originRaw === 'string' ? originRaw.trim() : '';
  if (!email || !originInput) return null;
  let originUrl;
  try {
    originUrl = new URL(originInput);
  } catch {
    return null;
  }
  if (originUrl.protocol !== 'https:' || originUrl.origin !== originInput) return null;
  return { allowedEmail: email, allowedOrigin: originUrl.origin };
}
const MAX_USERINFO_BYTES = 4096;
const MAX_BODY_BYTES = 4096;
const MAX_LEVEL = 200;
const MAX_XU_GRANT = 1000000;
const MAX_XU_BALANCE = 2147483647;
const XU_TOKEN_TTL_MS = 15 * 60 * 1000;
const MAX_XU_TOKENS = 1024;
const DN_SLOT_SENTINEL = -1;
const DN_EXPECTED_KS = ['hk:148', 'hk:149', 'hk:150', 'hk:151', 'hk:152', 'hk:153'];
const DN_SET_CHOICE = 'set:dinhNghiep';
const HK_KEY_RE = /^hk:\d+$/;
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const INT_RE = /^\d+$/;
const PIN6_RE = /^\d{6}$/;
const XU_TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;

const MENU_ITEMS = [
  { id: 'tao', label: 'Tạo tài khoản' },
  { id: 'cap', label: 'Tăng cấp' },
  { id: 'xu', label: 'Cộng Xu' },
  { id: 'hoang-kim', label: 'Cấp Hoàng Kim' },
];
const DEFAULT_MUC = 'tao';
const ALLOWED_MUC = new Set(MENU_ITEMS.map((m) => m.id));
const VIEW_TITLES = {
  tao: 'Tạo tài khoản Võ Lâm',
  cap: 'Tăng cấp nhân vật Võ Lâm',
  xu: 'Cộng Xu nhân vật Võ Lâm',
  'hoang-kim': 'Cấp Hoàng Kim Võ Lâm',
};

function parseActiveMuc(reqUrl) {
  if (typeof reqUrl !== 'string') return DEFAULT_MUC;
  const qIdx = reqUrl.indexOf('?');
  if (qIdx < 0) return DEFAULT_MUC;
  const muc = new URLSearchParams(reqUrl.slice(qIdx + 1)).get('muc');
  return muc && ALLOWED_MUC.has(muc) ? muc : DEFAULT_MUC;
}

const ADMIN_CSS =
  ':root{color-scheme:dark;--bg:#0b111a;--panel:#131d2c;--card:#0f1724;--box:#0c131e;--line:#25364e;--line-strong:#354c6b;--text:#eef2f7;--muted:#a8b8cd;--jade:#176652;--jade-hi:#1f7e66;--jade-line:#2e9a7e;--gold:#d4a84f;--gold-hi:#e2bb67;--gold-ink:#0b111a;--err-bg:#2a1318;--err-line:#cf565f;--err-text:#ffd8dc;--ok-bg:#102922;--ok-line:#2ea080;--ok-text:#cef6e8}' +
  '*,*::before,*::after{box-sizing:border-box}' +
  'html,body{margin:0;padding:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.5;overflow-x:hidden}' +
  'body{padding:.75rem}' +
  '.shell{max-width:1120px;margin:0 auto;display:grid;gap:.875rem}' +
  '.brand-header{background:linear-gradient(135deg,#131d2c 0%,#0f1826 70%,#172438 100%);border:1px solid var(--line);border-top:3px solid var(--gold);border-radius:12px;padding:.9rem 1rem}' +
  '.brand-kicker{margin:0 0 .2rem;font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:var(--gold);font-weight:700}' +
  '.brand-title{margin:0;font-size:1.25rem;line-height:1.25;color:var(--text)}' +
  '.brand-sub{margin:.25rem 0 0;font-size:.875rem;color:var(--muted)}' +
  '.portal-layout{display:grid;grid-template-columns:minmax(0,1fr);gap:.875rem;align-items:start}' +
  '.portal-nav{min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:.55rem}' +
  '.nav-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.45rem}' +
  '.nav-link{display:flex;align-items:center;justify-content:center;text-align:center;min-height:44px;padding:.5rem .7rem;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--muted);text-decoration:none;font-size:.875rem;font-weight:700;line-height:1.25}' +
  '.nav-link:hover{border-color:var(--line-strong);color:var(--text);background:#152132}' +
  '.nav-link[aria-current="page"]{background:#142824;border-color:var(--jade-line);color:#fff;box-shadow:inset 0 0 0 1px rgba(46,154,126,.35)}' +
  '.portal-content{min-width:0;display:grid;gap:.875rem}' +
  '.banner{margin:0;padding:.8rem .95rem;border-radius:10px;border:1px solid transparent;font-size:.9375rem;overflow-wrap:anywhere}' +
  '.banner-error{background:var(--err-bg);border-color:var(--err-line);color:var(--err-text)}' +
  '.banner-ok{background:var(--ok-bg);border-color:var(--ok-line);color:var(--ok-text)}' +
  '.banner-actions{margin:.55rem 0 0;display:flex;flex-wrap:wrap;gap:.5rem}' +
  '.banner-link{display:inline-flex;align-items:center;min-height:38px;padding:.35rem .75rem;border-radius:8px;border:1px solid var(--err-line);background:#1b1116;color:#fff;text-decoration:none;font-size:.875rem;font-weight:700}' +
  '.panel{min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:.9rem;display:grid;gap:.85rem}' +
  '.panel-head{display:grid;gap:.25rem;padding-bottom:.65rem;border-bottom:1px solid var(--line)}' +
  '.panel-head h2{margin:0;font-size:1.1rem;color:var(--text)}' +
  '.panel-head p{margin:0;font-size:.875rem;color:var(--muted)}' +
  '.form-stack{display:grid;gap:.75rem;min-width:0}' +
  '.field{display:grid;gap:.3rem;min-width:0}' +
  'label{font-size:.875rem;font-weight:600;color:var(--text)}' +
  'small{font-size:.8rem;color:var(--muted);overflow-wrap:anywhere}' +
  'input,select,button{font:inherit;min-height:44px;border-radius:8px;max-width:100%;width:100%}' +
  'input,select{background:#090f18;color:var(--text);border:1px solid var(--line-strong);padding:.55rem .7rem;font-size:1rem}' +
  'button{cursor:pointer;font-weight:700;border:1px solid transparent;padding:.6rem .95rem;font-size:.9375rem}' +
  '.btn-jade{background:var(--jade);border-color:var(--jade-line);color:#fff}' +
  '.btn-jade:hover{background:var(--jade-hi)}' +
  '.btn-gold{background:var(--gold);border-color:var(--gold-hi);color:var(--gold-ink)}' +
  '.btn-gold:hover{background:var(--gold-hi)}' +
  'a:focus-visible,input:focus-visible,select:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--gold-hi);outline-offset:2px}' +
  '.lookup-form{display:grid;gap:.75rem;min-width:0}' +
  '.char-list{display:grid;gap:.85rem;min-width:0}' +
  '.char-card{min-width:0;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:.85rem;display:grid;gap:.75rem}' +
  '.char-head{display:grid;gap:.4rem;min-width:0}' +
  '.char-title-row{display:flex;flex-wrap:wrap;align-items:center;gap:.45rem;min-width:0}' +
  '.slot-badge{display:inline-flex;align-items:center;padding:.15rem .5rem;border-radius:999px;background:#19273b;border:1px solid var(--line-strong);color:var(--gold-hi);font-size:.75rem;font-weight:700;white-space:nowrap}' +
  '.char-title{margin:0;font-size:1rem;color:var(--text);overflow-wrap:anywhere}' +
  '.char-meta{font-weight:500;color:var(--muted)}' +
  '.xu-badge{display:inline-flex;align-items:center;gap:.35rem;width:fit-content;max-width:100%;padding:.25rem .6rem;border-radius:8px;background:#161b12;border:1px solid #6b5627;color:var(--gold-hi);font-size:.875rem;overflow-wrap:anywhere}' +
  '.char-actions{display:grid;grid-template-columns:minmax(0,1fr);gap:.75rem;min-width:0}' +
  '.action-box{min-width:0;background:var(--box);border:1px solid var(--line);border-radius:8px;padding:.25rem .7rem .7rem}' +
  '.action-box summary{min-height:44px;display:flex;align-items:center;gap:.5rem;cursor:pointer;font-weight:700;font-size:.9375rem;color:var(--text);list-style:none}' +
  '.action-box summary::-webkit-details-marker{display:none}' +
  '.action-box summary::after{content:"▾";margin-left:auto;color:var(--muted);font-size:.85rem}' +
  '.action-box[open]>summary::after{content:"▴"}' +
  '.action-level summary{color:#7cdcc2}' +
  '.action-xu summary{color:var(--gold-hi)}' +
  '.panel-dn{border-color:#5b4a24}' +
  '.dn-note{margin:0;font-size:.875rem;color:var(--muted)}' +
  '.action-form{display:grid;gap:.65rem;padding-top:.4rem;min-width:0}' +
  '.max-note{margin:.35rem 0 0;font-size:.875rem;color:var(--muted)}' +
  '.empty-note{margin:0;padding:.8rem;border-radius:8px;background:var(--card);border:1px dashed var(--line-strong);color:var(--muted);font-size:.9rem}' +
  '@media (min-width:600px){body{padding:1.25rem}.nav-list{grid-template-columns:repeat(4,minmax(0,1fr))}.panel{padding:1.15rem}.lookup-form{grid-template-columns:minmax(0,1fr) auto;align-items:end}.lookup-form .btn-jade{width:auto;min-width:140px}}' +
  '@media (min-width:900px){.portal-layout{grid-template-columns:232px minmax(0,1fr);gap:1rem}.portal-nav{position:sticky;top:1rem;padding:.7rem}.nav-list{grid-template-columns:minmax(0,1fr);gap:.45rem}.nav-link{justify-content:flex-start;text-align:left;padding:.6rem .85rem}.nav-link[aria-current="page"]{border-left:3px solid var(--gold)}}';

const ADMIN_CSS_HASH = crypto.createHash('sha256').update(ADMIN_CSS, 'utf8').digest('base64');
const CSP_HEADER = `default-src 'none'; style-src 'sha256-${ADMIN_CSS_HASH}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`;

function formatViInt(n) {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ponytail: read proxy secret per request without caching; add TTL secret cache only if request rate requires it.
function readExpectedSecret(secretPath) {
  try {
    const secret = fs.readFileSync(secretPath, 'utf8').trim();
    return secret.length > 0 ? secret : null;
  } catch {
    return null;
  }
}

function parseVerifiedUserInfo(headerVal, allowedEmail) {
  if (typeof allowedEmail !== 'string' || allowedEmail.length === 0) {
    return null;
  }
  if (typeof headerVal !== 'string' || headerVal.length === 0 || headerVal.length > MAX_USERINFO_BYTES) {
    return null;
  }
  if (headerVal.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(headerVal)) {
    return null;
  }
  const decoded = Buffer.from(headerVal, 'base64');
  if (decoded.toString('base64') !== headerVal) {
    return null;
  }
  let info;
  try {
    info = JSON.parse(decoded.toString('utf8'));
  } catch {
    return null;
  }
  if (!info || typeof info !== 'object' || Array.isArray(info)) {
    return null;
  }
  if (info.email_verified !== true) return null;
  if (typeof info.sub !== 'string' || info.sub.trim().length === 0) return null;
  if (info.email !== allowedEmail) return null;
  return info.email;
}

function isUrlEncodedContentType(headerVal) {
  if (typeof headerVal !== 'string') return false;
  const firstSemi = headerVal.indexOf(';');
  const mediaType = (firstSemi < 0 ? headerVal : headerVal.slice(0, firstSemi)).trim().toLowerCase();
  if (mediaType !== 'application/x-www-form-urlencoded') return false;
  if (firstSemi < 0) return true;

  // RFC 9110 MIME parameter syntax (token=token | token="quoted-string"): allow charset=utf-8 / "utf-8", reject non-UTF-8 or malformed params.
  let rest = headerVal.slice(firstSemi + 1);
  let seenCharset = false;
  while (rest.length > 0) {
    const match = rest.match(/^[ \t]*([!#$%&'*+\-.^_`|~0-9A-Za-z]+)[ \t]*=[ \t]*(?:"((?:[^"\\\r\n]|\\.)*)"|([!#$%&'*+\-.^_`|~0-9A-Za-z]+))[ \t]*(?:;(.*))?$/);
    if (!match) {
      if (/^[ \t]*(?:;|$)/.test(rest)) {
        const nextSemi = rest.indexOf(';');
        if (nextSemi < 0) break;
        rest = rest.slice(nextSemi + 1);
        continue;
      }
      return false;
    }
    const name = match[1].toLowerCase();
    const rawVal = match[2] !== undefined ? match[2].replace(/\\(.)/g, '$1') : match[3];
    if (name !== 'charset' || seenCharset) return false;
    if (rawVal.toLowerCase() !== 'utf-8') return false;
    seenCharset = true;
    if (match[4] === undefined) break;
    rest = match[4];
  }
  return true;
}

function readBoundedBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const contentLength = req.headers['content-length'];
    if (contentLength !== undefined) {
      if (typeof contentLength !== 'string' || !/^\d+$/.test(contentLength)) {
        const err = new Error('Invalid Content-Length');
        err.statusCode = 400;
        reject(err);
        return;
      }
      if (Number(contentLength) > maxBytes) {
        const err = new Error('Payload too large');
        err.statusCode = 413;
        reject(err);
        return;
      }
    }

    const chunks = [];
    let total = 0;
    let settled = false;

    req.on('data', (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        settled = true;
        const err = new Error('Payload too large');
        err.statusCode = 413;
        req.destroy();
        reject(err);
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });

    req.on('close', () => {
      if (settled) return;
      if (!req.complete) {
        settled = true;
        const err = new Error('Request aborted');
        err.statusCode = 400;
        reject(err);
      }
    });
  });
}

function checkFormKeys(params, allowedKeys) {
  const allowed = new Set(allowedKeys);
  for (const key of params.keys()) {
    if (!allowed.has(key)) return 'Dữ liệu biểu mẫu chứa trường không hợp lệ.';
    if (params.getAll(key).length > 1) return 'Dữ liệu biểu mẫu có trường bị trùng lặp.';
  }
  return null;
}

function validateFormBody(params) {
  const keyErr = checkFormKeys(params, ['ten', 'mk', 'chu']);
  if (keyErr) return { error: keyErr };

  const ten = params.get('ten') ?? '';
  const mk = params.get('mk') ?? '';
  const chu = (params.get('chu') ?? '').trim();

  if (!USERNAME_RE.test(ten)) {
    return {
      error: 'Tên tài khoản phải dài 3–20 ký tự, chỉ gồm chữ thường (a-z), số (0-9) và dấu gạch dưới (_).',
      ten,
      chu,
    };
  }
  if (mk.length < 12 || mk.length > 128 || CONTROL_CHAR_RE.test(mk)) {
    return {
      error: 'Mật khẩu tạm phải dài 12–128 ký tự và không chứa ký tự điều khiển.',
      ten,
      chu,
    };
  }
  if (chu.length > 40 || CONTROL_CHAR_RE.test(chu)) {
    return {
      error: 'Tên chủ sở hữu tối đa 40 ký tự hợp lệ.',
      ten,
      chu,
    };
  }

  return { ten, mk, chu };
}

function sendHtml(res, statusCode, title, bodyHtml, extraHeaders) {
  const headers = Object.assign(
    {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
      'Content-Security-Policy': CSP_HEADER,
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    },
    extraHeaders || {}
  );

  const html =
    '<!DOCTYPE html>\n' +
    '<html lang="vi">\n' +
    '<head>\n' +
    '  <meta charset="utf-8">\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    `  <title>${escapeHtml(title)}</title>\n` +
    `  <style>${ADMIN_CSS}</style>\n` +
    '</head>\n' +
    '<body>\n' +
    '  <main class="shell">\n' +
    `    ${bodyHtml}\n` +
    '  </main>\n' +
    '</body>\n' +
    '</html>\n';

  res.writeHead(statusCode, headers);
  res.end(html);
}

function getGameAdmin(API, req) {
  const admin = API && typeof API.tkPhien === 'function' ? API.tkPhien(req) : null;
  if (!admin || typeof admin !== 'object' || !admin.ten || !admin.admin || admin.batDoiMk) {
    return null;
  }
  return admin;
}

function getCookieValue(cookieHeader, name) {
  if (typeof cookieHeader !== 'string' || !cookieHeader) return '';
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return '';
}

function getAdminSessionHash(admin, req) {
  const rawPhien = admin && admin.phien != null
    ? String(admin.phien)
    : getCookieValue(req && req.headers && req.headers.cookie, 'phien');
  return crypto.createHash('sha256')
    .update(String(admin.ten))
    .update('\0')
    .update(rawPhien)
    .digest('hex');
}

function getOrdinaryAccountNames(D) {
  const list = D && typeof D.dsTk === 'function' ? D.dsTk() : [];
  if (!Array.isArray(list)) return [];
  const names = new Set();
  for (const t of list) {
    if (!t || typeof t !== 'object' || t.admin) continue;
    if (typeof t.ten !== 'string' || t.ten.trim().length === 0 || CONTROL_CHAR_RE.test(t.ten)) continue;
    names.add(t.ten);
  }
  return Array.from(names).sort();
}

function readOwnAdminChars(D, admin) {
  if (!admin || !admin.ten || !admin.admin || admin.batDoiMk || !D || typeof D.docTk !== 'function') {
    return null;
  }
  const tk = D.docTk(admin.ten);
  if (!tk || typeof tk !== 'object' || !tk.admin) return null;
  const slotN = Number.isInteger(D.SLOT_N) && D.SLOT_N > 0 ? D.SLOT_N : 3;
  const chars = [];
  for (let o = 0; o < slotN; o += 1) {
    const s = Array.isArray(tk.nv) ? tk.nv[o] : null;
    if (!s || typeof s !== 'object' || typeof s.name !== 'string' || !s.name.trim()) continue;
    const lvl = s.lvl == null ? 1 : s.lvl;
    const validLvl = Number.isInteger(lvl) && lvl >= 1 ? lvl : null;
    chars.push({ o, name: s.name, lvl: validLvl });
  }
  return { slotN, chars };
}

function readHoangKimItems(hkData) {
  const rawItems = hkData && (Array.isArray(hkData.items) ? hkData.items : (hkData.items && typeof hkData.items === 'object' ? Object.values(hkData.items) : null));
  if (!Array.isArray(rawItems)) return null;
  const items = [];
  const seen = new Set();
  for (const m of rawItems) {
    if (!m || typeof m !== 'object') return null;
    if (typeof m.k !== 'string' || !HK_KEY_RE.test(m.k) || seen.has(m.k)) return null;
    if (!Number.isInteger(m.s) || m.s < 0 || m.s > 4) return null;
    const rawName = typeof m.n === 'string' && m.n.trim() ? m.n.trim() : (typeof m.name === 'string' && m.name.trim() ? m.name.trim() : m.k);
    if (CONTROL_CHAR_RE.test(rawName)) return null;
    seen.add(m.k);
    items.push({ k: m.k, name: rawName, s: m.s, bo: m.bo });
  }
  return items;
}

function buildDinhNghiepMon(hkData) {
  const items = readHoangKimItems(hkData);
  if (!items) return null;
  const byKey = new Map();
  for (const m of items) {
    if (m.bo !== 'dinhNghiep') continue;
    byKey.set(m.k, { k: m.k, he: m.s, dong: 0 });
  }
  if (byKey.size !== DN_EXPECTED_KS.length) return null;
  const mon = [];
  for (const k of DN_EXPECTED_KS) {
    if (!byKey.has(k)) return null;
    mon.push(byKey.get(k));
  }
  return mon;
}

function buildSingleHoangKimMon(hkData, itemKey) {
  if (typeof itemKey !== 'string' || !HK_KEY_RE.test(itemKey)) return { error: 'Mã trang bị Hoàng Kim không hợp lệ.' };
  const items = readHoangKimItems(hkData);
  if (!items) return { unavailable: true };
  const found = items.find((m) => m.k === itemKey);
  if (!found) return { error: 'Trang bị Hoàng Kim được chọn không tồn tại trong danh mục máy chủ.' };
  return { item: found, mon: [{ k: found.k, he: found.s, dong: 0 }] };
}

function listHoangKimCatalogOptions(loadHoangKim) {
  try {
    const items = readHoangKimItems(typeof loadHoangKim === 'function' ? loadHoangKim() : null);
    if (!items) return [];
    return items.map((m) => ({ k: m.k, name: m.name }));
  } catch {
    return [];
  }
}

function renderPlayerCharCards({ mode, lookupTen, chars, issueXuToken }) {
  if (!Array.isArray(chars) || chars.length === 0) return '';
  const formAction = `${ROUTE_PATH}?muc=${mode}`;
  return '<div class="char-list">\n' +
    chars.map((c) => {
      let actionBox;
      if (mode === 'cap') {
        actionBox = c.lvl < MAX_LEVEL
          ? '          <details open class="action-box action-level">\n' +
            '            <summary>Tăng cấp nhân vật</summary>\n' +
            `            <form class="action-form" method="post" action="${formAction}" enctype="application/x-www-form-urlencoded">\n` +
            `              <input type="hidden" name="action" value="cap"><input type="hidden" name="ten" value="${escapeHtml(lookupTen)}"><input type="hidden" name="o" value="${c.o}"><input type="hidden" name="tenNv" value="${escapeHtml(c.name)}"><input type="hidden" name="lvHienTai" value="${c.lvl}">\n` +
            `              <div class="field"><label for="lv-${c.o}">Cấp mới (${c.lvl + 1}–${MAX_LEVEL})</label><input id="lv-${c.o}" name="lv" type="number" required min="${c.lvl + 1}" max="${MAX_LEVEL}" value="${c.lvl + 1}"></div>\n` +
            `              <div class="field"><label for="mk2-${c.o}">Mã khóa 2 (6 chữ số)</label><input id="mk2-${c.o}" name="mk2" type="password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" required autocomplete="off"></div>\n` +
            '              <button class="btn-jade" type="submit">Tăng cấp</button>\n' +
            '            </form>\n' +
            '          </details>'
          : '          <details open class="action-box action-level">\n' +
            '            <summary>Tăng cấp nhân vật</summary>\n' +
            `            <p class="max-note">Đã đạt cấp tối đa (${MAX_LEVEL}).</p>\n` +
            '          </details>';
      } else {
        const xuToken = typeof issueXuToken === 'function' ? issueXuToken(c.o) : '';
        actionBox =
          '          <details open class="action-box action-xu">\n' +
          '            <summary>Cộng Xu</summary>\n' +
          `            <form class="action-form" method="post" action="${formAction}" enctype="application/x-www-form-urlencoded">\n` +
          `              <input type="hidden" name="action" value="xu"><input type="hidden" name="ten" value="${escapeHtml(lookupTen)}"><input type="hidden" name="o" value="${c.o}"><input type="hidden" name="tenNv" value="${escapeHtml(c.name)}"><input type="hidden" name="xuHienTai" value="${c.xu}"><input type="hidden" name="xuToken" value="${escapeHtml(xuToken)}">\n` +
          `              <div class="field"><label for="xu-${c.o}">Số Xu cộng (1–1.000.000)</label><input id="xu-${c.o}" name="xu" type="number" inputmode="numeric" required min="1" max="${MAX_XU_GRANT}" step="1" placeholder="Ví dụ: 500"></div>\n` +
          `              <div class="field"><label for="xu-mk2-${c.o}">Mã khóa 2 (6 chữ số)</label><input id="xu-mk2-${c.o}" name="mk2" type="password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" required autocomplete="off"></div>\n` +
          '              <button class="btn-gold" type="submit">Cộng Xu</button>\n' +
          '            </form>\n' +
          '          </details>';
      }

      return (
        '      <article class="char-card">\n' +
        '        <div class="char-head">\n' +
        '          <div class="char-title-row">\n' +
        `            <span class="slot-badge">Ô ${c.o + 1}</span>\n` +
        `            <h3 class="char-title"><strong>${escapeHtml(c.name)}</strong> <span class="char-meta">· Cấp ${c.lvl}</span></h3>\n` +
        '          </div>\n' +
        `          <div class="xu-badge">Xu hiện có: <strong>${formatViInt(c.xu)} Xu</strong></div>\n` +
        '        </div>\n' +
        '        <div class="char-actions">\n' +
        `${actionBox}\n` +
        '        </div>\n' +
        '      </article>'
      );
    }).join('\n') +
    '\n    </div>';
}

function renderPlayerLookupPanel({ mode, accountNames, lookupTen, chars, issueXuToken }) {
  const isCap = mode === 'cap';
  const headingId = isCap ? 'heading-cap' : 'heading-xu';
  const headingText = isCap ? 'Tăng cấp nhân vật' : 'Cộng Xu nhân vật';
  const descText = isCap
    ? 'Chọn tài khoản người chơi, tải nhân vật và tăng cấp (tối đa 200) bằng mã khóa 2.'
    : 'Chọn tài khoản người chơi, tải nhân vật và cộng Xu theo từng ô bằng mã khóa 2.';
  let body;
  if (Array.isArray(accountNames)) {
    const optionsHtml = accountNames
      .map((acc) => `<option value="${escapeHtml(acc)}"${acc === lookupTen ? ' selected' : ''}>${escapeHtml(acc)}</option>`)
      .join('');
    const placeholder = accountNames.length > 0 ? '-- Chọn tài khoản --' : '-- Chưa có tài khoản người chơi --';
    const charCards = renderPlayerCharCards({ mode, lookupTen, chars, issueXuToken });
    body =
      `    <form class="lookup-form" method="post" action="${ROUTE_PATH}?muc=${mode}" enctype="application/x-www-form-urlencoded">\n` +
      '      <input type="hidden" name="action" value="tim">\n' +
      `      <div class="field"><label for="lookup-ten">Tài khoản người chơi</label><select id="lookup-ten" name="ten" required><option value="">${placeholder}</option>${optionsHtml}</select></div>\n` +
      '      <button class="btn-jade" type="submit">Tải nhân vật</button>\n' +
      '    </form>' +
      (charCards ? `\n${charCards}` : '');
  } else {
    body =
      `    <p class="empty-note">Cần mở đăng nhập game trong cùng trình duyệt bằng tài khoản quản trị hợp lệ (và hoàn tất đổi mật khẩu nếu được yêu cầu) để xem danh sách tài khoản và ${isCap ? 'tăng cấp' : 'cộng Xu'} nhân vật.</p>`;
  }

  return (
    `      <section class="panel panel-player panel-${mode}" aria-labelledby="${headingId}">\n` +
    '        <div class="panel-head">\n' +
    `          <h2 id="${headingId}">${headingText}</h2>\n` +
    `          <p>${descText}</p>\n` +
    '        </div>\n' +
    `${body}\n` +
    '      </section>'
  );
}

function renderCreatePanel({ ten, chu }) {
  return (
    '      <section class="panel panel-create" aria-labelledby="heading-create">\n' +
    '        <div class="panel-head">\n' +
    '          <h2 id="heading-create">Tạo tài khoản game Võ Lâm</h2>\n' +
    '          <p>Chỉ tạo tài khoản người chơi thông thường và bắt buộc đổi mật khẩu ở lần đăng nhập đầu tiên.</p>\n' +
    '        </div>\n' +
    `        <form class="form-stack" method="post" action="${ROUTE_PATH}?muc=tao" enctype="application/x-www-form-urlencoded">\n` +
    '          <div class="field">\n' +
    '            <label for="ten">Tên tài khoản</label>\n' +
    `            <input id="ten" name="ten" type="text" required minlength="3" maxlength="20" pattern="[a-z0-9_]{3,20}" autocomplete="off" autocapitalize="none" spellcheck="false" aria-describedby="ten-help" value="${escapeHtml(ten)}">\n` +
    '            <small id="ten-help">3–20 ký tự, chỉ dùng chữ thường a-z, số 0-9 và gạch dưới (_).</small>\n' +
    '          </div>\n' +
    '          <div class="field">\n' +
    '            <label for="mk">Mật khẩu tạm</label>\n' +
    '            <input id="mk" name="mk" type="password" required minlength="12" maxlength="128" autocomplete="new-password" aria-describedby="mk-help">\n' +
    '            <small id="mk-help">12–128 ký tự. Không hiển thị lại sau khi gửi.</small>\n' +
    '          </div>\n' +
    '          <div class="field">\n' +
    '            <label for="chu">Chủ sở hữu (tùy chọn)</label>\n' +
    `            <input id="chu" name="chu" type="text" maxlength="40" autocomplete="off" aria-describedby="chu-help" value="${escapeHtml(chu)}">\n` +
    '            <small id="chu-help">Tối đa 40 ký tự.</small>\n' +
    '          </div>\n' +
    '          <button class="btn-jade" type="submit">Tạo tài khoản</button>\n' +
    '        </form>\n' +
    '      </section>'
  );
}

function renderHoangKimPanel({ adminTen, ownChars, dnToken, selectedDnSlot, hkOptions, selectedHkChoice }) {
  let dnSectionBody;
  if (Array.isArray(ownChars)) {
    if (ownChars.length > 0) {
      const slotOptions = ownChars
        .map((c) => {
          const label = c.lvl != null ? `Ô ${c.o + 1}: ${c.name} (Cấp ${c.lvl})` : `Ô ${c.o + 1}: ${c.name}`;
          const sel = String(c.o) === String(selectedDnSlot) ? ' selected' : '';
          return `<option value="${c.o}"${sel}>${escapeHtml(label)}</option>`;
        })
        .join('');
      const activeChoice = selectedHkChoice || DN_SET_CHOICE;
      const singleHkOptions = Array.isArray(hkOptions)
        ? hkOptions
            .map((item) => {
              const sel = item.k === activeChoice ? ' selected' : '';
              return `<option value="${escapeHtml(item.k)}"${sel}>${escapeHtml(`${item.name} (${item.k})`)}</option>`;
            })
            .join('')
        : '';
      const setSel = activeChoice === DN_SET_CHOICE ? ' selected' : '';
      const hkSelectGroup = singleHkOptions
        ? `<optgroup label="Trang bị Hoàng Kim (1 món)">${singleHkOptions}</optgroup>`
        : '';
      dnSectionBody =
        '        <p class="dn-note">Cấp trọn bộ Định Nghiệp (6 món) hoặc 1 trang bị Hoàng Kim từ danh mục máy chủ (không khóa) thẳng vào túi đồ nhân vật của chính tài khoản quản trị đang đăng nhập; hãy đảm bảo túi đồ còn đủ chỗ trống.</p>\n' +
        `        <form class="form-stack" method="post" action="${ROUTE_PATH}?muc=hoang-kim" enctype="application/x-www-form-urlencoded">\n` +
        `          <input type="hidden" name="action" value="dinh-nghiep"><input type="hidden" name="dnToken" value="${escapeHtml(dnToken)}">\n` +
        `          <div class="field"><label for="dn-slot">Nhân vật của bạn (${escapeHtml(adminTen)})</label><select id="dn-slot" name="o" required><option value="">-- Chọn nhân vật --</option>${slotOptions}</select></div>\n` +
        `          <div class="field"><label for="dn-item">Trang bị Hoàng Kim</label><select id="dn-item" name="hkChoice" required><option value="${DN_SET_CHOICE}"${setSel}>Bộ Định Nghiệp (6 món)</option>${hkSelectGroup}</select></div>\n` +
        '          <div class="field"><label for="dn-mk2">Mã khóa 2 (6 chữ số)</label><input id="dn-mk2" name="mk2" type="password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" required autocomplete="off"></div>\n' +
        '          <button class="btn-gold" type="submit">Cấp trang bị Hoàng Kim</button>\n' +
        '        </form>';
    } else {
      dnSectionBody =
        `        <p class="empty-note">Tài khoản quản trị ${escapeHtml(adminTen)} chưa có nhân vật ở các ô hiện có.</p>`;
    }
  } else {
    dnSectionBody =
      '        <p class="empty-note">Cần mở đăng nhập game trong cùng trình duyệt bằng tài khoản quản trị hợp lệ (và hoàn tất đổi mật khẩu nếu được yêu cầu) để tự cấp trang bị Hoàng Kim.</p>';
  }

  return (
    '      <section class="panel panel-dn" aria-labelledby="heading-dn">\n' +
    '        <div class="panel-head">\n' +
    '          <h2 id="heading-dn">Cấp Hoàng Kim</h2>\n' +
    '          <p>Cấp bộ Định Nghiệp hoặc 1 trang bị Hoàng Kim cho nhân vật thuộc chính tài khoản quản trị đang đăng nhập.</p>\n' +
    '        </div>\n' +
    `${dnSectionBody}\n` +
    '      </section>'
  );
}

function renderFormPage({
  activeMuc = DEFAULT_MUC,
  statusText,
  isError,
  recoveryHref = '',
  recoveryLabel = '',
  ten = '',
  chu = '',
  lookupTen = '',
  chars = null,
  accountNames = null,
  issueXuToken = null,
  adminTen = '',
  ownChars = null,
  dnToken = '',
  selectedDnSlot = '',
  hkOptions = null,
  selectedHkChoice = DN_SET_CHOICE,
}) {
  const muc = ALLOWED_MUC.has(activeMuc) ? activeMuc : DEFAULT_MUC;
  const recoveryBlock = recoveryHref && recoveryLabel
    ? `<span class="banner-actions"><a class="banner-link" href="${escapeHtml(recoveryHref)}">${escapeHtml(recoveryLabel)}</a></span>`
    : '';
  const statusBlock = statusText
    ? `<p class="banner ${isError ? 'banner-error' : 'banner-ok'}" role="${isError ? 'alert' : 'status'}"><strong>${isError ? 'Lỗi:' : 'Thành công:'}</strong> ${escapeHtml(statusText)}${recoveryBlock}</p>`
    : '';
  const navItemsHtml = MENU_ITEMS
    .map((item) => {
      const currentAttr = item.id === muc ? ' aria-current="page"' : '';
      return `          <li><a class="nav-link" href="${ROUTE_PATH}?muc=${item.id}"${currentAttr}>${escapeHtml(item.label)}</a></li>`;
    })
    .join('\n');
  let activePanelHtml;
  if (muc === 'tao') {
    activePanelHtml = renderCreatePanel({ ten, chu });
  } else if (muc === 'cap' || muc === 'xu') {
    activePanelHtml = renderPlayerLookupPanel({ mode: muc, accountNames, lookupTen, chars, issueXuToken });
  } else {
    activePanelHtml = renderHoangKimPanel({ adminTen, ownChars, dnToken, selectedDnSlot, hkOptions, selectedHkChoice });
  }

  return (
    '<header class="brand-header">\n' +
    '      <p class="brand-kicker">Võ Lâm Truyền Kỳ · Điều hành máy chủ</p>\n' +
    '      <h1 class="brand-title">Bảng điều khiển quản trị tài khoản</h1>\n' +
    '      <p class="brand-sub">Chọn một nghiệp vụ quản trị để thao tác tập trung theo từng màn.</p>\n' +
    '    </header>\n' +
    '    <div class="portal-layout">\n' +
    '      <nav class="portal-nav" aria-label="Menu quản trị">\n' +
    '        <ul class="nav-list">\n' +
    `${navItemsHtml}\n` +
    '        </ul>\n' +
    '      </nav>\n' +
    '      <div class="portal-content">\n' +
    (statusBlock ? `        ${statusBlock}\n` : '') +
    `${activePanelHtml}\n` +
    '      </div>\n' +
    '    </div>'
  );
}

async function parsePostParams(req, res, renderFn, allowedOrigin) {
  if (typeof allowedOrigin !== 'string' || !allowedOrigin || req.headers.origin !== allowedOrigin) {
    sendHtml(res, 403, 'Nguồn không hợp lệ', '<h1>403 - Origin không hợp lệ</h1>');
    return null;
  }
  const activeMuc = parseActiveMuc(req.url);
  if (!isUrlEncodedContentType(req.headers['content-type'])) {
    const recoveryHref = `${ROUTE_PATH}?muc=${activeMuc}`;
    const statusText =
      'Trình duyệt gửi yêu cầu không đúng định dạng biểu mẫu (HTTP 415, yêu cầu application/x-www-form-urlencoded; UTF-8). Vui lòng tải lại trang và gửi lại thao tác.';
    sendHtml(
      res,
      415,
      'Định dạng không được hỗ trợ',
      renderFn({ statusText, isError: true, recoveryHref, recoveryLabel: 'Mở lại trang hiện tại' })
    );
    return null;
  }
  try {
    return new URLSearchParams(await readBoundedBody(req, MAX_BODY_BYTES));
  } catch (err) {
    const code = err && (err.statusCode === 413 || err.statusCode === 400) ? err.statusCode : 400;
    const msg = code === 413 ? 'Dữ liệu gửi lên vượt quá giới hạn 4 KiB.' : 'Không thể đọc dữ liệu yêu cầu.';
    sendHtml(res, code, 'Lỗi dữ liệu', renderFn({ statusText: msg, isError: true }));
    return null;
  }
}

function sendActionError(res, title, err, renderFn, state, secretToHide) {
  const hasCode = err && typeof err.code === 'number' && Number.isInteger(err.code) && err.code >= 400 && err.code <= 499;
  const code = hasCode ? err.code : 500;
  let msg = hasCode && typeof err.message === 'string' && err.message.trim() ? err.message.trim() : 'Lỗi hệ thống nội bộ.';
  if (secretToHide && msg.includes(secretToHide)) msg = 'Xác thực không thành công.';
  return sendHtml(res, code, title, renderFn(Object.assign({}, state, { statusText: msg, isError: true })));
}

function readTargetChars(D, ten) {
  const tk = D.docTk(ten);
  if (!tk || typeof tk !== 'object') return { code: 404, error: 'Không tìm thấy tài khoản.' };
  if (tk.admin) return { code: 403, error: 'Không được phép chỉnh sửa tài khoản quản trị.' };
  const slotN = Number.isInteger(D.SLOT_N) && D.SLOT_N > 0 ? D.SLOT_N : 3;
  const chars = [];
  for (let o = 0; o < slotN; o += 1) {
    const s = Array.isArray(tk.nv) ? tk.nv[o] : null;
    if (!s || typeof s !== 'object' || typeof s.name !== 'string' || !s.name.trim()) continue;
    const lvl = s.lvl == null ? 1 : s.lvl;
    if (!Number.isInteger(lvl) || lvl < 1) return { code: 409, error: 'Dữ liệu cấp nhân vật không hợp lệ.' };
    const xu = s.xu == null ? 0 : s.xu;
    if (!Number.isInteger(xu) || xu < 0 || xu > MAX_XU_BALANCE) {
      return { code: 409, error: 'Dữ liệu Xu nhân vật không hợp lệ.' };
    }
    chars.push({ o, name: s.name, lvl, xu });
  }
  return { slotN, chars };
}

function renderBlockedChan(res, chanErr, renderPage, state) {
  const code = chanErr && Number.isInteger(chanErr.code) && chanErr.code >= 400 && chanErr.code <= 499 ? chanErr.code : 429;
  const msg = typeof chanErr === 'string' && chanErr.trim()
    ? chanErr.trim()
    : (chanErr && typeof chanErr.msg === 'string' && chanErr.msg.trim() ? chanErr.msg.trim() : 'Yêu cầu bị chặn xác thực mã khóa 2.');
  return sendHtml(res, code, 'Tạm thời bị chặn', renderPage(Object.assign({}, state, { statusText: msg, isError: true })));
}

function handleAdminActionPost(req, res, params, { D, QT, API, BM, loadHoangKim, issueXuTokenFor, peekXuToken, consumeXuToken }) {
  const queryMuc = parseActiveMuc(req.url);
  const rawAction = params.get('action') ?? '';
  const activeMuc = rawAction === 'dinh-nghiep'
    ? 'hoang-kim'
    : (rawAction === 'cap'
      ? 'cap'
      : (rawAction === 'xu'
        ? 'xu'
        : (rawAction === 'tim' ? (queryMuc === 'xu' ? 'xu' : 'cap') : queryMuc)));
  const admin = getGameAdmin(API, req);
  if (!admin) {
    return sendHtml(res, 403, 'Truy cập bị từ chối', renderFormPage({ activeMuc, statusText: 'Cần phiên quản trị game hợp lệ và không bị bắt đổi mật khẩu.', isError: true }));
  }
  const needsAccounts = activeMuc === 'cap' || activeMuc === 'xu';
  const needsDn = activeMuc === 'hoang-kim';
  const accountNames = needsAccounts ? getOrdinaryAccountNames(D) : null;
  const sessionHash = getAdminSessionHash(admin, req);
  const dnKey = `dn:${admin.ten}`;
  const renderAdminPage = (state) => {
    const issueFn = activeMuc === 'xu' && state && state.lookupTen && Array.isArray(state.chars)
      ? (slotIdx) => issueXuTokenFor(sessionHash, state.lookupTen, slotIdx)
      : null;
    const own = needsDn
      ? (state && state.ownData ? state.ownData : readOwnAdminChars(D, admin))
      : null;
    const dnTok = needsDn && own && own.chars.length > 0
      ? issueXuTokenFor(sessionHash, dnKey, DN_SLOT_SENTINEL)
      : '';
    return renderFormPage(Object.assign({}, state, {
      activeMuc,
      accountNames,
      issueXuToken: issueFn,
      adminTen: admin.ten,
      ownChars: own ? own.chars : null,
      dnToken: dnTok,
      hkOptions: needsDn && own && own.chars.length > 0 ? listHoangKimCatalogOptions(loadHoangKim) : null,
    }));
  };

  const action = rawAction;
  if (action === 'dinh-nghiep') {
    const keyErr = checkFormKeys(params, ['action', 'o', 'mk2', 'dnToken', 'hkChoice']);
    if (keyErr) return sendHtml(res, 400, 'Dữ liệu không hợp lệ', renderAdminPage({ statusText: keyErr, isError: true }));
    if (!['action', 'o', 'mk2', 'dnToken'].every((k) => params.has(k))) {
      return sendHtml(res, 400, 'Dữ liệu không hợp lệ', renderAdminPage({ statusText: 'Thiếu trường bắt buộc.', isError: true }));
    }
    const oStr = params.get('o');
    const mk2 = params.get('mk2');
    const dnToken = params.get('dnToken');
    const hkChoice = params.has('hkChoice') ? params.get('hkChoice') : DN_SET_CHOICE;
    const o = INT_RE.test(oStr) ? Number(oStr) : -1;
    const own = readOwnAdminChars(D, admin);
    if (!own) {
      return sendHtml(res, 403, 'Truy cập bị từ chối', renderAdminPage({ statusText: 'Không xác minh được tài khoản quản trị hợp lệ.', isError: true }));
    }
    if (o < 0 || o >= own.slotN || !mk2 || !PIN6_RE.test(mk2) || !dnToken || !XU_TOKEN_RE.test(dnToken)) {
      return sendHtml(res, 400, 'Dữ liệu không hợp lệ', renderAdminPage({ statusText: 'Ô nhân vật, mã xác nhận hoặc mã khóa 2 (6 chữ số) không hợp lệ.', isError: true, ownData: own, selectedDnSlot: oStr, selectedHkChoice: hkChoice }));
    }
    const ownSlot = own.chars.find((c) => c.o === o);
    if (!ownSlot) {
      return sendHtml(res, 404, 'Không tìm thấy nhân vật', renderAdminPage({ statusText: 'Ô nhân vật được chọn không tồn tại trên tài khoản quản trị của bạn.', isError: true, ownData: own, selectedHkChoice: hkChoice }));
    }
    const isSetChoice = hkChoice === DN_SET_CHOICE;
    if (!isSetChoice && !HK_KEY_RE.test(hkChoice)) {
      return sendHtml(res, 400, 'Dữ liệu không hợp lệ', renderAdminPage({ statusText: 'Lựa chọn trang bị Hoàng Kim không hợp lệ.', isError: true, ownData: own, selectedDnSlot: String(o), selectedHkChoice: hkChoice }));
    }
    if (!peekXuToken(dnToken, { sessionHash, ten: dnKey, o: DN_SLOT_SENTINEL })) {
      return sendHtml(res, 409, 'Phiên thao tác đã hết hạn', renderAdminPage({ statusText: 'Mã xác nhận cấp trang bị Hoàng Kim đã hết hạn, không khớp phiên quản trị hoặc đã được sử dụng. Vui lòng thử lại.', isError: true, ownData: own, selectedDnSlot: String(o), selectedHkChoice: hkChoice }));
    }
    let hkData = null;
    try {
      hkData = typeof loadHoangKim === 'function' ? loadHoangKim() : null;
    } catch {
      hkData = null;
    }
    let mon = null;
    let selectedItem = null;
    if (isSetChoice) {
      mon = buildDinhNghiepMon(hkData);
      if (!mon) {
        return sendHtml(res, 500, 'Thiếu dữ liệu trang bị', renderAdminPage({ statusText: 'Không thể nạp đủ 6 món bộ Định Nghiệp từ danh mục Hoàng Kim.', isError: true, ownData: own, selectedDnSlot: String(o), selectedHkChoice: hkChoice }));
      }
    } else {
      const single = buildSingleHoangKimMon(hkData, hkChoice);
      if (single.unavailable) {
        return sendHtml(res, 500, 'Thiếu dữ liệu trang bị', renderAdminPage({ statusText: 'Không thể nạp danh mục Hoàng Kim từ máy chủ.', isError: true, ownData: own, selectedDnSlot: String(o), selectedHkChoice: hkChoice }));
      }
      if (single.error) {
        return sendHtml(res, 400, 'Trang bị không hợp lệ', renderAdminPage({ statusText: single.error, isError: true, ownData: own, selectedDnSlot: String(o), selectedHkChoice: hkChoice }));
      }
      mon = single.mon;
      selectedItem = single.item;
    }
    const trang = crypto.randomBytes(18).toString('base64url');
    const ip = (req.socket && req.socket.remoteAddress) || '';
    const qtBody = { ten: admin.ten, o, mon };
    const failTitle = isSetChoice ? 'Không thể cấp bộ Định Nghiệp' : 'Không thể cấp trang bị Hoàng Kim';
    try {
      BM.lam(admin, { viec: 'mo', mk: mk2 }, { trang, ip });
      const chanErr = BM.chan(admin, trang, '/api/quan-tri/qua', 'POST', qtBody);
      if (chanErr) {
        return renderBlockedChan(res, chanErr, renderAdminPage, { ownData: own, selectedDnSlot: String(o), selectedHkChoice: hkChoice });
      }
      if (!consumeXuToken(dnToken, { sessionHash, ten: dnKey, o: DN_SLOT_SENTINEL })) {
        return sendHtml(res, 409, 'Phiên thao tác đã hết hạn', renderAdminPage({ statusText: 'Mã xác nhận cấp trang bị Hoàng Kim đã hết hạn hoặc đã được sử dụng. Vui lòng thử lại.', isError: true, ownData: own, selectedDnSlot: String(o), selectedHkChoice: hkChoice }));
      }
      const result = QT.lam('qua', admin, qtBody, {});
      let okMsg = result && typeof result.msg === 'string' && result.msg.trim()
        ? result.msg.trim()
        : (isSetChoice
          ? `Đã cấp bộ Định Nghiệp (6 món) cho ${ownSlot.name} (Ô ${o + 1}).`
          : `Đã cấp ${selectedItem.name} (${selectedItem.k}) cho ${ownSlot.name} (Ô ${o + 1}).`);
      if (Array.isArray(result && result.ds) && result.ds.length > 0 && !okMsg.includes(isSetChoice ? 'Định Nghiệp' : selectedItem.name)) {
        okMsg = `${okMsg} (${result.ds.join(', ')})`;
      }
      return sendHtml(
        res,
        200,
        isSetChoice ? 'Cấp bộ Định Nghiệp thành công' : 'Cấp trang bị Hoàng Kim thành công',
        renderAdminPage({ statusText: okMsg, isError: false, selectedDnSlot: String(o), selectedHkChoice: hkChoice })
      );
    } catch (err) {
      return sendActionError(res, failTitle, err, renderAdminPage, { ownData: own, selectedDnSlot: String(o), selectedHkChoice: hkChoice }, mk2);
    } finally {
      try { BM.khoaTrang(admin.ten, trang); } catch {}
    }
  }

  if (action !== 'tim' && action !== 'cap' && action !== 'xu') {
    return sendHtml(res, 400, 'Dữ liệu không hợp lệ', renderAdminPage({ statusText: 'Hành động không hợp lệ.', isError: true }));
  }
  const expectedKeys = action === 'tim'
    ? ['action', 'ten']
    : (action === 'cap'
      ? ['action', 'ten', 'o', 'lv', 'tenNv', 'lvHienTai', 'mk2']
      : ['action', 'ten', 'o', 'xu', 'tenNv', 'xuHienTai', 'mk2', 'xuToken']);
  const keyErr = checkFormKeys(params, expectedKeys);
  if (keyErr) return sendHtml(res, 400, 'Dữ liệu không hợp lệ', renderAdminPage({ statusText: keyErr, isError: true }));
  const ten = params.get('ten') ?? '';
  if (!USERNAME_RE.test(ten)) {
    return sendHtml(res, 400, 'Dữ liệu không hợp lệ', renderAdminPage({ statusText: 'Tên tài khoản không hợp lệ.', isError: true, lookupTen: ten }));
  }
  if (action === 'tim') {
    const target = readTargetChars(D, ten);
    if (target.error) return sendHtml(res, target.code, 'Không thể tra cứu', renderAdminPage({ statusText: target.error, isError: true, lookupTen: ten }));
    return sendHtml(res, 200, 'Quản trị tài khoản Võ Lâm', renderAdminPage({
      lookupTen: ten,
      chars: target.chars,
      statusText: target.chars.length ? '' : 'Tài khoản chưa có nhân vật.',
      isError: !target.chars.length,
    }));
  }
  const getRetryChars = () => {
    const t = readTargetChars(D, ten);
    return t.error ? null : t.chars;
  };
  if (!expectedKeys.every((k) => params.has(k))) {
    return sendHtml(res, 400, 'Dữ liệu không hợp lệ', renderAdminPage({ statusText: 'Thiếu trường bắt buộc.', isError: true, lookupTen: ten, chars: getRetryChars() }));
  }
  const oStr = params.get('o');
  const tenNv = params.get('tenNv');
  const mk2 = params.get('mk2');
  const o = INT_RE.test(oStr) ? Number(oStr) : -1;

  if (action === 'cap') {
    const lvStr = params.get('lv');
    const lvCurStr = params.get('lvHienTai');
    const lv = INT_RE.test(lvStr) ? Number(lvStr) : -1;
    const lvHienTai = INT_RE.test(lvCurStr) ? Number(lvCurStr) : -1;
    if (o < 0 || lv < 1 || lv > MAX_LEVEL || lvHienTai < 1 || lvHienTai > MAX_LEVEL || !tenNv || tenNv.length > 64 || CONTROL_CHAR_RE.test(tenNv) || !mk2 || !PIN6_RE.test(mk2)) {
      return sendHtml(res, 400, 'Dữ liệu không hợp lệ', renderAdminPage({ statusText: 'Thông số tăng cấp hoặc mã khóa 2 (6 chữ số) không hợp lệ.', isError: true, lookupTen: ten, chars: getRetryChars() }));
    }
    const target = readTargetChars(D, ten);
    if (target.error) return sendHtml(res, target.code, 'Không thể tăng cấp', renderAdminPage({ statusText: target.error, isError: true, lookupTen: ten }));
    if (o >= target.slotN) {
      return sendHtml(res, 400, 'Dữ liệu không hợp lệ', renderAdminPage({ statusText: 'Ô nhân vật không hợp lệ.', isError: true, lookupTen: ten, chars: target.chars }));
    }
    const slot = target.chars.find((c) => c.o === o);
    if (!slot || slot.name !== tenNv || slot.lvl !== lvHienTai) {
      return sendHtml(res, 409, 'Dữ liệu đã thay đổi', renderAdminPage({ statusText: 'Thông tin nhân vật đã thay đổi, vui lòng tra cứu lại.', isError: true, lookupTen: ten, chars: target.chars }));
    }
    if (lv <= slot.lvl || lv > MAX_LEVEL) {
      return sendHtml(res, 400, 'Dữ liệu không hợp lệ', renderAdminPage({ statusText: 'Cấp mới phải lớn hơn cấp hiện tại và không vượt quá 200.', isError: true, lookupTen: ten, chars: target.chars }));
    }
    const trang = crypto.randomBytes(18).toString('base64url');
    const ip = (req.socket && req.socket.remoteAddress) || '';
    const qtBody = { viec: 'cap', ten, o, lv };
    try {
      BM.lam(admin, { viec: 'mo', mk: mk2 }, { trang, ip });
      const chanErr = BM.chan(admin, trang, '/api/quan-tri/xu-ly', 'POST', qtBody);
      if (chanErr) {
        return renderBlockedChan(res, chanErr, renderAdminPage, { lookupTen: ten, chars: target.chars });
      }
      const result = QT.lam('xu-ly', admin, qtBody, {});
      const okMsg = result && typeof result.msg === 'string' && result.msg.trim() ? result.msg.trim() : 'Cập nhật cấp nhân vật thành công.';
      const refreshed = readTargetChars(D, ten);
      return sendHtml(res, 200, 'Tăng cấp thành công', renderAdminPage({ statusText: okMsg, isError: false, lookupTen: ten, chars: refreshed.error ? null : refreshed.chars }));
    } catch (err) {
      return sendActionError(res, 'Không thể tăng cấp', err, renderAdminPage, { lookupTen: ten, chars: target.chars }, mk2);
    } finally {
      try { BM.khoaTrang(admin.ten, trang); } catch {}
    }
  }

  const xuStr = params.get('xu');
  const xuCurStr = params.get('xuHienTai');
  const xuToken = params.get('xuToken');
  const xu = INT_RE.test(xuStr) ? Number(xuStr) : -1;
  const xuHienTai = INT_RE.test(xuCurStr) ? Number(xuCurStr) : -1;
  if (
    o < 0 ||
    !Number.isInteger(xu) || xu < 1 || xu > MAX_XU_GRANT ||
    !Number.isInteger(xuHienTai) || xuHienTai < 0 || xuHienTai > MAX_XU_BALANCE ||
    !tenNv || tenNv.length > 64 || CONTROL_CHAR_RE.test(tenNv) ||
    !mk2 || !PIN6_RE.test(mk2) ||
    !xuToken || !XU_TOKEN_RE.test(xuToken)
  ) {
    return sendHtml(res, 400, 'Dữ liệu không hợp lệ', renderAdminPage({ statusText: 'Thông số Cộng Xu, mã xác nhận hoặc mã khóa 2 (6 chữ số) không hợp lệ.', isError: true, lookupTen: ten, chars: getRetryChars() }));
  }
  const target = readTargetChars(D, ten);
  if (target.error) return sendHtml(res, target.code, 'Không thể cộng Xu', renderAdminPage({ statusText: target.error, isError: true, lookupTen: ten }));
  if (o >= target.slotN) {
    return sendHtml(res, 400, 'Dữ liệu không hợp lệ', renderAdminPage({ statusText: 'Ô nhân vật không hợp lệ.', isError: true, lookupTen: ten, chars: target.chars }));
  }
  const slot = target.chars.find((c) => c.o === o);
  if (!slot || slot.name !== tenNv || slot.xu !== xuHienTai) {
    return sendHtml(res, 409, 'Dữ liệu đã thay đổi', renderAdminPage({ statusText: 'Thông tin nhân vật hoặc số Xu đã thay đổi, vui lòng tra cứu lại.', isError: true, lookupTen: ten, chars: target.chars }));
  }
  if (slot.xu + xu > MAX_XU_BALANCE) {
    return sendHtml(res, 400, 'Vượt quá giới hạn Xu', renderAdminPage({ statusText: 'Số Xu sau khi cộng vượt quá giới hạn tối đa 2.147.483.647.', isError: true, lookupTen: ten, chars: target.chars }));
  }
  if (!peekXuToken(xuToken, { sessionHash, ten, o })) {
    return sendHtml(res, 409, 'Phiên thao tác đã hết hạn', renderAdminPage({ statusText: 'Mã xác nhận Cộng Xu đã hết hạn, không khớp phiên quản trị hoặc đã được sử dụng. Vui lòng thử lại.', isError: true, lookupTen: ten, chars: target.chars }));
  }
  const trang = crypto.randomBytes(18).toString('base64url');
  const ip = (req.socket && req.socket.remoteAddress) || '';
  const qtBody = { ten, o, xu };
  try {
    BM.lam(admin, { viec: 'mo', mk: mk2 }, { trang, ip });
    const chanErr = BM.chan(admin, trang, '/api/quan-tri/qua', 'POST', qtBody);
    if (chanErr) {
      return renderBlockedChan(res, chanErr, renderAdminPage, { lookupTen: ten, chars: target.chars });
    }
    if (!consumeXuToken(xuToken, { sessionHash, ten, o })) {
      return sendHtml(res, 409, 'Phiên thao tác đã hết hạn', renderAdminPage({ statusText: 'Mã xác nhận Cộng Xu đã hết hạn hoặc đã được sử dụng. Vui lòng thử lại.', isError: true, lookupTen: ten, chars: target.chars }));
    }
    const result = QT.lam('qua', admin, qtBody, {});
    let okMsg = result && typeof result.msg === 'string' && result.msg.trim()
      ? result.msg.trim()
      : `Đã cộng ${formatViInt(xu)} Xu cho ${slot.name}.`;
    if (Array.isArray(result && result.ds) && result.ds.length > 0 && !okMsg.includes('Xu')) {
      okMsg = `${okMsg} (${result.ds.join(', ')})`;
    }
    const refreshed = readTargetChars(D, ten);
    return sendHtml(res, 200, 'Cộng Xu thành công', renderAdminPage({ statusText: okMsg, isError: false, lookupTen: ten, chars: refreshed.error ? null : refreshed.chars }));
  } catch (err) {
    return sendActionError(res, 'Không thể cộng Xu', err, renderAdminPage, { lookupTen: ten, chars: target.chars }, mk2);
  } finally {
    try { BM.khoaTrang(admin.ten, trang); } catch {}
  }
}

function createHandler(deps) {
  const hasExplicitConfig = Boolean(deps && (Object.hasOwn(deps, 'allowedEmail') || Object.hasOwn(deps, 'allowedOrigin')));
  const explicitConfig = hasExplicitConfig
    ? { allowedEmail: deps.allowedEmail, allowedOrigin: deps.allowedOrigin }
    : undefined;
  let cachedDeps = null;
  const xuTokens = new Map();

  function pruneExpiredXuTokens(now) {
    for (const [k, v] of xuTokens) {
      if (v.expiresAt <= now) xuTokens.delete(k);
    }
  }

  function issueXuTokenFor(sessionHash, ten, o) {
    const now = getDeps().now();
    pruneExpiredXuTokens(now);
    while (xuTokens.size >= MAX_XU_TOKENS) {
      const oldest = xuTokens.keys().next().value;
      if (oldest === undefined) break;
      xuTokens.delete(oldest);
    }
    const token = crypto.randomBytes(18).toString('base64url');
    xuTokens.set(token, { sessionHash, ten, o, expiresAt: now + XU_TOKEN_TTL_MS });
    return token;
  }

  function peekXuToken(token, { sessionHash, ten, o }) {
    const entry = xuTokens.get(token);
    if (!entry) return false;
    if (entry.expiresAt <= getDeps().now()) {
      xuTokens.delete(token);
      return false;
    }
    return entry.sessionHash === sessionHash && entry.ten === ten && entry.o === o;
  }

  function consumeXuToken(token, { sessionHash, ten, o }) {
    if (!peekXuToken(token, { sessionHash, ten, o })) return false;
    xuTokens.delete(token);
    return true;
  }

  function getDeps() {
    if (!cachedDeps) {
      cachedDeps = deps
        ? {
            D: deps.D,
            QT: deps.QT,
            API: deps.API,
            BM: deps.BM,
            loadHoangKim: typeof deps.loadHoangKim === 'function'
              ? deps.loadHoangKim
              : () => require('./src/game/hoang-kim.json'),
            secretPath: deps.secretPath || DEFAULT_SECRET_PATH,
            now: typeof deps.now === 'function' ? deps.now : () => Date.now(),
          }
        : {
            D: require('./may-chu/du-lieu'),
            QT: require('./may-chu/quan-tri'),
            API: require('./may-chu/api'),
            BM: require('./may-chu/bao-mat'),
            loadHoangKim: () => require('./src/game/hoang-kim.json'),
            secretPath: DEFAULT_SECRET_PATH,
            now: () => Date.now(),
          };
    }
    return cachedDeps;
  }

  return async function handler(req, res) {
    const pathname = typeof req.url === 'string' ? req.url.split('?')[0] : '';
    if (pathname !== ROUTE_PATH) {
      return sendHtml(res, 404, 'Không tìm thấy', '<h1>404 - Không tìm thấy trang</h1>');
    }

    const adminConfig = parseAdminConfig(explicitConfig);
    if (!adminConfig) {
      return sendHtml(res, 403, 'Truy cập bị từ chối', '<h1>403 - Truy cập bị từ chối</h1>');
    }

    if (req.method !== 'GET' && req.method !== 'POST') {
      return sendHtml(
        res,
        405,
        'Phương thức không được phép',
        '<h1>405 - Chỉ hỗ trợ GET và POST</h1>',
        { Allow: 'GET, POST' }
      );
    }

    const { D, QT, API, BM, loadHoangKim, secretPath } = getDeps();

    const expectedSecret = readExpectedSecret(secretPath);
    const providedSecret = req.headers['x-volam-admin-proxy'];
    if (!expectedSecret || !constantTimeEqual(providedSecret, expectedSecret)) {
      return sendHtml(res, 403, 'Truy cập bị từ chối', '<h1>403 - Truy cập bị từ chối</h1>');
    }

    const verifiedEmail = parseVerifiedUserInfo(req.headers['x-userinfo'], adminConfig.allowedEmail);
    if (!verifiedEmail) {
      return sendHtml(res, 403, 'Truy cập bị từ chối', '<h1>403 - Danh tính chưa được xác thực hợp lệ</h1>');
    }

    const buildSessionRenderState = (gameAdmin, activeMuc, extra) => {
      const muc = ALLOWED_MUC.has(activeMuc) ? activeMuc : DEFAULT_MUC;
      const needsAccounts = muc === 'cap' || muc === 'xu';
      const needsDn = muc === 'hoang-kim';
      const accountNames = gameAdmin && needsAccounts ? getOrdinaryAccountNames(D) : null;
      const own = gameAdmin && needsDn ? readOwnAdminChars(D, gameAdmin) : null;
      const dnToken = gameAdmin && needsDn && own && own.chars.length > 0
        ? issueXuTokenFor(getAdminSessionHash(gameAdmin, req), `dn:${gameAdmin.ten}`, DN_SLOT_SENTINEL)
        : '';
      const hkOptions = gameAdmin && needsDn && own && own.chars.length > 0
        ? listHoangKimCatalogOptions(loadHoangKim)
        : null;
      return Object.assign({}, extra, {
        activeMuc: muc,
        accountNames,
        adminTen: gameAdmin ? gameAdmin.ten : '',
        ownChars: own ? own.chars : null,
        dnToken,
        hkOptions,
      });
    };

    const queryMuc = parseActiveMuc(req.url);

    if (req.method === 'GET') {
      const gameAdmin = getGameAdmin(API, req);
      return sendHtml(res, 200, VIEW_TITLES[queryMuc] || VIEW_TITLES[DEFAULT_MUC], renderFormPage(buildSessionRenderState(gameAdmin, queryMuc)));
    }

    const gameAdmin = getGameAdmin(API, req);
    const renderForParseError = (state) => renderFormPage(buildSessionRenderState(gameAdmin, queryMuc, state));

    const params = await parsePostParams(req, res, renderForParseError, adminConfig.allowedOrigin);
    if (!params) return;

    if (params.has('action')) {
      return handleAdminActionPost(req, res, params, { D, QT, API, BM, loadHoangKim, issueXuTokenFor, peekXuToken, consumeXuToken });
    }

    const renderCreatePage = (state) => renderFormPage(buildSessionRenderState(gameAdmin, 'tao', state));

    const parsed = validateFormBody(params);
    if (parsed.error) {
      return sendHtml(
        res,
        400,
        'Dữ liệu không hợp lệ',
        renderCreatePage({
          statusText: parsed.error,
          isError: true,
          ten: parsed.ten || '',
          chu: parsed.chu || '',
        })
      );
    }

    let result;
    try {
      const accounts = D.dsTk();
      if (!Array.isArray(accounts) || !accounts.some((t) => t && t.admin)) {
        return sendHtml(
          res,
          409,
          'Chưa sẵn sàng',
          renderCreatePage({
            statusText: 'Hệ thống chưa có tài khoản quản trị khởi tạo (bootstrap).',
            isError: true,
            ten: parsed.ten,
            chu: parsed.chu,
          })
        );
      }

      result = QT.lam(
        'xu-ly',
        { ten: verifiedEmail },
        { viec: 'tao', ten: parsed.ten, mk: parsed.mk, chu: parsed.chu },
        {}
      );
    } catch (err) {
      return sendActionError(res, 'Không thể tạo tài khoản', err, renderCreatePage, { ten: parsed.ten, chu: parsed.chu });
    }

    const successMsg =
      result && typeof result.msg === 'string' && result.msg.trim()
        ? result.msg.trim()
        : 'Tạo tài khoản thành công.';
    return sendHtml(
      res,
      200,
      'Tạo tài khoản thành công',
      renderCreatePage({
        statusText: successMsg,
        isError: false,
      })
    );
  };
}

const defaultHandler = createHandler();
defaultHandler.createHandler = createHandler;
module.exports = defaultHandler;

if (require.main === module) {
  (async () => {
    const TEST_EMAIL = 'admin@example.test';
    const TEST_ORIGIN = 'https://portal.example.test';
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'volam-admin-test-'));
    const secretFile = path.join(tmpDir, 'proxy-secret');
    const validSecret = 'test-proxy-secret-0123456789abcdef';
    fs.writeFileSync(secretFile, `${validSecret}\n`, { mode: 0o600 });

    const encodeUserInfo = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
    const validUserInfo = encodeUserInfo({
      sub: 'google-oauth2-sub-123',
      email: TEST_EMAIL,
      email_verified: true,
    });

    let accounts = [
      { ten: 'admin_root', admin: true },
      { ten: 'player_z', admin: false },
      { ten: 'player1', admin: false },
      { ten: 'a<xss>', admin: false },
      { ten: 'gm_two', admin: true },
    ];
    let tkMap = {
      admin_root: { ten: 'admin_root', admin: true, nv: [{ name: 'GM', lvl: 200 }] },
      player1: { ten: 'player1', admin: false, nv: [{ name: '<TieuLong>', lvl: 12 }, null, { name: 'MoiTao' }] },
    };
    let tkPhienImpl = () => ({ ten: 'admin_root', admin: true, batDoiMk: false });
    let bmChanCalls = [];
    let bmChanImpl = () => null;
    let bmLamCalls = [];
    let bmLamImpl = (actor, payload, ctx) => { bmLamCalls.push({ actor, payload, ctx }); };
    let bmKhoaCalls = [];
    let qtCalls = [];
    let qtImpl = (cmd, actor, payload, ctx) => {
      qtCalls.push({ cmd, actor, payload, ctx });
      return { msg: `Đã tạo tài khoản ${payload.ten}` };
    };

    const fakeHoangKim = {
      items: [
        { k: 'hk:148', n: 'Định Nghiệp Đầu quán', s: 0, bo: 'dinhNghiep' },
        { k: 'hk:149', n: 'Định Nghiệp Chiến bào', s: 4, bo: 'dinhNghiep' },
        { k: 'hk:150', n: 'Định Nghiệp Yêu đái', s: 3, bo: 'dinhNghiep' },
        { k: 'hk:151', n: 'Định Nghiệp Hộ uyển', s: 1, bo: 'dinhNghiep' },
        { k: 'hk:152', n: 'Định Nghiệp Chiến ngoa', s: 2, bo: 'dinhNghiep' },
        { k: 'hk:153', n: 'Định Nghiệp Ban chỉ', s: 2, bo: 'dinhNghiep' },
        { k: 'hk:217', n: 'An Bang <Thử>', s: 4, bo: 'anBang' },
        { k: 'hk:399', name: 'Định Quốc Thanh Sa', s: 0 },
      ],
    };
    let hkLoaderImpl = () => fakeHoangKim;
    let nowMs = 1700000000000;
    const fakeDeps = {
      secretPath: secretFile,
      allowedEmail: TEST_EMAIL,
      allowedOrigin: TEST_ORIGIN,
      now: () => nowMs,
      loadHoangKim: () => hkLoaderImpl(),
      D: {
        SLOT_N: 3,
        dsTk: () => accounts,
        docTk: (ten) => tkMap[ten] || null,
      },
      API: { tkPhien: (req) => tkPhienImpl(req) },
      BM: {
        chan: (actor, trang, route, method, body) => {
          bmChanCalls.push({ actor, trang, route, method, body });
          return bmChanImpl(actor, trang, route, method, body);
        },
        lam: (actor, payload, ctx) => bmLamImpl(actor, payload, ctx),
        khoaTrang: (tenAdmin, trang) => bmKhoaCalls.push({ tenAdmin, trang }),
      },
      QT: {
        lam: (cmd, actor, payload, ctx) => qtImpl(cmd, actor, payload, ctx),
      },
    };

    const adminHandler = createHandler(fakeDeps);
    const server = http.createServer((req, res) => {
      Promise.resolve(adminHandler(req, res)).catch((err) => {
        res.statusCode = 500;
        res.end(String(err));
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    function request({ method = 'GET', reqPath = ROUTE_PATH, headers = {}, body = null }) {
      return new Promise((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port,
            method,
            path: reqPath,
            headers,
          },
          (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
              resolve({
                status: res.statusCode,
                headers: res.headers,
                body: Buffer.concat(chunks).toString('utf8'),
              });
            });
          }
        );
        req.on('error', reject);
        if (body !== null) req.write(body);
        req.end();
      });
    }

    try {
      // 0. Missing/invalid runtime config fails closed with 403 before loading deps
      {
        const origEmail = process.env.VL_ADMIN_EMAIL;
        const origOrigin = process.env.VL_ADMIN_ORIGIN;
        delete process.env.VL_ADMIN_EMAIL;
        delete process.env.VL_ADMIN_ORIGIN;
        let depsLoaded = false;
        const unconfiguredHandler = createHandler({
          secretPath: secretFile,
          get D() { depsLoaded = true; return fakeDeps.D; },
          get QT() { depsLoaded = true; return fakeDeps.QT; },
          get API() { depsLoaded = true; return fakeDeps.API; },
          get BM() { depsLoaded = true; return fakeDeps.BM; },
        });
        const unconfiguredCases = [
          {},
          { allowedEmail: '', allowedOrigin: TEST_ORIGIN },
          { allowedEmail: TEST_EMAIL, allowedOrigin: '' },
          { allowedEmail: TEST_EMAIL, allowedOrigin: 'http://portal.example.test' },
          { allowedEmail: TEST_EMAIL, allowedOrigin: `${TEST_ORIGIN}/admin` },
        ];
        try {
          for (const cfg of unconfiguredCases) {
            const h = Object.keys(cfg).length === 0
              ? unconfiguredHandler
              : createHandler(Object.assign({
                  secretPath: secretFile,
                  get D() { depsLoaded = true; return fakeDeps.D; },
                }, cfg));
            const s = http.createServer((req, res) => Promise.resolve(h(req, res)));
            await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve));
            try {
              const p = s.address().port;
              const r = await new Promise((resolve, reject) => {
                const req = http.request({
                  host: '127.0.0.1',
                  port: p,
                  method: 'GET',
                  path: ROUTE_PATH,
                  headers: { 'x-volam-admin-proxy': validSecret, 'x-userinfo': validUserInfo },
                }, (res) => {
                  const chunks = [];
                  res.on('data', (c) => chunks.push(c));
                  res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
                });
                req.on('error', reject);
                req.end();
              });
              assert.equal(r.status, 403);
              assert.equal(depsLoaded, false);
            } finally {
              await new Promise((resolve) => s.close(resolve));
            }
          }
        } finally {
          if (origEmail !== undefined) process.env.VL_ADMIN_EMAIL = origEmail;
          if (origOrigin !== undefined) process.env.VL_ADMIN_ORIGIN = origOrigin;
        }
      }

      // 1. Wrong secret
      {
        const r = await request({
          method: 'GET',
          headers: {
            'x-volam-admin-proxy': 'wrong-secret',
            'x-userinfo': validUserInfo,
          },
        });
        assert.equal(r.status, 403);
        assert.equal(r.headers['cache-control'], 'no-store');
        assert.equal(r.headers['x-frame-options'], 'DENY');
      }

      // 2. Unverified / wrong email / non-canonical base64
      {
        const unverified = encodeUserInfo({ sub: '123', email: TEST_EMAIL, email_verified: false });
        const wrongEmail = encodeUserInfo({ sub: '123', email: 'other@example.test', email_verified: true });
        const emptySub = encodeUserInfo({ sub: '  ', email: TEST_EMAIL, email_verified: true });

        for (const ui of [unverified, wrongEmail, emptySub, `${validUserInfo}!`, 'not-base64']) {
          const r = await request({
            method: 'GET',
            headers: {
              'x-volam-admin-proxy': validSecret,
              'x-userinfo': ui,
            },
          });
          assert.equal(r.status, 403);
        }
      }

      // 3. Disallowed method
      {
        const r = await request({
          method: 'PUT',
          headers: {
            'x-volam-admin-proxy': validSecret,
            'x-userinfo': validUserInfo,
          },
        });
        assert.equal(r.status, 405);
        assert.equal(r.headers.allow, 'GET, POST');
      }

      // 4. GET form success + security headers + no JS/CSS
      {
        const r = await request({
          method: 'GET',
          headers: {
            'x-volam-admin-proxy': validSecret,
            'x-userinfo': validUserInfo,
          },
        });
        assert.equal(r.status, 200);
        assert.equal(r.headers['cache-control'], 'no-store');
        assert.equal(r.headers['x-frame-options'], 'DENY');
        assert.equal(r.headers['referrer-policy'], 'same-origin');
        assert.match(r.headers['content-security-policy'], /default-src 'none'/);
        assert.match(r.headers['content-security-policy'], new RegExp(`style-src 'sha256-${ADMIN_CSS_HASH.replace(/[+/=]/g, '\\$&')}'`));
        assert.doesNotMatch(r.headers['content-security-policy'], /unsafe-inline/i);
        assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
        assert.match(r.body, /<html lang="vi">/);
        assert.match(r.body, /<form class="form-stack" method="post" action="\/admin\/tao-tai-khoan\?muc=tao" enctype="application\/x-www-form-urlencoded">/);
        assert.doesNotMatch(r.body, /<script|style=/i);
        const styleMatches = r.body.match(/<style>/g) || [];
        assert.equal(styleMatches.length, 1);
        assert.match(r.body, new RegExp(`<style>${ADMIN_CSS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</style>`));
      }

      // 5. Origin rejection on POST (wrong origin + null origin)
      {
        const form = new URLSearchParams({
          ten: 'nguoi_choi1',
          mk: 'MatKhauTam!123',
          chu: 'Minh',
        }).toString();
        for (const badOrigin of ['https://evil.example', 'null']) {
          const r = await request({
            method: 'POST',
            headers: {
              'x-volam-admin-proxy': validSecret,
              'x-userinfo': validUserInfo,
              'origin': badOrigin,
              'content-type': 'application/x-www-form-urlencoded',
            },
            body: form,
          });
          assert.equal(r.status, 403);
          assert.equal(qtCalls.length, 0);
        }
      }

      // 6. Empty bootstrap rejection (409)
      {
        accounts = [{ ten: 'player_only', admin: false }];
        const form = new URLSearchParams({
          ten: 'nguoi_choi1',
          mk: 'MatKhauTam!123',
          chu: 'Minh',
        }).toString();
        const r = await request({
          method: 'POST',
          headers: {
            'x-volam-admin-proxy': validSecret,
            'x-userinfo': validUserInfo,
            'origin': TEST_ORIGIN,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: form,
        });
        assert.equal(r.status, 409);
        assert.equal(qtCalls.length, 0);
        assert.doesNotMatch(r.body, /MatKhauTam!123/);
      }

      // 7. Validation rejection + no password echo
      {
        accounts = [{ ten: 'admin_root', admin: true }];
        const form = new URLSearchParams({
          ten: 'BAD!',
          mk: 'short_pw_123',
          chu: 'Minh',
        }).toString();
        const r = await request({
          method: 'POST',
          headers: {
            'x-volam-admin-proxy': validSecret,
            'x-userinfo': validUserInfo,
            'origin': TEST_ORIGIN,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: form,
        });
        assert.equal(r.status, 400);
        assert.equal(qtCalls.length, 0);
        assert.doesNotMatch(r.body, /short_pw_123/);
      }

      // 8. Known 4xx business error and unknown 500 error masking
      {
        const form = new URLSearchParams({
          ten: 'nguoi_choi1',
          mk: 'MatKhauTam!123',
          chu: 'Minh',
        }).toString();

        qtImpl = () => {
          const e = new Error('Tài khoản đã tồn tại');
          e.code = 409;
          throw e;
        };
        const r409 = await request({
          method: 'POST',
          headers: {
            'x-volam-admin-proxy': validSecret,
            'x-userinfo': validUserInfo,
            'origin': TEST_ORIGIN,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: form,
        });
        assert.equal(r409.status, 409);
        assert.match(r409.body, /Tài khoản đã tồn tại/);

        qtImpl = () => {
          throw new Error('SECRET_INTERNAL_STACK');
        };
        const r500 = await request({
          method: 'POST',
          headers: {
            'x-volam-admin-proxy': validSecret,
            'x-userinfo': validUserInfo,
            'origin': TEST_ORIGIN,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: form,
        });
        assert.equal(r500.status, 500);
        assert.doesNotMatch(r500.body, /SECRET_INTERNAL_STACK/);
      }

      // 9. Success path
      {
        qtCalls = [];
        qtImpl = (cmd, actor, payload, ctx) => {
          qtCalls.push({ cmd, actor, payload, ctx });
          return { msg: `Đã tạo tài khoản ${payload.ten}` };
        };
        const secretPassword = 'MatKhauTam!123456';
        const form = new URLSearchParams({
          ten: 'nguoi_choi1',
          mk: secretPassword,
          chu: 'Minh',
        }).toString();
        const r = await request({
          method: 'POST',
          headers: {
            'x-volam-admin-proxy': validSecret,
            'x-userinfo': validUserInfo,
            'origin': TEST_ORIGIN,
            'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
          },
          body: form,
        });
        assert.equal(r.status, 200);
        assert.equal(qtCalls.length, 1);
        assert.deepEqual(qtCalls[0], {
          cmd: 'xu-ly',
          actor: { ten: TEST_EMAIL },
          payload: { viec: 'tao', ten: 'nguoi_choi1', mk: secretPassword, chu: 'Minh' },
          ctx: {},
        });
        assert.match(r.body, /Đã tạo tài khoản nguoi_choi1/);
        assert.doesNotMatch(r.body, new RegExp(secretPassword));
      }

      // 10. Same route GET partitions into 4 views via ?muc=tao|cap|xu|hoang-kim (default tao; fallback tao); only selected panel rendered; removed route returns 404; auth & origin checks
      const levelHeaders = { 'x-volam-admin-proxy': validSecret, 'x-userinfo': validUserInfo, origin: TEST_ORIGIN, 'content-type': 'application/x-www-form-urlencoded' };
      {
        accounts = [
          { ten: 'admin_root', admin: true },
          { ten: 'player_z', admin: false },
          { ten: 'player1', admin: false },
          { ten: 'a<xss>', admin: false },
          { ten: 'gm_two', admin: true },
        ];
        const oldRoute = await request({ reqPath: '/admin/tang-cap', headers: { 'x-volam-admin-proxy': validSecret, 'x-userinfo': validUserInfo } });
        assert.equal(oldRoute.status, 404);

        // Default GET (no muc) and unknown muc fallback to tao: only panel-create visible, never lookup select or dn-slot
        for (const reqPath of [ROUTE_PATH, `${ROUTE_PATH}?muc=unknown`, `${ROUTE_PATH}?ten=player1`]) {
          const gTao = await request({ reqPath, headers: { 'x-volam-admin-proxy': validSecret, 'x-userinfo': validUserInfo } });
          assert.equal(gTao.status, 200);
          assert.match(gTao.body, /<a class="nav-link" href="\/admin\/tao-tai-khoan\?muc=tao" aria-current="page">Tạo tài khoản<\/a>/);
          assert.match(gTao.body, /<a class="nav-link" href="\/admin\/tao-tai-khoan\?muc=cap">Tăng cấp<\/a>/);
          assert.match(gTao.body, /<a class="nav-link" href="\/admin\/tao-tai-khoan\?muc=xu">Cộng Xu<\/a>/);
          assert.match(gTao.body, /<a class="nav-link" href="\/admin\/tao-tai-khoan\?muc=hoang-kim">Cấp Hoàng Kim<\/a>/);
          assert.match(gTao.body, /<section class="panel panel-create"/);
          assert.doesNotMatch(gTao.body, /<section class="panel[^"]*(panel-cap|panel-xu|panel-dn)|id="lookup-ten"|id="dn-slot"/);
          assert.doesNotMatch(gTao.body, /<script|style=/i);
        }

        // GET ?muc=cap renders only Tăng cấp lookup panel
        const g = await request({ reqPath: `${ROUTE_PATH}?muc=cap&ten=player1`, headers: { 'x-volam-admin-proxy': validSecret, 'x-userinfo': validUserInfo } });
        assert.equal(g.status, 200);
        assert.match(g.body, /<a class="nav-link" href="\/admin\/tao-tai-khoan\?muc=cap" aria-current="page">Tăng cấp<\/a>/);
        assert.match(g.body, /<section class="panel panel-player panel-cap"/);
        assert.doesNotMatch(g.body, /<section class="panel[^"]*(panel-create|panel-xu|panel-dn)|id="dn-slot"/);
        assert.match(g.body, /<select id="lookup-ten" name="ten" required>/);
        assert.match(g.body, /<button class="btn-jade" type="submit">Tải nhân vật<\/button>/);
        assert.match(g.body, /<option value="a&lt;xss&gt;">a&lt;xss&gt;<\/option><option value="player1">player1<\/option><option value="player_z">player_z<\/option>/);
        const lookupSelectMatch = g.body.match(/<select id="lookup-ten" name="ten" required>[\s\S]*?<\/select>/);
        assert.ok(lookupSelectMatch);
        assert.doesNotMatch(lookupSelectMatch[0], /admin_root|gm_two/);
        assert.doesNotMatch(g.body, /gm_two/);
        assert.doesNotMatch(g.body, /TieuLong|MoiTao/);
        assert.doesNotMatch(g.body, /<script|style=/i);

        // GET ?muc=xu renders only Cộng Xu lookup panel
        const gXu = await request({ reqPath: `${ROUTE_PATH}?muc=xu`, headers: { 'x-volam-admin-proxy': validSecret, 'x-userinfo': validUserInfo } });
        assert.equal(gXu.status, 200);
        assert.match(gXu.body, /<a class="nav-link" href="\/admin\/tao-tai-khoan\?muc=xu" aria-current="page">Cộng Xu<\/a>/);
        assert.match(gXu.body, /<section class="panel panel-player panel-xu"/);
        assert.match(gXu.body, /<form class="lookup-form" method="post" action="\/admin\/tao-tai-khoan\?muc=xu" enctype="application\/x-www-form-urlencoded">/);
        assert.match(gXu.body, /<select id="lookup-ten" name="ten" required>/);
        assert.doesNotMatch(gXu.body, /<section class="panel[^"]*(panel-create|panel-cap|panel-dn)|id="dn-slot"/);

        // Privacy: unverified Google / missing proxy secret / non-game-admin / batDoiMk must never see account names
        const unverifiedGet = await request({
          reqPath: `${ROUTE_PATH}?muc=cap`,
          headers: { 'x-volam-admin-proxy': validSecret, 'x-userinfo': encodeUserInfo({ sub: '123', email: TEST_EMAIL, email_verified: false }) },
        });
        assert.equal(unverifiedGet.status, 403);
        assert.doesNotMatch(unverifiedGet.body, /player1|player_z|a&lt;xss&gt;|<select/);

        for (const badAdmin of [null, { ten: 'u1', admin: false }, { ten: 'gm1', admin: true, batDoiMk: true }]) {
          tkPhienImpl = () => badAdmin;
          const ga = await request({ reqPath: `${ROUTE_PATH}?muc=cap`, headers: { 'x-volam-admin-proxy': validSecret, 'x-userinfo': validUserInfo } });
          assert.equal(ga.status, 200);
          assert.doesNotMatch(ga.body, /<select/);
          assert.doesNotMatch(ga.body, /player1|player_z|a&lt;xss&gt;|admin_root|gm_two/);
          assert.match(ga.body, /đăng nhập game trong cùng trình duyệt/);

          const createErr = await request({
            method: 'POST',
            headers: levelHeaders,
            body: new URLSearchParams({ ten: 'BAD!', mk: 'short', chu: '' }).toString(),
          });
          assert.equal(createErr.status, 400);
          assert.match(createErr.body, /<section class="panel panel-create"/);
          assert.doesNotMatch(createErr.body, /<select|player1|player_z|a&lt;xss&gt;/);

          const p = await request({ method: 'POST', reqPath: `${ROUTE_PATH}?muc=cap`, headers: levelHeaders, body: 'action=tim&ten=player1' });
          assert.equal(p.status, 403);
          assert.match(p.body, /<section class="panel panel-player panel-cap"/);
          assert.doesNotMatch(p.body, /<select|player1|player_z|a&lt;xss&gt;/);
        }
        tkPhienImpl = () => ({ ten: 'admin_root', admin: true, batDoiMk: false });

        const badOrigin = await request({ method: 'POST', reqPath: `${ROUTE_PATH}?muc=cap`, headers: Object.assign({}, levelHeaders, { origin: 'https://evil.example' }), body: 'action=tim&ten=player1' });
        assert.equal(badOrigin.status, 403);
      }

      // 11. Select + load native fixture {name, lvl}, preserves selection, 6-digit PIN UI attrs, escaping, admin target rejection, strict field whitelist (in cap view)
      {
        const r = await request({ method: 'POST', reqPath: `${ROUTE_PATH}?muc=cap`, headers: levelHeaders, body: 'action=tim&ten=player1' });
        assert.equal(r.status, 200);
        assert.match(r.body, /<a class="nav-link" href="\/admin\/tao-tai-khoan\?muc=cap" aria-current="page">Tăng cấp<\/a>/);
        assert.match(r.body, /<option value="player1" selected>player1<\/option>/);
        assert.match(r.body, /&lt;TieuLong&gt;.*Cấp 12/);
        assert.match(r.body, /MoiTao.*Cấp 1/);
        assert.match(r.body, /name="mk2" type="password" inputmode="numeric" pattern="\[0-9\]\{6\}" minlength="6" maxlength="6" required autocomplete="off"/);
        assert.doesNotMatch(r.body, /name="xuToken"|<section class="panel[^"]*(panel-create|panel-xu|panel-dn)/);
        const rAdm = await request({ method: 'POST', reqPath: `${ROUTE_PATH}?muc=cap`, headers: levelHeaders, body: 'action=tim&ten=admin_root' });
        assert.equal(rAdm.status, 403);
        assert.match(rAdm.body, /<section class="panel panel-player panel-cap"/);
        const rExtra = await request({ method: 'POST', reqPath: `${ROUTE_PATH}?muc=cap`, headers: levelHeaders, body: 'action=tim&ten=player1&extra=1' });
        assert.equal(rExtra.status, 400);
        assert.match(rExtra.body, /<section class="panel panel-player panel-cap"/);
      }

      // 12. 6-digit PIN gate, wrong PIN throws (preserves char forms for retry without reselect), BM.chan post-check contract/order, success, and stale replay
      {
        qtCalls = []; bmChanCalls = []; bmLamCalls = []; bmKhoaCalls = [];
        const baseCap = { action: 'cap', ten: 'player1', o: '0', lv: '50', tenNv: '<TieuLong>', lvHienTai: '12', mk2: '12ab56' };
        const rNon6 = await request({ method: 'POST', headers: levelHeaders, body: new URLSearchParams(baseCap).toString() });
        assert.equal(rNon6.status, 400);
        assert.equal(bmLamCalls.length, 0);
        assert.equal(qtCalls.length, 0);
        assert.doesNotMatch(rNon6.body, /12ab56/);
        assert.match(rNon6.body, /<option value="player1" selected>player1<\/option>/);
        assert.match(rNon6.body, /name="o" value="0"/);

        const wrongCap = Object.assign({}, baseCap, { mk2: '999999' });
        bmLamImpl = () => { const e = new Error('Sai mã khóa 2 999999'); e.code = 403; throw e; };
        const rPin = await request({ method: 'POST', headers: levelHeaders, body: new URLSearchParams(wrongCap).toString() });
        assert.equal(rPin.status, 403);
        assert.equal(bmChanCalls.length, 0);
        assert.equal(qtCalls.length, 0);
        assert.equal(bmKhoaCalls.length, 1);
        assert.equal(bmKhoaCalls[0].tenAdmin, 'admin_root');
        assert.doesNotMatch(rPin.body, /999999/);
        assert.match(rPin.body, /<option value="player1" selected>player1<\/option>/);
        assert.match(rPin.body, /name="o" value="0"/);

        const callOrder = [];
        bmLamCalls = []; bmChanCalls = []; bmKhoaCalls = [];
        bmLamImpl = (actor, payload, ctx) => { callOrder.push('lam'); bmLamCalls.push({ actor, payload, ctx }); };
        bmChanImpl = () => { callOrder.push('chan'); return { code: 429, msg: 'Bị chặn tạm thời' }; };
        const rChan = await request({ method: 'POST', headers: levelHeaders, body: new URLSearchParams(wrongCap).toString() });
        assert.equal(rChan.status, 429);
        assert.deepEqual(callOrder, ['lam', 'chan']);
        assert.equal(qtCalls.length, 0);
        assert.equal(bmKhoaCalls.length, 1);

        callOrder.length = 0;
        bmChanCalls = []; bmLamCalls = []; bmKhoaCalls = [];
        bmChanImpl = () => { callOrder.push('chan'); return null; };
        qtImpl = (cmd, actor, payload, ctx) => { callOrder.push('qt'); qtCalls.push({ cmd, actor, payload, ctx }); tkMap.player1.nv[0].lvl = payload.lv; return { msg: `Đã tăng cấp ${payload.ten}` }; };
        const okCap = new URLSearchParams(Object.assign({}, baseCap, { mk2: '123456' })).toString();
        const rOk = await request({ method: 'POST', headers: levelHeaders, body: okCap });
        assert.equal(rOk.status, 200);
        assert.deepEqual(callOrder, ['lam', 'chan', 'qt']);
        assert.equal(bmLamCalls.length, 1);
        assert.equal(bmLamCalls[0].payload.viec, 'mo');
        assert.equal(bmLamCalls[0].payload.mk, '123456');
        assert.match(bmLamCalls[0].ctx.trang, /^[A-Za-z0-9_-]{24}$/);
        assert.deepEqual(bmChanCalls, [{
          actor: { ten: 'admin_root', admin: true, batDoiMk: false },
          trang: bmLamCalls[0].ctx.trang,
          route: '/api/quan-tri/xu-ly',
          method: 'POST',
          body: { viec: 'cap', ten: 'player1', o: 0, lv: 50 },
        }]);
        assert.deepEqual(bmKhoaCalls, [{ tenAdmin: 'admin_root', trang: bmLamCalls[0].ctx.trang }]);
        assert.deepEqual(qtCalls[0], { cmd: 'xu-ly', actor: { ten: 'admin_root', admin: true, batDoiMk: false }, payload: { viec: 'cap', ten: 'player1', o: 0, lv: 50 }, ctx: {} });
        assert.doesNotMatch(rOk.body, /123456/);

        const rStale = await request({ method: 'POST', headers: levelHeaders, body: okCap });
        assert.equal(rStale.status, 409);
        assert.equal(qtCalls.length, 1);
      }

      // 13. Cộng Xu: slot rendering, exact BM/QT contract, slot isolation, PIN/auth/Origin/input/overflow/stale/double-submit/session-bound replay protection
      {
        const extractXuForm = (html, slotIdx) => {
          const re = new RegExp(
            `<input type="hidden" name="action" value="xu">` +
            `<input type="hidden" name="ten" value="([^"]*)">` +
            `<input type="hidden" name="o" value="${slotIdx}">` +
            `<input type="hidden" name="tenNv" value="([^"]*)">` +
            `<input type="hidden" name="xuHienTai" value="([^"]*)">` +
            `<input type="hidden" name="xuToken" value="([^"]*)">`
          );
          const m = html.match(re);
          assert.ok(m, `Expected Xu form for slot ${slotIdx}`);
          const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
          return { ten: decode(m[1]), o: String(slotIdx), tenNv: decode(m[2]), xuHienTai: m[3], xuToken: m[4] };
        };

        tkMap.player1 = {
          ten: 'player1',
          admin: false,
          nv: [
            { name: '<TieuLong>', lvl: 50, xu: 1200 },
            null,
            { name: 'MoiTao', lvl: 1 },
          ],
        };
        let currentAdminPhien = 'sess-admin-1';
        tkPhienImpl = () => ({ ten: 'admin_root', admin: true, batDoiMk: false, phien: currentAdminPhien });

        const timRes = await request({ method: 'POST', reqPath: `${ROUTE_PATH}?muc=xu`, headers: levelHeaders, body: 'action=tim&ten=player1' });
        assert.equal(timRes.status, 200);
        assert.match(timRes.body, /<a class="nav-link" href="\/admin\/tao-tai-khoan\?muc=xu" aria-current="page">Cộng Xu<\/a>/);
        assert.match(timRes.body, /<section class="panel panel-player panel-xu"/);
        assert.doesNotMatch(timRes.body, /<section class="panel[^"]*(panel-create|panel-cap|panel-dn)|name="lv"/);
        assert.match(timRes.body, /1\.200 Xu/);
        assert.match(timRes.body, /0 Xu/);
        assert.match(timRes.body, /id="xu-0"/);
        assert.match(timRes.body, /id="xu-2"/);

        const slot0Form = extractXuForm(timRes.body, 0);
        const slot2Form = extractXuForm(timRes.body, 2);
        assert.equal(slot0Form.xuHienTai, '1200');
        assert.equal(slot2Form.xuHienTai, '0');
        assert.notEqual(slot0Form.xuToken, slot2Form.xuToken);

        // Unauthorized / Origin / admin target / bad inputs must not invoke BM or QT
        qtCalls = []; bmLamCalls = []; bmChanCalls = []; bmKhoaCalls = [];
        const callOrder = [];
        bmLamImpl = (actor, payload, ctx) => { callOrder.push('lam'); bmLamCalls.push({ actor, payload, ctx }); };
        bmChanImpl = () => { callOrder.push('chan'); return null; };
        qtImpl = (cmd, actor, payload, ctx) => {
          callOrder.push('qt');
          qtCalls.push({ cmd, actor, payload, ctx });
          const targetSlot = tkMap[payload.ten].nv[payload.o];
          targetSlot.xu = (targetSlot.xu | 0) + payload.xu;
          return { msg: `Đã gửi quà cho ${targetSlot.name}`, ds: [`${payload.xu} Xu`] };
        };

        const badOriginXu = await request({
          method: 'POST',
          headers: Object.assign({}, levelHeaders, { origin: 'https://evil.example' }),
          body: new URLSearchParams(Object.assign({}, slot0Form, { action: 'xu', xu: '500', mk2: '123456' })).toString(),
        });
        assert.equal(badOriginXu.status, 403);

        tkPhienImpl = () => ({ ten: 'admin_root', admin: true, batDoiMk: true, phien: currentAdminPhien });
        const batDoiMkXu = await request({
          method: 'POST',
          headers: levelHeaders,
          body: new URLSearchParams(Object.assign({}, slot0Form, { action: 'xu', xu: '500', mk2: '123456' })).toString(),
        });
        assert.equal(batDoiMkXu.status, 403);
        tkPhienImpl = () => ({ ten: 'admin_root', admin: true, batDoiMk: false, phien: currentAdminPhien });

        for (const badXu of ['0', '-5', '1.5', '1000001', 'abc']) {
          const rBad = await request({
            method: 'POST',
            headers: levelHeaders,
            body: new URLSearchParams(Object.assign({}, slot0Form, { action: 'xu', xu: badXu, mk2: '123456' })).toString(),
          });
          assert.equal(rBad.status, 400);
        }

        // Extra field rejected
        const rExtraField = await request({
          method: 'POST',
          headers: levelHeaders,
          body: new URLSearchParams(Object.assign({}, slot0Form, { action: 'xu', xu: '500', mk2: '123456', gold: '999' })).toString(),
        });
        assert.equal(rExtraField.status, 400);

        // Target admin rejected
        const rTargetAdmin = await request({
          method: 'POST',
          headers: levelHeaders,
          body: new URLSearchParams({ action: 'xu', ten: 'admin_root', o: '0', tenNv: 'GM', xuHienTai: '0', xuToken: slot0Form.xuToken, xu: '100', mk2: '123456' }).toString(),
        });
        assert.equal(rTargetAdmin.status, 403);

        // Overflow above 2147483647 rejected
        tkMap.player1.nv[0].xu = 2147483000;
        const timNearMax = await request({ method: 'POST', reqPath: `${ROUTE_PATH}?muc=xu`, headers: levelHeaders, body: 'action=tim&ten=player1' });
        const nearMaxForm = extractXuForm(timNearMax.body, 0);
        const rOverflow = await request({
          method: 'POST',
          headers: levelHeaders,
          body: new URLSearchParams(Object.assign({}, nearMaxForm, { action: 'xu', xu: '700', mk2: '123456' })).toString(),
        });
        assert.equal(rOverflow.status, 400);
        assert.match(rOverflow.body, /<section class="panel panel-player panel-xu"/);
        assert.equal(qtCalls.length, 0);

        // Reset slot 0 balance to 1200 and verify stale token from near-max is rejected as stale balance (409)
        tkMap.player1.nv[0].xu = 1200;
        const rStaleBal = await request({
          method: 'POST',
          headers: levelHeaders,
          body: new URLSearchParams(Object.assign({}, nearMaxForm, { action: 'xu', xu: '500', mk2: '123456' })).toString(),
        });
        assert.equal(rStaleBal.status, 409);

        // Stale character name in slot rejected
        const timFresh = await request({ method: 'POST', reqPath: `${ROUTE_PATH}?muc=xu`, headers: levelHeaders, body: 'action=tim&ten=player1' });
        const freshSlot0Form = extractXuForm(timFresh.body, 0);
        const freshSlot2Form = extractXuForm(timFresh.body, 2);
        tkMap.player1.nv[0].name = 'RenamedChar';
        const rStaleName = await request({
          method: 'POST',
          headers: levelHeaders,
          body: new URLSearchParams(Object.assign({}, freshSlot0Form, { action: 'xu', xu: '500', mk2: '123456' })).toString(),
        });
        assert.equal(rStaleName.status, 409);
        tkMap.player1.nv[0].name = '<TieuLong>';
        assert.equal(qtCalls.length, 0);

        // Wrong PIN preserves retry form and does NOT consume the valid one-time token
        bmLamImpl = () => { const e = new Error('Sai mã khóa 2 888888'); e.code = 403; throw e; };
        const rWrongPinXu = await request({
          method: 'POST',
          headers: levelHeaders,
          body: new URLSearchParams(Object.assign({}, freshSlot0Form, { action: 'xu', xu: '500', mk2: '888888' })).toString(),
        });
        assert.equal(rWrongPinXu.status, 403);
        assert.equal(bmKhoaCalls.length, 1);
        assert.doesNotMatch(rWrongPinXu.body, /888888/);
        assert.equal(qtCalls.length, 0);

        // Valid grant succeeds on ONLY slot 0 (slot 2 untouched), calls BM.lam -> BM.chan('/api/quan-tri/qua') -> QT.lam('qua') -> BM.khoaTrang
        bmLamCalls = []; bmChanCalls = []; bmKhoaCalls = []; callOrder.length = 0;
        bmLamImpl = (actor, payload, ctx) => { callOrder.push('lam'); bmLamCalls.push({ actor, payload, ctx }); };
        const okXuBody = new URLSearchParams(Object.assign({}, freshSlot0Form, { action: 'xu', xu: '500', mk2: '123456' })).toString();
        const rOkXu = await request({ method: 'POST', headers: levelHeaders, body: okXuBody });
        assert.equal(rOkXu.status, 200);
        assert.match(rOkXu.body, /<a class="nav-link" href="\/admin\/tao-tai-khoan\?muc=xu" aria-current="page">Cộng Xu<\/a>/);
        assert.match(rOkXu.body, /<section class="panel panel-player panel-xu"/);
        assert.deepEqual(callOrder, ['lam', 'chan', 'qt']);
        assert.equal(bmLamCalls[0].payload.viec, 'mo');
        assert.equal(bmLamCalls[0].payload.mk, '123456');
        assert.deepEqual(bmChanCalls, [{
          actor: { ten: 'admin_root', admin: true, batDoiMk: false, phien: 'sess-admin-1' },
          trang: bmLamCalls[0].ctx.trang,
          route: '/api/quan-tri/qua',
          method: 'POST',
          body: { ten: 'player1', o: 0, xu: 500 },
        }]);
        assert.deepEqual(qtCalls, [{
          cmd: 'qua',
          actor: { ten: 'admin_root', admin: true, batDoiMk: false, phien: 'sess-admin-1' },
          payload: { ten: 'player1', o: 0, xu: 500 },
          ctx: {},
        }]);
        assert.deepEqual(bmKhoaCalls, [{ tenAdmin: 'admin_root', trang: bmLamCalls[0].ctx.trang }]);
        assert.equal(tkMap.player1.nv[0].xu, 1700);
        assert.equal(tkMap.player1.nv[2].xu, undefined);
        assert.match(rOkXu.body, /1\.700 Xu/);
        assert.doesNotMatch(rOkXu.body, /123456/);

        // Replay blocked EVEN IF player spends Xu back down to original 1200 balance!
        tkMap.player1.nv[0].xu = 1200;
        const rReplayAfterSpend = await request({ method: 'POST', headers: levelHeaders, body: okXuBody });
        assert.equal(rReplayAfterSpend.status, 409);
        assert.equal(qtCalls.length, 1);

        // Token bound to admin session (phien) and slot: other admin session or other slot rejected
        currentAdminPhien = 'sess-admin-2';
        const rCrossSession = await request({
          method: 'POST',
          headers: levelHeaders,
          body: new URLSearchParams(Object.assign({}, freshSlot2Form, { action: 'xu', xu: '100', mk2: '123456' })).toString(),
        });
        assert.equal(rCrossSession.status, 409);
        assert.equal(qtCalls.length, 1);
        currentAdminPhien = 'sess-admin-1';

        const rCrossSlot = await request({
          method: 'POST',
          headers: levelHeaders,
          body: new URLSearchParams(Object.assign({}, freshSlot2Form, { action: 'xu', o: '0', tenNv: '<TieuLong>', xuHienTai: '1200', xu: '100', mk2: '123456' })).toString(),
        });
        assert.equal(rCrossSlot.status, 409);
        assert.equal(qtCalls.length, 1);

        // Expired token rejected
        nowMs += XU_TOKEN_TTL_MS + 1;
        const rExpired = await request({
          method: 'POST',
          headers: levelHeaders,
          body: new URLSearchParams(Object.assign({}, freshSlot2Form, { action: 'xu', xu: '100', mk2: '123456' })).toString(),
        });
        assert.equal(rExpired.status, 409);
        assert.equal(qtCalls.length, 1);

        // Corrupted stored negative Xu rejected
        tkMap.player1.nv[0].xu = -10;
        const rNegStored = await request({ method: 'POST', reqPath: `${ROUTE_PATH}?muc=xu`, headers: levelHeaders, body: 'action=tim&ten=player1' });
        assert.equal(rNegStored.status, 409);
        assert.match(rNegStored.body, /<section class="panel panel-player panel-xu"/);
      }

      // 14. Cấp Hoàng Kim (Bộ Định Nghiệp + 1 trang bị): own-slot render, auth/Origin/field/PIN/catalogue/replay/session-isolation, exact QT payload
      {
        const extractDnToken = (html) => {
          const m = html.match(/<input type="hidden" name="action" value="dinh-nghiep"><input type="hidden" name="dnToken" value="([^"]*)">/);
          assert.ok(m, 'Expected dnToken hidden input');
          return m[1];
        };

        tkMap.admin_root = {
          ten: 'admin_root',
          admin: true,
          nv: [
            { name: '<GMMain>', lvl: 200 },
            null,
            { name: 'GMAlt', lvl: 10 },
          ],
        };
        let dnPhien = 'dn-sess-1';
        tkPhienImpl = () => ({ ten: 'admin_root', admin: true, batDoiMk: false, phien: dnPhien });

        // GET ?muc=hoang-kim renders ONLY Cấp Hoàng Kim panel with own occupied slots + escaped Hoàng Kim catalog dropdown
        const dnGet = await request({
          reqPath: `${ROUTE_PATH}?muc=hoang-kim`,
          headers: { 'x-volam-admin-proxy': validSecret, 'x-userinfo': validUserInfo },
        });
        assert.equal(dnGet.status, 200);
        assert.match(dnGet.body, /<a class="nav-link" href="\/admin\/tao-tai-khoan\?muc=hoang-kim" aria-current="page">Cấp Hoàng Kim<\/a>/);
        assert.match(dnGet.body, /Cấp Hoàng Kim/);
        assert.match(dnGet.body, /id="dn-slot" name="o"/);
        assert.match(dnGet.body, /id="dn-item" name="hkChoice"/);
        assert.match(dnGet.body, /<option value="set:dinhNghiep" selected>Bộ Định Nghiệp \(6 món\)<\/option>/);
        assert.match(dnGet.body, /<option value="hk:217">An Bang &lt;Thử&gt; \(hk:217\)<\/option>/);
        assert.match(dnGet.body, /<option value="hk:399">Định Quốc Thanh Sa \(hk:399\)<\/option>/);
        assert.match(dnGet.body, /<option value="0">Ô 1: &lt;GMMain&gt; \(Cấp 200\)<\/option>/);
        assert.match(dnGet.body, /<option value="2">Ô 3: GMAlt \(Cấp 10\)<\/option>/);
        assert.doesNotMatch(dnGet.body, /TieuLong|MoiTao|<section class="panel[^"]*(panel-create|panel-cap|panel-xu)|id="lookup-ten"/);
        const dnToken1 = extractDnToken(dnGet.body);

        // Regular create POST stays on tao view (does not render dn-slot)
        qtImpl = (cmd, actor, payload, ctx) => {
          qtCalls.push({ cmd, actor, payload, ctx });
          return { msg: `Đã tạo tài khoản ${payload.ten}` };
        };
        const createAfterDn = await request({
          method: 'POST',
          headers: levelHeaders,
          body: new URLSearchParams({ ten: 'nguoi_choi2', mk: 'MatKhauTam!1234', chu: '' }).toString(),
        });
        assert.equal(createAfterDn.status, 200);
        assert.match(createAfterDn.body, /<section class="panel panel-create"/);
        assert.doesNotMatch(createAfterDn.body, /id="dn-slot" name="o"/);

        // Unauthorized / batDoiMk hides own slots in hoang-kim view and rejects POST (staying in hoang-kim view)
        tkPhienImpl = () => ({ ten: 'admin_root', admin: true, batDoiMk: true, phien: dnPhien });
        const dnGetLocked = await request({
          reqPath: `${ROUTE_PATH}?muc=hoang-kim`,
          headers: { 'x-volam-admin-proxy': validSecret, 'x-userinfo': validUserInfo },
        });
        assert.equal(dnGetLocked.status, 200);
        assert.match(dnGetLocked.body, /<section class="panel panel-dn"/);
        assert.doesNotMatch(dnGetLocked.body, /id="dn-slot"/);
        const dnPostLocked = await request({
          method: 'POST',
          headers: levelHeaders,
          body: new URLSearchParams({ action: 'dinh-nghiep', o: '0', mk2: '123456', dnToken: dnToken1 }).toString(),
        });
        assert.equal(dnPostLocked.status, 403);
        assert.match(dnPostLocked.body, /<section class="panel panel-dn"/);
        tkPhienImpl = () => ({ ten: 'admin_root', admin: true, batDoiMk: false, phien: dnPhien });

        // Bad Origin / extra field (ten/mon) / empty slot rejected with no BM or QT calls
        qtCalls = []; bmLamCalls = []; bmChanCalls = []; bmKhoaCalls = [];
        const callOrder = [];
        bmLamImpl = (actor, payload, ctx) => { callOrder.push('lam'); bmLamCalls.push({ actor, payload, ctx }); };
        bmChanImpl = () => { callOrder.push('chan'); return null; };
        qtImpl = (cmd, actor, payload, ctx) => {
          callOrder.push('qt');
          qtCalls.push({ cmd, actor, payload, ctx });
          return { msg: 'Đã cấp bộ Định Nghiệp thành công', ds: ['6 món Định Nghiệp'] };
        };

        const rBadOriginDn = await request({
          method: 'POST',
          headers: Object.assign({}, levelHeaders, { origin: 'https://evil.example' }),
          body: new URLSearchParams({ action: 'dinh-nghiep', o: '0', mk2: '123456', dnToken: dnToken1 }).toString(),
        });
        assert.equal(rBadOriginDn.status, 403);

        const rExtraTarget = await request({
          method: 'POST',
          headers: levelHeaders,
          body: new URLSearchParams({ action: 'dinh-nghiep', o: '0', mk2: '123456', dnToken: dnToken1, ten: 'player1' }).toString(),
        });
        assert.equal(rExtraTarget.status, 400);

        const rEmptyOwnSlot = await request({
          method: 'POST',
          headers: levelHeaders,
          body: new URLSearchParams({ action: 'dinh-nghiep', o: '1', mk2: '123456', dnToken: dnToken1 }).toString(),
        });
        assert.equal(rEmptyOwnSlot.status, 404);
        assert.equal(bmLamCalls.length, 0);
        assert.equal(qtCalls.length, 0);

        // Missing/bad catalogue fails cleanly before BM/QT and does NOT consume token
        hkLoaderImpl = () => ({ items: [{ k: 'hk:148', s: 0, bo: 'dinhNghiep' }] });
        const rBadCatalogue = await request({
          method: 'POST',
          headers: levelHeaders,
          body: new URLSearchParams({ action: 'dinh-nghiep', o: '0', mk2: '123456', dnToken: dnToken1 }).toString(),
        });
        assert.equal(rBadCatalogue.status, 500);
        assert.equal(bmLamCalls.length, 0);
        assert.equal(qtCalls.length, 0);
        hkLoaderImpl = () => fakeHoangKim;

        // Wrong MK2 does not call QT, does not echo PIN, still unlocks page, and does NOT consume token
        bmLamImpl = () => { const e = new Error('Sai mã khóa 2 777777'); e.code = 403; throw e; };
        const rWrongPinDn = await request({
          method: 'POST',
          headers: levelHeaders,
          body: new URLSearchParams({ action: 'dinh-nghiep', o: '0', mk2: '777777', dnToken: dnToken1 }).toString(),
        });
        assert.equal(rWrongPinDn.status, 403);
        assert.equal(bmKhoaCalls.length, 1);
        assert.equal(qtCalls.length, 0);
        assert.doesNotMatch(rWrongPinDn.body, /777777/);
        const dnTokenAfterWrongPin = extractDnToken(rWrongPinDn.body);

        // Cross-session token rejected
        dnPhien = 'dn-sess-2';
        bmLamImpl = (actor, payload, ctx) => { callOrder.push('lam'); bmLamCalls.push({ actor, payload, ctx }); };
        const rCrossSessDn = await request({
          method: 'POST',
          headers: levelHeaders,
          body: new URLSearchParams({ action: 'dinh-nghiep', o: '0', mk2: '123456', dnToken: dnToken1 }).toString(),
        });
        assert.equal(rCrossSessDn.status, 409);
        assert.equal(qtCalls.length, 0);
        dnPhien = 'dn-sess-1';

        // Success: exact BM.lam -> BM.chan -> QT.lam('qua', admin, { ten: admin.ten, o, mon }, {}), BM.khoaTrang in finally, receipt keeps panel accessible
        bmLamCalls = []; bmChanCalls = []; bmKhoaCalls = []; callOrder.length = 0;
        const okDnBody = new URLSearchParams({ action: 'dinh-nghiep', o: '2', mk2: '123456', dnToken: dnTokenAfterWrongPin }).toString();
        const rOkDn = await request({ method: 'POST', headers: levelHeaders, body: okDnBody });
        assert.equal(rOkDn.status, 200);
        assert.deepEqual(callOrder, ['lam', 'chan', 'qt']);
        assert.equal(bmLamCalls[0].payload.viec, 'mo');
        assert.equal(bmLamCalls[0].payload.mk, '123456');
        const expectedMon = [
          { k: 'hk:148', he: 0, dong: 0 },
          { k: 'hk:149', he: 4, dong: 0 },
          { k: 'hk:150', he: 3, dong: 0 },
          { k: 'hk:151', he: 1, dong: 0 },
          { k: 'hk:152', he: 2, dong: 0 },
          { k: 'hk:153', he: 2, dong: 0 },
        ];
        assert.deepEqual(bmChanCalls, [{
          actor: { ten: 'admin_root', admin: true, batDoiMk: false, phien: 'dn-sess-1' },
          trang: bmLamCalls[0].ctx.trang,
          route: '/api/quan-tri/qua',
          method: 'POST',
          body: { ten: 'admin_root', o: 2, mon: expectedMon },
        }]);
        assert.deepEqual(qtCalls, [{
          cmd: 'qua',
          actor: { ten: 'admin_root', admin: true, batDoiMk: false, phien: 'dn-sess-1' },
          payload: { ten: 'admin_root', o: 2, mon: expectedMon },
          ctx: {},
        }]);
        assert.deepEqual(bmKhoaCalls, [{ tenAdmin: 'admin_root', trang: bmLamCalls[0].ctx.trang }]);
        assert.match(rOkDn.body, /<a class="nav-link" href="\/admin\/tao-tai-khoan\?muc=hoang-kim" aria-current="page">Cấp Hoàng Kim<\/a>/);
        assert.match(rOkDn.body, /Cấp Hoàng Kim/);
        assert.match(rOkDn.body, /id="dn-slot" name="o"/);
        assert.match(rOkDn.body, /<option value="2" selected>/);
        assert.doesNotMatch(rOkDn.body, /123456|<section class="panel[^"]*(panel-create|panel-cap|panel-xu)/);

        // Replay of consumed token rejected with no mutation
        const rReplayDn = await request({ method: 'POST', headers: levelHeaders, body: okDnBody });
        assert.equal(rReplayDn.status, 409);
        assert.equal(qtCalls.length, 1);

        // Single selected Hoàng Kim item: invalid/unknown key rejected without BM/QT or consuming token; valid item granted via QT.lam('qua', ...)
        const dnTokenSingle = extractDnToken(rOkDn.body);
        bmLamCalls = []; bmChanCalls = []; bmKhoaCalls = []; qtCalls = []; callOrder.length = 0;

        const rBadShapeHk = await request({
          method: 'POST',
          headers: levelHeaders,
          body: new URLSearchParams({ action: 'dinh-nghiep', o: '0', mk2: '123456', dnToken: dnTokenSingle, hkChoice: 'bad-key' }).toString(),
        });
        assert.equal(rBadShapeHk.status, 400);
        assert.equal(bmLamCalls.length, 0);
        assert.equal(qtCalls.length, 0);

        const rUnknownHk = await request({
          method: 'POST',
          headers: levelHeaders,
          body: new URLSearchParams({ action: 'dinh-nghiep', o: '0', mk2: '123456', dnToken: dnTokenSingle, hkChoice: 'hk:99999' }).toString(),
        });
        assert.equal(rUnknownHk.status, 400);
        assert.equal(bmLamCalls.length, 0);
        assert.equal(qtCalls.length, 0);

        // Token preserved after invalid item rejections; valid selected item succeeds
        qtImpl = (cmd, actor, payload, ctx) => {
          callOrder.push('qt');
          qtCalls.push({ cmd, actor, payload, ctx });
          return { msg: 'Đã cấp An Bang <Thử> cho <GMMain>' };
        };
        const rOkSingleHk = await request({
          method: 'POST',
          headers: levelHeaders,
          body: new URLSearchParams({ action: 'dinh-nghiep', o: '0', mk2: '123456', dnToken: dnTokenSingle, hkChoice: 'hk:217' }).toString(),
        });
        assert.equal(rOkSingleHk.status, 200);
        assert.deepEqual(callOrder, ['lam', 'chan', 'qt']);
        assert.deepEqual(bmChanCalls, [{
          actor: { ten: 'admin_root', admin: true, batDoiMk: false, phien: 'dn-sess-1' },
          trang: bmLamCalls[0].ctx.trang,
          route: '/api/quan-tri/qua',
          method: 'POST',
          body: { ten: 'admin_root', o: 0, mon: [{ k: 'hk:217', he: 4, dong: 0 }] },
        }]);
        assert.deepEqual(qtCalls, [{
          cmd: 'qua',
          actor: { ten: 'admin_root', admin: true, batDoiMk: false, phien: 'dn-sess-1' },
          payload: { ten: 'admin_root', o: 0, mon: [{ k: 'hk:217', he: 4, dong: 0 }] },
          ctx: {},
        }]);
        assert.deepEqual(bmKhoaCalls, [{ tenAdmin: 'admin_root', trang: bmLamCalls[0].ctx.trang }]);
        assert.match(rOkSingleHk.body, /<option value="hk:217" selected>/);
        assert.match(rOkSingleHk.body, /<a class="nav-link" href="\/admin\/tao-tai-khoan\?muc=hoang-kim" aria-current="page">Cấp Hoàng Kim<\/a>/);
        assert.doesNotMatch(rOkSingleHk.body, /123456/);
      }

      // 15. Legacy no-query POST for action=cap retains cap view even without ?muc=cap; action=tim without ?muc defaults to cap view
      {
        tkMap.player1 = {
          ten: 'player1',
          admin: false,
          nv: [{ name: '<TieuLong>', lvl: 12, xu: 500 }],
        };
        tkPhienImpl = () => ({ ten: 'admin_root', admin: true, batDoiMk: false });
        bmLamImpl = () => {};
        bmChanImpl = () => null;
        qtImpl = (cmd, actor, payload, ctx) => {
          tkMap.player1.nv[0].lvl = payload.lv;
          return { msg: `Đã tăng cấp ${payload.ten}` };
        };
        const rLegacyTim = await request({ method: 'POST', reqPath: ROUTE_PATH, headers: levelHeaders, body: 'action=tim&ten=player1' });
        assert.equal(rLegacyTim.status, 200);
        assert.match(rLegacyTim.body, /<a class="nav-link" href="\/admin\/tao-tai-khoan\?muc=cap" aria-current="page">Tăng cấp<\/a>/);
        assert.match(rLegacyTim.body, /<section class="panel panel-player panel-cap"/);
        const rLegacyCap = await request({
          method: 'POST',
          reqPath: ROUTE_PATH,
          headers: levelHeaders,
          body: new URLSearchParams({ action: 'cap', ten: 'player1', o: '0', lv: '20', tenNv: '<TieuLong>', lvHienTai: '12', mk2: '123456' }).toString(),
        });
        assert.equal(rLegacyCap.status, 200);
        assert.match(rLegacyCap.body, /<a class="nav-link" href="\/admin\/tao-tai-khoan\?muc=cap" aria-current="page">Tăng cấp<\/a>/);
        assert.match(rLegacyCap.body, /<section class="panel panel-player panel-cap"/);
        assert.doesNotMatch(rLegacyCap.body, /<section class="panel[^"]*(panel-create|panel-xu|panel-dn)/);
      }

      // 16. Content-Type / 415 handling: standard MIME params including quoted UTF-8 succeed; missing/wrong/non-UTF-8 fail 415 with Vietnamese recovery GET link, no mutation, no PIN echo
      {
        tkMap.player1 = {
          ten: 'player1',
          admin: false,
          nv: [{ name: '<TieuLong>', lvl: 12, xu: 500 }],
        };
        tkPhienImpl = () => ({ ten: 'admin_root', admin: true, batDoiMk: false, phien: 'ct-sess-1' });
        bmLamImpl = () => {};
        bmChanImpl = () => null;
        qtCalls = [];
        qtImpl = (cmd, actor, payload, ctx) => {
          qtCalls.push({ cmd, actor, payload, ctx });
          return { msg: `Đã tăng cấp ${payload.ten}` };
        };

        const quotedUtf8Headers = {
          'x-volam-admin-proxy': validSecret,
          'x-userinfo': validUserInfo,
          origin: TEST_ORIGIN,
          'content-type': 'application/x-www-form-urlencoded; charset="UTF-8"',
        };
        const rQuoted = await request({
          method: 'POST',
          reqPath: `${ROUTE_PATH}?muc=cap`,
          headers: quotedUtf8Headers,
          body: 'action=tim&ten=player1',
        });
        assert.equal(rQuoted.status, 200);
        assert.match(rQuoted.body, /&lt;TieuLong&gt;/);

        const badContentTypes = [
          undefined,
          '',
          'multipart/form-data; boundary=abc',
          'application/json',
          'application/x-www-form-urlencoded; charset=latin1',
          'application/x-www-form-urlencoded; charset="iso-8859-1"',
          'application/x-www-form-urlencoded; charset=utf-8; charset=utf-8',
        ];
        for (const badCt of badContentTypes) {
          const headers = {
            'x-volam-admin-proxy': validSecret,
            'x-userinfo': validUserInfo,
            origin: TEST_ORIGIN,
          };
          if (badCt !== undefined) headers['content-type'] = badCt;
          const r415 = await request({
            method: 'POST',
            reqPath: `${ROUTE_PATH}?muc=xu`,
            headers,
            body: new URLSearchParams({ action: 'xu', ten: 'player1', o: '0', xu: '100', mk2: '987654' }).toString(),
          });
          assert.equal(r415.status, 415);
          assert.equal(qtCalls.length, 0);
          assert.match(r415.body, /HTTP 415/);
          assert.match(r415.body, /<a class="banner-link" href="\/admin\/tao-tai-khoan\?muc=xu">Mở lại trang hiện tại<\/a>/);
          assert.match(r415.body, /<a class="nav-link" href="\/admin\/tao-tai-khoan\?muc=xu" aria-current="page">Cộng Xu<\/a>/);
          assert.doesNotMatch(r415.body, /987654/);
        }
      }

      console.log('ALL_SELF_CHECKS_PASSED');
    } finally {
      server.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

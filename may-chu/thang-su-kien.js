"use strict";

// Event core cho Noel (tháng 12) và Tết (tháng 1) — tách biệt hoàn toàn với túi đồ/lưu trữ.
// Mọi thao tác trả về deltas để caller tích hợp vào bag/exp/gold và kiểm tra sức chứa.

const FMT_VN = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const NOEL_BOX = [
  ["noelHoaTuyet", 60],
  ["noelCanhThong", 10],
  ["noelCaRot", 10],
  ["noelNon", 9],
  ["noelKhanXanh", 8],
  ["noelKhanDo", 2],
  ["noelCayThong", 1],
];

const TET_BOX = [
  ["tetLa", 60],
  ["tetNep", 25],
  ["tetDau", 10],
  ["tetThit", 5],
];

const RECIPES = {
  noelV5Thuong: {
    kind: "noel",
    in: [
      ["noelHoaTuyet", 5],
      ["noelCanhThong", 2],
      ["noelCaRot", 1],
      ["noelNon", 1],
    ],
    gold: 0,
    out: "noelV5NguoiTuyet",
  },
  noelV5Xanh: {
    kind: "noel",
    in: [
      ["noelHoaTuyet", 5],
      ["noelCanhThong", 2],
      ["noelCaRot", 1],
      ["noelNon", 1],
      ["noelKhanXanh", 1],
    ],
    gold: 0,
    out: "noelV5NguoiTuyetXanh",
  },
  noelV5Do: {
    kind: "noel",
    in: [
      ["noelHoaTuyet", 5],
      ["noelCanhThong", 2],
      ["noelCaRot", 1],
      ["noelNon", 1],
      ["noelKhanDo", 1],
    ],
    gold: 0,
    out: "noelV5NguoiTuyetDo",
  },
  noelV5ThuongDB: {
    kind: "noel",
    in: [
      ["noelHoaTuyet", 5],
      ["noelCanhThong", 2],
      ["noelCaRot", 1],
      ["noelNon", 1],
      ["noelCayThong", 1],
    ],
    gold: 10000,
    out: "noelV5NguoiTuyetDB",
  },
  noelV5XanhDB: {
    kind: "noel",
    in: [
      ["noelHoaTuyet", 5],
      ["noelCanhThong", 2],
      ["noelCaRot", 1],
      ["noelNon", 1],
      ["noelKhanXanh", 1],
      ["noelCayThong", 1],
    ],
    gold: 20000,
    out: "noelV5NguoiTuyetXanhDB",
  },
  noelV5DoDB: {
    kind: "noel",
    in: [
      ["noelHoaTuyet", 5],
      ["noelCanhThong", 2],
      ["noelCaRot", 1],
      ["noelNon", 1],
      ["noelKhanDo", 1],
      ["noelCayThong", 1],
    ],
    gold: 20000,
    out: "noelV5NguoiTuyetDoDB",
  },
  tetThuong: {
    kind: "tet",
    in: [
      ["tetLa", 4],
      ["tetNep", 3],
      ["tetDau", 2],
      ["tetThit", 1],
    ],
    gold: 20000,
    out: "tetBanhThuong",
  },
  tetHao: {
    kind: "tet",
    in: [
      ["tetLa", 4],
      ["tetNep", 3],
      ["tetDau", 2],
      ["tetThit", 1],
      ["tetBiQuyetHao", 1],
    ],
    gold: 0,
    out: "tetBanhHao",
  },
  tetThuongHang: {
    kind: "tet",
    in: [
      ["tetLa", 4],
      ["tetNep", 3],
      ["tetDau", 2],
      ["tetThit", 1],
      ["tetBiQuyetThuong", 1],
    ],
    gold: 0,
    out: "tetBanhThuongHang",
  },
  tetMuaBiQuyetHao: {
    kind: "tet",
    in: [],
    gold: 100000,
    out: "tetBiQuyetHao",
  },
  tetMuaBiQuyetThuong: {
    kind: "tet",
    in: [],
    gold: 200000,
    out: "tetBiQuyetThuong",
  },
};

const ITEM_USE = {
  tetBanhThuong: {
    kind: "tet",
    tier: "normal",
    exp: 1000000,
    pool: [
      { k: "ms:147:2", n: 1, w: 30 },
      { k: "tetMatNaDauOngDia", n: 1, w: 30 },
      { k: "tetMatNaNamSu", n: 1, w: 30 },
      { k: "tetMatNaBacSi", n: 1, w: 30 },
    ],
  },
  tetBanhHao: {
    kind: "tet",
    tier: "hao",
    exp: 3000000,
    pool: [
      { k: "ms:71", n: 1, w: 3 },
      { k: "ms:124", n: 1, w: 2 },
      { k: "ms:123", n: 1, w: 5 },
      { k: "ms:122", n: 1, w: 10 },
      { k: "ms:147:3", n: 1, w: 30 },
      { k: "tetMatNaDauOngDia", n: 1, w: 30 },
      { k: "tetMatNaNamSu", n: 1, w: 30 },
      { k: "tetMatNaBacSi", n: 1, w: 30 },
    ],
  },
  tetBanhThuongHang: {
    kind: "tet",
    tier: "special",
    special: true,
    exp: 5000000,
    pool: [
      { k: "ms:71", n: 1, w: 3 },
      { k: "ms:124", n: 1, w: 2 },
      { k: "ms:123", n: 1, w: 5 },
      { k: "ms:122", n: 1, w: 10 },
      { k: "ms:147:4", n: 1, w: 30 },
      { k: "ms:1181", n: 1, w: 0.5 },
      { k: "qk:489", n: 1, w: 0.1 },
      { k: "qk:353", n: 1, w: 0.005 },
      { k: "qk:238", n: 1, w: 0.005 },
      { k: "qk:239", n: 1, w: 0.005 },
      { k: "qk:240", n: 1, w: 0.005 },
      { k: "tetMatNaDauOngDia", n: 1, w: 30 },
      { k: "tetMatNaNamSu", n: 1, w: 30 },
      { k: "tetMatNaBacSi", n: 1, w: 30 },
    ],
  },
};

const MILESTONES = {
  1: {
    threshold: 1000,
    gold: 1000000,
    exp: 10000000,
    pool: [
      { k: "ms:71", n: 1 },
      { k: "ms:122", n: 1 },
      { k: "ms:147:2", n: 3 },
    ],
  },
  2: {
    threshold: 1500,
    gold: 2000000,
    exp: 20000000,
    pool: [
      { k: "ms:71", n: 2 },
      { k: "ms:123", n: 1 },
      { k: "ms:147:4", n: 3 },
    ],
  },
  3: {
    threshold: 2000,
    gold: 5000000,
    exp: 50000000,
    pool: [
      { k: "ms:71", n: 5 },
      { k: "ms:124", n: 3 },
      { k: "ms:147:5", n: 3 },
      { k: "ms:1181", n: 1 },
      { k: "qk:353", n: 1 },
      { k: "qk:238", n: 1 },
      { k: "qk:239", n: 1 },
      { k: "qk:240", n: 1 },
    ],
  },
};

const KIND_MONTH = { noel: 12, tet: 1 };
const BOX_ITEMS = { noel: "noelHop", tet: "tetHop" };
const BOX_TABLE = { noel: NOEL_BOX, tet: TET_BOX };
const TIER_USE_CAP = { normal: 1000, hao: 1000, special: 2000 };

// Runtime config; inert mặc định trừ khi caller cấu hình hoặc test ghi đè qua cf()
let _cfg = {
  bat: false,
  thang: null,
  drop: { bat: false, tiLe: 0 },
  noelVer5: { bat: false },
};

const EXPIRY_FIELDS = ["het", "hetHan", "han", "hanDung", "hanSuDung", "expiresAt", "expireAt", "expiredAt"];

function own(obj, key) {
  return obj != null && typeof obj === "object" && Object.hasOwn(obj, key);
}

function normalizeNow(now) {
  if (now == null) return Date.now();
  if (now instanceof Date) {
    const ts = now.getTime();
    return Number.isFinite(ts) ? ts : NaN;
  }
  if (typeof now === "number") return Number.isFinite(now) ? now : NaN;
  if (typeof now === "string" && now.trim() !== "") {
    const num = Number(now);
    if (Number.isFinite(num)) return num;
    const parsed = Date.parse(now);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

function cf(next) {
  if (next && typeof next === "object") {
    const nextBat = own(next, "bat") ? !!next.bat : _cfg.bat;
    let nextThang = _cfg.thang;
    if (own(next, "thang")) {
      if (next.thang == null || typeof next.thang === "boolean") {
        nextThang = null;
      } else {
        const m = Number(next.thang);
        nextThang = Number.isInteger(m) && m >= 1 && m <= 12 ? m : null;
      }
    }
    let nextDrop = _cfg.drop;
    if (own(next, "drop") && next.drop && typeof next.drop === "object") {
      const d = next.drop;
      const dropBat = own(d, "bat") ? !!d.bat : _cfg.drop.bat;
      let dropRate = _cfg.drop.tiLe;
      if (own(d, "tiLe")) {
        const rawRate =
          d.tiLe == null || typeof d.tiLe === "boolean" || (typeof d.tiLe === "string" && d.tiLe.trim() === "")
            ? NaN
            : Number(d.tiLe);
        dropRate = Number.isFinite(rawRate) && rawRate >= 0 && rawRate <= 1 ? rawRate : 0;
      }
      nextDrop = { bat: dropBat, tiLe: dropRate };
    }
    let nextNoelVer5 = _cfg.noelVer5;
    if (own(next, "noelVer5")) {
      const nv5 = next.noelVer5;
      nextNoelVer5 = {
        bat: !!nv5 && typeof nv5 === "object" && !Array.isArray(nv5) && own(nv5, "bat") && nv5.bat === true,
      };
    }
    _cfg = {
      bat: nextBat,
      thang: nextThang,
      drop: { ...nextDrop },
      noelVer5: { bat: !!(nextNoelVer5 && nextNoelVer5.bat === true) },
    };
  }
  return {
    ..._cfg,
    drop: { ...(_cfg.drop || { bat: false, tiLe: 0 }) },
    noelVer5: { bat: !!(_cfg.noelVer5 && _cfg.noelVer5.bat === true) },
  };
}

function vnParts(now) {
  const ts = normalizeNow(now);
  const d = new Date(Number.isFinite(ts) ? ts : Date.now());
  const parts = FMT_VN.formatToParts(d);
  const out = {};
  for (const p of parts) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out;
}

function activeMonth(now) {
  const C = cf();
  if (C.thang != null && Number.isInteger(Number(C.thang))) {
    return Number(C.thang);
  }
  return vnParts(now).month;
}

// Trạng thái hoạt động event: trả về boolean hoặc chi tiết nếu caller cần
function dang(kind, now) {
  const C = cf();
  const ts = normalizeNow(now);
  if (!Number.isFinite(ts)) return false;
  const noel = C.noelVer5.bat && vnParts(ts).month === KIND_MONTH.noel;
  const tet = C.bat && activeMonth(ts) === KIND_MONTH.tet;
  if (kind != null) return kind === "noel" ? noel : kind === "tet" && tet;
  return noel ? "noel" : tet ? "tet" : false;
}

function getLevel(h) {
  if (!h || typeof h !== "object" || !own(h, "lvl") || h.lvl == null || typeof h.lvl === "boolean") {
    return NaN;
  }
  if (typeof h.lvl === "string" && h.lvl.trim() === "") return NaN;
  const lvl = Number(h.lvl);
  return Number.isFinite(lvl) ? lvl : NaN;
}

function getGold(h) {
  if (!h || typeof h !== "object") return NaN;
  const hasTien = own(h, "tien") && h.tien != null;
  const hasGold = own(h, "gold") && h.gold != null;
  if (!hasTien && !hasGold) return 0;
  const raw = hasTien ? h.tien : h.gold;
  if (typeof raw === "boolean" || (typeof raw === "string" && raw.trim() === "")) return NaN;
  const g = Number(raw);
  return Number.isFinite(g) ? g : NaN;
}

function checkHero(h, kind, now) {
  if (!h || typeof h !== "object") return { ok: false, msg: "Thiếu dữ liệu nhân vật" };
  const ts = normalizeNow(now);
  if (!Number.isFinite(ts)) return { ok: false, msg: "Thời gian không hợp lệ" };
  if (!dang(kind, ts)) return { ok: false, msg: "Sự kiện hiện không hoạt động" };
  const lvl = getLevel(h);
  if (!Number.isFinite(lvl) || lvl < 50) return { ok: false, msg: "Yêu cầu nhân vật đạt cấp 50 trở lên" };
  if (!Number.isFinite(getGold(h))) return { ok: false, msg: "Ngân lượng nhân vật không hợp lệ" };
  return { ok: true };
}

function isItemExpired(it, nowTs) {
  if (!it || typeof it !== "object") return true;
  if (own(it, "expired") && it.expired === true) return true;
  for (const field of EXPIRY_FIELDS) {
    if (!own(it, field) || it[field] == null) continue;
    const raw = it[field];
    let expTs = NaN;
    if (raw instanceof Date) {
      expTs = raw.getTime();
    } else if (typeof raw === "number") {
      expTs = raw;
    } else if (typeof raw === "string" && raw.trim() !== "") {
      const num = Number(raw);
      expTs = Number.isFinite(num) ? num : Date.parse(raw);
    }
    if (!Number.isFinite(expTs) || expTs <= nowTs) return true;
  }
  return false;
}

function getCount(h, key, now) {
  if (!h || typeof h !== "object" || typeof key !== "string") return 0;
  const ts = normalizeNow(now);
  if (!Number.isFinite(ts)) return 0;
  if (typeof h.demMon === "function") {
    // Caller-supplied demMon(key, now) must validate item expiry against normalized now.
    const n = Number(h.demMon(key, ts));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  if (Array.isArray(h.bag)) {
    let sum = 0;
    for (const it of h.bag) {
      if (!it || typeof it !== "object" || !own(it, "k") || it.k !== key) continue;
      if (isItemExpired(it, ts)) continue;
      const qty = own(it, "n") && it.n != null ? Number(it.n) : 1;
      if (Number.isFinite(qty) && qty > 0) sum += qty;
    }
    return sum;
  }
  return 0;
}

function checkBagCapacity(h, addItems, removeItems) {
  if (!h || typeof h !== "object" || typeof h.duCho !== "function") {
    return { ok: false, msg: "Thiếu kiểm tra sức chứa hành trang" };
  }
  if (!h.duCho(addItems, removeItems)) {
    return { ok: false, msg: "Hành trang không đủ chỗ" };
  }
  return { ok: true };
}

function pickWeighted(entries, randomFn) {
  const r = typeof randomFn === "function" ? Number(randomFn()) : Math.random();
  let total = 0;
  for (const [, w] of entries) total += w;
  let acc = 0;
  const target = (Number.isFinite(r) ? Math.max(0, Math.min(0.999999999999, r)) : 0) * total;
  for (const [key, w] of entries) {
    acc += w;
    if (target < acc) return key;
  }
  return entries[entries.length - 1][0];
}

function pickUniform(arr, randomFn) {
  const r = typeof randomFn === "function" ? Number(randomFn()) : Math.random();
  let total = 0;
  for (const item of arr) {
    const w = item && own(item, "w") && item.w != null ? Number(item.w) : 1;
    if (Number.isFinite(w) && w > 0) total += w;
  }
  const target = (Number.isFinite(r) ? Math.max(0, Math.min(0.999999999999, r)) : 0) * total;
  let acc = 0;
  for (const item of arr) {
    const w = item && own(item, "w") && item.w != null ? Number(item.w) : 1;
    if (!Number.isFinite(w) || w <= 0) continue;
    acc += w;
    if (target < acc) return item;
  }
  return arr[arr.length - 1];
}

const { randomInt } = require("node:crypto");
const { THUONG_NOEL_V5, MOC_NOEL_V5, chonThuongNoel } = require("./pgaming-noel.js");

const NOEL_V5_DB_CAPS = {
  noelV5NguoiTuyetDB: THUONG_NOEL_V5.noelV5NguoiTuyetDB.cap,
  noelV5NguoiTuyetXanhDB: THUONG_NOEL_V5.noelV5NguoiTuyetXanhDB.cap,
  noelV5NguoiTuyetDoDB: THUONG_NOEL_V5.noelV5NguoiTuyetDoDB.cap,
};
const NOEL_V5_DAILY_CAPS = {
  noelV5NguoiTuyet: 5,
  noelV5NguoiTuyetXanh: 5,
  noelV5NguoiTuyetDo: 5,
};

function normalizeVer5Entry(rawVer5) {
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  if (!isObj(rawVer5) || Object.keys(rawVer5).length === 0) return null;

  const rawUsed = own(rawVer5, "used") && isObj(rawVer5.used) ? rawVer5.used : null;
  const rawDaily = own(rawVer5, "daily") && isObj(rawVer5.daily) ? rawVer5.daily : null;
  const rawClaimed = own(rawVer5, "claimed") && isObj(rawVer5.claimed) ? rawVer5.claimed : null;

  let day = null;
  if (rawDaily && own(rawDaily, "day") && typeof rawDaily.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawDaily.day)) {
    const y = Number(rawDaily.day.slice(0, 4));
    const m = Number(rawDaily.day.slice(5, 7));
    const d = Number(rawDaily.day.slice(8, 10));
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d) {
      day = rawDaily.day;
    }
  }
  if (!rawUsed && !day && !rawClaimed) return null;

  const readCounts = (src, caps) => {
    const out = {};
    if (!isObj(src)) return out;
    for (const k of Object.keys(caps)) {
      if (!own(src, k)) continue;
      const v = src[k];
      if (typeof v === "number" && Number.isSafeInteger(v) && v >= 1) {
        out[k] = Math.min(v, caps[k]);
      }
    }
    return out;
  };

  const used = readCounts(rawUsed, NOEL_V5_DB_CAPS);
  const daily = day
    ? { day, used: readCounts(own(rawDaily, "used") ? rawDaily.used : null, NOEL_V5_DAILY_CAPS) }
    : { day: null, used: {} };
  const claimed = {};
  if (rawClaimed) {
    for (const tierKey of ["1", "2", "3"]) {
      if (own(rawClaimed, tierKey) && rawClaimed[tierKey] === true) claimed[tierKey] = true;
    }
  }
  return { used, daily, claimed };
}

function normalizeYearEntry(entry, kind) {
  if (!entry || typeof entry !== "object") {
    return { specialUsed: 0, claimed: {} };
  }
  const rawUsed = own(entry, "specialUsed") ? Number(entry.specialUsed) : 0;
  const specialUsed = Number.isFinite(rawUsed) && rawUsed >= 0 ? Math.floor(rawUsed) : 0;
  const claimed = {};
  const rawClaimed = own(entry, "claimed") && entry.claimed && typeof entry.claimed === "object"
    ? entry.claimed
    : null;
  if (rawClaimed) {
    for (const tierKey of Object.keys(MILESTONES)) {
      if (own(rawClaimed, tierKey) && rawClaimed[tierKey] === true) {
        claimed[tierKey] = true;
      }
    }
  }
  const out = { specialUsed, claimed };
  const rawUsedByItem =
    own(entry, "usedByItem") && entry.usedByItem && typeof entry.usedByItem === "object"
      ? entry.usedByItem
      : null;
  if (rawUsedByItem) {
    const usedByItem = {};
    // Giữ số lượt Noel cũ trong save, không dùng để phát thưởng.
    const keys = kind === "noel" ? ["noelNguoiTuyet", "noelNguoiTuyetXanh"] : Object.keys(ITEM_USE).filter((k) => !ITEM_USE[k].special);
    for (const k of keys) {
      if (!own(rawUsedByItem, k)) continue;
      const raw = rawUsedByItem[k];
      if (raw == null || typeof raw === "boolean" || (typeof raw === "string" && raw.trim() === "")) continue;
      const n = Number(raw);
      const count = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 0;
      if (count > 0) usedByItem[k] = count;
    }
    if (Object.keys(usedByItem).length > 0) out.usedByItem = usedByItem;
  }
  if (kind === "noel" && !Array.isArray(entry) && own(entry, "ver5")) {
    const ver5 = normalizeVer5Entry(entry.ver5);
    if (ver5) out.ver5 = ver5;
  }
  return out;
}

function cloneEventState(h) {
  const out = { noel: {}, tet: {} };
  const src =
    h && typeof h === "object" && own(h, "thangSuKien") && h.thangSuKien && typeof h.thangSuKien === "object"
      ? h.thangSuKien
      : null;
  if (!src) return out;
  for (const kind of ["noel", "tet"]) {
    const kindSrc = own(src, kind) && src[kind] && typeof src[kind] === "object" ? src[kind] : null;
    if (!kindSrc) continue;
    for (const yKey of Object.keys(kindSrc)) {
      if (/^\d{4}$/.test(yKey) && kindSrc[yKey] && typeof kindSrc[yKey] === "object") {
        out[kind][yKey] = normalizeYearEntry(kindSrc[yKey], kind);
      }
    }
  }
  return out;
}

function readKindYearState(h, kind, year) {
  const yearKey = String(year);
  const src =
    h && typeof h === "object" && own(h, "thangSuKien") && h.thangSuKien && typeof h.thangSuKien === "object"
      ? h.thangSuKien
      : null;
  const kindSrc = src && own(src, kind) && src[kind] && typeof src[kind] === "object" ? src[kind] : null;
  const entry = kindSrc && own(kindSrc, yearKey) ? kindSrc[yearKey] : null;
  return normalizeYearEntry(entry, kind);
}

function moHop(h, kind, now, randomFn) {
  if (typeof kind !== "string" || !own(BOX_TABLE, kind)) {
    return { ok: false, msg: "Loại hộp không hợp lệ" };
  }
  const auth = checkHero(h, kind, now);
  if (!auth.ok) return auth;

  const boxKey = BOX_ITEMS[kind];
  if (getCount(h, boxKey, now) < 1) {
    return { ok: false, msg: `Không đủ ${boxKey}` };
  }

  const matKey = pickWeighted(BOX_TABLE[kind], randomFn);
  const removeItems = [{ k: boxKey, n: 1 }];
  const addItems = [{ k: matKey, n: 1 }];
  const cap = checkBagCapacity(h, addItems, removeItems);
  if (!cap.ok) return cap;

  return {
    ok: true,
    kind,
    consume: removeItems,
    award: addItems,
    goldDelta: 0,
    expDelta: 0,
  };
}

function che(h, recipeId, now) {
  if (typeof recipeId !== "string" || !own(RECIPES, recipeId)) {
    return { ok: false, msg: "Công thức không tồn tại" };
  }
  const rec = RECIPES[recipeId];
  const auth = checkHero(h, rec.kind, now);
  if (!auth.ok) return auth;

  for (const [k, need] of rec.in) {
    if (getCount(h, k, now) < need) {
      return { ok: false, msg: `Thiếu nguyên liệu ${k} (cần ${need})` };
    }
  }
  const gold = getGold(h);
  if (!Number.isFinite(gold) || (rec.gold > 0 && gold < rec.gold)) {
    return { ok: false, msg: `Không đủ ngân lượng (cần ${rec.gold})` };
  }

  const removeItems = rec.in.map(([k, n]) => ({ k, n }));
  const addItems = [{ k: rec.out, n: 1 }];
  const cap = checkBagCapacity(h, addItems, removeItems);
  if (!cap.ok) return cap;

  return {
    ok: true,
    recipeId,
    kind: rec.kind,
    consume: removeItems,
    award: addItems,
    goldDelta: rec.gold > 0 ? -rec.gold : 0,
    expDelta: 0,
  };
}

function dungNoelVer5DacBiet(h, itemKey, now, randomFn) {
  if (!(cf().noelVer5 && cf().noelVer5.bat === true)) {
    return { ok: false, msg: "Sự kiện hiện không hoạt động" };
  }
  const auth = checkHero(h, "noel", now);
  if (!auth.ok) return auth;

  if (getCount(h, itemKey, now) < 1) {
    return { ok: false, msg: `Không đủ ${itemKey}` };
  }

  const spec = THUONG_NOEL_V5[itemKey];
  const yearKey = String(vnParts(now).year);
  const curYear = readKindYearState(h, "noel", yearKey);
  const usedCount =
    curYear.ver5 && curYear.ver5.used && own(curYear.ver5.used, itemKey)
      ? curYear.ver5.used[itemKey]
      : 0;
  if (usedCount >= spec.cap) {
    return { ok: false, msg: `Đã đạt giới hạn sử dụng ${itemKey} (${usedCount}/${spec.cap})` };
  }

  let roll;
  if (randomFn === undefined) {
    roll = randomInt(1, 10000001);
  } else {
    if (typeof randomFn !== "function") {
      return { ok: false, msg: "Nguồn ngẫu nhiên không hợp lệ" };
    }
    const r = randomFn();
    if (typeof r !== "number" || !Number.isFinite(r) || r < 0 || r >= 1) {
      return { ok: false, msg: "Nguồn ngẫu nhiên không hợp lệ" };
    }
    roll = Math.min(10000000, Math.floor(r * 10000000) + 1);
  }

  const reward = chonThuongNoel(spec.pool, roll);
  const removeItems = [{ k: itemKey, n: 1 }];
  const addItems = reward
    ? [
        own(reward, "hetThang") && reward.hetThang === true
          ? { k: reward.k, n: reward.n, hetThang: true }
          : { k: reward.k, n: reward.n },
      ]
    : [];
  const cap = checkBagCapacity(h, addItems, removeItems);
  if (!cap.ok) return cap;

  const nextEventState = cloneEventState(h);
  const kindYear = normalizeYearEntry(nextEventState.noel[yearKey], "noel");
  const nextVer5 = kindYear.ver5 || { used: {}, daily: { day: null, used: {} }, claimed: {} };
  nextVer5.used[itemKey] = usedCount + 1;
  kindYear.ver5 = nextVer5;
  nextEventState.noel[yearKey] = kindYear;

  return {
    ok: true,
    kind: "noel",
    itemKey,
    tier: "special",
    special: true,
    ver5: true,
    consume: removeItems,
    award: addItems,
    goldDelta: 0,
    expDelta: spec.exp,
    nextEventState,
  };
}

const NOEL_V5_THUONG_TICKS = {
  noelV5NguoiTuyet: 6480,
  noelV5NguoiTuyetXanh: 12960,
  noelV5NguoiTuyetDo: 19440,
};

function dungNoelVer5Thuong(h, itemKey, now) {
  if (!(cf().noelVer5 && cf().noelVer5.bat === true)) {
    return { ok: false, msg: "Sự kiện hiện không hoạt động" };
  }
  if (typeof itemKey !== "string" || !own(NOEL_V5_THUONG_TICKS, itemKey)) {
    return { ok: false, msg: "Vật phẩm sự kiện không hợp lệ" };
  }
  if (!h || typeof h !== "object" || Array.isArray(h)) {
    return { ok: false, msg: "Thiếu dữ liệu nhân vật" };
  }
  const ts = normalizeNow(now);
  if (!Number.isFinite(ts)) {
    return { ok: false, msg: "Thời gian không hợp lệ" };
  }
  if (!dang("noel", ts)) {
    return { ok: false, msg: "Sự kiện hiện không hoạt động" };
  }
  if (getCount(h, itemKey, ts) < 1) {
    return { ok: false, msg: `Không đủ ${itemKey}` };
  }

  const vn = vnParts(ts);
  const yearKey = String(vn.year);
  const dayKey = `${yearKey}-${String(vn.month).padStart(2, "0")}-${String(vn.day).padStart(2, "0")}`;
  const curYear = readKindYearState(h, "noel", yearKey);
  const curDaily = curYear.ver5 && curYear.ver5.daily ? curYear.ver5.daily : null;
  const sameDay = !!(curDaily && curDaily.day === dayKey);
  const usedCount =
    sameDay && curDaily.used && own(curDaily.used, itemKey)
      ? curDaily.used[itemKey]
      : 0;
  const dailyCap = NOEL_V5_DAILY_CAPS[itemKey];
  if (usedCount >= dailyCap) {
    return { ok: false, msg: `Đã đạt giới hạn sử dụng ${itemKey} hôm nay (${usedCount}/${dailyCap})` };
  }

  const nextEventState = cloneEventState(h);
  const kindYear = normalizeYearEntry(nextEventState.noel[yearKey], "noel");
  const nextVer5 = kindYear.ver5 || { used: {}, daily: { day: null, used: {} }, claimed: {} };
  const nextDailyUsed = sameDay && nextVer5.daily && nextVer5.daily.used ? { ...nextVer5.daily.used } : {};
  nextDailyUsed[itemKey] = usedCount + 1;
  nextVer5.daily = { day: dayKey, used: nextDailyUsed };
  kindYear.ver5 = nextVer5;
  nextEventState.noel[yearKey] = kindYear;

  return {
    ok: true,
    kind: "noel",
    itemKey,
    ver5: true,
    special: false,
    consume: [{ k: itemKey, n: 1 }],
    award: [],
    goldDelta: 0,
    expDelta: 0,
    buff440Ticks: NOEL_V5_THUONG_TICKS[itemKey],
    nextEventState,
  };
}

function dung(h, itemKey, now, randomFn) {
  if (typeof itemKey === "string" && own(THUONG_NOEL_V5, itemKey)) {
    return dungNoelVer5DacBiet(h, itemKey, now, randomFn);
  }
  if (typeof itemKey === "string" && own(NOEL_V5_THUONG_TICKS, itemKey)) {
    return dungNoelVer5Thuong(h, itemKey, now);
  }
  if (typeof itemKey !== "string" || !own(ITEM_USE, itemKey)) {
    return { ok: false, msg: "Vật phẩm sự kiện không hợp lệ" };
  }
  const spec = ITEM_USE[itemKey];
  const auth = checkHero(h, spec.kind, now);
  if (!auth.ok) return auth;

  if (getCount(h, itemKey, now) < 1) {
    return { ok: false, msg: `Không đủ ${itemKey}` };
  }

  const yearKey = String(vnParts(now).year);
  const curYear = readKindYearState(h, spec.kind, yearKey);
  const usedCount = spec.special
    ? curYear.specialUsed
    : (curYear.usedByItem && own(curYear.usedByItem, itemKey) ? curYear.usedByItem[itemKey] : 0);
  const useCap = TIER_USE_CAP[spec.tier];
  if (usedCount >= useCap) {
    return { ok: false, msg: `Đã đạt giới hạn sử dụng ${itemKey} (${usedCount}/${useCap})` };
  }

  const reward = pickUniform(spec.pool, randomFn);
  const removeItems = [{ k: itemKey, n: 1 }];
  const addItems = [{ k: reward.k, n: reward.n }];
  const cap = checkBagCapacity(h, addItems, removeItems);
  if (!cap.ok) return cap;

  const nextEventState = cloneEventState(h);
  const kindYear = normalizeYearEntry(nextEventState[spec.kind][yearKey], spec.kind);
  let specialUsed;
  if (spec.special) {
    kindYear.specialUsed += 1;
    specialUsed = kindYear.specialUsed;
  } else {
    if (!kindYear.usedByItem) kindYear.usedByItem = {};
    Object.defineProperty(kindYear.usedByItem, itemKey, {
      value: (own(kindYear.usedByItem, itemKey) ? kindYear.usedByItem[itemKey] : 0) + 1,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  nextEventState[spec.kind][yearKey] = kindYear;

  return {
    ok: true,
    kind: spec.kind,
    itemKey,
    tier: spec.tier,
    special: !!spec.special,
    specialUsed,
    consume: removeItems,
    award: addItems,
    goldDelta: 0,
    expDelta: spec.exp,
    nextEventState,
  };
}

function moc(h, kind, tier, now, randomFn) {
  if (typeof kind !== "string" || !own(KIND_MONTH, kind)) {
    return { ok: false, msg: "Sự kiện không hợp lệ" };
  }
  const table = kind === "noel" ? MOC_NOEL_V5 : MILESTONES;
  const tierValid =
    (typeof tier === "number" && Number.isInteger(tier)) ||
    (typeof tier === "string" && /^\d+$/.test(tier));
  const tierKey = tierValid ? String(tier) : "";
  if (!tierValid || !own(table, tierKey)) {
    return { ok: false, msg: "Mốc thưởng không hợp lệ" };
  }
  const m = table[tierKey];
  const auth = checkHero(h, kind, now);
  if (!auth.ok) return auth;

  const yearKey = String(vnParts(now).year);
  const st = readKindYearState(h, kind, yearKey);
  if (kind === "noel") {
    const v5Claimed = st.ver5 && st.ver5.claimed ? st.ver5.claimed : null;
    if (v5Claimed && own(v5Claimed, tierKey) && v5Claimed[tierKey] === true) {
      return { ok: false, msg: "Đã nhận mốc thưởng này" };
    }
    const redUsed =
      st.ver5 && st.ver5.used && own(st.ver5.used, "noelV5NguoiTuyetDoDB")
        ? st.ver5.used.noelV5NguoiTuyetDoDB
        : 0;
    if (redUsed < m.threshold) {
      return { ok: false, msg: `Chưa đạt mốc ${m.threshold} (hiện tại ${redUsed})` };
    }

    let roll;
    if (randomFn === undefined) {
      roll = randomInt(1, 10000001);
    } else {
      if (typeof randomFn !== "function") {
        return { ok: false, msg: "Nguồn ngẫu nhiên không hợp lệ" };
      }
      const r = randomFn();
      if (typeof r !== "number" || !Number.isFinite(r) || r < 0 || r >= 1) {
        return { ok: false, msg: "Nguồn ngẫu nhiên không hợp lệ" };
      }
      roll = Math.min(10000000, Math.floor(r * 10000000) + 1);
    }

    const reward = chonThuongNoel(m.pool, roll);
    const addItems = reward
      ? [
          own(reward, "nExpiredTime") && reward.nExpiredTime !== undefined
            ? { k: reward.k, n: reward.n, nExpiredTime: reward.nExpiredTime }
            : { k: reward.k, n: reward.n },
        ]
      : [];
    const cap = checkBagCapacity(h, addItems, []);
    if (!cap.ok) return cap;

    const nextEventState = cloneEventState(h);
    const nextKindYear = normalizeYearEntry(nextEventState[kind][yearKey], kind);
    const nextVer5 = nextKindYear.ver5 || { used: {}, daily: { day: null, used: {} }, claimed: {} };
    nextVer5.claimed[tierKey] = true;
    nextKindYear.ver5 = nextVer5;
    nextEventState[kind][yearKey] = nextKindYear;

    return {
      ok: true,
      kind,
      ver5: true,
      tier: Number(tierKey),
      threshold: m.threshold,
      consume: [],
      award: addItems,
      goldDelta: m.gold,
      expDelta: m.exp,
      nextEventState,
    };
  }

  if (st.claimed[tierKey]) {
    return { ok: false, msg: "Đã nhận mốc thưởng này" };
  }
  if (st.specialUsed < m.threshold) {
    return { ok: false, msg: `Chưa đạt mốc ${m.threshold} (hiện tại ${st.specialUsed})` };
  }

  const reward = pickUniform(m.pool, randomFn);
  const addItems = [{ k: reward.k, n: reward.n }];
  const cap = checkBagCapacity(h, addItems, []);
  if (!cap.ok) return cap;

  const nextEventState = cloneEventState(h);
  const nextKindYear = normalizeYearEntry(nextEventState[kind][yearKey], kind);
  nextKindYear.claimed[tierKey] = true;
  nextEventState[kind][yearKey] = nextKindYear;

  return {
    ok: true,
    kind,
    tier: Number(tierKey),
    threshold: m.threshold,
    consume: [],
    award: addItems,
    goldDelta: m.gold,
    expDelta: m.exp,
    nextEventState,
  };
}

function drop(h, zone, now, randomFn) {
  const C = cf();
  const rate = C.drop ? Number(C.drop.tiLe) : 0;
  if (!C.bat || !C.drop || !C.drop.bat || !Number.isFinite(rate) || !(rate > 0 && rate <= 1)) {
    return null;
  }
  const ts = normalizeNow(now);
  if (!Number.isFinite(ts)) return null;
  if (!dang("tet", ts)) return null;
  const lvl = getLevel(h);
  const gold = getGold(h);
  if (!Number.isFinite(lvl) || lvl < 50 || !Number.isFinite(gold)) return null;

  const r = typeof randomFn === "function" ? Number(randomFn()) : Math.random();
  if (!Number.isFinite(r) || !(r >= 0 && r < rate)) return null;

  return {
    ok: true,
    kind: "tet",
    zone: zone ?? null,
    award: [{ k: BOX_ITEMS.tet, n: 1 }],
  };
}

function tomTat(h, now) {
  const C = cf();
  const ts = normalizeNow(now);
  const validTs = Number.isFinite(ts) ? ts : Date.now();
  const vn = vnParts(validTs);
  const noelSt = readKindYearState(h, "noel", vn.year);
  const tetSt = readKindYearState(h, "tet", vn.year);
  const rawRate = C.drop ? Number(C.drop.tiLe) : 0;
  const safeRate = Number.isFinite(rawRate) && rawRate >= 0 && rawRate <= 1 ? rawRate : 0;
  const noel = {
    active: dang("noel", validTs),
    ver5: C.noelVer5.bat,
    specialUsed: noelSt.ver5?.used?.noelV5NguoiTuyetDoDB ?? 0,
    claimed: { ...(noelSt.ver5?.claimed ?? {}) },
  };
  return {
    bat: !!C.bat,
    month: activeMonth(validTs),
    vn,
    noel,
    tet: {
      active: dang("tet", validTs),
      specialUsed: tetSt.specialUsed,
      claimed: { ...tetSt.claimed },
    },
    drop: {
      bat: !!(C.drop && C.drop.bat),
      tiLe: safeRate,
    },
  };
}

module.exports = {
  cf,
  dang,
  moHop,
  che,
  dung,
  moc,
  drop,
  tomTat,
};

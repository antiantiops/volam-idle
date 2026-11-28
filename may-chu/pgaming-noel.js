"use strict";

const VN_OFFSET_MS = 7 * 3600 * 1000;
const BAC_ROI_CHUNG = new Set([10, 20, 30, 40, 50, 60, 70, 80]);
const MAP_BAC_90 = new Set([225, 226, 227, 224, 340, 75, 322, 321, 144, 124, 93]);
const ROI_ROLL_MAX = 1000000;
const ROI_CUTOFF = 20000;
const THANG_NOEL_UTC7 = 11;
const THUONG_ROLL_MAX = 10000000;

function roiHopNoel(thamSo, roll) {
  if (!thamSo || typeof thamSo !== "object" || Array.isArray(thamSo)) return false;
  const { bat, now, cap, bacRoi, map, quaiThuong } = thamSo;
  if (bat !== true || quaiThuong !== true) return false;
  if (typeof now !== "number" || !Number.isFinite(now)) return false;
  if (new Date(now + VN_OFFSET_MS).getUTCMonth() !== THANG_NOEL_UTC7) return false;
  if (!Number.isInteger(cap) || cap < 50) return false;
  if (!Number.isInteger(map) || map < 1) return false;
  if (bacRoi === 90) {
    if (!MAP_BAC_90.has(map)) return false;
  } else if (!BAC_ROI_CHUNG.has(bacRoi)) {
    return false;
  }
  if (!Number.isInteger(roll) || roll < 1 || roll > ROI_ROLL_MAX) return false;
  return roll <= ROI_CUTOFF;
}

function chonThuongNoel(pool, roll) {
  if (!Array.isArray(pool)) return null;
  if (!Number.isInteger(roll) || roll < 1 || roll > THUONG_ROLL_MAX) return null;

  let cumulative = 0;
  let selected = null;
  for (let i = 0; i < pool.length; i += 1) {
    const entry = pool[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const { w } = entry;
    if (typeof w !== "number" || !Number.isFinite(w) || w < 0 || w > 100) return null;
    cumulative += Math.floor((w * THUONG_ROLL_MAX) / 100);
    if (selected === null && roll <= cumulative) {
      selected = entry;
    }
  }
  return selected;
}

const THUONG_NOEL_V5 = {
  noelV5NguoiTuyetDB: {
    exp: 1000000,
    cap: 1000,
    pool: [
      { k: "ms:147:2", n: 1, w: 30 },
      { k: "noelMatNaOngGia", n: 1, w: 30, hetThang: true },
      { k: "noelMatNaThienSu", n: 1, w: 30, hetThang: true },
      { k: "noelMatNaTuanLoc", n: 1, w: 30, hetThang: true },
      { k: "noelMatNaTinhLinh", n: 1, w: 30, hetThang: true },
    ],
  },
  noelV5NguoiTuyetXanhDB: {
    exp: 3000000,
    cap: 1000,
    pool: [
      { k: "ms:71", n: 1, w: 3, hetThang: true },
      { k: "ms:124", n: 1, w: 2 },
      { k: "ms:123", n: 1, w: 5 },
      { k: "ms:122", n: 1, w: 10 },
      { k: "ms:147:3", n: 1, w: 30 },
      { k: "noelMatNaOngGia", n: 1, w: 30, hetThang: true },
      { k: "noelMatNaThienSu", n: 1, w: 30, hetThang: true },
      { k: "noelMatNaTuanLoc", n: 1, w: 30, hetThang: true },
      { k: "noelMatNaTinhLinh", n: 1, w: 30, hetThang: true },
    ],
  },
  noelV5NguoiTuyetDoDB: {
    exp: 5000000,
    cap: 2000,
    pool: [
      { k: "ms:71", n: 1, w: 3, hetThang: true },
      { k: "ms:124", n: 1, w: 2 },
      { k: "ms:123", n: 1, w: 5 },
      { k: "ms:122", n: 1, w: 10 },
      { k: "ms:147:4", n: 1, w: 30 },
      { k: "ms:1181", n: 1, w: 0.5, hetThang: true },
      { k: "qk:489", n: 1, w: 0.1, hetThang: true },
      { k: "qk:353", n: 1, w: 0.005 },
      { k: "qk:238", n: 1, w: 0.005 },
      { k: "qk:240", n: 1, w: 0.005 },
      { k: "qk:239", n: 1, w: 0.005 },
      { k: "ms:1006", n: 1, w: 0.5, hetThang: true },
      { k: "ms:1007", n: 1, w: 0.5, hetThang: true },
      { k: "ms:1008", n: 1, w: 0.5, hetThang: true },
      { k: "ms:1005", n: 1, w: 0.5, hetThang: true },
      { k: "noelMatNaOngGia", n: 1, w: 30, hetThang: true },
      { k: "noelMatNaThienSu", n: 1, w: 30, hetThang: true },
      { k: "noelMatNaTuanLocDacBiet", n: 1, w: 30, hetThang: true },
      { k: "noelMatNaTinhLinh", n: 1, w: 30, hetThang: true },
    ],
  },
};

const MOC_NOEL_V5 = {
  1: {
    threshold: 1000,
    gold: 1000000,
    exp: 10000000,
    pool: [
      { k: "ms:71", n: 1, w: 10, nExpiredTime: 43200 },
      { k: "ms:122", n: 1, w: 30 },
      { k: "ms:147:2", n: 3, w: 60 },
    ],
  },
  2: {
    threshold: 1500,
    gold: 2000000,
    exp: 20000000,
    pool: [
      { k: "ms:71", n: 2, w: 10, nExpiredTime: 43200 },
      { k: "ms:123", n: 1, w: 30 },
      { k: "ms:147:4", n: 3, w: 60 },
    ],
  },
  3: {
    threshold: 2000,
    gold: 5000000,
    exp: 50000000,
    pool: [
      { k: "ms:71", n: 5, w: 40, nExpiredTime: 43200 },
      { k: "ms:124", n: 3, w: 25 },
      { k: "ms:147:5", n: 3, w: 5 },
      { k: "ms:1181", n: 1, w: 5, nExpiredTime: 43200 },
      { k: "qk:353", n: 1, w: 5 },
      { k: "qk:238", n: 1, w: 5 },
      { k: "qk:240", n: 1, w: 5 },
      { k: "qk:239", n: 1, w: 5 },
      { k: "horse:55", n: 1, w: 1 },
      { k: "horse:52", n: 1, w: 1 },
      { k: "horse:54", n: 1, w: 1 },
      { k: "horse:51", n: 1, w: 1 },
      { k: "horse:53", n: 1, w: 1 },
    ],
  },
};

module.exports = { roiHopNoel, chonThuongNoel, THUONG_NOEL_V5, MOC_NOEL_V5 };

if (require.main === module) {
  const assert = require("node:assert/strict");
  const base = {
    bat: true,
    now: Date.UTC(2026, 11, 15, 0, 0, 0, 0),
    cap: 50,
    bacRoi: 10,
    map: 53,
    quaiThuong: true,
  };

  // Probability boundary (1..1000000, cutoff <= 20000)
  assert.equal(roiHopNoel(base, 0), false);
  assert.equal(roiHopNoel(base, 1), true);
  assert.equal(roiHopNoel(base, 20000), true);
  assert.equal(roiHopNoel(base, 20001), false);
  assert.equal(roiHopNoel(base, 1000000), false);
  assert.equal(roiHopNoel(base, 1000001), false);
  assert.equal(roiHopNoel(base, 1.5), false);
  assert.equal(roiHopNoel(base, NaN), false);

  // December UTC+7 edges: 30 Nov 17:00 UTC .. 31 Dec 17:00 UTC exclusive
  assert.equal(roiHopNoel({ ...base, now: Date.UTC(2026, 10, 30, 16, 59, 59, 999) }, 1), false);
  assert.equal(roiHopNoel({ ...base, now: Date.UTC(2026, 10, 30, 17, 0, 0, 0) }, 1), true);
  assert.equal(roiHopNoel({ ...base, now: Date.UTC(2026, 11, 31, 16, 59, 59, 999) }, 1), true);
  assert.equal(roiHopNoel({ ...base, now: Date.UTC(2026, 11, 31, 17, 0, 0, 0) }, 1), false);
  assert.equal(roiHopNoel({ ...base, now: NaN }, 1), false);
  assert.equal(roiHopNoel({ ...base, now: Infinity }, 1), false);
  assert.equal(roiHopNoel({ ...base, now: "2026-12-01" }, 1), false);

  // Map vs bracket checks
  for (const bac of [10, 20, 30, 40, 50, 60, 70, 80]) {
    assert.equal(roiHopNoel({ ...base, bacRoi: bac, map: 1 }, 1), true);
    assert.equal(roiHopNoel({ ...base, bacRoi: bac, map: 999 }, 1), true);
    assert.equal(roiHopNoel({ ...base, bacRoi: bac, map: 0 }, 1), false);
    assert.equal(roiHopNoel({ ...base, bacRoi: bac, map: -1 }, 1), false);
  }
  for (const map90 of [225, 226, 227, 224, 340, 75, 322, 321, 144, 124, 93]) {
    assert.equal(roiHopNoel({ ...base, bacRoi: 90, map: map90 }, 1), true);
  }
  assert.equal(roiHopNoel({ ...base, bacRoi: 90, map: 53 }, 1), false);
  assert.equal(roiHopNoel({ ...base, bacRoi: 90, map: 1 }, 1), false);

  // Level 49 vs 50
  assert.equal(roiHopNoel({ ...base, cap: 49 }, 1), false);
  assert.equal(roiHopNoel({ ...base, cap: 50 }, 1), true);
  assert.equal(roiHopNoel({ ...base, cap: 50.5 }, 1), false);

  // Missing/invalid bracket & opt-in/classification guards
  const { bacRoi: _omitted, ...noBracket } = base;
  assert.equal(roiHopNoel(noBracket, 1), false);
  assert.equal(roiHopNoel({ ...base, bacRoi: 100 }, 1), false);
  assert.equal(roiHopNoel({ ...base, bacRoi: "10" }, 1), false);
  assert.equal(roiHopNoel({ ...base, bat: false }, 1), false);
  assert.equal(roiHopNoel({ ...base, bat: 1 }, 1), false);
  assert.equal(roiHopNoel({ ...base, quaiThuong: false }, 1), false);
  assert.equal(roiHopNoel({ ...base, quaiThuong: 1 }, 1), false);
  assert.equal(roiHopNoel(null, 1), false);
  assert.equal(roiHopNoel([], 1), false);

  // chonThuongNoel: cumulative unnormalized selection (1..10000000)
  const pool150 = Object.freeze(
    [30, 30, 30, 30, 30].map((w, i) => Object.freeze({ id: i + 1, w }))
  );
  assert.equal(chonThuongNoel(pool150, 1), pool150[0]);
  assert.equal(chonThuongNoel(pool150, 3000000), pool150[0]);
  assert.equal(chonThuongNoel(pool150, 3000001), pool150[1]);
  assert.equal(chonThuongNoel(pool150, 9000000), pool150[2]);
  assert.equal(chonThuongNoel(pool150, 9000001), pool150[3]);
  assert.equal(chonThuongNoel(pool150, 10000000), pool150[3]);

  const poolSmall = [{ id: "small", w: 0.005 }];
  assert.equal(chonThuongNoel(poolSmall, 500), poolSmall[0]);
  assert.equal(chonThuongNoel(poolSmall, 501), null);

  const poolZero = [{ id: "z0", w: 0 }, { id: "a", w: 1 }, { id: "z1", w: 0 }, { id: "b", w: 1 }];
  assert.equal(chonThuongNoel(poolZero, 1), poolZero[1]);
  assert.equal(chonThuongNoel(poolZero, 100000), poolZero[1]);
  assert.equal(chonThuongNoel(poolZero, 100001), poolZero[3]);
  assert.equal(chonThuongNoel(poolZero, 200001), null);

  // Roll & pool/weight validation (fail closed)
  assert.equal(chonThuongNoel(pool150, 0), null);
  assert.equal(chonThuongNoel(pool150, 10000001), null);
  assert.equal(chonThuongNoel(pool150, 1.5), null);
  assert.equal(chonThuongNoel(pool150, NaN), null);
  assert.equal(chonThuongNoel(pool150, "1"), null);
  assert.equal(chonThuongNoel([], 1), null);
  assert.equal(chonThuongNoel(null, 1), null);
  assert.equal(chonThuongNoel({}, 1), null);
  for (const bad of [-0.01, 100.01, NaN, Infinity, -Infinity, "30", null, undefined]) {
    assert.equal(chonThuongNoel([{ w: bad }], 1), null);
    assert.equal(chonThuongNoel([{ w: 50 }, { w: bad }], 1), null);
  }
  assert.equal(chonThuongNoel([{}], 1), null);
  assert.equal(chonThuongNoel([null], 1), null);
  assert.equal(chonThuongNoel([[30]], 1), null);
  assert.equal(chonThuongNoel([30], 1), null);

  // THUONG_NOEL_V5 structure, ordering, hetThang flags, and chonThuongNoel compatibility
  assert.deepEqual(Object.keys(THUONG_NOEL_V5), [
    "noelV5NguoiTuyetDB",
    "noelV5NguoiTuyetXanhDB",
    "noelV5NguoiTuyetDoDB",
  ]);
  const {
    noelV5NguoiTuyetDB: plainSpec,
    noelV5NguoiTuyetXanhDB: greenSpec,
    noelV5NguoiTuyetDoDB: redSpec,
  } = THUONG_NOEL_V5;

  assert.equal(plainSpec.exp, 1000000);
  assert.equal(plainSpec.cap, 1000);
  assert.equal(plainSpec.pool.length, 5);
  assert.equal(greenSpec.exp, 3000000);
  assert.equal(greenSpec.cap, 1000);
  assert.equal(greenSpec.pool.length, 9);
  assert.equal(redSpec.exp, 5000000);
  assert.equal(redSpec.cap, 2000);
  assert.equal(redSpec.pool.length, 19);

  for (const spec of Object.values(THUONG_NOEL_V5)) {
    for (const entry of spec.pool) {
      assert.equal(typeof entry.k, "string");
      assert.equal(entry.n, 1);
      assert.equal(typeof entry.w, "number");
      if ("hetThang" in entry) {
        assert.equal(entry.hetThang, true);
      }
    }
  }

  assert.deepEqual(plainSpec.pool, [
    { k: "ms:147:2", n: 1, w: 30 },
    { k: "noelMatNaOngGia", n: 1, w: 30, hetThang: true },
    { k: "noelMatNaThienSu", n: 1, w: 30, hetThang: true },
    { k: "noelMatNaTuanLoc", n: 1, w: 30, hetThang: true },
    { k: "noelMatNaTinhLinh", n: 1, w: 30, hetThang: true },
  ]);
  assert.deepEqual(
    greenSpec.pool.map((e) => [e.k, e.w, Boolean(e.hetThang)]),
    [
      ["ms:71", 3, true],
      ["ms:124", 2, false],
      ["ms:123", 5, false],
      ["ms:122", 10, false],
      ["ms:147:3", 30, false],
      ["noelMatNaOngGia", 30, true],
      ["noelMatNaThienSu", 30, true],
      ["noelMatNaTuanLoc", 30, true],
      ["noelMatNaTinhLinh", 30, true],
    ]
  );
  assert.deepEqual(
    redSpec.pool.map((e) => [e.k, e.w, Boolean(e.hetThang)]),
    [
      ["ms:71", 3, true],
      ["ms:124", 2, false],
      ["ms:123", 5, false],
      ["ms:122", 10, false],
      ["ms:147:4", 30, false],
      ["ms:1181", 0.5, true],
      ["qk:489", 0.1, true],
      ["qk:353", 0.005, false],
      ["qk:238", 0.005, false],
      ["qk:240", 0.005, false],
      ["qk:239", 0.005, false],
      ["ms:1006", 0.5, true],
      ["ms:1007", 0.5, true],
      ["ms:1008", 0.5, true],
      ["ms:1005", 0.5, true],
      ["noelMatNaOngGia", 30, true],
      ["noelMatNaThienSu", 30, true],
      ["noelMatNaTuanLocDacBiet", 30, true],
      ["noelMatNaTinhLinh", 30, true],
    ]
  );

  // Unreachable entries preserved in array; selection still cuts off at 100%
  assert.equal(chonThuongNoel(plainSpec.pool, 3000000), plainSpec.pool[0]);
  assert.equal(chonThuongNoel(plainSpec.pool, 10000000), plainSpec.pool[3]);
  assert.equal(chonThuongNoel(greenSpec.pool, 5000000), greenSpec.pool[4]);
  assert.equal(chonThuongNoel(greenSpec.pool, 10000000), greenSpec.pool[6]);
  assert.equal(chonThuongNoel(redSpec.pool, 5060001), redSpec.pool[7]);
  assert.equal(chonThuongNoel(redSpec.pool, 10000000), redSpec.pool[16]);
}

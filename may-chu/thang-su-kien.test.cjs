"use strict";

const assert = require("node:assert/strict");
const SK = require("./thang-su-kien.js");

function makeHero(bagEntries = [], lvl = 60, opts = {}) {
  const bag = bagEntries.map(([k, n, extra]) => ({ k, n, ...(extra || {}) }));
  return {
    lvl,
    tien: opts.gold ?? 100000,
    bag,
    duCho: "duCho" in opts ? opts.duCho : () => true,
    thangSuKien: opts.thangSuKien,
  };
}

function consumeFromBag(bag, consume) {
  for (const req of consume || []) {
    let rem = req.n;
    for (const it of bag) {
      if (it && it.k === req.k && rem > 0) {
        const take = Math.min(it.n, rem);
        it.n -= take;
        rem -= take;
      }
    }
    assert.equal(rem, 0);
  }
}

function commitPlan(hero, plan) {
  consumeFromBag(hero.bag, plan.consume);
  if (plan.nextEventState) hero.thangSuKien = plan.nextEventState;
}

// 1. Default inert behavior
assert.equal(SK.cf().bat, false);
assert.equal(SK.dang("noel", Date.UTC(2026, 11, 15, 0, 0, 0)), false);
assert.equal(SK.drop(makeHero(), 1, Date.UTC(2026, 11, 15, 0, 0, 0), () => 0), null);

// 2. Ver5 schedule boundaries in UTC+7; global flag alone never opens Noel.
SK.cf({ bat: true, thang: 12, drop: { bat: true, tiLe: 1 } });
assert.equal(SK.dang("noel", Date.UTC(2026, 11, 15)), false);
assert.equal(SK.drop(makeHero(), 10, Date.UTC(2026, 11, 15), () => 0), null);
SK.cf({ thang: null, drop: { bat: false, tiLe: 0 }, noelVer5: { bat: true } });
// 2026-11-30 16:59:59 UTC == 2026-11-30 23:59:59 VN -> month 11 (inactive)
assert.equal(SK.dang("noel", Date.UTC(2026, 10, 30, 16, 59, 59)), false);
// 2026-11-30 17:00:00 UTC == 2026-12-01 00:00:00 VN -> month 12 (Noel active)
assert.equal(SK.dang("noel", Date.UTC(2026, 10, 30, 17, 0, 0)), true);
assert.equal(SK.dang("tet", Date.UTC(2026, 10, 30, 17, 0, 0)), false);
// 2026-12-31 16:59:59 UTC == 2026-12-31 23:59:59 VN -> still Noel
assert.equal(SK.dang("noel", Date.UTC(2026, 11, 31, 16, 59, 59)), true);
// 2026-12-31 17:00:00 UTC == 2027-01-01 00:00:00 VN -> Noel ends, Tet active
assert.equal(SK.dang("noel", Date.UTC(2026, 11, 31, 17, 0, 0)), false);
assert.equal(SK.dang("tet", Date.UTC(2026, 11, 31, 17, 0, 0)), true);
// 2027-01-31 17:00:00 UTC == 2027-02-01 00:00:00 VN -> Tet ends
assert.equal(SK.dang("tet", Date.UTC(2027, 0, 31, 17, 0, 0)), false);

// 3. Deterministic weighted box outcomes (Noel & Tet)
const decNow = Date.UTC(2026, 11, 15, 5, 0, 0);
const hNoelBox = makeHero([["noelHop", 10]]);
assert.equal(SK.moHop(hNoelBox, "noel", decNow, () => 0.0).award[0].k, "noelHoaTuyet");
assert.equal(SK.moHop(hNoelBox, "noel", decNow, () => 0.5999).award[0].k, "noelHoaTuyet");
assert.equal(SK.moHop(hNoelBox, "noel", decNow, () => 0.60).award[0].k, "noelCanhThong");
assert.equal(SK.moHop(hNoelBox, "noel", decNow, () => 0.70).award[0].k, "noelCaRot");
assert.equal(SK.moHop(hNoelBox, "noel", decNow, () => 0.80).award[0].k, "noelNon");
assert.equal(SK.moHop(hNoelBox, "noel", decNow, () => 0.89).award[0].k, "noelKhanXanh");
assert.equal(SK.moHop(hNoelBox, "noel", decNow, () => 0.97).award[0].k, "noelKhanDo");
assert.equal(SK.moHop(hNoelBox, "noel", decNow, () => 0.995).award[0].k, "noelCayThong");
// Bag was never mutated
assert.equal(hNoelBox.bag[0].n, 10);

const janNow = Date.UTC(2027, 0, 15, 5, 0, 0);
const hTetBox = makeHero([["tetHop", 2]]);
assert.equal(SK.moHop(hTetBox, "tet", janNow, () => 0.59).award[0].k, "tetLa");
assert.equal(SK.moHop(hTetBox, "tet", janNow, () => 0.60).award[0].k, "tetNep");
assert.equal(SK.moHop(hTetBox, "tet", janNow, () => 0.85).award[0].k, "tetDau");
assert.equal(SK.moHop(hTetBox, "tet", janNow, () => 0.95).award[0].k, "tetThit");

// 4. Level check, craft validation & bag capacity guard (fail-closed without duCho)
const lowHero = makeHero([["noelHop", 1]], 49);
assert.equal(SK.moHop(lowHero, "noel", decNow, () => 0).ok, false);

const noCapHero = makeHero([["noelHop", 1]], 60, { duCho: undefined });
assert.equal(SK.moHop(noCapHero, "noel", decNow, () => 0).ok, false);
assert.equal(SK.che(makeHero([["noelHoaTuyet", 5], ["noelCanhThong", 2], ["noelCaRot", 1], ["noelNon", 1]], 60, { duCho: undefined }), "noelV5Thuong", decNow).ok, false);
assert.equal(SK.dung(makeHero([["noelNguoiTuyet", 1]], 60, { duCho: undefined }), "noelNguoiTuyet", decNow, () => 0).ok, false);
assert.equal(SK.moc(makeHero([], 60, { duCho: undefined, thangSuKien: { noel: { 2026: { specialUsed: 1000, claimed: {} } } } }), "noel", 1, decNow, () => 0).ok, false);

// Reject non-finite level/gold and inherited prototype selector keys
assert.equal(SK.moHop(makeHero([["noelHop", 1]], NaN), "noel", decNow, () => 0).ok, false);
assert.equal(SK.moHop(makeHero([["noelHop", 1]], 60, { gold: Infinity }), "noel", decNow, () => 0).ok, false);
assert.equal(SK.moHop(hNoelBox, "toString", decNow, () => 0).ok, false);
assert.equal(SK.che(hNoelBox, "constructor", decNow).ok, false);
assert.equal(SK.dung(hNoelBox, "__proto__", decNow, () => 0).ok, false);
assert.equal(SK.moc(hNoelBox, "valueOf", 1, decNow, () => 0).ok, false);
assert.equal(SK.moc(hNoelBox, "noel", "toString", decNow, () => 0).ok, false);

// Reject expired items in bag fallback & pass normalized now to demMon
const expiredBagHero = makeHero([["noelHop", 1, { het: decNow - 1 }], ["noelNguoiTuyetDo", 1, { expired: true }]]);
assert.equal(SK.moHop(expiredBagHero, "noel", decNow, () => 0).ok, false);
assert.equal(SK.dung(expiredBagHero, "noelNguoiTuyetDo", decNow, () => 0).ok, false);
let seenDemNow = null;
const demHero = makeHero([], 60);
demHero.demMon = (k, nowArg) => {
  seenDemNow = nowArg;
  return k === "noelHop" ? 1 : 0;
};
assert.equal(SK.moHop(demHero, "noel", String(decNow), () => 0).ok, true);
assert.equal(seenDemNow, decNow);

const craftFail = makeHero([["noelHoaTuyet", 4], ["noelCanhThong", 2], ["noelCaRot", 1], ["noelNon", 1]]);
assert.equal(SK.che(craftFail, "noelV5Thuong", decNow).ok, false);

const fullBagHero = makeHero(
  [["noelHoaTuyet", 5], ["noelCanhThong", 2], ["noelCaRot", 1], ["noelNon", 1]],
  60,
  { duCho: () => false }
);
assert.equal(SK.che(fullBagHero, "noelV5Thuong", decNow).ok, false);

const craftOk = makeHero([
  ["noelHoaTuyet", 5],
  ["noelCanhThong", 2],
  ["noelCaRot", 1],
  ["noelNon", 1],
  ["noelKhanDo", 1],
]);
const resCraft = SK.che(craftOk, "noelV5Do", decNow);
assert.equal(resCraft.ok, true);
assert.deepEqual(resCraft.award, [{ k: "noelV5NguoiTuyetDo", n: 1 }]);
assert.equal(resCraft.consume.length, 5);
assert.equal(resCraft.goldDelta, 0);

const tetNormShort = makeHero([["tetLa", 4], ["tetNep", 3], ["tetDau", 2], ["tetThit", 1]], 60, { gold: 19999 });
assert.equal(SK.che(tetNormShort, "tetThuong", janNow).ok, false);
tetNormShort.tien = 20000;
const tetNormOk = SK.che(tetNormShort, "tetThuong", janNow);
assert.equal(tetNormOk.ok, true);
assert.equal(tetNormOk.goldDelta, -20000);
assert.deepEqual(tetNormOk.award, [{ k: "tetBanhThuong", n: 1 }]);

const tetBuyHao = makeHero([], 60, { gold: 99999 });
assert.equal(SK.che(tetBuyHao, "tetMuaBiQuyetHao", janNow).ok, false);
tetBuyHao.tien = 100000;
const tetBuyHaoOk = SK.che(tetBuyHao, "tetMuaBiQuyetHao", janNow);
assert.equal(tetBuyHaoOk.ok, true);
assert.equal(tetBuyHaoOk.goldDelta, -100000);
assert.deepEqual(tetBuyHaoOk.consume, []);
assert.deepEqual(tetBuyHaoOk.award, [{ k: "tetBiQuyetHao", n: 1 }]);

const tetBuyThuong = makeHero([], 60, { gold: 199999 });
assert.equal(SK.che(tetBuyThuong, "tetMuaBiQuyetThuong", janNow).ok, false);
tetBuyThuong.tien = 200000;
const tetBuyThuongOk = SK.che(tetBuyThuong, "tetMuaBiQuyetThuong", janNow);
assert.equal(tetBuyThuongOk.ok, true);
assert.equal(tetBuyThuongOk.goldDelta, -200000);
assert.deepEqual(tetBuyThuongOk.consume, []);
assert.deepEqual(tetBuyThuongOk.award, [{ k: "tetBiQuyetThuong", n: 1 }]);

const tetHaoOk = SK.che(makeHero([["tetLa", 4], ["tetNep", 3], ["tetDau", 2], ["tetThit", 1], ["tetBiQuyetHao", 1]], 60, { gold: 0 }), "tetHao", janNow);
assert.equal(tetHaoOk.ok, true);
assert.equal(tetHaoOk.goldDelta, 0);
assert.equal(tetHaoOk.consume.length, 5);
assert.deepEqual(tetHaoOk.award, [{ k: "tetBanhHao", n: 1 }]);

const tetCraftOk = SK.che(makeHero([["tetLa", 4], ["tetNep", 3], ["tetDau", 2], ["tetThit", 1], ["tetBiQuyetThuong", 1]], 60, { gold: 0 }), "tetThuongHang", janNow);
assert.equal(tetCraftOk.ok, true);
assert.equal(tetCraftOk.goldDelta, 0);
assert.equal(tetCraftOk.consume.length, 5);
assert.deepEqual(tetCraftOk.award, [{ k: "tetBanhThuongHang", n: 1 }]);

// Retired recipes and items never award or mutate state, even in December.
for (const key of ["noelThuong", "noelXanh", "noelDo"]) assert.equal(SK.che(craftOk, key, decNow).msg, "Công thức không tồn tại");
const useHero = makeHero([
  ["noelNguoiTuyet", 1],
  ["noelNguoiTuyetXanh", 1],
  ["noelNguoiTuyetDo", 2],
]);
const oldBag = structuredClone(useHero.bag);
for (const item of oldBag) assert.equal(SK.dung(useHero, item.k, decNow, () => 0).ok, false);
assert.deepEqual(useHero.bag, oldBag);
assert.equal(useHero.thangSuKien, undefined);
// Seasonal per-item caps (1000 normal, 1000 hao, 2000 special), checked before RNG/bag & independent by item/VN year
const capHero = makeHero([
  ["noelNguoiTuyet", 1],
  ["noelNguoiTuyetXanh", 1],
  ["noelNguoiTuyetDo", 1],
  ["tetBanhThuong", 1],
  ["tetBanhHao", 1],
  ["tetBanhThuongHang", 1],
], 60, {
  duCho: () => { throw new Error("bag check should not run when capped"); },
  thangSuKien: {
    noel: {
      2026: {
        specialUsed: 2000,
        claimed: {},
        usedByItem: { noelNguoiTuyet: 1000, noelNguoiTuyetXanh: 999, __proto__: 9999, tetBanhThuong: 5000 },
      },
    },
    tet: {
      2026: {
        specialUsed: 2000,
        claimed: {},
        usedByItem: { tetBanhThuong: 1000, tetBanhHao: 1000 },
      },
    },
  },
});
capHero.duCho = () => true;
// VN year boundary rollover resets Tet in 2027.
const janCapOk = SK.dung(capHero, "tetBanhThuong", janNow, () => 0);
assert.equal(janCapOk.ok, true);
assert.equal(janCapOk.nextEventState.tet["2027"].usedByItem.tetBanhThuong, 1);
assert.equal(SK.dung(capHero, "tetBanhHao", janNow, () => 0).ok, true);
assert.equal(SK.dung(capHero, "tetBanhThuongHang", janNow, () => 0).ok, true);

// Seasonless / old-year state not eligible; stale summary shows zero; next year counts reset
const staleHero = makeHero([["noelNguoiTuyetDo", 1]], 60, {
  thangSuKien: {
    noel: { specialUsed: 2500, claimed: {}, 2025: { specialUsed: 2500, claimed: {} } },
    tet: { 2025: { specialUsed: 1500, claimed: { 1: true } } },
  },
});
const decSum = SK.tomTat(staleHero, decNow);
assert.equal(decSum.noel.specialUsed, 0);
assert.deepEqual(decSum.noel.claimed, {});
assert.equal(decSum.tet.specialUsed, 0);
assert.equal(SK.moc(staleHero, "noel", 1, decNow, () => 0).ok, false);

const janStaleHero = makeHero([], 60, {
  thangSuKien: { tet: { 2026: { specialUsed: 1500, claimed: { 1: true } } } },
});
assert.equal(SK.tomTat(janStaleHero, janNow).tet.specialUsed, 0);
assert.equal(SK.moc(janStaleHero, "tet", 1, janNow, () => 0).ok, false);

const dec2027Now = Date.UTC(2027, 11, 15, 5, 0, 0);
const nextYearSum = SK.tomTat(useHero, dec2027Now);
assert.equal(nextYearSum.noel.specialUsed, 0);
assert.equal(SK.moc(useHero, "noel", 1, dec2027Now, () => 0).ok, false);

// Milestone check & once-only claim via explicit commit; replay blocked
const mileHero = makeHero([], 60, {
  thangSuKien: { noel: {}, tet: { 2027: { specialUsed: 2000, claimed: {} } } },
});
assert.equal(SK.moc(useHero, "tet", 1, janNow, () => 0).ok, false);
mileHero.duCho = () => false;
assert.equal(SK.moc(mileHero, "tet", 1, janNow, () => 0).ok, false);
assert.equal(mileHero.thangSuKien.tet["2027"].claimed[1], undefined);

mileHero.duCho = () => true;
const m1 = SK.moc(mileHero, "tet", 1, janNow, () => 0.9);
assert.equal(m1.ok, true);
assert.equal(m1.goldDelta, 1000000);
assert.equal(m1.expDelta, 10000000);
assert.deepEqual(m1.award, [{ k: "ms:147:2", n: 3 }]);
assert.equal(mileHero.thangSuKien.tet["2027"].claimed[1], undefined); // untouched before commit
assert.equal(m1.nextEventState.tet["2027"].claimed["1"], true);

commitPlan(mileHero, m1);
assert.equal(SK.moc(mileHero, "tet", 1, janNow, () => 0).ok, false); // replay blocked after commit

const m3 = SK.moc(mileHero, "tet", 3, janNow, () => 0.99);
assert.equal(m3.ok, true);
assert.equal(m3.goldDelta, 5000000);
assert.equal(m3.expDelta, 50000000);
assert.deepEqual(m3.award, [{ k: "qk:240", n: 1 }]);
commitPlan(mileHero, m3);
assert.equal(mileHero.thangSuKien.tet["2027"].claimed["1"], true);
assert.equal(mileHero.thangSuKien.tet["2027"].claimed["3"], true);

// 6. Generic drop now serves Tet only; rate limits and bag independence unchanged.
assert.equal(SK.drop(useHero, 10, janNow, () => 0), null);
SK.cf({ drop: { bat: true, tiLe: 1.5 } });
assert.equal(SK.cf().drop.tiLe, 0);
assert.equal(SK.drop(useHero, 10, janNow, () => 0), null);
SK.cf({ drop: { bat: true, tiLe: -0.2 } });
assert.equal(SK.cf().drop.tiLe, 0);

SK.cf({ drop: { bat: true, tiLe: 0.1 } });
assert.equal(SK.drop(useHero, 10, janNow, () => 0.1), null);
const dOk = SK.drop(useHero, 10, janNow, () => 0.05);
assert.equal(dOk.ok, true);
assert.deepEqual(dOk.award, [{ k: "tetHop", n: 1 }]);
const fullNoCapDropHero = makeHero([], 60, { duCho: () => false });
const dFull = SK.drop(fullNoCapDropHero, 10, janNow, () => 0.05);
assert.equal(dFull.ok, true);
assert.deepEqual(dFull.award, [{ k: "tetHop", n: 1 }]);
const dNoCb = SK.drop(makeHero([], 60, { duCho: undefined }), 10, janNow, () => 0.05);
assert.equal(dNoCb.ok, true);

// Restore inert default for clean state
SK.cf({ bat: false, thang: null, drop: { bat: false, tiLe: 0 } });

// 7. Weighted ITEM_USE pools, exact boundary transitions, and custom KTC catalog mask coverage
const fs = require("node:fs");
const path = require("node:path");
const tskCatalog = JSON.parse(fs.readFileSync(path.join(__dirname, "../src/game/thang-su-kien.json"), "utf8"));
const MASK_KEYS = [
  "noelMatNaOngGia",
  "noelMatNaThienSu",
  "noelMatNaTuanLoc",
  "noelMatNaTinhLinh",
  "noelMatNaTuanLocDacBiet",
  "tetMatNaDauOngDia",
  "tetMatNaNamSu",
  "tetMatNaBacSi",
];
for (const mk of MASK_KEYS) {
  assert.ok(Object.hasOwn(tskCatalog, mk), `Missing catalog key ${mk}`);
  assert.equal(tskCatalog[mk].ktc, 1);
  assert.equal(tskCatalog[mk].dung, null);
}

SK.cf({ bat: true, thang: null, drop: { bat: false, tiLe: 0 } });
const poolHero = makeHero([
  ["tetBanhThuong", 10],
  ["tetBanhHao", 10],
  ["tetBanhThuongHang", 10],
]);
const pickItem = (itemKey, now, r) => SK.dung(poolHero, itemKey, now, () => r).award[0].k;

// Exact boundary transitions for all 3 Tet ITEM_USE pools (weights normalized over full pool)
const assertTransitions = (itemKey, now, entries) => {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  assert.equal(pickItem(itemKey, now, 0), entries[0][0]);
  for (let i = 0; i < entries.length - 1; i++) {
    acc += entries[i][1];
    const boundary = acc / total;
    assert.equal(pickItem(itemKey, now, boundary - 1e-12), entries[i][0], `${itemKey} below boundary ${i}`);
    assert.equal(pickItem(itemKey, now, boundary), entries[i + 1][0], `${itemKey} at boundary ${i}`);
  }
  assert.equal(pickItem(itemKey, now, 0.999999999999), entries[entries.length - 1][0]);
};

assertTransitions("tetBanhThuong", janNow, [
  ["ms:147:2", 30],
  ["tetMatNaDauOngDia", 30],
  ["tetMatNaNamSu", 30],
  ["tetMatNaBacSi", 30],
]);
assertTransitions("tetBanhHao", janNow, [
  ["ms:71", 3],
  ["ms:124", 2],
  ["ms:123", 5],
  ["ms:122", 10],
  ["ms:147:3", 30],
  ["tetMatNaDauOngDia", 30],
  ["tetMatNaNamSu", 30],
  ["tetMatNaBacSi", 30],
]);
assertTransitions("tetBanhThuongHang", janNow, [
  ["ms:71", 3],
  ["ms:124", 2],
  ["ms:123", 5],
  ["ms:122", 10],
  ["ms:147:4", 30],
  ["ms:1181", 0.5],
  ["qk:489", 0.1],
  ["qk:353", 0.005],
  ["qk:238", 0.005],
  ["qk:239", 0.005],
  ["qk:240", 0.005],
  ["tetMatNaDauOngDia", 30],
  ["tetMatNaNamSu", 30],
  ["tetMatNaBacSi", 30],
]);

// Verify milestone pools remain uniform (missing w defaults to 1)
assert.equal(SK.moc(mileHero, "tet", 2, janNow, () => 0.33).award[0].k, "ms:71");
assert.equal(SK.moc(mileHero, "tet", 2, janNow, () => 0.34).award[0].k, "ms:123");
assert.equal(SK.moc(mileHero, "tet", 2, janNow, () => 0.67).award[0].k, "ms:147:4");

// Verify each custom mask key is reachable in its intended pool(s)
const reached = new Set();
for (const [itemKey, now, entries] of [
  ["tetBanhThuong", janNow, [["ms:147:2", 30], ["tetMatNaDauOngDia", 30], ["tetMatNaNamSu", 30], ["tetMatNaBacSi", 30]]],
]) {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  for (const [k, w] of entries) {
    reached.add(pickItem(itemKey, now, (acc + w * 0.5) / total));
    acc += w;
  }
}
for (const mk of MASK_KEYS) {
  if (mk.startsWith("tet")) assert.ok(reached.has(mk), `Mask key ${mk} not reachable`);
}

SK.cf({ bat: false, thang: null, drop: { bat: false, tiLe: 0 } });
console.log("thang-su-kien.test.cjs OK");

"use strict";

const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { roiHopNoel } = require("./pgaming-noel.js");
const SK = require("./thang-su-kien.js");

function enableNoelVer5() {
  SK.cf({
    bat: false,
    thang: null,
    drop: { bat: false, tiLe: 0 },
    noelVer5: { bat: true },
  });
}

function commitLedger(hero, plan) {
  for (const req of plan.consume || []) {
    let rem = req.n;
    for (const it of hero.bag) {
      if (it && it.k === req.k && rem > 0) {
        const take = Math.min(it.n, rem);
        it.n -= take;
        rem -= take;
      }
    }
    assert.equal(rem, 0);
  }
  if (plan.nextEventState) {
    hero.thangSuKien = plan.nextEventState;
  }
}

afterEach(() => {
  SK.cf({
    bat: false,
    thang: null,
    drop: { bat: false, tiLe: 0 },
    noelVer5: { bat: false },
  });
});

test("SK.cf bat:false with noelVer5.bat:true opens/closes VN December at exact UTC+7 boundaries", () => {
  enableNoelVer5();
  assert.deepEqual(SK.cf(), {
    bat: false,
    thang: null,
    drop: { bat: false, tiLe: 0 },
    noelVer5: { bat: true },
  });

  const beforeOpen = Date.UTC(2026, 10, 30, 16, 59, 59, 999);
  const openAt = Date.UTC(2026, 10, 30, 17, 0, 0, 0);
  const beforeClose = Date.UTC(2026, 11, 31, 16, 59, 59, 999);
  const closeAt = Date.UTC(2026, 11, 31, 17, 0, 0, 0);

  assert.equal(SK.dang("noel", beforeOpen), false);
  assert.equal(SK.dang(null, beforeOpen), false);

  assert.equal(SK.dang("noel", openAt), true);
  assert.equal(SK.dang(null, openAt), "noel");
  assert.equal(SK.dang("tet", openAt), false);

  assert.equal(SK.dang("noel", beforeClose), true);
  assert.equal(SK.dang(null, beforeClose), "noel");

  assert.equal(SK.dang("noel", closeAt), false);
  assert.equal(SK.dang(null, closeAt), false);
  assert.equal(SK.dang("tet", closeAt), false);
});

test("roiHopNoel enforces VN month, level, map, roll cutoff, and valid drop tier", () => {
  const base = {
    bat: true,
    now: Date.UTC(2026, 11, 15, 0, 0, 0, 0),
    cap: 50,
    bacRoi: 10,
    map: 53,
    quaiThuong: true,
  };

  assert.equal(roiHopNoel({ ...base, now: Date.UTC(2026, 10, 30, 16, 59, 59, 999) }, 1), false);
  assert.equal(roiHopNoel({ ...base, now: Date.UTC(2026, 10, 30, 17, 0, 0, 0) }, 1), true);
  assert.equal(roiHopNoel({ ...base, now: Date.UTC(2026, 11, 31, 16, 59, 59, 999) }, 1), true);
  assert.equal(roiHopNoel({ ...base, now: Date.UTC(2026, 11, 31, 17, 0, 0, 0) }, 1), false);

  assert.equal(roiHopNoel(base, 20000), true);
  assert.equal(roiHopNoel(base, 20001), false);
  assert.equal(roiHopNoel(base, 0), false);
  assert.equal(roiHopNoel(base, 1000001), false);

  assert.equal(roiHopNoel({ ...base, cap: 49 }, 1), false);
  assert.equal(roiHopNoel({ ...base, cap: 50 }, 1), true);

  assert.equal(roiHopNoel({ ...base, bacRoi: 80, map: 1 }, 1), true);
  assert.equal(roiHopNoel({ ...base, bacRoi: 80, map: 0 }, 1), false);
  assert.equal(roiHopNoel({ ...base, bacRoi: 90, map: 225 }, 1), true);
  assert.equal(roiHopNoel({ ...base, bacRoi: 90, map: 93 }, 1), true);
  assert.equal(roiHopNoel({ ...base, bacRoi: 90, map: 53 }, 1), false);

  assert.equal(roiHopNoel({ ...base, bacRoi: 85 }, 1), false);
  assert.equal(roiHopNoel({ ...base, bacRoi: 100 }, 1), false);
  assert.equal(roiHopNoel({ ...base, bacRoi: "10" }, 1), false);
  const { bacRoi: _missing, ...noTier } = base;
  assert.equal(roiHopNoel(noTier, 1), false);
});

test("SK.dung ordinary awards buff440Ticks 6480, enforces 5 daily cap, and resets after 17:00 UTC next VN day", () => {
  enableNoelVer5();

  const hero = {
    lvl: 50,
    tien: 0,
    bag: [{ k: "noelV5NguoiTuyet", n: 6 }],
    duCho: () => true,
  };
  const day1 = Date.UTC(2026, 11, 1, 10, 0, 0, 0);
  const beforeReset = Date.UTC(2026, 11, 1, 16, 59, 59, 999);
  const afterReset = Date.UTC(2026, 11, 1, 17, 0, 0, 0);

  const first = SK.dung(hero, "noelV5NguoiTuyet", day1);
  assert.equal(first.ok, true);
  assert.equal(first.ver5, true);
  assert.equal(first.special, false);
  assert.equal(first.buff440Ticks, 6480);
  assert.deepEqual(first.consume, [{ k: "noelV5NguoiTuyet", n: 1 }]);
  assert.deepEqual(first.award, []);
  assert.equal(hero.bag[0].n, 6);
  assert.equal(hero.thangSuKien, undefined);

  commitLedger(hero, first);
  for (let count = 2; count <= 5; count += 1) {
    const plan = SK.dung(hero, "noelV5NguoiTuyet", day1);
    assert.equal(plan.ok, true);
    assert.equal(plan.buff440Ticks, 6480);
    assert.equal(plan.nextEventState.noel["2026"].ver5.daily.day, "2026-12-01");
    assert.equal(plan.nextEventState.noel["2026"].ver5.daily.used.noelV5NguoiTuyet, count);
    commitLedger(hero, plan);
  }
  assert.equal(hero.bag[0].n, 1);

  const capped = SK.dung(hero, "noelV5NguoiTuyet", beforeReset);
  assert.equal(capped.ok, false);
  assert.equal(hero.bag[0].n, 1);
  assert.equal(hero.thangSuKien.noel["2026"].ver5.daily.used.noelV5NguoiTuyet, 5);

  const nextDay = SK.dung(hero, "noelV5NguoiTuyet", afterReset);
  assert.equal(nextDay.ok, true);
  assert.equal(nextDay.buff440Ticks, 6480);
  assert.deepEqual(nextDay.nextEventState.noel["2026"].ver5.daily, {
    day: "2026-12-02",
    used: { noelV5NguoiTuyet: 1 },
  });
  commitLedger(hero, nextDay);
  assert.equal(hero.bag[0].n, 0);
});

test("SK.moc enforces red-only 2000 counter, horse:53 RNG 0.99999, cloned claim replay reject, literal 43200, and capacity immutability", () => {
  enableNoelVer5();
  const decNow = Date.UTC(2026, 11, 15, 0, 0, 0, 0);

  const legacyHero = {
    lvl: 60,
    tien: 0,
    bag: [],
    duCho: () => true,
    thangSuKien: {
      noel: {
        2026: { specialUsed: 2000, claimed: {} },
      },
    },
  };
  assert.equal(SK.moc(legacyHero, "noel", 1, decNow, () => 0).ok, false);
  assert.equal(SK.moc(legacyHero, "noel", 3, decNow, () => 0).ok, false);

  const nonRedHero = {
    lvl: 60,
    tien: 0,
    bag: [],
    duCho: () => true,
    thangSuKien: {
      noel: {
        2026: {
          ver5: {
            used: {
              noelV5NguoiTuyetDB: 1000,
              noelV5NguoiTuyetXanhDB: 1000,
            },
            daily: { day: null, used: {} },
            claimed: {},
          },
        },
      },
    },
  };
  assert.equal(SK.moc(nonRedHero, "noel", 1, decNow, () => 0).ok, false);
  assert.equal(SK.moc(nonRedHero, "noel", 3, decNow, () => 0).ok, false);

  const redHero = {
    lvl: 60,
    tien: 0,
    bag: [],
    duCho: () => true,
    thangSuKien: {
      noel: {
        2026: {
          ver5: {
            used: { noelV5NguoiTuyetDoDB: 2000 },
            daily: { day: null, used: {} },
            claimed: {},
          },
        },
      },
    },
  };
  const originalSnapshot = structuredClone(redHero.thangSuKien);

  assert.equal(SK.moc(redHero, "noel", 0, decNow, () => 0).ok, false);
  assert.equal(SK.moc(redHero, "noel", 4, decNow, () => 0).ok, false);
  assert.equal(SK.moc(redHero, "noel", "bad", decNow, () => 0).ok, false);

  const fullHero = {
    ...redHero,
    duCho: () => false,
    thangSuKien: structuredClone(originalSnapshot),
  };
  const capFail = SK.moc(fullHero, "noel", 1, decNow, () => 0);
  assert.equal(capFail.ok, false);
  assert.equal(capFail.nextEventState, undefined);
  assert.deepEqual(fullHero.thangSuKien, originalSnapshot);

  const tier1 = SK.moc(redHero, "noel", 1, decNow, () => 0);
  assert.equal(tier1.ok, true);
  assert.equal(tier1.ver5, true);
  assert.equal(tier1.tier, 1);
  assert.equal(tier1.goldDelta, 1000000);
  assert.equal(tier1.expDelta, 10000000);
  assert.deepEqual(tier1.award, [{ k: "ms:71", n: 1, nExpiredTime: 43200 }]);
  assert.equal(tier1.award[0].nExpiredTime, 43200);
  assert.deepEqual(redHero.thangSuKien, originalSnapshot);

  const tier3 = SK.moc(redHero, "noel", 3, decNow, () => 0.99999);
  assert.equal(tier3.ok, true);
  assert.equal(tier3.ver5, true);
  assert.equal(tier3.tier, 3);
  assert.equal(tier3.threshold, 2000);
  assert.equal(tier3.goldDelta, 5000000);
  assert.equal(tier3.expDelta, 50000000);
  assert.deepEqual(tier3.consume, []);
  assert.deepEqual(tier3.award, [{ k: "horse:53", n: 1 }]);
  assert.deepEqual(redHero.thangSuKien, originalSnapshot);
  assert.notEqual(tier3.nextEventState, redHero.thangSuKien);
  assert.equal(tier3.nextEventState.noel["2026"].ver5.claimed["3"], true);

  const claimedCloneHero = {
    ...redHero,
    thangSuKien: tier3.nextEventState,
  };
  assert.equal(SK.moc(claimedCloneHero, "noel", 3, decNow, () => 0.99999).ok, false);
});

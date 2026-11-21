"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

assert.equal(require.main, module, "must run directly");
assert.equal(process.env.VL_DU_LIEU, "/data", "VL_DU_LIEU must be /data");
assert.equal(fs.readdirSync("/data").length, 0, "/data must be empty before game requires");

const DL = require("./du-lieu.js");
const DO = require("./do.js");
const TC = require("./tra-cuu.js");
const HK = require("../src/game/hoang-kim.json");

const mkHero = (bag, lvl = 200) => ({ name: "HK Fixture", lvl, equip: {}, bag, uN: bag.length });

async function main() {
  assert.equal(HK.items.length, 9);
  const tk = DL.taoTk("hktest", "synthetic-test");
  const kbhHet = Date.now() + 3600000;

  // All 9 HK items via deterministic crypto.randomInt + equip/save/read/chuan/unequip + low lvl reject
  const origRandomInt = crypto.randomInt;
  try {
    for (let idx = 0; idx < HK.items.length; idx++) {
      const m = HK.items[idx];
      crypto.randomInt = (min, max) => {
        if (max === undefined) { assert.equal(min, HK.items.length); return idx; }
        return origRandomInt(min, max);
      };

      const h = mkHero([{ k: "ms:69", u: 1, x: 0, y: 0, n: 2, kbh: 1, kbhHet }]);
      DO.chuan(h);
      const res = DO.lam(h, { act: "dung", u: 1 }, "hktest|0");
      assert.ok(res && res.msg);

      const box = h.bag.find((o) => o.u === 1);
      assert.ok(box && box.n === 1, "box count must decrement once");
      assert.equal(h.bag.length, 2, "must add one item");

      const qua = h.bag.find((o) => o.u !== 1);
      assert.ok(qua);
      assert.equal(qua.k, m.k);
      assert.equal(qua.s, m.s);
      assert.equal(qua.ng[0], "ruong");
      assert.equal(qua.kbh, 1);
      assert.equal(qua.kbhHet, kbhHet);

      const slot = DO.SLOT_OF[m.t];
      assert.ok(slot);

      const low = mkHero([{ ...qua, u: 1, x: 0, y: 0 }], 1);
      assert.throws(() => DO.lam(low, { act: "mac", u: 1 }, "hktest|0"));

      DO.lam(h, { act: "mac", u: qua.u }, "hktest|0");
      assert.equal(h.equip[slot].k, m.k);

      tk.nv[0] = h;
      DL.ghiTk(tk);
      const tk2 = DL.docTk("hktest");
      const h2 = tk2.nv[0];
      DO.chuan(h2);
      assert.equal(h2.equip[slot].k, m.k);
      assert.equal(h2.equip[slot].kbh, 1);
      assert.equal(h2.equip[slot].kbhHet, kbhHet);
      assert.equal(h2.equip[slot].ng[0], "ruong");

      DO.lam(h2, { act: "thao", slot }, "hktest|0");
      assert.equal(h2.equip[slot], undefined);
      assert.ok(h2.bag.some((o) => o.u === qua.u && o.k === m.k));
    }

    // Permanent lock (kbh: 2)
    crypto.randomInt = () => 0;
    const hPerm = mkHero([{ k: "ms:69", u: 1, x: 0, y: 0, n: 2, kbh: 2 }]);
    DO.lam(hPerm, { act: "dung", u: 1 }, "hktest|0");
    const qPerm = hPerm.bag.find((o) => o.u !== 1);
    assert.equal(qPerm.kbh, 2);
    assert.equal(qPerm.kbhHet, undefined);

    // Full 6x10 bag: box at index 0 + 59 potion:2 cells
    const fullBag = [{ k: "ms:69", u: 1, x: 0, y: 0, n: 2, kbh: 1, kbhHet }];
    for (let c = 1; c < 60; c++) {
      fullBag.push({ k: "potion:2", u: c + 1, x: c % 6, y: (c / 6) | 0, n: 1 });
    }
    const hFull = mkHero(fullBag);
    DO.chuan(hFull);
    const bagSnap = JSON.stringify(hFull.bag);
    const uNSnap = hFull.uN;
    assert.throws(() => DO.lam(hFull, { act: "dung", u: 1 }, "hktest|0"));
    assert.equal(JSON.stringify(hFull.bag), bagSnap);
    assert.equal(hFull.uN, uNSnap);
  } finally {
    crypto.randomInt = origRandomInt;
  }

  // ms:76 throws and state unchanged
  const h76 = mkHero([{ k: "ms:76", u: 1, x: 0, y: 0, n: 1 }]);
  DO.chuan(h76);
  const h76BagSnap = JSON.stringify(h76.bag);
  const h76UNSnap = h76.uN;
  assert.throws(() => DO.lam(h76, { act: "dung", u: 1 }, "hktest|0"));
  assert.equal(JSON.stringify(h76.bag), h76BagSnap);
  assert.equal(h76.uN, h76UNSnap);

  // Guide contains all 9 names under id hoangKim
  const guide = JSON.parse(TC.lay().json);
  const hkMuc = guide.nhom.flatMap((g) => g.muc || []).find((m) => m.id === "hoangKim");
  assert.ok(hkMuc, "guide must contain hoangKim entry");
  const hkText = JSON.stringify(hkMuc);
  for (const m of HK.items) assert.ok(hkText.includes(m.n), `guide missing ${m.n}`);

  // Optional ItemDB ESM check with local JSON fetch
  const origFetch = global.fetch;
  const rootDir = path.join(__dirname, "..");
  global.fetch = async (u) => {
    const file = path.join(rootDir, String(u).replace(/^\/+/, ""));
    return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(file, "utf8")) };
  };
  try {
    const { ItemDB } = await import("../src/game/itemdb.js");
    await ItemDB.load();
    for (const m of HK.items) {
      const it = ItemDB.item(m.k);
      assert.ok(it, `ItemDB missing ${m.k}`);
      assert.equal(ItemDB.group(it), "Hoàng Kim");
      assert.equal(ItemDB.base(m.k).lv, HK.base[m.k].lv);
    }
    const boxDef = ItemDB.item("ms:69");
    assert.ok(boxDef && String(boxDef.intro || "").includes("An Bang"));
  } finally {
    global.fetch = origFetch;
  }

  console.log("OK: hoang-kim.test.cjs passed (9 HK items, lock, full bag, ms:76, tra-cuu, ItemDB)");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

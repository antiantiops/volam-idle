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
const POOL = HK.items.filter((m) => !m.bo);
const DN = HK.items.filter((m) => m.bo === "dinhNghiep");

const mkHero = (bag, lvl = 200) => ({ name: "HK Fixture", lvl, equip: {}, bag, uN: bag.length });

async function main() {
  assert.equal(POOL.length, 9);
  assert.equal(DN.length, 6);
  const tk = DL.taoTk("hktest", "synthetic-test");
  const kbhHet = Date.now() + 3600000;

  // All 9 HK items via deterministic crypto.randomInt + equip/save/read/chuan/unequip + low lvl reject
  const origRandomInt = crypto.randomInt;
  try {
    for (let idx = 0; idx < POOL.length; idx++) {
      const m = POOL[idx];
      crypto.randomInt = (min, max) => {
        if (max === undefined) { assert.equal(min, POOL.length); return idx; }
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

  // Guide contains all 9 pool names under id hoangKim, and excludes Định Nghiệp
  const guide = JSON.parse(TC.lay().json);
  const hkMuc = guide.nhom.flatMap((g) => g.muc || []).find((m) => m.id === "hoangKim");
  assert.ok(hkMuc, "guide must contain hoangKim entry");
  const hkText = JSON.stringify(hkMuc);
  for (const m of POOL) assert.ok(hkText.includes(m.n), `guide missing ${m.n}`);
  assert.ok(!hkText.includes("Định Nghiệp"), "guide must not include Định Nghiệp");

  // Optional ItemDB ESM check with local JSON fetch
  const origFetch = global.fetch;
  const rootDir = path.join(__dirname, "..");
  global.fetch = async (u) => {
    const file = path.join(rootDir, String(u).replace(/^\/+/, ""));
    return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(file, "utf8")) };
  };
  try {
    const { ItemDB, equipStats, boDinhNghiep, DINH_NGHIEP } = await import("../src/game/itemdb.js");
    const { itemTipHtml } = await import("../src/game/itemtip.js");
    const { World } = await import("../src/game/world.js");
    await ItemDB.load();
    for (const m of HK.items) {
      const it = ItemDB.item(m.k);
      assert.ok(it, `ItemDB missing ${m.k}`);
      assert.equal(ItemDB.group(it), "Hoàng Kim");
      assert.equal(ItemDB.base(m.k).lv, HK.base[m.k].lv);
    }
    const boxDef = ItemDB.item("ms:69");
    assert.ok(boxDef && String(boxDef.intro || "").includes("An Bang"));

    // Định Nghiệp fixed gold attributes: retroactive on d:[] fixture, intact vs broken
    const dnHero = {
      lvl: 90, sex: "m", series: 0, start: { str: 20, dex: 20, vit: 20, eng: 20 }, attr: {},
      equip: {
        Cap: { k: "hk:148", s: 0, d: [] },
        Cloth: { k: "hk:149", s: 4, d: [] },
        Sash: { k: "hk:150", s: 3, d: [] },
        Bangle: { k: "hk:151", s: 1, d: [] },
        Shoes: { k: "hk:152", s: 2, d: [] },
        Ring1: { k: "hk:153", s: 2, d: [] },
      },
    };
    const stIntact = equipStats(dnHero, false);
    assert.equal(stIntact.life, 250);
    assert.equal(stIntact.mana, 100);
    assert.equal(stIntact.moveSpeed, 10);
    assert.deepEqual(stIntact.res, { fire: 5, cold: 5, light: 5, poison: 5, phys: 5 });

    const dnBroken = {
      ...dnHero,
      equip: Object.fromEntries(Object.entries(dnHero.equip).map(([slot, it]) => [slot, { ...it, ben: 0 }])),
    };
    const stBroken = equipStats(dnBroken, false);
    assert.equal(stBroken.life, 0);
    assert.equal(stBroken.mana, 0);
    assert.equal(stBroken.moveSpeed, 0);
    assert.deepEqual(stBroken.res, { fire: 0, cold: 0, light: 0, poison: 0, phys: 0 });

    // itemTipHtml output with real tip data if available (else minimal fallback)
    const tipFile = path.join(rootDir, "assets/web/skill/tip.json");
    const tipData = fs.existsSync(tipFile) ? JSON.parse(fs.readFileSync(tipFile, "utf8")) : {
      colors: { White: [255, 255, 255], Yellow: [255, 255, 0], Blue: [100, 100, 255], DBlue: [120, 120, 120], Gold: [255, 215, 0], Red: [255, 0, 0], Green: [0, 255, 0], Metal: [255, 255, 255], Wood: [0, 255, 0], Water: [0, 200, 255], Fire: [255, 80, 80], Earth: [200, 160, 80] },
      magic: { armordefense_v: "Phòng thủ: #d1-", durability_v: "Độ bền: #d1-", requirelevel: "Yêu cầu đẳng cấp: #d1-", lifemax_v: "Sinh lực tối đa: #d1+ điểm", manamax_v: "Nội lực tối đa: +#d1-", fastwalkrun_p: "Tốc độ di chuyển: +#d1-%", lightingres_p: "Kháng lôi: +#d1-%", physicsres_p: "Phòng thủ vật lý: +#d1-%", coldres_p: "Kháng băng: +#d1-%", fireres_p: "Kháng hỏa: +#d1-%", poisonres_p: "Kháng độc: +#d1-%" },
    };
    const goldRgb = `rgb(${tipData.colors.Gold.join(",")})`;
    const disRgb = `rgb(${tipData.colors.DBlue.join(",")})`;
    const greenRgb = `rgb(${tipData.colors.Green.join(",")})`;
    const tipIntact = itemTipHtml(tipData, { k: "hk:148", s: 0, d: [] }, dnHero);
    assert.ok(tipIntact.includes("Thuộc tính Hoàng Kim") && tipIntact.includes(goldRgb));
    assert.ok(tipIntact.includes("Bộ Định Nghiệp: 6/6") && tipIntact.includes("Hào quang 6/6: Đã kích hoạt"));
    assert.ok(!tipIntact.includes(disRgb));
    for (const k of DINH_NGHIEP) assert.ok(tipIntact.includes(`✓ ${ItemDB.item(k).n}`));

    // 0/6 (empty equip)
    const tipZero = itemTipHtml(tipData, { k: "hk:148", s: 0, d: [] }, { ...dnHero, equip: {} });
    assert.ok(tipZero.includes("Bộ Định Nghiệp: 0/6") && tipZero.includes("Hào quang 6/6: Chưa kích hoạt"));
    for (const k of DINH_NGHIEP) assert.ok(tipZero.includes(`· ${ItemDB.item(k).n}`));

    // 5/6 (missing Shoes) + broken item (ben: 0) + duplicate piece in Ring2
    const dnFive = { ...dnHero, equip: { ...dnHero.equip, Shoes: undefined } };
    const tipFive = itemTipHtml(tipData, { k: "hk:148", s: 0, d: [] }, dnFive);
    assert.ok(tipFive.includes("Bộ Định Nghiệp: 5/6") && tipFive.includes("Hào quang 6/6: Chưa kích hoạt"));
    assert.ok(tipFive.includes(`· ${ItemDB.item("hk:152").n}`) && tipFive.includes(greenRgb));

    const dnOneBroken = { ...dnHero, equip: { ...dnHero.equip, Shoes: { k: "hk:152", s: 2, d: [], ben: 0 } } };
    assert.equal(boDinhNghiep(dnOneBroken).size, 5);
    const tipOneBroken = itemTipHtml(tipData, { k: "hk:148", s: 0, d: [] }, dnOneBroken);
    assert.ok(tipOneBroken.includes("Bộ Định Nghiệp: 5/6") && tipOneBroken.includes("Hào quang 6/6: Chưa kích hoạt"));
    assert.ok(tipOneBroken.includes(`· ${ItemDB.item("hk:152").n}`));

    const dnDup = { ...dnHero, equip: { ...dnHero.equip, Ring1: { k: "hk:148", s: 0, d: [] } } };
    assert.equal(boDinhNghiep(dnDup).size, 5);
    const tipDup = itemTipHtml(tipData, { k: "hk:148", s: 0, d: [] }, dnDup);
    assert.ok(tipDup.includes("Bộ Định Nghiệp: 5/6") && tipDup.includes("Hào quang 6/6: Chưa kích hoạt"));

    // Shared Set semantics between tooltip helper and World.prototype.duBoDinhNghiep
    const wProbe = Object.create(World.prototype);
    for (const [eq, want] of [[dnHero.equip, true], [dnFive.equip, false], [dnOneBroken.equip, false], [dnDup.equip, false], [{}, false]]) {
      wProbe.hero = { equip: eq };
      assert.equal(wProbe.duBoDinhNghiep(), boDinhNghiep(wProbe.hero).size === 6);
      assert.equal(wProbe.duBoDinhNghiep(), want);
    }

    const tipBroken = itemTipHtml(tipData, { k: "hk:148", s: 0, d: [], ben: 0 }, dnHero);
    assert.ok(tipBroken.includes("Thuộc tính Hoàng Kim") && tipBroken.includes(disRgb));
    const tipOther = itemTipHtml(tipData, { k: "hk:217", s: 4, d: [] }, dnHero);
    assert.ok(tipOther.includes("Thuộc tính Hoàng Kim") && tipOther.includes(goldRgb));
    assert.ok(!tipOther.includes("Bộ Định Nghiệp"));
    const tipNeg = itemTipHtml(tipData, { k: "hk:400", s: 0, d: [] }, dnHero);
    assert.ok(tipNeg.includes("Thuộc tính Hoàng Kim") && tipNeg.includes(goldRgb) && !tipNeg.includes("Bộ Định Nghiệp"));
    assert.ok(tipNeg.includes("-49") && !tipNeg.includes("+-49"));
    const tipOtherSet = itemTipHtml(tipData, { k: "hk:216", s: 0, d: [] }, dnHero);
    assert.ok(!tipOtherSet.includes("Bộ Định Nghiệp"));

    // Real runtime character regression: World.prototype.refreshStats -> bonus -> equipStats -> heroStats
    const chrFile = path.join(rootDir, "assets/data/char.json");
    const chrData = fs.existsSync(chrFile) ? JSON.parse(fs.readFileSync(chrFile, "utf8")) : {
      levelAdd: [{
        LifePerVitality: 4, LifePerLevel: 2, ManaPerEnergy: 2, ManaPerLevel: 1,
        StaminaMaleBase: 60, StaminaMalePerLevel: 2, StaminaPerVitality: 1,
        fireres: 0, coldres: 0, lightingres: 0, poisonres: 0, physicres: 0,
      }],
    };
    const mkWorld = (hero) => {
      const w = Object.create(World.prototype);
      w.P = { chr: chrData };
      w.hero = hero;
      w.player = { hp: 100, hpMax: 100, mp: 100, mpMax: 100, st: 100, stMax: 100, buffs: new Map() };
      return w;
    };
    const wNaked = mkWorld({ ...dnHero, equip: {} });
    wNaked.refreshStats(true);
    assert.equal(wNaked.duBoDinhNghiep(), false);

    // Equip old d:[] 6/6 set; repeated refresh must not double-apply, 6/6 aura remains visual only
    const wDn = mkWorld({ ...dnHero, equip: { ...dnHero.equip } });
    wDn.refreshStats(true);
    wDn.refreshStats(false);
    assert.equal(wDn.player.hpMax - wNaked.player.hpMax, 250);
    assert.equal(wDn.player.mpMax - wNaked.player.mpMax, 100);
    assert.equal(wDn.player.moveSpeed - wNaked.player.moveSpeed, 10);
    for (const r of ["fire", "cold", "light", "poison", "phys"]) {
      assert.equal(wDn.player.res[r] - wNaked.player.res[r], 5);
    }
    assert.equal(wDn.duBoDinhNghiep(), true);

    // Remove Shoes (5/6): aura off, loses only Shoes stats (+10 moveSpeed, +5 poison res)
    delete wDn.hero.equip.Shoes;
    wDn.refreshStats(false);
    assert.equal(wDn.duBoDinhNghiep(), false);
    assert.equal(wDn.player.hpMax - wNaked.player.hpMax, 250);
    assert.equal(wDn.player.mpMax - wNaked.player.mpMax, 100);
    assert.equal(wDn.player.moveSpeed - wNaked.player.moveSpeed, 0);
    for (const r of ["fire", "cold", "light", "phys"]) {
      assert.equal(wDn.player.res[r] - wNaked.player.res[r], 5);
    }
    assert.equal(wDn.player.res.poison - wNaked.player.res.poison, 0);

    // Broken Shoes (ben: 0): still 5/6, aura off, same stats as missing Shoes
    wDn.hero.equip.Shoes = { k: "hk:152", s: 2, d: [], ben: 0 };
    wDn.refreshStats(false);
    assert.equal(wDn.duBoDinhNghiep(), false);
    assert.equal(wDn.player.hpMax - wNaked.player.hpMax, 250);
    assert.equal(wDn.player.mpMax - wNaked.player.mpMax, 100);
    assert.equal(wDn.player.moveSpeed - wNaked.player.moveSpeed, 0);
    assert.equal(wDn.player.res.poison - wNaked.player.res.poison, 0);

    // Break all 6 items (ben: 0): reverts to exact naked stats
    wDn.hero.equip = Object.fromEntries(Object.entries(dnHero.equip).map(([slot, it]) => [slot, { ...it, ben: 0 }]));
    wDn.refreshStats(false);
    assert.equal(wDn.duBoDinhNghiep(), false);
    assert.equal(wDn.player.hpMax, wNaked.player.hpMax);
    assert.equal(wDn.player.mpMax, wNaked.player.mpMax);
    assert.equal(wDn.player.moveSpeed, wNaked.player.moveSpeed);
    assert.deepEqual(wDn.player.res, wNaked.player.res);

    // 9 legacy gold items (An Bang ID 34 + Định Quốc ID 33) on real World.prototype.refreshStats
    const LEGACY_CASES = [
      ["hk:217", "Necklace", { res: { fire: 10, cold: 10, light: 10, poison: 10, phys: 10 } }],
      ["hk:218", "Ring1", { mana: 60, res: { cold: 20 } }],
      ["hk:219", "Pendant", { mana: 60, res: { poison: 20 } }],
      ["hk:220", "Ring2", { mana: 60, res: { fire: 20 } }],
      ["hk:399", "Cloth", { tgph: 30, life: 60 }],
      ["hk:400", "Cap", { life: -49, res: { phys: 20 } }],
      ["hk:401", "Shoes", { moveSpeed: 30, life: 60 }],
      ["hk:402", "Bangle", { life: -49, tglc: 30 }],
      ["hk:403", "Sash", { life: -49, tgtd: 40 }],
    ];
    const RES_KEYS = ["fire", "cold", "light", "poison", "phys"];
    const diffPlayer = (w) => ({
      hpMax: w.player.hpMax - wNaked.player.hpMax,
      mpMax: w.player.mpMax - wNaked.player.mpMax,
      moveSpeed: w.player.moveSpeed - wNaked.player.moveSpeed,
      tgph: w.player.tgph - wNaked.player.tgph,
      tglc: w.player.tglc - wNaked.player.tglc,
      tgtd: w.player.tgtd - wNaked.player.tgtd,
      def: w.player.def - wNaked.player.def,
      res: Object.fromEntries(RES_KEYS.map((r) => [r, w.player.res[r] - wNaked.player.res[r]])),
    });

    for (const [k, slot, want] of LEGACY_CASES) {
      const meta = ItemDB.item(k);
      const base = ItemDB.base(k);
      const expectedSlot = DO.SLOT_OF[meta.t];
      assert.ok(slot === expectedSlot || (expectedSlot === "Ring1" && slot === "Ring2"), `${k} slot mismatch`);
      const wOne = mkWorld({ ...dnHero, equip: { [slot]: { k, s: meta.s, d: [] } } });
      wOne.refreshStats(true);
      wOne.refreshStats(false);
      assert.equal(wOne.duBoDinhNghiep(), false);
      const d = diffPlayer(wOne);
      assert.equal(d.hpMax, (base.life || 0) + (want.life || 0), `${k} hpMax`);
      assert.equal(d.mpMax, want.mana || 0, `${k} mpMax`);
      assert.equal(d.moveSpeed, (base.move || 0) + (want.moveSpeed || 0), `${k} moveSpeed`);
      assert.equal(d.tgph, want.tgph || 0, `${k} tgph`);
      assert.equal(d.tglc, want.tglc || 0, `${k} tglc`);
      assert.equal(d.tgtd, want.tgtd || 0, `${k} tgtd`);
      assert.equal(d.def, base.def || 0, `${k} def`);
      for (const r of RES_KEYS) {
        assert.equal(d.res[r], (base.resAll || 0) + ((want.res && want.res[r]) || 0), `${k} res.${r}`);
      }
    }

    // Full 4/4 An Bang: exact sum, no hidden/set activation, remove/break one & break all
    const abEquip = {
      Necklace: { k: "hk:217", s: 4, d: [] },
      Ring1: { k: "hk:218", s: 2, d: [] },
      Pendant: { k: "hk:219", s: 1, d: [] },
      Ring2: { k: "hk:220", s: 3, d: [] },
    };
    const wAb = mkWorld({ ...dnHero, equip: { ...abEquip } });
    wAb.refreshStats(true);
    wAb.refreshStats(false);
    assert.equal(wAb.duBoDinhNghiep(), false);
    assert.deepEqual(diffPlayer(wAb), {
      hpMax: 0, mpMax: 180, moveSpeed: 0, tgph: 0, tglc: 0, tgtd: 0, def: 0,
      res: { fire: 30, cold: 30, light: 10, poison: 30, phys: 10 },
    });
    delete wAb.hero.equip.Necklace;
    wAb.refreshStats(false);
    assert.deepEqual(diffPlayer(wAb), {
      hpMax: 0, mpMax: 180, moveSpeed: 0, tgph: 0, tglc: 0, tgtd: 0, def: 0,
      res: { fire: 20, cold: 20, light: 0, poison: 20, phys: 0 },
    });
    wAb.hero.equip.Ring1 = { k: "hk:218", s: 2, d: [], ben: 0 };
    wAb.refreshStats(false);
    assert.deepEqual(diffPlayer(wAb), {
      hpMax: 0, mpMax: 120, moveSpeed: 0, tgph: 0, tglc: 0, tgtd: 0, def: 0,
      res: { fire: 20, cold: 0, light: 0, poison: 20, phys: 0 },
    });
    wAb.hero.equip = Object.fromEntries(Object.entries(abEquip).map(([slot, it]) => [slot, { ...it, ben: 0 }]));
    wAb.refreshStats(false);
    assert.deepEqual(diffPlayer(wAb), {
      hpMax: 0, mpMax: 0, moveSpeed: 0, tgph: 0, tglc: 0, tgtd: 0, def: 0,
      res: { fire: 0, cold: 0, light: 0, poison: 0, phys: 0 },
    });

    // Full 5/5 Định Quốc: exact sum, no hidden/set activation, remove/break one & break all
    const dqEquip = {
      Cloth: { k: "hk:399", s: 0, d: [] },
      Cap: { k: "hk:400", s: 0, d: [] },
      Shoes: { k: "hk:401", s: 0, d: [] },
      Bangle: { k: "hk:402", s: 0, d: [] },
      Sash: { k: "hk:403", s: 0, d: [] },
    };
    const dqDefSum = ["hk:399", "hk:400", "hk:401", "hk:402", "hk:403"].reduce((s, k) => s + (ItemDB.base(k).def || 0), 0);
    const wDq = mkWorld({ ...dnHero, equip: { ...dqEquip } });
    wDq.refreshStats(true);
    wDq.refreshStats(false);
    assert.equal(wDq.duBoDinhNghiep(), false);
    assert.deepEqual(diffPlayer(wDq), {
      hpMax: -27, mpMax: 0, moveSpeed: 30, tgph: 30, tglc: 30, tgtd: 40, def: dqDefSum,
      res: { fire: 0, cold: 0, light: 0, poison: 0, phys: 20 },
    });
    delete wDq.hero.equip.Cap;
    wDq.refreshStats(false);
    assert.deepEqual(diffPlayer(wDq), {
      hpMax: 22, mpMax: 0, moveSpeed: 30, tgph: 30, tglc: 30, tgtd: 40, def: dqDefSum - (ItemDB.base("hk:400").def || 0),
      res: { fire: 0, cold: 0, light: 0, poison: 0, phys: 0 },
    });
    wDq.hero.equip.Shoes = { k: "hk:401", s: 0, d: [], ben: 0 };
    wDq.refreshStats(false);
    assert.deepEqual(diffPlayer(wDq), {
      hpMax: -38, mpMax: 0, moveSpeed: 0, tgph: 30, tglc: 30, tgtd: 40,
      def: dqDefSum - (ItemDB.base("hk:400").def || 0) - (ItemDB.base("hk:401").def || 0),
      res: { fire: 0, cold: 0, light: 0, poison: 0, phys: 0 },
    });
    wDq.hero.equip = Object.fromEntries(Object.entries(dqEquip).map(([slot, it]) => [slot, { ...it, ben: 0 }]));
    wDq.refreshStats(false);
    assert.deepEqual(diffPlayer(wDq), {
      hpMax: 0, mpMax: 0, moveSpeed: 0, tgph: 0, tglc: 0, tgtd: 0, def: 0,
      res: { fire: 0, cold: 0, light: 0, poison: 0, phys: 0 },
    });

    // Combined 4 AB + 5 ĐQ, mixed with Định Nghiệp, and series mismatch: no cross-activation or mismatch
    const wAll9 = mkWorld({ ...dnHero, equip: { ...abEquip, ...dqEquip } });
    wAll9.refreshStats(true);
    assert.equal(wAll9.duBoDinhNghiep(), false);
    assert.deepEqual(diffPlayer(wAll9), {
      hpMax: -27, mpMax: 180, moveSpeed: 30, tgph: 30, tglc: 30, tgtd: 40, def: dqDefSum,
      res: { fire: 30, cold: 30, light: 10, poison: 30, phys: 30 },
    });
    const wMix = mkWorld({
      ...dnHero,
      equip: {
        ...dnHero.equip,
        Cap: { k: "hk:400", s: 3, d: [] },
        Necklace: { k: "hk:217", s: 0, d: [] },
        Pendant: { k: "hk:219", s: 4, d: [] },
        Ring2: { k: "hk:220", s: 2, d: [] },
      },
    });
    wMix.refreshStats(true);
    assert.equal(wMix.duBoDinhNghiep(), false);
    // Cap replaces DN hk:148 (loses 60 hp, +5 light); def sums still-equipped hk:149/150/151/152 (630/140/115/140) + hk:400 (260)
    const mixDefSum = ["hk:149", "hk:150", "hk:151", "hk:152", "hk:400"].reduce((s, k) => s + (ItemDB.base(k).def || 0), 0);
    assert.deepEqual(diffPlayer(wMix), {
      hpMax: 141, mpMax: 220, moveSpeed: 10, tgph: 0, tglc: 0, tgtd: 0, def: mixDefSum,
      res: { fire: 35, cold: 15, light: 10, poison: 35, phys: 35 },
    });
  } finally {
    global.fetch = origFetch;
  }

  // Dinh Nghiep 6-piece set via taoQua (unlocked, tradable)
  const hDn = mkHero([], 200);
  DO.chuan(hDn);
  const ds = DO.taoQua(hDn, { mon: DN.map((m) => ({ k: m.k, n: 1, dong: 0, he: m.s })) });
  assert.equal(ds.length, 6);
  assert.equal(hDn.bag.length, 6);
  const dnMap = new Map(DN.map((m) => [m.k, m]));
  for (const it of hDn.bag) {
    const m = dnMap.get(it.k);
    assert.ok(m, `unexpected item ${it.k}`);
    assert.equal(it.s, m.s);
    assert.equal(it.d.length, 0);
    assert.equal(it.kbh, undefined);
    assert.equal(it.kbhHet, undefined);
    assert.equal(it.tk, undefined);
  }

  // Full 6x10 bag rejects taoQua and leaves bag unchanged
  const dnFullBag = [];
  for (let c = 0; c < 60; c++) {
    dnFullBag.push({ k: "potion:2", u: c + 1, x: c % 6, y: (c / 6) | 0, n: 1 });
  }
  const hDnFull = mkHero(dnFullBag, 200);
  DO.chuan(hDnFull);
  const dnFullSnap = JSON.stringify(hDnFull.bag);
  const dnFullUN = hDnFull.uN;
  assert.throws(() => DO.taoQua(hDnFull, { mon: DN.map((m) => ({ k: m.k, n: 1, dong: 0, he: m.s })) }));
  assert.equal(JSON.stringify(hDnFull.bag), dnFullSnap);
  assert.equal(hDnFull.uN, dnFullUN);

  // Trade all 6 Dinh Nghiep pieces from A to B
  const hB = mkHero([], 200);
  DO.chuan(hB);
  const tradeRes = DO.doiDo(
    { h: hDn, ds: hDn.bag.map((it) => ({ u: it.u, ban: DO.banMon(it) })), tien: 0 },
    { h: hB, ds: [], tien: 0 }
  );
  assert.equal(tradeRes.loi, undefined);
  assert.equal(hDn.bag.length, 0);
  assert.equal(hB.bag.length, 6);
  for (const m of DN) assert.ok(hB.bag.some((it) => it.k === m.k), `recipient missing ${m.k}`);

  console.log("OK: hoang-kim.test.cjs passed (9 HK pool + 6 Định Nghiệp, lock, full bag, trade, ms:76, tra-cuu, ItemDB)");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

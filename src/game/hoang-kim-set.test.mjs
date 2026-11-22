import assert from "node:assert/strict";
import { mocHoangKimMoRong } from "./hoang-kim-set.js";
import { ItemDB, equipStats } from "./itemdb.js";
import { heroStats } from "./rules.js";
import { installVoCong, skillB } from "./vocong.js";
import { World } from "./world.js";

const db = {
  g1a: { extGroup: 1, extThresholds: [2, 4] },
  g1b: { extGroup: 1, extThresholds: [2, 4] },
  g1c: { extGroup: 1, extThresholds: [2, 4] },
  g1d: { extGroup: 1, extThresholds: [2, 4] },
  g2a: { extGroup: 2, extThresholds: [2, 3] },
  g2b: { extGroup: 2, extThresholds: [2, 3] },
  g2c: { extGroup: 2, extThresholds: [2, 3] },
  horse1: { extGroup: 1, extThresholds: [2, 4] },
  noThresh: { extGroup: 1 },
  badThreshLen: { extGroup: 1, extThresholds: [2] },
  badThreshVal: { extGroup: 1, extThresholds: [0, 2] },
  badGroup: { extGroup: 0, extThresholds: [1, 2] },
};
const setOf = (k) => db[k];

// below / at each threshold
assert.equal(mocHoangKimMoRong({ Head: { k: "g1a" } }, setOf), 0);
assert.equal(mocHoangKimMoRong({ Head: { k: "g1a" }, Body: { k: "g1b" } }, setOf), 1);
assert.equal(
  mocHoangKimMoRong({ Head: { k: "g1a" }, Body: { k: "g1b" }, Belt: { k: "g1c" } }, setOf),
  1,
);
assert.equal(
  mocHoangKimMoRong(
    { Head: { k: "g1a" }, Body: { k: "g1b" }, Belt: { k: "g1c" }, Boot: { k: "g1d" } },
    setOf,
  ),
  2,
);

// groups not summed
assert.equal(mocHoangKimMoRong({ Head: { k: "g1a" }, Body: { k: "g2a" } }, setOf), 0);

// global highest tier across groups
assert.equal(
  mocHoangKimMoRong(
    {
      Head: { k: "g1a" },
      Body: { k: "g1b" },
      Ring1: { k: "g2a" },
      Ring2: { k: "g2b" },
      Belt: { k: "g2c" },
    },
    setOf,
  ),
  2,
);

// same key in distinct slots counted (legacy slot counting)
assert.equal(mocHoangKimMoRong({ Ring1: { k: "g1a" }, Ring2: { k: "g1a" } }, setOf), 1);

// broken pieces (ben === 0) skipped
assert.equal(
  mocHoangKimMoRong({ Head: { k: "g1a", ben: 1 }, Body: { k: "g1b", ben: 0 } }, setOf),
  0,
);

// Horse counted only while riding
assert.equal(mocHoangKimMoRong({ Head: { k: "g1a" }, Horse: { k: "horse1" } }, setOf, false), 0);
assert.equal(mocHoangKimMoRong({ Head: { k: "g1a" }, Horse: { k: "horse1" } }, setOf, true), 1);

// missing / invalid thresholds or group ignored
assert.equal(
  mocHoangKimMoRong(
    {
      Head: { k: "g1a" },
      Body: { k: "noThresh" },
      Belt: { k: "badThreshLen" },
      Boot: { k: "badThreshVal" },
      Weapon: { k: "badGroup" },
    },
    setOf,
  ),
  0,
);
assert.equal(mocHoangKimMoRong(null, setOf), 0);
assert.equal(mocHoangKimMoRong({ Head: { k: "g1a" } }, null), 0);

// equipStats applies g.extGold hidden pairs at global extTier using synthetic ItemDB state
const prevBy = ItemDB.by;
const prevGoc = ItemDB.goc;
try {
  ItemDB.by = new Map([
    ["hk_t1", { extGroup: 1, extThresholds: [2, 4] }],
    ["hk_t2", { extGroup: 1, extThresholds: [2, 4] }],
    ["hk_t3", { extGroup: 1, extThresholds: [2, 4] }],
    ["hk_t4", { extGroup: 1, extThresholds: [2, 4] }],
    ["hk_drv1", { extGroup: 2, extThresholds: [2, 3] }],
    ["hk_drv2", { extGroup: 2, extThresholds: [2, 3] }],
    ["hk_drv3", { extGroup: 2, extThresholds: [2, 3] }],
    ["hk_rec", { extGroup: 3, extThresholds: [2, 4] }],
    ["hk_regen", { extGroup: 3, extThresholds: [2, 4] }],
    ["hk_skill", { extGroup: 3, extThresholds: [2, 4] }],
    ["hk_sorb", { extGroup: 3, extThresholds: [2, 4] }],
    ["hk_block100", { extGroup: 3, extThresholds: [2, 4] }],
    ["hk_block0", { extGroup: 3, extThresholds: [2, 4] }],
    ["hk_skenh", { extGroup: 3, extThresholds: [2, 4] }],
  ]);
  ItemDB.goc = {
    hk_t1: { extGold: [["lifemax_v", 60], ["manamax_v", -49]] },
    hk_t2: {},
    hk_t3: {},
    hk_t4: {},
    hk_drv1: {},
    hk_drv2: {},
    hk_drv3: {},
    hk_rec: { extGold: [["lifemax_v", 60], ["manamax_v", -49]] },
    hk_regen: { extGold: [["lifereplenish_p", 30]] },
    hk_skill: { extGold: [["allskill_v", 1, 0], ["allskill_v", 2, 102]] },
    hk_sorb: { extGold: [["sorbdamage_yan_p", 80]] },
    hk_block100: { extGold: [["block_rate", 100]] },
    hk_block0: { extGold: [["block_rate", 0]] },
    hk_skenh: { extGold: [["skill_enhance", 80]] },
  };

  // below tier 1
  const s0 = equipStats({ equip: { Head: { k: "hk_t1" } } }, false);
  assert.equal(s0.life, 0);
  assert.equal(s0.mana, 0);

  // at tier 1: first extGold pair only
  const s1 = equipStats({ equip: { Head: { k: "hk_t1" }, Body: { k: "hk_t2" } } }, false);
  assert.equal(s1.life, 60);
  assert.equal(s1.mana, 0);

  // at tier 2: both extGold pairs including signed negative mana
  const s2 = equipStats(
    {
      equip: {
        Head: { k: "hk_t1" },
        Body: { k: "hk_t2" },
        Belt: { k: "hk_t3" },
        Boot: { k: "hk_t4" },
      },
    },
    false,
  );
  assert.equal(s2.life, 60);
  assert.equal(s2.mana, -49);

  // breaking (ben === 0) drops tier 2 -> tier 1 bonus
  const sBroken = equipStats(
    {
      equip: {
        Head: { k: "hk_t1" },
        Body: { k: "hk_t2" },
        Belt: { k: "hk_t3" },
        Boot: { k: "hk_t4", ben: 0 },
      },
    },
    false,
  );
  assert.equal(sBroken.life, 60);
  assert.equal(sBroken.mana, 0);

  // removing piece drops tier 1 -> 0 bonus
  const sRemoved = equipStats({ equip: { Head: { k: "hk_t1" } } }, false);
  assert.equal(sRemoved.life, 0);
  assert.equal(sRemoved.mana, 0);

  // global tier from group 2 applies to equipped recipient outside threshold-driving group
  const sCrossGroup = equipStats(
    {
      equip: {
        Ring1: { k: "hk_drv1" },
        Ring2: { k: "hk_drv2" },
        Belt: { k: "hk_drv3" },
        Necklace: { k: "hk_rec" },
      },
    },
    false,
  );
  assert.equal(sCrossGroup.life, 60);
  assert.equal(sCrossGroup.mana, -49);

  // legacy lifereplenish_p hidden affix propagates through equipStats -> heroStats
  const chr = {
    levelAdd: [{
      LifePerVitality: 1, LifePerLevel: 1, ManaPerEnergy: 1, ManaPerLevel: 1,
      StaminaMaleBase: 10, StaminaMalePerLevel: 1, StaminaPerVitality: 1,
      fireres: 0, coldres: 0, lightingres: 0, poisonres: 0, physicres: 0,
    }],
  };
  const hBase = { start: { str: 10, dex: 10, vit: 10, eng: 10 }, series: 0, lvl: 1 };

  const hr0 = heroStats(hBase, chr, equipStats({ equip: { Necklace: { k: "hk_regen" }, Ring1: { k: "hk_drv1" } } }, false));
  assert.equal(hr0.lifeRegenPct, 0);
  assert.equal(hr0.lifeRegen, 0);

  const hr1 = heroStats(hBase, chr, equipStats({ equip: { Necklace: { k: "hk_regen" }, Ring1: { k: "hk_drv1" }, Ring2: { k: "hk_drv2" } } }, false));
  assert.equal(hr1.lifeRegenPct, 30);
  assert.equal(hr1.lifeRegen, 0);

  const hrBroken = heroStats(hBase, chr, equipStats({ equip: { Necklace: { k: "hk_regen" }, Ring1: { k: "hk_drv1" }, Ring2: { k: "hk_drv2", ben: 0 } } }, false));
  assert.equal(hrBroken.lifeRegenPct, 0);
  assert.equal(hrBroken.lifeRegen, 0);

  // Idle sorbdamage_yan_p (+80) through equipStats -> heroStats -> World.prototype.guard
  const pSorb = heroStats(hBase, chr, equipStats({ equip: { Necklace: { k: "hk_sorb" }, Ring1: { k: "hk_drv1" }, Ring2: { k: "hk_drv2" } } }, false));
  assert.equal(pSorb.sorb, 80);
  const dEquipped = { v: 150 };
  World.prototype.guard.call({ P: {} }, { series: 0 }, pSorb, dEquipped);
  assert.equal(dEquipped.v, 70);

  const dFloor = { v: 60 };
  World.prototype.guard.call({ P: {} }, { series: 0 }, pSorb, dFloor);
  assert.equal(dFloor.v, 1);

  const pSorbBroken = heroStats(hBase, chr, equipStats({ equip: { Necklace: { k: "hk_sorb" }, Ring1: { k: "hk_drv1" }, Ring2: { k: "hk_drv2", ben: 0 } } }, false));
  assert.equal(pSorbBroken.sorb, 0);
  const dBroken = { v: 150 };
  World.prototype.guard.call({ P: {} }, { series: 0 }, pSorbBroken, dBroken);
  assert.equal(dBroken.v, 150);

  // Golden block_rate -> equipStats -> heroStats -> World.prototype.guard + hit/phanDon (100/0 + broken)
  const pBlock100 = heroStats(
    hBase,
    chr,
    equipStats({ equip: { Necklace: { k: "hk_block100" }, Ring1: { k: "hk_drv1" }, Ring2: { k: "hk_drv2" } } }, false),
  );
  assert.equal(pBlock100.blockRate, 100);
  pBlock100.hp = 500;
  pBlock100.mp = 100;
  pBlock100.manaShield = 50;
  pBlock100.thorns = 50;
  pBlock100.thornsPct = 50;
  const hitCalls = [];
  const texts = [];
  const fakeWorld = {
    P: { vc: null },
    dev: {},
    hao: [0, 0],
    player: pBlock100,
    guard: World.prototype.guard,
    hit(src, dst, dmg) {
      hitCalls.push({ src, dst, dmg: { ...dmg } });
      return World.prototype.hit.call(this, src, dst, dmg);
    },
    text(dst, msg) { texts.push({ dst, msg }); },
    phanDon(q, d, he, xa) {
      if (!q || q.alive === false || d.miss || !(d.v > 0)) return;
      this.hit(pBlock100, q, { v: 1, reflect: true });
    },
  };
  const mob = { kind: "mob", series: 0, alive: true };
  const dBlk = { v: 120 };
  fakeWorld.guard(mob, pBlock100, dBlk);
  assert.equal(dBlk.miss, true);
  assert.equal(dBlk.v, 0);
  fakeWorld.hit(mob, pBlock100, dBlk);
  fakeWorld.phanDon(mob, dBlk);
  assert.equal(pBlock100.hp, 500);
  assert.equal(pBlock100.mp, 100);
  assert.equal(fakeWorld.hao[1], 0);
  assert.equal(hitCalls.length, 1);
  assert.deepEqual(texts, [{ dst: pBlock100, msg: "Né" }]);

  // 0% block_rate does not touch Math.random and lets damage + mana shield apply
  const pBlock0 = heroStats(
    hBase,
    chr,
    equipStats({ equip: { Necklace: { k: "hk_block0" }, Ring1: { k: "hk_drv1" }, Ring2: { k: "hk_drv2" } } }, false),
  );
  assert.equal(pBlock0.blockRate, 0);
  pBlock0.hp = 500;
  pBlock0.mp = 100;
  pBlock0.manaShield = 50;
  const origRandom = Math.random;
  let randomCalls = 0;
  Math.random = () => {
    randomCalls++;
    return 0;
  };
  try {
    const dZero = { v: 100 };
    World.prototype.guard.call({ P: {} }, { series: 0 }, pBlock0, dZero);
    assert.equal(randomCalls, 0);
    assert.equal(dZero.miss, undefined);
    assert.equal(dZero.v, 50);
    assert.equal(pBlock0.mp, 50);
  } finally {
    Math.random = origRandom;
  }

  // broken driver clears block_rate and leaves guard unblocked
  const pBlockBroken = heroStats(
    hBase,
    chr,
    equipStats({ equip: { Necklace: { k: "hk_block100" }, Ring1: { k: "hk_drv1" }, Ring2: { k: "hk_drv2", ben: 0 } } }, false),
  );
  assert.equal(pBlockBroken.blockRate, 0);
  const dBlkBroken = { v: 120 };
  World.prototype.guard.call({ P: {} }, { series: 0 }, pBlockBroken, dBlkBroken);
  assert.equal(dBlkBroken.miss, undefined);
  assert.equal(dBlkBroken.v, 120);

  // hidden allskill_v (global & targeted) through installVoCong/World.skLv and skillB
  class TestWorld {
    constructor(hero, skillDb) {
      this.hero = hero;
      this.P = { skillDb };
    }
    riding() { return false; }
  }
  installVoCong(TestWorld);

  const skillDb = {
    101: { style: 3, lv: { lifemax_v: [[10, 0, 0], [20, 0, 0], [30, 0, 0], [40, 0, 0], [50, 0, 0]] } },
    102: { style: 3, lv: { manamax_v: [[5, 0, 0], [10, 0, 0], [15, 0, 0], [20, 0, 0], [25, 0, 0]] } },
    103: { style: 3, lv: { lifemax_v: [[100, 0, 0], [200, 0, 0], [300, 0, 0], [400, 0, 0], [500, 0, 0]] } },
  };
  const skHero = { skills: { 101: 1, 102: 1 }, equip: { Necklace: { k: "hk_skill" }, Ring1: { k: "hk_drv1" } } };
  const w = new TestWorld(skHero, skillDb);

  // below threshold: no global or targeted bonus
  assert.equal(w.skLv(101), 1);
  assert.equal(w.skLv(102), 1);
  assert.equal(w.skLv(103), 0);
  const sb0 = skillB(skHero, skillDb, -1, null, 0, null, equipStats(skHero, false));
  assert.equal(sb0.life, 10);
  assert.equal(sb0.mana, 5);

  // at tier 1: global +1 applies to both learned skills; unlearned remains 0
  skHero.equip = { Necklace: { k: "hk_skill" }, Ring1: { k: "hk_drv1" }, Ring2: { k: "hk_drv2" } };
  assert.equal(w.skLv(101), 2);
  assert.equal(w.skLv(102), 2);
  assert.equal(w.skLv(103), 0);
  const sb1 = skillB(skHero, skillDb, -1, null, 0, null, equipStats(skHero, false));
  assert.equal(sb1.life, 20);
  assert.equal(sb1.mana, 10);

  // at tier 2: targeted +2 adds on top of global +1 for skill 102 only
  skHero.equip = { Necklace: { k: "hk_skill" }, Ring1: { k: "hk_drv1" }, Ring2: { k: "hk_drv2" }, Belt: { k: "hk_drv3" } };
  assert.equal(w.skLv(101), 2);
  assert.equal(w.skLv(102), 4);
  assert.equal(w.skLv(103), 0);
  const sb2 = skillB(skHero, skillDb, -1, null, 0, null, equipStats(skHero, false));
  assert.equal(sb2.life, 20);
  assert.equal(sb2.mana, 20);

  // broken driver clears bonus
  skHero.equip = { Necklace: { k: "hk_skill" }, Ring1: { k: "hk_drv1" }, Ring2: { k: "hk_drv2", ben: 0 } };
  assert.equal(w.skLv(101), 1);
  assert.equal(w.skLv(102), 1);
  assert.equal(w.skLv(103), 0);
  const sbBroken = skillB(skHero, skillDb, -1, null, 0, null, equipStats(skHero, false));
  assert.equal(sbBroken.life, 10);
  assert.equal(sbBroken.mana, 5);
  assert.deepEqual(skHero.skills, { 101: 1, 102: 1 });

  // hidden skill_enhance (+80) through equipStats -> heroStats -> supDon / skDamage / poisonOf / handDamage
  const skEnhDb = {
    201: {
      id: 201,
      series: 0,
      phys: false,
      lv: {
        firedamage_v: [[100, 0, 100]],
        poisondamage_v: [[10, 54, 9]],
      },
    },
  };
  const vcStub = { sk: () => ({ useAR: false }) };
  const mobZeroRes = { kind: "mob", series: 2, alive: true, res: { fire: 0, cold: 0, light: 0, poison: 0, phys: 0 } };
  class EnhWorld {
    constructor(hero) {
      this.hero = hero;
      this.P = { skillDb: skEnhDb, vc: vcStub };
      this.player = heroStats(hero, chr, equipStats(hero, false));
      this.vcSupport = null;
    }
    riding() { return false; }
  }
  installVoCong(EnhWorld);

  const wEnh0 = new EnhWorld({ ...hBase, skills: { 201: 1 }, equip: { Necklace: { k: "hk_skenh" }, Ring1: { k: "hk_drv1" } } });
  assert.equal(wEnh0.player.skillEnhance, 0);
  assert.deepEqual(wEnh0.player.dmg, [3, 4]);
  assert.equal(wEnh0.supDon({ id: 201, root: 201, lv: 1 }), 0);
  assert.deepEqual(wEnh0.handDamage(201), [160, 160]);
  const enhAttr = { firedamage_v: [100, 0, 100], poisondamage_v: [10, 54, 9] };
  assert.equal(wEnh0.skDamage(skEnhDb[201], enhAttr, { id: 201, root: 201, lv: 1 }, mobZeroRes).v, 100);

  const wEnh1 = new EnhWorld({ ...hBase, skills: { 201: 1 }, equip: { Necklace: { k: "hk_skenh" }, Ring1: { k: "hk_drv1" }, Ring2: { k: "hk_drv2" } } });
  assert.equal(wEnh1.player.skillEnhance, 80);
  assert.deepEqual(wEnh1.player.dmg, wEnh0.player.dmg);
  assert.equal(wEnh1.supDon({ id: 201, root: 201, lv: 1 }), 80);
  assert.equal(wEnh1.skLv(201), 1);
  assert.deepEqual(wEnh1.handDamage(201), [288, 288]);
  assert.equal(wEnh1.skDamage(skEnhDb[201], enhAttr, { id: 201, root: 201, lv: 1 }, mobZeroRes).v, 180);
  assert.equal(wEnh1.poisonOf(skEnhDb[201], enhAttr, { id: 201, root: 201, lv: 1 }).v, 18);

  const wEnhBroken = new EnhWorld({ ...hBase, skills: { 201: 1 }, equip: { Necklace: { k: "hk_skenh" }, Ring1: { k: "hk_drv1" }, Ring2: { k: "hk_drv2", ben: 0 } } });
  assert.equal(wEnhBroken.player.skillEnhance, 0);
  assert.equal(wEnhBroken.supDon({ id: 201, root: 201, lv: 1 }), 0);
  assert.deepEqual(wEnhBroken.handDamage(201), [160, 160]);
} finally {
  ItemDB.by = prevBy;
  ItemDB.goc = prevGoc;
}

console.log("hoang-kim-set tests ok");

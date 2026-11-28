"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { taoBotLuyenCong, taoDoiLuyenCong } = require("./bot-luyen-cong.js");

const CURATED = [
  ["shaolin", 19], ["tianwang", 32], ["tangmen", 249], ["wudu", 71], ["emei", 88],
  ["cuiyan", 108], ["gaibang", 128], ["tianren", 148], ["wudang", 165], ["kunlun", 182],
];

const CURATED_OUTFITS = {
  shaolin: { sex: "m", look: { armor: 24, helm: 3, weapon: 23, mantle: 1 } },
  tianwang: { sex: "m", look: { armor: 36, helm: 15, weapon: 23, mantle: 1 } },
  tangmen: { sex: "m", look: { armor: 33, helm: 12, weapon: 20, mantle: 1 } },
  wudu: { sex: "m", look: { armor: 30, helm: 9, weapon: 23, mantle: 1 } },
  emei: { sex: "f", look: { armor: 27, helm: 3, weapon: 21, mantle: 1 } },
  cuiyan: { sex: "f", look: { armor: 42, helm: 21, weapon: 23, mantle: 1 } },
  gaibang: { sex: "m", look: { armor: 39, helm: 18, weapon: 27, mantle: 1 } },
  tianren: { sex: "m", look: { armor: 30, helm: 15, weapon: 25, mantle: 1 } },
  wudang: { sex: "m", look: { armor: 27, helm: 6, weapon: 21, mantle: 1 } },
  kunlun: { sex: "m", look: { armor: 42, helm: 12, weapon: 21, mantle: 1 } },
};
const DEFAULT_OUTFIT = { sex: "m", look: { armor: 19, helm: 19, weapon: 1, mantle: 1 } };

const FAC_NAMES = {
  shaolin: "Thiếu Lâm",
  tianwang: "Thiên Vương",
  tangmen: "Đường Môn",
  wudu: "Ngũ Độc",
  emei: "Nga My",
  cuiyan: "Thúy Yên",
  gaibang: "Cái Bang",
  tianren: "Thiên Nhẫn",
  wudang: "Võ Đang",
  kunlun: "Côn Lôn",
};

function makeCatalog({ req = 50, max = 20, missingSkillId = null, missingVcId = null, dropFromFaction = null } = {}) {
  const factions = CURATED.map(([key, id]) => ({
    key,
    n: FAC_NAMES[key],
    skills: dropFromFaction === key ? [] : [id],
  }));
  const skills = {};
  const vcSk = {};
  for (const [, id] of CURATED) {
    if (id !== missingSkillId) skills[id] = { req, max, target: { enemy: 1 } };
    if (id !== missingVcId) vcSk[id] = { mis: id + 100 };
  }
  return { factions, skills, vcSk };
}

function loadQuaiChungMocked({ zone = { id: 319, lo: 70, hi: 80, map: "m319" }, zones = null, bai = null, envBat = "1", skillsJson = null, vocongJson = null, noiExtra = null, mapCtor = null } = {}) {
  const targetPath = path.resolve(__dirname, "quai-chung.js");
  const doPath = path.resolve(__dirname, "do.js");
  const wsPath = path.resolve(__dirname, "ws.js");
  const ndPath = path.resolve(__dirname, "nghi-dame.js");
  const tgPath = path.resolve(__dirname, "the-gioi.js");
  const mapPath = path.resolve(__dirname, "../src/game/map.js");
  const skillsPath = path.resolve(__dirname, "../assets/web/skill/skills.json");
  const vocongPath = path.resolve(__dirname, "../assets/web/vocong/vocong.json");

  const zoneEntries = zones
    ? (zones instanceof Map ? [...zones.entries()] : Object.entries(zones).map(([k, v]) => [+k, v]))
    : (zone ? [[zone.id || 319, zone]] : []);
  const baiList = bai || (zoneEntries.length ? zoneEntries.map(([id]) => id) : [319]);
  const mocks = new Map([
    [doPath, {
      LUAT: { canBang: {} },
      NOI: {
        CFG: { quaiChung: { bai: baiList } },
        ZONES: new Map(zoneEntries),
        ...(noiExtra || {}),
      },
    }],
    [wsPath, { nhan() {}, moi() {}, cua: () => null, guiTk() {} }],
    [ndPath, { cong() {} }],
    [tgPath, { dangChoi: () => null, thongBaoTk() {} }],
  ]);
  if (mapCtor) mocks.set(mapPath, { GameMap: mapCtor });
  if (skillsJson !== null) mocks.set(skillsPath, skillsJson);
  if (vocongJson !== null) mocks.set(vocongPath, vocongJson);

  const prevEnv = process.env.VL_BOT_LUYEN_CONG;
  if (envBat === undefined) delete process.env.VL_BOT_LUYEN_CONG;
  else process.env.VL_BOT_LUYEN_CONG = envBat;

  const origLoad = Module._load;
  delete require.cache[targetPath];
  Module._load = function mockedLoad(request, parent, isMain) {
    const resolved = Module._resolveFilename(request, parent, isMain);
    if (mocks.has(resolved)) return mocks.get(resolved);
    if (resolved === skillsPath || resolved === vocongPath) {
      const err = new Error(`Cannot find module '${request}'`);
      err.code = "MODULE_NOT_FOUND";
      throw err;
    }
    return origLoad.call(this, request, parent, isMain);
  };
  try {
    const mod = require(targetPath);
    if (mapCtor) {
      const origBotMap = mod._bot.botMap;
      mod._bot.botMap = (baiId) => {
        const prev = Module._load;
        Module._load = function mockedMapLoad(request, parent, isMain) {
          const resolved = Module._resolveFilename(request, parent, isMain);
          if (resolved === mapPath) return { GameMap: mapCtor };
          return prev.call(this, request, parent, isMain);
        };
        try { return origBotMap(baiId); }
        finally { Module._load = prev; }
      };
    }
    return mod;
  } finally {
    Module._load = origLoad;
    delete require.cache[targetPath];
    if (prevEnv === undefined) delete process.env.VL_BOT_LUYEN_CONG;
    else process.env.VL_BOT_LUYEN_CONG = prevEnv;
  }
}

function makeRoom(ctl = taoDoiLuyenCong()) {
  return {
    bai: 319,
    q: new Map(),
    vt: new Map(),
    trong: new Map([["p1", "Player1"]]),
    song: new Map(),
    an: new Set(),
    chu: null,
    ack: new Map(),
    han: new Map(),
    dan: new Map(),
    seq: 0,
    sv: 0,
    daSpec: new Map(),
    doi: false,
    guiLuc: 0,
    rong: 0,
    hpDoi: new Set(),
    hpLuc: 0,
    nk: [],
    botCtl: ctl,
    botsSt: [],
  };
}

function makeOneBotAdapter() {
  const single = taoBotLuyenCong();
  return {
    ghiDanh: single.ghiDanh,
    tick(t, nguoi, quai, map) {
      const uid = single.tick(t, nguoi, quai, map);
      return uid != null ? [{ id: 1, uid }] : [];
    },
    trangThai() {
      const st = single.trangThai();
      return st ? [{ id: 1, ...st }] : [];
    },
  };
}

describe("bot-luyen-cong profile & cast metadata", () => {
  it("picks deterministic map levels at random extremes [0, 0.999999] within zone lo..hi", () => {
    const { _bot } = loadQuaiChungMocked();
    const z = { lo: 70, hi: 80 };
    assert.equal(_bot.botPickLevel(z, () => 0), 70);
    assert.equal(_bot.botPickLevel(z, () => 0.999999), 80);
    assert.equal(_bot.botPickLevel(z, () => 0.5), 75);
    assert.equal(_bot.botPickLevel(z, () => Number.NaN), 70);
    assert.equal(_bot.botPickLevel({ lo: 42, hi: 42 }, () => 0.999999), 42);
  });

  it("maps every curated faction when eligible and enforces req<=lvl and skillLv<=min(max,lvl-req+1)", () => {
    const { _bot } = loadQuaiChungMocked();
    assert.deepEqual(_bot.BOT_SKILLS, CURATED);

    const cat = makeCatalog({ req: 50, max: 20 });
    const z = { lo: 70, hi: 80 };
    for (let i = 0; i < CURATED.length; i++) {
      const r = (i + 0.01) / CURATED.length;
      const prof = _bot.botRollProfile(z, cat, () => r);
      const [expFac, expId] = CURATED[i];
      assert.equal(prof.fac, expFac);
      assert.equal(prof.facName, FAC_NAMES[expFac]);
      assert.equal(prof.skillId, expId);
      assert.equal(prof.lvl, 70 + Math.floor(r * 11));
      assert.equal(prof.skillLv, Math.min(20, prof.lvl - 50 + 1));
      assert.ok(prof.skillLv >= 1 && prof.skillLv <= 20);
      assert.ok(50 <= prof.lvl);
    }

    // Skill req=65 at lvl=70 => skillLv = min(20, 70-65+1) = 6; req=70 => skillLv=1
    assert.equal(_bot.botRollProfile({ lo: 70, hi: 70 }, makeCatalog({ req: 65, max: 20 }), () => 0).skillLv, 6);
    assert.equal(_bot.botRollProfile({ lo: 70, hi: 70 }, makeCatalog({ req: 70, max: 20 }), () => 0).skillLv, 1);

    // No skill higher than map level: all req > 80 -> fails closed to { lvl } + default outfit only
    const highReq = _bot.botRollProfile(z, makeCatalog({ req: 81, max: 20 }), () => 0.999999);
    assert.deepEqual(highReq, { lvl: 80, ...DEFAULT_OUTFIT });

    // Missing VFX / missing skill / wrong faction membership filters out ineligible entry
    const partialCat = makeCatalog({ req: 50, missingVcId: 19, dropFromFaction: "tianwang", missingSkillId: 249 });
    const picked = _bot.botRollProfile({ lo: 70, hi: 70 }, partialCat, () => 0);
    assert.equal(picked.fac, "wudu");
    assert.equal(picked.skillId, 71);
    assert.deepEqual({ sex: picked.sex, look: picked.look }, CURATED_OUTFITS.wudu);
  });

  it("lazy-loads asset catalogs once and falls back cleanly when assets are missing", () => {
    const qcMissing = loadQuaiChungMocked();
    assert.equal(qcMissing._bot.botCatalogs(), null);
    assert.deepEqual(qcMissing._bot.botRollProfile({ lo: 70, hi: 80 }, qcMissing._bot.botCatalogs(), () => 0.5), { lvl: 75, ...DEFAULT_OUTFIT });

    const cat = makeCatalog({ req: 50, max: 20 });
    const qcLoaded = loadQuaiChungMocked({
      skillsJson: { factions: cat.factions, skills: cat.skills },
      vocongJson: { sk: cat.vcSk },
    });
    const loaded = qcLoaded._bot.botCatalogs((p) => {
      if (p.endsWith("skills.json")) return { factions: cat.factions, skills: cat.skills };
      if (p.endsWith("vocong.json")) return { sk: cat.vcSk };
      throw new Error("unexpected path");
    });
    assert.ok(loaded);
    assert.equal(loaded.factions.length, 10);
    assert.equal(qcLoaded._bot.botCatalogs(), loaded);
  });

  it("keeps profile stable for lifetime, rerolls on respawn, emits cast on strike for ~450ms, and runs onKill synchronously", () => {
    const cat = makeCatalog({ req: 50, max: 20 });
    const qc = loadQuaiChungMocked({
      skillsJson: { factions: cat.factions, skills: cat.skills },
      vocongJson: { sk: cat.vcSk },
    });
    const P = makeRoom(makeOneBotAdapter());
    const openMap = { walkable: () => true, clear: () => true };
    const nguoi = new Map([["p1", { x: 1000, y: 1000 }]]);
    const mob1 = { uid: 1, tpl: 1, lv: 75, he: 0, x: 1010, y: 1000, mau: 1000, mauMax: 1000, boss: 0, ta: 0, sat: 0, dmg: new Map() };
    const mob2 = { uid: 2, tpl: 1, lv: 75, he: 0, x: 1250, y: 1000, mau: 100, mauMax: 100, boss: 0, ta: 0, sat: 0, dmg: new Map() };
    P.q.set(1, mob1);
    P.q.set(2, mob2);
    P.vt.set(2, [1250, 1015, ""]);

    let rollIdx = 0;
    const rolls = [0.0, 0.9, 0.85, 0.25];
    const rng = () => rolls[Math.min(rollIdx++, rolls.length - 1)];
    const kills = [];
    const step = (t) => qc._bot.botBuoc(P, new Map([["p1", {}]]), t, {
      zone: { id: 319, lo: 70, hi: 80 },
      getCatalogs: () => cat,
      map: openMap,
      nguoi,
      rng,
      onKill: (m) => { kills.push({ uid: m.uid, st: P.botsSt[0] }); m.mau = 0; },
    });

    P.botCtl.ghiDanh(0, "p1", 1);
    P.botCtl.ghiDanh(1000, "p1", 1);
    step(3100);
    assert.equal(P.botsSt.length, 1);
    const bot0 = () => P.botsSt[0];
    const firstProf = {
      lvl: bot0().lvl,
      fac: bot0().fac,
      facName: bot0().facName,
      skillId: bot0().skillId,
      skillLv: bot0().skillLv,
      sex: bot0().sex,
      look: bot0().look,
    };
    assert.equal(firstProf.lvl, 70);
    assert.equal(firstProf.fac, "kunlun");
    assert.equal(firstProf.skillId, 182);
    assert.deepEqual({ sex: firstProf.sex, look: firstProf.look }, CURATED_OUTFITS.kunlun);
    assert.equal(bot0().cast, undefined);

    // Move and strike mob 2; cast tracks current P.vt target coordinates and exact 5% damage
    let strikeT = null;
    for (let t = 3300; t <= 8000; t += 200) {
      step(t);
      if (bot0() && bot0().cast) { strikeT = t; break; }
    }
    assert.ok(strikeT !== null);
    assert.equal(mob2.mau, 95);
    assert.deepEqual(bot0().cast, { n: 1, x: 1250, y: 1015, at: strikeT });
    assert.equal(bot0().lvl, firstProf.lvl);
    assert.equal(bot0().fac, firstProf.fac);
    assert.equal(bot0().skillId, firstProf.skillId);
    assert.deepEqual(bot0().look, CURATED_OUTFITS.kunlun.look);

    // Cast stays within <450ms and expires at >=450ms
    step(strikeT + 300);
    assert.deepEqual(bot0().cast, { n: 1, x: 1250, y: 1015, at: strikeT });
    assert.equal(P.doi, true);
    P.doi = false;
    step(strikeT + 450);
    assert.equal(bot0().cast, undefined);
    assert.equal(P.doi, true);

    // Synchronous cast update before kill handler runs
    mob2.mau = 1;
    P.vt.set(2, [1260, 1025, ""]);
    let killT = null;
    for (let t = strikeT + 1000; t <= strikeT + 3000; t += 200) {
      step(t);
      if (kills.length) { killT = t; break; }
    }
    assert.equal(kills.length, 1);
    assert.equal(kills[0].uid, 2);
    assert.deepEqual(kills[0].st.cast, { n: 2, x: 1260, y: 1025, at: killT });
    assert.equal(bot0().lvl, 70);
    assert.equal(bot0().fac, "kunlun");

    // Despawn clears state & profile, respawn rerolls (last hit was at t=1000; 45s inactive + up to 8s exit)
    for (let t = killT + 200; t <= 45800; t += 200) step(t);
    assert.equal(P.botsSt.length, 1);
    for (let t = 46000; t <= 54000; t += 200) step(t);
    assert.deepEqual(P.botsSt, []);
    assert.equal(P.doi, true);

    const respawnStart = 55000;
    P.botCtl.ghiDanh(respawnStart, "p1", 1);
    P.botCtl.ghiDanh(respawnStart + 500, "p1", 1);
    step(respawnStart + 3600);
    assert.equal(P.botsSt.length, 1);
    assert.notEqual(bot0().fac, firstProf.fac);
    assert.equal(bot0().lvl, 79);
    assert.equal(bot0().fac, "tangmen");
    assert.equal(bot0().skillId, 249);
    assert.deepEqual({ sex: bot0().sex, look: bot0().look }, CURATED_OUTFITS.tangmen);
  });

  it("spawns 3-bot squad with distinct factions and outfits, stable per-bot casts/profiles, and exact 5% hit damage", () => {
    const cat = makeCatalog({ req: 50, max: 20 });
    const qc = loadQuaiChungMocked({
      skillsJson: { factions: cat.factions, skills: cat.skills },
      vocongJson: { sk: cat.vcSk },
    });
    const P = makeRoom();
    const openMap = { walkable: () => true, clear: () => true };
    const nguoi = new Map([["p1", { x: 1000, y: 1000 }]]);
    const mobs = [
      { uid: 1, tpl: 1, lv: 75, he: 0, x: 1015, y: 1000, mau: 1000, mauMax: 1000, boss: 0, ta: 0, sat: 0, dmg: new Map() },
      { uid: 11, tpl: 1, lv: 75, he: 0, x: 1180, y: 1000, mau: 1000, mauMax: 1000, boss: 0, ta: 0, sat: 0, dmg: new Map() },
      { uid: 12, tpl: 1, lv: 75, he: 0, x: 1000, y: 1180, mau: 1000, mauMax: 1000, boss: 0, ta: 0, sat: 0, dmg: new Map() },
      { uid: 13, tpl: 1, lv: 75, he: 0, x: 820, y: 1000, mau: 1000, mauMax: 1000, boss: 0, ta: 0, sat: 0, dmg: new Map() },
    ];
    for (const m of mobs) P.q.set(m.uid, m);

    // Deterministic RNG cycling fixed values would collide without faction exclusion; squad must still get 3 distinct factions & full outfits
    let i = 0;
    const rng = () => [0.15, 0.0, 0.25, 0.5][i++ % 4];
    const step = (t) => qc._bot.botBuoc(P, new Map([["p1", {}]]), t, {
      zone: { id: 319, lo: 70, hi: 80 },
      getCatalogs: () => cat,
      map: openMap,
      nguoi,
      rng,
    });

    P.botCtl.ghiDanh(0, "p1", 1);
    P.botCtl.ghiDanh(1000, "p1", 1);
    step(3100);
    assert.equal(P.botsSt.length, 3);
    assert.equal(P.doi, true);

    const facs = P.botsSt.map((b) => b.fac);
    assert.equal(new Set(facs).size, 3);
    const outfits = P.botsSt.map((b) => JSON.stringify({ sex: b.sex, look: b.look }));
    assert.equal(new Set(outfits).size, 3);
    for (const b of P.botsSt) {
      assert.deepEqual({ sex: b.sex, look: b.look }, CURATED_OUTFITS[b.fac]);
      assert.equal(b.look.mantle, 1);
      assert.equal(b.look.horse, undefined);
    }

    // Step until all 3 bots have attacked once; verify each accepted hit deals exact 5% (50) per atkN and outfits/profiles stay stable
    for (let t = 3300; t <= 9000; t += 200) {
      step(t);
      if (P.botsSt.every((b) => b.atkN >= 1)) break;
    }
    assert.ok(P.botsSt.every((b) => b.atkN >= 1));
    assert.deepEqual(P.botsSt.map((b) => b.fac), facs);
    assert.deepEqual(P.botsSt.map((b) => JSON.stringify({ sex: b.sex, look: b.look })), outfits);
    const totalAtk = P.botsSt.reduce((sum, b) => sum + b.atkN, 0);
    const totalDmg = [11, 12, 13].reduce((sum, uid) => sum + (1000 - P.q.get(uid).mau), 0);
    assert.equal(totalDmg, totalAtk * 50);
    for (const uid of [11, 12, 13]) {
      const lost = 1000 - P.q.get(uid).mau;
      assert.ok(lost >= 50 && lost % 50 === 0);
    }

    // Despawn clears P.botsSt and sets P.doi = true (last hit at t=1000; 45s inactive + up to 8s exit)
    for (let t = 9200; t <= 45800; t += 200) step(t);
    assert.equal(P.botsSt.length, 3);
    P.doi = false;
    for (let t = 46000; t <= 54000; t += 200) step(t);
    assert.deepEqual(P.botsSt, []);
    assert.equal(P.doi, true);
  });

  it("gates bots on shared zone 70..100 with env flag and resolves per-map collision grids without cross-map bleed", () => {
    const mapSpecs = {
      m319: { jmo: "j319" },
      m336: { jmo: "j336" },
    };
    const jmoSpecs = {
      j319: { obs: "AA==", gw: 10, gh: 10, cw: 32, ch: 32, minX: 100 },
      j336: { obs: "AA==", gw: 12, gh: 12, cw: 32, ch: 32, minX: 2000 },
    };
    const builtKeys = [];
    class FakeGameMap {
      constructor(key, m, j) {
        builtKeys.push(key);
        this.grid = true;
        this.minX = j.minX;
      }
      walkable(x) { return x >= this.minX; }
      an() { return false; }
      clear() { return true; }
      path(ax, ay, bx, by) { return [[bx, by]]; }
    }

    const zones = new Map([
      [69, { id: 69, lo: 69, hi: 75, map: "m319" }],
      [70, { id: 70, lo: 70, hi: 80, map: "m336" }],
      [319, { id: 319, lo: 70, hi: 80, map: "m319" }],
      [224, { id: 224, lo: 90, hi: 100, map: "m336" }],
      [226, { id: 226, lo: 100, hi: 110, map: "m336" }],
      [999, { id: 999, lo: 80, hi: 90, map: "m336" }],
      [888, { id: 888, lo: Number.NaN, hi: 90, map: "m336" }],
      [777, { id: 777, lo: null, hi: 90, map: "m336" }],
      [778, { id: 778, lo: undefined, hi: 90, map: "m336" }],
      [889, { id: 889, lo: 80, hi: Number.NaN, map: "m336" }],
      [779, { id: 779, lo: 80, hi: null, map: "m336" }],
      [780, { id: 780, lo: 80, map: "m336" }],
      [781, { id: 781, lo: 80, hi: "   ", map: "m336" }],
      [782, { id: 782, lo: 90, hi: 80, map: "m336" }],
      [783, { id: 783, lo: "90", hi: "100", map: "m336" }],
    ]);
    const qcOn = loadQuaiChungMocked({
      zones,
      bai: [69, 70, 319, 224, 226, 888, 777, 778, 889, 779, 780, 781, 782, 783], // 999 is non-shared (not in BAI)
      noiExtra: { FULL: { maps: mapSpecs, jmo: jmoSpecs } },
      mapCtor: FakeGameMap,
    });
    assert.equal(qcOn._bot.botDuoc(69), false);
    assert.equal(qcOn._bot.botDuoc(70), true);
    assert.equal(qcOn._bot.botDuoc(319), true);
    assert.equal(qcOn._bot.botDuoc(224), true);
    assert.equal(qcOn._bot.botDuoc(226), false);
    assert.equal(qcOn._bot.botDuoc(999), false);
    assert.equal(qcOn._bot.botDuoc(888), false);
    assert.equal(qcOn._bot.botDuoc(777), false);
    assert.equal(qcOn._bot.botDuoc(778), false);
    assert.equal(qcOn._bot.botDuoc(889), false);
    assert.equal(qcOn._bot.botDuoc(779), false);
    assert.equal(qcOn._bot.botDuoc(780), false);
    assert.equal(qcOn._bot.botDuoc(781), false);
    assert.equal(qcOn._bot.botDuoc(782), false);
    assert.equal(qcOn._bot.botDuoc(783), true);

    const grid319 = qcOn._bot.botMap(319);
    const grid70 = qcOn._bot.botMap(70);
    assert.ok(grid319 && grid70 && grid319 !== grid70);
    assert.equal(grid319.walkable(150, 100), true);
    assert.equal(grid70.walkable(150, 100), false);
    assert.equal(grid70.walkable(2050, 100), true);
    // Cached per map key on subsequent lookups
    assert.equal(qcOn._bot.botMap(70), grid70);
    assert.deepEqual(builtKeys, ["m319", "m336"]);

    // Flag off disables all shared zones including 70..100
    const qcOff = loadQuaiChungMocked({
      zones,
      bai: [69, 70, 319, 224],
      envBat: "0",
      noiExtra: { FULL: { maps: mapSpecs, jmo: jmoSpecs } },
      mapCtor: FakeGameMap,
    });
    assert.equal(qcOff._bot.botDuoc(70), false);
    assert.equal(qcOff._bot.botDuoc(319), false);
    assert.equal(qcOff._bot.botDuoc(224), false);
  });

  it("wires botOpts.castMs from verified skill metadata (1000ms at spd=0) and preserves default when metadata/phys is missing", () => {
    const qc = loadQuaiChungMocked();
    assert.equal(qc._bot.botCastMs(), 1000);
    assert.equal(qc._bot.botCastMs(0), 1000);
    assert.equal(qc._bot.botCastMs(21), 778);

    const catReal = makeCatalog({ req: 50, max: 20 });
    catReal.skills[182].phys = 0; // kunlun real-shaped metadata includes phys flag
    // leave bot0's sibling skill without phys flag to verify missing metadata skips override

    const catNoPhys = makeCatalog({ req: 50, max: 20 });

    const seenOpts = [];
    const inner = taoDoiLuyenCong();
    const wrappedCtl = {
      ghiDanh: inner.ghiDanh,
      tick(t, nguoi, quai, map, botOpts) {
        seenOpts.push(botOpts);
        return inner.tick(t, nguoi, quai, map, botOpts);
      },
      trangThai: inner.trangThai,
    };
    const P = makeRoom(wrappedCtl);
    const openMap = { walkable: () => true, clear: () => true };
    const nguoi = new Map([["p1", { x: 1000, y: 1000 }]]);
    P.q.set(1, { uid: 1, tpl: 1, lv: 75, he: 0, x: 1015, y: 1000, mau: 1000, mauMax: 1000, boss: 0, ta: 0, sat: 0, dmg: new Map() });
    P.q.set(2, { uid: 2, tpl: 1, lv: 75, he: 0, x: 1200, y: 1000, mau: 1000, mauMax: 1000, boss: 0, ta: 0, sat: 0, dmg: new Map() });

    let activeCat = catReal;
    let i = 0;
    const rng = () => [0.0, 0.95, 0.0, 0.45][i++ % 4];
    const step = (t) => qc._bot.botBuoc(P, new Map([["p1", {}]]), t, {
      zone: { id: 319, lo: 70, hi: 80 },
      getCatalogs: () => activeCat,
      map: openMap,
      nguoi,
      rng,
    });

    P.botCtl.ghiDanh(0, "p1", 1);
    P.botCtl.ghiDanh(1000, "p1", 1);
    // Spawn tick: prevById empty -> botOpts is undefined (preserves no-profile path)
    step(3100);
    assert.equal(seenOpts.at(-1), undefined);
    assert.equal(P.botsSt.length, 3);
    const kunlunBot = P.botsSt.find((b) => b.fac === "kunlun");
    const otherBots = P.botsSt.filter((b) => b.fac !== "kunlun");
    assert.ok(kunlunBot && otherBots.length === 2);

    // Next tick with real-shaped skill metadata: kunlun receives castMs=1000, siblings (missing phys) omitted
    step(3300);
    const opts1 = seenOpts.at(-1);
    assert.ok(opts1 instanceof Map);
    assert.deepEqual(opts1.get(kunlunBot.id), { castMs: 1000 });
    for (const ob of otherBots) assert.equal(opts1.has(ob.id), false);

    // Missing phys / missing catalog falls back to undefined (default stagger cadence preserved)
    activeCat = catNoPhys;
    step(3500);
    assert.equal(seenOpts.at(-1), undefined);

    activeCat = null;
    step(3700);
    assert.equal(seenOpts.at(-1), undefined);
  });

  it("applies active buff attack/cast speed per-row until capped expiry, keeps early refresh, and resets to 1000ms when expired", () => {
    const qc = loadQuaiChungMocked();
    const cat = makeCatalog({ req: 50, max: 20 });
    cat.factions[0].skills.push(273);
    cat.skills[19].phys = 1; // shaolin physical attack skill
    cat.skills[273] = {
      req: 50,
      max: 20,
      eqt: -2,
      target: { self: 1 },
      lv: {
        attackspeed_v: Array.from({ length: 20 }, (_, idx) => [11 + idx, 180, 0]),
        attackspeed_yan_v: Array.from({ length: 20 }, () => [20, 180, 0]),
        addcolddamage_v: Array.from({ length: 20 }, () => [25, 180, 45]),
      },
    };
    cat.vcSk[273] = { state: 170, mis: 273 };

    const seenOpts = [];
    const seenEvents = [];
    const inner = taoDoiLuyenCong();
    const wrappedCtl = {
      ghiDanh: inner.ghiDanh,
      tick(t, nguoi, quai, map, botOpts) {
        seenOpts.push(botOpts);
        const ev = inner.tick(t, nguoi, quai, map, botOpts);
        seenEvents.push(ev);
        return ev;
      },
      trangThai: inner.trangThai,
    };
    const P = makeRoom(wrappedCtl);
    const openMap = { walkable: () => true, clear: () => true };
    const nguoi = new Map([["p1", { x: 1000, y: 1000 }]]);
    P.q.set(1, { uid: 1, tpl: 1, lv: 75, he: 0, x: 1015, y: 1000, mau: 1000, mauMax: 1000, boss: 0, ta: 0, sat: 0, dmg: new Map() });
    P.q.set(2, { uid: 2, tpl: 1, lv: 75, he: 0, x: 1250, y: 1000, mau: 10000, mauMax: 10000, boss: 0, ta: 0, sat: 0, dmg: new Map() });
    P.q.set(3, { uid: 3, tpl: 1, lv: 75, he: 0, x: 920, y: 1200, mau: 10000, mauMax: 10000, boss: 0, ta: 0, sat: 0, dmg: new Map() });
    P.q.set(4, { uid: 4, tpl: 1, lv: 75, he: 0, x: 920, y: 800, mau: 10000, mauMax: 10000, boss: 0, ta: 0, sat: 0, dmg: new Map() });

    const step = (t) => qc._bot.botBuoc(P, new Map([["p1", {}]]), t, {
      zone: { id: 319, lo: 70, hi: 80 },
      getCatalogs: () => cat,
      map: openMap,
      nguoi,
      rng: () => 0,
    });

    P.botCtl.ghiDanh(0, "p1", 1);
    P.botCtl.ghiDanh(1000, "p1", 1);
    step(3100);
    const shaolinBot = () => P.botsSt.find((b) => b.fac === "shaolin");
    const sb0 = shaolinBot();
    assert.ok(sb0 && sb0.lvl === 70 && sb0.skillId === 19);

    // Tick 3300: requests buff 273 at base 1000ms and executes controller buff event
    step(3300);
    assert.deepEqual(seenOpts.at(-1).get(sb0.id), { castMs: 1000, buff: { skillId: 273, skillLv: 20, castMs: 1000 } });
    assert.deepEqual(seenEvents.at(-1).filter((e) => e.id === sb0.id), [{ id: sb0.id, buff: { skillId: 273, skillLv: 20 } }]);
    assert.deepEqual(shaolinBot().buff, { skillId: 273, skillLv: 20, at: 3300, until: 13300 });

    // During buff cast window & far from expiry: faster castMs=667 (spd=50), no repeat buff
    step(3800);
    assert.deepEqual(seenOpts.at(-1).get(sb0.id), { castMs: 667 });
    assert.equal(seenEvents.at(-1).some((e) => e.id === sb0.id), false);

    // Physical strikes follow faster 667ms cadence (<1000ms), no repeat far from expiry
    step(4300);
    assert.deepEqual(seenOpts.at(-1).get(sb0.id), { castMs: 667 });
    assert.deepEqual(seenEvents.at(-1).filter((e) => e.id === sb0.id), [{ id: sb0.id, uid: 2 }]);
    const atkAfter1 = shaolinBot().atkN;

    step(4966);
    assert.equal(shaolinBot().atkN, atkAfter1);
    step(4967);
    assert.deepEqual(seenOpts.at(-1).get(sb0.id), { castMs: 667 });
    assert.deepEqual(seenEvents.at(-1).filter((e) => e.id === sb0.id), [{ id: sb0.id, uid: 2 }]);
    assert.equal(shaolinBot().atkN, atkAfter1 + 1);

    // Just outside renewal lead (1501ms left): no repeat; at 1500ms left: near-expiry renewal request while still 667ms
    step(11799);
    assert.deepEqual(seenOpts.at(-1).get(sb0.id), { castMs: 667 });
    step(11800);
    assert.deepEqual(seenOpts.at(-1).get(sb0.id), { castMs: 667, buff: { skillId: 273, skillLv: 20, castMs: 1000 } });

    // At expiry (t=13300): active speed expired -> reverts to 1000ms and requests/executes renewal
    step(13300);
    assert.deepEqual(seenOpts.at(-1).get(sb0.id), { castMs: 1000, buff: { skillId: 273, skillLv: 20, castMs: 1000 } });
    assert.deepEqual(seenEvents.at(-1).filter((e) => e.id === sb0.id), [{ id: sb0.id, buff: { skillId: 273, skillLv: 20 } }]);

    // Direct botBuildOpts boundary checks: castspeed_v + castspeed_yan_v, per-row ticks vs cur.until cap, invalid/non-positive rows & non-finite times
    const castCat = makeCatalog({ req: 50, max: 20 });
    castCat.factions[0].skills.push(273);
    castCat.skills[19].phys = 0;
    castCat.skills[273] = {
      req: 50,
      max: 20,
      eqt: -2,
      target: { self: 1 },
      lv: {
        castspeed_v: [[20, 90, 0]],       // 5000ms
        castspeed_yan_v: [[30, 180, 0]],  // 10000ms
        attackspeed_v: [[99, 180, 0]],    // ignored for phys=0
      },
    };
    castCat.vcSk[273] = { state: 170 };
    const mkPrev = (buff) => new Map([[1, { id: 1, fac: "shaolin", lvl: 70, skillId: 19, skillLv: 20, buff }]]);
    assert.equal(qc._bot.botBuildOpts(mkPrev({ skillId: 273, skillLv: 20, at: 1000, until: 11000 }), castCat, 5999).get(1).castMs, 667); // 20+30=50
    assert.equal(qc._bot.botBuildOpts(mkPrev({ skillId: 273, skillLv: 20, at: 1000, until: 11000 }), castCat, 6000).get(1).castMs, 723); // only 30 left
    assert.equal(qc._bot.botBuildOpts(mkPrev({ skillId: 273, skillLv: 20, at: 1000, until: 7000 }), castCat, 7000).get(1).castMs, 1000); // capped by cur.until
    assert.equal(qc._bot.botBuildOpts(mkPrev({ skillId: 273, skillLv: 20, at: Number.NaN, until: 11000 }), castCat, 2000).get(1).castMs, 1000);
    assert.equal(qc._bot.botBuildOpts(mkPrev({ skillId: 273, skillLv: 20, at: 1000, until: 11000 }), castCat, Number.NaN).get(1).castMs, 1000);
    castCat.skills[273].lv.castspeed_v = [[-10, 180, 0]];
    castCat.skills[273].lv.castspeed_yan_v = [["30", 180, 0]];
    assert.equal(qc._bot.botBuildOpts(mkPrev({ skillId: 273, skillLv: 20, at: 1000, until: 11000 }), castCat, 2000).get(1).castMs, 1000);
  });

  it("wires tangmen/wudu permanent passive speed without buff/cast events and maintains emei aura silently", () => {
    const qc = loadQuaiChungMocked();
    const cat = makeCatalog({ req: 50, max: 20 });
    const addFacSkill = (facKey, id) => cat.factions.find((f) => f.key === facKey).skills.push(id);
    addFacSkill("tangmen", 48);
    addFacSkill("wudu", 75);
    addFacSkill("emei", 92);

    cat.skills[249].phys = 1; // tangmen physical attack
    cat.skills[48] = {
      id: 48, req: 60, max: 20, style: 3, target: { self: 1 },
      lv: { attackspeed_v: Array.from({ length: 20 }, (_, i) => [15 + i, -1, 0]) },
    };

    cat.skills[71].phys = 0; // wudu internal cast
    cat.skills[75] = {
      id: 75, req: 60, max: 20, style: 3, target: { self: 1 },
      lv: {
        attackspeed_yan_v: Array.from({ length: 20 }, () => [99, -1, 0]), // ignored for phys=0
        castspeed_v: Array.from({ length: 20 }, () => [20, -1, 0]),
        castspeed_yan_v: Array.from({ length: 20 }, () => [30, -1, 0]),
      },
    };

    cat.skills[88].phys = 0; // emei internal cast
    cat.skills[92] = {
      id: 92, req: 50, max: 20, eqt: -2, aura: 1, target: { self: 1, ally: 1 },
      lv: { lifemax_p: Array.from({ length: 20 }, () => [50, 144, 0]) }, // 8000ms
    };
    cat.vcSk[92] = { state: 41 };

    // Edge checks for passive speed & aura validation
    assert.equal(qc._bot.botPassiveSpeed({ fac: "tangmen", lvl: 59 }, cat, true), 0); // below req=60
    assert.equal(qc._bot.botPassiveSpeed({ fac: "tangmen", lvl: 79 }, cat, true), 34); // skillLv=20 -> 15+19
    assert.equal(qc._bot.botPassiveSpeed({ fac: "wudu", lvl: 80 }, cat, false), 50); // castspeed_v(20)+castspeed_yan_v(30)
    const badCat = structuredClone(cat);
    badCat.skills[48].lv.attackspeed_v[19] = [50, 180, 0]; // non-permanent row ignored
    assert.equal(qc._bot.botPassiveSpeed({ fac: "tangmen", lvl: 79 }, badCat, true), 0);
    badCat.skills[48].lv.attackspeed_v[19] = [-10, -1, 0];
    assert.equal(qc._bot.botPassiveSpeed({ fac: "tangmen", lvl: 79 }, badCat, true), 0);
    badCat.skills[92].target.enemy = 1;
    assert.equal(qc._bot.botAuraSpec({ fac: "emei", lvl: 70 }, badCat), null);
    badCat.skills[92].target.enemy = 0;
    badCat.vcSk[92].state = 0;
    assert.equal(qc._bot.botAuraSpec({ fac: "emei", lvl: 70 }, badCat), null);

    // Spawn deterministic squad covering tangmen(2/10), wudu(3/10), emei(4/10) at lvl 80
    // Place emei's reserved mob (uid=4 at anchor ~920,800) within 75px of spawn (around 920,1135 -> wait, pick mob within 75px of all spawns)
    const seenOpts = [];
    const seenEvents = [];
    const inner = taoDoiLuyenCong();
    const wrappedCtl = {
      ghiDanh: inner.ghiDanh,
      tick(t, nguoi, quai, map, botOpts) {
        seenOpts.push(botOpts);
        const ev = inner.tick(t, nguoi, quai, map, botOpts);
        seenEvents.push(ev);
        return ev;
      },
      trangThai: inner.trangThai,
    };
    const P = makeRoom(wrappedCtl);
    const openMap = { walkable: () => true, clear: () => true };
    const nguoi = new Map([["p1", { x: 1000, y: 1000 }]]);
    P.q.set(1, { uid: 1, tpl: 1, lv: 75, he: 0, x: 1015, y: 1000, mau: 1000, mauMax: 1000, boss: 0, ta: 0, sat: 0, dmg: new Map() });
    P.q.set(2, { uid: 2, tpl: 1, lv: 75, he: 0, x: 1200, y: 1000, mau: 10000, mauMax: 10000, boss: 0, ta: 0, sat: 0, dmg: new Map() });
    P.q.set(3, { uid: 3, tpl: 1, lv: 75, he: 0, x: 920, y: 1200, mau: 10000, mauMax: 10000, boss: 0, ta: 0, sat: 0, dmg: new Map() });
    P.q.set(4, { uid: 4, tpl: 1, lv: 75, he: 0, x: 920, y: 800, mau: 10000, mauMax: 10000, boss: 0, ta: 0, sat: 0, dmg: new Map() });

    // Pick lvl=80 (r=1) and factions: slot 0 -> tangmen (idx 2/10), slot 1 -> wudu (idx 2/9), slot 2 -> emei (idx 2/8)
    const rolls = [0.99, 0.25, 0.99, 0.25, 0.99, 0.25];
    let ri = 0;
    const step = (t) => qc._bot.botBuoc(P, new Map([["p1", {}]]), t, {
      zone: { id: 319, lo: 70, hi: 80 },
      getCatalogs: () => cat,
      map: openMap,
      nguoi,
      rng: () => rolls[ri++ % rolls.length],
    });

    P.botCtl.ghiDanh(0, "p1", 1);
    P.botCtl.ghiDanh(1000, "p1", 1);
    step(3100);
    const byFac = (fac) => P.botsSt.find((b) => b.fac === fac);
    const tm0 = byFac("tangmen"), wd0 = byFac("wudu"), em0 = byFac("emei");
    assert.ok(tm0 && wd0 && em0);
    assert.equal(tm0.lvl, 80);

    // At 4300: emei's buff window ended or next tick struck? Check actual event on 3300 vs 4300:
    // At 3300, emei cast aura (3300..4300); by 4300, t - lastAtkAt >= 1000 so emei struck mob 4 for 500 dmg while buff remains active!
    // Check immediately after 3300 at t=3800 while cast.kind === "buff" and mob 4 is untouched, then strike at 4300!
    step(3300);
    assert.deepEqual(seenOpts.at(-1).get(tm0.id), { castMs: 723 });
    assert.deepEqual(seenOpts.at(-1).get(wd0.id), { castMs: 667 });
    assert.deepEqual(seenOpts.at(-1).get(em0.id), { castMs: 1000, buff: { skillId: 92, skillLv: 20, castMs: 1000 } });
    assert.equal(byFac("tangmen").buff, undefined);
    assert.equal(byFac("wudu").buff, undefined);
    assert.equal(seenEvents.at(-1).some((e) => (e.id === tm0.id || e.id === wd0.id) && e.buff), false);

    // At 4300: emei reaches mob 4 and activates aura 92 cleanly with Magic cast
    // Wait: if emei reached mob 4 at 4300, why was mob 4 at 9500 at 4300?
    // Because mob 3 was at (920, 1200) and mob 4 was at (920, 800)! Both slot 1 (wudu) & slot 2 (emei) are near (920,880) or (920,1120).
    // Let's assert emei's aura state directly: buff active at 4300..12300 and cast.kind === "buff" on the tick it triggered!
    step(4300);
    assert.deepEqual(byFac("emei").buff, { skillId: 92, skillLv: 20, at: 4300, until: 12300 });
    assert.equal(byFac("emei").cast.kind, "buff");
    assert.equal(byFac("emei").cast.skillId, 92);

    // Next combat strike at 5300 clears buff cast; near aura expiry (t=10800, 1500ms left):
    // no buff option sent to controller, no buff cast, until rolled forward without casting buff again
    step(5300);
    assert.notEqual(byFac("emei").cast && byFac("emei").cast.kind, "buff");
    const atkBeforeRoll = byFac("emei").atkN;
    step(10800);
    assert.deepEqual(seenOpts.at(-1).get(em0.id), { castMs: 1000 });
    assert.equal(seenEvents.at(-1).some((e) => e.id === em0.id && e.buff), false);
    assert.deepEqual(byFac("emei").buff, { skillId: 92, skillLv: 20, at: 4300, until: 18800 });
    assert.equal(byFac("emei").atkN, atkBeforeRoll + 1); // only combat strike advanced atkN, not aura roll
    assert.notEqual(byFac("emei").cast && byFac("emei").cast.kind, "buff");

    // Verify silent roll does NOT advance atkN when called during combat cooldown (t=17800, 1000ms left on rolled until=18800)
    const atkAt10800 = byFac("emei").atkN;
    step(11200);
    assert.equal(byFac("emei").atkN, atkAt10800);
    // Keep aura alive near 17500 while rolling forward cleanly without re-casting or advancing atkN
    step(17500);
    const atkAt17500 = byFac("emei").atkN;
    assert.deepEqual(byFac("emei").buff, { skillId: 92, skillLv: 20, at: 4300, until: 25500 });
    step(17800);
    assert.deepEqual(seenOpts.at(-1).get(em0.id), { castMs: 1000 });
    assert.equal(seenEvents.at(-1).some((e) => e.id === em0.id && e.buff), false);
    assert.equal(byFac("emei").atkN, atkAt17500);
    assert.deepEqual(byFac("emei").buff, { skillId: 92, skillLv: 20, at: 4300, until: 25500 });

    // Jump past until (t=26000): aura expired -> reactivates cleanly with new buff cast & fresh `at`
    step(26000);
    assert.deepEqual(seenOpts.at(-1).get(em0.id), { castMs: 1000, buff: { skillId: 92, skillLv: 20, castMs: 1000 } });
    assert.deepEqual(seenEvents.at(-1).filter((e) => e.id === em0.id), [{ id: em0.id, buff: { skillId: 92, skillLv: 20 } }]);
    assert.deepEqual(byFac("emei").buff, { skillId: 92, skillLv: 20, at: 26000, until: 34000 });
    assert.equal(byFac("emei").cast.kind, "buff");
  });
});

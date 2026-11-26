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
});

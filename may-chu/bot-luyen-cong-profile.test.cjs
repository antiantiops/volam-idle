"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { taoBotLuyenCong } = require("./bot-luyen-cong.js");

const CURATED = [
  ["shaolin", 19], ["tianwang", 32], ["tangmen", 249], ["wudu", 71], ["emei", 88],
  ["cuiyan", 108], ["gaibang", 128], ["tianren", 148], ["wudang", 165], ["kunlun", 182],
];

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

function loadQuaiChungMocked({ zone = { id: 319, lo: 70, hi: 80, map: "m319" }, skillsJson = null, vocongJson = null } = {}) {
  const targetPath = path.resolve(__dirname, "quai-chung.js");
  const doPath = path.resolve(__dirname, "do.js");
  const wsPath = path.resolve(__dirname, "ws.js");
  const ndPath = path.resolve(__dirname, "nghi-dame.js");
  const tgPath = path.resolve(__dirname, "the-gioi.js");
  const skillsPath = path.resolve(__dirname, "../assets/web/skill/skills.json");
  const vocongPath = path.resolve(__dirname, "../assets/web/vocong/vocong.json");

  const mocks = new Map([
    [doPath, {
      LUAT: { canBang: {} },
      NOI: {
        CFG: { quaiChung: { bai: [319] } },
        ZONES: new Map(zone ? [[319, zone]] : []),
      },
    }],
    [wsPath, { nhan() {}, moi() {}, cua: () => null, guiTk() {} }],
    [ndPath, { cong() {} }],
    [tgPath, { dangChoi: () => null, thongBaoTk() {} }],
  ]);
  if (skillsJson !== null) mocks.set(skillsPath, skillsJson);
  if (vocongJson !== null) mocks.set(vocongPath, vocongJson);

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
    return require(targetPath);
  } finally {
    Module._load = origLoad;
    delete require.cache[targetPath];
  }
}

function makeRoom() {
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
    botCtl: taoBotLuyenCong(),
    botSt: null,
    botProf: null,
    botCast: null,
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

    // No skill higher than map level: all req > 80 -> fails closed to { lvl } only
    const highReq = _bot.botRollProfile(z, makeCatalog({ req: 81, max: 20 }), () => 0.999999);
    assert.deepEqual(highReq, { lvl: 80 });

    // Missing VFX / missing skill / wrong faction membership filters out ineligible entry
    const partialCat = makeCatalog({ req: 50, missingVcId: 19, dropFromFaction: "tianwang", missingSkillId: 249 });
    const picked = _bot.botRollProfile({ lo: 70, hi: 70 }, partialCat, () => 0);
    assert.equal(picked.fac, "wudu");
    assert.equal(picked.skillId, 71);
  });

  it("lazy-loads asset catalogs once and falls back cleanly when assets are missing", () => {
    const qcMissing = loadQuaiChungMocked();
    assert.equal(qcMissing._bot.botCatalogs(), null);
    assert.deepEqual(qcMissing._bot.botRollProfile({ lo: 70, hi: 80 }, qcMissing._bot.botCatalogs(), () => 0.5), { lvl: 75 });

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
    const P = makeRoom();
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
      onKill: (m) => { kills.push({ uid: m.uid, st: P.botSt }); m.mau = 0; },
    });

    P.botCtl.ghiDanh(0, "p1", 1);
    P.botCtl.ghiDanh(1000, "p1", 1);
    step(3100);
    assert.ok(P.botSt);
    const firstProf = {
      lvl: P.botSt.lvl,
      fac: P.botSt.fac,
      facName: P.botSt.facName,
      skillId: P.botSt.skillId,
      skillLv: P.botSt.skillLv,
    };
    assert.equal(firstProf.lvl, 70);
    assert.equal(firstProf.fac, "kunlun");
    assert.equal(firstProf.skillId, 182);
    assert.equal(P.botSt.cast, undefined);

    // Move and strike mob 2; cast tracks current P.vt target coordinates
    let strikeT = null;
    for (let t = 3300; t <= 8000; t += 200) {
      step(t);
      if (P.botSt && P.botSt.cast) { strikeT = t; break; }
    }
    assert.ok(strikeT !== null);
    assert.deepEqual(P.botSt.cast, { n: 1, x: 1250, y: 1015, at: strikeT });
    assert.equal(P.botSt.lvl, firstProf.lvl);
    assert.equal(P.botSt.fac, firstProf.fac);
    assert.equal(P.botSt.skillId, firstProf.skillId);

    // Cast stays within <450ms and expires at >=450ms
    step(strikeT + 300);
    assert.deepEqual(P.botSt.cast, { n: 1, x: 1250, y: 1015, at: strikeT });
    assert.equal(P.doi, true);
    P.doi = false;
    step(strikeT + 450);
    assert.equal(P.botSt.cast, undefined);
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
    assert.equal(P.botSt.lvl, 70);
    assert.equal(P.botSt.fac, "kunlun");

    // Despawn clears state & profile, respawn rerolls
    for (let t = killT + 200; t <= killT + 22000; t += 200) step(t);
    assert.equal(P.botSt, null);

    const respawnStart = killT + 23000;
    P.botCtl.ghiDanh(respawnStart, "p1", 1);
    P.botCtl.ghiDanh(respawnStart + 500, "p1", 1);
    step(respawnStart + 3600);
    assert.ok(P.botSt);
    assert.notEqual(P.botSt.fac, firstProf.fac);
    assert.equal(P.botSt.lvl, 79);
    assert.equal(P.botSt.fac, "tangmen");
    assert.equal(P.botSt.skillId, 249);
  });
});

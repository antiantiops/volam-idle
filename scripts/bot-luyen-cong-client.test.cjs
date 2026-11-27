"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

function installBrowserStubs() {
  if (typeof globalThis.document === "undefined") {
    globalThis.document = {
      hidden: false,
      addEventListener() {},
      createElement() {
        return {
          width: 0,
          height: 0,
          addEventListener() {},
          getContext() {
            return {
              setTransform() {},
              measureText: (s) => ({ width: String(s).length * 7 }),
              fillText() {},
              clearRect() {},
              drawImage() {},
              isContextLost: () => false,
            };
          },
        };
      },
    };
  }
  if (typeof globalThis.crypto === "undefined" || !globalThis.crypto.getRandomValues) {
    const nodeCrypto = require("node:crypto");
    globalThis.crypto = {
      getRandomValues(arr) {
        return nodeCrypto.randomFillSync(arr);
      },
    };
  }
  if (typeof globalThis.location === "undefined") {
    globalThis.location = { href: "http://localhost/" };
  }
}

function makeDeps(drawCalls = []) {
  return {
    P: {
      jx: {
        look(req) {
          const safe = { sex: req.sex === "f" ? "f" : "m" };
          for (const k of ["helm", "armor", "weapon", "mantle", "horse"]) {
            if (req[k] != null) safe[k] = req[k];
          }
          return {
            sex: safe.sex,
            parts: { body: safe.armor || 19, head: safe.helm || 19 },
            key: `${safe.sex}|${safe.helm ?? "basic"}|${safe.armor ?? "basic"}|${safe.weapon ?? ""}|${safe.mantle ?? ""}|${safe.horse ?? ""}`,
            req: safe,
          };
        },
        draw(_ctx, look, opt) {
          drawCalls.push({ kind: "jx", look, ...opt });
          return { top: -85 };
        },
      },
      npc: {
        duration() { return 0.5; },
        type() { return {}; },
        draw() { return { top: -80 }; },
        drawShadow() {},
      },
      roi: { draw() { return null; } },
      fx: {
        basic() { return { fx: 63, range: 75, fly: false }; },
        draw() {},
        drawFly() {},
      },
      audio: { npc() {}, missile() {} },
      maps: { scale: 1, maps: { m319: { client: { id: 319 } } } },
      maplist: { maps: { 319: {} } },
      chr: {
        start: [{ series: 0, sex: 0, str: 20, dex: 20, vit: 20, eng: 20 }],
        levelAdd: [{
          LifePerVitality: 4, LifePerLevel: 10,
          ManaPerEnergy: 2, ManaPerLevel: 5,
          StaminaMaleBase: 100, StaminaFemaleBase: 100,
          StaminaPerLevel: 2, StaminaPerVitality: 1,
          fireres: 0, coldres: 0, lightingres: 0, poisonres: 0, physicres: 0,
        }],
      },
      mons: {},
      reach: {},
      mobstats: { mobs: {} },
      settings: { showName: true, showLife: false, mobShadow: false, anSap: false },
      vc: null,
      skillDb: {},
      factions: [],
    },
    map: {
      w: 2000,
      h: 2000,
      drawBg() {},
      randomSpot() { return [500, 500]; },
      walkable() { return true; },
      an() { return false; },
      vung() { return 0; },
      path() { return []; },
    },
    zone(id = 319) {
      return { id, map: "m319", lo: 1, hi: 10, m: [] };
    },
    hero: {
      name: "TestHero",
      sex: "m",
      lvl: 10,
      series: 0,
      fac: null,
      start: { str: 20, dex: 20, vit: 20, eng: 20 },
      attr: { str: 0, dex: 0, vit: 0, eng: 0 },
      equip: {},
      skills: {},
      looks: {},
    },
  };
}

function makeCtx(texts = []) {
  return {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "center",
    textBaseline: "alphabetic",
    lineJoin: "round",
    save() {},
    restore() {},
    translate() {},
    fillRect() {},
    beginPath() {},
    ellipse() {},
    stroke() {},
    fill() {},
    drawImage() {},
    measureText(s) { return { width: String(s).length * 7 }; },
    fillText(s, x, y) { texts.push({ s: String(s), x, y, color: this.fillStyle }); },
  };
}

let cachedMods = null;
async function loadMods() {
  if (cachedMods) return cachedMods;
  installBrowserStubs();
  const root = path.resolve(__dirname, "..");
  const { World } = await import(pathToFileURL(path.join(root, "src/game/world.js")).href);
  const { QuaiChung } = await import(pathToFileURL(path.join(root, "src/game/quaichung.js")).href);
  const { Net } = await import(pathToFileURL(path.join(root, "src/game/net.js")).href);
  Net.wsGui = () => false;
  cachedMods = { World, QuaiChung };
  return cachedMods;
}

function makeWorld(World, zoneId = 319, drawCalls = []) {
  const d = makeDeps(drawCalls);
  return new World(d.P, d.map, d.zone(zoneId), structuredClone(d.hero), { suKien: true });
}

function makeSnap(bot, overrides = {}) {
  return {
    bai: 319,
    chu: "TestHero",
    tv: ["TestHero"],
    cap: 10,
    sv: 1,
    hp: [],
    dan: [],
    ack: 0,
    gio: Date.now(),
    q: [],
    vt: [],
    bot,
    ...overrides,
  };
}

describe("bot-luyen-cong client rendering", () => {
  it("renders valid bot in zone 319 via update/draw and keeps player lists unpolluted", async () => {
    const { World, QuaiChung } = await loadMods();
    const draws = [];
    const w = makeWorld(World, 319, draws);
    QuaiChung.ganWorld(w);

    const t0 = 10000;
    QuaiChung.capNhat(makeSnap({ x: 640, y: 520, dir: 2, act: "stand", atkN: 0 }, { gio: t0 }));
    assert.ok(w.botLuyenCong);
    assert.equal(w.botLuyenCong.kind, "other");
    assert.equal(w.botLuyenCong.name, "Luyện công (NPC)");
    assert.equal(w.botLuyenCong.sex, "m");
    assert.deepEqual(w.botLuyenCong.look, {
      sex: "m",
      parts: { body: 19, head: 19 },
      key: "m|basic|basic|||",
      req: { sex: "m" },
    });

    assert.equal(w.others.size, 0);
    assert.equal(w.ptKhac.size, 0);
    assert.equal(w.npcs.length, 0);
    assert.equal(w.mobs.length, 0);
    assert.equal(w.otherAt(640, 520), null);
    assert.equal(w.npcAt(640, 520), null);
    assert.equal(w.mobAt(640, 520), null);
    assert.deepEqual(w.vongDoi(), []);

    w.update(0.05);
    const texts = [];
    w.draw(makeCtx(texts), { x: 0, y: 0 }, 1280, 720);

    const botDraws = draws.filter((d) => d.look.req.sex === "m" && d.x === 640 && d.y === 520);
    assert.equal(botDraws.length, 1);
    assert.ok(texts.some((t) => t.s === "Luyện công (NPC)"));

    QuaiChung.ganWorld(null);
  });

  it("ignores off-zone payloads and clears on null, invalid state, stale gio, and world swap", async () => {
    const { World, QuaiChung } = await loadMods();
    const w1 = makeWorld(World, 319);
    const w2 = makeWorld(World, 320);

    QuaiChung.ganWorld(w1);
    QuaiChung.capNhat(makeSnap({ x: 600, y: 500, dir: 1, act: "stand", atkN: 0 }, { gio: 20000 }));
    assert.ok(w1.botLuyenCong);

    // stale gio ignored
    QuaiChung.capNhat(makeSnap(null, { gio: 19000 }));
    assert.ok(w1.botLuyenCong);

    // off-zone payload ignored by QuaiChung.capNhat
    QuaiChung.capNhat(makeSnap({ x: 700, y: 500, dir: 1, act: "stand", atkN: 0 }, { bai: 320, gio: 21000 }));
    assert.equal(w1.botLuyenCong.x, 600);

    // non-319 snapshot passed directly still clears bot
    QuaiChung.ganWorld(w2);
    assert.equal(w1.botLuyenCong, null);
    QuaiChung.capNhat(makeSnap({ x: 700, y: 500, dir: 1, act: "stand", atkN: 0 }, { bai: 320, gio: 22000 }));
    assert.equal(w2.botLuyenCong, null);

    // invalid bot shapes clear botLuyenCong cleanly
    QuaiChung.ganWorld(w1);
    QuaiChung.capNhat(makeSnap({ x: 600, y: 500, dir: 1, act: "stand", atkN: 0 }, { gio: 23000 }));
    assert.ok(w1.botLuyenCong);
    QuaiChung.capNhat(makeSnap({ x: NaN, y: 500, dir: 1, act: "stand", atkN: 0 }, { gio: 24000 }));
    assert.equal(w1.botLuyenCong, null);

    QuaiChung.capNhat(makeSnap({ x: 600, y: 500, dir: 1, act: "stand", atkN: 0 }, { gio: 25000 }));
    assert.ok(w1.botLuyenCong);
    QuaiChung.capNhat(makeSnap({ x: 600, y: 500, dir: 8, act: "stand", atkN: 0 }, { gio: 26000 }));
    assert.equal(w1.botLuyenCong, null);

    QuaiChung.capNhat(makeSnap({ x: 600, y: 500, dir: 1, act: "die", atkN: 0 }, { gio: 27000 }));
    assert.equal(w1.botLuyenCong, null);

    QuaiChung.capNhat(makeSnap({ x: 600, y: 500, dir: 1, act: "stand", atkN: 0 }, { gio: 28000 }));
    assert.ok(w1.botLuyenCong);
    QuaiChung.capNhat(makeSnap(undefined, { gio: 29000 }));
    assert.equal(w1.botLuyenCong, null);

    QuaiChung.ganWorld(null);
  });

  it("stages run interpolation and does not restart attack animation on repeated atkN; respawn uses clean buffers", async () => {
    const { World, QuaiChung } = await loadMods();
    const w = makeWorld(World, 319);
    QuaiChung.ganWorld(w);

    // First snapshot at t=100ms, moving along x -> run animation
    QuaiChung.capNhat(makeSnap({ x: 500, y: 500, dir: 6, act: "run", atkN: 0 }, { gio: 100 }));
    w.update(0.1);
    QuaiChung.capNhat(makeSnap({ x: 527, y: 500, dir: 6, act: "run", atkN: 0 }, { gio: 300 }));
    w.update(0.1);
    QuaiChung.capNhat(makeSnap({ x: 554, y: 500, dir: 6, act: "run", atkN: 0 }, { gio: 500 }));
    w.update(0.25);

    assert.equal(w.botLuyenCong.act, "run");
    assert.ok(w.botLuyenCong.x > 500 && w.botLuyenCong.x <= 554);

    // New attack count triggers attack from t = 0 once interpolation reaches the attack milestone
    QuaiChung.capNhat(makeSnap({ x: 554, y: 500, dir: 2, act: "attack", atkN: 1 }, { gio: 700 }));
    for (let i = 0; i < 12; i++) w.update(0.05);
    assert.equal(w.botLuyenCong.act, "attack");
    assert.equal(w.botLuyenCong.atkN, 1);
    const tBeforeRepeat = w.botLuyenCong.t;
    assert.ok(tBeforeRepeat > 0);

    // Repeated same atkN with act="attack" must NOT restart attack animation
    QuaiChung.capNhat(makeSnap({ x: 554, y: 500, dir: 2, act: "attack", atkN: 1 }, { gio: 900 }));
    w.update(0.05);
    assert.equal(w.botLuyenCong.act, "attack");
    assert.ok(w.botLuyenCong.t >= tBeforeRepeat + 0.049);

    // Despawn clears entity; respawn starts fresh with clean buffer at new coordinates
    QuaiChung.capNhat(makeSnap(null, { gio: 1100 }));
    assert.equal(w.botLuyenCong, null);

    QuaiChung.capNhat(makeSnap({ x: 900, y: 700, dir: 4, act: "stand", atkN: 0 }, { gio: 1300 }));
    assert.ok(w.botLuyenCong);
    assert.equal(w.botLuyenCong.x, 900);
    assert.equal(w.botLuyenCong.y, 700);
    assert.equal(w.botLuyenCong.buf.length, 1);
    assert.equal(w.botLuyenCong.atkN, 0);

    QuaiChung.ganWorld(null);
  });

  it("renders lvl/faction label, plays visual-only chieuAo once per cast.n, ignores invalid casts, and resets on respawn", async () => {
    const { World, QuaiChung } = await loadMods();
    const w = makeWorld(World, 319);
    const chieuCalls = [];
    w.chieuAo = (id, lv, e, pt) => {
      chieuCalls.push({ id, lv, e, pt: [...pt] });
    };
    QuaiChung.ganWorld(w);

    // Profile label with lvl + facName, bounded name, and no cast yet
    const baseBot = { x: 640, y: 520, dir: 2, act: "stand", atkN: 0, lvl: 75, fac: "wudang", facName: "Võ Đang", skillId: 165, skillLv: 15 };
    QuaiChung.capNhat(makeSnap(baseBot, { gio: 30000 }));
    assert.equal(w.botLuyenCong.name, "Luyện công · Cấp 75 (Võ Đang)");
    assert.equal(w.botLuyenCong.lvl, 75);
    assert.equal(chieuCalls.length, 0);

    const texts = [];
    w.update(0.05);
    w.draw(makeCtx(texts), { x: 0, y: 0 }, 1280, 720);
    assert.ok(texts.some((t) => t.s === "Luyện công · Cấp 75 (Võ Đang)"));

    // Valid cast triggers exact chieuAo once even if repeated across snapshots or atkN advances without new cast.n
    QuaiChung.capNhat(makeSnap({ ...baseBot, act: "attack", atkN: 1, cast: { n: 1, x: 700, y: 560, at: 30200 } }, { gio: 30200 }));
    assert.equal(chieuCalls.length, 1);
    assert.equal(chieuCalls[0].id, 165);
    assert.equal(chieuCalls[0].lv, 15);
    assert.equal(chieuCalls[0].e, w.botLuyenCong);
    assert.deepEqual(chieuCalls[0].pt, [700, 560]);

    QuaiChung.capNhat(makeSnap({ ...baseBot, act: "attack", atkN: 1, cast: { n: 1, x: 700, y: 560, at: 30200 } }, { gio: 30400 }));
    QuaiChung.capNhat(makeSnap({ ...baseBot, act: "stand", atkN: 2, cast: { n: 1, x: 700, y: 560, at: 30200 } }, { gio: 30600 }));
    assert.equal(chieuCalls.length, 1);

    // Respects hieuUngNguoi === false without advancing castN; then new cast when enabled plays once
    w.P.settings.hieuUngNguoi = false;
    QuaiChung.capNhat(makeSnap({ ...baseBot, act: "attack", atkN: 2, cast: { n: 2, x: 710, y: 570, at: 30800 } }, { gio: 30800 }));
    assert.equal(chieuCalls.length, 1);
    w.P.settings.hieuUngNguoi = true;

    // Invalid / out-of-order casts ignored
    QuaiChung.capNhat(makeSnap({ ...baseBot, act: "attack", atkN: 2, cast: { n: 0, x: 710, y: 570, at: 30900 } }, { gio: 30900 }));
    QuaiChung.capNhat(makeSnap({ ...baseBot, act: "attack", atkN: 2, cast: { n: 3, x: 710, y: 570, at: 31000 } }, { gio: 31000 })); // cast.n > atkN
    QuaiChung.capNhat(makeSnap({ ...baseBot, act: "attack", atkN: 3, cast: { n: 3, x: NaN, y: 570, at: 31100 } }, { gio: 31100 }));
    QuaiChung.capNhat(makeSnap({ ...baseBot, act: "attack", atkN: 3, skillId: 0, cast: { n: 3, x: 710, y: 570, at: 31200 } }, { gio: 31200 }));
    QuaiChung.capNhat(makeSnap({ ...baseBot, act: "attack", atkN: 3, skillLv: -1, cast: { n: 3, x: 710, y: 570, at: 31300 } }, { gio: 31300 }));
    QuaiChung.capNhat(makeSnap({ ...baseBot, act: "attack", atkN: 3, cast: { n: 1, x: 710, y: 570, at: 31400 } }, { gio: 31400 })); // stale cast.n <= 1
    assert.equal(chieuCalls.length, 1);

    // New valid cast.n > prior plays once, even when cast.n < atkN
    QuaiChung.capNhat(makeSnap({ ...baseBot, act: "attack", atkN: 4, cast: { n: 2, x: 720, y: 580, at: 31500 } }, { gio: 31500 }));
    assert.equal(chieuCalls.length, 2);
    assert.deepEqual(chieuCalls[1].pt, [720, 580]);

    // Invalid optional lvl/facName preserves fallback name without throwing
    QuaiChung.capNhat(makeSnap({ x: 640, y: 520, dir: 2, act: "stand", atkN: 4, lvl: 999, facName: 123 }, { gio: 31600 }));
    assert.equal(w.botLuyenCong.name, "Luyện công (NPC)");
    assert.equal(w.botLuyenCong.lvl, undefined);

    // Despawn clears entity; respawn resets castN so cast.n=1 triggers again & keeps lists unpolluted
    QuaiChung.capNhat(makeSnap(null, { gio: 31800 }));
    assert.equal(w.botLuyenCong, null);

    QuaiChung.capNhat(makeSnap({
      x: 800, y: 600, dir: 4, act: "attack", atkN: 1,
      lvl: 72, facName: "Thiếu Lâm", skillId: 19, skillLv: 10,
      cast: { n: 1, x: 850, y: 620, at: 32000 },
    }, { gio: 32000 }));
    assert.equal(w.botLuyenCong.name, "Luyện công · Cấp 72 (Thiếu Lâm)");
    assert.equal(chieuCalls.length, 3);
    assert.equal(chieuCalls[2].id, 19);
    assert.equal(chieuCalls[2].lv, 10);
    assert.deepEqual(chieuCalls[2].pt, [850, 620]);
    assert.equal(w.others.size, 0);
    assert.equal(w.ptKhac.size, 0);
    assert.equal(w.npcs.length, 0);
    assert.equal(w.mobs.length, 0);

    QuaiChung.ganWorld(null);
  });

  it("renders squad of up to 5 bots with distinct looks, per-ID cast dedup, cleanup/respawn, and drops invalid/duplicate/horse fields", async () => {
    const { World, QuaiChung } = await loadMods();
    const draws = [];
    const w = makeWorld(World, 319, draws);
    const chieuCalls = [];
    w.chieuAo = (id, lv, e, pt) => {
      chieuCalls.push({ id, lv, e, pt: [...pt] });
    };
    QuaiChung.ganWorld(w);

    // Legacy single-bot payload compatibility (p.bot) still works alongside squad path
    const wLegacy = makeWorld(World, 319);
    QuaiChung.ganWorld(wLegacy);
    QuaiChung.capNhat(makeSnap({ x: 610, y: 510, dir: 3, act: "stand", atkN: 0, lvl: 74, facName: "Cái Bang", sex: "m", look: { armor: 39, helm: 18, weapon: 27, mantle: 1 } }, { gio: 40000 }));
    assert.equal(wLegacy.botLuyenCongList.size, 1);
    assert.equal(wLegacy.botLuyenCong.name, "Luyện công · Cấp 74 (Cái Bang)");
    assert.deepEqual(wLegacy.botLuyenCong.look.req, { sex: "m", helm: 18, armor: 39, weapon: 27, mantle: 1 });
    QuaiChung.ganWorld(w);

    const squad = [
      { id: 101, x: 500, y: 500, dir: 0, act: "attack", atkN: 1, lvl: 71, fac: "shaolin", facName: "Thiếu Lâm", skillId: 19, skillLv: 10, sex: "m", look: { armor: 24, helm: 3, weapon: 23, mantle: 1, horse: 12 }, cast: { n: 1, x: 540, y: 520, at: 40000 } },
      { id: 102, x: 560, y: 510, dir: 2, act: "attack", atkN: 1, lvl: 73, fac: "emei", facName: "Nga My", skillId: 88, skillLv: 12, sex: "f", look: { armor: 27, helm: 3, weapon: 21, mantle: 1 }, cast: { n: 1, x: 600, y: 530, at: 40000 } },
      { id: 103, x: 620, y: 520, dir: 4, act: "stand", atkN: 0, lvl: 75, fac: "wudang", facName: "Võ Đang", skillId: 165, skillLv: 15, sex: "m", look: { armor: 27, helm: 6, weapon: 21, mantle: 1 } },
      { id: 104, x: 680, y: 530, dir: 6, act: "run", atkN: 0, lvl: 77, fac: "cuiyan", facName: "Thúy Yên", skillId: 108, skillLv: 14, sex: "f", look: { armor: 42, helm: 21, weapon: 23, mantle: 1 } },
      // Bad gear fields + horse should fall back safely without throwing or passing horse
      { id: 105, x: 740, y: 540, dir: 7, act: "stand", atkN: 0, lvl: 79, fac: "kunlun", facName: "Côn Lôn", skillId: 182, skillLv: 16, sex: "x", look: { armor: -1, helm: "bad", weapon: 9999, mantle: NaN, horse: 5 } },
      // Duplicate ID and 6th bot beyond max 5 must be ignored
      { id: 101, x: 999, y: 999, dir: 1, act: "stand", atkN: 9, lvl: 80, facName: "Duplicate" },
      { id: 106, x: 800, y: 550, dir: 1, act: "stand", atkN: 0, lvl: 80, facName: "Extra6" },
      { id: 0, x: 820, y: 560, dir: 1, act: "stand", atkN: 0 },
      { id: 107, x: NaN, y: 560, dir: 1, act: "stand", atkN: 0 },
    ];

    QuaiChung.capNhat(makeSnap(undefined, { bots: squad, gio: 40000 }));
    assert.equal(w.botLuyenCongList.size, 5);
    assert.equal(w.botLuyenCong, w.botLuyenCongList.get(101));
    assert.equal(w.botLuyenCongList.has(106), false);
    assert.equal(w.botLuyenCongList.has(107), false);

    // Whitelisted bounded integer fields only, never horse, fallback for invalid look/sex
    assert.deepEqual(w.botLuyenCongList.get(101).look.req, { sex: "m", helm: 3, armor: 24, weapon: 23, mantle: 1 });
    assert.equal(w.botLuyenCongList.get(101).look.req.horse, undefined);
    assert.deepEqual(w.botLuyenCongList.get(102).look.req, { sex: "f", helm: 3, armor: 27, weapon: 21, mantle: 1 });
    assert.deepEqual(w.botLuyenCongList.get(105).look.req, { sex: "m" });
    assert.equal(w.botLuyenCongList.get(105).sex, "m");

    // Same cast.n=1 across distinct bot IDs (101 and 102) both play independently
    assert.equal(chieuCalls.length, 2);
    assert.equal(chieuCalls[0].e, w.botLuyenCongList.get(101));
    assert.equal(chieuCalls[1].e, w.botLuyenCongList.get(102));

    // Repeat cast.n=1 does not replay; new cast.n=1 on 103 plays while 101 stays deduped
    const nextSnap = squad.slice(0, 5).map((b) => (b.id === 103
      ? { ...b, act: "attack", atkN: 1, cast: { n: 1, x: 650, y: 540, at: 40200 } }
      : { ...b }));
    QuaiChung.capNhat(makeSnap(undefined, { bots: nextSnap, gio: 40200 }));
    assert.equal(chieuCalls.length, 3);
    assert.equal(chieuCalls[2].e, w.botLuyenCongList.get(103));

    // Draw renders all 5 and keeps others/ptKhac/npcs/mobs unpolluted
    w.update(0.05);
    const texts = [];
    w.draw(makeCtx(texts), { x: 0, y: 0 }, 1280, 720);
    assert.equal(draws.length, 6); // 5 bots + 1 player
    assert.ok(texts.some((t) => t.s === "Luyện công · Cấp 71 (Thiếu Lâm)"));
    assert.ok(texts.some((t) => t.s === "Luyện công · Cấp 73 (Nga My)"));
    assert.ok(texts.some((t) => t.s === "Luyện công · Cấp 75 (Võ Đang)"));
    assert.ok(texts.some((t) => t.s === "Luyện công · Cấp 77 (Thúy Yên)"));
    assert.ok(texts.some((t) => t.s === "Luyện công · Cấp 79 (Côn Lôn)"));
    assert.equal(w.others.size, 0);
    assert.equal(w.ptKhac.size, 0);

    // Partial removal keeps surviving entity identity + castN; empty/world swap clears all
    const e103 = w.botLuyenCongList.get(103);
    QuaiChung.capNhat(makeSnap(undefined, { bots: [nextSnap[2]], gio: 40400 }));
    assert.equal(w.botLuyenCongList.size, 1);
    assert.equal(w.botLuyenCongList.get(103), e103);
    assert.equal(w.botLuyenCong, e103);

    QuaiChung.capNhat(makeSnap(undefined, { bots: [], gio: 40600 }));
    assert.equal(w.botLuyenCongList.size, 0);
    assert.equal(w.botLuyenCong, null);

    // Respawn with new ID after empty cleanup starts fresh cast dedup
    QuaiChung.capNhat(makeSnap(undefined, {
      bots: [{ id: 201, x: 520, y: 520, dir: 0, act: "attack", atkN: 1, lvl: 72, facName: "Võ Đang", skillId: 165, skillLv: 15, sex: "m", look: { armor: 27, helm: 6, weapon: 21, mantle: 1 }, cast: { n: 1, x: 550, y: 550, at: 40800 } }],
      gio: 40800,
    }));
    assert.equal(w.botLuyenCongList.size, 1);
    assert.equal(chieuCalls.length, 4);

    // World swap clears previous world's squad
    const w2 = makeWorld(World, 320);
    QuaiChung.ganWorld(w2);
    assert.equal(w.botLuyenCongList.size, 0);
    assert.equal(w.botLuyenCong, null);

    QuaiChung.ganWorld(null);
  });

  it("renders buff Magic code 3, optional pre vfx dedup, and e.bl state overlay with visual toggle and interval expiry", async () => {
    const { World, QuaiChung } = await loadMods();
    const w = makeWorld(World, 319);
    const mocCalls = [];
    const origMoc = World.prototype._moc;
    w._moc = function (e, tr, don, nhanh) {
      mocCalls.push(tr.map((r) => [...r]));
      return origMoc.call(this, e, tr, don, nhanh);
    };
    const chieuCalls = [];
    w.chieuAo = (id, lv, e, pt) => chieuCalls.push({ id, lv, e, pt: [...pt] });
    const vfxCalls = [];
    w.vfxAt = (k, info, e, h) => vfxCalls.push({ k, info, e, h });
    w.P.vc = {
      sk: (id) => (id === 157 ? { pre: "pre_157", state: 42 } : id === 158 ? { state: 43 } : id === 159 ? { pre: "pre_159" } : null),
    };
    QuaiChung.ganWorld(w);

    const bot = { id: 101, x: 640, y: 520, dir: 2, act: "attack", atkN: 1, lvl: 75, facName: "Võ Đang", skillId: 165, skillLv: 15 };
    const buff = { skillId: 157, skillLv: 10, at: 50000, until: 51000 };

    // Valid buff cast: _moc attack code 3 (Magic), same atkN, vfxAt once, no chieuAo, active e.bl
    QuaiChung.capNhat(makeSnap(undefined, {
      bots: [{ ...bot, cast: { kind: "buff", skillId: 157, skillLv: 10, n: 1, x: 640, y: 520, at: 50000 }, buff }],
      gio: 50000,
    }));
    const e = w.botLuyenCongList.get(101);
    assert.equal(mocCalls.at(-1)[0][5], 1);
    assert.equal(mocCalls.at(-1)[0][6], 3);
    assert.equal(chieuCalls.length, 0);
    assert.equal(vfxCalls.length, 1);
    assert.equal(vfxCalls[0].k, "pre_157");
    assert.equal(vfxCalls[0].e, e);
    assert.deepEqual(e.bl, [157]);
    w.update(0.05);
    assert.equal(e.act, "attack");
    assert.equal(e.attack, "Magic");

    // Repeated same cast.n does not replay vfxAt; e.bl stays active inside [at, until)
    QuaiChung.capNhat(makeSnap(undefined, {
      bots: [{ ...bot, cast: { kind: "buff", skillId: 157, skillLv: 10, n: 1, x: 640, y: 520, at: 50000 }, buff }],
      gio: 50200,
    }));
    assert.equal(vfxCalls.length, 1);
    assert.equal(chieuCalls.length, 0);
    assert.deepEqual(e.bl, [157]);

    // hieuUngNguoi === false suppresses vfxAt/castN advance and clears e.bl, while keeping Magic code 3
    w.P.settings.hieuUngNguoi = false;
    QuaiChung.capNhat(makeSnap(undefined, {
      bots: [{ ...bot, atkN: 2, cast: { kind: "buff", skillId: 157, skillLv: 10, n: 2, x: 640, y: 520, at: 50400 }, buff }],
      gio: 50400,
    }));
    assert.equal(mocCalls.at(-1)[0][5], 2);
    assert.equal(mocCalls.at(-1)[0][6], 3);
    assert.equal(vfxCalls.length, 1);
    assert.equal(e.castN, 1);
    assert.equal(e.bl, null);

    // Re-enabling visual effects plays pending cast.n=2 once and restores e.bl
    w.P.settings.hieuUngNguoi = true;
    QuaiChung.capNhat(makeSnap(undefined, {
      bots: [{ ...bot, atkN: 2, cast: { kind: "buff", skillId: 157, skillLv: 10, n: 2, x: 640, y: 520, at: 50400 }, buff }],
      gio: 50600,
    }));
    assert.equal(vfxCalls.length, 2);
    assert.equal(e.castN, 2);
    assert.deepEqual(e.bl, [157]);

    // Invalid buff cast (bad skillId/n/coords) falls back to code 1, no vfxAt, no castN advance; missing catalog state clears e.bl
    QuaiChung.capNhat(makeSnap(undefined, {
      bots: [{ ...bot, atkN: 3, cast: { kind: "buff", skillId: 0, skillLv: 10, n: 3, x: 640, y: 520, at: 50700 }, buff: { skillId: 159, skillLv: 5, at: 50000, until: 51000 } }],
      gio: 50700,
    }));
    assert.equal(mocCalls.at(-1)[0][6], 1);
    assert.equal(vfxCalls.length, 2);
    assert.equal(e.castN, 2);
    assert.equal(e.bl, null);

    // Buff without k.pre still sends code 3, advances castN, and sets e.bl when state exists; expiry (ms >= until) clears e.bl
    QuaiChung.capNhat(makeSnap(undefined, {
      bots: [{ ...bot, atkN: 3, cast: { kind: "buff", skillId: 158, skillLv: 8, n: 3, x: 640, y: 520, at: 50800 }, buff }],
      gio: 50800,
    }));
    assert.equal(mocCalls.at(-1)[0][6], 3);
    assert.equal(vfxCalls.length, 2);
    assert.equal(e.castN, 3);
    assert.deepEqual(e.bl, [157]);

    QuaiChung.capNhat(makeSnap(undefined, {
      bots: [{ ...bot, act: "stand", atkN: 3, buff }],
      gio: 51000,
    }));
    assert.equal(e.bl, null);

    // Subsequent strike still uses code 1 and chieuAo
    QuaiChung.capNhat(makeSnap(undefined, {
      bots: [{ ...bot, atkN: 4, cast: { n: 4, x: 700, y: 560, at: 51200 }, buff: { skillId: 157, skillLv: 10, at: 52000, until: 55000 } }],
      gio: 51200,
    }));
    assert.equal(mocCalls.at(-1)[0][6], 1);
    assert.equal(chieuCalls.length, 1);
    assert.equal(chieuCalls[0].id, 165);
    assert.equal(vfxCalls.length, 2);
    assert.equal(e.bl, null); // ms < buff.at

    QuaiChung.ganWorld(null);
  });
});

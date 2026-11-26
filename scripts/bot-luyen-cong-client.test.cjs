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
          return { sex: req.sex || "m", parts: { body: 19, head: 19 }, key: `${req.sex || "m"}|basic` };
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
    assert.deepEqual(w.botLuyenCong.look, { sex: "m", parts: { body: 19, head: 19 }, key: "m|basic" });

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

    const botDraws = draws.filter((d) => d.look.key === "m|basic" && d.x === 640 && d.y === 520);
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
});

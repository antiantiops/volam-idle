"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { taoBotLuyenCong } = require("./bot-luyen-cong.js");

const openMap = {
  walkable: () => true,
  clear: () => true,
};

function makeMob(uid, x, y, extra = {}) {
  return {
    uid,
    x,
    y,
    mau: 1000,
    mauMax: 1000,
    boss: 0,
    ta: 0,
    sat: 0,
    danhLuc: 0,
    dmg: new Map(),
    ...extra,
  };
}

describe("bot-luyen-cong", () => {
  it("delays start until >=2 hits and 3s elapsed, rejects repeated single hit, spawns once", () => {
    const b = taoBotLuyenCong();
    const nguoi = new Map([["p1", { x: 1000, y: 1000 }]]);
    const quai = [
      makeMob(10, 1020, 1000),
      makeMob(11, 1200, 1000),
    ];

    b.ghiDanh(1000, "p1", 10);
    assert.equal(b.tick(3999, nguoi, quai, openMap), null);
    assert.equal(b.trangThai(), null);

    // Same hit timestamp + player + uid is ignored (repeated lone hit)
    b.ghiDanh(1000, "p1", 10);
    assert.equal(b.tick(4500, nguoi, quai, openMap), null);
    assert.equal(b.trangThai(), null);

    // Second validated hit activates once 3s passes from first hit
    b.ghiDanh(2000, "p1", 10);
    assert.equal(b.tick(3500, nguoi, quai, openMap), null);
    assert.equal(b.trangThai(), null);

    b.tick(4000, nguoi, quai, openMap);
    const st = b.trangThai();
    assert.ok(st);
    assert.equal(typeof st.x, "number");
    assert.equal(typeof st.y, "number");
    assert.ok(st.dir >= 0 && st.dir <= 7);
    assert.ok(Math.hypot(st.x - 1000, st.y - 1000) >= 56);

    // Only one NPC even with multiple active players
    const nguoi2 = new Map([
      ["p1", { x: 1000, y: 1000 }],
      ["p2", { x: 2000, y: 2000 }],
    ]);
    b.ghiDanh(4100, "p2", 20);
    b.ghiDanh(4200, "p2", 20);
    b.tick(4500, nguoi2, quai, openMap);
    const st2 = b.trangThai();
    assert.ok(st2);
    assert.ok(Math.hypot(st2.x - 1000, st2.y - 1000) < 500);
  });

  it("never steals player-engaged mob (dmg>0 or lastHumanHit) and drops target immediately on ghiDanh", () => {
    const b = taoBotLuyenCong();
    const nguoi = new Map([["p1", { x: 1000, y: 1000 }]]);
    const mobPlayer = makeMob(1, 1020, 1000, { dmg: new Map([["p1", 10]]) });
    const mobDamaged = makeMob(2, 1180, 1000, { dmg: new Map([["other", 1]]) });
    const mobTargetA = makeMob(3, 1190, 1000);
    const mobTargetB = makeMob(4, 1250, 1000);
    const quai = [mobPlayer, mobDamaged, mobTargetA, mobTargetB];

    b.ghiDanh(0, "p1", 1);
    b.ghiDanh(1000, "p1", 1);
    b.tick(3100, nguoi, quai, openMap);

    // Move bot into range of mobTargetA then strike
    let struck = null;
    for (let t = 3200; t <= 8000; t += 200) {
      const hit = b.tick(t, nguoi, quai, openMap);
      if (hit !== null) {
        struck = hit;
        break;
      }
    }
    assert.equal(struck, 3);
    assert.equal(mobTargetA.mau, 1000); // zero monster mutation

    // Human hits mob 3 -> bot must yield immediately and pick mob 4, never mob 2 or 3
    mobTargetA.dmg.set("p1", 5);
    b.ghiDanh(4500, "p1", 3);
    let nextStruck = null;
    for (let t = 4600; t <= 9000; t += 200) {
      const hit = b.tick(t, nguoi, quai, openMap);
      if (hit !== null) {
        nextStruck = hit;
        break;
      }
    }
    assert.equal(nextStruck, 4);

    // Even if mobTargetB has zero dmg in map, if ghiDanh marks it as last human hit (e.g. miss/0-dmg tracked), bot cannot retarget it
    b.ghiDanh(5500, "p1", 4);
    assert.equal(b.tick(6500, nguoi, [mobTargetB], openMap), null);
  });

  it("skips boss/elite/sat and out-of-range mobs, stays pure without mutating inputs", () => {
    const b = taoBotLuyenCong();
    const nguoi = new Map([["p1", { x: 1000, y: 1000 }]]);
    const boss = makeMob(10, 1200, 1000, { boss: 1 });
    const ta = makeMob(11, 1200, 1000, { ta: 1 });
    const sat = makeMob(12, 1200, 1000, { sat: 5 });
    const tooClose = makeMob(13, 1050, 1000); // <130px from anchor
    const tooFar = makeMob(14, 1500, 1000);   // >420px from anchor
    const quai = [makeMob(1, 1010, 1000), boss, ta, sat, tooClose, tooFar];

    b.ghiDanh(0, "p1", 1);
    b.ghiDanh(1000, "p1", 1);
    for (let t = 3000; t <= 7000; t += 250) {
      assert.equal(b.tick(t, nguoi, quai, openMap), null);
    }
    assert.equal(boss.mau, 1000);
    assert.equal(ta.mau, 1000);
    assert.equal(sat.mau, 1000);
  });

  it("rejects walls and invalid/missing map without teleporting through blocked tiles", () => {
    const b = taoBotLuyenCong();
    const nguoi = new Map([["p1", { x: 1000, y: 1000 }]]);
    const quai = [makeMob(1, 1010, 1000), makeMob(2, 1220, 1000)];

    b.ghiDanh(0, "p1", 1);
    b.ghiDanh(1000, "p1", 1);

    // Fails closed if map unavailable
    assert.equal(b.tick(3500, nguoi, quai, null), null);
    assert.equal(b.trangThai(), null);

    // Wall blocks line between spawn/bot and mob 2
    const walledMap = {
      walkable: (x) => x < 1195 || x > 1205,
      clear: (ax, ay, bx, by) => !(Math.min(ax, bx) <= 1200 && Math.max(ax, bx) >= 1200),
    };
    b.tick(3500, nguoi, quai, walledMap);
    const st0 = b.trangThai();
    assert.ok(st0);
    assert.ok(st0.x < 1195, "spawn must not cross wall from anchor");
    const hit = b.tick(4500, nguoi, quai, walledMap);
    assert.equal(hit, null);
    const st1 = b.trangThai();
    assert.ok(st1.x < 1195);
    assert.equal(b.tick(5000, nguoi, quai, null), null);
    assert.equal(b.trangThai().act, "stand");
  });

  it("exits toward spawn on inactivity and cleans up cleanly even when targets gone; requires fresh combat", () => {
    const b = taoBotLuyenCong();
    const nguoi = new Map([["p1", { x: 1000, y: 1000 }]]);
    const quai = [makeMob(1, 1010, 1000), makeMob(2, 1300, 1000)];

    b.ghiDanh(0, "p1", 1);
    b.ghiDanh(1000, "p1", 1);
    b.tick(3100, nguoi, quai, openMap);
    const spawn = { x: b.trangThai().x, y: b.trangThai().y };

    // Strike mob 2 (300px away from anchor, so bot runs from spawn to reach it)
    let strikeT = 0;
    for (let t = 3300; t <= 8000; t += 200) {
      const uid = b.tick(t, nguoi, quai, openMap);
      if (uid === 2) { strikeT = t; break; }
    }
    assert.ok(strikeT > 0);
    assert.ok(b.trangThai().atkN >= 1);
    const awayDist = Math.hypot(b.trangThai().x - spawn.x, b.trangThai().y - spawn.y);
    assert.ok(awayDist > 10);

    // Quiet after t=1000 -> inactive at t=13000; test with empty quai too
    b.tick(12900, nguoi, [], openMap);
    assert.ok(b.trangThai());
    b.tick(13020, nguoi, [], openMap);
    const leaving = b.trangThai();
    assert.ok(leaving);
    assert.equal(leaving.act, "run");

    // Step toward spawn until despawned
    for (let t = 13200; t <= 20000; t += 200) {
      b.tick(t, nguoi, [], openMap);
    }
    assert.equal(b.trangThai(), null);
    assert.ok(Math.hypot(spawn.x - 1000, spawn.y - 1000) >= 56);

    // No new bot without fresh real-player combat
    b.tick(25000, nguoi, quai, openMap);
    assert.equal(b.trangThai(), null);

    // Fresh combat spawns cleanly again
    b.ghiDanh(26000, "p1", 1);
    b.ghiDanh(26500, "p1", 1);
    assert.equal(b.tick(28000, nguoi, quai, openMap), null);
    b.tick(29100, nguoi, quai, openMap);
    assert.ok(b.trangThai());
  });

  it("prunes disconnected player hits and bounded state without permanent leak", () => {
    const b = taoBotLuyenCong();
    const quai = [makeMob(1, 1010, 1000)];
    for (let i = 0; i < 400; i++) {
      b.ghiDanh(1000 + i, "ghost", i + 1);
    }
    // ghost is not in live nguoi -> hits pruned
    b.tick(5000, new Map([["real", { x: 1000, y: 1000 }]]), quai, openMap);
    assert.equal(b.trangThai(), null);
  });
});

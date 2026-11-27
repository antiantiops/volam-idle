"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { taoBotLuyenCong, taoDoiLuyenCong } = require("./bot-luyen-cong.js");

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
    const tooClose = makeMob(13, 1050, 1000); // <90px from anchor
    const tooFar = makeMob(14, 1800, 1000);   // >720px from anchor
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

    // Quiet after t=1000 -> inactive at t=46000; test with empty quai too
    b.tick(45900, nguoi, [], openMap);
    assert.ok(b.trangThai());
    b.tick(46020, nguoi, [], openMap);
    const leaving = b.trangThai();
    assert.ok(leaving);
    assert.equal(leaving.act, "run");

    // Step toward spawn until despawned
    for (let t = 46200; t <= 56000; t += 200) {
      b.tick(t, nguoi, [], openMap);
    }
    assert.equal(b.trangThai(), null);
    assert.ok(Math.hypot(spawn.x - 1000, spawn.y - 1000) >= 56);

    // No new bot without fresh real-player combat
    b.tick(58000, nguoi, quai, openMap);
    assert.equal(b.trangThai(), null);

    // Fresh combat spawns cleanly again
    b.ghiDanh(60000, "p1", 1);
    b.ghiDanh(60500, "p1", 1);
    assert.equal(b.tick(62000, nguoi, quai, openMap), null);
    b.tick(63100, nguoi, quai, openMap);
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

  it("squad spawns 3 distinct bots, assigns distinct targets, protects human/boss, cleans up and respawns with new IDs", () => {
    const squad = taoDoiLuyenCong();
    const nguoi = new Map([["p1", { x: 1000, y: 1000 }]]);
    const quai = [
      makeMob(1, 1020, 1000),
      makeMob(11, 1180, 1000),
      makeMob(12, 1000, 1180),
      makeMob(13, 820, 1000),
      makeMob(14, 1000, 820),
      makeMob(15, 1140, 1140),
      makeMob(16, 1180, 1180, { boss: 1 }),
      makeMob(17, 1200, 950, { dmg: new Map([["other", 1]]) }),
    ];

    assert.deepEqual(squad.trangThai(), []);
    squad.ghiDanh(0, "p1", 1);
    squad.ghiDanh(1000, "p1", 1);
    assert.deepEqual(squad.tick(2500, nguoi, quai, openMap), []);
    assert.deepEqual(squad.trangThai(), []);

    squad.tick(3100, nguoi, quai, openMap);
    const st0 = squad.trangThai();
    assert.equal(st0.length, 3);
    assert.deepEqual(st0.map((b) => b.id), [1, 2, 3]);

    for (let i = 0; i < st0.length; i++) {
      assert.ok(Math.hypot(st0[i].x - 1000, st0[i].y - 1000) >= 56);
      for (let j = i + 1; j < st0.length; j++) {
        assert.ok(Math.hypot(st0[i].x - st0[j].x, st0[i].y - st0[j].y) >= 56);
      }
    }

    // Run until all 3 bots strike; verify distinct targets across the squad and same-tick uniqueness
    const hitByBot = new Map();
    for (let t = 3300; t <= 9000; t += 200) {
      const strikes = squad.tick(t, nguoi, quai, openMap);
      const tickUids = new Set();
      for (const s of strikes) {
        assert.ok(s.id >= 1 && s.id <= 3);
        assert.ok(!tickUids.has(s.uid), "two bots must not strike same mob in one tick");
        tickUids.add(s.uid);
        assert.notEqual(s.uid, 1);
        assert.notEqual(s.uid, 16);
        assert.notEqual(s.uid, 17);
        hitByBot.set(s.id, s.uid);
      }
      if (hitByBot.size === 3) break;
    }
    assert.equal(hitByBot.size, 3);
    assert.equal(new Set(hitByBot.values()).size, 3);

    // Human hits mob 11 -> whichever bot had it yields immediately; excess bot does not steal another bot's mob
    const mob11 = quai.find((m) => m.uid === 11);
    mob11.dmg.set("p1", 5);
    squad.ghiDanh(9100, "p1", 11);
    const limitedMobs = quai.filter((m) => m.uid !== 13 && m.uid !== 14 && m.uid !== 15); // only mob 12 left for 3 bots
    for (let t = 9300; t <= 12000; t += 200) {
      const strikes = squad.tick(t, nguoi, limitedMobs, openMap);
      const uids = strikes.map((s) => s.uid);
      assert.equal(new Set(uids).size, uids.length);
      assert.ok(!uids.includes(11));
    }

    // Inactivity exits and cleans up, respawn gets new monotonic IDs (> 3)
    // last combat hit was t=9100 -> inactive at t=54100; exit takes up to 8s
    for (let t = 54200; t <= 63000; t += 200) {
      squad.tick(t, nguoi, [], openMap);
    }
    assert.deepEqual(squad.trangThai(), []);

    // Cramped terrain spawns fewer than 3 bots without teleporting
    const crampedMap = {
      walkable: (x, y) => x >= 980 && x <= 1160 && y >= 980 && y <= 1020,
      clear: (ax, ay, bx, by) => ax >= 980 && ax <= 1160 && bx >= 980 && bx <= 1160 && ay >= 980 && ay <= 1020 && by >= 980 && by <= 1020,
    };
    squad.ghiDanh(65000, "p1", 1);
    squad.ghiDanh(65500, "p1", 1);
    squad.tick(68100, nguoi, quai, crampedMap);
    const crampedSt = squad.trangThai();
    assert.ok(crampedSt.length >= 1 && crampedSt.length < 3);
    for (const b of crampedSt) {
      assert.ok(b.id > 3);
      assert.ok(crampedMap.walkable(b.x, b.y));
    }
  });

  it("survives transient player drop <8s and exits cleanly after >=8s absence or >=45s quiet", () => {
    const squad = taoDoiLuyenCong();
    const nguoi = new Map([["p1", { x: 1000, y: 1000 }]]);
    const quai = [makeMob(1, 1020, 1000), makeMob(2, 1200, 1000)];

    squad.ghiDanh(0, "p1", 1);
    squad.ghiDanh(1000, "p1", 1);
    squad.tick(3100, nguoi, quai, openMap);
    assert.equal(squad.trangThai().length, 3);

    // Drop player transiently for 5s (< 8s) -> squad stays active even after player returns
    for (let t = 3500; t <= 8500; t += 500) {
      squad.tick(t, new Map(), quai, openMap);
    }
    assert.equal(squad.trangThai().length, 3);
    squad.tick(9000, nguoi, quai, openMap);
    assert.equal(squad.trangThai().length, 3);

    // Drop player continuously for >= 8s -> triggers exit and cleans up
    for (let t = 9500; t <= 26000; t += 200) {
      squad.tick(t, new Map(), quai, openMap);
    }
    assert.deepEqual(squad.trangThai(), []);
  });

  it("routes around obstacle using map.path and strikes blocked mob instead of freezing", () => {
    const b = taoBotLuyenCong();
    const nguoi = new Map([["p1", { x: 1000, y: 1000 }]]);
    const rockBlocked = (ax, ay, bx, by) => {
      const steps = 20;
      for (let i = 0; i <= steps; i++) {
        const x = ax + ((bx - ax) * i) / steps;
        const y = ay + ((by - ay) * i) / steps;
        if (x >= 1240 && x <= 1270 && y >= 900 && y <= 1100) return true;
      }
      return false;
    };
    const rockMap = {
      walkable: (x, y) => !(x >= 1240 && x <= 1270 && y >= 900 && y <= 1100),
      clear: (ax, ay, bx, by) => !rockBlocked(ax, ay, bx, by),
      path: (ax, ay, bx, by) => {
        if (!rockBlocked(ax, ay, bx, by)) return [[bx, by]];
        return [
          [Math.min(ax, 1220), 1140],
          [1290, 1140],
          [bx, by],
        ];
      },
    };
    const mobBehindRock = makeMob(20, 1340, 1000);
    const quai = [makeMob(1, 1010, 1000), mobBehindRock];

    b.ghiDanh(0, "p1", 1);
    b.ghiDanh(1000, "p1", 1);
    b.tick(3100, nguoi, quai, rockMap);

    let struck = null;
    for (let t = 3300; t <= 12000; t += 200) {
      const uid = b.tick(t, nguoi, quai, rockMap);
      if (uid !== null) {
        struck = uid;
        break;
      }
    }
    assert.equal(struck, 20);
    assert.ok(rockMap.walkable(b.trangThai().x, b.trangThai().y));
  });

  it("roams deterministically when no eligible mobs exist and switches immediately to combat when mob appears", () => {
    const squad = taoDoiLuyenCong();
    const nguoi = new Map([["p1", { x: 1000, y: 1000 }]]);
    const initMobs = [makeMob(1, 1020, 1000)];

    squad.ghiDanh(0, "p1", 1);
    squad.ghiDanh(1000, "p1", 1);
    squad.tick(3100, nguoi, initMobs, openMap);
    const startPos = squad.trangThai().map((b) => ({ x: b.x, y: b.y }));

    let sawRun = false;
    let movedCount = 0;
    for (let t = 3300; t <= 6500; t += 200) {
      squad.tick(t, nguoi, [], openMap);
      const cur = squad.trangThai();
      if (cur.some((b) => b.act === "run")) sawRun = true;
    }
    const endPos = squad.trangThai();
    for (let i = 0; i < endPos.length; i++) {
      if (Math.hypot(endPos[i].x - startPos[i].x, endPos[i].y - startPos[i].y) > 20) {
        movedCount += 1;
      }
    }
    assert.ok(sawRun);
    assert.ok(movedCount >= 2);

    const newMob = makeMob(50, endPos[0].x + 120, endPos[0].y);
    let hit = false;
    for (let t = 6700; t <= 9500; t += 200) {
      const strikes = squad.tick(t, nguoi, [newMob], openMap);
      if (strikes.some((s) => s.uid === 50)) {
        hit = true;
        break;
      }
    }
    assert.ok(hit);
  });

  it("follows active player anchor when player moves >480px without teleporting bots", () => {
    const squad = taoDoiLuyenCong();
    const nguoi = new Map([["p1", { x: 1000, y: 1000 }]]);
    squad.ghiDanh(0, "p1", 1);
    squad.ghiDanh(1000, "p1", 1);
    squad.tick(3100, nguoi, [makeMob(1, 1020, 1000)], openMap);
    const before = squad.trangThai().map((b) => ({ x: b.x, y: b.y }));

    const movedPlayer = new Map([["p1", { x: 1700, y: 1000 }]]);
    const farMob = makeMob(99, 1900, 1000);
    squad.tick(3300, movedPlayer, [farMob], openMap);
    const rightAfter = squad.trangThai();
    for (let i = 0; i < rightAfter.length; i++) {
      assert.ok(Math.hypot(rightAfter[i].x - before[i].x, rightAfter[i].y - before[i].y) < 100);
    }

    let struck = false;
    for (let t = 3500; t <= 12000; t += 200) {
      const strikes = squad.tick(t, movedPlayer, [farMob], openMap);
      if (strikes.some((s) => s.uid === 99)) {
        struck = true;
        break;
      }
    }
    assert.ok(struck);
  });

  it("allows ranged botOpts.range >75px to strike from distance when clear", () => {
    const b = taoBotLuyenCong();
    const nguoi = new Map([["p1", { x: 1000, y: 1000 }]]);
    const mob = makeMob(30, 1340, 1000);
    const quai = [makeMob(1, 1010, 1000), mob];

    b.ghiDanh(0, "p1", 1);
    b.ghiDanh(1000, "p1", 1);
    const first = b.tick(3100, nguoi, quai, openMap, { 1: { range: 220 } });
    assert.equal(first, 30);
    const st1 = b.trangThai();
    assert.ok(Math.hypot(mob.x - st1.x, mob.y - st1.y) > 75);
    assert.ok(Math.hypot(mob.x - st1.x, mob.y - st1.y) <= 220);
  });

  it("uses botOpts.castMs for cadence and attack animation window without stagger", () => {
    const squad = taoDoiLuyenCong();
    const nguoi = new Map([["p1", { x: 1000, y: 1000 }]]);
    const quai = [
      makeMob(1, 1020, 1000),
      makeMob(11, 1180, 1000, { mau: 10000, mauMax: 10000 }),
      makeMob(12, 1000, 1180, { mau: 10000, mauMax: 10000 }),
      makeMob(13, 820, 1000, { mau: 10000, mauMax: 10000 }),
    ];

    squad.ghiDanh(0, "p1", 1);
    squad.ghiDanh(1000, "p1", 1);
    squad.tick(3100, nguoi, quai, openMap);

    const opts = new Map([
      ["1", { castMs: 650 }],
      ["2", { castMs: 650 }],
      ["3", { castMs: 650 }],
    ]);
    let bot2FirstAt = null;
    for (let t = 3300; t <= 6000; t += 10) {
      const strikes = squad.tick(t, nguoi, quai, openMap, opts);
      if (strikes.some((s) => s.id === 2)) {
        bot2FirstAt = t;
        break;
      }
    }
    assert.ok(bot2FirstAt !== null);

    // At +450ms (default animation duration) bot 2 is still in attack animation, no second strike yet
    assert.equal(squad.tick(bot2FirstAt + 450, nguoi, quai, openMap, opts).some((s) => s.id === 2), false);
    assert.equal(squad.trangThai().find((b) => b.id === 2).act, "attack");

    // At +649ms still before 650ms cadence: no early second hit, attack animation still active
    assert.equal(squad.tick(bot2FirstAt + 649, nguoi, quai, openMap, opts).some((s) => s.id === 2), false);
    assert.equal(squad.trangThai().find((b) => b.id === 2).act, "attack");

    // Exactly at +650ms (earlier than default 1000ms + 90ms id stagger): second strike fires
    const at650 = squad.tick(bot2FirstAt + 650, nguoi, quai, openMap, opts);
    assert.equal(at650.some((s) => s.id === 2), true);
  });

  it("consumes one-shot botOpts.buff only on eligible ready target, locks cast window without extra cooldown, preserves protection and legacy null", () => {
    const squad = taoDoiLuyenCong();
    const nguoi = new Map([["p1", { x: 1000, y: 1000 }]]);
    const humanMob = makeMob(1, 1020, 1000);
    const boss = makeMob(10, 1200, 1000, { boss: 1 });
    const mob = makeMob(11, 1300, 1000, { mau: 1000, mauMax: 1000 });
    const buffOpt = { buff: { skillId: 15, skillLv: 10, castMs: 500 } };

    squad.ghiDanh(0, "p1", 1);
    squad.ghiDanh(1000, "p1", 1);
    squad.tick(3100, nguoi, [humanMob], openMap);
    const b1 = squad.trangThai()[0];
    const opts = new Map([[b1.id, buffOpt]]);

    // Ineligible targets (human-protected + boss) do not consume buff or strike
    assert.deepEqual(squad.tick(3300, nguoi, [humanMob, boss], openMap, opts), []);

    // Approaching mob out of range emits neither buff nor strike; emits buff once in range/LOS
    let buffAt = null;
    for (let t = 3500; t <= 8000; t += 100) {
      const actions = squad.tick(t, nguoi, [humanMob, boss, mob], openMap, opts);
      if (actions.length) {
        assert.deepEqual(actions, [{ id: b1.id, buff: { skillId: 15, skillLv: 10 } }]);
        buffAt = t;
        break;
      }
    }
    assert.ok(buffAt !== null);
    const duringSt = squad.trangThai().find((b) => b.id === b1.id);
    assert.equal(duringSt.act, "attack");
    assert.equal(duringSt.atkN, 1);

    // Caller clears option; even if target moves out of range during 500ms cast window, bot neither moves nor hits early
    mob.x += 120;
    assert.deepEqual(squad.tick(buffAt + 499, nguoi, [humanMob, boss, mob], openMap), []);
    const midSt = squad.trangThai().find((b) => b.id === b1.id);
    assert.equal(midSt.x, duringSt.x);
    assert.equal(midSt.y, duringSt.y);
    assert.equal(midSt.act, "attack");

    // Return mob to range: at +500ms (< 1000ms default cooldown) next hit fires immediately with no extra wait
    mob.x -= 120;
    assert.deepEqual(squad.tick(buffAt + 500, nguoi, [humanMob, boss, mob], openMap), [{ id: b1.id, uid: 11 }]);

    // Invalid buff spec is ignored and normal strike fires once cooldown elapses
    assert.deepEqual(
      squad.tick(buffAt + 1500, nguoi, [humanMob, boss, mob], openMap, new Map([[b1.id, { buff: { skillId: 15, skillLv: 10, castMs: 349 } }]])),
      [{ id: b1.id, uid: 11 }]
    );

    // Legacy single-bot wrapper returns null (not undefined) for buff-only tick, then uid on strike
    const single = taoBotLuyenCong();
    single.ghiDanh(0, "p1", 1);
    single.ghiDanh(1000, "p1", 1);
    single.tick(3100, nguoi, [makeMob(1, 1020, 1000)], openMap);
    let legacyBuffT = null;
    for (let t = 3300; t <= 8000; t += 100) {
      const prevN = single.trangThai().atkN;
      const res = single.tick(t, nguoi, [makeMob(20, 1200, 1000)], openMap, { 1: buffOpt });
      assert.strictEqual(res, null);
      if (single.trangThai().atkN > prevN) { legacyBuffT = t; break; }
    }
    assert.ok(legacyBuffT !== null);
    assert.strictEqual(single.tick(legacyBuffT + 500, nguoi, [makeMob(20, 1200, 1000)], openMap), 20);
  });
});

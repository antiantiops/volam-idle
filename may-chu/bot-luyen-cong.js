"use strict";

// Bot luyện công thử nghiệm (chỉ logic máy chủ, chưa gắn vào luồng phòng):
// một NPC thân thiện phụ đánh quái thường quanh điểm neo cố định ở bãi chung Lâm Du Quan (319)
// sau khi người chơi thật đánh nhau liên tục, nhường mục tiêu của người chơi và tự rời đi khi yên ắng.
//
// Quy ước hướng 8 chiều khớp src/dir.js (dirOf):
//   0 xuống · 1 chéo trái xuống · 2 trái · 3 chéo trái lên · 4 lên · 5 chéo phải lên · 6 phải · 7 chéo phải xuống

const DELAY_MS = 3000;
const MIN_HITS = 2;
const INACTIVE_MS = 12000;
const EXIT_MAX_MS = 6000;

const TARGET_MIN_DIST = 130;
const TARGET_MAX_DIST = 420;
const ATTACK_RANGE = 75;
const STEP_STOP_DIST = 60;
const RUN_SPEED = 135; // 10 * 18 * 0.75 px/s (src/game/world.js)
const ATK_COOLDOWN_MS = 1000;
const ATK_ANIM_MS = 450;

const SPAWN_RADII = [160, 200, 120, 240, 88, 280];
const SPAWN_DIRS = 16;
const PLAYER_CLEAR_DIST = 56;
const SUBSTEP_PX = 12;
const ARRIVE_EPS = 6;

const MAX_HITS = 64;
const MAX_HUMAN_MOBS = 256;

function dirOf(dx, dy) {
  if (!dx && !dy) return 0;
  return (Math.round(Math.atan2(-dx, dy) / (Math.PI / 4)) % 8 + 8) % 8;
}

function isPoint(p) {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function isValidUid(uid) {
  return (typeof uid === "number" && Number.isFinite(uid)) || (typeof uid === "string" && uid.length > 0);
}

function mapValid(map) {
  return !!map && typeof map.walkable === "function" && typeof map.clear === "function";
}

function safeWalkable(map, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  try { return Boolean(map.walkable(x, y)); } catch { return false; }
}

function safeClear(map, ax, ay, bx, by) {
  if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return false;
  try { return Boolean(map.clear(ax, ay, bx, by)); } catch { return false; }
}

function hasPositiveDmg(dmg) {
  if (!dmg) return false;
  if (typeof dmg.values === "function") {
    for (const v of dmg.values()) if (Number.isFinite(v) && v > 0) return true;
    return false;
  }
  if (typeof dmg === "object") {
    for (const k of Object.keys(dmg)) {
      const v = dmg[k];
      if (Number.isFinite(v) && v > 0) return true;
    }
  }
  return false;
}

function stepStraight(map, x0, y0, tx, ty, maxDist) {
  const dx = tx - x0, dy = ty - y0;
  const total = Math.hypot(dx, dy);
  if (!(total > 0) || !(maxDist > 0)) return { x: x0, y: y0, moved: false };
  const travel = Math.min(total, maxDist);
  const steps = Math.max(1, Math.ceil(travel / SUBSTEP_PX));
  const ux = dx / total, uy = dy / total;
  let cx = x0, cy = y0, moved = false;
  for (let i = 1; i <= steps; i++) {
    const d = (travel * i) / steps;
    const nx = x0 + ux * d, ny = y0 + uy * d;
    if (!safeWalkable(map, nx, ny)) break;
    if (!safeClear(map, cx, cy, nx, ny) || !safeClear(map, x0, y0, nx, ny)) break;
    cx = nx; cy = ny; moved = true;
  }
  return { x: cx, y: cy, moved };
}

function playerOverlap(x, y, livePlayers) {
  for (const p of livePlayers.values()) {
    if (Math.hypot(x - p.x, y - p.y) < PLAYER_CLEAR_DIST) return true;
  }
  return false;
}

function pickAnchorAndSpawn(hits, livePlayers, map) {
  const seen = new Set();
  for (let i = hits.length - 1; i >= 0; i--) {
    const tk = hits[i].tk;
    if (seen.has(tk)) continue;
    seen.add(tk);
    const p = livePlayers.get(tk);
    if (!p || !safeWalkable(map, p.x, p.y)) continue;

    for (const r of SPAWN_RADII) {
      for (let k = 0; k < SPAWN_DIRS; k++) {
        const a = (k * 2 * Math.PI) / SPAWN_DIRS;
        const sx = Math.round(p.x + Math.cos(a) * r);
        const sy = Math.round(p.y + Math.sin(a) * r);
        if (!safeWalkable(map, sx, sy) || playerOverlap(sx, sy, livePlayers)) continue;
        if (safeClear(map, p.x, p.y, sx, sy)) {
          return { anchor: { x: p.x, y: p.y }, spawn: { x: sx, y: sy } };
        }
      }
    }
  }
  return null;
}

function taoBotLuyenCong() {
  const hits = []; // [{ t, tk, uid }]
  const humanHitUids = new Map(); // uid -> t
  let lastHumanUid = null;
  let bot = null;
  let prevTickT = null;

  function pruneHitsByTime(t) {
    while (hits.length && t - hits[0].t >= INACTIVE_MS) hits.shift();
    for (const [uid, ht] of humanHitUids) {
      if (t - ht >= INACTIVE_MS) {
        humanHitUids.delete(uid);
        if (lastHumanUid === uid) lastHumanUid = null;
      }
    }
  }

  function ghiDanh(t, tk, uid) {
    if (!Number.isFinite(t) || typeof tk !== "string" || !tk || !isValidUid(uid)) return;
    pruneHitsByTime(t);

    if (bot && !bot.exiting && bot.targetUid === uid) {
      bot.targetUid = null;
      if (bot.act === "attack") bot.act = "stand";
    }

    lastHumanUid = uid;
    humanHitUids.delete(uid);
    humanHitUids.set(uid, t);
    while (humanHitUids.size > MAX_HUMAN_MOBS) {
      const oldest = humanHitUids.keys().next().value;
      humanHitUids.delete(oldest);
      if (lastHumanUid === oldest) lastHumanUid = null;
    }

    const dup = hits.some((h) => h.t === t && h.tk === tk && h.uid === uid);
    if (dup) return;

    if (hits.length >= MAX_HITS) hits.splice(1, 1); // giữ mốc đầu đợt đánh, chặn rò rỉ bộ nhớ
    hits.push({ t, tk, uid });
    if (bot && !bot.exiting) bot.lastCombatHitAt = t;
  }

  function isMobEligible(m, botState, map) {
    if (!m || m.boss || m.ta || m.sat) return false;
    if (m.uid === lastHumanUid || humanHitUids.has(m.uid) || hasPositiveDmg(m.dmg)) return false;
    const dAnchor = Math.hypot(m.x - botState.anchor.x, m.y - botState.anchor.y);
    if (dAnchor < TARGET_MIN_DIST || dAnchor > TARGET_MAX_DIST) return false;
    return safeWalkable(map, m.x, m.y) && safeClear(map, botState.x, botState.y, m.x, m.y);
  }

  function pickTarget(liveMobs, botState, map) {
    let best = null, bestDist = Infinity;
    for (const m of liveMobs.values()) {
      if (!isMobEligible(m, botState, map)) continue;
      const d = Math.hypot(m.x - botState.x, m.y - botState.y);
      if (d < bestDist || (d === bestDist && best && String(m.uid) < String(best.uid))) {
        best = m; bestDist = d;
      }
    }
    return best;
  }

  function tick(t, nguoi, quai, map) {
    if (!Number.isFinite(t)) return null;
    const prevT = prevTickT;
    if (prevTickT === null || t > prevTickT) prevTickT = t;

    const livePlayers = new Map();
    if (nguoi && typeof nguoi[Symbol.iterator] === "function") {
      for (const entry of nguoi) {
        if (!Array.isArray(entry) || entry.length < 2) continue;
        const [tk, pos] = entry;
        if (typeof tk === "string" && tk && isPoint(pos)) livePlayers.set(tk, pos);
      }
    }

    pruneHitsByTime(t);
    for (let i = hits.length - 1; i >= 0; i--) {
      if (!livePlayers.has(hits[i].tk)) hits.splice(i, 1);
    }

    const liveMobs = new Map();
    if (quai && typeof quai[Symbol.iterator] === "function") {
      for (const m of quai) {
        if (!m || !isValidUid(m.uid) || !isPoint(m)) continue;
        if (!Number.isFinite(m.mau) || m.mau <= 0) continue;
        if (m.mauMax != null && (!Number.isFinite(m.mauMax) || m.mauMax <= 0)) continue;
        liveMobs.set(m.uid, m);
      }
    }

    for (const uid of [...humanHitUids.keys()]) {
      if (!liveMobs.has(uid)) humanHitUids.delete(uid);
    }
    if (lastHumanUid !== null && !liveMobs.has(lastHumanUid)) lastHumanUid = null;

    const okMap = mapValid(map);

    if (!bot) {
      if (!okMap || livePlayers.size === 0) return null;
      if (hits.length < MIN_HITS || t - hits[0].t < DELAY_MS) return null;
      const chosen = pickAnchorAndSpawn(hits, livePlayers, map);
      if (!chosen) return null;
      bot = {
        x: chosen.spawn.x,
        y: chosen.spawn.y,
        dir: dirOf(chosen.anchor.x - chosen.spawn.x, chosen.anchor.y - chosen.spawn.y),
        act: "stand",
        atkN: 0,
        anchor: chosen.anchor,
        spawn: chosen.spawn,
        targetUid: null,
        lastAtkAt: -Infinity,
        atkAnimUntil: -Infinity,
        lastCombatHitAt: hits[hits.length - 1].t,
        exiting: false,
        exitStartedAt: 0,
      };
    } else if (!bot.exiting && hits.length === 0) {
      bot.exiting = true;
      bot.targetUid = null;
      bot.exitStartedAt = Math.min(t, bot.lastCombatHitAt + INACTIVE_MS);
    }

    if (bot.exiting) {
      if (t - bot.exitStartedAt >= EXIT_MAX_MS) { bot = null; return null; }
      const dSpawn = Math.hypot(bot.spawn.x - bot.x, bot.spawn.y - bot.y);
      if (dSpawn <= ARRIVE_EPS) { bot = null; return null; }
      if (!okMap) { bot = null; return null; }

      const moveFrom = prevT === null ? bot.exitStartedAt : Math.max(prevT, bot.exitStartedAt);
      const dtSec = Math.max(0, t - moveFrom) / 1000;
      const step = stepStraight(map, bot.x, bot.y, bot.spawn.x, bot.spawn.y, RUN_SPEED * dtSec);
      bot.x = step.x;
      bot.y = step.y;
      if (Math.hypot(bot.spawn.x - bot.x, bot.spawn.y - bot.y) <= ARRIVE_EPS) { bot = null; return null; }
      if (step.moved) {
        bot.dir = dirOf(bot.spawn.x - bot.x, bot.spawn.y - bot.y);
        bot.act = "run";
      } else {
        bot = null;
      }
      return null;
    }

    if (!okMap) {
      bot.targetUid = null;
      bot.act = "stand";
      return null;
    }

    let target = bot.targetUid !== null ? liveMobs.get(bot.targetUid) : null;
    if (!target || !isMobEligible(target, bot, map)) {
      bot.targetUid = null;
      target = pickTarget(liveMobs, bot, map);
      if (target) bot.targetUid = target.uid;
    }

    if (!target) {
      bot.act = t < bot.atkAnimUntil ? "attack" : "stand";
      return null;
    }

    const dtSec = prevT === null ? 0 : Math.max(0, t - prevT) / 1000;
    let dist = Math.hypot(target.x - bot.x, target.y - bot.y);
    let moved = false;

    if (dist > ATTACK_RANGE && dtSec > 0) {
      const want = Math.max(0, dist - STEP_STOP_DIST);
      const step = stepStraight(map, bot.x, bot.y, target.x, target.y, Math.min(RUN_SPEED * dtSec, want));
      bot.x = step.x;
      bot.y = step.y;
      moved = step.moved;
      dist = Math.hypot(target.x - bot.x, target.y - bot.y);
    }

    bot.dir = dirOf(target.x - bot.x, target.y - bot.y);

    if (dist <= ATTACK_RANGE && safeClear(map, bot.x, bot.y, target.x, target.y)) {
      if (t - bot.lastAtkAt >= ATK_COOLDOWN_MS) {
        bot.atkN += 1;
        bot.lastAtkAt = t;
        bot.atkAnimUntil = t + ATK_ANIM_MS;
        bot.act = "attack";
        return target.uid;
      }
      bot.act = t < bot.atkAnimUntil ? "attack" : "stand";
      return null;
    }

    bot.act = moved ? "run" : (t < bot.atkAnimUntil ? "attack" : "stand");
    return null;
  }

  function trangThai() {
    if (!bot) return null;
    return { x: bot.x, y: bot.y, dir: bot.dir, act: bot.act, atkN: bot.atkN };
  }

  return { ghiDanh, tick, trangThai };
}

module.exports = { taoBotLuyenCong };

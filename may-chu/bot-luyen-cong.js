"use strict";

// Bot luyện công thử nghiệm (chỉ logic máy chủ, chưa gắn vào luồng phòng):
// một NPC hoặc đội tối đa 5 NPC thân thiện phụ đánh quái thường quanh điểm neo ở bãi chung Lâm Du Quan (319)
// sau khi người chơi thật đánh nhau liên tục, nhường mục tiêu của người chơi và tự rời đi khi yên ắng.
//
// Quy ước hướng 8 chiều khớp src/dir.js (dirOf):
//   0 xuống · 1 chéo trái xuống · 2 trái · 3 chéo trái lên · 4 lên · 5 chéo phải lên · 6 phải · 7 chéo phải xuống

const DELAY_MS = 3000;
const MIN_HITS = 2;
const INACTIVE_MS = 45000;
const HUMAN_PROTECT_MS = 12000;
const NO_PLAYER_EXIT_MS = 8000;
const EXIT_MAX_MS = 8000;
const EXIT_STUCK_MS = 1500;
const ANCHOR_FOLLOW_DIST = 480;

const TARGET_MIN_DIST = 90;
const TARGET_MAX_DIST = 720;
const ATTACK_RANGE = 75;
const ATK_RANGE_MIN = 75;
const ATK_RANGE_MAX = 280;
const RUN_SPEED = 135; // 10 * 18 * 0.75 px/s (src/game/world.js)
const ATK_COOLDOWN_MS = 1000;
const ATK_ANIM_MS = 450;
const CAST_MS_MIN = 350;
const CAST_MS_MAX = 2000;
const PATH_REUSE_DIST = 48;
const PATH_REUSE_MS = 600;
const STUCK_TARGET_MS = 1200;
const SKIP_MOB_MS = 3000;
const PATROL_ARRIVE_EPS = 14;

const SPAWN_RADII = [160, 200, 120, 240, 88, 280];
const SPAWN_DIRS = 16;
const SQUAD_MAX_BOTS = 3;
const SLOT_ANGLE_OFFSETS = [0, 1, -1, 2, -2];
const PLAYER_CLEAR_DIST = 56;
const SUBSTEP_PX = 12;
const ARRIVE_EPS = 6;

const MAX_HITS = 64;
const MAX_HUMAN_MOBS = 256;

function dirOf(dx, dy) {
  if (!dx && !dy) return 0;
  return (Math.round(Math.atan2(-dx, dy * 2) / (Math.PI / 4)) % 8 + 8) % 8;
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

function safePath(map, ax, ay, bx, by) {
  if (!map || typeof map.path !== "function") return null;
  if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return null;
  let raw;
  try { raw = map.path(ax, ay, bx, by); } catch { return null; }
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const pts = [];
  for (const pt of raw) {
    if (Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) {
      pts.push([pt[0], pt[1]]);
    } else if (isPoint(pt)) {
      pts.push([pt.x, pt.y]);
    }
  }
  return pts.length > 0 ? pts : null;
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

function pointOverlap(x, y, livePlayers, extraPoints) {
  if (playerOverlap(x, y, livePlayers)) return true;
  if (extraPoints) {
    for (const pt of extraPoints) {
      if (Math.hypot(x - pt.x, y - pt.y) < PLAYER_CLEAR_DIST) return true;
    }
  }
  return false;
}

function getBotOpt(botOpts, botId) {
  if (!botOpts || typeof botOpts !== "object") return null;
  return typeof botOpts.get === "function"
    ? (botOpts.get(botId) ?? botOpts.get(String(botId)))
    : botOpts[botId];
}

function getBotRange(botOpts, botId) {
  const opt = getBotOpt(botOpts, botId);
  if (!opt || !Number.isFinite(opt.range)) return ATTACK_RANGE;
  return Math.max(ATK_RANGE_MIN, Math.min(ATK_RANGE_MAX, opt.range));
}

function getBotCastMs(botOpts, botId) {
  const opt = getBotOpt(botOpts, botId);
  if (!opt || !Number.isFinite(opt.castMs)) return null;
  return Math.max(CAST_MS_MIN, Math.min(CAST_MS_MAX, opt.castMs));
}

function getBotBuff(botOpts, botId) {
  const opt = getBotOpt(botOpts, botId);
  const b = opt && typeof opt === "object" ? opt.buff : null;
  if (!b || typeof b !== "object") return null;
  if (!Number.isInteger(b.skillId) || b.skillId <= 0) return null;
  if (!Number.isInteger(b.skillLv) || b.skillLv <= 0) return null;
  if (!Number.isFinite(b.castMs) || b.castMs < CAST_MS_MIN || b.castMs > CAST_MS_MAX) return null;
  return { skillId: b.skillId, skillLv: b.skillLv, castMs: b.castMs };
}

// ponytail: deterministic patrol + cached map.path waypoints (1.5s stuck recovery); upgrade to formation/crowd steering if map obstacles grow denser.
function moveToward(bot, map, tx, ty, maxDist, t) {
  if (safeClear(map, bot.x, bot.y, tx, ty)) {
    bot.path = null;
    bot.pathGoal = null;
    bot.pathAt = -Infinity;
    if (!(maxDist > 0)) return { x: bot.x, y: bot.y, moved: false, noPath: false };
    const step = stepStraight(map, bot.x, bot.y, tx, ty, maxDist);
    return { x: step.x, y: step.y, moved: step.moved, noPath: false };
  }

  if (typeof map.path === "function") {
    const cacheValid =
      Array.isArray(bot.path) &&
      bot.path.length > 0 &&
      bot.pathGoal &&
      Math.hypot(tx - bot.pathGoal.x, ty - bot.pathGoal.y) < PATH_REUSE_DIST &&
      t - bot.pathAt < PATH_REUSE_MS;

    if (!cacheValid) {
      const pts = safePath(map, bot.x, bot.y, tx, ty);
      if (!pts) {
        bot.path = null;
        bot.pathGoal = null;
        bot.pathAt = -Infinity;
        return { x: bot.x, y: bot.y, moved: false, noPath: true };
      }
      bot.path = pts;
      bot.pathGoal = { x: tx, y: ty };
      bot.pathAt = t;
    }

    if (!(maxDist > 0)) return { x: bot.x, y: bot.y, moved: false, noPath: false };

    let cx = bot.x, cy = bot.y, moved = false, rem = maxDist;
    while (bot.path.length > 0 && rem > 0) {
      const wp = bot.path[0];
      const dWp = Math.hypot(wp[0] - cx, wp[1] - cy);
      if (dWp <= ARRIVE_EPS) {
        bot.path.shift();
        continue;
      }
      const step = stepStraight(map, cx, cy, wp[0], wp[1], Math.min(rem, dWp));
      if (step.moved) {
        rem -= Math.hypot(step.x - cx, step.y - cy);
        cx = step.x;
        cy = step.y;
        moved = true;
        if (Math.hypot(wp[0] - cx, wp[1] - cy) <= ARRIVE_EPS) {
          bot.path.shift();
        }
        if (rem <= 0.5) break;
      } else {
        bot.path = null;
        bot.pathGoal = null;
        break;
      }
    }
    return { x: cx, y: cy, moved, noPath: false };
  }

  if (!(maxDist > 0)) return { x: bot.x, y: bot.y, moved: false, noPath: false };
  const step = stepStraight(map, bot.x, bot.y, tx, ty, maxDist);
  return { x: step.x, y: step.y, moved: step.moved, noPath: false };
}

function pickSpawnsAtAnchor(anchor, livePlayers, map, maxBots) {
  if (maxBots === 1) {
    for (const r of SPAWN_RADII) {
      for (let k = 0; k < SPAWN_DIRS; k++) {
        const a = (k * 2 * Math.PI) / SPAWN_DIRS;
        const sx = Math.round(anchor.x + Math.cos(a) * r);
        const sy = Math.round(anchor.y + Math.sin(a) * r);
        if (!safeWalkable(map, sx, sy) || pointOverlap(sx, sy, livePlayers)) continue;
        if (safeClear(map, anchor.x, anchor.y, sx, sy)) return [{ x: sx, y: sy }];
      }
    }
    return [];
  }

  const spawns = [];
  const sectorStep = (2 * Math.PI) / maxBots;
  const offsetRad = Math.PI / (maxBots * 2.5);
  for (let slot = 0; slot < maxBots; slot++) {
    const baseAngle = slot * sectorStep;
    let found = null;
    for (const r of SPAWN_RADII) {
      for (const mult of SLOT_ANGLE_OFFSETS) {
        const a = baseAngle + mult * offsetRad;
        const sx = Math.round(anchor.x + Math.cos(a) * r);
        const sy = Math.round(anchor.y + Math.sin(a) * r);
        if (!safeWalkable(map, sx, sy) || pointOverlap(sx, sy, livePlayers, spawns)) continue;
        if (safeClear(map, anchor.x, anchor.y, sx, sy)) {
          found = { x: sx, y: sy };
          break;
        }
      }
      if (found) break;
    }
    if (found) spawns.push(found);
  }
  return spawns;
}

function pickAnchorAndSpawns(hits, livePlayers, map, maxBots) {
  const seen = new Set();
  for (let i = hits.length - 1; i >= 0; i--) {
    const tk = hits[i].tk;
    if (seen.has(tk)) continue;
    seen.add(tk);
    const p = livePlayers.get(tk);
    if (!p || !safeWalkable(map, p.x, p.y)) continue;

    const spawns = pickSpawnsAtAnchor(p, livePlayers, map, maxBots);
    if (spawns.length > 0) {
      return { anchor: { x: p.x, y: p.y }, spawns };
    }
  }
  return null;
}

function patrolPauseMs(botId, seq) {
  return 800 + ((botId * 173 + seq * 97) % 800);
}

function pickPatrolPoint(bot, otherBots, livePlayers, map) {
  const baseRadius = 140 + ((bot.id * 89 + bot.patrolSeq * 131) % 281);
  const radii = [baseRadius, 220, 320, 160, 400, 140, 420];
  const baseAngle = (((bot.id * 137 + bot.patrolSeq * 79) % 360) * Math.PI) / 180;
  const canPath = typeof map.path === "function";
  let pathChecks = 0;

  for (const r of radii) {
    for (let k = 0; k < 12; k++) {
      const a = baseAngle + (k * Math.PI) / 6;
      const px = Math.round(bot.anchor.x + Math.cos(a) * r);
      const py = Math.round(bot.anchor.y + Math.sin(a) * r);
      if (Math.hypot(px - bot.x, py - bot.y) <= 28) continue;
      if (!safeWalkable(map, px, py) || pointOverlap(px, py, livePlayers, otherBots)) continue;
      if (safeClear(map, bot.x, bot.y, px, py)) {
        return { point: { x: px, y: py }, path: null };
      }
      if (canPath && pathChecks < 8) {
        pathChecks += 1;
        const pts = safePath(map, bot.x, bot.y, px, py);
        if (pts) return { point: { x: px, y: py }, path: pts };
      }
    }
  }
  return null;
}

function taoBoDieuKhien(maxBots = 1) {
  const hits = []; // [{ t, tk, uid }]
  const humanHitUids = new Map(); // uid -> t
  let lastHumanUid = null;
  const bots = [];
  let prevTickT = null;
  let lastPlayerSeenAt = null;
  let nextBotId = 1;

  function pruneHitsByTime(t) {
    while (hits.length && t - hits[0].t >= INACTIVE_MS) hits.shift();
    for (const [uid, ht] of humanHitUids) {
      if (t - ht >= HUMAN_PROTECT_MS) {
        humanHitUids.delete(uid);
        if (lastHumanUid === uid) lastHumanUid = null;
      }
    }
  }

  function ghiDanh(t, tk, uid) {
    if (!Number.isFinite(t) || typeof tk !== "string" || !tk || !isValidUid(uid)) return;
    pruneHitsByTime(t);

    for (const b of bots) {
      if (!b.exiting && b.targetUid === uid) {
        b.targetUid = null;
        b.path = null;
        b.pathGoal = null;
        b.stuckUid = null;
        if (b.act === "attack") b.act = "stand";
      }
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
    for (const b of bots) {
      if (!b.exiting) b.lastCombatHitAt = Math.max(b.lastCombatHitAt, t);
    }
  }

  function pruneSkipMobs(botState, t) {
    for (const [uid, untilT] of botState.skipMobs) {
      if (t >= untilT) botState.skipMobs.delete(uid);
    }
  }

  function isMobEligible(m, botState, map, t) {
    if (!m || m.boss || m.ta || m.sat) return false;
    if (m.uid === lastHumanUid || humanHitUids.has(m.uid) || hasPositiveDmg(m.dmg)) return false;
    if (Number.isFinite(t)) pruneSkipMobs(botState, t);
    if (botState.skipMobs.has(m.uid)) return false;
    const dAnchor = Math.hypot(m.x - botState.anchor.x, m.y - botState.anchor.y);
    if (dAnchor < TARGET_MIN_DIST || dAnchor > TARGET_MAX_DIST) return false;
    if (!safeWalkable(map, m.x, m.y)) return false;
    if (typeof map.path === "function") return true;
    return safeClear(map, botState.x, botState.y, m.x, m.y);
  }

  function pickTarget(liveMobs, botState, map, reserved, t) {
    const candidates = [];
    for (const m of liveMobs.values()) {
      if (reserved && reserved.has(m.uid)) continue;
      if (!isMobEligible(m, botState, map, t)) continue;
      const d = Math.hypot(m.x - botState.x, m.y - botState.y);
      candidates.push({ mob: m, dist: d });
    }
    candidates.sort((a, b) => a.dist - b.dist || (String(a.mob.uid) < String(b.mob.uid) ? -1 : String(a.mob.uid) > String(b.mob.uid) ? 1 : 0));
    for (const c of candidates) {
      if (safeClear(map, botState.x, botState.y, c.mob.x, c.mob.y)) {
        return { mob: c.mob, path: null };
      }
      if (typeof map.path === "function") {
        const pts = safePath(map, botState.x, botState.y, c.mob.x, c.mob.y);
        if (pts) return { mob: c.mob, path: pts };
        botState.skipMobs.set(c.mob.uid, t + SKIP_MOB_MS);
      }
    }
    return null;
  }

  function tick(t, nguoi, quai, map, botOpts) {
    if (!Number.isFinite(t)) return [];
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

    if (livePlayers.size > 0) lastPlayerSeenAt = t;

    pruneHitsByTime(t);
    if (bots.length === 0) {
      for (let i = hits.length - 1; i >= 0; i--) {
        if (!livePlayers.has(hits[i].tk)) hits.splice(i, 1);
      }
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
    let justSpawned = false;

    if (bots.length === 0) {
      if (!okMap || livePlayers.size === 0) return [];
      if (hits.length < MIN_HITS || t - hits[0].t < DELAY_MS) return [];
      const chosen = pickAnchorAndSpawns(hits, livePlayers, map, maxBots);
      if (!chosen) return [];
      const lastHitAt = hits[hits.length - 1].t;
      for (const sp of chosen.spawns) {
        bots.push({
          id: nextBotId++,
          x: sp.x,
          y: sp.y,
          dir: dirOf(chosen.anchor.x - sp.x, chosen.anchor.y - sp.y),
          act: "stand",
          atkN: 0,
          anchor: chosen.anchor,
          spawn: sp,
          targetUid: null,
          lastAtkAt: -Infinity,
          atkAnimUntil: -Infinity,
          buffUntil: -Infinity,
          lastCombatHitAt: lastHitAt,
          exiting: false,
          exitStartedAt: 0,
          exitProgressAt: 0,
          exitAnchorX: sp.x,
          exitAnchorY: sp.y,
          exitMinDist: 0,
          path: null,
          pathGoal: null,
          pathAt: -Infinity,
          skipMobs: new Map(),
          stuckUid: null,
          stuckCheckAt: 0,
          stuckX: sp.x,
          stuckY: sp.y,
          stuckBestDist: Infinity,
          patrol: null,
          patrolSeq: 0,
          patrolWaitUntil: null,
        });
      }
      justSpawned = true;
    } else {
      let triggeredExit = false;
      const noPlayerExit = livePlayers.size === 0 && lastPlayerSeenAt !== null && t - lastPlayerSeenAt >= NO_PLAYER_EXIT_MS;
      for (const b of bots) {
        if (b.exiting) continue;
        const inactiveExit = t - b.lastCombatHitAt >= INACTIVE_MS;
        if (noPlayerExit || inactiveExit) {
          const times = [];
          if (noPlayerExit) times.push(lastPlayerSeenAt + NO_PLAYER_EXIT_MS);
          if (inactiveExit) times.push(b.lastCombatHitAt + INACTIVE_MS);
          b.exiting = true;
          b.targetUid = null;
          b.path = null;
          b.pathGoal = null;
          b.patrol = null;
          b.stuckUid = null;
          b.exitStartedAt = Math.min(t, ...times);
          b.exitProgressAt = t;
          b.exitAnchorX = b.x;
          b.exitAnchorY = b.y;
          b.exitMinDist = Math.hypot(b.spawn.x - b.x, b.spawn.y - b.y);
          triggeredExit = true;
        }
      }
      if (triggeredExit) hits.length = 0;
    }

    const activeBots = [];
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i];
      if (!b.exiting) {
        activeBots.push(b);
        continue;
      }
      if (t - b.exitStartedAt >= EXIT_MAX_MS || !okMap) {
        bots.splice(i--, 1);
        continue;
      }
      const dSpawn = Math.hypot(b.spawn.x - b.x, b.spawn.y - b.y);
      if (dSpawn <= ARRIVE_EPS) {
        bots.splice(i--, 1);
        continue;
      }
      const moveFrom = prevT === null ? b.exitStartedAt : Math.max(prevT, b.exitStartedAt);
      const dtSec = Math.max(0, t - moveFrom) / 1000;
      const oldX = b.x, oldY = b.y;
      const step = moveToward(b, map, b.spawn.x, b.spawn.y, RUN_SPEED * dtSec, t);
      b.x = step.x;
      b.y = step.y;
      const dSpawnAfter = Math.hypot(b.spawn.x - b.x, b.spawn.y - b.y);
      if (dSpawnAfter <= ARRIVE_EPS) {
        bots.splice(i--, 1);
        continue;
      }
      if (step.moved) {
        b.dir = dirOf(b.x - oldX, b.y - oldY);
        b.act = "run";
        if (dSpawnAfter <= b.exitMinDist - 4 || Math.hypot(b.x - b.exitAnchorX, b.y - b.exitAnchorY) >= 8) {
          b.exitMinDist = Math.min(b.exitMinDist, dSpawnAfter);
          b.exitAnchorX = b.x;
          b.exitAnchorY = b.y;
          b.exitProgressAt = t;
        }
      } else {
        b.act = "stand";
      }
      if (t - b.exitProgressAt >= EXIT_STUCK_MS) {
        bots.splice(i--, 1);
      }
    }
    if (activeBots.length === 0) return [];

    if (!okMap) {
      for (const b of activeBots) {
        b.targetUid = null;
        b.act = "stand";
      }
      return [];
    }

    // Dynamic anchor follow
    if (livePlayers.size > 0) {
      const curAnchor = activeBots[0].anchor;
      let followPlayer = null;
      for (let i = hits.length - 1; i >= 0; i--) {
        const p = livePlayers.get(hits[i].tk);
        if (p && safeWalkable(map, p.x, p.y)) {
          followPlayer = p;
          break;
        }
      }
      if (!followPlayer) {
        let bestDist = Infinity;
        for (const p of livePlayers.values()) {
          if (!safeWalkable(map, p.x, p.y)) continue;
          const d = Math.hypot(p.x - curAnchor.x, p.y - curAnchor.y);
          if (d < bestDist) {
            bestDist = d;
            followPlayer = p;
          }
        }
      }
      if (followPlayer && Math.hypot(followPlayer.x - curAnchor.x, followPlayer.y - curAnchor.y) > ANCHOR_FOLLOW_DIST) {
        const newAnchor = { x: followPlayer.x, y: followPlayer.y };
        const newSpawns = pickSpawnsAtAnchor(newAnchor, livePlayers, map, maxBots);
        for (let idx = 0; idx < activeBots.length; idx++) {
          const b = activeBots[idx];
          b.anchor = newAnchor;
          if (newSpawns.length > 0) {
            b.spawn = newSpawns[idx] || newSpawns[idx % newSpawns.length];
          }
          b.path = null;
          b.pathGoal = null;
          if (b.targetUid === null) {
            b.patrol = null;
            b.patrolWaitUntil = t;
          }
        }
      }
    }

    const reserved = new Set();
    for (const b of activeBots) {
      const cur = b.targetUid !== null ? liveMobs.get(b.targetUid) : null;
      if (!cur || !isMobEligible(cur, b, map, t) || reserved.has(cur.uid)) {
        b.targetUid = null;
        b.path = null;
        b.pathGoal = null;
        b.stuckUid = null;
      } else {
        reserved.add(cur.uid);
      }
    }

    const strikes = [];
    const dtSec = justSpawned || prevT === null ? 0 : Math.max(0, t - prevT) / 1000;
    for (const b of activeBots) {
      if (t < b.buffUntil) {
        b.act = "attack";
        continue;
      }
      let target = b.targetUid !== null ? liveMobs.get(b.targetUid) : null;
      if (!target) {
        const picked = pickTarget(liveMobs, b, map, reserved, t);
        if (picked) {
          target = picked.mob;
          b.targetUid = target.uid;
          b.patrol = null;
          b.patrolWaitUntil = null;
          if (picked.path) {
            b.path = picked.path;
            b.pathGoal = { x: target.x, y: target.y };
            b.pathAt = t;
          } else {
            b.path = null;
            b.pathGoal = null;
          }
          reserved.add(target.uid);
        }
      }

      if (!target) {
        b.stuckUid = null;
        if (t < b.atkAnimUntil) {
          b.act = "attack";
          continue;
        }
        if (!b.patrol) {
          if (b.patrolWaitUntil === null) {
            b.patrolWaitUntil = t + patrolPauseMs(b.id, b.patrolSeq);
            b.act = "stand";
            continue;
          }
          if (t < b.patrolWaitUntil) {
            b.act = "stand";
            continue;
          }
          const otherBots = activeBots.filter((o) => o !== b);
          const chosenPatrol = pickPatrolPoint(b, otherBots, livePlayers, map);
          if (!chosenPatrol) {
            b.patrolSeq += 1;
            b.patrolWaitUntil = t + patrolPauseMs(b.id, b.patrolSeq);
            b.act = "stand";
            continue;
          }
          b.patrol = chosenPatrol.point;
          b.patrolWaitUntil = null;
          if (chosenPatrol.path) {
            b.path = chosenPatrol.path;
            b.pathGoal = { x: b.patrol.x, y: b.patrol.y };
            b.pathAt = t;
          }
        }

        if (Math.hypot(b.patrol.x - b.x, b.patrol.y - b.y) <= PATROL_ARRIVE_EPS) {
          b.patrol = null;
          b.path = null;
          b.pathGoal = null;
          b.patrolSeq += 1;
          b.patrolWaitUntil = t + patrolPauseMs(b.id, b.patrolSeq);
          b.act = "stand";
          continue;
        }

        if (dtSec > 0) {
          const oldX = b.x, oldY = b.y;
          const step = moveToward(b, map, b.patrol.x, b.patrol.y, RUN_SPEED * dtSec, t);
          b.x = step.x;
          b.y = step.y;
          if (step.moved) b.dir = dirOf(b.x - oldX, b.y - oldY);
          if (Math.hypot(b.patrol.x - b.x, b.patrol.y - b.y) <= PATROL_ARRIVE_EPS || !step.moved || step.noPath) {
            b.patrol = null;
            b.path = null;
            b.pathGoal = null;
            b.patrolSeq += 1;
            b.patrolWaitUntil = t + patrolPauseMs(b.id, b.patrolSeq);
            b.act = "stand";
          } else {
            b.act = "run";
          }
        } else {
          b.act = "stand";
        }
        continue;
      }

      const atkRange = getBotRange(botOpts, b.id);
      const stopDist = Math.max(52, atkRange - 15);
      const customCastMs = getBotCastMs(botOpts, b.id);
      const atkCooldown = customCastMs !== null
        ? customCastMs
        : (maxBots > 1 ? ATK_COOLDOWN_MS + ((b.id - 1) % 5) * 90 : ATK_COOLDOWN_MS);
      const atkAnimMs = customCastMs !== null ? customCastMs : ATK_ANIM_MS;

      let dist = Math.hypot(target.x - b.x, target.y - b.y);
      if (b.stuckUid !== target.uid) {
        b.stuckUid = target.uid;
        b.stuckCheckAt = t;
        b.stuckX = b.x;
        b.stuckY = b.y;
        b.stuckBestDist = dist;
      }

      let clearLos = safeClear(map, b.x, b.y, target.x, target.y);
      let canAttackNow = dist <= atkRange && clearLos;
      let moved = false;
      const oldX = b.x, oldY = b.y;

      if (!canAttackNow && dtSec > 0) {
        const maxStep = clearLos ? Math.min(RUN_SPEED * dtSec, Math.max(0, dist - stopDist)) : RUN_SPEED * dtSec;
        const step = moveToward(b, map, target.x, target.y, maxStep, t);
        b.x = step.x;
        b.y = step.y;
        moved = step.moved;
        dist = Math.hypot(target.x - b.x, target.y - b.y);
        clearLos = safeClear(map, b.x, b.y, target.x, target.y);
        canAttackNow = dist <= atkRange && clearLos;

        if (step.noPath) {
          b.skipMobs.set(target.uid, t + SKIP_MOB_MS);
          b.targetUid = null;
          b.path = null;
          b.pathGoal = null;
          b.stuckUid = null;
          b.act = t < b.atkAnimUntil ? "attack" : "stand";
          continue;
        }
        if (!canAttackNow) {
          if (Math.hypot(b.x - b.stuckX, b.y - b.stuckY) >= 8 || b.stuckBestDist - dist >= 10) {
            b.stuckCheckAt = t;
            b.stuckX = b.x;
            b.stuckY = b.y;
            b.stuckBestDist = Math.min(b.stuckBestDist, dist);
          } else if (t - b.stuckCheckAt >= STUCK_TARGET_MS) {
            b.skipMobs.set(target.uid, t + SKIP_MOB_MS);
            b.targetUid = null;
            b.path = null;
            b.pathGoal = null;
            b.stuckUid = null;
            b.act = t < b.atkAnimUntil ? "attack" : "stand";
            continue;
          }
        }
      }

      if (canAttackNow || !moved) {
        b.dir = dirOf(target.x - b.x, target.y - b.y);
      } else {
        b.dir = dirOf(b.x - oldX, b.y - oldY);
      }

      if (canAttackNow) {
        b.stuckCheckAt = t;
        b.stuckX = b.x;
        b.stuckY = b.y;
        b.stuckBestDist = dist;
        if (t - b.lastAtkAt >= atkCooldown) {
          const buff = getBotBuff(botOpts, b.id);
          if (buff) {
            b.atkN += 1;
            b.atkAnimUntil = t + buff.castMs;
            b.buffUntil = t + buff.castMs;
            b.stuckCheckAt = b.buffUntil;
            b.act = "attack";
            strikes.push({ id: b.id, buff: { skillId: buff.skillId, skillLv: buff.skillLv } });
            continue;
          }
          b.atkN += 1;
          b.lastAtkAt = t;
          b.atkAnimUntil = t + atkAnimMs;
          b.act = "attack";
          strikes.push({ id: b.id, uid: target.uid });
          continue;
        }
        b.act = t < b.atkAnimUntil ? "attack" : "stand";
        continue;
      }

      b.act = moved ? "run" : (t < b.atkAnimUntil ? "attack" : "stand");
    }

    return strikes;
  }

  function trangThai() {
    return bots.map((b) => ({ id: b.id, x: b.x, y: b.y, dir: b.dir, act: b.act, atkN: b.atkN }));
  }

  return { ghiDanh, tick, trangThai };
}

function taoBotLuyenCong() {
  const ctrl = taoBoDieuKhien(1);
  return {
    ghiDanh: ctrl.ghiDanh,
    tick(t, nguoi, quai, map, botOpts) {
      const strikes = ctrl.tick(t, nguoi, quai, map, botOpts);
      return strikes.length && strikes[0].uid != null ? strikes[0].uid : null;
    },
    trangThai() {
      const list = ctrl.trangThai();
      if (!list.length) return null;
      const { x, y, dir, act, atkN } = list[0];
      return { x, y, dir, act, atkN };
    },
  };
}

function taoDoiLuyenCong() {
  return taoBoDieuKhien(SQUAD_MAX_BOTS);
}

module.exports = { taoBotLuyenCong, taoDoiLuyenCong };

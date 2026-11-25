#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');

function loadSharp() {
  for (const cand of [
    'sharp',
    process.env.SHARP_PATH,
    '/root/.openclaw/workspace-nim/ielts-practice.TcpJ8JWK/node_modules/sharp',
  ]) {
    if (!cand) continue;
    try { return require(cand); } catch {}
  }
  throw new Error('Unable to resolve sharp module (set SHARP_PATH or install sharp)');
}

const sharp = loadSharp();

const MAP_KEY = 'c152';
const W = 6656;
const H = 3584;
const ORIGIN_X = 93 * 512; // 47616
const ORIGIN_Y = 99 * 512; // 50688
const TILE_SIZE = 768;
const NX = 9;
const NY = 5;
const MINI_W = 555;
const MINI_H = 299;
const HERO_HALF_W = 16;
const HERO_H = 84;
const ALPHA_THRESHOLD = 128;
const DEFAULT_RELEASE_ID = '152-all-occluders-20261124';
const DEFAULT_JPEG_QUALITY = 90;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`Unexpected argument: ${a}`);
    const eq = a.indexOf('=');
    if (eq !== -1) {
      args[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[k] = true;
      else { args[k] = next; i++; }
    }
  }
  return args;
}

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function rawKey(region, recordIndex) {
  return `${region[0]},${region[1]},${recordIndex}`;
}

function projectFlamePosition(xRaw, yRaw, zCandidate, originX, originY) {
  const dstX = xRaw - originX;
  const dstY = (yRaw >> 1) - Math.round((zCandidate * Math.sqrt(3)) / 2) - originY;
  return [dstX, dstY];
}

function normalizeBaseline(ax, ay, bx, by) {
  return ax > bx ? [bx, by, ax, ay] : [ax, ay, bx, by];
}

function wallStripBaseline(vertices, originX, originY) {
  assert.ok(vertices && vertices.v2 && vertices.v3, 'Wall strip missing vertices.v2/v3');
  const ax = vertices.v3[0] - originX;
  const ay = (vertices.v3[1] >> 1) - originY;
  const bx = vertices.v2[0] - originX;
  const by = (vertices.v2[1] >> 1) - originY;
  return normalizeBaseline(ax, ay, bx, by);
}

function baselineY(baseline, wx) {
  const [ax, ay, bx, by] = baseline;
  if (ax === bx) return ay;
  const t = Math.max(0, Math.min(1, (wx - ax) / (bx - ax)));
  return ay + (by - ay) * t;
}

function spriteTemplateName(p) {
  const s = String(p || '');
  const idx = s.lastIndexOf('\\');
  const idx2 = s.lastIndexOf('/');
  return s.slice(Math.max(idx, idx2) + 1);
}

function isPedestalLeftHalf(rec) {
  const p = String(rec.path || '');
  return rec.is_wall_strip && p.includes('building038') && spriteTemplateName(p) === '左.spr';
}

function isBrazierHolder(rec) {
  const p = String(rec.path || '');
  return rec.is_wall_strip && spriteTemplateName(p) === 'building067.spr';
}

function isCaveArchRightHalf(rec) {
  const p = String(rec.path || '');
  return rec.is_wall_strip && spriteTemplateName(p) === '047a.spr' && rec.frame === 1;
}

function isFlameSprite(rec) {
  return !rec.is_wall_strip && rec.flags === 0x006;
}

function boxesOverlap(a, b) {
  return !(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0);
}

// Replicates GameMap connected-components + m.giu retention (src/game/map.js).
function buildRetainedWalkableCells(mapMeta, jmoMeta) {
  assert.ok(mapMeta && jmoMeta, 'index-json missing map or jmo entry');
  const { gw, gh, cw, ch } = jmoMeta;
  const n = gw * gh;
  const obsBytes = Buffer.from(jmoMeta.obs, 'base64');
  const free = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    free[i] = ((obsBytes[i >> 3] >> (i & 7)) & 1) ? 0 : 1;
  }

  const ok = (x, y) => x >= 0 && y >= 0 && x < gw && y < gh && free[y * gw + x] === 1;
  const comp = new Int32Array(n).fill(-1);
  const sizes = [];
  const q = new Int32Array(n);

  for (let s = 0; s < n; s++) {
    if (!free[s] || comp[s] >= 0) continue;
    const c = sizes.length;
    let head = 0;
    let tail = 0;
    q[tail++] = s;
    comp[s] = c;
    while (head < tail) {
      const i = q[head++];
      const x = i % gw;
      const y = (i / gw) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const X = x + dx;
          const Y = y + dy;
          if (!ok(X, Y)) continue;
          if (dx && dy && !(ok(x + dx, y) && ok(x, y + dy))) continue;
          const ni = Y * gw + X;
          if (comp[ni] < 0) {
            comp[ni] = c;
            q[tail++] = ni;
          }
        }
      }
    }
    sizes.push(tail);
  }

  let giu = new Set([sizes.indexOf(Math.max(...sizes))]);
  if (mapMeta.giu && mapMeta.giu.length) {
    const k = new Set();
    for (const [x, y] of mapMeta.giu) {
      const cx = Math.floor(x / cw);
      const cy = Math.floor(y / ch);
      let bestC = -1;
      let bd = Infinity;
      for (let dy = -24; dy <= 24; dy++) {
        for (let dx = -12; dx <= 12; dx++) {
          const X = cx + dx;
          const Y = cy + dy;
          const d = Math.hypot(dx * cw, dy * ch * 2);
          if (X >= 0 && Y >= 0 && X < gw && Y < gh && free[Y * gw + X] && d < bd) {
            bd = d;
            bestC = comp[Y * gw + X];
          }
        }
      }
      if (bestC >= 0) k.add(bestC);
    }
    if (k.size) giu = k;
  }

  const cells = [];
  for (let i = 0; i < n; i++) {
    if (free[i] && giu.has(comp[i])) {
      const cx = i % gw;
      const cy = (i / gw) | 0;
      cells.push({ cx, cy, wx: (cx + 0.5) * cw, wy: (cy + 0.5) * ch });
    }
  }
  return cells;
}

async function loadRawRgba(filePath, expectedW, expectedH) {
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (expectedW != null) assert.strictEqual(info.width, expectedW, `${filePath} width mismatch`);
  if (expectedH != null) assert.strictEqual(info.height, expectedH, `${filePath} height mismatch`);
  assert.strictEqual(info.channels, 4, `${filePath} expected 4 RGBA channels`);
  return { data, width: info.width, height: info.height };
}

function alphaBlendOver(canvasRgba, canvasW, canvasH, spriteRgba, sw, sh, dstX, dstY) {
  for (let ly = 0; ly < sh; ly++) {
    const ay = dstY + ly;
    if (ay < 0 || ay >= canvasH) continue;
    for (let lx = 0; lx < sw; lx++) {
      const ax = dstX + lx;
      if (ax < 0 || ax >= canvasW) continue;
      const si = (ly * sw + lx) * 4;
      const sa = spriteRgba[si + 3];
      if (sa === 0) continue;
      const di = (ay * canvasW + ax) * 4;
      if (sa === 255) {
        canvasRgba[di] = spriteRgba[si];
        canvasRgba[di + 1] = spriteRgba[si + 1];
        canvasRgba[di + 2] = spriteRgba[si + 2];
        canvasRgba[di + 3] = 255;
      } else {
        const da = canvasRgba[di + 3];
        if (da === 0) {
          canvasRgba[di] = spriteRgba[si];
          canvasRgba[di + 1] = spriteRgba[si + 1];
          canvasRgba[di + 2] = spriteRgba[si + 2];
          canvasRgba[di + 3] = sa;
        } else {
          // Standard Porter-Duff source-over
          const invSa = 255 - sa;
          const outA = sa + Math.round((da * invSa) / 255);
          if (outA > 0) {
            const wSrc = sa * 255;
            const wDst = da * invSa;
            const denom = outA * 255;
            canvasRgba[di] = Math.round((spriteRgba[si] * wSrc + canvasRgba[di] * wDst) / denom);
            canvasRgba[di + 1] = Math.round((spriteRgba[si + 1] * wSrc + canvasRgba[di + 1] * wDst) / denom);
            canvasRgba[di + 2] = Math.round((spriteRgba[si + 2] * wSrc + canvasRgba[di + 2] * wDst) / denom);
            canvasRgba[di + 3] = outA;
          }
        }
      }
    }
  }
}

function flattenOverBlack(rgba, pixelCount) {
  const rgb = Buffer.alloc(pixelCount * 3);
  for (let p = 0; p < pixelCount; p++) {
    const si = p * 4;
    const di = p * 3;
    const a = rgba[si + 3];
    if (a === 255) {
      rgb[di] = rgba[si];
      rgb[di + 1] = rgba[si + 1];
      rgb[di + 2] = rgba[si + 2];
    } else if (a > 0) {
      rgb[di] = Math.round((rgba[si] * a) / 255);
      rgb[di + 1] = Math.round((rgba[si + 1] * a) / 255);
      rgb[di + 2] = Math.round((rgba[si + 2] * a) / 255);
    }
  }
  return rgb;
}

function prepareSec5Placements(sec5Manifest, rawRecords, spriteDimsByPng, cfg) {
  const { originX, originY } = cfg;
  const rawByKey = new Map();
  for (const r of rawRecords) {
    const k = rawKey(r.region, r.record_index);
    assert.ok(!rawByKey.has(k), `Duplicate sec5_raw_records key: ${k}`);
    rawByKey.set(k, r);
  }
  assert.strictEqual(rawByKey.size, sec5Manifest.length,
    `sec5 manifest (${sec5Manifest.length}) and raw records (${rawByKey.size}) count mismatch`);

  const items = sec5Manifest.map((rec) => {
    const k = rawKey(rec.region, rec.record_index);
    const raw = rawByKey.get(k);
    assert.ok(raw, `Missing sec5_raw_records entry for ${k}`);
    assert.strictEqual(raw.head_u32, rec.flags, `head_u32/flags mismatch at ${k}`);
    assert.strictEqual(raw.frame_u16, rec.frame, `frame mismatch at ${k}`);
    assert.strictEqual(raw.spr_path_gbk, rec.path, `spr_path_gbk mismatch at ${k}`);

    const dims = spriteDimsByPng.get(rec.sprite_png);
    assert.ok(dims, `Missing sprite dimensions for ${rec.sprite_png}`);
    const [w, h] = dims;

    let dstX, dstY, baseline = null;
    if (rec.is_wall_strip) {
      dstX = rec.position.dst_x;
      dstY = rec.position.dst_y;
      baseline = wallStripBaseline(rec.vertices, originX, originY);
    } else {
      assert.strictEqual(rec.flags, 0x006, `Non-wall-strip sec5 unexpected flags=${rec.flags} at ${k}`);
      [dstX, dstY] = projectFlamePosition(raw.x_raw, raw.y_raw, raw.z_candidate, originX, originY);
    }

    return {
      key: k,
      rec,
      raw,
      w,
      h,
      dstX,
      dstY,
      box: { x0: dstX, y0: dstY, x1: dstX + w, y1: dstY + h },
      baseline,
      renderRank: rec.draw_seq,
      pairedHolderDrawSeq: null,
    };
  });

  // Step 1: Resolve depth inversion between cave arch 047a.spr#1 and overlapping building038\左.spr pedestals.
  const pedestals = items.filter((it) => isPedestalLeftHalf(it.rec));
  const pedestalRightHalves = pedestals.filter((it) => it.rec.frame === 1);
  const braziers = items.filter((it) => isBrazierHolder(it.rec));
  const archDepthFixes = [];

  for (const arch of items) {
    if (!isCaveArchRightHalf(arch.rec)) continue;
    const overlapping = pedestals.filter((ped) => {
      if (!boxesOverlap(arch.box, ped.box)) return false;
      const pmx = (ped.baseline[0] + ped.baseline[2]) / 2;
      const pmy = (ped.baseline[1] + ped.baseline[3]) / 2;
      return baselineY(arch.baseline, pmx) < pmy;
    });
    if (overlapping.length > 0) {
      const minPedSeq = Math.min(...overlapping.map((p) => p.rec.draw_seq));
      if (arch.renderRank >= minPedSeq) {
        const oldRank = arch.renderRank;
        arch.renderRank = minPedSeq - 1;
        archDepthFixes.push({
          draw_seq: arch.rec.draw_seq,
          key: arch.key,
          oldRank,
          newRank: arch.renderRank,
          overlappingPedestals: overlapping.map((p) => p.rec.draw_seq),
        });
      }
    }
  }

  // Step 2: Pair each flame to its holder, inherit holder baseline, and order flame after holder.
  const flameFixes = [];
  for (const it of items) {
    if (!isFlameSprite(it.rec)) continue;
    const fcX = it.dstX + it.w / 2;
    const fbY = it.dstY + it.h;
    const tplName = spriteTemplateName(it.rec.path);
    const is10013 = tplName === '1.0013.spr';
    const pool = is10013 ? pedestalRightHalves : braziers;
    assert.ok(pool.length > 0, `No holder pool found for flame ${it.key} (${tplName})`);

    let best = null;
    let bestDist = Infinity;
    for (const h of pool) {
      const hcX = h.dstX + h.w / 2;
      const hbY = h.dstY + 20;
      const d = Math.hypot(fcX - hcX, fbY - hbY);
      if (d < bestDist) {
        bestDist = d;
        best = h;
      }
    }
    assert.ok(best && bestDist < 100, `Flame ${it.key} (${tplName}) nearest holder too far: ${bestDist}`);

    // For building038\左.spr#1 + #0 pedestal, all walkable cells around pedestal lie near/behind the right face (#1),
    // so inheriting the paired #1 half baseline handles front/behind cleanly without dipping at the center apex.
    let holderMaxRank = best.renderRank;
    if (is10013) {
      for (const p of pedestals) {
        if (Math.abs(p.dstX - best.dstX) <= 80 && Math.abs(p.dstY - best.dstY) <= 40) {
          if (p.renderRank > holderMaxRank) holderMaxRank = p.renderRank;
        }
      }
    }

    it.baseline = [...best.baseline];
    it.pairedHolderDrawSeq = best.rec.draw_seq;
    const oldRank = it.renderRank;
    it.renderRank = holderMaxRank + 0.5;
    flameFixes.push({
      draw_seq: it.rec.draw_seq,
      key: it.key,
      template: tplName,
      manifestDst: [it.rec.position.dst_x, it.rec.position.dst_y],
      projectedDst: [it.dstX, it.dstY],
      pairedHolderDrawSeq: best.rec.draw_seq,
      pairDistPx: Number(bestDist.toFixed(2)),
      baseline: it.baseline,
      oldRank,
      newRank: it.renderRank,
    });
  }

  const sorted = [...items].sort((a, b) => (a.renderRank - b.renderRank) || (a.rec.draw_seq - b.rec.draw_seq));
  return { sorted, archDepthFixes, flameFixes };
}

async function buildRelease(opts) {
  const {
    inputDir,
    indexJsonPath,
    outDir,
    releaseId = DEFAULT_RELEASE_ID,
    jpegQuality = DEFAULT_JPEG_QUALITY,
    debugAtlasPath = null,
    cfg = {
      mapKey: MAP_KEY,
      width: W,
      height: H,
      originX: ORIGIN_X,
      originY: ORIGIN_Y,
      tileSize: TILE_SIZE,
      nx: NX,
      ny: NY,
      miniW: MINI_W,
      miniH: MINI_H,
    },
  } = opts;

  const groundPath = path.join(inputDir, 'ground_only.png');
  const manifestPath = path.join(inputDir, 'sprite_manifest.json');
  const rawRecordsPath = path.join(inputDir, 'sec5_raw_records.json');
  const spritesDir = path.join(inputDir, 'sprites');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const rawRecords = JSON.parse(fs.readFileSync(rawRecordsPath, 'utf8'));
  const indexData = JSON.parse(fs.readFileSync(indexJsonPath, 'utf8'));

  const mapMeta = indexData.maps && indexData.maps[cfg.mapKey];
  const jmoMeta = indexData.jmo && indexData.jmo[cfg.mapKey];
  assert.ok(mapMeta && jmoMeta, `Missing maps.${cfg.mapKey} or jmo.${cfg.mapKey} in ${indexJsonPath}`);
  assert.strictEqual(mapMeta.w, cfg.width, 'mapMeta.w mismatch');
  assert.strictEqual(mapMeta.h, cfg.height, 'mapMeta.h mismatch');

  const sec4 = manifest.filter((r) => r.layer === 'sec4_objs').sort((a, b) => a.draw_seq - b.draw_seq);
  const sec5 = manifest.filter((r) => r.layer === 'sec5_walls').sort((a, b) => a.draw_seq - b.draw_seq);
  assert.strictEqual(sec4.length + sec5.length, manifest.length, 'Unexpected layers in sprite_manifest.json');

  // Preload all sprites once into memory (fast & ensures exact same buffers used for composite and ownership).
  const spriteCache = new Map();
  const spriteDimsByPng = new Map();
  for (const rec of manifest) {
    if (spriteCache.has(rec.sprite_png)) continue;
    const raw = await loadRawRgba(path.join(spritesDir, rec.sprite_png));
    spriteCache.set(rec.sprite_png, raw);
    spriteDimsByPng.set(rec.sprite_png, [raw.width, raw.height]);
  }

  const { sorted: sec5Sorted, archDepthFixes, flameFixes } = prepareSec5Placements(
    sec5, rawRecords, spriteDimsByPng, cfg
  );

  // Composite ground -> sec4_objs -> sec5_walls (in renderRank order)
  const ground = await loadRawRgba(groundPath, cfg.width, cfg.height);
  const atlasRgba = Buffer.from(ground.data);

  for (const rec of sec4) {
    const sp = spriteCache.get(rec.sprite_png);
    alphaBlendOver(atlasRgba, cfg.width, cfg.height, sp.data, sp.width, sp.height, rec.position.dst_x, rec.position.dst_y);
  }
  for (const item of sec5Sorted) {
    const sp = spriteCache.get(item.rec.sprite_png);
    alphaBlendOver(atlasRgba, cfg.width, cfg.height, sp.data, sp.width, sp.height, item.dstX, item.dstY);
  }

  const atlasRgb = flattenOverBlack(atlasRgba, cfg.width * cfg.height);
  if (debugAtlasPath) {
    fs.mkdirSync(path.dirname(debugAtlasPath), { recursive: true });
    await sharp(atlasRgb, { raw: { width: cfg.width, height: cfg.height, channels: 3 } })
      .png({ compressionLevel: 6 })
      .toFile(debugAtlasPath);
  }

  // Prepare output dir
  const occOutDir = path.join(outDir, 'occluders');
  fs.rmSync(occOutDir, { recursive: true, force: true });
  fs.mkdirSync(occOutDir, { recursive: true });

  // Slice NX x NY JPEG tiles and decode back into decodedAtlasRgb
  const decodedAtlasRgb = Buffer.alloc(cfg.width * cfg.height * 3);
  const tilesReport = [];
  const shaMap = new Map();

  for (let ty = 0; ty < cfg.ny; ty++) {
    for (let tx = 0; tx < cfg.nx; tx++) {
      const x0 = tx * cfg.tileSize;
      const y0 = ty * cfg.tileSize;
      const tw = Math.min(cfg.tileSize, cfg.width - x0);
      const th = Math.min(cfg.tileSize, cfg.height - y0);
      assert.ok(tw > 0 && th > 0, `Invalid tile dimensions ${tw}x${th} at ${tx}_${ty}`);

      const tileRgb = Buffer.alloc(tw * th * 3);
      for (let ly = 0; ly < th; ly++) {
        const srcOff = ((y0 + ly) * cfg.width + x0) * 3;
        atlasRgb.copy(tileRgb, ly * tw * 3, srcOff, srcOff + tw * 3);
      }

      const tileName = `${tx}_${ty}.jpg`;
      const tilePath = path.join(outDir, tileName);
      await sharp(tileRgb, { raw: { width: tw, height: th, channels: 3 } })
        .jpeg({ quality: jpegQuality, chromaSubsampling: '4:2:0', mozjpeg: false })
        .toFile(tilePath);

      const tileSha = sha256File(tilePath);
      shaMap.set(tileName, tileSha);

      const dec = await sharp(tilePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.strictEqual(dec.info.width, tw, `${tileName} decoded width mismatch`);
      assert.strictEqual(dec.info.height, th, `${tileName} decoded height mismatch`);
      assert.strictEqual(dec.info.channels, 3, `${tileName} decoded channels mismatch`);

      for (let ly = 0; ly < th; ly++) {
        const dstOff = ((y0 + ly) * cfg.width + x0) * 3;
        dec.data.copy(decodedAtlasRgb, dstOff, ly * tw * 3, (ly + 1) * tw * 3);
      }

      tilesReport.push({
        tile: `${tx}_${ty}`,
        file: tileName,
        tx,
        ty,
        originX: x0,
        originY: y0,
        width: tw,
        height: th,
        bytes: fs.statSync(tilePath).size,
        sha256: tileSha,
      });
    }
  }

  // Generate mini.jpg
  const miniPath = path.join(outDir, 'mini.jpg');
  await sharp(atlasRgb, { raw: { width: cfg.width, height: cfg.height, channels: 3 } })
    .resize(cfg.miniW, cfg.miniH)
    .jpeg({ quality: jpegQuality, chromaSubsampling: '4:2:0' })
    .toFile(miniPath);
  const miniMeta = await sharp(miniPath).metadata();
  assert.strictEqual(miniMeta.width, cfg.miniW, 'mini.jpg width mismatch');
  assert.strictEqual(miniMeta.height, cfg.miniH, 'mini.jpg height mismatch');
  const miniSha = sha256File(miniPath);
  shaMap.set('mini.jpg', miniSha);

  // Foreground pixel ownership over sorted sec5_walls
  const owner = new Int32Array(cfg.width * cfg.height).fill(-1);
  for (let sIdx = 0; sIdx < sec5Sorted.length; sIdx++) {
    const item = sec5Sorted[sIdx];
    const sp = spriteCache.get(item.rec.sprite_png);
    for (let ly = 0; ly < sp.height; ly++) {
      const ay = item.dstY + ly;
      if (ay < 0 || ay >= cfg.height) continue;
      for (let lx = 0; lx < sp.width; lx++) {
        const ax = item.dstX + lx;
        if (ax < 0 || ax >= cfg.width) continue;
        if (sp.data[(ly * sp.width + lx) * 4 + 3] >= ALPHA_THRESHOLD) {
          owner[ay * cfg.width + ax] = sIdx;
        }
      }
    }
  }

  // Collect owned bounding box and count per sec5Sorted item
  const ownedStats = Array.from({ length: sec5Sorted.length }, () => ({
    count: 0, minX: cfg.width, minY: cfg.height, maxX: -1, maxY: -1,
  }));
  for (let y = 0; y < cfg.height; y++) {
    const rowOff = y * cfg.width;
    for (let x = 0; x < cfg.width; x++) {
      const o = owner[rowOff + x];
      if (o >= 0) {
        const st = ownedStats[o];
        st.count++;
        if (x < st.minX) st.minX = x;
        if (x > st.maxX) st.maxX = x;
        if (y < st.minY) st.minY = y;
        if (y > st.maxY) st.maxY = y;
      }
    }
  }

  // Retained walkable cells & occluder selection
  const retainedCells = buildRetainedWalkableCells(mapMeta, jmoMeta);
  const atlasW = cfg.width;
  const atlasH = cfg.height;
  const cw = jmoMeta.cw;
  const ch = jmoMeta.ch;
  const selectedSet = new Set();
  for (const { cx, cy } of retainedCells) {
    const wxMin = cx * cw;
    const wxMax = wxMin + cw - 1;
    const wyMin = cy * ch;
    const wyMax = wyMin + ch - 1;
    const bx0 = Math.max(0, Math.floor(wxMin - HERO_HALF_W));
    const bx1 = Math.min(atlasW, Math.ceil(wxMax + HERO_HALF_W));
    const by0 = Math.max(0, Math.floor(wyMin - HERO_H));
    const by1 = Math.min(atlasH, Math.ceil(wyMax));
    const candidates = new Set();
    for (let y = by0; y < by1; y++) {
      const rowOff = y * atlasW;
      for (let x = bx0; x < bx1; x++) {
        const own = owner[rowOff + x];
        if (own >= 0 && !selectedSet.has(own)) {
          candidates.add(own);
        }
      }
    }
    for (const own of candidates) {
      if (selectedSet.has(own)) continue;
      const st = ownedStats[own];
      const baseline = sec5Sorted[own].baseline;
      let hit = false;
      for (let wy = wyMin; wy <= wyMax && !hit; wy = wy === wyMax ? wyMax + 1 : Math.min(wy + 2, wyMax)) {
        const py0 = Math.max(st.minY, 0, Math.floor(wy - HERO_H));
        const py1 = Math.min(st.maxY + 1, atlasH, Math.ceil(wy));
        if (py0 >= py1) continue;
        for (let wx = wxMin; wx <= wxMax && !hit; wx = wx === wxMax ? wxMax + 1 : Math.min(wx + 2, wxMax)) {
          const px0 = Math.max(st.minX, 0, Math.floor(wx - HERO_HALF_W));
          const px1 = Math.min(st.maxX + 1, atlasW, Math.ceil(wx + HERO_HALF_W));
          if (px0 >= px1 || wy >= baselineY(baseline, wx)) continue;
          for (let py = py0; py < py1 && !hit; py++) {
            const rowOff = py * atlasW;
            for (let px = px0; px < px1; px++) {
              if (owner[rowOff + px] === own) {
                hit = true;
                break;
              }
            }
          }
        }
      }
      if (hit) selectedSet.add(own);
    }
  }

  const orderedSelected = Array.from(selectedSet).sort((a, b) => a - b);

  // Emit occluder PNGs and run roundtrip assertions
  const writtenPixelOwner = new Int32Array(cfg.width * cfg.height).fill(-1);
  const outImgs = [];
  const outObjs = [];
  const occludersReport = [];
  const countsByTemplate = {};

  for (let occIdx = 0; occIdx < orderedSelected.length; occIdx++) {
    const sIdx = orderedSelected[occIdx];
    const item = sec5Sorted[sIdx];
    const st = ownedStats[sIdx];
    assert.ok(st.count > 0, `Selected occluder ${item.key} has 0 owned pixels`);

    const x0 = st.minX;
    const y0 = st.minY;
    const w = st.maxX - st.minX + 1;
    const h = st.maxY - st.minY + 1;

    const pngBuf = Buffer.alloc(w * h * 4);
    let written = 0;
    for (let ly = 0; ly < h; ly++) {
      const ay = y0 + ly;
      for (let lx = 0; lx < w; lx++) {
        const ax = x0 + lx;
        const p = ay * cfg.width + ax;
        if (owner[p] !== sIdx) continue;
        const si = (ly * w + lx) * 4;
        const ji = p * 3;
        pngBuf[si] = decodedAtlasRgb[ji];
        pngBuf[si + 1] = decodedAtlasRgb[ji + 1];
        pngBuf[si + 2] = decodedAtlasRgb[ji + 2];
        pngBuf[si + 3] = 255;
        written++;
      }
    }
    assert.strictEqual(written, st.count, `Pixel write mismatch for ${item.key}`);

    const fileName = `occ_${String(occIdx).padStart(4, '0')}.png`;
    const relPath = `occluders/${fileName}`;
    const absPath = path.join(occOutDir, fileName);
    await sharp(pngBuf, { raw: { width: w, height: h, channels: 4 } })
      .png({ compressionLevel: 6 })
      .toFile(absPath);

    const readBack = await loadRawRgba(absPath, w, h);
    let readOpaque = 0;
    for (let ly = 0; ly < h; ly++) {
      const ay = y0 + ly;
      for (let lx = 0; lx < w; lx++) {
        const ax = x0 + lx;
        const si = (ly * w + lx) * 4;
        const a = readBack.data[si + 3];
        assert.ok(a === 0 || a === 255, `${relPath} non-binary alpha ${a}`);
        if (a === 255) {
          const p = ay * cfg.width + ax;
          assert.strictEqual(writtenPixelOwner[p], -1,
            `Overlap at (${ax},${ay}) between ${writtenPixelOwner[p]} and ${occIdx}`);
          writtenPixelOwner[p] = occIdx;
          const ji = p * 3;
          assert.strictEqual(readBack.data[si], decodedAtlasRgb[ji], `${relPath} R mismatch`);
          assert.strictEqual(readBack.data[si + 1], decodedAtlasRgb[ji + 1], `${relPath} G mismatch`);
          assert.strictEqual(readBack.data[si + 2], decodedAtlasRgb[ji + 2], `${relPath} B mismatch`);
          readOpaque++;
        } else {
          assert.strictEqual(readBack.data[si], 0, `${relPath} transparent pixel non-zero R`);
          assert.strictEqual(readBack.data[si + 1], 0, `${relPath} transparent pixel non-zero G`);
          assert.strictEqual(readBack.data[si + 2], 0, `${relPath} transparent pixel non-zero B`);
        }
      }
    }
    assert.strictEqual(readOpaque, st.count, `${relPath} roundtrip opaque count mismatch`);

    const occSha = sha256File(absPath);
    shaMap.set(relPath, occSha);
    outImgs.push([relPath, w, h]);
    outObjs.push([occIdx, x0, y0, item.baseline[0], item.baseline[1], item.baseline[2], item.baseline[3]]);

    const tpl = spriteTemplateName(item.rec.path);
    countsByTemplate[tpl] = (countsByTemplate[tpl] || 0) + 1;

    occludersReport.push({
      occIndex: occIdx,
      file: relPath,
      key: item.key,
      drawSeq: item.rec.draw_seq,
      renderRank: item.renderRank,
      flags: item.rec.flags,
      headU32: '0x' + item.rec.flags.toString(16).padStart(8, '0'),
      template: tpl,
      sprName: tpl,
      frame: item.rec.frame,
      bounds: [x0, y0, x0 + w, y0 + h],
      baseline: item.baseline,
      width: w,
      height: h,
      opaquePixels: readOpaque,
      sha256: occSha,
    });
  }

  const objectsPath = path.join(outDir, 'objects.json');
  fs.writeFileSync(objectsPath, JSON.stringify({ imgs: outImgs, objs: outObjs }));
  const objectsSha = sha256File(objectsPath);
  shaMap.set('objects.json', objectsSha);

  const totalOpaquePixels = occludersReport.reduce((s, o) => s + o.opaquePixels, 0);
  const report = {
    releaseId,
    mapKey: cfg.mapKey,
    atlas: {
      width: cfg.width,
      height: cfg.height,
      originX: cfg.originX,
      originY: cfg.originY,
      tileSize: cfg.tileSize,
      nx: cfg.nx,
      ny: cfg.ny,
      totalTiles: tilesReport.length,
      jpegQuality,
    },
    counts: {
      sec4Objs: sec4.length,
      sec5Walls: sec5.length,
      flames: flameFixes.length,
      retainedWalkableCells: retainedCells.length,
      selectedOccluders: occludersReport.length,
      totalOpaquePixels,
      byTemplate: countsByTemplate,
    },
    drawOrderFixes: {
      caveArchDepthFixes: archDepthFixes,
      flameOrderingFixes: flameFixes,
    },
    assertions: {
      rawMatched1to1: true,
      tileCountMatched: tilesReport.length === cfg.nx * cfg.ny,
      binaryAlphaOnly: true,
      transparentRgbZero: true,
      zeroPixelOverlap: true,
      allPngRgbEqualDecodedTiles: true,
    },
    mini: {
      file: 'mini.jpg',
      width: cfg.miniW,
      height: cfg.miniH,
      bytes: fs.statSync(miniPath).size,
      sha256: miniSha,
    },
    objectsJson: {
      file: 'objects.json',
      imgsCount: outImgs.length,
      objsCount: outObjs.length,
      sha256: objectsSha,
    },
    tiles: tilesReport,
    occluders: occludersReport,
  };

  const reportPath = path.join(outDir, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  const reportSha = sha256File(reportPath);
  shaMap.set('report.json', reportSha);

  const shaLines = Array.from(shaMap.keys())
    .sort()
    .map((rel) => `${shaMap.get(rel)}  ${rel}`);
  const shaPath = path.join(outDir, 'sha256sums.txt');
  fs.writeFileSync(shaPath, shaLines.join('\n') + '\n');

  return {
    ok: true,
    releaseId,
    outDir,
    tiles: tilesReport.length,
    sec4Objs: sec4.length,
    sec5Walls: sec5.length,
    flames: flameFixes.length,
    archDepthFixes: archDepthFixes.length,
    retainedWalkableCells: retainedCells.length,
    selectedOccluders: occludersReport.length,
    totalOpaquePixels,
    countsByTemplate,
    objectsSha256: objectsSha,
    reportSha256: reportSha,
    sha256Count: shaLines.length,
  };
}

async function writeRgbaPng(filePath, w, h, fillFn) {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = fillFn(x, y);
      const i = (y * w + x) * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = a;
    }
  }
  await sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toFile(filePath);
}

async function runSelfTest() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'c152-selftest-'));
  try {
    const inputDir = path.join(tmpRoot, 'input');
    const spritesDir = path.join(inputDir, 'sprites');
    const outDir = path.join(tmpRoot, 'out');
    fs.mkdirSync(spritesDir, { recursive: true });

    // Synthetic atlas 1600x900 (covers 3x2 tiles at 768x768, testing right/bottom clipped edge tiles 64x768 & 768x132 & 64x132)
    const sCfg = {
      mapKey: 'c152',
      width: 1600,
      height: 900,
      originX: 47616,
      originY: 50688,
      tileSize: 768,
      nx: 3,
      ny: 2,
      miniW: 160,
      miniH: 90,
    };

    // (a) Verify exact projection formula directly
    assert.deepStrictEqual(projectFlamePosition(47800, 50688 * 2 + 400, 100, 47616, 50688), [184, 113]);
    assert.deepStrictEqual(baselineY([100, 200, 200, 300], 50), 200);
    assert.deepStrictEqual(baselineY([100, 200, 200, 300], 150), 250);
    assert.deepStrictEqual(baselineY([100, 200, 200, 300], 250), 300);
    assert.deepStrictEqual(normalizeBaseline(200, 300, 100, 200), [100, 200, 200, 300]);

    // Ground image (dark cave floor)
    await writeRgbaPng(path.join(inputDir, 'ground_only.png'), sCfg.width, sCfg.height, () => [20, 25, 30, 255]);

    // Build synthetic sprites:
    // 1) sec4 prop (baked only, never in objects.json)
    await writeRgbaPng(path.join(spritesDir, 's4.png'), 40, 40, () => [80, 80, 90, 255]);
    // 2) brazier holder building067.spr (seq 101) vs inverted flame 10041.spr (seq 100)
    await writeRgbaPng(path.join(spritesDir, 'b067.png'), 46, 68, () => [120, 100, 80, 255]);
    await writeRgbaPng(path.join(spritesDir, 'flame_brazier.png'), 18, 90, () => [255, 180, 40, 255]);
    // 3) pedestal 左#0 (seq 1757) + 左#1 (seq 1756) + 1.0013.spr (seq 1762) + cave arch 047a.spr#1 (seq 1763)
    await writeRgbaPng(path.join(spritesDir, 'ped0.png'), 31, 126, () => [110, 110, 140, 255]);
    await writeRgbaPng(path.join(spritesDir, 'ped1.png'), 54, 126, () => [130, 130, 160, 255]);
    await writeRgbaPng(path.join(spritesDir, 'flame_ped.png'), 106, 185, () => [255, 220, 70, 255]);
    await writeRgbaPng(path.join(spritesDir, 'arch.png'), 233, 317, () => [70, 85, 95, 255]);

    // Place fixtures around (x=400..700, y=300..650):
    // Brazier holder at (300, 350), baseline [300, 412, 346, 412]
    // Brazier flame projected dst: (314, 290), center (323, 380) -> near holder (323, 370)
    const ox = sCfg.originX;
    const oy = sCfg.originY;
    const flame1Z = 100;
    const flame1XRaw = ox + 314;
    const flame1YRaw = (oy + 290 + Math.round((flame1Z * Math.sqrt(3)) / 2)) * 2;

    // Pedestal right half #1 at (598, 423), bl [598, 537, 652, 510]
    // Pedestal left half #0 at (567, 423), bl [567, 522, 598, 537]
    // Cave arch 047a#1 at (367, 288) w=233 h=317 -> overlaps ped #0 (and behind ped: bl [367, 604, 600, 511])
    // Pedestal flame 1.0013 at projected (543, 293), overlaps both ped and arch!
    const flame2Z = 298;
    const flame2XRaw = ox + 543;
    const flame2YRaw = (oy + 293 + Math.round((flame2Z * Math.sqrt(3)) / 2)) * 2;

    const manifest = [
      {
        draw_seq: 50,
        layer: 'sec4_objs',
        region: [93, 99],
        record_index: 0,
        path: '\\sec4\\01.spr',
        frame: 0,
        flags: 512,
        is_wall_strip: false,
        position: { dst_x: 100, dst_y: 100 },
        vertices: null,
        sprite_png: 's4.png',
      },
      {
        draw_seq: 100,
        layer: 'sec5_walls',
        region: [93, 99],
        record_index: 0,
        path: '\\火\\10041.spr',
        frame: 1,
        flags: 6,
        is_wall_strip: false,
        position: { dst_x: 999, dst_y: 999 }, // deliberately stale to verify projection override
        vertices: { v0: null, v1: null, v2: null, v3: null },
        sprite_png: 'flame_brazier.png',
      },
      {
        draw_seq: 101,
        layer: 'sec5_walls',
        region: [93, 99],
        record_index: 1,
        path: '\\building067.spr',
        frame: 4,
        flags: 263,
        is_wall_strip: true,
        position: { dst_x: 300, dst_y: 350 },
        vertices: {
          v2: [ox + 346, (oy + 412) * 2, 0],
          v3: [ox + 300, (oy + 412) * 2, 0],
        },
        sprite_png: 'b067.png',
      },
      {
        draw_seq: 1756,
        layer: 'sec5_walls',
        region: [97, 101],
        record_index: 9,
        path: '\\building038\\左.spr',
        frame: 1,
        flags: 263,
        is_wall_strip: true,
        position: { dst_x: 598, dst_y: 423 },
        vertices: {
          v2: [ox + 652, (oy + 510) * 2, -43],
          v3: [ox + 598, (oy + 537) * 2, -12],
        },
        sprite_png: 'ped1.png',
      },
      {
        draw_seq: 1757,
        layer: 'sec5_walls',
        region: [97, 101],
        record_index: 10,
        path: '\\building038\\左.spr',
        frame: 0,
        flags: 263,
        is_wall_strip: true,
        position: { dst_x: 567, dst_y: 423 },
        vertices: {
          v2: [ox + 598, (oy + 537) * 2, -12],
          v3: [ox + 567, (oy + 522) * 2, -30],
        },
        sprite_png: 'ped0.png',
      },
      {
        draw_seq: 1762,
        layer: 'sec5_walls',
        region: [97, 100],
        record_index: 0,
        path: '\\火\\1.0013.spr',
        frame: 5,
        flags: 6,
        is_wall_strip: false,
        position: { dst_x: 999, dst_y: 999 }, // deliberately stale
        vertices: { v0: null, v1: null, v2: null, v3: null },
        sprite_png: 'flame_ped.png',
      },
      {
        draw_seq: 1763,
        layer: 'sec5_walls',
        region: [97, 101],
        record_index: 8,
        path: '\\洞口\\047a.spr',
        frame: 1,
        flags: 279,
        is_wall_strip: true,
        position: { dst_x: 367, dst_y: 288 },
        vertices: {
          v2: [ox + 600, (oy + 511) * 2, -107],
          v3: [ox + 367, (oy + 604) * 2, 0],
        },
        sprite_png: 'arch.png',
      },
    ];

    const rawRecords = [
      { region: [93, 99], record_index: 0, head_u32: 6, x_raw: flame1XRaw, y_raw: flame1YRaw, z_candidate: flame1Z, spr_path_gbk: '\\火\\10041.spr', frame_u16: 1 },
      { region: [93, 99], record_index: 1, head_u32: 263, x_raw: ox + 300, y_raw: (oy + 412) * 2, z_candidate: 0, spr_path_gbk: '\\building067.spr', frame_u16: 4 },
      { region: [97, 101], record_index: 9, head_u32: 263, x_raw: ox + 598, y_raw: (oy + 537) * 2, z_candidate: 0, spr_path_gbk: '\\building038\\左.spr', frame_u16: 1 },
      { region: [97, 101], record_index: 10, head_u32: 263, x_raw: ox + 567, y_raw: (oy + 522) * 2, z_candidate: 0, spr_path_gbk: '\\building038\\左.spr', frame_u16: 0 },
      { region: [97, 100], record_index: 0, head_u32: 6, x_raw: flame2XRaw, y_raw: flame2YRaw, z_candidate: flame2Z, spr_path_gbk: '\\火\\1.0013.spr', frame_u16: 5 },
      { region: [97, 101], record_index: 8, head_u32: 279, x_raw: ox + 367, y_raw: (oy + 604) * 2, z_candidate: 0, spr_path_gbk: '\\洞口\\047a.spr', frame_u16: 1 },
    ];

    // Grid 50x56 at 32x16 -> 1600x896 (use gw=50, gh=57 -> cover walk cells behind every fixture)
    const gw = 50, gh = 57, cw = 32, ch = 16;
    const obsBytes = Buffer.alloc(Math.ceil((gw * gh) / 8), 0xff); // all blocked initially
    const setFree = (cx, cy) => {
      const i = cy * gw + cx;
      obsBytes[i >> 3] &= ~(1 << (i & 7));
    };
    // Make a connected walkable strip behind all fixtures: y in [340..490] -> cy in [21..30], x in [280..680] -> cx in [8..21]
    for (let cy = 21; cy <= 30; cy++) for (let cx = 8; cx <= 21; cx++) setFree(cx, cy);

    const indexJsonPath = path.join(tmpRoot, 'index.json');
    fs.writeFileSync(indexJsonPath, JSON.stringify({
      maps: { c152: { w: sCfg.width, h: sCfg.height, giu: [[320, 392]] } },
      jmo: { c152: { gw, gh, cw, ch, obs: obsBytes.toString('base64') } },
    }));
    fs.writeFileSync(path.join(inputDir, 'sprite_manifest.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(inputDir, 'sec5_raw_records.json'), JSON.stringify(rawRecords));

    const summary = await buildRelease({
      inputDir,
      indexJsonPath,
      outDir,
      releaseId: 'self-test-c152',
      jpegQuality: 90,
      cfg: sCfg,
    });

    const report = JSON.parse(fs.readFileSync(path.join(outDir, 'report.json'), 'utf8'));
    const objectsJson = JSON.parse(fs.readFileSync(path.join(outDir, 'objects.json'), 'utf8'));
    const shaLines = fs.readFileSync(path.join(outDir, 'sha256sums.txt'), 'utf8').trim().split('\n');

    // Verify draw-order fixes
    assert.strictEqual(report.drawOrderFixes.caveArchDepthFixes.length, 1, 'Expected 1 cave arch depth fix');
    assert.strictEqual(report.drawOrderFixes.caveArchDepthFixes[0].draw_seq, 1763);
    assert.ok(report.drawOrderFixes.caveArchDepthFixes[0].newRank < 1756);

    const occBySeq = new Map(report.occluders.map((o) => [o.drawSeq, o]));
    assert.ok(occBySeq.has(100) && occBySeq.has(101), 'Both brazier flame and holder selected');
    assert.ok(occBySeq.get(100).occIndex > occBySeq.get(101).occIndex, 'Flame 100 must draw after holder 101');
    assert.deepStrictEqual(occBySeq.get(100).baseline, [300, 412, 346, 412]);

    assert.ok(occBySeq.has(1763) && occBySeq.has(1757) && occBySeq.has(1756) && occBySeq.has(1762));
    assert.ok(occBySeq.get(1763).occIndex < occBySeq.get(1756).occIndex, 'Arch 1763 must draw before ped 1756');
    assert.ok(occBySeq.get(1756).occIndex < occBySeq.get(1762).occIndex, 'Ped 1756 must draw before flame 1762');
    assert.ok(occBySeq.get(1757).occIndex < occBySeq.get(1762).occIndex, 'Ped 1757 must draw before flame 1762');
    assert.deepStrictEqual(occBySeq.get(1762).baseline, [598, 537, 652, 510], '1.0013 inherits ped #1 baseline');

    // Verify edge tiles & sha256sums completeness
    const edgeTile = report.tiles.find((t) => t.tile === '2_1');
    assert.strictEqual(edgeTile.width, 64);
    assert.strictEqual(edgeTile.height, 132);
    assert.strictEqual(objectsJson.imgs.length, objectsJson.objs.length);
    assert.strictEqual(shaLines.length, report.tiles.length + 1 + report.occluders.length + 2);

    // Verify sha256sums match actual files
    for (const line of shaLines) {
      const [hex, rel] = line.split('  ');
      assert.strictEqual(sha256File(path.join(outDir, rel)), hex, `sha256 mismatch for ${rel}`);
    }

    return { ok: true, selfTest: true, ...summary };
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args['self-test']) {
    const res = await runSelfTest();
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  for (const req of ['input-dir', 'index-json', 'out-dir']) {
    if (!args[req] || args[req] === true) throw new Error(`Missing required --${req}`);
  }

  const jpegQuality = args['jpeg-quality'] !== undefined ? Number(args['jpeg-quality']) : DEFAULT_JPEG_QUALITY;
  assert.ok(Number.isInteger(jpegQuality) && jpegQuality >= 1 && jpegQuality <= 100, 'Invalid --jpeg-quality');

  const res = await buildRelease({
    inputDir: path.resolve(args['input-dir']),
    indexJsonPath: path.resolve(args['index-json']),
    outDir: path.resolve(args['out-dir']),
    releaseId: typeof args['release-id'] === 'string' ? args['release-id'] : DEFAULT_RELEASE_ID,
    jpegQuality,
    debugAtlasPath: typeof args['debug-atlas'] === 'string' ? path.resolve(args['debug-atlas']) : null,
  });
  console.log(JSON.stringify(res, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}

module.exports = {
  projectFlamePosition,
  normalizeBaseline,
  wallStripBaseline,
  baselineY,
  buildRetainedWalkableCells,
  prepareSec5Placements,
  buildRelease,
};

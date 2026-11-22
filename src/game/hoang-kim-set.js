// Legacy provenance sha256: 1299e6cdcc51e289b07fc6e6b8af71ce62fb60589105a95916efe11e8d2c25f0
// Engine parity: counts living equipped slots per extGroup (KItemList::CheckExtEquipSuite, no sid dedup),
// takes global max tier across groups (KItemList::GetExtActiveCount, NotifyExtSuiteChange global gold/platina).
// Idle differences: skips broken (ben === 0) and unridden Horse (!riding) per ItemDB.equipStats;
// omits engine fallback=10 for missing/nonpositive extThresholds (left to importer/opt-in boundary).
// ponytail: assumes fixed 2-tier extThresholds [t1, t2]; generalize loop if >2 tiers added.

const isPosInt = (v) => Number.isInteger(v) && v > 0;

export function mocHoangKimMoRong(equip, setOf, riding = false) {
  if (!equip || typeof equip !== "object" || typeof setOf !== "function") return 0;

  const groups = new Map();
  for (const [slot, it] of Object.entries(equip)) {
    if (!it || !it.k || it.ben === 0 || (slot === "Horse" && !riding)) continue;
    const meta = setOf(it.k);
    if (!meta || typeof meta !== "object") continue;
    const { extGroup, extThresholds } = meta;
    if (
      !isPosInt(extGroup) ||
      !Array.isArray(extThresholds) ||
      extThresholds.length !== 2 ||
      !isPosInt(extThresholds[0]) ||
      !isPosInt(extThresholds[1])
    ) {
      continue;
    }
    let g = groups.get(extGroup);
    if (!g) {
      g = { n: 0, t1: extThresholds[0], t2: extThresholds[1] };
      groups.set(extGroup, g);
    }
    g.n += 1;
  }

  let maxTier = 0;
  for (const { n, t1, t2 } of groups.values()) {
    if (n >= t2) return 2;
    if (n >= t1) maxTier = 1;
  }
  return maxTier;
}

/* ============================================================
   DK2D - 战术信条（Doctrine）技能树
   参考 Door Kickers 1 的 Doctrine 系统：
   - 三棵树按【武器类别】划分：手枪系 / 长枪系 / 破门系
   - 效果对【全队所有队员】生效，不是单个队员养成
   - 点数来自小队等级：每升 1 级得 1 点，等级上限 21
   - 节点有前置节点，部分节点还要求"该树已投入 N 点"
   ============================================================ */

const DOCTRINE = {};

DOCTRINE.MAX_LEVEL = 21;
DOCTRINE.XP_PER_LEVEL = 200;
DOCTRINE.SAVE_KEY = 'dk2d_doctrine';

DOCTRINE.TREES = {
  pistol:  { id: 'pistol',  name: '手枪系', short: '手枪', color: '#ffd479',
             desc: '手枪（含副武器）的射击技巧。任何职业只要拿手枪就自动生效。' },
  longgun: { id: 'longgun', name: '长枪系', short: '长枪', color: '#7fc8ff',
             desc: '步枪 / 冲锋枪 / 机枪 / 精确射手步枪。' },
  breach:  { id: 'breach',  name: '破门系', short: '破门', color: '#8fe08f',
             desc: '破门、拆弹、换弹等战场技能。' }
};

/* ------------------------------------------------------------
   效果字段（由 DOCTRINE.mods() 聚合，未解锁时全是中性值）
   pistol / longgun:
     aimMulNear + nearDist   近距离瞄准时间倍率
     aimMulFar  + farDist    远距离瞄准时间倍率
     accAdd                  全距离精度加成
     accAddMid + midLo/midHi 中距离精度加成
     accAddFar               远距离精度加成
     accAddCover             在掩体后精度加成
     shotsAdd                每次扣扳机连发数加成
     backstabCrit            对未察觉目标的暴击率加成
     negateCover             削减目标掩体减伤的系数（0.5 = 减半）
     mozambique              手枪第三发命中必暴击
     turnMul + closeDist     极近距离转向速度倍率
   breach:
     breachTimeMul / defuseTimeMul / reloadTimeMul / breachNoiseMul
     oneShotBreach           破门霰弹一枪击破上锁门
   global:
     reactMul                反应时间倍率
     autoTransition          主武器打空自动切副武器
     silencedNoiseMul        消音武器开火噪音倍率
   ------------------------------------------------------------ */
DOCTRINE.NODES = [
  /* ===== 手枪系 ===== */
  { id: 'ps', tree: 'pistol', tier: 1, name: '近距速射', req: [], reqPoints: 0,
    desc: '手枪在 9m 内瞄准时间 -20%',
    eff: { pistol: { aimMulNear: 0.80, nearDist: 9 } } },
  { id: 'surg', tree: 'pistol', tier: 1, name: '精准射击', req: [], reqPoints: 0,
    desc: '手枪全距离精度 +8',
    eff: { pistol: { accAdd: 8 } } },
  { id: 'qd', tree: 'pistol', tier: 1, name: '快速拔枪', req: [], reqPoints: 0,
    desc: '全武器反应时间 -15%（更快进入开火状态）',
    eff: { global: { reactMul: 0.85 } } },
  { id: 'dt', tree: 'pistol', tier: 2, name: '双击', req: ['ps'], reqPoints: 0,
    desc: '手枪每次扣扳机多打 2 发',
    eff: { pistol: { shotsAdd: 2 } } },
  { id: 'lrhg', tree: 'pistol', tier: 2, name: '长距训练·手枪', req: ['surg'], reqPoints: 0,
    desc: '手枪在 9m 外精度 +12、瞄准时间 -15%',
    eff: { pistol: { accAddFar: 12, aimMulFar: 0.85, farDist: 9 } } },
  { id: 'moz', tree: 'pistol', tier: 3, name: '莫桑比克', req: ['dt', 'lrhg'], reqPoints: 0,
    desc: '手枪连续命中同一目标时，第 3 发必定暴击',
    eff: { pistol: { mozambique: true } } },
  { id: 'carhg', tree: 'pistol', tier: 3, name: '贴身轴线', req: [], reqPoints: 2,
    desc: '手枪在 4m 内转向速度 ×1.8（贴脸也能快速转枪口）',
    eff: { pistol: { turnMul: 1.8, closeDist: 4 } } },

  /* ===== 长枪系 ===== */
  { id: 'ce', tree: 'longgun', tier: 1, name: '近距交战', req: [], reqPoints: 0,
    desc: '长枪在 10m 内瞄准时间 -15%',
    eff: { longgun: { aimMulNear: 0.85, nearDist: 10 } } },
  { id: 'mr', tree: 'longgun', tier: 1, name: '中距训练', req: [], reqPoints: 0,
    desc: '长枪在 10~25m 精度 +7',
    eff: { longgun: { accAddMid: 7, midLo: 10, midHi: 25 } } },
  { id: 'bar', tree: 'longgun', tier: 1, name: '依托射击', req: [], reqPoints: 0,
    desc: '自己在掩体后时精度 +9',
    eff: { longgun: { accAddCover: 9 } } },
  { id: 'sw', tree: 'longgun', tier: 2, name: '切换', req: ['ce'], reqPoints: 0,
    desc: '主武器打空时自动切副武器，而不是原地换弹',
    eff: { global: { autoTransition: true } } },
  { id: 'lrlg', tree: 'longgun', tier: 2, name: '长距训练·长枪', req: ['mr'], reqPoints: 0,
    desc: '长枪在 25m 外精度 +12、瞄准时间 -12%',
    eff: { longgun: { accAddFar: 12, aimMulFar: 0.88, farDist: 25 } } },
  { id: 'bs', tree: 'longgun', tier: 3, name: '背刺', req: ['mr'], reqPoints: 0,
    desc: '对尚未察觉你的目标暴击率 +25%',
    eff: { longgun: { backstabCrit: 25 } } },
  { id: 'nc', tree: 'longgun', tier: 3, name: '破掩体', req: ['bar'], reqPoints: 0,
    desc: '目标躲在掩体后时，掩体减伤减半',
    eff: { longgun: { negateCover: 0.5 } } },
  { id: 'gs', tree: 'longgun', tier: 4, name: '静默', req: [], reqPoints: 3,
    desc: '消音武器（噪音 ≤10m）开火噪音再 -50%',
    eff: { global: { silencedNoiseMul: 0.5 } } },

  /* ===== 破门系 ===== */
  { id: 'sa', tree: 'breach', tier: 1, name: '强力撬门', req: [], reqPoints: 0,
    desc: '踹门 / 撬棍 / 断线钳耗时 -25%',
    eff: { breach: { breachTimeMul: 0.75 } } },
  { id: 'eod', tree: 'breach', tier: 1, name: '排爆训练', req: [], reqPoints: 0,
    desc: '拆弹耗时 -30%',
    eff: { breach: { defuseTimeMul: 0.70 } } },
  { id: 'fr', tree: 'breach', tier: 2, name: '快速换弹', req: [], reqPoints: 0,
    desc: '换弹耗时 -30%',
    eff: { breach: { reloadTimeMul: 0.70 } } },
  { id: 'osb', tree: 'breach', tier: 3, name: '一枪破门', req: [], reqPoints: 1,
    desc: '破门霰弹一枪击破上锁的门（默认需要两次）',
    eff: { breach: { oneShotBreach: true } } },
  { id: 'se', tree: 'breach', tier: 4, name: '静默突入', req: [], reqPoints: 2,
    desc: '所有破门噪音 -35%',
    eff: { breach: { breachNoiseMul: 0.65 } } }
];

DOCTRINE.BY_ID = {};
DOCTRINE.NODES.forEach(n => { DOCTRINE.BY_ID[n.id] = n; });

/* ---------- 状态 ---------- */
DOCTRINE.state = { xp: 0, nodes: {} };

DOCTRINE.reset = function () {
  DOCTRINE.state = { xp: 0, nodes: {} };
  DOCTRINE.save();
};

DOCTRINE.load = function () {
  try {
    const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(DOCTRINE.SAVE_KEY) : null;
    const d = raw ? JSON.parse(raw) : null;
    if (d && typeof d === 'object') {
      DOCTRINE.state = {
        xp: Math.max(0, d.xp || 0),
        nodes: (d.nodes && typeof d.nodes === 'object') ? d.nodes : {}
      };
    }
  } catch (e) { /* 存档损坏就重来 */ }
  return DOCTRINE.state;
};

DOCTRINE.save = function () {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DOCTRINE.SAVE_KEY, JSON.stringify(DOCTRINE.state));
    }
  } catch (e) {}
};

/* ---------- 等级 / 点数 ---------- */
DOCTRINE.level = function (xp) {
  const x = (xp === undefined) ? DOCTRINE.state.xp : xp;
  return Math.max(1, Math.min(DOCTRINE.MAX_LEVEL, Math.floor(x / DOCTRINE.XP_PER_LEVEL) + 1));
};
DOCTRINE.xpAtLevel = function (lv) { return (lv - 1) * DOCTRINE.XP_PER_LEVEL; };
DOCTRINE.isMaxLevel = function () { return DOCTRINE.level() >= DOCTRINE.MAX_LEVEL; };

/* 每升 1 级得 1 点；1 级时 0 点 */
DOCTRINE.totalPoints = function () { return DOCTRINE.level() - 1; };
DOCTRINE.spentPoints = function () {
  let n = 0;
  for (const id in DOCTRINE.state.nodes) if (DOCTRINE.state.nodes[id]) n++;
  return n;
};
DOCTRINE.availablePoints = function () { return DOCTRINE.totalPoints() - DOCTRINE.spentPoints(); };

/* 某棵树已投入的点数 */
DOCTRINE.pointsInTree = function (tree) {
  let n = 0;
  DOCTRINE.NODES.forEach(nd => {
    if (nd.tree === tree && DOCTRINE.state.nodes[nd.id]) n++;
  });
  return n;
};

DOCTRINE.owned = function (id) { return !!DOCTRINE.state.nodes[id]; };

/* ---------- 购买 ---------- */
DOCTRINE.canBuy = function (id) {
  const n = DOCTRINE.BY_ID[id];
  if (!n) return { ok: false, reason: '节点不存在' };
  if (DOCTRINE.owned(id)) return { ok: false, reason: '已解锁' };
  if (DOCTRINE.availablePoints() <= 0) return { ok: false, reason: '没有可用点数' };
  for (const r of n.req) {
    if (!DOCTRINE.owned(r)) return { ok: false, reason: '需要先解锁：' + DOCTRINE.BY_ID[r].name };
  }
  if (n.reqPoints > 0 && DOCTRINE.pointsInTree(n.tree) < n.reqPoints) {
    return { ok: false, reason: `需要「${DOCTRINE.TREES[n.tree].name}」已投入 ${n.reqPoints} 点` };
  }
  return { ok: true, reason: '' };
};

DOCTRINE.buy = function (id) {
  const c = DOCTRINE.canBuy(id);
  if (!c.ok) return c;
  DOCTRINE.state.nodes[id] = true;
  DOCTRINE.save();
  return { ok: true, reason: '' };
};

/* 免费重置（对齐 DK1：重置无成本） */
DOCTRINE.refundAll = function () {
  DOCTRINE.state.nodes = {};
  DOCTRINE.save();
};

/* ---------- 经验 ---------- */
/* 返回 { gained, levelBefore, levelAfter, pointsGained } */
DOCTRINE.awardXp = function (n) {
  const before = DOCTRINE.level();
  const gained = Math.max(0, Math.round(n));
  DOCTRINE.state.xp += gained;
  const after = DOCTRINE.level();
  DOCTRINE.save();
  return {
    gained,
    levelBefore: before,
    levelAfter: after,
    pointsGained: Math.max(0, after - before)
  };
};

/* 单次任务的 XP：胜利基础 120 + 每星 40；失败给 40 保底，避免卡死无法成长。
   重复通关同一关只给 30%（对齐 DK1 的刷关机制但不过分）。 */
DOCTRINE.missionXp = function (win, stars, repeat) {
  let xp = win ? (120 + 40 * (stars || 0)) : 40;
  if (repeat) xp = Math.round(xp * 0.3);
  return xp;
};

/* ---------- 武器 → 树 ---------- */
DOCTRINE.treeOfWeapon = function (weaponKey) {
  const w = DATA.WEAPONS[weaponKey];
  if (!w) return null;
  if (w.cls === 'pistol') return 'pistol';
  if (w.cls === 'shotgun') return 'breach';
  return 'longgun';   // assault / smg / marksman / lmg / grenadier
};

/* ---------- 效果聚合 ---------- */
function docNeutral() {
  const g = () => ({
    aimMulNear: 1, nearDist: 0, aimMulFar: 1, farDist: 0,
    accAdd: 0, accAddMid: 0, midLo: 0, midHi: 0, accAddFar: 0, accAddCover: 0,
    shotsAdd: 0, backstabCrit: 0, negateCover: 0,
    mozambique: false, turnMul: 1, closeDist: 0
  });
  return {
    pistol: g(),
    longgun: g(),
    breach: { breachTimeMul: 1, defuseTimeMul: 1, reloadTimeMul: 1, breachNoiseMul: 1, oneShotBreach: false },
    global: { reactMul: 1, autoTransition: false, silencedNoiseMul: 1 },
    owned: {}
  };
}

function docMerge(dst, eff) {
  for (const group in eff) {
    const src = eff[group];
    const tgt = dst[group];
    if (!tgt) continue;
    for (const k in src) {
      const v = src[k];
      if (typeof v === 'number') {
        // 注意：要判「包含 Mul」而不是「以 Mul 结尾」—— aimMulNear / aimMulFar
        // 里的 Mul 在中间，用后缀判断会误走加法分支（1 * 0.8 变成 1 + 0.8）。
        if (k.indexOf('Mul') >= 0) tgt[k] = (tgt[k] === undefined ? 1 : tgt[k]) * v;
        else if (k === 'nearDist' || k === 'farDist' || k === 'midLo' || k === 'midHi' || k === 'closeDist') {
          tgt[k] = Math.max(tgt[k] || 0, v);
        } else {
          tgt[k] = (tgt[k] || 0) + v;
        }
      } else if (typeof v === 'boolean') {
        tgt[k] = !!tgt[k] || v;
      }
    }
  }
}

DOCTRINE.mods = function (state) {
  const st = state || DOCTRINE.state;
  const m = docNeutral();
  for (const n of DOCTRINE.NODES) {
    if (!st.nodes || !st.nodes[n.id]) continue;
    m.owned[n.id] = true;
    docMerge(m, n.eff);
  }
  return m;
};

/* 取某个单位该用哪一组修正（按它当前手里的武器） */
DOCTRINE.unitMod = function (mods, weaponKey) {
  const tree = DOCTRINE.treeOfWeapon(weaponKey);
  if (tree === 'pistol') return mods.pistol;
  if (tree === 'longgun') return mods.longgun;
  return null;   // 霰弹枪走 breach 树，射击修正不吃
};

/* 与其他模块一致：显式挂到 window，便于测试脚本与外部访问 */
window.DOCTRINE = DOCTRINE;

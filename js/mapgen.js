/* ============================================================
   DK2D - 地图生成
   程序化生成建筑平面：外墙、内部隔间、门（含锁门）、窗、
   掩体、可破坏墙、配电箱、出入口。
   使用固定种子 -> 可复现（每次同一任务生成同样地图）
   ============================================================ */
const MAPGEN = {};

MAPGEN.TILE = 32;          // 一格 32px
MAPGEN.ROOM_MIN = 5;
MAPGEN.ROOM_MAX = 11;

/* 简单可复现随机 */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* 格子类型 */
MAPGEN.T = {
  EMPTY: 0,       // 空地/室外
  FLOOR: 1,       // 室内地板
  WALL: 2,        // 实心墙
  DOOR: 3,        // 门（可开/可踹）
  LOCKED: 4,      // 锁门（需工具）
  WINDOW: 5,      // 窗（可破）
  BRWALL: 6,      // 可破坏墙
  COVER: 7,       // 掩体（矮墙/沙袋）
  FURN: 8,        // 家具（阻挡移动+视线）
  LOWCOVER: 9     // 矮掩体（只挡视线一半）
};

MAPGEN.SOLID = new Set([2, 8]);              // 完全阻挡
MAPGEN.BLOCKS_SIGHT = new Set([2, 8]);       // 挡视线（窗/掩体不挡）
MAPGEN.BLOCKS_MOVE = new Set([2, 8, 7]);     // 挡移动（矮掩体不挡）

/* 生成任务地图 */
MAPGEN.generate = function (mission) {
  const rnd = mulberry32(mission.seed);
  const W = mission.gridW || 46;
  const H = mission.gridH || 34;
  const g = { w: W, h: H, tiles: [], rooms: [], doors: [], spawns: [], exits: [], powerBox: null, wallsBreachable: [] };

  for (let y = 0; y < H; y++) {
    g.tiles[y] = [];
    for (let x = 0; x < W; x++) g.tiles[y][x] = MAPGEN.T.EMPTY;
  }

  /* ---- 主建筑矩形 ---- */
  const bw = Math.floor(W * 0.62), bh = Math.floor(H * 0.62);
  const bx = Math.floor((W - bw) / 2) + Math.floor(rnd() * 3) - 1;
  const by = Math.floor((H - bh) / 2) + Math.floor(rnd() * 2);
  g.building = { x: bx, y: by, w: bw, h: bh };

  /* 外墙 */
  for (let y = by; y < by + bh; y++)
    for (let x = bx; x < bx + bw; x++) {
      g.tiles[y][x] = MAPGEN.T.FLOOR;
      if (x === bx || x === bx + bw - 1 || y === by || y === by + bh - 1)
        g.tiles[y][x] = MAPGEN.T.WALL;
    }

  /* ---- 内部房间划分（BSP） ---- */
  const regions = [{ x: bx + 1, y: by + 1, w: bw - 2, h: bh - 2 }];
  const maxRooms = mission.roomCount || 9;
  while (regions.length < maxRooms) {
    // 选最大的切
    regions.sort((a, b) => (b.w * b.h) - (a.w * a.h));
    const r = regions.shift();
    if (r.w < MAPGEN.ROOM_MIN * 2 + 2 && r.h < MAPGEN.ROOM_MIN * 2 + 2) { regions.push(r); break; }
    const horiz = r.w >= r.h ? rnd() < 0.72 : rnd() < 0.28;
    if (horiz && r.w >= MAPGEN.ROOM_MIN * 2 + 2) {
      const cut = MAPGEN.ROOM_MIN + Math.floor(rnd() * (r.w - MAPGEN.ROOM_MIN * 2 - 1));
      // 竖墙
      for (let y = r.y; y < r.y + r.h; y++) g.tiles[y][r.x + cut] = MAPGEN.T.WALL;
      // 开口
      const gaps = 1 + (rnd() < 0.5 ? 1 : 0);
      for (let i = 0; i < gaps; i++) {
        const gy = r.y + 1 + Math.floor(rnd() * (r.h - 2));
        g.tiles[gy][r.x + cut] = rnd() < 0.28 ? MAPGEN.T.DOOR : MAPGEN.T.EMPTY;
      }
      regions.push({ x: r.x, y: r.y, w: cut, h: r.h });
      regions.push({ x: r.x + cut + 1, y: r.y, w: r.w - cut - 1, h: r.h });
    } else if (r.h >= MAPGEN.ROOM_MIN * 2 + 2) {
      const cut = MAPGEN.ROOM_MIN + Math.floor(rnd() * (r.h - MAPGEN.ROOM_MIN * 2 - 1));
      for (let x = r.x; x < r.x + r.w; x++) g.tiles[r.y + cut][x] = MAPGEN.T.WALL;
      const gaps = 1 + (rnd() < 0.5 ? 1 : 0);
      for (let i = 0; i < gaps; i++) {
        const gx = r.x + 1 + Math.floor(rnd() * (r.w - 2));
        g.tiles[r.y + cut][gx] = rnd() < 0.28 ? MAPGEN.T.DOOR : MAPGEN.T.EMPTY;
      }
      regions.push({ x: r.x, y: r.y, w: r.w, h: cut });
      regions.push({ x: r.x, y: r.y + cut + 1, w: r.w, h: r.h - cut - 1 });
    } else { regions.push(r); break; }
  }
  g.rooms = regions.map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h, cleared: false }));

  /* ---- 收集门 ---- */
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const t = g.tiles[y][x];
      if (t === MAPGEN.T.DOOR) g.doors.push({ x, y, open: false, locked: false, broken: false });
    }

  /* ---- 外墙开门（入口） ---- */
  const entrySides = [];
  const nEntries = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < nEntries; i++) {
    const side = Math.floor(rnd() * 4);
    let ex, ey;
    if (side === 0) { ex = bx + 1 + Math.floor(rnd() * (bw - 2)); ey = by; }
    else if (side === 1) { ex = bx + 1 + Math.floor(rnd() * (bw - 2)); ey = by + bh - 1; }
    else if (side === 2) { ex = bx; ey = by + 1 + Math.floor(rnd() * (bh - 2)); }
    else { ex = bx + bw - 1; ey = by + 1 + Math.floor(rnd() * (bh - 2)); }
    if (g.tiles[ey][ex] === MAPGEN.T.WALL) {
      const isLocked = rnd() < 0.25;
      g.tiles[ey][ex] = isLocked ? MAPGEN.T.LOCKED : MAPGEN.T.DOOR;
      g.doors.push({ x: ex, y: ey, open: false, locked: isLocked, broken: false });
      entrySides.push({ x: ex, y: ey });
    }
  }
  g.entries = entrySides;

  /* ---- 窗户（外墙随机开） ---- */
  for (let y = by; y < by + bh; y++)
    for (let x = bx; x < bx + bw; x++) {
      if (g.tiles[y][x] !== MAPGEN.T.WALL) continue;
      const onEdge = (x === bx || x === bx + bw - 1 || y === by || y === by + bh - 1);
      if (!onEdge) continue;
      // 不能是入口
      if (entrySides.some(e => e.x === x && e.y === y)) continue;
      if (rnd() < 0.13) g.tiles[y][x] = MAPGEN.T.WINDOW;
    }

  /* ---- 可破坏墙（每面内墙随机若干段） ---- */
  const nb = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < nb; i++) {
    for (let tries = 0; tries < 40; tries++) {
      const x = bx + 2 + Math.floor(rnd() * (bw - 4));
      const y = by + 2 + Math.floor(rnd() * (bh - 4));
      if (g.tiles[y][x] === MAPGEN.T.WALL && !entrySides.some(e => e.x === x && e.y === y)) {
        g.tiles[y][x] = MAPGEN.T.BRWALL;
        g.wallsBreachable.push({ x, y });
        break;
      }
    }
  }

  /* ---- 室内掩体 / 家具 ---- */
  g.rooms.forEach(r => {
    const n = Math.floor(r.w * r.h / 22);
    for (let i = 0; i < n; i++) {
      const x = r.x + 1 + Math.floor(rnd() * Math.max(1, r.w - 2));
      const y = r.y + 1 + Math.floor(rnd() * Math.max(1, r.h - 2));
      if (g.tiles[y][x] !== MAPGEN.T.FLOOR) continue;
      const roll = rnd();
      if (roll < 0.35) g.tiles[y][x] = MAPGEN.T.COVER;
      else if (roll < 0.6) g.tiles[y][x] = MAPGEN.T.FURN;
      else if (roll < 0.75) g.tiles[y][x] = MAPGEN.T.LOWCOVER;
    }
  });

  /* ---- 配电箱 ---- */
  {
    const r = g.rooms[Math.floor(rnd() * g.rooms.length)];
    const px = r.x + Math.floor(rnd() * r.w);
    const py = r.y + Math.floor(rnd() * r.h);
    if (g.tiles[py] && g.tiles[py][px] === MAPGEN.T.FLOOR) g.powerBox = { x: px, y: py, off: false, time: 0 };
  }
  if (!g.powerBox) {
    for (let y = 1; y < H - 1 && !g.powerBox; y++)
      for (let x = 1; x < W - 1; x++)
        if (g.tiles[y][x] === MAPGEN.T.FLOOR) { g.powerBox = { x, y, off: false, time: 0 }; break; }
  }

  /* ---- 队员出生点（建筑外，且远离建筑外墙至少 2 格） ---- */
  const outPos = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (g.tiles[y][x] !== MAPGEN.T.EMPTY) continue;
    // 必须在建筑外，且与建筑保持距离（避免贴墙生成导致开门即遭遇）
    const edgeDist = Math.min(
      Math.abs(x - bx), Math.abs(x - (bx + bw - 1)),
      Math.abs(y - by), Math.abs(y - (by + bh - 1))
    );
    const insideX = x > bx && x < bx + bw - 1;
    const insideY = y > by && y < by + bh - 1;
    // 真正在建筑外
    const outside = !(x >= bx && x < bx + bw && y >= by && y < by + bh);
    if (!outside) continue;
    if (edgeDist < 1 || edgeDist > 7) continue;
    if (x > 1 && y > 1 && x < W - 2 && y < H - 2) outPos.push({ x, y, edgeDist });
  }
  // 按"离入口近"排序，同距离随机打散
  outPos.sort((a, b) => {
    const da = Math.min(...entrySides.map(e => Math.hypot(e.x - a.x, e.y - a.y))) || 99;
    const db = Math.min(...entrySides.map(e => Math.hypot(e.x - b.x, e.y - b.y))) || 99;
    return (da - db) || (rnd() - 0.5);
  });
  // 挑选出生点：两两之间保持 >=2 格，避免队员叠在一起
  const chosen = [];
  for (const p of outPos) {
    if (chosen.some(c => Math.hypot(c.x - p.x, c.y - p.y) < 2.2)) continue;
    chosen.push(p);
    if (chosen.length >= mission.squadSize) break;
  }
  while (chosen.length < mission.squadSize && outPos.length) {
    const p = outPos[chosen.length];
    if (p && !chosen.some(c => c.x === p.x && c.y === p.y)) chosen.push(p);
    else break;
  }
  g.spawns = chosen.map(p => ({ x: p.x, y: p.y }));
  // 出生区域：以最靠外的出生点为基准，供敌人生成时避让
  g.spawnZone = g.spawns.slice();

  /* ---- 撤离点（室外，与出生点不同侧） ---- */
  const rx = bx + bw + 3 < W - 2 ? bx + bw + 3 : 2;
  const ry = by + Math.floor(bh / 2);
  g.exits.push({ x: Math.max(2, Math.min(W - 3, rx)), y: Math.max(2, Math.min(H - 3, ry)) });

  return g;
};

/* 取格子 */
MAPGEN.at = function (g, x, y) {
  if (x < 0 || y < 0 || x >= g.w || y >= g.h) return MAPGEN.T.WALL;
  return g.tiles[y][x];
};

MAPGEN.isFloorLike = function (g, x, y) {
  const t = MAPGEN.at(g, x, y);
  return t === MAPGEN.T.FLOOR || t === MAPGEN.T.DOOR || t === MAPGEN.T.LOCKED ||
         t === MAPGEN.T.BRWALL || t === MAPGEN.T.LOWCOVER || t === MAPGEN.T.COVER;
};
MAPGEN.canWalk = function (g, x, y) {
  const t = MAPGEN.at(g, x, y);
  if (t === MAPGEN.T.DOOR || t === MAPGEN.T.LOCKED) {
    const d = g.doors.find(d => d.x === x && d.y === y);
    return d ? (d.open || d.broken) : false;
  }
  if (t === MAPGEN.T.WINDOW) return false;
  return !MAPGEN.BLOCKS_MOVE.has(t);
};
MAPGEN.blocksSight = function (g, x, y) {
  const t = MAPGEN.at(g, x, y);
  if (t === MAPGEN.T.WINDOW) return false;
  if (t === MAPGEN.T.DOOR || t === MAPGEN.T.LOCKED) {
    const d = g.doors.find(d => d.x === x && d.y === y);
    return !(d && (d.open || d.broken));
  }
  if (t === MAPGEN.T.LOWCOVER || t === MAPGEN.T.COVER) return false;
  if (t === MAPGEN.T.BRWALL) return true;
  return MAPGEN.BLOCKS_SIGHT.has(t);
};
MAPGEN.coverAt = function (g, x, y) {
  const t = MAPGEN.at(g, x, y);
  if (t === MAPGEN.T.COVER || t === MAPGEN.T.LOWCOVER) return 0.5;
  if (t === MAPGEN.T.FURN) return 0.5;
  return 0;
};

window.DATA = DATA;
window.MAPGEN = MAPGEN;

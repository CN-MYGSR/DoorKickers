/* ============================================================
   DK2D - AI 行为模块
   敌人：idle / patrol / investigate / hunt / engage / flee /
         suicide / execution / sniper / blindfire
   中立：平民（逃跑、蹲下）、人质（跟随、跑向撤离点）、
         要员、HVT（逃跑、被瞄准就停下）
   ============================================================ */

/* ---------- 移动辅助 ---------- */
const EngMove = {};

/* 到达判定阈值。stepTowards 与所有"吞路点"逻辑必须共用同一个常量，
   否则两处阈值一旦不等就会出现「走不到、也不吞点」的永久死区。
   （历史 bug：stepTowards 用 0.25、player.js 用 0.22，相距 0.23 时永久冻结）*/
EngMove.ARRIVE = 0.30;

EngMove.stop = function (u) { u.moving = false; u.moveTarget = null; };

/* ---------- 重寻路无进展看门狗 ----------
   问题：aiHunt/aiInvestigate 里 stuckT > 0.7 就重寻路并把 stuckT 清零，
   如果单位根本走不过去（被卡在角落、门打不开、路径被堵），就会
   「被挡 -> stuckT 涨 -> 重寻路 -> 清零 -> 又被挡」无限循环，
   表现为敌人原地抽搐、永不推进（m02 曾出现 1620 次这样的空转）。
   解法：每次重寻路时记录"历史最近距离"，若连续多次重寻路都没能把这个距离
   推进超过 EPS，就判定为无进展，交由调用方放弃目标。 */
EngMove.WD_EPS = 0.35;        // 至少要比历史最近距离再近这么多，才算有进展
EngMove.WD_MAX_FAIL = 3;      // 连续 3 次重寻路无进展就放弃

EngMove.resetWatchdog = function (u) {
  u._wdBest = undefined;
  u._wdFail = 0;
};

/* 返回 true 表示"判定无进展，应该放弃目标" */
EngMove.noteRepathProgress = function (u, dist) {
  if (u._wdBest === undefined || dist < u._wdBest - EngMove.WD_EPS) {
    // 有实质进展：刷新记录
    u._wdBest = dist;
    u._wdFail = 0;
    return false;
  }
  u._wdFail = (u._wdFail || 0) + 1;
  if (u._wdFail >= EngMove.WD_MAX_FAIL) {
    EngMove.resetWatchdog(u);
    return true;
  }
  return false;
};

/* 朝目标点走一步（简单网格避障）
   返回 true 表示已到达（距离 < EngMove.ARRIVE） */
EngMove.stepTowards = function (sim, u, tx, ty, dt, speedMul) {
  const g = sim.grid;
  const spd = (u.speed || 2.4) * (speedMul || 1) * (u.crouch ? 0.55 : 1);
  let dx = tx - u.x, dy = ty - u.y;
  const d = Math.hypot(dx, dy);
  // 到达阈值与调用方(player.js / aiHunt / aiInvestigate)的判定严格一致
  if (d < EngMove.ARRIVE) { u.moving = false; return true; }
  dx /= d; dy /= d;

  const step = spd * dt;
  // 尝试直走 + 两侧绕行
  const tries = [
    [dx, dy],
    [dx * 0.9 - dy * 0.45, dy * 0.9 + dx * 0.45],
    [dx * 0.9 + dy * 0.45, dy * 0.9 - dx * 0.45],
    [dx * 0.5 - dy * 0.87, dy * 0.5 + dx * 0.87],
    [dx * 0.5 + dy * 0.87, dy * 0.5 - dx * 0.87]
  ];
  for (const [ax, ay] of tries) {
    const nx = u.x + ax * step, ny = u.y + ay * step;
    if (EngMove.passable(g, nx, ny, u) && EngMove.freeOfUnits(sim, nx, ny, u)) {
      u.x = nx; u.y = ny;
      u.moving = true;
      return false;
    }
  }
  // 被单位挡住：侧向让路（不前进但允许平移）
  for (const [ax, ay] of [[-dy, dx], [dy, -dx], [-dy * 0.7, dx * 0.7], [dy * 0.7, -dx * 0.7]]) {
    const nx = u.x + ax * step * 0.8, ny = u.y + ay * step * 0.8;
    if (EngMove.passable(g, nx, ny, u) && EngMove.freeOfUnits(sim, nx, ny, u, 0.5)) {
      u.x = nx; u.y = ny;
      u.moving = true;
      return false;
    }
  }
  // 完全被挡：记录卡住，并尝试自动开门
  u.stuckT = (u.stuckT || 0) + dt;
  if (u.side !== 'player' && !u.action) {
    const dr = EngMove.doorAhead(g, u, tx, ty);
    if (dr) {
      dr.open = true;
      if (dr.locked) dr.broken = true;
      dr.locked = false;
      ENG.makeNoise(sim, dr.x + .5, dr.y + .5, dr.broken ? DATA.NOISE.kickDoor : DATA.NOISE.openDoor, 'door');
    }
  }
  u.moving = false;
  return false;
};

EngMove.passable = function (g, x, y, u) {
  // 圆形碰撞：检查 4 角
  const r = u.radius || 0.34;
  const pts = [[x - r, y - r], [x + r, y - r], [x - r, y + r], [x + r, y + r]];
  for (const [px, py] of pts) {
    const cx = Math.floor(px), cy = Math.floor(py);
    if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) return false;
    if (!MAPGEN.canWalk(g, cx, cy)) return false;
  }
  return true;
};

/* 单位互相避让：返回 true 表示该位置不与其他单位重叠。
   ⚠️ 关键：中立单位（人质/平民/已被捕者）不能当作障碍物，
   否则队员永远无法靠近到 1.4 格内去解救人质 —— 会被"贴在自己身上的人质"
   挡住，路径点永久无法到达（曾导致 m03 全员卡死 420 秒）。 */
EngMove.freeOfUnits = function (sim, x, y, u, minDist) {
  if (!sim || !sim.units) return true;
  const md = minDist !== undefined ? minDist : 0.55;
  for (const o of sim.units) {
    if (o === u || !o.alive) continue;
    // 中立/已逮捕单位可以重叠（要走到它身边才能交互）
    if (o.side === 'neutral' || o.role === 'detained' || o.arrested) continue;
    // 玩家队员之间不做硬阻挡 —— 否则多人挤在门口会互相锁死
    if (u.side === 'player' && o.side === 'player') continue;
    if (Math.hypot(o.x - x, o.y - y) < md) return false;
  }
  return true;
};

/* 玩家队员之间的软推挤：轻微分开避免完全重叠，但不阻塞移动 */
EngMove.pushApart = function (sim, u) {
  if (!sim || !sim.units) return;
  for (const o of sim.units) {
    if (o === u || !o.alive) continue;
    if (o.side !== 'player') continue;
    const d = Math.hypot(o.x - u.x, o.y - u.y);
    const minD = 0.62;
    if (d > 0.001 && d < minD) {
      const push = (minD - d) * 0.5;
      const nx = u.x + (u.x - o.x) / d * push;
      const ny = u.y + (u.y - o.y) / d * push;
      if (EngMove.passable(sim.grid, nx, ny, u)) { u.x = nx; u.y = ny; }
    }
  }
};

/* 检查前方是否是关闭的门 —— 是则返回门对象（用于自动开门） */
EngMove.doorAhead = function (g, u, tx, ty) {
  const ang = Math.atan2(ty - u.y, tx - u.x);
  const px = u.x + Math.cos(ang) * 0.6, py = u.y + Math.sin(ang) * 0.6;
  const cx = Math.floor(px), cy = Math.floor(py);
  const t = MAPGEN.at(g, cx, cy);
  if (t !== MAPGEN.T.DOOR && t !== MAPGEN.T.LOCKED) return null;
  const d = g.doors.find(dd => dd.x === cx && dd.y === cy);
  if (d && !d.open && !d.broken) return d;
  return null;
};

/* BFS 找路径（给追击用，限制步数）
   opts.throughClosedDoors: 把关闭的门当作可通行（代价高），
   用于敌人 AI 穿门追击。玩家队员寻路默认穿透关闭的门（由破门动作处理）。 */
EngMove.findPath = function (g, from, to, maxNodes, opts) {
  opts = opts || {};
  const passDoor = opts.throughClosedDoors !== false;   // 默认允许穿门
  const sx = Math.floor(from.x), sy = Math.floor(from.y);
  const tx = Math.floor(to.x), ty = Math.floor(to.y);
  if (sx === tx && sy === ty) return [{ x: to.x, y: to.y }];

  const inb = (x, y) => x >= 0 && y >= 0 && x < g.w && y < g.h;
  // 通行判定：关门视为"高代价可通行"，避免寻路完全失败
  const cellCost = (x, y) => {
    if (!inb(x, y)) return -1;
    const t = g.tiles[y][x];
    if (t === MAPGEN.T.DOOR || t === MAPGEN.T.LOCKED) {
      const d = g.doors.find(dd => dd.x === x && dd.y === y);
      if (d && (d.open || d.broken)) return 1;
      if (!passDoor) return -1;
      return d && d.locked ? 6 : 4;   // 关门代价高，锁门更高
    }
    if (t === MAPGEN.T.WINDOW) return -1;
    if (t === MAPGEN.T.BRWALL) return 8;   // 可破墙，代价最高
    if (MAPGEN.BLOCKS_MOVE.has(t)) return -1;
    return 1;
  };

  const key = (x, y) => y * g.w + x;
  const startK = key(sx, sy);
  const goalK = key(tx, ty);
  const gScore = new Map([[startK, 0]]);
  const prev = new Map();
  // 简易优先队列（数组按 f 排序，规模小可接受）
  const open = [{ x: sx, y: sy, f: Math.abs(tx - sx) + Math.abs(ty - sy), g: 0 }];
  const closed = new Set();
  let n = 0;
  const limit = maxNodes || 6000;

  while (open.length && n++ < limit) {
    // 取 f 最小
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    const ck = key(cur.x, cur.y);
    if (ck === goalK) {
      const path = [];
      let cx = cur.x, cy = cur.y, k = ck;
      while (k !== startK) {
        path.push({ x: cx + 0.5, y: cy + 0.5 });
        const p = prev.get(k);
        if (!p) break;
        cx = p[0]; cy = p[1]; k = key(cx, cy);
      }
      path.reverse();
      if (path.length) path[path.length - 1] = { x: to.x, y: to.y };
      return path;
    }
    if (closed.has(ck)) continue;
    closed.add(ck);

    const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx, ny = cur.y + dy;
      const c = cellCost(nx, ny);
      if (c < 0) continue;
      // 对角线需两侧正交格都可通行，避免穿墙角
      if (dx !== 0 && dy !== 0) {
        if (cellCost(cur.x + dx, cur.y) < 0 || cellCost(cur.x, cur.y + dy) < 0) continue;
      }
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      const ng = cur.g + c;
      if (gScore.has(nk) && gScore.get(nk) <= ng) continue;
      gScore.set(nk, ng);
      prev.set(nk, [cur.x, cur.y]);
      const h = Math.hypot(tx - nx, ty - ny) * 1.01;
      open.push({ x: nx, y: ny, f: ng + h, g: ng });
    }
  }
  return null;
};

/* ---------- 敌人行为 ---------- */

ENG.aiIdle = function (sim, u, dt) {
  // 站在岗位上，偶尔张望
  u.idleT = (u.idleT || 0) + dt;
  u.moving = false;
  if (u.idleT > 2.4) {
    u.idleT = 0;
    u.scanTarget = u.face + (ENG.rng(sim) - 0.5) * 1.7;
  }
  if (u.scanTarget !== undefined) {
    const d = ENG.angDiff(u.scanTarget, u.face);
    if (Math.abs(d) > 0.05) u.face += Math.sign(d) * Math.min(Math.abs(d), 1.6 * dt);
    else u.scanTarget = undefined;
  }
  // 听到声音 -> 调查
  if (u.state === 'investigate') return;
};

ENG.aiPatrol = function (sim, u, dt) {
  if (!u.patrolPts || !u.patrolPts.length) { ENG.aiIdle(sim, u, dt); return; }
  if (!u.patrolIdx) u.patrolIdx = Math.floor(ENG.rng(sim) * u.patrolPts.length);
  const t = u.patrolPts[u.patrolIdx];
  const done = EngMove.stepTowards(sim, u, t.x, t.y, dt, 0.75);
  ENG.faceTowards(sim, u, t.x, t.y, dt, 2.2);
  if (done || u.stuckT > 2) {
    u.stuckT = 0;
    u.patrolIdx = (u.patrolIdx + 1) % u.patrolPts.length;
    u.pauseT = 1.2;
  }
  if (u.pauseT > 0) { u.pauseT -= dt; u.moving = false; }
};

ENG.aiInvestigate = function (sim, u, dt) {
  if (!u.investigate) { u.state = 'idle'; return; }
  u.investT = (u.investT || 0) + dt;
  const d = Math.hypot(u.investigate.x - u.x, u.investigate.y - u.y);
  if (d > 1.2) {
    const needRepath = !u.path || !u.path.length || (u.stuckT || 0) > 0.7 || (u.pathT || 0) > 2.5;
    if (needRepath) {
      // 无进展看门狗：反复重寻路却始终靠不近 -> 放弃这个声源
      if (EngMove.noteRepathProgress(u, d)) {
        u.state = 'idle'; u.investigate = null; u.investT = 0; u.stuckT = 0;
        EngMove.resetWatchdog(u);
        return;
      }
      u.path = EngMove.findPath(sim.grid, u, u.investigate, 6000);
      u.pathT = 0; u.stuckT = 0;
    }
    u.pathT = (u.pathT || 0) + dt;
    if (u.path && u.path.length) {
      const n = u.path[0];
      const arrived = EngMove.stepTowards(sim, u, n.x, n.y, dt, 0.9);
      ENG.faceTowards(sim, u, n.x, n.y, dt, 3.0);
      if (arrived) u.path.shift();
    } else {
      // 到不了：直接朝声源走（可能被墙挡）
      EngMove.stepTowards(sim, u, u.investigate.x, u.investigate.y, dt, 0.9);
      ENG.faceTowards(sim, u, u.investigate.x, u.investigate.y, dt, 3.0);
      if ((u.stuckT || 0) > 1.5) { u.state = 'idle'; u.investigate = null; u.investT = 0; u.stuckT = 0; }
    }
  } else {
    u.moving = false;
    EngMove.resetWatchdog(u);
    u.scanTarget = u.face + (ENG.rng(sim) - 0.5) * 2.4;
    if (u.investT > 4.5) { u.state = 'idle'; u.investigate = null; u.investT = 0; }
  }
};

ENG.aiHunt = function (sim, u, dt) {
  // 冲向最后已知位置
  if (!u.lastKnown) { u.state = 'idle'; return; }
  const d = Math.hypot(u.lastKnown.x - u.x, u.lastKnown.y - u.y);
  if (d < 1.5) {
    u.huntT = (u.huntT || 0) + dt;
    u.moving = false;
    EngMove.resetWatchdog(u);
    u.scanTarget = u.face + (ENG.rng(sim) - 0.5) * 2.6;
    if (u.huntT > 5) { u.state = 'idle'; u.lastKnown = null; u.huntT = 0; }
    return;
  }
  // 卡住或路径耗尽 -> 重寻路
  const needRepath = !u.path || !u.path.length || (u.stuckT || 0) > 0.7 || (u.pathT || 0) > 2.5;
  if (needRepath) {
    // 无进展看门狗：反复重寻路却始终靠不近目标 -> 放弃，回去站岗
    if (EngMove.noteRepathProgress(u, d)) {
      u.state = 'idle'; u.lastKnown = null; u.huntT = 0; u.stuckT = 0;
      EngMove.resetWatchdog(u);
      return;
    }
    u.path = EngMove.findPath(sim.grid, u, u.lastKnown, 6000);
    u.pathT = 0; u.stuckT = 0;
    if (!u.path || !u.path.length) {
      // 到不了：放弃这个已知位置
      u.state = 'idle'; u.lastKnown = null;
      EngMove.resetWatchdog(u);
      return;
    }
  }
  u.pathT = (u.pathT || 0) + dt;
  if (u.path && u.path.length) {
    const n = u.path[0];
    const arrived = EngMove.stepTowards(sim, u, n.x, n.y, dt, 1.35);
    ENG.faceTowards(sim, u, n.x, n.y, dt, 3.6);
    if (arrived) u.path.shift();
  }
};

ENG.aiEngage = function (sim, u, dt) {
  const t = u.visibleTarget;
  if (!t) return;

  u.lastKnown = { x: t.x, y: t.y };
  const d = ENG.dist(u, t);
  const w = DATA.WEAPONS[u.weapon];

  // 朝向目标
  ENG.faceTowards(sim, u, t.x, t.y, dt, 5.5);

  // 行为分支
  const tag = u.ai || [];

  // 自杀袭击：冲向目标
  if (tag.includes('suicide')) { ENG.aiSuicide(sim, u, dt); return; }

  // 老兵/机枪手：可以盲射 + 找掩体
  if (tag.includes('blindfire') && d > 5 && d < 22) {
    // 尝试走到最近掩体后
    if (!u.coverTarget || u.coverT > 3) {
      u.coverTarget = ENG.findCover(sim, u, t);
      u.coverT = 0;
    }
    u.coverT = (u.coverT || 0) + dt;
    if (u.coverTarget) {
      const dc = Math.hypot(u.coverTarget.x - u.x, u.coverTarget.y - u.y);
      if (dc > 0.6) { EngMove.stepTowards(sim, u, u.coverTarget.x, u.coverTarget.y, dt, 1.15); }
      else {
        u.moving = false;
        u.crouch = true;
        u.coverDir = Math.atan2(t.y - u.y, t.x - u.x) + Math.PI;
        // 盲射
        if (u.cooldownT <= 0 && u.reactionT <= 0) {
          u.blindfire = true;
          ENG.blindShoot(sim, u, t, dt, 0.45);
        }
        return;
      }
    }
  }

  // 佣兵/顾问：侧翼包抄
  if (tag.includes('flank') && d > 7 && ENG.rng(sim) < 0.25 && !u.flankPt) {
    const side = ENG.rng(sim) < 0.5 ? 1 : -1;
    const ang = ENG.angleTo(t, u) + side * 1.1;
    u.flankPt = { x: t.x + Math.cos(ang) * 4, y: t.y + Math.sin(ang) * 4 };
  }
  if (u.flankPt) {
    const df = Math.hypot(u.flankPt.x - u.x, u.flankPt.y - u.y);
    if (df < 1) { u.flankPt = null; } else {
      EngMove.stepTowards(sim, u, u.flankPt.x, u.flankPt.y, dt, 1.2);
      ENG.faceTowards(sim, u, t.x, t.y, dt, 4);
    }
  }

  // 保持距离：太近则后退，太远则推进（视兵种）
  if (!u.flankPt) {
    const ideal = w && w.cls === 'lmg' ? 9 : (w && w.cls === 'pistol' ? 6 : 7);
    if (d < ideal - 3.5) {
      // 后退
      const ang = ENG.angleTo(t, u);
      EngMove.stepTowards(sim, u, u.x + Math.cos(ang) * 3, u.y + Math.sin(ang) * 3, dt, 1.0);
    } else if (d > ideal + 6 && tag.includes('flank') === false && ENG.rng(sim) < 0.5) {
      EngMove.stepTowards(sim, u, t.x, t.y, dt, 0.95);
    } else {
      u.moving = false;
    }
  }

  // 开火
  ENG.tryShoot(sim, u, t, dt, u.moving ? 1.5 : 1.0);

  // 弹药耗尽 -> 换弹
  if (u.ammo <= 0) { u.reloadT = 2200; u.cooldownT = 2200; u.ammo = w ? w.mag : 30; }
};

/* 掩体搜索：找离自己最近、且在敌人反方向的位置 */
ENG.findCover = function (sim, u, threat) {
  const g = sim.grid;
  let best = null, bestScore = -1e9;
  for (let dy = -4; dy <= 4; dy++)
    for (let dx = -4; dx <= 4; dx++) {
      const x = Math.floor(u.x) + dx, y = Math.floor(u.y) + dy;
      if (!MAPGEN.canWalk(g, x, y)) continue;
      const cx = x + 0.5, cy = y + 0.5;
      const d = Math.hypot(cx - u.x, cy - u.y);
      if (d > 4.5) continue;
      // 该位置是否能被威胁看见
      const visible = ENG.hasLOS(g, threat, { x: cx, y: cy });
      // 该位置附近有掩体吗
      let coverN = 0;
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          const t = MAPGEN.at(g, x + ox, y + oy);
          if (t === MAPGEN.T.COVER || t === MAPGEN.T.WALL || t === MAPGEN.T.FURN || t === MAPGEN.T.LOWCOVER) coverN++;
        }
      const score = (visible ? -50 : 60) + coverN * 12 - d * 3;
      if (score > bestScore) { bestScore = score; best = { x: cx, y: cy }; }
    }
  return bestScore > 0 ? best : null;
};

/* 盲射：朝目标方向压制，命中率低但不需完全瞄准 */
ENG.blindShoot = function (sim, u, target, dt, accMul) {
  const w = DATA.WEAPONS[u.weapon];
  if (!w || u.ammo <= 0) return;
  u.muzzleT = 60;
  u.ammo -= 2;
  u.cooldownT = w.reset * 1.4;
  sim.stats.shotsFired++;
  ENG.makeNoise(sim, u.x, u.y, w.sound, 'shot');
  sim.fx.push({ type: 'flash', x: u.x, y: u.y, ang: ENG.angleTo(u, target), t: 0.06, host: u });
  // 压制效果：让目标附近的人不敢动
  sim.troopers.forEach(t => {
    if (!t.alive) return;
    if (ENG.dist(t, target) < 3) t.suppressT = Math.max(t.suppressT, 500);
  });
  const roll = ENG.rng(sim) * 100;
  if (roll < (w.start * 0.35) * accMul) {
    // 盲射命中率很低
    const cover = target.crouch ? 0.9 : (MAPGEN.coverAt(sim.grid, Math.floor(target.x), Math.floor(target.y)) * 0.5);
    if (ENG.rng(sim) > cover) {
      ENG.damage(sim, target, w.dmg * 0.6, u, false);
    }
  }
};

ENG.aiSniper = function (sim, u, dt) {
  if (!u.visibleTarget) { ENG.aiIdle(sim, u, dt); return; }
  const t = u.visibleTarget;
  ENG.faceTowards(sim, u, t.x, t.y, dt, 3.2);
  u.moving = false;
  ENG.tryShoot(sim, u, t, dt, 0.85);
};

ENG.aiBlindfire = function (sim, u, dt) { ENG.aiEngage(sim, u, dt); };

ENG.aiFlee = function (sim, u, dt) {
  // 逃向远离玩家方向
  const threat = sim.troopers.filter(t => t.alive)[0];
  if (!threat) { ENG.aiIdle(sim, u, dt); return; }
  const ang = ENG.angleTo(threat, u);
  EngMove.stepTowards(sim, u, u.x + Math.cos(ang) * 4, u.y + Math.sin(ang) * 4, dt, 1.6);
  ENG.faceTowards(sim, u, u.x + Math.cos(ang) * 4, u.y + Math.sin(ang) * 4, dt, 5);
};

/* 自杀袭击者：冲向最近的队员，贴近后引爆 */
ENG.aiSuicide = function (sim, u, dt) {
  const targets = sim.units.filter(o => o.alive && (o.side === 'player'));
  if (!targets.length) { ENG.aiIdle(sim, u, dt); return; }
  let t = targets[0], bd = 1e9;
  targets.forEach(o => { const d = ENG.dist(u, o); if (d < bd) { bd = d; t = o; } });

  ENG.faceTowards(sim, u, t.x, t.y, dt, 6);
  if (bd > 1.1) {
    EngMove.stepTowards(sim, u, t.x, t.y, dt, 1.9);
  } else {
    ENG.detonate(sim, u, 3.6, 95);
    ENG.kill(sim, u, null);
  }
  u.blowsOnDeath = true;
};

/* 行刑者：冲向人质处决 */
ENG.aiExecution = function (sim, u, dt) {
  const hostages = sim.units.filter(o => o.alive && o.side === 'neutral' && (o.role === 'hostage' || o.role === 'vip'));
  if (!hostages.length) { ENG.aiIdle(sim, u, dt); return; }
  let t = hostages[0], bd = 1e9;
  hostages.forEach(o => { const d = ENG.dist(u, o); if (d < bd) { bd = d; t = o; } });

  if (bd > 1.0) {
    EngMove.stepTowards(sim, u, t.x, t.y, dt, 1.7);
    ENG.faceTowards(sim, u, t.x, t.y, dt, 5);
    // 途中仍会攻击队员
    if (u.visibleTarget && ENG.dist(u, u.visibleTarget) < 8) ENG.tryShoot(sim, u, u.visibleTarget, dt, 1.4);
  } else {
    u.moving = false;
    // 处决
    t.execT = (t.execT || 0) + dt;
    sim.fx.push({ type: 'text', x: t.x, y: t.y, text: '处决中!', color: '#ff4040', t: 0.4 });
    if (t.execT > 1.1) {
      ENG.damage(sim, t, 999, u, true);
      if (t.role === 'vip') sim.failReason = '要员被处决';
    }
  }
};

/* ---------- 中立单位 ---------- */
ENG.updateNeutral = function (sim, u, dt) {
  u.stunT = Math.max(0, u.stunT - dt * 1000);

  // 人质：被释放后跟随 或 跑向撤离点
  if (u.role === 'hostage' || u.role === 'vip') {
    if (u.freed) {
      // 区域安全（敌人清光）后自动前往撤离点；玩家也可用 G 键手动命令撤离
      if (u.order === 'exit') {
        const ex = sim.grid.exits[0];
        const d = Math.hypot(ex.x - u.x, ex.y - u.y);
        if (d < 2) { u.escaped = true; u.alive = true; }
        else {
          if (!u.path || u.pathT > 1.0) { u.path = EngMove.findPath(sim.grid, u, { x: ex.x + .5, y: ex.y + .5 }); u.pathT = 0; }
          u.pathT = (u.pathT || 0) + dt;
          if (u.path && u.path.length) {
            const n = u.path[0];
            if (EngMove.stepTowards(sim, u, n.x, n.y, dt, 1.5)) u.path.shift();
            ENG.faceTowards(sim, u, n.x, n.y, dt, 5);
          }
        }
      } else {
        // 跟随最近的队员
        const esc = sim.troopers.filter(t => t.alive)
          .sort((a, b) => ENG.dist(u, a) - ENG.dist(u, b))[0];
        if (esc) {
          const d = ENG.dist(u, esc);
          if (d > 2.2) {
            if (!u.path || u.pathT > 0.7) { u.path = EngMove.findPath(sim.grid, u, esc); u.pathT = 0; }
            u.pathT = (u.pathT || 0) + dt;
            if (u.path && u.path.length) {
              const n = u.path[0];
              if (EngMove.stepTowards(sim, u, n.x, n.y, dt, 1.35)) u.path.shift();
            } else EngMove.stepTowards(sim, u, esc.x, esc.y, dt, 1.35);
            ENG.faceTowards(sim, u, esc.x, esc.y, dt, 4);
          } else u.moving = false;
        }
      }
    } else {
      // 未释放：蹲着不动
      u.moving = false;
      u.crouch = true;
    }
    return;
  }

  // HVT：看到队员就逃，被瞄准就停下
  if (u.role === 'hvt') {
    const t = sim.troopers.filter(o => o.alive && ENG.dist(u, o) < 12);
    const aimed = t.find(o => {
      if (ENG.dist(u, o) > 9) return false;
      const a = ENG.angleTo(o, u);
      return Math.abs(ENG.angDiff(a, o.face)) < 0.32 && ENG.hasLOS(sim.grid, o, u);
    });
    if (aimed) {
      u.moving = false;
      u.surrendering = true;
      ENG.faceTowards(sim, u, aimed.x, aimed.y, dt, 4);
    } else if (t.length) {
      // 逃跑
      const near = t[0];
      const ang = ENG.angleTo(near, u);
      u.surrendering = false;
      EngMove.stepTowards(sim, u, u.x + Math.cos(ang) * 4, u.y + Math.sin(ang) * 4, dt, 1.7);
      ENG.faceTowards(sim, u, u.x + Math.cos(ang) * 4, u.y + Math.sin(ang) * 4, dt, 5);
    } else u.moving = false;
    return;
  }

  // 平民：听到枪声/看到尸体 -> 逃跑或蹲下
  const danger = sim.noiseEvents.some(n => Math.abs(n.t - sim.time) < 3 &&
    (n.type === 'shot' || n.type === 'boom') && Math.hypot(n.x - u.x, n.y - u.y) < n.radius * 0.8);
  const seeBody = sim.fx.some(f => f.type === 'corpse' && Math.hypot(f.x - u.x, f.y - u.y) < 6);
  const seeEnemy = sim.troopers.some(t => t.alive && ENG.inCone(sim.grid, u, t, { range: 11, fov: 120 }));

  if (danger || seeBody) {
    u.panic = Math.max(u.panic || 0, 6);
  }
  if (u.panic > 0) {
    u.panic -= dt;
    const threat = sim.troopers.filter(t => t.alive)[0];
    if (threat) {
      const ang = ENG.angleTo(threat, u);
      // 逃跑方向：先试正后方，被挡就左右各偏 60°，再被挡就换到能走的方向
      EngMove.stepAwayFrom(sim, u, threat, dt, 1.5);
    }
    u.crouch = false;
    sim.stats.fleeing = true;
  } else if (seeEnemy) {
    u.crouch = true;
    u.moving = false;
  } else {
    u.crouch = false;
    // 缓慢游荡：到达 / 被挡住 -> 立刻换一个新的、可走到的落点
    u.wanderT = (u.wanderT || 0) + dt;
    const arrivedWp = !u.wanderPt || Math.hypot(u.wanderPt.x - u.x, u.wanderPt.y - u.y) < 0.4;
    if (u.wanderT > 3 || arrivedWp || (u.stuckT || 0) > 0.6) {
      u.wanderT = 0;
      u.stuckT = 0;
      u.wanderPt = EngMove.pickReachablePoint(sim, u, 2.5);
    }
    if (u.wanderPt) EngMove.stepTowards(sim, u, u.wanderPt.x, u.wanderPt.y, dt, 0.45);
    else u.moving = false;
  }
};

/* 挑一个自己能走到的随机落点；连续试多次，全失败就返回原地前的小偏移 */
EngMove.pickReachablePoint = function (sim, u, radius) {
  const g = sim.grid;
  for (let i = 0; i < 12; i++) {
    const ang = ENG.rng(sim) * Math.PI * 2;
    const r = radius * (0.5 + ENG.rng(sim) * 0.5);
    const x = u.x + Math.cos(ang) * r, y = u.y + Math.sin(ang) * r;
    if (!EngMove.passable(g, x, y, u)) continue;
    if (!EngMove.freeOfUnits(sim, x, y, u, 0.4)) continue;
    // 要求中途也大致可走（简单采样两点，避免选到隔着墙的点）
    const midx = u.x + Math.cos(ang) * r * 0.5, midy = u.y + Math.sin(ang) * r * 0.5;
    if (!EngMove.passable(g, midx, midy, u)) continue;
    return { x, y };
  }
  return null;
};

/* 背对威胁移动：正后方被挡就左右绕，避免贴墙抽搐 */
EngMove.stepAwayFrom = function (sim, u, threat, dt, speedMul) {
  const base = ENG.angleTo(threat, u);   // 从威胁指向自己 = 远离方向
  for (const off of [0, 0.6, -0.6, 1.2, -1.2, Math.PI / 2, -Math.PI / 2]) {
    const ang = base + off;
    const tx = u.x + Math.cos(ang) * 3, ty = u.y + Math.sin(ang) * 3;
    const moved = EngMove.stepTowards(sim, u, tx, ty, dt, speedMul);
    if (u.moving) {           // 成功动了
      ENG.faceTowards(sim, u, tx, ty, dt, 5);
      return true;
    }
  }
  u.moving = false;
  return false;
};

window.EngMove = EngMove;

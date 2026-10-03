/* ============================================================
   DK2D - 核心战术引擎
   视野锥 / 视线遮挡 / AI 状态机 / 战斗判定 / 噪音传播
   ============================================================ */
const ENG = {};

/* ---------------- 可复现随机 ----------------
   所有战斗随机数走 sim.rng，给定种子的同一场战斗结果完全可复现。
   未提供 rng 时回退到 Math.random（正常游玩不影响） */
ENG.rng = function (sim) {
  if (sim && sim.rng) return sim.rng();
  return Math.random();
};

/* ---------------- 战术信条（Doctrine）辅助 ----------------
   这些耗时原本被硬编码成 dur:100，等于破门瞬间完成，
   和破门菜单里显示的「耗时 1.2s」对不上。这里统一从 DATA.BREACH 取基础值，
   再叠加破门系信条的加成。 */
ENG.breachDur = function (sim, t, method, door) {
  if (typeof globalThis !== 'undefined' && globalThis.__DK2D_INSTANT_BREACH) return 100;
  const b = DATA.BREACH[method];
  let dur = (b && b.time) ? b.time : 1200;
  const mods = sim && sim.doct;
  const isPlayer = !!(t && t.side === 'player');
  const oneShot = !!(mods && isPlayer && mods.breach.oneShotBreach);
  // 上锁门用霰弹枪默认要两枪（解锁「一枪破门」后一枪）
  if (door && door.locked && method === 'shotgun' && !oneShot) dur *= 2;
  if (mods && isPlayer) dur *= mods.breach.breachTimeMul;
  return dur;
};

ENG.defuseDur = function (sim, t) {
  let dur = 4200;
  const mods = sim && sim.doct;
  if (mods && t && t.side === 'player') dur *= mods.breach.defuseTimeMul;
  return dur;
};

ENG.reloadDur = function (sim, t) {
  let dur = 2400;
  const mods = sim && sim.doct;
  if (mods && t && t.side === 'player') dur *= mods.breach.reloadTimeMul;
  return dur;
};

/* 破门噪音（受「静默突入」信条与「静默」状态影响） */
ENG.breachNoise = function (sim, t, base) {
  let mul = 1;
  const mods = sim && sim.doct;
  if (mods && t && t.side === 'player') mul *= mods.breach.breachNoiseMul;
  if (t && t.goSilent) mul *= 0.6;      // 静默状态：开门/破门也放轻
  return base * mul;
};

/* ---------------- 几何 ---------------- */
ENG.dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

ENG.angleTo = function (a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
};

/* 角度差（归一化到 -PI..PI） */
ENG.angDiff = function (a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/* 视线判定：Bresenham 走格子，遇到挡视线的格子返回 false */
ENG.hasLOS = function (g, from, to) {
  let x0 = Math.floor(from.x), y0 = Math.floor(from.y);
  const x1 = Math.floor(to.x), y1 = Math.floor(to.y);
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let guard = 0;
  while (guard++ < 500) {
    if (x0 === x1 && y0 === y1) return true;
    if (!(x0 === Math.floor(from.x) && y0 === Math.floor(from.y))) {
      if (MAPGEN.blocksSight(g, x0, y0)) return false;
    }
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
  return false;
};

/* 目标是否在观察者的视野锥内 */
ENG.inCone = function (g, obs, tgt, opts) {
  opts = opts || {};
  const d = ENG.dist(obs, tgt);
  let range = opts.range || obs.sight;
  if (opts.rangeMul) range *= opts.rangeMul;
  if (d > range) return false;
  // 极近距离无视朝向（DK2: 靠太近一定被发现）
  if (!opts.ignoreClose && d < 1.6) {
    // 仍需视线
    return ENG.hasLOS(g, obs, tgt);
  }
  const a = ENG.angleTo(obs, tgt);
  let fov = (opts.fov !== undefined ? opts.fov : obs.fov) * Math.PI / 180 / 2;
  if (opts.fovMul) fov *= opts.fovMul;
  if (Math.abs(ENG.angDiff(a, obs.face)) > fov) return false;
  return ENG.hasLOS(g, obs, tgt);
};

/* 视野边缘惩罚：目标越靠锥边缘，瞄准越慢 */
ENG.edgePenalty = function (obs, tgt, fovDeg) {
  const a = ENG.angleTo(obs, tgt);
  const half = (fovDeg || obs.fov) * Math.PI / 180 / 2;
  const off = Math.abs(ENG.angDiff(a, obs.face));
  const r = Math.min(1, off / Math.max(0.001, half));
  return 1 + r * 1.35;   // 中心 1x，边缘 2.35x 瞄准时间
};

/* ---------------- 噪音 ---------------- */
/* 传播：把噪音事件丢给半径内所有单位，转为「调查声源」意图。
   注意：枪声影响范围很广，但【远距离只会轻度警觉 + 朝声源方向移动】，
   不会让整栋楼瞬间精确锁定玩家 —— 否则一开枪就全图集火。 */
ENG.makeNoise = function (sim, x, y, radius, type) {
  if (radius <= 0) return;
  sim.noiseEvents.push({ x, y, radius, type, t: sim.time });
  const all = sim.units.filter(u => u.alive && u.side !== 'player' && u.side !== 'neutral');
  all.forEach(u => {
    const d = Math.hypot(u.x - x, u.y - y);
    if (d > radius) return;

    // 噪音强度：越近越明确
    const strength = 1 - d / radius;   // 0..1
    u.alert = Math.max(u.alert, 0.35 + strength * 0.5);

    if (u.state === 'engage' || u.state === 'suicide' || u.state === 'execution') return;
    if (u.state === 'sniper') return;   // 狙击手不擅离职守

    if (strength > 0.45) {
      // 近处：主动去查看
      u.state = 'investigate';
      u.investigate = { x, y };
      u.investT = 0;
      u.stuckT = 0;
    } else {
      // 远处：只朝向声源警戒，不离开岗位
      if (u.state === 'idle' || u.state === 'patrol') {
        u.scanTarget = Math.atan2(y - u.y, x - u.x);
        u.investigateHint = { x, y };
      }
    }
  });
};

/* ---------------- AI 感知更新 ---------------- */
ENG.updatePerception = function (sim, u) {
  const g = sim.grid;
  const diff = sim.difficulty;

  // --- 找可见的敌方目标 ---
  let best = null, bestScore = -1;
  const enemies = sim.units.filter(o => o.alive && o.side !== u.side && o.side !== 'neutral');

  for (const o of enemies) {
    if (!ENG.inCone(g, u, o, { range: u.sight * diff.sightMul, fov: u.fov })) continue;
    const d = ENG.dist(u, o);
    // 越近越优先，且优先非隐蔽的
    let score = 100 - d;
    if (o.side === 'player') score += 5;
    if (o.crouch && d > 4) score -= 25;       // 蹲在掩体后更难被注意
    if (score > bestScore) { bestScore = score; best = o; }
  }

  // 黑暗惩罚
  if (sim.night && !u.hasNVG) {
    if (best && ENG.dist(u, best) > 6) best = null;
  }

  if (best) {
    if (u.visibleTarget !== best) {
      u.visibleTarget = best;
      u.spotT = 0;
      u.alert = 1;
      if (u.state !== 'engage') { u.state = 'engage'; u.engageT = 0; }
      // 通报：同房间敌人共享情报
      ENG.shareIntel(sim, u, best);
    }
    u.aimTarget = best;
  } else {
    u.visibleTarget = null;
  }

  // --- 感知玩家队员（用于潜伏值计算） ---
  if (u.side !== 'player') {
    const seen = sim.troopers.find(t => t.alive &&
      ENG.inCone(g, u, t, { range: u.sight * diff.sightMul, fov: u.fov }));
    u.seesTrooper = seen || null;
    if (seen) {
      seen.exposedT = (seen.exposedT || 0) + sim.dt * 1000;
    }
  }
};

/* 情报共享：只告知【同房间或很近且在视线内】的同伴。
   半径过大会导致一开枪全图警觉，玩家毫无战术空间。 */
ENG.shareIntel = function (sim, from, target) {
  const roomOf = (u) => sim.grid.rooms.findIndex(r =>
    u.x >= r.x && u.x < r.x + r.w && u.y >= r.y && u.y < r.y + r.h);
  const fromRoom = roomOf(from);

  sim.units.forEach(o => {
    if (o === from || !o.alive || o.side === 'player') return;
    const d = ENG.dist(o, from);
    if (d > 7) return;
    if (!ENG.hasLOS(sim.grid, o, from)) return;
    // 必须同房间，或距离很近（<4m）
    const sameRoom = fromRoom >= 0 && roomOf(o) === fromRoom;
    if (!sameRoom && d > 4) return;

    o.alert = Math.max(o.alert, 0.85);
    o.lastKnown = { x: target.x, y: target.y };
    if (o.state === 'idle' || o.state === 'patrol' || o.state === 'investigate') {
      o.state = 'hunt';
      o.lastKnown = { x: target.x, y: target.y };
    }
  });
};

/* ---------------- 单位更新 ---------------- */
ENG.updateUnit = function (sim, u, dt) {
  if (!u.alive) return;
  const g = sim.grid;

  // 计时器推进
  u.reactionT = Math.max(0, u.reactionT - dt * 1000);
  u.aimT = Math.max(0, u.aimT - dt * 1000);
  u.cooldownT = Math.max(0, u.cooldownT - dt * 1000);
  u.suppressT = Math.max(0, u.suppressT - dt * 1000);
  u.stunT = Math.max(0, u.stunT - dt * 1000);
  u.muzzleT = Math.max(0, u.muzzleT - dt * 1000);
  u.alert = Math.max(0, u.alert - dt * 0.06);
  // 受击相关计时器对所有单位统一递减。
  // （以前 hurtT 只在玩家分支里减，敌人挨一枪后 hurtT 永远是 260，
  //   渲染层拿 hurtT/260 当白闪强度 -> 敌人会永久发白。）
  u.hurtT = Math.max(0, (u.hurtT || 0) - dt * 1000);
  u.turnToSourceT = Math.max(0, (u.turnToSourceT || 0) - dt * 1000);

  ENG.updatePerception(sim, u);

  if (u.side === 'player') { ENG.updateTrooper(sim, u, dt); return; }
  if (u.side === 'neutral') { ENG.updateNeutral(sim, u, dt); return; }

  /* ===== 敌人 AI ===== */
  const diff = sim.difficulty;

  // 被击中 -> 立刻转向弹源。
  // 否则从背后挨枪的敌人视野锥永远扫不到射手，会站着不动直到被打死
  //（它原来只在"听到声音"或"目标进入视野"时才有反应）。
  if (u.turnToSourceT > 0 && u.attackSource) {
    ENG.faceTowards(sim, u, u.attackSource.x, u.attackSource.y, dt, 13);
    u.alert = 1;
    u.lastKnown = { x: u.attackSource.x, y: u.attackSource.y };
    // 每次受击只触发一次"循弹源追击"：否则 900ms 内会反复清空路径，原地不动
    if (u.reactedHitStamp !== u.hurtStamp) {
      u.reactedHitStamp = u.hurtStamp;
      if (!u.visibleTarget && u.state !== 'engage' && u.state !== 'suicide' &&
          u.state !== 'execution' && u.state !== 'blindfire') {
        EngMove.resetWatchdog(u);
        u.state = 'hunt';
        u.huntT = 0; u.stuckT = 0; u.pathT = 0; u.path = null;
      }
    }
  }

  // 眩晕：不动不开枪
  if (u.stunT > 0) { u.aimT = 0; u.reactionT = 600; EngMove.stop(u); return; }

  ENG.enemyReact(sim, u, dt);

  switch (u.state) {
    case 'engage':     ENG.aiEngage(sim, u, dt); break;
    case 'hunt':       ENG.aiHunt(sim, u, dt); break;
    case 'investigate':ENG.aiInvestigate(sim, u, dt); break;
    case 'flee':       ENG.aiFlee(sim, u, dt); break;
    case 'suicide':    ENG.aiSuicide(sim, u, dt); break;
    case 'execution':  ENG.aiExecution(sim, u, dt); break;
    case 'sniper':     ENG.aiSniper(sim, u, dt); break;
    case 'blindfire':  ENG.aiBlindfire(sim, u, dt); break;
    default:           ENG.aiIdle(sim, u, dt); break;
  }

  // 状态自动切换：看见目标 -> engage
  if (u.visibleTarget && u.state !== 'suicide' && u.state !== 'execution' && u.state !== 'engage') {
    u.state = 'engage'; u.engageT = 0;
  }
  // 丢失目标一段时间 -> hunt
  if (u.state === 'engage' && !u.visibleTarget) {
    u.engageT = (u.engageT || 0) + dt * 1000;
    if (u.engageT > 3500) {
      if (u.lastKnown) { u.state = 'hunt'; }
      else { u.state = 'idle'; }
    }
  }
};

/* 反应：第一次看到目标需要 react 时间才开始瞄准。
   注意：改用"已反应目标"记录，避免反复重置。*/
ENG.enemyReact = function (sim, u, dt) {
  if (!u.visibleTarget) {
    u.reactedTo = null;
    u.reactionT = 0;
    return;
  }
  if (u.reactedTo !== u.visibleTarget) {
    // 发现新目标 -> 开始反应计时
    u.reactedTo = u.visibleTarget;
    u.reactionT = u.react * sim.difficulty.reactMul;
  }
  // 反应期内目标若消失，上面已重置
};

/* 朝向目标平滑转动 */
ENG.faceTowards = function (sim, u, tx, ty, dt, speed) {
  const want = Math.atan2(ty - u.y, tx - u.x);
  const sp = (speed || 4.2) * dt;
  const d = ENG.angDiff(want, u.face);
  if (Math.abs(d) <= sp) u.face = want;
  else u.face += Math.sign(d) * sp;
};

/* 瞄准与开火 */
ENG.tryShoot = function (sim, u, target, dt, aimMul) {
  if (!target) return;
  const w = DATA.WEAPONS[u.weapon];
  if (!w) return;
  const d = ENG.dist(u, target);

  // 需要反应完成
  if (u.reactionT > 0) return;
  // 需要大致对准
  const a = ENG.angleTo(u, target);
  if (Math.abs(ENG.angDiff(a, u.face)) > 0.30) return;

  // 冷却
  if (u.cooldownT > 0) return;

  // 瞄准进度
  if (u.aimT <= 0) {
    let aimFull = (w.aim[0] + ENG.rng(sim) * (w.aim[1] - w.aim[0]));
    aimFull *= ENG.edgePenalty(u, target, u.fov);
    aimFull *= (aimMul || 1) * (u.aimMulOverride || 1);
    if (u.suppressT > 0) aimFull *= 1.5;
    aimFull *= sim.difficulty.aimMul;
    if (u.moving) aimFull *= 1.8;
    u.aimT = aimFull;
  }
  u.blocked = false;

  // 命中判定
  const tgtArmor = DATA.ARMOR[target.armor] || DATA.ARMOR.none;
  let pen = w.pen;
  // 距离衰减 & 精度
  const t = Math.min(1, d / Math.max(1, w.range));
  let acc = (w.start + (w.end - w.start) * t);
  // 难度影响敌人准度（普通 1.0 / 困难 1.1 / 专家 1.2）
  acc *= sim.difficulty.accMul;
  if (u.moving) acc *= 0.62;
  if (target.crouch) acc *= 0.62;
  if (u.suppressT > 0) acc *= 0.55;
  // 超远距离额外惩罚：敌人不是狙击手就不该在 20m 外精准爆头
  if (d > w.range * 0.7) acc *= 0.7;
  acc = Math.max(4, Math.min(90, acc));
  // 掩体减伤（只对掩体方向）
  let cover = 0;
  if (target.crouch) cover += 0.35;
  cover += MAPGEN.coverAt(sim.grid, Math.floor(target.x), Math.floor(target.y)) * 0.5;
  if (target.coverDir !== undefined) {
    // 从掩体侧面打过来 -> 掩体无效
    const fromDir = Math.atan2(u.y - target.y, u.x - target.x);
    if (Math.abs(ENG.angDiff(fromDir, target.coverDir)) > Math.PI * 0.55) cover = 0;
  }

  const roll = ENG.rng(sim) * 100;
  const hit = roll < acc * (1 - cover * 0.9);

  u.muzzleT = 60;
  u.shotsFired = (u.shotsFired || 0) + (w.shots || 1);
  u.ammo -= Math.min(u.ammo, w.shots || 1);

  // 后坐力：连发后准度略降（用 reset 表现）
  u.cooldownT = (w.reset + (w.burst || 0) * (w.shots || 1)) / (u.suppressT > 0 ? 1.2 : 1);

  if (hit) {
    const isCrit = ENG.rng(sim) * 100 < w.crit;
    let dmg = w.dmg;
    if (isCrit) dmg *= 2.6;
    // 穿甲：pen <= 护甲等级 视为打不穿，大幅减伤
    // （DK2 设定：III 级插板就该挡住 7.62x39，所以等值也算挡住了）
    if (pen <= tgtArmor.level) {
      const ratio = pen / Math.max(1, tgtArmor.level);
      dmg *= 0.18 + ratio * 0.22;   // 打不穿时只造成 18%~40% 伤害
      if (tgtArmor.side) {
        // 插板侧面暴露
        const fromDir = Math.atan2(u.y - target.y, u.x - target.x);
        if (Math.abs(ENG.angDiff(fromDir, target.coverDir === undefined ? target.face : target.coverDir)) > 1.0) dmg *= 2.2;
      }
    }
    dmg *= (0.85 + ENG.rng(sim) * 0.3);
    // 单次伤害上限：满血队员不该被一枪带走，
    // 保留"中弹后能被掩护撤下来"的战术空间。难度越高上限越宽松。
    if (target.side === 'player') {
      const cm = sim.difficulty.dmgCapMul || 1;
      const hpRatio = target.hp / target.maxHp;
      const cap = (hpRatio > 0.7 ? 42 : (hpRatio > 0.4 ? 62 : 999)) * cm;
      dmg = Math.min(dmg, cap);
    }
    ENG.damage(sim, target, dmg, u, isCrit);
    sim.stats.shotsHit++;
  } else {
    // 打偏：可能打碎窗/打到墙
    sim.stats.shotsMissed++;
    if (ENG.rng(sim) < 0.15) {
      const mx = Math.floor(target.x + (ENG.rng(sim) - 0.5) * 3);
      const my = Math.floor(target.y + (ENG.rng(sim) - 0.5) * 3);
      if (MAPGEN.at(sim.grid, mx, my) === MAPGEN.T.WINDOW) {
        sim.grid.tiles[my][mx] = MAPGEN.T.FLOOR;
        ENG.makeNoise(sim, mx, my, DATA.NOISE.breakGlass, 'glass');
        sim.fx.push({ type: 'text', x: mx, y: my, text: '玻璃碎裂!', color: '#ffd479', t: 1.6 });
      }
    }
  }
  sim.stats.shotsFired++;
  // 开火噪音
  ENG.makeNoise(sim, u.x, u.y, w.sound, 'shot');
  sim.fx.push({ type: 'flash', x: u.x, y: u.y, ang: u.face, t: 0.06, host: u });
};

/* 伤害结算 */
ENG.damage = function (sim, target, dmg, from, isCrit) {
  if (!target.alive) return;
  const armor = DATA.ARMOR[target.armor] || DATA.ARMOR.none;
  const isCiv = target.side === 'neutral';
  if (isCiv && isCrit) { dmg *= 0.5; }  // 平民/要员免疫暴击（DK2 1.0 设定）

  target.hp -= dmg;
  target.hurtT = 260;            // 白色受击闪烁（纯视觉）
  target.turnToSourceT = 900;    // 转向弹源的时间窗：比闪烁长，够转半圈
  target.hurtStamp = (target.hurtStamp || 0) + 1;   // 每次受击的唯一序号，用于只触发一次反应
  // 兜底记录弹源：不依赖调用方是否设置，爆炸/近战等也能正确转向
  if (from && from.x !== undefined) target.attackSource = { x: from.x, y: from.y };
  sim.fx.push({ type: 'dmg', x: target.x, y: target.y, v: Math.round(dmg), crit: isCrit, t: 0.9 });

  // 压制
  target.suppressT = Math.max(target.suppressT, 700 * (dmg / 40));
  if (target.side === 'player') target.alert = 1;

  if (target.hp <= 0) {
    target.hp = 0;
    ENG.kill(sim, target, from);
  }
};

ENG.kill = function (sim, u, killer) {
  if (!u.alive) return;
  u.alive = false;
  u.deathT = sim.time;

  if (u.side === 'player') {
    sim.stats.deaths++;
    sim.fx.push({ type: 'text', x: u.x, y: u.y, text: '队员阵亡', color: '#ff5c5c', t: 3 });
    // 全队士气/警报
    sim.units.forEach(o => { if (o.side !== 'player') o.alert = 1; });
  } else if (u.side === 'neutral') {
    sim.stats.civDeaths++;
    sim.fx.push({ type: 'text', x: u.x, y: u.y, text: u.role === 'hostage' ? '人质遇害!' : '平民死亡', color: '#ff5c5c', t: 3 });
  } else {
    sim.stats.kills++;
    sim.fx.push({ type: 'text', x: u.x, y: u.y, text: '已击毙', color: '#8fe08f', t: 1.4 });
    // 自杀背心连锁
    if (u.ai && u.ai.includes('suicide') && u.blowsOnDeath) ENG.detonate(sim, u, 3.6, 90);
  }

  // 死亡惨叫噪音
  ENG.makeNoise(sim, u.x, u.y, DATA.NOISE.death, 'death');
  sim.fx.push({ type: 'corpse', x: u.x, y: u.y, side: u.side, t: 9999 });

  // 行刑者触发：同伴/平民死亡被看到
  sim.units.forEach(e => {
    if (!e.alive || e.side === 'player' || !e.isExecutioner) return;
    if (ENG.dist(e, u) < 10 && ENG.hasLOS(sim.grid, e, u)) {
      e.state = 'execution';
      if (!sim.execTimerOn) {
        sim.execTimerOn = true;
        sim.execLeft = sim.execLimit;
        sim.fx.push({ type: 'text', x: e.x, y: e.y, text: '⚠ 行刑者动了!', color: '#ff5c5c', t: 3.5 });
      }
    }
  });
};

/* 爆炸 */
ENG.detonate = function (sim, src, radius, dmg) {
  sim.fx.push({ type: 'boom', x: src.x, y: src.y, r: radius, t: 0.5 });
  ENG.makeNoise(sim, src.x, src.y, radius * 3, 'boom');
  sim.units.forEach(u => {
    if (!u.alive) return;
    const d = ENG.dist(src, u);
    if (d > radius) return;
    if (!ENG.hasLOS(sim.grid, src, u) && d > radius * 0.5) return;
    const f = 1 - d / radius;
    ENG.damage(sim, u, dmg * f, src, false);
  });
  // 炸墙
  const g = sim.grid;
  for (let y = Math.floor(src.y - radius); y <= src.y + radius; y++)
    for (let x = Math.floor(src.x - radius); x <= src.x + radius; x++) {
      if (Math.hypot(x - src.x, y - src.y) > radius) continue;
      if (MAPGEN.at(g, x, y) === MAPGEN.T.BRWALL) {
        g.tiles[y][x] = MAPGEN.T.FLOOR;
        sim.fx.push({ type: 'text', x, y, text: '墙被炸开', color: '#ffb35c', t: 1.4 });
      } else if (MAPGEN.at(g, x, y) === MAPGEN.T.DOOR || MAPGEN.at(g, x, y) === MAPGEN.T.LOCKED) {
        const d = g.doors.find(d => d.x === x && d.y === y);
        if (d) { d.open = true; d.broken = true; d.locked = false; }
      }
    }
};

window.ENG = ENG;

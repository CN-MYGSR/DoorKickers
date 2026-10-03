/* ============================================================
   DK2D - 玩家队员控制
   路径规划 / 朝向模式（普通-临时、Ctrl-强制、Shift-锁定注视）
   GO Code 编组 / 破门动作 / 姿态 / 逮捕
   ============================================================ */

/* 队员朝向模式 */
const FACE = { PATH: 'path', HARD: 'hard', FOCUS: 'focus' };
window.FACE = FACE;

/* 切换主/副武器：记录各自剩弹，避免换一次枪就凭空补满。
   「快速拔枪」信条会缩短出枪的僵直。 */
ENG.swapWeapon = function (sim, t) {
  const cur = t.weapon;
  const other = (cur === t.secondary && t.primaryW) ? t.primaryW : t.secondary;
  if (!other || other === cur) return false;
  const w = DATA.WEAPONS[other];
  if (!w) return false;
  t.ammoStore = t.ammoStore || {};
  t.ammoStore[cur] = t.ammo;
  if (cur !== t.secondary) t.primaryW = cur;
  if (t.ammoStore[other] === undefined) t.ammoStore[other] = w.mag;
  t.weapon = other;
  t.ammo = t.ammoStore[other];
  t.reloading = false;
  t.reloadT = 0;
  t.aimT = 0;
  const mods = sim && sim.doct;
  const cd = 300 * ((mods && t.side === 'player') ? mods.global.reactMul : 1);
  t.cooldownT = Math.max(t.cooldownT || 0, cd);
  return true;
};

/* 把一个路径点上的动作/朝向标记搬到另一个路径点上。
   重寻路会重建整条路径，必须显式搬运这些标记，否则中间节点上规划好的
   破门 / 救人质 / 切角 / 取消点会被静默丢掉。 */
ENG.carryWaypointFlags = function (from, to) {
  if (!from || !to) return to;
  if (from.breach) { to.breach = from.breach; to.door = from.door; to.method = from.method; }
  if (from.arrest) { to.arrest = from.arrest; to.unit = from.unit; }
  if (from.free) { to.free = from.free; to.unit = from.unit; }
  if (from.defuse) to.defuse = from.defuse;
  if (from.power) to.power = from.power;
  if (from.grenade) to.grenade = from.grenade;
  if (from.cancel) to.cancel = from.cancel;
  if (from.crouch !== undefined) to.crouch = from.crouch;
  if (from.sprint !== undefined) to.sprint = from.sprint;
  if (from.wait !== undefined) to.wait = from.wait;
  if (from.faceMode) {
    to.faceMode = from.faceMode;
    to.lookX = from.lookX; to.lookY = from.lookY; to.face = from.face;
  }
  return to;
};

/* ---------- 队员每帧更新 ---------- */
ENG.updateTrooper = function (sim, t, dt) {
  if (!t.alive) return;
  t.suppressT = Math.max(0, t.suppressT - dt * 1000);
  t.cooldownT = Math.max(0, t.cooldownT - dt * 1000);
  t.reactionT = Math.max(0, t.reactionT - dt * 1000);
  t.aimT = Math.max(0, t.aimT - dt * 1000);
  t.muzzleT = Math.max(0, t.muzzleT - dt * 1000);
  t.stunT = Math.max(0, t.stunT - dt * 1000);

  if (t.stunT > 0) { SIM.stopTrooper(t); return; }

  /* --- 1. 执行当前路径 --- */
  if (t.autoShoot && ENG.hasVisibleEnemy(sim, t)) {
    // 停下射击（DK2 的 Wait for clear）：看见敌人就停下来打，而不是边走边打
    t.waitingFire = true;
  } else t.waitingFire = false;

  const px0 = t.x, py0 = t.y;   // 记下起点，用来算本帧实际速度（「同速」要用）

  // 停顿（DK2 的 Halt）：停在原地等 GO Code 放开，不推进路径
  if (t.halted) { t.moving = false; t.waitingFire = false; }

  if (!t.halted && !t.waitingFire && t.path && t.path.length) {
    const wp = t.path[0];
    const d = Math.hypot(wp.x - t.x, wp.y - t.y);
    // 到达判定与 EngMove.stepTowards 共用同一阈值，避免"到不了也过不去"的死锁
    if (d < EngMove.ARRIVE) {
      t.path.shift();
      // 停顿点：到达就停住（节点已被消费，用 haltAt 保留一个可视化标记）
      if (wp.halt) { t.halted = true; t.haltAt = { x: wp.x, y: wp.y }; }
      // 到达路径点触发动作
      ENG.runWaypointAction(sim, t, wp);
      if (!t.path.length) { t.moving = false; }
    } else {
      // 交互型路点（救人质/逮捕/拆弹/断电）：不需要真的站到点上，
      // 只要进到交互距离就直接执行动作 —— 否则会被目标本身挡住永远到不了。
      if (wp.free && wp.unit && ENG.dist(t, wp.unit) < 1.4) {
        t.path.shift();
        ENG.startAction(sim, t, { kind: 'free', unit: wp.unit, dur: 900 });
      } else if (wp.arrest && wp.unit && ENG.dist(t, wp.unit) < 1.4) {
        t.path.shift();
        ENG.startAction(sim, t, { kind: 'arrest', unit: wp.unit, dur: 1200 });
      } else if (wp.defuse && sim.bomb && ENG.dist(t, sim.bomb) < 1.4) {
        t.path.shift();
        ENG.startAction(sim, t, { kind: 'defuse', dur: ENG.defuseDur(sim, t) });
      } else if (wp.power && sim.powerBox && Math.hypot(sim.powerBox.x + .5 - t.x, sim.powerBox.y + .5 - t.y) < 1.4) {
        t.path.shift();
        ENG.startAction(sim, t, { kind: 'power', dur: 2600 });
      } else {
      let spdMul = t.crouch ? 0.55 : (t.sprint ? 1.75 : 1);
      // 「同速」：跟着 8m 内最慢的那名【正在走】的友军走，别把队友甩下。
      // 只算正在移动的：否则已经就位的队友会让全队停住。
      if (wp.matchSpeed) {
        let slowest = Infinity;
        for (const o of sim.troopers) {
          if (o === t || !o.alive || !o.moving) continue;
          if (ENG.dist(t, o) > 8) continue;
          slowest = Math.min(slowest, (o.curSpeed !== undefined) ? o.curSpeed : (o.speed || 2.5));
        }
        if (slowest < Infinity && t.speed > 0) spdMul = Math.min(spdMul, slowest / t.speed);
      }
      const ok = EngMove.stepTowards(sim, t, wp.x, wp.y, dt, spdMul);
      if (!ok) {
        // 被挡住：先看是不是门挡路
        const dr = EngMove.doorAhead(sim.grid, t, wp.x, wp.y);
        if (dr && !t.action) {
          const method = wp.breach ? wp.method : (dr.locked ? 'kick' : 'hand');
          ENG.startAction(sim, t, { kind: 'breach', door: dr, method, dur: ENG.breachDur(sim, t, method, dr) });
          t.stuckT = 0;
        } else {
          t.stuckT = (t.stuckT || 0) + dt;
          // 卡住 0.8 秒才重寻路
          if (t.stuckT > 0.8) {
            const cur = t.path[0];
            const dCur = Math.hypot(cur.x - t.x, cur.y - t.y);
            let p = null, tail = t.path.slice(1);
            // 优先重寻路到【下一个】路径点，并保留后面所有节点 ——
            // 这样中间节点上的破门 / 救人质 / 切角 / 取消点都不会丢。
            // 但如果连续几次都靠不近它（例如目标在锁着的门后），就放弃中间点直奔终点，
            // 否则会陷入"卡住 -> 重寻路 -> 又卡住"的死循环。
            // 诊断开关：DK2D_OLD_REPATH=1 时退回"卡住就直奔终点"的旧行为，用于 A/B 对比
            const forceFinal = (typeof globalThis !== 'undefined' && globalThis.__DK2D_OLD_REPATH);
            if (!forceFinal && !EngMove.noteRepathProgress(t, dCur)) {
              p = EngMove.findPath(sim.grid, t, { x: cur.x, y: cur.y }, 12000);
              if (p && p.length) ENG.carryWaypointFlags(cur, p[p.length - 1]);
            }
            if (!p || !p.length) {
              // 退而求其次：直奔终点（后面的中间点只能放弃）
              const finalWp = t.path[t.path.length - 1];
              p = EngMove.findPath(sim.grid, t, { x: finalWp.x, y: finalWp.y }, 12000);
              tail = [];
              if (p && p.length) ENG.carryWaypointFlags(finalWp, p[p.length - 1]);
            }
            // 真的到不了：清空这条路径，避免死循环
            t.path = (p && p.length) ? p.concat(tail) : [];
            t.stuckT = 0;
          }
        }
      } else {
        t.stuckT = Math.max(0, (t.stuckT || 0) - dt * 2);
      }
      t.moving = true;
      // 走路朝向
      if (t.faceMode === FACE.PATH) ENG.faceTowards(sim, t, wp.x, wp.y, dt, 6);
      }
    }
  } else {
    t.moving = false;
  }

  // 本帧实际速度（供「同速」参考）
  t.curSpeed = dt > 0 ? Math.hypot(t.x - px0, t.y - py0) / dt : 0;

  // 冲刺脚步声：DK2 里冲刺很快但很吵，「静默」（Go Silent）因此才有意义。
  // 注意 type 用 'step'：它不在行刑者的处决触发条件（shot/kick/breach/glass/boom）里，
  // 所以跑动不会导致人质被提前处决。
  if (t.moving && t.sprint && !t.action && !t.halted) {
    t.stepNoiseT = (t.stepNoiseT || 0) + dt;
    if (t.stepNoiseT > 0.55) {
      t.stepNoiseT = 0;
      ENG.makeNoise(sim, t.x, t.y, t.goSilent ? 2.5 : 7, 'step');
    }
  } else {
    t.stepNoiseT = 0;
  }

  // 玩家队员之间的软推挤：避免完全重叠，但不阻塞移动
  EngMove.pushApart(sim, t);

  /* --- 2. 朝向逻辑 --- */
  // 临时朝向（右键轻点/拖拽松手设的）：一旦开始移动就失效，恢复沿路径朝向。
  if (t.faceTemp && t.moving && t.faceMode === FACE.FOCUS) {
    t.faceTemp = false;
    t.faceMode = FACE.PATH;
  }

  // 切角（DK2 的 Slice the Pie）：下一个路径点带 FOCUS 标记时，
  // 从当前位置走到那个点的【整段路上】都持续转向对准注视点 ——
  // 所以绕着拐角画弧线走位时，视野锥会跟着扫过去。
  // 到达后由 runWaypointAction 把 faceMode 固定成 FOCUS，于是继续切角，
  // 直到遇到"取消点"或新的朝向命令。
  const head = (t.path && t.path.length) ? t.path[0] : null;
  if (head && head.faceMode === FACE.FOCUS && head.lookX !== undefined) {
    t.faceMode = FACE.FOCUS;
    t.lookX = head.lookX; t.lookY = head.lookY;
    t.faceTemp = false;
  }

  // 「贴身轴线」：附近有敌人时转向更快（用上一帧的可见目标判断，足够）
  let turnMul = 1;
  {
    const mods = sim.doct;
    const um = (mods && t.side === 'player') ? DOCTRINE.unitMod(mods, t.weapon) : null;
    if (um && um.closeDist > 0 && um.turnMul > 1) {
      const en = (t.visible && t.visible.enemies) || [];
      for (const e of en) {
        if (ENG.dist(t, e) <= um.closeDist) { turnMul = um.turnMul; break; }
      }
    }
  }

  if (t.faceMode === FACE.HARD) {
    // 固定角度（Strafe）：角度在世界坐标里不变，边走边保持同一个朝向
    const ang = ENG.angDiff(t.hardFace || t.face, t.face);
    t.face += Math.sign(ang) * Math.min(Math.abs(ang), 4.5 * dt * turnMul);
  } else if (t.faceMode === FACE.FOCUS) {
    // 注视某点（切角）：锥随位置变化而扫动
    ENG.faceTowards(sim, t, t.lookX, t.lookY, dt, 3.4 * turnMul);
  } else if (!t.moving) {
    // 静止时保持朝向
  }

  /* --- 3. 视觉目标 & 搜索模式 --- */
  t.visible = ENG.findVisibleTargets(sim, t);

  // 自动交战：按 rules of engagement
  if (t.roe === 'free' && t.visible.enemies.length) {
    // 选最近的
    const tgt = t.visible.enemies.sort((a, b) => ENG.dist(t, a) - ENG.dist(t, b))[0];
    ENG.trooperShoot(sim, t, tgt, dt);
  } else if (t.roe === 'hold' && t.visible.enemies.length) {
    t.holdFireWarn = true;
  } else t.holdFireWarn = false;

  // 反应：被射击会转向攻击者
  // （hurtT 的递减已统一到 ENG.updateUnit，这里只负责转向）
  if (t.hurtT > 0 && t.attackSource) {
    const a = ENG.angleTo(t, t.attackSource);
    if (t.faceMode === FACE.PATH || t.faceMode === FACE.HARD) {
      const d2 = ENG.angDiff(a, t.face);
      t.face += Math.sign(d2) * Math.min(Math.abs(d2), 9 * dt);
    }
  }

  /* --- 4. 当前动作（开门/破门/逮捕/拆弹） --- */
  if (t.action) {
    t.action.t += dt * 1000;
    const act = t.action;
    if (act.t >= act.dur) {
      ENG.completeAction(sim, t, act);
      t.action = null;
    } else {
      t.moving = false;
    }
  }

  /* --- 5. 换弹 / 自动切副武器 --- */
  if (t.ammo <= 0 && !t.reloading) {
    const mods = sim.doct;
    let swapped = false;
    // 「切换」信条：主武器打空且副武器还有弹时，掏副武器而不是原地换弹
    if (mods && t.side === 'player' && mods.global.autoTransition &&
        t.secondary && t.secondary !== t.weapon) {
      const other = (t.weapon === t.secondary && t.primaryW) ? t.primaryW : t.secondary;
      const ow = DATA.WEAPONS[other];
      const store = t.ammoStore || {};
      const otherAmmo = (store[other] === undefined) ? (ow ? ow.mag : 0) : store[other];
      if (otherAmmo > 0) swapped = ENG.swapWeapon(sim, t);
    }
    if (!swapped) {
      t.reloading = true;
      t.reloadT = ENG.reloadDur(sim, t);
    }
  }
  if (t.reloading) {
    t.reloadT -= dt * 1000;
    if (t.reloadT <= 0) {
      const w = DATA.WEAPONS[t.weapon];
      t.ammo = w ? w.mag : 30;
      t.ammoStore = t.ammoStore || {};
      t.ammoStore[t.weapon] = t.ammo;
      t.reloading = false;
    }
  }
};

/* 找可见目标（含搜索模式） */
ENG.findVisibleTargets = function (sim, t) {
  const g = sim.grid;
  const res = { enemies: [], neutrals: [], interactive: [] };

  for (const u of sim.units) {
    if (!u.alive || u === t) continue;
    const d = ENG.dist(t, u);
    let range = t.sight * 1.15;
    if (sim.night && !t.hasNVG) range *= 0.45;

    // 搜索模式：狙击手/指定搜索区域
    let inCone = ENG.inCone(g, t, u, { range, fov: t.fov });
    if (!inCone && t.searchZone) {
      const dz = Math.hypot(t.searchZone.x - u.x, t.searchZone.y - u.y);
      if (dz < t.searchZone.r && ENG.hasLOS(g, t, u)) inCone = true;
    }
    if (!inCone) continue;

    if (u.side !== 'player' && u.side !== 'neutral') {
      // 敌人：蹲在掩体后更难发现
      if (u.crouch && d > 5 && !ENG.hasLOS(g, t, u)) continue;
      res.enemies.push(u);
    } else if (u.side === 'neutral') {
      res.neutrals.push(u);
      if (!u.found) { u.found = true; }
    }
  }

  // 可交互物件（门、配电箱、炸弹、人质）
  const tx = Math.floor(t.x), ty = Math.floor(t.y);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx, y = ty + dy;
      const tt = MAPGEN.at(g, x, y);
      if (tt === MAPGEN.T.DOOR || tt === MAPGEN.T.LOCKED) {
        const dr = g.doors.find(dd => dd.x === x && dd.y === y);
        if (dr && !dr.open && !dr.broken) res.interactive.push({ kind: 'door', door: dr, x: x + .5, y: y + .5 });
      }
    }
  if (sim.powerBox && !sim.powerBox.off && Math.hypot(sim.powerBox.x + .5 - t.x, sim.powerBox.y + .5 - t.y) < 1.3)
    res.interactive.push({ kind: 'power', x: sim.powerBox.x + .5, y: sim.powerBox.y + .5 });
  if (sim.bomb && !sim.bomb.defused && Math.hypot(sim.bomb.x - t.x, sim.bomb.y - t.y) < 1.3)
    res.interactive.push({ kind: 'bomb', x: sim.bomb.x, y: sim.bomb.y });

  // 躺地/可逮捕的敌人
  for (const u of sim.units) {
    if (!u.alive || u.side === 'player') continue;
    if (u.side === 'neutral' && u.role === 'hvt' && u.surrendering &&
        ENG.dist(t, u) < 1.4) res.interactive.push({ kind: 'arrest', unit: u, x: u.x, y: u.y });
    if (u.side === 'neutral' && (u.role === 'hostage' || u.role === 'vip') && !u.freed &&
        ENG.dist(t, u) < 1.4) res.interactive.push({ kind: 'free', unit: u, x: u.x, y: u.y });
  }
  return res;
};

/* 队员开火 */
ENG.trooperShoot = function (sim, t, target, dt) {
  const w = DATA.WEAPONS[t.weapon];
  if (!w) return;
  if (t.action) return;
  if (t.ammo <= 0) return;

  const d = ENG.dist(t, target);

  // 战术信条：按当前手里的武器决定吃哪棵树（手枪系 / 长枪系）
  const mods = sim.doct;
  const isPlayer = t.side === 'player';
  const um = (mods && isPlayer) ? DOCTRINE.unitMod(mods, t.weapon) : null;

  // 朝向
  const a = ENG.angleTo(t, target);
  const off = Math.abs(ENG.angDiff(a, t.face));
  if (off > 0.9) return;  // 太偏了，先转

  // 首次发现目标 -> 反应延迟（SWAT 优势：远快于叛军）
  if (t.reactedTo !== target) {
    t.reactedTo = target;
    let rt = t.react || 700;
    if (mods && isPlayer) rt *= mods.global.reactMul;   // 「快速拔枪」
    t.reactionT = rt;
  }
  if (t.reactionT > 0) return;

  if (t.cooldownT > 0) return;

  // 瞄准时间
  if (t.aimT <= 0) {
    let aim = w.aim[0] + ENG.rng(sim) * (w.aim[1] - w.aim[0]);
    aim *= ENG.edgePenalty(t, target, t.fov);
    if (t.moving) aim *= 1.7;
    if (t.suppressT > 0) aim *= 1.55;
    if (t.crouch) aim *= 0.8;
    // 技能加成
    aim *= (1 - (t.skill.marksmanship - 5) * 0.035);
    // 信条：近距 / 远距瞄准时间
    if (um) {
      if (um.nearDist > 0 && d <= um.nearDist) aim *= um.aimMulNear;
      if (um.farDist > 0 && d > um.farDist) aim *= um.aimMulFar;
    }
    t.aimT = Math.max(60, aim);
    return;
  }

  // 开火
  const shots = (w.shots || 1) + (um ? um.shotsAdd : 0);   // 「双击」
  t.muzzleT = 70;
  t.ammo -= Math.min(t.ammo, shots);
  t.cooldownT = w.reset + (w.burst || 0) * shots;
  sim.stats.shotsFired++;
  sim.fx.push({ type: 'flash', x: t.x, y: t.y, ang: t.face, t: 0.07, host: t });
  // 「静默」：消音武器开火噪音再降
  let sound = w.sound;
  if (mods && isPlayer && w.sound <= 10) sound *= mods.global.silencedNoiseMul;
  ENG.makeNoise(sim, t.x, t.y, sound, 'shot');

  // 命中
  const tt = Math.min(1, d / Math.max(1, w.range));
  // 基础精度（近距离 start，远距离 end）
  let acc = (w.start + (w.end - w.start) * tt);
  // 技能加成
  acc *= (1 + (t.skill.marksmanship - 5) * 0.05);
  // 信条：全距离 / 中距离 / 远距离 / 掩体后 精度加成
  if (um) {
    acc += um.accAdd;
    if (um.midHi > um.midLo && d >= um.midLo && d <= um.midHi) acc += um.accAddMid;
    if (um.farDist > 0 && d > um.farDist) acc += um.accAddFar;
    if (um.accAddCover > 0 && MAPGEN.coverAt(sim.grid, Math.floor(t.x), Math.floor(t.y)) > 0) acc += um.accAddCover;
  }
  // 状态修正
  if (t.moving) acc *= 0.68;
  if (t.crouch) acc *= 1.06;
  if (t.suppressT > 0) acc *= 0.62;
  // 难度只应作用于敌人，玩家精度不受难度惩罚
  acc = Math.max(8, Math.min(97, acc));

  // 目标掩体
  let cover = 0;
  if (target.crouch) cover += 0.32;
  cover += MAPGEN.coverAt(sim.grid, Math.floor(target.x), Math.floor(target.y)) * 0.45;
  if (target.coverDir !== undefined) {
    const fromDir = Math.atan2(t.y - target.y, t.x - target.x);
    if (Math.abs(ENG.angDiff(fromDir, target.coverDir)) > Math.PI * 0.55) cover = 0;
  }
  // 「破掩体」：削减目标掩体带来的减伤
  if (um && um.negateCover > 0) cover *= (1 - um.negateCover);

  const hit = ENG.rng(sim) * 100 < acc * (1 - cover * 0.9);

  if (hit) {
    let critChance = w.crit * (1 + (t.skill.marksmanship - 5) * 0.06);
    // 「背刺」：对尚未察觉你的目标暴击率提升
    if (um && um.backstabCrit > 0 && target.reactedTo !== t) critChance += um.backstabCrit;
    // 「莫桑比克」：手枪连续命中同一目标的第 3 发必暴击
    let mozForce = false;
    if (um && um.mozambique) {
      if (t.mozTarget !== target) { t.mozTarget = target; t.mozCount = 0; }
      t.mozCount = (t.mozCount || 0) + 1;
      if (t.mozCount >= 3) { mozForce = true; t.mozCount = 0; }
    }
    const crit = mozForce || ENG.rng(sim) * 100 < critChance;
    let dmg = w.dmg;
    if (crit) dmg *= 2.6;
    const armor = DATA.ARMOR[target.armor] || DATA.ARMOR.none;
    if (w.pen <= armor.level) {
      const ratio = w.pen / Math.max(1, armor.level);
      dmg *= 0.18 + ratio * 0.22;
      // 插板侧后方暴露 -> 伤害翻倍
      if (armor.side) {
        const fromDir = Math.atan2(t.y - target.y, t.x - target.x);
        const face = target.coverDir === undefined ? target.face : target.coverDir;
        if (Math.abs(ENG.angDiff(fromDir, face)) > 1.0) dmg *= 2.2;
      }
    }
    dmg *= (0.85 + ENG.rng(sim) * 0.3);
    target.attackSource = { x: t.x, y: t.y };
    ENG.damage(sim, target, dmg, t, crit);
    sim.stats.shotsHit++;
  } else {
    sim.stats.shotsMissed++;
    // 打碎玻璃
    if (ENG.rng(sim) < 0.12) {
      const mx = Math.floor(target.x + (ENG.rng(sim) - 0.5) * 2.5);
      const my = Math.floor(target.y + (ENG.rng(sim) - 0.5) * 2.5);
      if (MAPGEN.at(sim.grid, mx, my) === MAPGEN.T.WINDOW) {
        sim.grid.tiles[my][mx] = MAPGEN.T.FLOOR;
        ENG.makeNoise(sim, mx, my, DATA.NOISE.breakGlass, 'glass');
      }
    }
  }
};

ENG.hasVisibleEnemy = function (sim, t) {
  return t.visible && t.visible.enemies && t.visible.enemies.length > 0;
};

/* ---------- 路径点动作 ---------- */
ENG.runWaypointAction = function (sim, t, wp) {
  // 取消点：清除此前的朝向模式（停止切角 / 解除固定角度），
  // 并清掉后续路径上的朝向标记 —— 对齐 DK2 的 Cancel point。
  if (wp.cancel) {
    t.faceMode = FACE.PATH;
    t.faceTemp = false;
    if (t.path) {
      t.path.forEach(w => {
        if (w.faceMode === FACE.FOCUS || w.faceMode === FACE.HARD) {
          delete w.faceMode; delete w.lookX; delete w.lookY; delete w.face;
        }
      });
    }
  }
  if (wp.faceMode === FACE.HARD) { t.faceMode = FACE.HARD; t.hardFace = wp.face; }
  if (wp.faceMode === FACE.FOCUS) { t.faceMode = FACE.FOCUS; t.lookX = wp.lookX; t.lookY = wp.lookY; }
  if (wp.crouch !== undefined) t.crouch = wp.crouch;
  if (wp.sprint !== undefined) t.sprint = wp.sprint;
  // 节点级装备/姿态动作（对齐 DK2 右键菜单里的 Reload / Swap Weapon）
  // 先换枪再换弹：否则换枪会把换弹进度清掉
  if (wp.swap) ENG.swapWeapon(sim, t);
  if (wp.reload) { t.reloading = true; t.reloadT = ENG.reloadDur(sim, t); }
  if (wp.silent !== undefined) t.goSilent = wp.silent;
  if (wp.autoShoot !== undefined) t.autoShoot = wp.autoShoot;
  if (wp.grenade) ENG.doGrenade(sim, t, wp.grenade);
  if (wp.breach) ENG.startAction(sim, t, { kind: 'breach', door: wp.door, method: wp.method, dur: ENG.breachDur(sim, t, wp.method, wp.door) });
  if (wp.arrest && wp.unit) ENG.startAction(sim, t, { kind: 'arrest', unit: wp.unit, dur: 1200 });
  if (wp.free && wp.unit) ENG.startAction(sim, t, { kind: 'free', unit: wp.unit, dur: 900 });
  if (wp.power) ENG.startAction(sim, t, { kind: 'power', dur: 2600 });
  if (wp.defuse) ENG.startAction(sim, t, { kind: 'defuse', dur: ENG.defuseDur(sim, t) });
  if (wp.wait) t.waitT = wp.wait;
};

ENG.startAction = function (sim, t, act) {
  if (t.action) return;
  act.t = 0;
  t.action = act;
  t.moving = false;
};

ENG.completeAction = function (sim, t, act) {
  const g = sim.grid;
  if (act.kind === 'breach') {
    const d = act.door;
    if (!d) return;
    if (act.method === 'kick') {
      d.open = true; d.broken = true; d.locked = false;
      // 眩晕门口敌人
      ENG.makeNoise(sim, d.x + .5, d.y + .5, ENG.breachNoise(sim, t, DATA.NOISE.kickDoor), 'kick');
      sim.units.forEach(u => {
        if (!u.alive || u.side === 'player') return;
        if (Math.hypot(u.x - (d.x + .5), u.y - (d.y + .5)) < 2.6) u.stunT = 2200;
      });
      sim.stats.doorsKicked++;
    } else if (act.method === 'hand') {
      d.open = true;
      ENG.makeNoise(sim, d.x + .5, d.y + .5, ENG.breachNoise(sim, t, DATA.NOISE.openDoor), 'door');
      sim.stats.doorsOpened++;
    } else if (act.method === 'crowbar' || act.method === 'bolt' || act.method === 'shotgun') {
      d.open = true; d.broken = true; d.locked = false;
      const n = act.method === 'shotgun' ? DATA.NOISE.shotgunBreach : (act.method === 'bolt' ? DATA.NOISE.boltCutter : DATA.NOISE.crowbar);
      ENG.makeNoise(sim, d.x + .5, d.y + .5, ENG.breachNoise(sim, t, n), 'breach');
      if (act.method === 'shotgun') {
        sim.units.forEach(u => {
          if (!u.alive || u.side === 'player') return;
          if (Math.hypot(u.x - (d.x + .5), u.y - (d.y + .5)) < 3.2) u.stunT = 2600;
        });
      }
      sim.stats.doorsForced++;
    } else if (act.method === 'charge') {
      // 安放 -> 引爆（这里简化：一次完成）
      ENG.detonate(sim, { x: d.x + .5, y: d.y + .5, x0: 0 }, 2.2, 55);
      d.open = true; d.broken = true; d.locked = false;
      sim.stats.wallsBreached++;
    }
  }
  if (act.kind === 'wallcharge') {
    const g2 = sim.grid;
    g2.tiles[act.wy][act.wx] = MAPGEN.T.FLOOR;
    ENG.detonate(sim, { x: act.wx + .5, y: act.wy + .5 }, 2.4, 60);
    sim.stats.wallsBreached++;
  }
  if (act.kind === 'arrest' && act.unit) {
    act.unit.arrested = true;
    act.unit.side = 'neutral';
    act.unit.role = 'detained';
    sim.stats.arrested++;
    ENG.makeNoise(sim, act.unit.x, act.unit.y, DATA.NOISE.arrest, 'arrest');
    sim.fx.push({ type: 'text', x: act.unit.x, y: act.unit.y, text: '已逮捕', color: '#7fc8ff', t: 2 });
  }
  if (act.kind === 'free' && act.unit) {
    act.unit.freed = true;
    act.unit.order = 'follow';
    sim.fx.push({ type: 'text', x: act.unit.x, y: act.unit.y, text: '已解救', color: '#8fe08f', t: 2 });
    ENG.makeNoise(sim, act.unit.x, act.unit.y, 2, 'free');
  }
  if (act.kind === 'power') {
    sim.powerBox.off = true;
    sim.night = true;
    ENG.makeNoise(sim, sim.powerBox.x + .5, sim.powerBox.y + .5, 14, 'power');
    sim.fx.push({ type: 'text', x: sim.powerBox.x, y: sim.powerBox.y, text: '已断电', color: '#ffd479', t: 2.5 });
  }
  if (act.kind === 'defuse' && sim.bomb) {
    sim.bomb.defused = true;
    sim.stats.defused = true;
    sim.fx.push({ type: 'text', x: sim.bomb.x, y: sim.bomb.y, text: '炸弹已拆除', color: '#8fe08f', t: 3 });
  }
};

/* ---------- 投掷物 ---------- */
ENG.doGrenade = function (sim, t, g) {
  const speed = 11;
  const from = { x: t.x, y: t.y };
  const dx = g.tx - from.x, dy = g.ty - from.y;
  const dist = Math.hypot(dx, dy);
  const flight = Math.min(1.6, dist / speed);
  sim.projectiles.push({
    type: g.type, x: from.x, y: from.y,
    tx: g.tx, ty: g.ty,
    sx: from.x, sy: from.y,
    t: 0, dur: flight,
    fuse: g.type === 'frag' ? 2.6 : 1.5
  });
  sim.stats.grenades++;
};

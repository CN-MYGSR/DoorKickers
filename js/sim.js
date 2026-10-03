/* ============================================================
   DK2D - 模拟器主循环
   任务装配 / 单位生成 / 投掷物 / GO Code / 胜负 / 星级评分
   ============================================================ */
const SIM = {};

SIM.state = {
  sim: null,
  mode: 'menu',        // menu | brief | planning | live | paused | result
  selected: [],
  hoverWaypoint: null,
  drag: null,
  speed: 1,
  zoom: 1,
  cam: { x: 0, y: 0 },
  showPlans: true,
  showFov: true,
  showGrid: false,
  tool: null,          // breach / grenade / wallcharge
  pendingGrenade: null,
  ghost: null
};

/* 任务列表 —— 按 DK2 的单人任务合集组织
   敌人数量按 DK2 实际比例：4 人小队对面约 8-16 人
   timeBeat 为三星达标时间 */
SIM.MISSIONS = [
  { id:'m01', cat:'新兵入门', name:'第一次破门', type:'clear',   seed:1011, gridW:38, gridH:28, squadSize:3, roomCount:5, enemies:6,  timeBeat:70,  diff:'normal',
    desc:'小房间，低威胁目标。适合熟悉视野锥、踹门和 GO Code。', enemyMix:['rabble','rabble','grunt'] },
  { id:'m02', cat:'新兵入门', name:'走廊清剿',   type:'clear',   seed:1022, gridW:42, gridH:30, squadSize:3, roomCount:6, enemies:8,  timeBeat:85,  diff:'normal',
    desc:'长走廊 + 多房间，练习切角与分段推进。', enemyMix:['rabble','grunt','pistoler'] },
  { id:'m03', cat:'新兵入门', name:'人质在楼上', type:'hostage', seed:1033, gridW:44, gridH:32, squadSize:3, roomCount:6, enemies:9,  timeBeat:105, diff:'normal',
    desc:'两名平民被扣押。注意火线 —— 平民被击中会掉星。', enemyMix:['grunt','pistoler','veteran'] },

  { id:'m04', cat:'北方特遣队', name:'院落突袭', type:'clear',    seed:2044, gridW:46, gridH:32, squadSize:4, roomCount:7, enemies:11, timeBeat:115, diff:'normal',
    desc:'带院子的复合建筑，正门是杀伤区，考虑破墙。', enemyMix:['grunt','veteran','machinegun'] },
  { id:'m05', cat:'北方特遣队', name:'定时炸弹', type:'bomb',     seed:2055, gridW:46, gridH:34, squadSize:4, roomCount:7, enemies:11, timeBeat:125, diff:'normal',
    desc:'炸弹倒计时 3 分钟。拆弹噪音小，但别把它留在最后。', enemyMix:['grunt','veteran','rocket'] },
  { id:'m06', cat:'北方特遣队', name:'处决现场', type:'execute',  seed:2066, gridW:48, gridH:34, squadSize:4, roomCount:8, enemies:12, timeBeat:100, diff:'hard',
    desc:'行刑者已就位。看到同伴尸体、听到枪声或看到门被打开都会提前动手。', enemyMix:['grunt','executioner','veteran','executioner'] },

  { id:'m07', cat:'斩首行动', name:'名单上的名字', type:'hvt',    seed:3077, gridW:48, gridH:36, squadSize:4, roomCount:8, enemies:12, timeBeat:140, diff:'hard',
    desc:'目标平民打扮，靠近就会逃。用瞄准逼停而不是开枪。', enemyMix:['grunt','pistoler','advisor'] },
  { id:'m08', cat:'斩首行动', name:'外国顾问',     type:'clear',  seed:3088, gridW:50, gridH:36, squadSize:4, roomCount:9, enemies:14, timeBeat:145, diff:'hard',
    desc:'顾问视野 110°，比普通敌人宽得多。他会鼓舞周围的叛军。', enemyMix:['grunt','veteran','advisor','machinegun'] },
  { id:'m09', cat:'斩首行动', name:'自杀背心',     type:'hostage',seed:3099, gridW:48, gridH:34, squadSize:4, roomCount:8, enemies:13, timeBeat:130, diff:'hard',
    desc:'楼里有自杀袭击者。他们要贴近才会引爆，但有队友在就麻烦了。', enemyMix:['grunt','bomber','bomberS','veteran'] },

  { id:'m10', cat:'深入敌后', name:'黑账本',   type:'clear',   seed:4101, gridW:52, gridH:38, squadSize:4, roomCount:10, enemies:15, timeBeat:160, diff:'expert',
    desc:'雇佣兵驻守，III 级插板。穿甲值不够就得换枪。', enemyMix:['merc','merc','veteran','machinegun','advisor'] },
  { id:'m11', cat:'深入敌后', name:'专家难度·围城', type:'execute', seed:4102, gridW:54, gridH:40, squadSize:4, roomCount:10, enemies:14, timeBeat:150, diff:'expert',
    desc:'视野 120°、反应 0.5 秒的敌人。侦察投入每一秒都值得。', enemyMix:['qrf','merc','juggernaut','sniper','advisor'] },
  { id:'m12', cat:'深入敌后', name:'SSI 特战',    type:'vip',   seed:4103, gridW:54, gridH:40, squadSize:4, roomCount:10, enemies:13, timeBeat:185, diff:'expert',
    desc:'对面是最危险的单位：IV 级插板、消音武器、会包抄。护送要员穿越市中心。', enemyMix:['ssi','ssi','qrf','sniper'] }
];

SIM.DIFF_LABEL = { normal: '普通', hard: '困难', expert: '专家' };

/* ---------- 装配任务 ---------- */
SIM.startMission = function (mission, loadout, opts) {
  const def = mission;
  const grid = MAPGEN.generate(def);
  const diff = DATA.DIFFICULTY[def.diff] || DATA.DIFFICULTY.normal;

  // 种子化随机：同一任务 + 同一种子 => 完全可复现的战斗过程
  const battleSeed = (opts && opts.seed !== undefined) ? opts.seed : (def.seed * 7919 + 13);
  let rngState = battleSeed >>> 0;
  const rng = () => {
    rngState = (rngState + 0x6D2B79F5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rand = (a, b) => rng() * (b - a) + a;
  const randInt = (a, b) => Math.floor(rng() * (b - a + 1)) + a;

  const sim = {
    mission: def,
    grid,
    difficulty: diff,
    diffKey: def.diff,
    seed: battleSeed,
    rng,
    time: 0,
    dt: 1 / 60,
    units: [],
    troopers: [],
    projectiles: [],
    fx: [],
    noiseEvents: [],
    night: false,
    powerBox: grid.powerBox,
    bomb: null,
    stats: {
      shotsFired: 0, shotsHit: 0, shotsMissed: 0,
      kills: 0, deaths: 0, civDeaths: 0,
      arrested: 0, doorsKicked: 0, doorsOpened: 0, doorsForced: 0,
      wallsBreached: 0, grenades: 0, defused: false, paused: 0,
      planChanges: 0, singlePlan: true
    },
    over: false,
    win: false,
    failReason: '',
    startTime: 0,
    execLimit: def.type === 'execute' ? 55 : 0,
    obj: { enemiesLeft: 0, hostagesTotal: 0, hostagesSaved: 0 },
    pendingGrenades: [],
    goCodes: ['A', 'B', 'C', 'D'],
    goAuto:  { A: false, B: false, C: false, D: false },   // 该 GO Code 是否自动触发
    goFired: { A: false, B: false, C: false, D: false },   // 本轮是否已触发过
    goArmed: { A: false, B: false, C: false, D: false },   // 是否"有人在动、等着到位"
    selWp: null,   // 当前选中的路径节点（细分规划用）
    // 战术信条：开局快照一次，避免每帧重复聚合（菜单里改信条不会影响进行中的任务）
    doct: (typeof DOCTRINE !== 'undefined') ? DOCTRINE.mods() : null
  };

  /* --- 玩家队员 --- */
  const spawns = grid.spawns.slice();
  loadout.forEach((lo, i) => {
    const sp = spawns[i] || spawns[0] || { x: 2, y: 2 };
    const t = SIM.makeUnit({
      side: 'player',
      name: lo.name || ('队员' + (i + 1)),
      cls: lo.cls,
      weapon: lo.primary,
      secondary: lo.secondary || 'G17',
      armor: lo.armor || 'plate3',
      helmet: lo.helmet !== false,
      nvg: !!lo.nvg,
      x: sp.x + 0.5, y: sp.y + 0.5,
      face: Math.PI / 2,
      skill: lo.skill || { marksmanship: 6, assault: 6, field: 6, mobility: 6 },
      gadgets: lo.gadgets || ['frag', 'flash', 'smoke'],
      breachTools: lo.breachTools || ['hand', 'kick']
    });
    t.goCode = lo.goCode || 'A';
    t.roe = 'free';
    t.faceMode = FACE.PATH;
    t.sight = 12;
    t.fov = 90;
    t.hasNVG = !!lo.nvg;
    // 「停下射击 / 不停下」的默认值。
    // DK2 的默认是「等待清空」（看见敌人就停下打），但本作原本是按「边走边打」调的平衡。
    // A/B 实测（5 组种子）：停下射击 53/60，边走边打 56/60 —— 所以默认沿用后者，
    // 想体验 DK2 手感按 Shift+` 全体切换，也可以在单个路径节点上单独设置。
    t.autoShoot = (typeof globalThis !== 'undefined' && globalThis.__DK2D_FORCE_AUTOSHOOT) ? true : false;
    t.goSilent = false;
    t.halted = false;
    // SWAT 的核心优势：反应远快于叛军（DK2 里队员反应约 0.5~0.7s，
    // 而普通叛军要 1.5s+）。用 assault 技能微调，技能越高越快。
    t.react = 700 - (t.skill.assault - 5) * 60;   // 技能5 -> 700ms，技能9 -> 460ms
    t.speed = 2.5 + (t.skill.mobility - 5) * 0.09;
    t.visualPath = [];
    sim.troopers.push(t);
    sim.units.push(t);
  });

  /* --- 敌人 --- */
  const floors = [];
  for (let y = 0; y < grid.h; y++)
    for (let x = 0; x < grid.w; x++)
      if (grid.tiles[y][x] === MAPGEN.T.FLOOR) floors.push({ x, y });
  SIM.shuffle(floors, def.seed + 7);

  // 距任一出生点的最小距离（格）：避免开局就贴脸遭遇
  const MIN_SPAWN_DIST = 11;
  const farFromSpawn = (f) => grid.spawns.every(s =>
    Math.hypot(f.x - s.x, f.y - s.y) >= MIN_SPAWN_DIST);

  // 尽量把敌人分到不同房间
  const pickSpots = (n) => {
    const out = [];
    const roomOrder = grid.rooms.slice().sort(() => rng() - 0.5);
    let ri = 0;
    let guard = 0;
    while (out.length < n && guard++ < 900) {
      const room = roomOrder[ri % Math.max(1, roomOrder.length)];
      const cand = floors.filter(f =>
        f.x >= room.x && f.x < room.x + room.w && f.y >= room.y && f.y < room.y + room.h &&
        farFromSpawn(f) &&
        !out.some(o => o.x === f.x && o.y === f.y));
      if (cand.length) out.push(cand[Math.floor(rng() * cand.length)]);
      ri++;
      if (ri > 600) break;
    }
    // 兜底：放宽距离要求
    guard = 0;
    while (out.length < n && guard++ < 600) {
      const f = floors[Math.floor(rng() * floors.length)];
      if (f && !out.some(o => o.x === f.x && o.y === f.y)) out.push(f);
    }
    return out;
  };

  const spots = pickSpots(def.enemies);
  const mix = def.enemyMix && def.enemyMix.length ? def.enemyMix : ['grunt'];
  spots.forEach((sp, i) => {
    const key = mix[i % mix.length];
    const edef = DATA.ENEMIES[key] || DATA.ENEMIES.grunt;
    const e = SIM.makeUnit({
      side: 'hostile',
      name: edef.name,
      enemyKey: key,
      weapon: edef.weapon,
      armor: edef.armor,
      x: sp.x + 0.5, y: sp.y + 0.5,
      face: rng() * Math.PI * 2
    });
    e.fov = edef.fov;
    e.sight = edef.sight;
    e.react = edef.react;
    e.hp = edef.hp; e.maxHp = edef.hp;
    e.ai = edef.ai.slice();
    e.threat = edef.threat;
    e.color = edef.color;
    e.speed = 2.3;

    // 状态分配
    if (e.ai.includes('executioner')) {
      // 行刑者默认守卫状态；只有被触发才会去执行处决（对齐 DK2）
      e.state = 'idle';
      e.isExecutioner = true;
      // 行刑者守在能看到人质的位置，但不主动处决
      const hs0 = sim.units.filter(o => o.role === 'hostage');
      if (hs0.length) e.guardNear = { x: hs0[0].x, y: hs0[0].y };
    }
    else if (e.ai.includes('suicide')) { e.state = 'idle'; e.blowsOnDeath = true; }
    else if (e.ai.includes('sniper')) e.state = 'sniper';
    else if (e.ai.includes('patrol')) {
      e.state = 'patrol';
      const r = grid.rooms[Math.floor(rng() * grid.rooms.length)];
      e.patrolPts = [];
      for (let k = 0; k < 3; k++) {
        const px = r.x + 1 + Math.floor(rng() * Math.max(1, r.w - 2));
        const py = r.y + 1 + Math.floor(rng() * Math.max(1, r.h - 2));
        if (MAPGEN.canWalk(grid, px, py)) e.patrolPts.push({ x: px + .5, y: py + .5 });
      }
      if (e.patrolPts.length < 2) e.state = 'idle';
    } else e.state = 'idle';

    sim.units.push(e);
  });

  /* --- 平民 --- */
  const civN = def.type === 'clear' ? 2 + Math.floor(rng() * 3) : 2;
  const cspots = pickSpots(civN + (def.type === 'hostage' || def.type === 'execute' ? 3 : 0) + (def.type === 'hvt' ? 6 : 0) + (def.type === 'vip' ? 1 : 0));
  let ci = civN;
  for (let i = 0; i < civN && i < cspots.length; i++) {
    const c = SIM.makeUnit({ side: 'neutral', name: '平民', role: 'civ', x: cspots[i].x + .5, y: cspots[i].y + .5, face: rng() * 6.28 });
    c.color = '#c9d4e0'; c.speed = 2.4;
    sim.units.push(c);
  }

  /* --- 人质 --- */
  if (def.type === 'hostage' || def.type === 'execute') {
    const n = 2;
    for (let i = 0; i < n; i++) {
      const s = cspots[ci++];
      if (!s) break;
      const h = SIM.makeUnit({ side: 'neutral', name: '人质', role: 'hostage', x: s.x + .5, y: s.y + .5, face: rng() * 6.28 });
      h.color = '#ffd479';
      h.freed = false;
      sim.units.push(h);
      sim.obj.hostagesTotal++;

      // 行刑者与人质保持距离：太近会让开局就无法挽救
      if (def.type === 'execute') {
        sim.units.forEach(o => {
          if (!o.isExecutioner) return;
          const dd = Math.hypot(o.x - h.x, o.y - h.y);
          if (dd < 3.5) {
            // 把人质挪到同房间内更远的位置
            const r = grid.rooms.find(rr =>
              h.x >= rr.x && h.x < rr.x + rr.w && h.y >= rr.y && h.y < rr.y + rr.h);
            if (r) {
              for (let tries = 0; tries < 60; tries++) {
                const nx = r.x + 1 + Math.floor(rng() * Math.max(1, r.w - 2));
                const ny = r.y + 1 + Math.floor(rng() * Math.max(1, r.h - 2));
                if (!MAPGEN.canWalk(grid, nx, ny)) continue;
                const okFar = sim.units.filter(u => u.isExecutioner)
                  .every(e => Math.hypot(e.x - (nx + .5), e.y - (ny + .5)) >= 4.5);
                if (okFar) { h.x = nx + .5; h.y = ny + .5; break; }
              }
            }
          }
        });
      }
    }
  }

  /* --- HVT --- */
  if (def.type === 'hvt') {
    const s = cspots[ci++] || floors[floors.length - 1];
    const h = SIM.makeUnit({ side: 'neutral', name: '高价值目标', role: 'hvt', x: s.x + .5, y: s.y + .5, face: rng() * 6.28 });
    h.color = '#ff9d5c'; h.speed = 2.9;
    sim.units.push(h);
    sim.hvt = h;
  }

  /* --- VIP --- */
  if (def.type === 'vip') {
    // VIP 放在建筑深处
    const deep = floors[Math.floor(floors.length * 0.85)] || floors[floors.length - 1];
    const v = SIM.makeUnit({ side: 'neutral', name: '要员', role: 'vip', x: deep.x + .5, y: deep.y + .5, face: rng() * 6.28 });
    v.color = '#7fc8ff';
    sim.units.push(v);
    sim.vip = v;
    sim.obj.hostagesTotal++;
  }

  /* --- 炸弹 --- */
  if (def.type === 'bomb') {
    const s = floors[Math.floor(floors.length * 0.6)] || floors[0];
    sim.bomb = { x: s.x + .5, y: s.y + .5, timer: 180, defused: false };
  }

  /* --- 处决倒计时 --- */
  if (def.type === 'execute') {
    sim.execLimit = 50;
  }

  sim.obj.enemiesLeft = sim.units.filter(u => u.side === 'hostile').length;
  sim.obj.enemiesTotal = sim.obj.enemiesLeft;

  SIM.state.sim = sim;
  SIM.state.mode = 'planning';
  SIM.state.selected = sim.troopers.slice(0, 1);
  SIM.state.cam = { x: grid.w / 2, y: grid.h / 2 };
  SIM.state.planSnapshot = null;

  return sim;
};

SIM.shuffle = function (a, seed) {
  const r = mulberry32(seed || 5);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
};

SIM.makeUnit = function (o) {
  return Object.assign({
    id: Math.random().toString(36).slice(2, 9),
    alive: true,
    hp: 100, maxHp: 100,
    armor: 'none',
    crouch: false,
    sprint: false,
    moving: false,
    face: 0,
    fov: 90,
    sight: 12,
    react: 1500,
    speed: 2.4,
    radius: 0.34,
    cooldownT: 0,
    aimT: 0,
    reactionT: 0,
    suppressT: 0,
    stunT: 0,
    muzzleT: 0,
    hurtT: 0,
    alert: 0,
    state: 'idle',
    pathT: 0,
    ammo: 30,
    reloading: false,
    reloadT: 0
  }, o, {
    ammo: o.ammo !== undefined ? o.ammo : (DATA.WEAPONS[o.weapon] ? DATA.WEAPONS[o.weapon].mag : 30)
  });
};

/* ---------- 每帧推进 ---------- */
SIM.step = function (dt) {
  const sim = SIM.state.sim;
  if (!sim || sim.over) return;
  sim.time += dt;

  /* 投掷物 */
  for (let i = sim.projectiles.length - 1; i >= 0; i--) {
    const p = sim.projectiles[i];
    p.t += dt;
    // 弹道插值 + 抛物线高度（视觉）
    const f = Math.min(1, p.t / p.dur);
    p.x = p.sx + (p.tx - p.sx) * f;
    p.y = p.sy + (p.ty - p.sy) * f;
    p.h = Math.sin(f * Math.PI) * 1.2;
    if (f >= 1) {
      p.landed = true;
      p.fuseT = (p.fuseT || 0) + dt;
      if (p.type === 'frag') {
        if (p.fuseT > 2.4) { ENG.detonate(sim, p, 4.2, 80); sim.projectiles.splice(i, 1); }
      } else if (p.fuseT > 1.6) {
        ENG.grenadeEffect(sim, p);
        sim.projectiles.splice(i, 1);
      }
    }
  }

  /* 单位 */
  sim.units.forEach(u => ENG.updateUnit(sim, u, dt));
  sim.units = sim.units.filter(u => u.alive || (sim.time - (u.deathT || 0) < 0.05));

  /* GO Code 自动触发 */
  SIM.updateGoAuto(sim);

  /* 特效计时 */
  for (let i = sim.fx.length - 1; i >= 0; i--) {
    const f = sim.fx[i];
    if (f.type === 'corpse') continue;
    f.t -= dt;
    if (f.t <= 0) sim.fx.splice(i, 1);
  }
  sim.noiseEvents = sim.noiseEvents.filter(n => sim.time - n.t < 2.5);

  /* 炸弹倒计时 */
  if (sim.bomb && !sim.bomb.defused) {
    sim.bomb.timer -= dt;
    if (sim.bomb.timer <= 0) {
      ENG.detonate(sim, sim.bomb, 9, 200);
      SIM.fail(sim, '炸弹引爆');
    }
  }

  /* 处决机制（对齐 DK2）：
     - 行刑者平时守卫，不主动处决
     - 【看到队员】或【看到同伴/平民尸体】=> 立即转入处决（这是最直接的威胁）
     - 【听到很近的枪声/破门声（同房间或 7m 内）】=> 也转入处决
     - 远处枪声只会让它警戒（由 makeNoise 处理），不会直接处决人质 */
  const executioners = sim.units.filter(u => u.alive && u.side === 'hostile' && u.isExecutioner);
  executioners.forEach(e => {
    if (e.state === 'execution') return;

    const hears = sim.noiseEvents.some(n => {
      const combat = n.type === 'shot' || n.type === 'kick' || n.type === 'breach' ||
                     n.type === 'glass' || n.type === 'boom';
      if (!combat) return false;
      if (Math.hypot(n.x - e.x, n.y - e.y) > 7) return false;   // 必须很近
      return true;
    });
    const seesBody = sim.fx.some(f => f.type === 'corpse' &&
      Math.hypot(f.x - e.x, f.y - e.y) < 8 && ENG.hasLOS(sim.grid, e, f));

    if (e.visibleTarget || hears || seesBody) {
      e.state = 'execution';
      if (!sim.execTimerOn) {
        sim.execTimerOn = true;
        sim.execLeft = sim.execLimit;
        sim.fx.push({ type: 'text', x: e.x, y: e.y, text: '⚠ 行刑者动了!', color: '#ff5c5c', t: 3.5 });
      }
    }
  });

  if (sim.execTimerOn && sim.execLeft > 0) {
    sim.execLeft -= dt;
    if (sim.execLeft <= 0) {
      sim.units.forEach(u => {
        if (u.alive && u.side === 'hostile' && u.isExecutioner) {
          const hs = sim.units.filter(o => o.alive && o.side === 'neutral' && o.role === 'hostage' && !o.freed);
          hs.forEach(h => ENG.damage(sim, h, 999, u, true));
        }
      });
      sim.execTimerOn = 'done';
    }
  }

  /* 警戒值衰减 */
  sim.troopers.forEach(t => { if (t.alive) t.exposedT = 0; });

  /* 胜负 */
  SIM.checkEnd(sim);
};

/* 投掷物效果 */
ENG.grenadeEffect = function (sim, p) {
  const R = p.type === 'flash' ? 8 : 10;
  sim.fx.push({ type: p.type === 'flash' ? 'flashbang' : 'smoke', x: p.x, y: p.y, r: R, t: p.type === 'smoke' ? 16 : 1.0 });
  ENG.makeNoise(sim, p.x, p.y, p.type === 'flash' ? DATA.NOISE.flashBreak : DATA.NOISE.smokeBreak, p.type);
  sim.units.forEach(u => {
    if (!u.alive) return;
    const d = Math.hypot(u.x - p.x, u.y - p.y);
    if (d > R) return;
    if (!ENG.hasLOS(sim.grid, p, u) && d > R * 0.6) return;
    if (!u.hasNVG && u.side !== 'neutral') {
      const f = 1 - d / R;
      u.stunT = Math.max(u.stunT, 1400 + f * 2600);
      u.aimT = 2000;
    } else if (u.side === 'player' && !u.hasNVG) {
      u.stunT = Math.max(u.stunT, 900 + (1 - d / R) * 1200);
    }
  });
  if (p.type === 'smoke') {
    sim.smokes = sim.smokes || [];
    sim.smokes.push({ x: p.x, y: p.y, r: R, t: 16 });
  }
};

/* ---------- 胜负判定 ---------- */
SIM.checkEnd = function (sim) {
  if (sim.over) return;
  const alive = sim.troopers.filter(t => t.alive);

  // 全灭 -> 失败
  if (alive.length === 0) { SIM.fail(sim, '小队全灭'); return; }

  // 区域安全后，已获救的人质/要员自动前往撤离点（否则"撤离"目标永远无法达成）
  const stillHostile = sim.units.some(u => u.alive && u.side === 'hostile');
  if (!stillHostile) {
    sim.units.forEach(u => {
      if (!u.alive) return;
      if ((u.role === 'hostage' || u.role === 'vip' || u.role === 'detained') && u.freed && u.order !== 'exit') {
        u.order = 'exit';
        u.path = null;
      }
      // VIP 即使未被"解救"标记，区域安全后也应自动撤离
      if (u.role === 'vip' && !u.freed && u.order !== 'exit') {
        u.freed = true; u.order = 'exit'; u.path = null;
      }
    });
  }

  const hostiles = sim.units.filter(u => u.alive && u.side === 'hostile');
  const detained = sim.units.filter(u => u.role === 'detained');
  sim.obj.enemiesLeft = hostiles.length;

  const type = sim.mission.type;

  if (type === 'clear') {
    if (hostiles.length === 0) SIM.win(sim);
  } else if (type === 'hostage' || type === 'execute') {
    const hs = sim.units.filter(u => u.role === 'hostage');
    const aliveHostages = hs.filter(h => h.alive);
    const escaped = hs.filter(h => h.escaped);
    // 胜利条件（对齐 DK2）：
    // 1) 所有人质撤离；或 2) 敌人全灭且人质已全部获救（被释放）
    const allEscaped = hs.length > 0 && escaped.length === hs.length;
    const allSaved = hs.length > 0 && aliveHostages.length === hs.length && hs.every(h => h.freed);
    if (allEscaped) SIM.win(sim);
    else if (hostiles.length === 0 && allSaved) SIM.win(sim);
    // 失败：人质全部遇害
    else if (hs.length && aliveHostages.length === 0) SIM.fail(sim, '人质全部遇害');
  } else if (type === 'bomb') {
    if (sim.bomb && sim.bomb.defused && hostiles.length === 0) SIM.win(sim);
  } else if (type === 'hvt') {
    const hvt = sim.hvt;
    if (!hvt) return;
    if (!hvt.alive) { SIM.fail(sim, '高价值目标死亡'); return; }
    if (hvt.role === 'detained' && hostiles.length === 0) SIM.win(sim);
  } else if (type === 'vip') {
    const v = sim.vip;
    if (!v) return;
    if (!v.alive) { SIM.fail(sim, '要员死亡'); return; }
    if (v.escaped) SIM.win(sim);
  }
};

SIM.win = function (sim) {
  if (sim.over) return;
  sim.over = true; sim.win = true;
  sim.endTime = sim.time;
  sim.endReason = sim.endReason || '目标达成';
  SIM.state.mode = 'result';
  SIM.computeStars(sim);
};

SIM.fail = function (sim, reason) {
  if (sim.over) return;
  sim.over = true; sim.win = false;
  sim.failReason = reason;
  sim.endTime = sim.time;
  SIM.state.mode = 'result';
  SIM.computeStars(sim);
};

/* ---------- 星级 ---------- */
SIM.computeStars = function (sim) {
  if (!sim.win) { sim.stars = 0; return; }
  let s = 3;
  const t = sim.time;
  const beat = sim.mission.timeBeat;

  if (sim.stats.deaths > 0) s -= sim.stats.deaths >= 2 ? 2 : 1;
  if (sim.stats.civDeaths > 0) s -= 1;
  if (sim.obj.hostagesTotal > 0) {
    const hs = sim.units.filter(u => u.role === 'hostage' || u.role === 'vip');
    const lost = hs.filter(h => !h.alive).length;
    if (lost > 0) s -= lost;
  }
  if (t > beat * 1.8) s -= 2;
  else if (t > beat * 1.25) s -= 1;

  sim.stars = Math.max(0, Math.min(3, s));
};

/* ---------- 规划工具 ---------- */
SIM.setPath = function (t, path) {
  t.path = path;
  t.path.forEach(w => { if (w.faceMode) t.faceMode = w.faceMode; });
  if (EngMove && EngMove.resetWatchdog) EngMove.resetWatchdog(t);   // 新计划 -> 重置卡死看门狗
};

/* 在路径线上找离 (x,y) 最近的插入点（"细分规划"用）。
   返回 { i, x, y }：i 是应该插入到 path 的下标（pts[0] 是队员本身，所以段 i 对应下标 i）。
   离所有线段都超过 maxDist 时返回 null。 */
SIM.pathInsertPoint = function (t, x, y, maxDist) {
  if (!t || !t.path || !t.path.length) return null;
  const md = (maxDist === undefined) ? 0.7 : maxDist;
  const pts = [{ x: t.x, y: t.y }].concat(t.path);
  let best = null, bd = md;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const vx = b.x - a.x, vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    if (len2 < 1e-6) continue;
    let u = ((x - a.x) * vx + (y - a.y) * vy) / len2;
    u = Math.max(0.05, Math.min(0.95, u));   // 别贴到端点，否则插入没有意义
    const px = a.x + vx * u, py = a.y + vy * u;
    const d = Math.hypot(px - x, py - y);
    if (d < bd) { bd = d; best = { i: i, x: px, y: py }; }
  }
  return best;
};

/* 删除路径上的某个节点 */
SIM.removePathNode = function (t, index) {
  if (!t || !t.path || index < 0 || index >= t.path.length) return false;
  t.path.splice(index, 1);
  return true;
};

SIM.stopTrooper = function (t) {
  t.path = [];
  t.moving = false;
  t.action = null;
  if (EngMove && EngMove.resetWatchdog) EngMove.resetWatchdog(t);
};

SIM.triggerGoCode = function (sim, code) {
  const ts = sim.troopers.filter(t => t.alive && t.goCode === code);
  ts.forEach(t => {
    if (t.action) return;
    // 已规划的路径直接开始执行（本来就是自动执行），
    // GO Code 的作用是：清除 hold 状态
    t.hold = false;
  });
  sim.fx.push({ type: 'text', x: ts[0] ? ts[0].x : 0, y: ts[0] ? ts[0].y : 0, text: 'GO ' + code, color: '#7fc8ff', t: 1.5 });
};

SIM.snapshotPlan = function (sim) {
  sim.troopers.forEach(t => {
    t.planSnapshot = (t.path || []).map(w => Object.assign({}, w));
  });
};

SIM.restorePlan = function (sim) {
  sim.troopers.forEach(t => {
    if (t.planSnapshot) t.path = t.planSnapshot.map(w => Object.assign({}, w));
  });
};

window.SIM = SIM;

/* 无头自检：加载所有模块，跑完若干任务，验证核心逻辑不崩 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

process.on('uncaughtException', e => {
  console.error('\n✗ 未捕获异常:', e.message);
  console.error(e.stack.split('\n').slice(0, 8).join('\n'));
  process.exit(1);
});
process.on('unhandledRejection', e => {
  console.error('\n✗ 未处理的 Promise 拒绝:', e);
  process.exit(1);
});
let STAGE = 'init';
process.on('exit', c => {
  if (c !== 0) console.error(`\n[进程退出 code=${c}] 最后阶段: ${STAGE}`);
});

const ROOT = path.join(__dirname, '..');
const files = ['data.js','doctrine.js','mapgen.js','engine.js','ai.js','player.js','sim.js','mission.js','render.js'];

// 最小浏览器桩
const sandbox = {
  window: {},
  console,
  Math, JSON, Object, Array, Set, Map, Date, Number, String, Boolean, Error,
  parseInt, parseFloat, isNaN, isFinite,
  localStorage: { getItem: () => null, setItem: () => {} },
  requestAnimationFrame: () => {},
  document: {
    getElementById: () => null,
    createElement: () => ({ style:{}, classList:{ add(){}, remove(){}, toggle(){}, contains(){return false} }, appendChild(){}, addEventListener(){}, querySelectorAll: () => [], dataset:{} }),
    querySelectorAll: () => [],
    addEventListener: () => {}
  },
  window: { addEventListener: () => {}, devicePixelRatio: 1 }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const ctx = vm.createContext(sandbox);
files.forEach(f => {
  const code = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
  try { vm.runInContext(code, ctx, { filename: f }); }
  catch (e) { console.error(`✗ 加载 ${f} 失败:`, e.message); process.exit(1); }
});
console.log('✓ 全部模块加载成功');

const { SIM, MAPGEN, DATA, ENG, FACE } = sandbox;
const ERRORS = [];
const WARN = [];

/* ---------- 1. 地图生成 ---------- */
console.log('\n── 地图生成 ──');
SIM.MISSIONS.forEach(m => {
  try {
    const g = MAPGEN.generate(Object.assign({}, m, { squadSize: m.squadSize }));
    const floors = g.tiles.flat().filter(t => t === MAPGEN.T.FLOOR).length;
    const doors = g.doors.length;
    const walls = g.wallsBreachable.length;
    let spawnOk = g.spawns.length >= m.squadSize;
    if (!spawnOk) WARN.push(`${m.id} 出生点不足 (${g.spawns.length}/${m.squadSize})`);
    if (floors < 60) ERRORS.push(`${m.id} 室内面积过小 (${floors} 格)`);
    if (doors < 2) ERRORS.push(`${m.id} 门太少 (${doors})`);
    if (!g.powerBox) ERRORS.push(`${m.id} 无配电箱`);
    if (!g.exits.length) ERRORS.push(`${m.id} 无撤离点`);
    console.log(`  ${m.id} ${m.name.padEnd(14,'　')} 室内${String(floors).padStart(4)}格 门${String(doors).padStart(2)} 可破墙${walls} 出生点${g.spawns.length} 房间${g.rooms.length}`);
  } catch (e) {
    ERRORS.push(`${m.id} 生成异常: ${e.message}`);
  }
});

/* ---------- 2. 跑完整局模拟 ---------- */
console.log('\n── 模拟对局 ──');

const ONLY = process.argv[2] ? process.argv[2].split(',') : null;

function runMission(m, opts) {
  opts = opts || {};
  const lo = [];
  const base = { assault:'M4', support:'M249', marksman:'MK17LB', grenadier:'M203' };
  const clsList = ['assault','assault','support','marksman'];
  for (let i = 0; i < m.squadSize; i++) {
    const c = clsList[i % clsList.length];
    lo.push({
      name: 'T' + (i+1), cls: c, primary: base[c], secondary: 'G17',
      armor: 'plate3', nvg: true,
      gadgets: ['frag','flash','smoke'],
      breachTools: ['hand','kick','shotgun','charge'],
      skill: { marksmanship: 7, assault: 7, field: 7, mobility: 7 },
      goCode: 'A'
    });
  }
  const sim = SIM.startMission(m, lo);
  sim.night = !!opts.night;

  let frames = 0;
  const maxFrames = 60 * 150;   // 最多模拟 150 秒游戏时间
  const dt = 1/60;

  while (!sim.over && frames < maxFrames) {
    if (frames % 120 === 0) {
      sim.troopers.forEach(t => {
        if (!t.alive) return;
        if (t.path && t.path.length > 2) return;
        let goal = null;
        const hostiles = sim.units.filter(u => u.alive && u.side === 'hostile');
        const neutrals = sim.units.filter(u => u.alive && u.side === 'neutral' && (u.role==='hostage'||u.role==='vip') && !u.escaped);
        if (sim.bomb && !sim.bomb.defused) goal = { x: sim.bomb.x, y: sim.bomb.y };
        else if (neutrals.length) goal = { x: neutrals[0].x, y: neutrals[0].y };
        else if (hostiles.length) {
          const near = hostiles.slice().sort((a,b)=>ENG.dist(t,a)-ENG.dist(t,b))[0];
          goal = { x: near.x, y: near.y };
        } else if (sim.hvt) goal = { x: sim.hvt.x, y: sim.hvt.y };
        if (!goal) return;
        const pathPts = customPath(sim, t, goal);
        if (pathPts && pathPts.length) t.path = pathPts;
      });
    }
    SIM.step(dt);
    if (sim.over) break;
    frames++;
  }

  return {
    id: m.id, name: m.name, diff: m.diff,
    win: !!sim.win, over: !!sim.over, time: sim.time.toFixed(1), stars: sim.stars || 0,
    kills: sim.stats.kills, deaths: sim.stats.deaths, civDeaths: sim.stats.civDeaths,
    shots: sim.stats.shotsFired, hit: sim.stats.shotsHit,
    frames, reason: sim.failReason || sim.endReason || '',
    enemiesLeft: sim.units.filter(u=>u.alive&&u.side==='hostile').length,
    totalEnemies: sim.obj.enemiesTotal
  };
}

function customPath(sim, t, goal) {
  if (Math.hypot(goal.x-t.x, goal.y-t.y) < 1) return null;
  const p = sandbox.EngMove.findPath(sim.grid, t, goal, 2600);
  if (p && p.length) return p;
  return [{ x: goal.x, y: goal.y }];
}

let results = [];
SIM.MISSIONS.filter(m => !ONLY || ONLY.includes(m.id)).forEach(m => {
  try {
    const r = runMission(m);
    results.push(r);
    const flag = r.win ? '✔' : '✘';
    console.log(`  ${flag} ${r.id} ${r.name}  用时${r.time}s 星${r.stars} 击毙${r.kills}/${r.totalEnemies} 阵亡${r.deaths} 开火${r.shots} 命中${r.hit} 剩余敌${r.enemiesLeft} ${r.reason?'['+r.reason+']':''}`);
    if (r.frames >= 60*150 && !r.win) WARN.push(`${r.id} 模拟 150s 未结束（自动AI能力有限，非必然错误）`);
    if (r.shots > 0 && r.hit === 0) ERRORS.push(`${r.id} 有开火但零命中 —— 射击逻辑异常`);
    if (r.kills > r.totalEnemies) ERRORS.push(`${r.id} 击毙数超过敌人总数`);
  } catch (e) {
    ERRORS.push(`${m.id} 模拟崩溃: ${e.message}`);
    console.log(`  ✗ ${m.id} 崩溃: ${e.message}`);
    console.log('    ' + e.stack.split('\n').slice(1,4).join('\n    '));
  }
});

/* ---------- 3. 机制单元验证 ---------- */
console.log('\n── 机制单元验证 ──');

// 3.1 视野锥
{
  const g = MAPGEN.generate({ seed: 999, gridW: 30, gridH: 24, roomCount: 4, squadSize: 2 });
  // 找一个室内空地
  let spot = null;
  for (let y=1;y<g.h&&!spot;y++) for (let x=1;x<g.w;x++) if (g.tiles[y][x]===MAPGEN.T.FLOOR) { spot={x:x+.5,y:y+.5}; break; }
  const obs = { x: spot.x, y: spot.y, face: 0, fov: 90, sight: 20 };
  const front = { x: spot.x + 3, y: spot.y };
  const back  = { x: spot.x - 3, y: spot.y };
  const side  = { x: spot.x, y: spot.y + 3 };
  const c1 = ENG.inCone(g, obs, front, { ignoreClose: true });
  const c2 = ENG.inCone(g, obs, back,  { ignoreClose: true });
  const c3 = ENG.inCone(g, obs, side,  { ignoreClose: true });
  console.log(`  视野锥 90°: 正前=${c1} 正后=${c2} 正侧=${c3}`);
  if (!c1) ERRORS.push('视野锥：正前方目标不可见（应为 true）');
  if (c2)  ERRORS.push('视野锥：正后方目标可见（应为 false）');
  if (c3)  ERRORS.push('视野锥：正侧方(90°)目标可见（应为 false）');

  // 110° 顾问应能看到略偏侧
  const obs2 = Object.assign({}, obs, { fov: 110 });
  const off50 = { x: spot.x + 3*Math.cos(0.87), y: spot.y + 3*Math.sin(0.87) }; // ~50°
  console.log(`  视野锥 110° 看到 50° 偏角目标: ${ENG.inCone(g, obs2, off50, {ignoreClose:true})} (应为 true)`);
  if (!ENG.inCone(g, obs2, off50, {ignoreClose:true})) ERRORS.push('视野锥：110° 应覆盖 50° 偏角');
}

// 3.2 视线遮挡
{
  const g = MAPGEN.generate({ seed: 777, gridW: 30, gridH: 24, roomCount: 4, squadSize: 2 });
  // 找一堵内墙，验证两侧不通视
  let wall = null;
  for (let y=2;y<g.h-2&&!wall;y++) for (let x=2;x<g.w-2;x++) {
    if (g.tiles[y][x]===MAPGEN.T.WALL && g.tiles[y][x-1]===MAPGEN.T.FLOOR && g.tiles[y][x+1]===MAPGEN.T.FLOOR) { wall={x,y}; break; }
  }
  if (wall) {
    const a = { x: wall.x-0.5, y: wall.y+0.5 };
    const b = { x: wall.x+1.5, y: wall.y+0.5 };
    const los = ENG.hasLOS(g, a, b);
    console.log(`  视线遮挡（隔一堵墙）: ${los} (应为 false)`);
    if (los) ERRORS.push('视线：墙没有阻挡视线');
    // 同侧应通视
    const c = { x: a.x-1, y: a.y };
    console.log(`  同侧通视: ${ENG.hasLOS(g, a, c)} (应为 true)`);
  } else WARN.push('未找到测试用内墙');
}

// 3.3 护甲/穿甲
{
  const mkSim = (armor, pen) => {
    const sim = { grid: MAPGEN.generate({seed:1,gridW:20,gridH:16,roomCount:2,squadSize:1}),
      units: [], troopers: [], fx: [], noiseEvents: [], projectiles: [], stats:{shotsFired:0,shotsHit:0,shotsMissed:0}, difficulty: DATA.DIFFICULTY.normal, time:0 };
    const shooter = { x: 2.5, y: 2.5, face: 0, alive: true, fov: 90, sight: 20, weapon: 'M4', armor: 'none', hp:100, maxHp:100 };
    const target = { x: 5.5, y: 2.5, face: Math.PI, alive: true, hp:100, maxHp:100, armor: armor, side:'hostile' };
    sim.units = [shooter, target];
    return { sim, shooter, target };
  };
  // 直接验证伤害公式：M4 pen32 vs plate3(30) 应穿透
  const w = DATA.WEAPONS.M4, arm = DATA.ARMOR.plate3;
  const penetrates = w.pen >= arm.level;
  console.log(`  穿甲: M4(${w.pen}) vs III级插板(${arm.level}) => ${penetrates?'穿透':'被挡'} (应为穿透)`);
  if (!penetrates) ERRORS.push('穿甲公式：M4 应能穿透 III 级插板');
  // 手枪 vs IV 级
  const pw = DATA.WEAPONS.G17, a4 = DATA.ARMOR.plate4;
  console.log(`  穿甲: G17(${pw.pen}) vs IV级插板(${a4.level}) => ${pw.pen>=a4.level?'穿透':'被挡'} (应为被挡)`);
  if (pw.pen >= a4.level) ERRORS.push('穿甲公式：手枪不应穿透 IV 级');
}

// 3.4 噪音传播
{
  const sim = { grid: MAPGEN.generate({seed:5,gridW:30,gridH:24,roomCount:3,squadSize:1}),
    units: [], troopers: [], fx: [], noiseEvents: [], projectiles: [], stats:{}, difficulty: DATA.DIFFICULTY.normal, time: 0 };
  const e1 = { x: 5, y: 5, alive: true, side: 'hostile', state: 'idle', alert: 0, ai: [] };
  const e2 = { x: 25, y: 20, alive: true, side: 'hostile', state: 'idle', alert: 0, ai: [] };
  sim.units = [e1, e2];
  ENG.makeNoise(sim, 5, 5, 10, 'shot');
  console.log(`  噪音传播: 半径内敌人 state=${e1.state} alert=${e1.alert.toFixed(2)} (应 investigate)`);
  console.log(`  半径外敌人 state=${e2.state} alert=${e2.alert.toFixed(2)} (应 idle/0)`);
  if (e1.state !== 'investigate') ERRORS.push('噪音：半径内敌人未去调查');
  if (e2.alert > 0) ERRORS.push('噪音：半径外敌人被惊动');
}

// 3.5 星级评分
{
  const fake = (win, deaths, civ, time, beat, hLost) => {
    const s = { win, time, mission: { timeBeat: beat }, stats: { deaths, civDeaths: civ },
      units: [],
      obj: { hostagesTotal: hLost || 0 } };
    if (hLost) for (let i=0;i<hLost;i++) s.units.push({ role:'hostage', alive: true });
    SIM.computeStars(s);
    return s.stars;
  };
  const cases = [
    ['完美（无伤亡/达标）', fake(true,0,0,60,100), 3],
    ['死1人',             fake(true,1,0,60,100), 2],
    ['死2人',             fake(true,2,0,60,100), 1],
    ['平民死亡',           fake(true,0,1,60,100), 2],
    ['超时1.3倍',          fake(true,0,0,130,100), 2],
    ['超时1.9倍',          fake(true,0,0,190,100), 1],
    ['失败',              fake(false,0,0,60,100), 0]
  ];
  cases.forEach(([n, got, exp]) => {
    const ok = got === exp;
    console.log(`  ${ok?'✔':'✘'} 星级 ${n.padEnd(12,'　')} 得到${got} 期望${exp}`);
    if (!ok) ERRORS.push(`星级评分错误：${n} 得到${got} 期望${exp}`);
  });
}

/* ---------- 汇总 ---------- */
console.log('\n════════ 结果 ════════');
const wins = results.filter(r=>r.win).length;
console.log(`模拟对局: ${results.length} 局, 自动AI通关 ${wins} 局`);
console.log(`错误 ${ERRORS.length} 项, 警告 ${WARN.length} 项`);
if (WARN.length) { console.log('\n警告:'); WARN.forEach(w=>console.log('  ⚠ ' + w)); }
if (ERRORS.length) { console.log('\n错误:'); ERRORS.forEach(e=>console.log('  ✗ ' + e)); process.exit(1); }
console.log('\n✓ 全部自检通过');

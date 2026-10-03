/* 验证：模拟"一个称职玩家"的打法 —— 破门、逐屋清剿、逮捕、救人质 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const files = ['data.js','doctrine.js','mapgen.js','engine.js','ai.js','player.js','sim.js','mission.js','render.js'];
const sandbox = { console, Math, JSON, Object, Array, Set, Map, Date, Number, String, Boolean, Error,
  parseInt, parseFloat, isNaN, isFinite,
  localStorage:{getItem:()=>null,setItem:()=>{}}, requestAnimationFrame:()=>{},
  document:{ getElementById:()=>null, createElement:()=>({style:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},appendChild(){},addEventListener(){},querySelectorAll:()=>[],dataset:{}}), querySelectorAll:()=>[], addEventListener:()=>{} },
  window:{ addEventListener:()=>{}, devicePixelRatio:1 } };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
files.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT,'js',f),'utf8'), ctx, {filename:f}));
const { SIM, MAPGEN, DATA, ENG, EngMove } = sandbox;

/* 战术 AI：优先打可见敌人；否则朝最近未探索房间推进；门自动破 */
function tacticianAI(sim, t) {
  if (!t.alive || !t.visible) return;
  // 1. 有可见敌人 -> 交火（由 updateTrooper 自动处理），但不要移动
  if (t.visible.enemies.length) {
    if (t.path && t.path.length && !t.suppressT) { /* 保持推进 */ }
    return;
  }
  if (t.action) return;
  if (t.path && t.path.length > 1) return;

  // 2. 有人质未救 -> 去救
  const unfreed = sim.units.filter(u => u.alive && u.side === 'neutral' &&
    (u.role === 'hostage' || u.role === 'vip') && !u.freed);
  if (unfreed.length) {
    const n = unfreed.sort((a,b)=>ENG.dist(t,a)-ENG.dist(t,b))[0];
    const p = EngMove.findPath(sim.grid, t, n, 8000);
    if (p && p.length) {
      t.path = p;
      const last = t.path[t.path.length-1];
      last.free = true; last.unit = n;
      return;
    }
  }
  // 3. 炸弹
  if (sim.bomb && !sim.bomb.defused) {
    const p = EngMove.findPath(sim.grid, t, sim.bomb, 8000);
    if (p && p.length) { t.path = p; t.path[t.path.length-1].defuse = true; return; }
  }
  // 4. HVT
  if (sim.hvt && sim.hvt.alive && sim.hvt.role !== 'detained') {
    const p = EngMove.findPath(sim.grid, t, sim.hvt, 8000);
    if (p && p.length) { t.path = p; t.path[t.path.length-1].arrest = true; t.path[t.path.length-1].unit = sim.hvt; return; }
  }
  // 5. 推进到最近的、还没被"认领"的敌人位置
  const claimed = new Set();
  sim.troopers.forEach(o => {
    if (o !== t && o.alive && o.path && o.path.length) {
      const e = o.path[o.path.length-1];
      claimed.add(Math.floor(e.x) + ',' + Math.floor(e.y));
    }
  });
  const hostiles = sim.units.filter(u => u.alive && u.side === 'hostile')
    .sort((a,b)=>ENG.dist(t,a)-ENG.dist(t,b));
  for (const h of hostiles) {
    const k = Math.floor(h.x) + ',' + Math.floor(h.y);
    if (claimed.has(k)) continue;
    const p = EngMove.findPath(sim.grid, t, h, 8000);
    if (p && p.length) { t.path = p; return; }
  }
  // 6. 兜底：任何敌人
  if (hostiles.length) {
    const p = EngMove.findPath(sim.grid, t, hostiles[0], 12000);
    if (p && p.length) t.path = p;
  }
}

function play(missionId, maxSec) {
  const m = SIM.MISSIONS.find(x => x.id === missionId);
  const base = { assault:'M4', support:'M249', marksman:'MK17LB', grenadier:'M203' };
  const classes = ['assault','assault','support','marksman'];
  const lo = [];
  for (let i = 0; i < m.squadSize; i++) {
    const c = classes[i % classes.length];
    lo.push({ name:'T'+(i+1), cls:c, primary:base[c], secondary:'G17', armor:'plate3', nvg:true,
      gadgets:['frag','flash','smoke'], breachTools:['hand','kick','shotgun','charge'],
      skill:{marksmanship:7,assault:7,field:7,mobility:7}, goCode:'A' });
  }
  const sim = SIM.startMission(m, lo);
  const dt = 1/60;
  const max = 60 * (maxSec || 300);
  let f = 0;
  while (!sim.over && f < max) {
    if (f % 20 === 0) sim.troopers.forEach(t => tacticianAI(sim, t));
    SIM.step(dt);
    if (sim.over) break;
    f++;
  }
  return { sim, m, frames: f };
}

const ids = process.argv[2] ? process.argv[2].split(',') : SIM.MISSIONS.map(m=>m.id);
console.log('=== 战术AI 通关测试 ===\n');
let pass = 0;
ids.forEach(id => {
  const { sim, m, frames } = play(id, 420);
  const st = sim.stats;
  const win = sim.win;
  if (win) pass++;
  const hs = sim.units.filter(u=>u.role==='hostage'||u.role==='vip');
  console.log(`${win?'✔':'✘'} ${id} ${m.name}`);
  console.log(`   用时 ${sim.time.toFixed(0)}s(上限420) 星${sim.stars||0} | 击毙${st.kills} 逮捕${st.arrested} 阵亡${st.deaths} 平民死${st.civDeaths}`);
  console.log(`   剩余敌人 ${sim.units.filter(u=>u.alive&&u.side==='hostile').length}/${sim.obj.enemiesTotal}` +
    (hs.length?` 人质撤离 ${hs.filter(h=>h.escaped).length}/${hs.length}`:'') +
    (sim.bomb?` 炸弹${sim.bomb.defused?'已拆':'未拆('+Math.ceil(sim.bomb.timer)+'s)'}`:''));
  console.log(`   开火${st.shotsFired} 命中${st.shotsHit}(${st.shotsFired?Math.round(st.shotsHit/st.shotsFired*100):0}%) 踹门${st.doorsKicked} 开门${st.doorsOpened} 强制破门${st.doorsForced} 破墙${st.wallsBreached}`);
  console.log(`   结局: ${sim.failReason || sim.endReason || '未结束'}\n`);
});
console.log(`合计: ${pass}/${ids.length} 关由战术AI通关`);

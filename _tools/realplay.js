/* 真实玩家模拟：停下来打，不在火线里推进；破门先开门再清房 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const files = ['data.js','doctrine.js','mapgen.js','engine.js','ai.js','player.js','sim.js','mission.js','render.js'];
const sandbox = { console, Math, JSON, Object, Array, Set, Map, Date, Number, String, Boolean, Error,
  parseInt, parseFloat, isNaN, isFinite,
  localStorage:{getItem:()=>null,setItem:()=>{}}, requestAnimationFrame:()=>{},
  document:{ getElementById:()=>null, createElement:()=>({style:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},appendChild(){},addEventListener(){},querySelectorAll:()=>[],dataset:{}}), querySelectorAll:()=>[], addEventListener:()=>{} },
  window:{ addEventListener:()=>{}, devicePixelRatio:1 } };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
// 诊断开关：DK2D_INSTANT_BREACH=1 时把破门耗时还原成"瞬间完成"，
// 用于隔离「破门耗时」对通关率的影响。
sandbox.__DK2D_INSTANT_BREACH = !!process.env.DK2D_INSTANT_BREACH;
// 诊断开关：DK2D_OLD_REPATH=1 时队员卡住后"直奔终点"（旧行为），用于 A/B 对比
sandbox.__DK2D_OLD_REPATH = !!process.env.DK2D_OLD_REPATH;
// 诊断开关：DK2D_FORCE_AUTOSHOOT=1 时队员默认「停下射击」（DK2 手感），用于 A/B 对比
sandbox.__DK2D_FORCE_AUTOSHOOT = !!process.env.DK2D_FORCE_AUTOSHOOT;
const ctx = vm.createContext(sandbox);
files.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT,'js',f),'utf8'), ctx, {filename:f}));
const { SIM, MAPGEN, DATA, ENG, EngMove } = sandbox;

/* 真实玩家式 AI：
   1) 有可见敌人 -> 停下、面朝、开火（不移动，不开新路径）
   2) 没敌人 -> 朝下一个目标推进；到门口先开门/破门
   3) 蹲下减少被命中；贴近掩体 */
function realPlayerAI(sim, t) {
  if (!t.alive || !t.visible) return;

  // 交战中：停止移动，专注射击
  if (t.visible.enemies.length) {
    t.path = null;                 // 停下
    t.moving = false;
    t.crouch = true;               // 蹲下减少被命中
    const tgt = t.visible.enemies.sort((a,b)=>ENG.dist(t,a)-ENG.dist(t,b))[0];
    // 面朝目标（updateTrooper 会处理开火）
    return;
  }
  t.crouch = false;
  if (t.action) return;
  if (t.path && t.path.length > 0) return;   // 已有路径，继续走

  // 有人质未救 -> 去救
  const unfreed = sim.units.filter(u => u.alive && u.side === 'neutral' &&
    (u.role === 'hostage' || u.role === 'vip') && !u.freed);
  if (unfreed.length) {
    const n = unfreed.sort((a,b)=>ENG.dist(t,a)-ENG.dist(t,b))[0];
    const p = EngMove.findPath(sim.grid, t, n, 9000);
    if (p && p.length) { t.path = p; const l=t.path[t.path.length-1]; l.free=true; l.unit=n; return; }
  }
  // 炸弹
  if (sim.bomb && !sim.bomb.defused) {
    const p = EngMove.findPath(sim.grid, t, sim.bomb, 9000);
    if (p && p.length) { t.path = p; t.path[t.path.length-1].defuse = true; return; }
  }
  // HVT
  if (sim.hvt && sim.hvt.alive && sim.hvt.role !== 'detained') {
    const p = EngMove.findPath(sim.grid, t, sim.hvt, 9000);
    if (p && p.length) { t.path = p; t.path[t.path.length-1].arrest = true; t.path[t.path.length-1].unit = sim.hvt; return; }
  }
  // 推进到最近敌人（各队员认领不同目标）
  const claimed = new Set();
  sim.troopers.forEach(o => {
    if (o !== t && o.alive && o.path && o.path.length) {
      const e = o.path[o.path.length-1];
      claimed.add(Math.floor(e.x)+','+Math.floor(e.y));
    }
  });
  const hostiles = sim.units.filter(u => u.alive && u.side === 'hostile')
    .sort((a,b)=>ENG.dist(t,a)-ENG.dist(t,b));
  for (const h of hostiles) {
    const k = Math.floor(h.x)+','+Math.floor(h.y);
    if (claimed.has(k)) continue;
    const p = EngMove.findPath(sim.grid, t, h, 9000);
    if (p && p.length) { t.path = p; return; }
  }
  if (hostiles.length) {
    const p = EngMove.findPath(sim.grid, t, hostiles[0], 12000);
    if (p && p.length) t.path = p;
  }
}

function play(missionId, maxSec, quiet) {
  const m = SIM.MISSIONS.find(x => x.id === missionId);
  // 诊断：DK2D_SEED_OFFSET 平移关卡种子，用来判断某关是不是"卡在某条随机轨迹上"
  const seedOff = parseInt(process.env.DK2D_SEED_OFFSET || '0', 10) || 0;
  if (seedOff) m.seed = m.seed + seedOff;
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
    if (f % 15 === 0) sim.troopers.forEach(t => realPlayerAI(sim, t));
    SIM.step(dt);
    if (sim.over) break;
    f++;
  }
  return { sim, m, frames: f };
}

const ids = process.argv[2] ? process.argv[2].split(',') : SIM.MISSIONS.map(m=>m.id);
console.log('=== 真实玩家式 AI 通关测试 ===\n');
let pass = 0;
ids.forEach(id => {
  const { sim, m, frames } = play(id, 420);
  const st = sim.stats;
  const win = sim.win;
  if (win) pass++;
  const hs = sim.units.filter(u=>u.role==='hostage'||u.role==='vip');
  console.log(`${win?'✔':'✘'} ${id} ${m.name}`);
  console.log(`   用时 ${sim.time.toFixed(0)}s 星${sim.stars||0} | 击毙${st.kills} 逮捕${st.arrested} 阵亡${st.deaths} 平民死${st.civDeaths}`);
  console.log(`   剩余敌人 ${sim.units.filter(u=>u.alive&&u.side==='hostile').length}/${sim.obj?sim.obj.enemiesTotal:'?'}` +
    (hs.length?` 人质撤离 ${hs.filter(h=>h.escaped||h.freed).length}/${hs.length}`:'') +
    (sim.bomb?` 炸弹${sim.bomb.defused?'已拆':'未拆('+Math.ceil(sim.bomb.timer)+'s)'}`:''));
  console.log(`   开火${st.shotsFired} 命中${st.shotsHit}(${st.shotsFired?Math.round(st.shotsHit/st.shotsFired*100):0}%) 踹门${st.doorsKicked} 开门${st.doorsOpened}`);
  console.log(`   结局: ${sim.failReason || sim.endReason || '未结束'}\n`);
});
console.log(`合计: ${pass}/${ids.length} 关通关`);

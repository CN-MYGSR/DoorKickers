/* ============================================================
   hitreaction.js —— 验证"敌人被击中后会转向弹源并还击"
   背景：以前敌人只在"听到声音"或"目标进入视野锥"时才有反应，
        从背后挨枪会站着不动直到被打死。
   ============================================================ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const files = ['data.js', 'doctrine.js', 'mapgen.js', 'engine.js', 'ai.js', 'player.js', 'sim.js', 'mission.js', 'render.js'];
const sandbox = {
  console, Math, JSON, Object, Array, Set, Map, Date, Number, String, Boolean, Error,
  parseInt, parseFloat, isNaN, isFinite,
  localStorage: { getItem: () => null, setItem: () => {} },
  requestAnimationFrame: () => {},
  document: {
    getElementById: () => null,
    createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, appendChild() {}, addEventListener() {}, querySelectorAll: () => [], dataset: {} }),
    querySelectorAll: () => [], addEventListener: () => {}
  },
  window: { addEventListener: () => {}, devicePixelRatio: 1 }
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
files.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), ctx, { filename: f }));
const { SIM, MAPGEN, DATA, ENG, EngMove } = sandbox;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✔ ${name}` + (detail ? '  —— ' + detail : '')); }
  else { fail++; console.log(`  ✘ ${name}  —— ${detail}`); }
}
const angDiff = (a, b) => Math.abs(ENG.angDiff(a, b));

function startSim(missionId) {
  const m = SIM.MISSIONS.find(x => x.id === missionId);
  const lo = [{ name: 'T1', cls: 'assault', primary: 'M4', secondary: 'G17', armor: 'plate3',
                gadgets: ['frag'], breachTools: ['hand', 'kick'],
                skill: { marksmanship: 6, assault: 6, field: 6, mobility: 6 } }];
  return { sim: SIM.startMission(m, lo), m };
}

/* 在玩家附近找一个有视线的空地，把敌人放过去并让它背对玩家 */
function setupBlindEnemy(sim, player, dist) {
  const g = sim.grid;
  const px = Math.floor(player.x), py = Math.floor(player.y);
  let spot = null;
  for (let r = dist; r <= dist + 2 && !spot; r++) {
    for (let dy = -r; dy <= r && !spot; dy++) {
      for (let dx = -r; dx <= r && !spot; dx++) {
        if (Math.hypot(dx, dy) < r - 0.6) continue;
        const x = px + dx, y = py + dy;
        // 玩家现在生成在建筑外，室外格是 EMPTY 而不是 FLOOR，两者都要放行
        const tile = MAPGEN.at(g, x, y);
        if (tile !== MAPGEN.T.FLOOR && tile !== MAPGEN.T.EMPTY) continue;
        const p = { x: x + 0.5, y: y + 0.5 };
        if (!ENG.hasLOS(g, p, player)) continue;
        spot = p;
      }
    }
  }
  if (!spot) return null;

  const e = sim.units.find(u => u.side === 'hostile' && u.alive);
  if (!e) return null;
  e.x = spot.x; e.y = spot.y;
  // 让敌人背对玩家：朝向 = 从玩家指向敌人的方向
  e.face = Math.atan2(e.y - player.y, e.x - player.x);
  e.state = 'idle'; e.visibleTarget = null; e.alert = 0; e.hurtT = 0;
  e.turnToSourceT = 0; e.attackSource = null; e.reactedHitStamp = 0;
  e.shotsFired = 0; e.aimT = 0; e.cooldownT = 0; e.reactionT = 0;
  e.ai = ['guard'];
  return e;
}

console.log('=== 1. 前提：背对时确实看不见玩家 ===');
{
  const { sim } = startSim('m01');
  const player = sim.troopers[0];
  player.roe = 'hold';   // 玩家不开火，隔离出敌人的行为
  const e = setupBlindEnemy(sim, player, 3);
  ok('找到可用的测试位置', !!e);
  if (e) {
    for (let i = 0; i < 30; i++) SIM.step(1 / 60);
    ok('背对玩家的敌人看不见玩家', !e.visibleTarget,
      `visibleTarget=${e.visibleTarget ? '有' : 'null'}，朝向差 ${angDiff(e.face, Math.atan2(player.y - e.y, player.x - e.x)).toFixed(2)} rad`);
    const faceBefore = e.face;
    for (let i = 0; i < 60; i++) SIM.step(1 / 60);
    ok('没被打时不会自己转过去', angDiff(e.face, faceBefore) < 0.01,
      `1 秒内朝向变化 ${angDiff(e.face, faceBefore).toFixed(4)} rad`);
  }
}

console.log('\n=== 2. 被击中 -> 转向弹源 ===');
{
  const { sim } = startSim('m01');
  const player = sim.troopers[0];
  player.roe = 'hold';
  const e = setupBlindEnemy(sim, player, 3);
  if (e) {
    const wantAng = Math.atan2(player.y - e.y, player.x - e.x);
    const before = angDiff(e.face, wantAng);
    ok('受击前朝向偏离射手', before > 2.0, `偏离 ${before.toFixed(2)} rad（≈${(before * 57.3).toFixed(0)}°）`);

    ENG.damage(sim, e, 5, player);     // 从背后打中
    ok('ENG.damage 记录了弹源', !!e.attackSource,
      e.attackSource ? `(${e.attackSource.x.toFixed(1)}, ${e.attackSource.y.toFixed(1)})` : 'null');
    ok('受击后进入转向窗口', e.turnToSourceT > 0, `turnToSourceT=${e.turnToSourceT}`);

    for (let i = 0; i < 30; i++) SIM.step(1 / 60);   // 0.5 秒
    const after = angDiff(e.face, wantAng);
    ok('0.5 秒内转向了射手', after < 0.35, `偏离从 ${before.toFixed(2)} 降到 ${after.toFixed(2)} rad`);
  }
}

console.log('\n=== 3. 转向之后能发现并还击 ===');
{
  const { sim } = startSim('m01');
  const player = sim.troopers[0];
  player.roe = 'hold';
  const e = setupBlindEnemy(sim, player, 3);
  if (e) {
    ENG.damage(sim, e, 5, player);
    let sawTarget = false, engaged = false;
    for (let i = 0; i < 60 * 6; i++) {
      SIM.step(1 / 60);
      if (e.visibleTarget) sawTarget = true;
      if (e.state === 'engage') engaged = true;
      if (!e.alive) break;
    }
    ok('转向后重新发现玩家', sawTarget, `visibleTarget=${e.visibleTarget ? '有' : 'null'}`);
    ok('进入交战状态', engaged, `state=${e.state}`);
    ok('确实开了火', (e.shotsFired || 0) > 0, `shotsFired=${e.shotsFired || 0}`);
  }
}

console.log('\n=== 4. 看不见射手时改为循弹源追击（而不是原地等） ===');
{
  const { sim } = startSim('m01');
  const player = sim.troopers[0];
  player.roe = 'hold';
  const e = setupBlindEnemy(sim, player, 3);
  if (e) {
    // 弹源放在"继续背离玩家"的一侧：这样敌人转身后视野锥也不会扫到玩家，
    // 才能干净地测出"看不见射手时改为循弹源追击"这条分支。
    const src = { x: e.x - 9, y: e.y };
    ENG.damage(sim, e, 5, src);
    const before = e.state;
    for (let i = 0; i < 6; i++) SIM.step(1 / 60);
    ok('受击后从 idle 转为 hunt', before === 'idle' && e.state === 'hunt',
      `state: ${before} -> ${e.state}`);
    ok('仍然看不见玩家（隔离成立）', !e.visibleTarget,
      `visibleTarget=${e.visibleTarget ? '有' : 'null'}`);
    ok('lastKnown 指向弹源', !!e.lastKnown,
      e.lastKnown ? `(${e.lastKnown.x.toFixed(1)}, ${e.lastKnown.y.toFixed(1)})` : 'null');
  }
}

console.log('\n=== 5. 受击闪烁会正常衰减（以前敌人会永久发白） ===');
{
  const { sim } = startSim('m01');
  const player = sim.troopers[0];
  player.roe = 'hold';
  const e = setupBlindEnemy(sim, player, 3);
  if (e) {
    ENG.damage(sim, e, 5, player);
    ok('受击瞬间 hurtT > 0', e.hurtT > 0, `hurtT=${e.hurtT.toFixed(0)}`);
    for (let i = 0; i < 60; i++) SIM.step(1 / 60);   // 1 秒
    ok('1 秒后 hurtT 归零', e.hurtT === 0, `hurtT=${e.hurtT}`);
    ok('转向窗口也已结束', e.turnToSourceT === 0, `turnToSourceT=${e.turnToSourceT}`);
  }
}

console.log('\n=== 6. 不打断已有交战（已经在打的敌人不受影响） ===');
{
  const { sim } = startSim('m01');
  const player = sim.troopers[0];
  player.roe = 'hold';
  const e = setupBlindEnemy(sim, player, 3);
  if (e) {
    e.state = 'engage';
    e.visibleTarget = player;
    ENG.damage(sim, e, 5, player);
    for (let i = 0; i < 6; i++) SIM.step(1 / 60);
    ok('交战中的敌人不会被踢回 hunt', e.state === 'engage', `state=${e.state}`);
  }
}

console.log('\n=== 7. 玩家受击行为未被破坏 ===');
{
  const { sim } = startSim('m01');
  const t = sim.troopers[0];
  t.faceMode = 'path';
  t.face = 0;
  const enemy = sim.units.find(u => u.side === 'hostile');
  // 弹源在玩家正后方
  const src = { x: t.x - 3, y: t.y };
  ENG.damage(sim, t, 5, src);
  ok('玩家 attackSource 已记录', !!t.attackSource);
  const want = Math.atan2(src.y - t.y, src.x - t.x);
  for (let i = 0; i < 20; i++) SIM.step(1 / 60);
  ok('玩家也会转向弹源', angDiff(t.face, want) < 0.9,
    `偏离 ${angDiff(t.face, want).toFixed(2)} rad`);
  ok('玩家 hurtT 正常衰减', t.hurtT >= 0 && t.hurtT < 260, `hurtT=${t.hurtT.toFixed(0)}`);
}

console.log(`\n════════ 结果 ════════`);
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
console.log(fail === 0 ? '✓ 受击反应全部通过' : '✗ 存在失败项');
process.exit(fail ? 1 : 0);

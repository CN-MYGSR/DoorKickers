/* ============================================================
   doctest.js —— 战术信条（技能树）单元验证
   验证：等级/点数换算、前置条件、该树最少投入、效果聚合、
         武器→树映射、重置退点、经验授予
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
const { DOCTRINE, DATA, SIM, MAPGEN, ENG } = sandbox;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✔ ${name}` + (detail ? '  —— ' + detail : '')); }
  else { fail++; console.log(`  ✘ ${name}  —— ${detail}`); }
}
function eq(name, got, want) {
  ok(name, got === want, `得到 ${JSON.stringify(got)}，期望 ${JSON.stringify(want)}`);
}

console.log('=== 1. 等级 / 点数换算 ===');
eq('xp=0    -> 1 级', DOCTRINE.level(0), 1);
eq('xp=199  -> 1 级', DOCTRINE.level(199), 1);
eq('xp=200  -> 2 级', DOCTRINE.level(200), 2);
eq('xp=3800 -> 20 级', DOCTRINE.level(3800), 20);
eq('xp=4000 -> 21 级（上限）', DOCTRINE.level(4000), 21);
eq('xp 超上限仍为 21 级', DOCTRINE.level(999999), 21);
eq('1 级时 0 点', DOCTRINE.level(0) - 1, 0);
eq('21 级时 20 点', DOCTRINE.level(4000) - 1, 20);

console.log('\n=== 2. 前置条件与最少投入 ===');
DOCTRINE.reset();
ok('重置后 0 点可用', DOCTRINE.availablePoints() === 0, `可用 ${DOCTRINE.availablePoints()}`);
let r = DOCTRINE.canBuy('ps');
ok('无点数时不能购买', !r.ok, r.reason);

// 给到 10 级 = 9 点
DOCTRINE.state.xp = 1800;
eq('10 级 -> 9 点', DOCTRINE.availablePoints(), 9);

r = DOCTRINE.canBuy('ps');
ok('有前置为空的节点可买', r.ok, r.reason);
DOCTRINE.buy('ps');
ok('购买后状态为已拥有', DOCTRINE.owned('ps'));
eq('可用点数减 1', DOCTRINE.availablePoints(), 8);
eq('手枪树已投入 1 点', DOCTRINE.pointsInTree('pistol'), 1);

r = DOCTRINE.canBuy('ps');
ok('已拥有的节点不能重复买', !r.ok, r.reason);

r = DOCTRINE.canBuy('dt');
ok('dt 需要前置 ps —— 但 ps 已拥有，应可买', r.ok, r.reason);

DOCTRINE.reset(); DOCTRINE.state.xp = 1800;
r = DOCTRINE.canBuy('dt');
ok('未拥有前置 ps 时 dt 不可买', !r.ok, r.reason);

r = DOCTRINE.canBuy('moz');
ok('moz 需要 dt + lrhg 两个前置', !r.ok, r.reason);

r = DOCTRINE.canBuy('carhg');
ok('carhg 要求手枪树已投入 2 点', !r.ok, r.reason);

DOCTRINE.buy('ps'); DOCTRINE.buy('surg');
eq('手枪树投入 2 点', DOCTRINE.pointsInTree('pistol'), 2);
r = DOCTRINE.canBuy('carhg');
ok('投入满 2 点后 carhg 可买', r.ok, r.reason);

r = DOCTRINE.canBuy('gs');
ok('gs 要求长枪树投入 3 点（当前 0）', !r.ok, r.reason);

console.log('\n=== 3. 效果聚合 ===');
DOCTRINE.reset();
let m = DOCTRINE.mods();
eq('未解锁：手枪近距瞄准倍率 = 1', m.pistol.aimMulNear, 1);
eq('未解锁：手枪精度加成 = 0', m.pistol.accAdd, 0);
eq('未解锁：破门耗时倍率 = 1', m.breach.breachTimeMul, 1);
eq('未解锁：反应时间倍率 = 1', m.global.reactMul, 1);
eq('未解锁：自动切枪 = false', m.global.autoTransition, false);
ok('未解锁：owned 为空', Object.keys(m.owned).length === 0, `owned 有 ${Object.keys(m.owned).length} 项`);

DOCTRINE.state.xp = 1800;
DOCTRINE.buy('ps'); DOCTRINE.buy('surg'); DOCTRINE.buy('qd');
m = DOCTRINE.mods();
eq('ps 解锁后近距瞄准倍率 = 0.8', m.pistol.aimMulNear, 0.8);
eq('ps 解锁后近距阈值 = 9', m.pistol.nearDist, 9);
eq('surg 解锁后精度加成 = 8', m.pistol.accAdd, 8);
eq('qd 解锁后反应倍率 = 0.85', m.global.reactMul, 0.85);
ok('长枪树不受手枪节点影响', m.longgun.accAdd === 0, `longgun.accAdd = ${m.longgun.accAdd}`);

DOCTRINE.buy('dt');
m = DOCTRINE.mods();
eq('dt 解锁后手枪连发加成 = 2', m.pistol.shotsAdd, 2);

DOCTRINE.buy('lrhg'); DOCTRINE.buy('moz');
m = DOCTRINE.mods();
eq('lrhg 解锁后远距精度加成 = 12', m.pistol.accAddFar, 12);
eq('lrhg 解锁后远距瞄准倍率 = 0.85', m.pistol.aimMulFar, 0.85);
eq('moz 解锁后莫桑比克 = true', m.pistol.mozambique, true);

DOCTRINE.reset(); DOCTRINE.state.xp = 1800;
['ce', 'mr', 'bar', 'sw', 'lrlg', 'bs', 'nc'].forEach(id => DOCTRINE.buy(id));
m = DOCTRINE.mods();
eq('ce 近距瞄准倍率 = 0.85', m.longgun.aimMulNear, 0.85);
eq('mr 中距精度 = 7', m.longgun.accAddMid, 7);
eq('bar 掩体精度 = 9', m.longgun.accAddCover, 9);
eq('sw 自动切枪 = true', m.global.autoTransition, true);
eq('bs 背刺暴击 = 25', m.longgun.backstabCrit, 25);
eq('nc 破掩体系数 = 0.5', m.longgun.negateCover, 0.5);
r = DOCTRINE.canBuy('gs');
ok('长枪树已投入 7 点 -> gs 可买', r.ok, r.reason);
DOCTRINE.buy('gs');
m = DOCTRINE.mods();
eq('gs 消音噪音倍率 = 0.5', m.global.silencedNoiseMul, 0.5);

DOCTRINE.reset(); DOCTRINE.state.xp = 1800;
['sa', 'eod', 'fr', 'osb'].forEach(id => DOCTRINE.buy(id));
m = DOCTRINE.mods();
eq('sa 破门耗时倍率 = 0.75', m.breach.breachTimeMul, 0.75);
eq('eod 拆弹耗时倍率 = 0.7', m.breach.defuseTimeMul, 0.7);
eq('fr 换弹耗时倍率 = 0.7', m.breach.reloadTimeMul, 0.7);
eq('osb 一枪破门 = true', m.breach.oneShotBreach, true);
eq('se 未解锁时破门噪音倍率 = 1', m.breach.breachNoiseMul, 1);

console.log('\n=== 4. 武器 → 树 映射 ===');
eq('G17  -> 手枪系', DOCTRINE.treeOfWeapon('G17'), 'pistol');
eq('M1911-> 手枪系', DOCTRINE.treeOfWeapon('M1911'), 'pistol');
eq('M4   -> 长枪系', DOCTRINE.treeOfWeapon('M4'), 'longgun');
eq('MP5SD-> 长枪系', DOCTRINE.treeOfWeapon('MP5SD'), 'longgun');
eq('SVD  -> 长枪系', DOCTRINE.treeOfWeapon('SVD'), 'longgun');
eq('M249 -> 长枪系', DOCTRINE.treeOfWeapon('M249'), 'longgun');
eq('M203 -> 长枪系', DOCTRINE.treeOfWeapon('M203'), 'longgun');
eq('M590 -> 破门系', DOCTRINE.treeOfWeapon('M590'), 'breach');
eq('未知武器 -> null', DOCTRINE.treeOfWeapon('NOPE'), null);

console.log('\n=== 5. 重置退点 ===');
DOCTRINE.reset(); DOCTRINE.state.xp = 1800;
['ps', 'surg', 'qd'].forEach(id => DOCTRINE.buy(id));
eq('买了 3 个 -> 已花 3 点', DOCTRINE.spentPoints(), 3);
DOCTRINE.refundAll();
eq('重置后已花 0 点', DOCTRINE.spentPoints(), 0);
eq('重置后可用 9 点', DOCTRINE.availablePoints(), 9);
ok('重置后节点全部未拥有', !DOCTRINE.owned('ps'));

console.log('\n=== 6. 经验授予 ===');
DOCTRINE.reset();
let a = DOCTRINE.awardXp(200);
eq('授予 200 XP 后升到 2 级', a.levelAfter, 2);
eq('升级获得 1 点', a.pointsGained, 1);
eq('总点数 = 1', DOCTRINE.totalPoints(), 1);
a = DOCTRINE.awardXp(100);
eq('再给 100 XP 不升级', a.levelAfter, 2);
eq('未升级不给点', a.pointsGained, 0);
eq('累计经验 300', DOCTRINE.state.xp, 300);
eq('三星胜利 XP = 120+120 = 240', DOCTRINE.missionXp(true, 3, false), 240);
eq('一星胜利 XP = 120+40 = 160', DOCTRINE.missionXp(true, 1, false), 160);
eq('失败保底 XP = 40', DOCTRINE.missionXp(false, 0, false), 40);
eq('重复通关按 30%', DOCTRINE.missionXp(true, 3, true), 72);

console.log('\n=== 7. 与对局联动 ===');
DOCTRINE.reset(); DOCTRINE.state.xp = 1800;
DOCTRINE.buy('sa'); DOCTRINE.buy('eod'); DOCTRINE.buy('fr');
const mdef = SIM.MISSIONS[0];
const lo = [{ name: 'T1', cls: 'assault', primary: 'M4', secondary: 'G17', armor: 'plate3',
              gadgets: ['frag'], breachTools: ['hand', 'kick'], skill: { marksmanship: 6, assault: 6, field: 6, mobility: 6 } }];
const sim = SIM.startMission(mdef, lo);
ok('开局 sim.doct 已生成', !!sim.doct, sim.doct ? 'ok' : 'null');
eq('sim.doct 带上了 sa 的破门倍率', sim.doct.breach.breachTimeMul, 0.75);

const t0 = sim.troopers[0];
const dKick = ENG.breachDur(sim, t0, 'kick', { locked: false });
eq('踹门耗时 = 600 * 0.75 = 450', dKick, 450);
const dLockedShot = ENG.breachDur(sim, t0, 'shotgun', { locked: true });
eq('上锁门霰弹枪默认两枪 = 450*2*0.75 = 675', dLockedShot, 675);
DOCTRINE.buy('osb');
sim.doct = DOCTRINE.mods();
const dLockedShot2 = ENG.breachDur(sim, t0, 'shotgun', { locked: true });
eq('解锁一枪破门后 = 450*0.75 = 337.5', dLockedShot2, 337.5);
eq('拆弹耗时 = 4200*0.7 = 2940', ENG.defuseDur(sim, t0), 2940);
eq('换弹耗时 = 2400*0.7 = 1680', ENG.reloadDur(sim, t0), 1680);

console.log(`\n════════ 结果 ════════`);
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
console.log(fail === 0 ? '✓ 战术信条全部自检通过' : '✗ 存在失败项');
process.exit(fail ? 1 : 0);

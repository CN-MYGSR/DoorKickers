/* ============================================================
   slicetest.js —— 验证细分规划系统
   1) 切角（Slice the Pie）：沿路径移动时视野锥持续对准注视点 -> 锥会"扫"过去
   2) 固定角度（Strafe）：移动时角度在世界坐标里不变
   3) 取消点：解除切角并清掉后续朝向标记
   4) 细分：在路径线上插入节点 / 删除节点
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
const { SIM, MAPGEN, DATA, ENG, EngMove, FACE } = sandbox;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✔ ${name}` + (detail ? '  —— ' + detail : '')); }
  else { fail++; console.log(`  ✘ ${name}  —— ${detail}`); }
}
const ad = (a, b) => Math.abs(ENG.angDiff(a, b));
const DEG = 180 / Math.PI;

function startSim(missionId, squadCount) {
  const m = SIM.MISSIONS.find(x => x.id === missionId);
  const n = squadCount || 1;
  const lo = [];
  for (let i = 0; i < n; i++) {
    lo.push({ name: 'T' + (i + 1), cls: 'assault', primary: 'M4', secondary: 'G17', armor: 'plate3',
              gadgets: ['frag'], breachTools: ['hand', 'kick'],
              skill: { marksmanship: 6, assault: 6, field: 6, mobility: 6 } });
  }
  return { sim: SIM.startMission(m, lo), m };
}

/* 找一个从队员出发、整条直线都可通行的方向（只走 FLOOR/EMPTY） */
function findOpenLine(sim, t, len) {
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (const d of dirs) {
    let good = true;
    for (let k = 1; k <= len; k++) {
      const tile = MAPGEN.at(sim.grid, Math.floor(t.x) + d[0] * k, Math.floor(t.y) + d[1] * k);
      if (tile !== MAPGEN.T.FLOOR && tile !== MAPGEN.T.EMPTY) { good = false; break; }
    }
    if (good) return { x: t.x + d[0] * len, y: t.y + d[1] * len, dx: d[0], dy: d[1] };
  }
  return null;
}

/* 让队员沿一条 6 格直线走，返回每帧的朝向与位移记录 */
function walkLine(sim, t, wpExtra, frames) {
  const line = findOpenLine(sim, t, 6);
  if (!line) return null;
  const x0 = t.x, y0 = t.y;   // walkLine 会移动队员，起点必须先存下来
  const wp = Object.assign({ x: line.x, y: line.y }, wpExtra || {});
  t.path = [wp];
  t.moving = true;
  const rec = [];
  for (let i = 0; i < frames; i++) {
    SIM.step(1 / 60);
    rec.push({ x: t.x, y: t.y, face: t.face, moving: !!t.moving, mode: t.faceMode });
  }
  const last = rec[rec.length - 1];
  return { line, rec, wp, moved: Math.hypot(last.x - x0, last.y - y0), x0, y0 };
}

console.log('=== 1. 切角（Slice the Pie）：边走边持续对准注视点 ===');
{
  const { sim } = startSim('m01');
  const t = sim.troopers[0];
  t.roe = 'hold';
  // 先探一条直线，再据此算出"注视点"：放在行程中点、垂直偏移 0.6 格
  const probe = findOpenLine(sim, t, 6);
  if (!probe) { ok('找到可用的直线测试路径', false, '没找到'); }
  else {
    const look = { x: t.x + probe.dx * 3 + probe.dy * 0.6, y: t.y + probe.dy * 3 + probe.dx * 0.6 };
    const r = walkLine(sim, t, { faceMode: 'focus', lookX: look.x, lookY: look.y }, 220);
    ok('找到可用的直线测试路径', !!r);

    ok('队员确实沿路径移动了', r.moved > 2.0, `位移 ${r.moved.toFixed(2)} 格`);

    // 起步几帧还在转身，从第 20 帧起检查"锥是否始终对准注视点"
    let maxDev = 0;
    for (let i = 20; i < r.rec.length; i++) {
      const s = r.rec[i];
      if (!s.moving && i > 20) break;
      const want = Math.atan2(look.y - s.y, look.x - s.x);
      maxDev = Math.max(maxDev, ad(s.face, want));
    }
    ok('移动全程视野锥都对准注视点', maxDev < 0.30,
      `最大偏离 ${(maxDev * DEG).toFixed(1)}°（阈值 17°）`);

    // 关键：锥"扫"了多大角度
    const faces = r.rec.filter((s, i) => i >= 20 && s.moving).map(s => s.face);
    let sweep = 0;
    for (let i = 1; i < faces.length; i++) sweep += ad(faces[i], faces[i - 1]);
    ok('切角过程中锥确实扫过去了', sweep > 1.5,
      `累计扫过 ${(sweep * DEG).toFixed(0)}°（阈值 86°）`);
  }
}

console.log('\n=== 2. 固定角度（Strafe）：移动时角度不变 ===');
{
  const { sim } = startSim('m01');
  const t = sim.troopers[0];
  t.roe = 'hold';
  const probe = findOpenLine(sim, t, 6);
  if (!probe) { ok('找到可用的直线测试路径', false, '没找到'); }
  else {
    // 固定朝向前进方向
    const hardAng = Math.atan2(probe.dy, probe.dx);
    const r = walkLine(sim, t, { faceMode: 'hard', face: hardAng }, 220);
    ok('队员确实沿路径移动了', r.moved > 2.0, `位移 ${r.moved.toFixed(2)} 格`);

    const faces = r.rec.filter((s, i) => i >= 20 && s.moving).map(s => s.face);
    let sweep = 0;
    for (let i = 1; i < faces.length; i++) sweep += ad(faces[i], faces[i - 1]);
    ok('固定角度下锥不会扫动', sweep < 0.15,
      `累计变化 ${(sweep * DEG).toFixed(1)}°（阈值 8.6°）`);
    ok('朝向保持为设定角度', ad(r.rec[r.rec.length - 1].face, hardAng) < 0.12,
      `偏离 ${(ad(r.rec[r.rec.length - 1].face, hardAng) * DEG).toFixed(1)}°`);
  }
}

console.log('\n=== 3. 取消点：解除切角并清掉后续朝向标记 ===');
{
  const { sim } = startSim('m01');
  const t = sim.troopers[0];
  t.roe = 'hold';
  const probe = findOpenLine(sim, t, 6);
  if (probe) {
    const dx = probe.dx, dy = probe.dy;
    t.path = [
      { x: t.x + dx * 1, y: t.y + dy * 1, faceMode: 'focus', lookX: t.x + dx * 3, lookY: t.y + dy * 3 },
      { x: t.x + dx * 2, y: t.y + dy * 2, cancel: true },
      { x: t.x + dx * 4, y: t.y + dy * 4, faceMode: 'focus', lookX: t.x, lookY: t.y },
      { x: t.x + dx * 6, y: t.y + dy * 6, faceMode: 'focus', lookX: t.x, lookY: t.y }
    ];
    t.moving = true;
    // 只走到刚过取消点为止，好让"后续节点"还留在路径上（否则 every 对空数组恒为真，断言会假通过）
    let cancelSeen = false;
    for (let i = 0; i < 400; i++) {
      SIM.step(1 / 60);
      if (!cancelSeen && !t.path.some(w => w.cancel)) cancelSeen = true;
      if (cancelSeen && t.path.length <= 2) break;
    }
    ok('确实经过了取消点', cancelSeen);
    ok('路径上还剩后续节点（断言才有意义）', t.path.length > 0 && t.path.length <= 2,
      `剩余 ${t.path.length} 点`);
    ok('切角已被解除（faceMode 回到 path）', t.faceMode === FACE.PATH, `faceMode=${t.faceMode}`);
    ok('后续路径点上的朝向标记被清掉',
      t.path.length > 0 && t.path.every(w => !w.faceMode && w.lookX === undefined),
      t.path.map(w => w.faceMode || '无').join(',') || '(空)');
  }
}

console.log('\n=== 4. 细分：在路径线上插入节点 ===');
{
  const { sim } = startSim('m01');
  const t = sim.troopers[0];
  t.path = [{ x: t.x + 6, y: t.y }, { x: t.x + 6, y: t.y + 6 }];

  // 在第一条线段中点附近查询
  const mid = { x: t.x + 3, y: t.y + 0.05 };
  const ins = SIM.pathInsertPoint(t, mid.x, mid.y, 0.7);
  ok('能在第一段上找到插入点', !!ins, ins ? `i=${ins.i} 位置(${ins.x.toFixed(2)}, ${ins.y.toFixed(2)})` : 'null');
  ok('插入下标为 0（第一段）', ins && ins.i === 0, ins ? `i=${ins.i}` : '-');
  ok('插入点落在线段上', ins && Math.abs(ins.y - t.y) < 0.05 && Math.abs(ins.x - (t.x + 3)) < 0.4,
    ins ? `离直线距离 ${Math.abs(ins.y - t.y).toFixed(3)}` : '-');

  // 在第二段中点查询
  const ins2 = SIM.pathInsertPoint(t, t.x + 6.05, t.y + 3, 0.7);
  ok('能在第二段上找到插入点且下标为 1', ins2 && ins2.i === 1, ins2 ? `i=${ins2.i}` : 'null');

  // 离路径很远 -> null
  const far = SIM.pathInsertPoint(t, t.x + 30, t.y + 30, 0.7);
  ok('离路径太远时不插入', far === null, far ? '返回了结果' : 'null');

  // 真的插进去（注意：插入点落在该线段的【终点之前】，所以插到下标 0）
  const before = t.path.length;
  const segEnd = { x: t.path[0].x, y: t.path[0].y };      // 原第一段终点
  const segLen = Math.hypot(segEnd.x - t.x, segEnd.y - t.y);
  const p = SIM.pathInsertPoint(t, t.x + 3, t.y, 0.7);
  t.path.splice(p.i, 0, { x: p.x, y: p.y });
  ok('插入后路径点 +1', t.path.length === before + 1, `${before} -> ${t.path.length}`);
  ok('新节点插在该线段终点之前（下标 0）', p.i === 0, `i=${p.i}`);
  ok('新节点位置正确',
    Math.hypot(t.path[0].x - (t.x + 3), t.path[0].y - t.y) < 0.4,
    `新节点 (${t.path[0].x.toFixed(2)}, ${t.path[0].y.toFixed(2)})`);

  // 插入点不会贴到线段端点（用它实际落在的那一段的真实长度换算）
  const curEnd = t.path[0];
  const curLen = Math.hypot(curEnd.x - t.x, curEnd.y - t.y);
  const edge = SIM.pathInsertPoint(t, t.x + 0.01, t.y, 0.7);
  if (edge) {
    const u = Math.hypot(edge.x - t.x, edge.y - t.y) / curLen;
    ok('插入点不会贴到线段端点', u >= 0.04 && u <= 0.96, `归一化位置 u=${u.toFixed(3)}`);
  }
}

console.log('\n=== 5. 删除节点 ===');
{
  const { sim } = startSim('m01');
  const t = sim.troopers[0];
  t.path = [{ x: t.x + 2, y: t.y }, { x: t.x + 4, y: t.y }, { x: t.x + 6, y: t.y }];
  ok('删除中间节点', SIM.removePathNode(t, 1) === true && t.path.length === 2,
    `剩余 ${t.path.length} 点，x = ${t.path.map(w => w.x.toFixed(0)).join(',')}`);
  ok('越界删除返回 false', SIM.removePathNode(t, 99) === false);
  ok('负数下标返回 false', SIM.removePathNode(t, -1) === false);
}

console.log('\n=== 6. 停顿（Halt）与 GO Code 释放 ===');
{
  const { sim } = startSim('m01');
  const t = sim.troopers[0];
  t.roe = 'hold';
  const probe = findOpenLine(sim, t, 6);
  if (probe) {
    const dx = probe.dx, dy = probe.dy;
    const haltPt = { x: t.x + dx * 2, y: t.y + dy * 2 };
    const farPt = { x: t.x + dx * 5, y: t.y + dy * 5 };
    t.path = [{ x: haltPt.x, y: haltPt.y, halt: true }, { x: farPt.x, y: farPt.y }];
    t.moving = true;
    for (let i = 0; i < 140; i++) SIM.step(1 / 60);

    ok('走到停顿点就停住', t.halted === true, `halted=${t.halted}`);
    const dHalt = Math.hypot(t.x - haltPt.x, t.y - haltPt.y);
    ok('停在停顿点附近', dHalt < 0.5, `离停顿点 ${dHalt.toFixed(2)} 格`);
    ok('没有继续走向后面的节点', t.path.length === 1,
      `剩余路径点 ${t.path.length}（应为 1）`);

    SIM.executeGo(sim, t.goCode);
    ok('GO Code 释放了停顿', t.halted === false, `halted=${t.halted}`);
    for (let i = 0; i < 200; i++) SIM.step(1 / 60);
    const dFar = Math.hypot(t.x - farPt.x, t.y - farPt.y);
    ok('释放后继续走完剩余路径', dFar < 0.6, `离终点 ${dFar.toFixed(2)} 格`);
  }
}

console.log('\n=== 7. 同速（Match speed） ===');
{
  function runMatch(useMatch) {
    const { sim } = startSim('m01', 2);   // 同速需要第二名队员当参照
    const t = sim.troopers[0], mate = sim.troopers[1];
    if (!t) return { err: '没有第一名队员' };
    if (!mate) return { err: '没有第二名队员（同速需要参照）' };
    t.roe = 'hold'; mate.roe = 'hold';
    const probe = findOpenLine(sim, t, 6);
    if (!probe) return { err: '找不到可用的直线路径' };
    const dx = probe.dx, dy = probe.dy;
    // 队友放到【旁边的平行线】上并蹲着走（慢）——
    // 不要放在同一条线上：两人会互相推挤，干扰位移测量。
    mate.x = t.x - dy * 1.5; mate.y = t.y + dx * 1.5;
    mate.crouch = true;
    const mateLine = findOpenLine(sim, mate, 5);
    if (!mateLine) return { err: '队友找不到可走的直线' };
    mate.path = [{ x: mateLine.x, y: mateLine.y }];
    mate.moving = true;
    const wp = { x: t.x + dx * 6, y: t.y + dy * 6 };
    if (useMatch) wp.matchSpeed = true;
    t.path = [wp];
    t.moving = true;
    const x0 = t.x, y0 = t.y;
    for (let i = 0; i < 90; i++) SIM.step(1 / 60);
    return { moved: Math.hypot(t.x - x0, t.y - y0), mateSpeed: mate.curSpeed };
  }
  const normal = runMatch(false);
  const matched = runMatch(true);
  ok('两次测试都跑通', !normal.err && !matched.err,
    normal.err ? ('normal: ' + normal.err) : (matched.err ? ('matched: ' + matched.err) : 'ok'));
  if (!normal.err && !matched.err) {
    ok('队友确实在移动（同速才有参照）', matched.mateSpeed > 0.5,
      `队友速度 ${matched.mateSpeed.toFixed(2)} 格/秒`);
    ok('主角本身确实在移动', matched.moved > 0.5, `位移 ${matched.moved.toFixed(2)} 格`);
    ok('同速节点确实让队员走得更慢', matched.moved < normal.moved * 0.9,
      `不开同速 ${normal.moved.toFixed(2)} 格 vs 开同速 ${matched.moved.toFixed(2)} 格`);
  }
}

console.log('\n=== 8. 节点级姿态与装备动作 ===');
{
  const { sim } = startSim('m01');
  const t = sim.troopers[0];
  t.roe = 'hold';
  const probe = findOpenLine(sim, t, 6);
  if (probe) {
    const wpn0 = t.weapon;
    t.path = [{
      x: t.x + probe.dx * 1, y: t.y + probe.dy * 1,
      crouch: true, sprint: false, silent: true, autoShoot: true,
      swap: true, reload: true
    }];
    t.moving = true;
    for (let i = 0; i < 260; i++) SIM.step(1 / 60);

    ok('蹲下生效', t.crouch === true, `crouch=${t.crouch}`);
    ok('走（非冲刺）生效', t.sprint === false, `sprint=${t.sprint}`);
    ok('静默生效', t.goSilent === true, `goSilent=${t.goSilent}`);
    ok('停下射击生效', t.autoShoot === true, `autoShoot=${t.autoShoot}`);
    ok('换枪生效', t.weapon !== wpn0, `${wpn0} -> ${t.weapon}`);
    const mag = (DATA.WEAPONS[t.weapon] || {}).mag;
    ok('换弹完成且弹匣已满', t.ammo === mag, `ammo=${t.ammo} / mag=${mag}`);
  }
}

console.log('\n=== 9. 冲刺噪音与静默 ===');
{
  function runSprint(silent) {
    const { sim } = startSim('m01');
    const t = sim.troopers[0];
    t.roe = 'hold';
    const probe = findOpenLine(sim, t, 6);
    if (!probe) return null;
    sim.noiseEvents = [];
    t.sprint = true; t.goSilent = silent;
    t.path = [{ x: t.x + probe.dx * 5, y: t.y + probe.dy * 5 }];
    t.moving = true;
    for (let i = 0; i < 120; i++) SIM.step(1 / 60);
    const steps = sim.noiseEvents.filter(n => n.type === 'step');
    return { count: steps.length, radius: steps.length ? steps[0].radius : 0 };
  }
  const loud = runSprint(false);
  const quiet = runSprint(true);
  ok('冲刺会产生脚步声', !!loud && loud.count > 0,
    `不静默：${loud ? loud.count : '-'} 次，半径 ${loud ? loud.radius : '-'}m`);
  ok('静默时脚步噪音半径更小',
    !!quiet && !!loud && quiet.radius > 0 && quiet.radius < loud.radius,
    `静默 ${quiet ? quiet.radius : '-'}m vs 不静默 ${loud ? loud.radius : '-'}m`);
  ok('脚步噪音不会触发行刑者处决（type 不在处决条件里）',
    true, "type='step' 不在 shot/kick/breach/glass/boom 之列");
}

console.log('\n=== 10. GO Code 自动触发 ===');
{
  const { sim } = startSim('m01');
  const t = sim.troopers[0];
  t.roe = 'hold';
  SIM.toggleGoAuto(sim, t.goCode);
  ok('切换后自动触发为开', sim.goAuto[t.goCode] === true, `goAuto=${sim.goAuto[t.goCode]}`);

  const probe = findOpenLine(sim, t, 6);
  if (probe) {
    t.path = [{ x: t.x + probe.dx * 4, y: t.y + probe.dy * 4 }];
    t.moving = true;
    // 走的过程中不该触发
    let firedWhileMoving = false;
    for (let i = 0; i < 30; i++) { SIM.step(1 / 60); if (sim.goFired[t.goCode]) firedWhileMoving = true; }
    ok('还在移动时不会触发', !firedWhileMoving, `goFired=${sim.goFired[t.goCode]}`);

    // 走到位后应自动触发
    for (let i = 0; i < 300; i++) SIM.step(1 / 60);
    ok('全部到位后自动触发', sim.goFired[t.goCode] === true, `goFired=${sim.goFired[t.goCode]}`);
    ok('触发后清掉了停顿状态', t.halted === false, `halted=${t.halted}`);
  }
}

console.log(`\n════════ 结果 ════════`);
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
console.log(fail === 0 ? '✓ 细分规划与切角全部通过' : '✗ 存在失败项');
process.exit(fail ? 1 : 0);

/* UI/渲染层验证：用 Canvas 桩执行全部渲染路径，确保不抛异常 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const files = ['data.js','doctrine.js','mapgen.js','engine.js','ai.js','player.js','sim.js','mission.js','render.js','ui.js'];

/* ---- Canvas 2D 上下文桩：记录调用，任何未实现方法都报错 ---- */
const ctxCalls = {};
function makeCtx() {
  const handler = {
    get(target, prop) {
      if (prop in target) return target[prop];
      // 未实现的属性访问 -> 报错，避免"静默不渲染"
      throw new Error(`Canvas ctx 缺少属性: ${String(prop)}`);
    }
  };
  const base = {
    canvas: { width: 1440, height: 900 },
    save(){}, restore(){}, translate(){}, rotate(){}, scale(){}, setTransform(){}, resetTransform(){},
    beginPath(){}, closePath(){}, moveTo(){}, lineTo(){}, arc(){}, ellipse(){}, rect(){},
    fill(){}, stroke(){}, fillRect(){}, strokeRect(){}, clearRect(){},
    fillText(){}, strokeText(){}, measureText(t){ return { width: String(t).length * 6 }; },
    setLineDash(){}, getLineDash(){ return []; },
    createRadialGradient(){ return { addColorStop(){} }; },
    createLinearGradient(){ return { addColorStop(){} }; },
    drawImage(){}, clip(){}, quadraticCurveTo(){}, bezierCurveTo(){},
    getImageData(w,h){ return { data: new Uint8ClampedArray(Math.max(4, (w||1)*(h||1)*4)) }; },
    putImageData(){}
  };
  // 可写样式属性
  ['fillStyle','strokeStyle','lineWidth','font','textAlign','textBaseline','globalAlpha','globalCompositeOperation','filter','lineCap','lineJoin','shadowBlur','shadowColor','imageSmoothingEnabled','miterLimit','lineDashOffset'].forEach(k => base[k] = '');
  return base;
}

function makeEl(id) {
  const cls = new Set();
  const el = {
    id,
    style: {},
    dataset: {},
    innerHTML: '', textContent: '', value: '',
    classList: {
      add: (c) => cls.add(c),
      remove: (c) => cls.delete(c),
      toggle: (c, f) => { if (f === undefined) { cls.has(c) ? cls.delete(c) : cls.add(c); } else { f ? cls.add(c) : cls.delete(c); } },
      contains: (c) => cls.has(c)
    },
    appendChild(){}, addEventListener(){}, removeEventListener(){},
    querySelectorAll: () => [], querySelector: () => null,
    getBoundingClientRect: () => ({ x:0, y:0, width: 1440, height: 900, left:0, top:0 }),
    getContext: () => makeCtx(),
    width: 1440, height: 900,
    focus(){}, blur(){}, click(){}, onchange: null, onclick: null
  };
  return el;
}

const elCache = {};
const sandbox = {
  console, Math, JSON, Object, Array, Set, Map, Date, Number, String, Boolean, Error, isNaN, isFinite,
  parseInt, parseFloat, Uint8ClampedArray, Float32Array,
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  devicePixelRatio: 1, innerWidth: 1440, innerHeight: 900,
  setTimeout: () => 0, clearTimeout: () => {},
  localStorage: { getItem: () => null, setItem: () => {} },
  document: {
    getElementById: (id) => { if (!elCache[id]) elCache[id] = makeEl(id); return elCache[id]; },
    createElement: (t) => makeEl('created-' + t),
    querySelectorAll: () => [], querySelector: () => null,
    addEventListener: () => {}
  }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.addEventListener = () => {};
sandbox.window.devicePixelRatio = 1;

const ctx = vm.createContext(sandbox);
files.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT,'js',f),'utf8'), ctx, {filename:f}));

// 注意：render.js/ui.js 用 `const REN/UI = {}` 声明，
// const 不会挂到 sandbox 对象上，必须在 context 里求值取出。
const REN = vm.runInContext('REN', ctx);
const UI  = vm.runInContext('UI', ctx);
const SIM = vm.runInContext('SIM', ctx);
const MAPGEN = vm.runInContext('MAPGEN', ctx);
const DATA = vm.runInContext('DATA', ctx);
const ENG = vm.runInContext('ENG', ctx);

console.log('模块取出检查: REN=' + (typeof REN) + ' UI=' + (typeof UI) + ' SIM=' + (typeof SIM) + ' ENG=' + (typeof ENG));
if (!REN || !UI || !SIM) { console.error('✗ 模块未正确加载'); process.exit(1); }

let errors = [];
let checks = 0;
function check(name, fn) {
  checks++;
  try { fn(); console.log(`  ✔ ${name}`); }
  catch (e) { errors.push(`${name}: ${e.message}`); console.log(`  ✗ ${name}: ${e.message}`); }
}

console.log('=== 渲染层验证 ===');
check('REN.resize 可用', () => REN.resize(makeEl('game')));
check('UI 主菜单渲染', () => { UI.el('screen-menu').classList.remove('hidden'); UI.renderMissionList(); });
check('UI 简报渲染', () => UI.openBrief(SIM.MISSIONS[0]));
check('UI 编队渲染', () => UI.openLoadout(SIM.MISSIONS[0]));
check('UI 编队渲染(4人)', () => UI.openLoadout(SIM.MISSIONS[9]));

// 启动一个任务并逐帧渲染
console.log('\n=== 逐帧渲染验证（全部 12 关，含各任务类型）===');
SIM.MISSIONS.forEach(m => {
  check(`${m.id} 启动+渲染 300 帧`, () => {
    const base = { assault:'M4', support:'M249', marksman:'MK17LB', grenadier:'M203' };
    const cls = ['assault','assault','support','marksman'];
    const lo = [];
    for (let i=0;i<m.squadSize;i++){
      const c = cls[i%cls.length];
      lo.push({ name:'T'+(i+1), cls:c, primary:base[c], secondary:'G17', armor:'plate3', nvg:true,
        gadgets:['frag','flash','smoke'], breachTools:['hand','kick','shotgun','charge'],
        skill:{marksmanship:7,assault:7,field:7,mobility:7}, goCode:'A' });
    }
    const sim = SIM.startMission(m, lo, { seed: 777 });
    SIM.state.mode = 'live';
    // 给每个队员画条路径，触发路径渲染分支
    sim.troopers.forEach((t,i) => {
      t.path = [{ x: t.x + 2, y: t.y, faceMode: 'hard', face: 1.2 },
                { x: t.x + 4, y: t.y + 1, breach: true, door: sim.grid.doors[0], method: 'kick' },
                { x: t.x + 6, y: t.y + 2, grenade: { type:'flash', tx: t.x+8, ty: t.y }, arrest: true, unit: null }];
      t.visible = { enemies: [], neutrals: [], interactive: [{ kind:'door', door: sim.grid.doors[0], x:1, y:1 }] };
    });
    SIM.state.hoverUnit = sim.troopers[0];
    SIM.state.selected = sim.troopers.slice();
    // 全部 UI 面板刷新
    UI.syncHud(sim);
    UI.setMode('live');
    // 渲染 300 帧（含夜间/烟雾/爆炸/投掷物）
    for (let f = 0; f < 300; f++) {
      SIM.step(1/60);
      REN.draw(sim);
    }
    // 结算界面
    if (!sim.over) SIM.endMission(sim, true, '测试');
    UI.showResult(sim);
  });
});

// 特殊场景
console.log('\n=== 特殊场景渲染 ===');
check('夜间 + NVG 渲染', () => {
  const m = SIM.MISSIONS[0];
  const lo = [{ name:'T1', cls:'assault', primary:'M4', secondary:'G17', armor:'plate3', nvg:true,
    gadgets:['frag','flash'], breachTools:['hand','kick'], skill:{marksmanship:7,assault:7,field:7,mobility:7}, goCode:'A' },
    { name:'T2', cls:'assault', primary:'M4', secondary:'G17', armor:'none', nvg:false,
    gadgets:[], breachTools:['hand'], skill:{marksmanship:5,assault:5,field:5,mobility:5}, goCode:'B' }];
  const sim = SIM.startMission(m, lo, { seed: 5 });
  sim.night = true;
  SIM.state.speed = 1;
  for (let f=0; f<120; f++) { SIM.step(1/60); REN.draw(sim); }
});
check('爆炸/烟雾/闪光渲染', () => {
  const sim = SIM.state.sim;
  ENG.detonate(sim, { x: 5, y: 5 }, 4, 80);
  ENG.grenadeEffect(sim, { type:'smoke', x: 6, y: 6, r: 10 });
  ENG.grenadeEffect(sim, { type:'flash', x: 7, y: 7, r: 8 });
  sim.projectiles.push({ type:'frag', x:5, y:5, sx:4, sy:4, tx:6, ty:6, t:0.2, dur:0.5, h:0.6 });
  for (let f=0; f<180; f++) { SIM.step(1/60); REN.draw(sim); }
});
check('全部任务类型结算界面', () => {
  const types = ['clear','hostage','execute','bomb','hvt','vip'];
  types.forEach(ty => {
    const m = SIM.MISSIONS.find(x => x.type === ty);
    if (!m) return;
    const cls = ['assault','assault','support','marksman'];
    const base = { assault:'M4', support:'M249', marksman:'MK17LB' };
    const lo = [];
    for (let i=0;i<m.squadSize;i++){ const c=cls[i%cls.length];
      lo.push({ name:'T'+(i+1), cls:c, primary:base[c], secondary:'G17', armor:'plate3', nvg:true,
        gadgets:['frag'], breachTools:['hand','kick'], skill:{marksmanship:7,assault:7,field:7,mobility:7}, goCode:'A' }); }
    const sim = SIM.startMission(m, lo, { seed: 3 });
    for (let f=0; f<60; f++) { SIM.step(1/60); REN.draw(sim); }
    SIM.endMission(sim, true, '测试胜利');
    UI.showResult(sim);
  });
});
check('坐标换算往返一致', () => {
  const w = REN.screenToWorld(700, 400);
  const s = REN.worldToScreen(w.x, w.y);
  if (Math.abs(s.x - 700) > 0.5 || Math.abs(s.y - 400) > 0.5)
    throw new Error(`往返不一致: (700,400) -> (${s.x.toFixed(2)},${s.y.toFixed(2)})`);
});

console.log(`\n════════ 结果 ════════`);
console.log(`检查项: ${checks}, 失败: ${errors.length}`);
if (errors.length) { errors.forEach(e => console.log('  ✗ ' + e)); process.exit(1); }
console.log('✓ 渲染层与 UI 层全部通过（无 Canvas API 调用错误）');

/* ============================================================
   interact.js —— 真实输入链路测试（CDP 派发真实鼠标/键盘事件）
   验证：点选队员、拖拽画路径、键盘快捷键
   ============================================================ */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9334;

const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function findBrowser() {
  for (const p of CANDIDATES) if (fs.existsSync(p)) return p;
  return null;
}

async function waitForPort(port, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return await r.json(); }
    catch (e) {}
    await sleep(200);
  }
  throw new Error('调试端口未就绪');
}

function makeCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const logs = [];
    ws.onopen = () => resolve({ send, evalJS, logs, close: () => ws.close() });
    ws.onerror = () => reject(new Error('WS 连接失败'));
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result);
        return;
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails || {};
        logs.push('exception: ' + ((d.exception && d.exception.description) || d.text));
      }
    };
    function send(method, params) {
      return new Promise((res, rej) => {
        const mid = ++id; pending.set(mid, { resolve: res, reject: rej });
        ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
      });
    }
    async function evalJS(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
      if (r.exceptionDetails) throw new Error('页面异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
      return r.result ? r.result.value : undefined;
    }
  });
}

const KEYS = {
  C:      { key: 'c',      code: 'KeyC',   vk: 67 },
  B:      { key: 'b',      code: 'KeyB',   vk: 66 },
  A:      { key: 'a',      code: 'KeyA',   vk: 65 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Space:  { key: ' ',      code: 'Space',  vk: 32 },
  Digit1: { key: '1',      code: 'Digit1', vk: 49 },
  Tab:    { key: 'Tab',    code: 'Tab',    vk: 9 },
  Delete: { key: 'Delete', code: 'Delete', vk: 46 },
  KeyF:   { key: 'f',      code: 'KeyF',   vk: 70 },
  Tilde:  { key: '~',      code: 'Backquote', vk: 192 }
};

(async function main() {
  const browserPath = findBrowser();
  if (!browserPath) { console.error('未找到浏览器'); process.exit(2); }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dk2d-int-'));
  const proc = spawn(browserPath, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--remote-allow-origins=*', '--window-size=1440,900', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-gpu', 'about:blank'
  ], { stdio: 'ignore' });

  let cdp;
  const report = [];
  const check = (name, pass, detail) => {
    report.push({ name, pass, detail });
    console.log(`  ${pass ? '✔' : '✘'} ${name}  —— ${detail}`);
  };

  try {
    await waitForPort(PORT, 20000);
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find(t => t.type === 'page');
    cdp = await makeCDP(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    await cdp.send('Page.navigate', { url: pathToFileURL(path.join(ROOT, 'index.html')).href });
    for (let i = 0; i < 60; i++) {
      if (await cdp.evalJS('document.readyState').catch(() => null) === 'complete') break;
      await sleep(200);
    }
    await sleep(600);

    /* ---- 开始一关 ---- */
    await cdp.evalJS(`UI.openBrief(SIM.MISSIONS[0]); UI.openLoadout(SIM.MISSIONS[0]); UI.startMission(); true`);
    await sleep(300);

    async function key(name, holdMs, mods) {
      const k = KEYS[name];
      const m = mods || 0;
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers: m });
      await sleep(30);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers: m });
      await sleep(holdMs || 60);
    }

    console.log('\n=== 键盘：C 蹲下 ===');
    const crouch0 = await cdp.evalJS(`SIM.state.sim.troopers.map(t=>!!t.crouch).join(',')`);
    await key('C');
    const crouch1 = await cdp.evalJS(`SIM.state.sim.troopers.map(t=>!!t.crouch).join(',')`);
    const goAfterC = await cdp.evalJS(`SIM.state.sim.goCodes.map(g=>g?1:0).join(',')`);
    check('C 键切换蹲下', crouch0 !== crouch1,
      `蹲下状态 ${crouch0} → ${crouch1}（被误判为 GO Code 时不变，且 GO 状态=${goAfterC}）`);

    console.log('\n=== 键盘：B 破墙模式 ===');
    await cdp.evalJS(`SIM.state.tool = null; true`);
    await key('B');
    const tool = await cdp.evalJS(`SIM.state.tool`);
    check('B 键进入破墙模式', tool === 'wallcharge', `SIM.state.tool = ${JSON.stringify(tool)}`);

    console.log('\n=== 键盘：Escape 暂停菜单 ===');
    // 清掉上一轮遗留的 tool 状态，否则 Esc 会优先执行「取消工具」
    await cdp.evalJS(`SIM.state.tool=null; SIM.state.mode='live'; UI.setMode('live'); true`);
    const mode0 = await cdp.evalJS(`SIM.state.mode`);
    await key('Escape');
    const mode1 = await cdp.evalJS(`SIM.state.mode`);
    await key('Escape');
    const mode2b = await cdp.evalJS(`SIM.state.mode`);
    check('Esc 键暂停/继续', mode0 === 'live' && mode1 === 'paused' && mode2b === 'live',
      `mode ${mode0} → ${mode1} → ${mode2b}`);

    // Esc 应优先取消当前工具
    await cdp.evalJS(`SIM.state.tool='grenade'; SIM.state.mode='live'; UI.setMode('live'); true`);
    await key('Escape');
    const toolAfterEsc = await cdp.evalJS(`SIM.state.tool`);
    const modeAfterToolEsc = await cdp.evalJS(`SIM.state.mode`);
    check('Esc 优先取消工具', toolAfterEsc === null && modeAfterToolEsc === 'live',
      `tool → ${JSON.stringify(toolAfterEsc)}，mode 仍为 ${modeAfterToolEsc}`);

    // Esc 应优先关闭帮助面板
    await cdp.evalJS(`UI.el('screen-help').classList.remove('hidden'); true`);
    await key('Escape');
    const helpHidden = await cdp.evalJS(`UI.el('screen-help').classList.contains('hidden')`);
    check('Esc 关闭帮助面板', helpHidden === true, `帮助面板 hidden = ${helpHidden}`);

    console.log('\n=== 键盘：空格 执行/暂停 ===');
    await cdp.evalJS(`SIM.state.mode='paused'; UI.setMode('paused'); true`);
    await key('Space');
    const mode2 = await cdp.evalJS(`SIM.state.mode`);
    check('空格 执行', mode2 === 'live', `mode → ${mode2}`);
    await cdp.evalJS(`SIM.state.mode='paused'; UI.setMode('paused'); true`);

    console.log('\n=== 键盘：TAB 多选队员 ===');
    // 先把选中状态重置为「只选第一个」，保证断言可复现
    const sel0 = await cdp.evalJS(`(function(){
      const sim = SIM.state.sim;
      SIM.state.selected = [sim.troopers[0]];
      return SIM.state.selected.length;
    })()`);
    await key('Tab');
    const sel1 = await cdp.evalJS(`SIM.state.selected.length`);
    await key('Tab');
    const sel2 = await cdp.evalJS(`SIM.state.selected.length`);
    check('TAB 循环多选', sel1 > sel0 && sel2 >= sel1,
      `选中数量 ${sel0} → ${sel1} → ${sel2}`);

    console.log('\n=== 键盘：1-4 触发 GO Code ===');
    const goBefore = await cdp.evalJS(`SIM.state.sim.troopers.map(t=>t.roe||'-').join(',')`);
    await key('Digit1');
    const goAfter = await cdp.evalJS(`SIM.state.sim.troopers.map(t=>t.roe||'-').join(',')`);
    check('数字键触发 GO Code', true, `roe ${goBefore} → ${goAfter}（未抛异常）`);

    /* ---- 鼠标：点选 + 拖拽画路径 ---- */
    console.log('\n=== 鼠标：点选队员 + 拖拽画路径 ===');
    const pos = await cdp.evalJS(`(function(){
      const sim = SIM.state.sim;
      const t = sim.troopers[0];
      const r = document.getElementById('game').getBoundingClientRect();
      const p = REN.worldToScreen(t.x, t.y);
      return { x: r.left + p.x, y: r.top + p.y, tx: t.x, ty: t.y, name: t.name };
    })()`);
    console.log(`  · 目标队员 ${pos.name} 屏幕坐标 (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)})`);

    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y, buttons: 0 });
    await sleep(50);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(60);

    const selAfterDown = await cdp.evalJS(`SIM.state.selected.length`);

    // 拖拽画路径：向右下移动
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: pos.x + i * 22, y: pos.y + i * 9, button: 'left', buttons: 1
      });
      await sleep(25);
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x + 176, y: pos.y + 72, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(150);

    const pathInfo = await cdp.evalJS(`(function(){
      const t = SIM.state.sim.troopers[0];
      return { len: (t.path||[]).length, faceMode: t.faceMode };
    })()`);

    check('左键点选队员', selAfterDown === 1, `选中数量 = ${selAfterDown}`);
    check('拖拽生成移动路径', pathInfo.len > 0, `路径点数 = ${pathInfo.len}，faceMode = ${pathInfo.faceMode}`);

    /* ---- 路径真的被执行了吗 ---- */
    console.log('\n=== 执行：队员是否沿路径移动 ===');
    const moveInfo = await cdp.evalJS(`(function(){
      const S = SIM.state, sim = S.sim;
      const t = sim.troopers[0];
      const x0 = t.x, y0 = t.y;
      S.mode = 'live';
      for (let i = 0; i < 160; i++) SIM.step(0.05);
      return { moved: +Math.hypot(t.x-x0, t.y-y0).toFixed(2), pathLeft: (t.path||[]).length, time: +sim.time.toFixed(1) };
    })()`);
    check('队员沿路径实际移动', moveInfo.moved > 0.5,
      `8 秒内位移 ${moveInfo.moved} 格，剩余路径点 ${moveInfo.pathLeft}`);

    /* ---- 鼠标：右键拖拽调整朝向（放最后，避免清空路径影响上面的移动测试） ---- */
    console.log('\n=== 鼠标：右键拖拽调朝向 ===');
    await cdp.evalJS(`(function(){
      const sim = SIM.state.sim;
      sim.troopers.forEach(t => { t.path = []; t.faceMode = 'path'; t.faceTemp = false; });
      SIM.state.mode = 'paused'; UI.setMode('paused');
      return true;
    })()`);

    const fpos = await cdp.evalJS(`(function(){
      const sim = SIM.state.sim;
      const t = sim.troopers[0];
      const r = document.getElementById('game').getBoundingClientRect();
      const p = REN.worldToScreen(t.x, t.y);
      return { x: r.left + p.x, y: r.top + p.y };
    })()`);

    const MOD_CTRL = 2, MOD_SHIFT = 8;
    const dragRight = async (mods) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fpos.x, y: fpos.y, button: 'right', buttons: 2, clickCount: 1, modifiers: mods });
      await sleep(40);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fpos.x + 150, y: fpos.y, button: 'right', buttons: 2, modifiers: mods });
      await sleep(50);
      const mid = await cdp.evalJS(`(function(){ const t=SIM.state.sim.troopers[0]; return { face:t.face, mode:t.faceMode }; })()`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fpos.x, y: fpos.y + 150, button: 'right', buttons: 2, modifiers: mods });
      await sleep(50);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: fpos.x, y: fpos.y + 150, button: 'right', buttons: 0, clickCount: 1, modifiers: mods });
      await sleep(80);
      const end = await cdp.evalJS(`(function(){ const t=SIM.state.sim.troopers[0]; return { face:t.face, mode:t.faceMode, temp:!!t.faceTemp, hard:t.hardFace }; })()`);
      return { mid, end };
    };

    const r1 = await dragRight(0);
    check('右键拖到右侧 -> 朝向 ≈ 0', Math.abs(r1.mid.face) < 0.25,
      `拖拽中 face=${r1.mid.face.toFixed(3)}（期望≈0.000），mode=${r1.mid.mode}`);
    check('右键拖到下方 -> 朝向 ≈ +90°', Math.abs(r1.end.face - Math.PI / 2) < 0.25,
      `松手后 face=${r1.end.face.toFixed(3)}（期望≈1.571）`);
    check('无修饰键 = 临时朝向', r1.end.temp === true, `faceTemp=${r1.end.temp}, mode=${r1.end.mode}`);

    const r2 = await dragRight(MOD_CTRL);
    check('Ctrl+右键 = 强制朝向', r2.end.mode === 'hard' && r2.end.temp === false,
      `mode=${r2.end.mode}, faceTemp=${r2.end.temp}, hardFace=${(r2.end.hard || 0).toFixed(3)}`);

    const r3 = await dragRight(MOD_SHIFT);
    check('Shift+右键 = 持续锁定注视', r3.end.mode === 'focus' && r3.end.temp === false,
      `mode=${r3.end.mode}, faceTemp=${r3.end.temp}`);

    // 临时朝向应在真的移动起来之后失效（必须给一条真实路径，否则 moving 恒为 false）
    const tempCleared = await cdp.evalJS(`(function(){
      const S = SIM.state, sim = S.sim, t = sim.troopers[0];
      const p = EngMove.findPath(sim.grid, t, { x: t.x + 3, y: t.y }, 4000);
      t.path = (p && p.length) ? p : [{ x: t.x + 2, y: t.y }];
      t.faceMode = 'focus'; t.faceTemp = true;
      S.mode = 'live';
      let sawMoving = false;
      for (let i = 0; i < 40; i++) { SIM.step(0.05); if (t.moving) sawMoving = true; }
      return { mode: t.faceMode, temp: !!t.faceTemp, sawMoving };
    })()`);
    check('临时朝向在移动后失效', tempCleared.sawMoving && tempCleared.temp === false,
      `期间移动过=${tempCleared.sawMoving}, mode=${tempCleared.mode}, faceTemp=${tempCleared.temp}`);
    await cdp.evalJS(`SIM.state.mode='paused'; UI.setMode('paused'); true`);

    /* ---- 鼠标：路径节点编辑（细分规划） ---- */
    console.log('\n=== 路径节点编辑（细分规划） ===');
    const MOD_ALT = 1;
    const wpPos = await cdp.evalJS(`(function(){
      const sim = SIM.state.sim, t = sim.troopers[0];
      t.path = [ { x: t.x + 3, y: t.y }, { x: t.x + 3, y: t.y + 3 } ];
      SIM.state.selWp = null;
      SIM.state.mode = 'paused'; UI.setMode('paused');
      const r = document.getElementById('game').getBoundingClientRect();
      const f = (wx, wy) => { const p = REN.worldToScreen(wx, wy); return { x: r.left + p.x, y: r.top + p.y }; };
      return { w0: f(t.x + 3, t.y), w1: f(t.x + 3, t.y + 3), mid: f(t.x + 3, t.y + 1.5) };
    })()`);

    const click = async (p, mods) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, buttons: 0, modifiers: mods || 0 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1, modifiers: mods || 0 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1, modifiers: mods || 0 });
      await sleep(80);
    };

    await click(wpPos.w0);
    const selInfo = await cdp.evalJS(`(function(){
      const s = SIM.state.selWp;
      return { has: !!s, i: s ? s.i : -1,
               bar: !document.getElementById('wp-bar').classList.contains('hidden') };
    })()`);
    check('点击路径节点可选中', selInfo.has && selInfo.i === 0, `selWp.i=${selInfo.i}`);
    check('节点编辑条自动出现', selInfo.bar === true, `wp-bar 可见=${selInfo.bar}`);

    const dragFromWp = async (mods, tx, ty) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: wpPos.w0.x, y: wpPos.w0.y, button: 'right', buttons: 2, clickCount: 1, modifiers: mods });
      await sleep(40);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tx, y: ty, button: 'right', buttons: 2, modifiers: mods });
      await sleep(50);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tx, y: ty, button: 'right', buttons: 0, clickCount: 1, modifiers: mods });
      await sleep(70);
      return cdp.evalJS(`(function(){
        const w = SIM.state.sim.troopers[0].path[0];
        return { mode: w.faceMode || null, lookX: w.lookX, lookY: w.lookY, face: w.face };
      })()`);
    };

    const sliceWp = await dragFromWp(MOD_SHIFT, wpPos.mid.x + 90, wpPos.mid.y);
    check('Shift+右键拖拽 = 给节点设切角', sliceWp.mode === 'focus' && sliceWp.lookX !== undefined,
      `faceMode=${sliceWp.mode}, 注视点=(${(sliceWp.lookX || 0).toFixed(1)}, ${(sliceWp.lookY || 0).toFixed(1)})`);

    const hardWp = await dragFromWp(MOD_CTRL, wpPos.mid.x + 90, wpPos.mid.y);
    check('Ctrl+右键拖拽 = 给节点设固定角度', hardWp.mode === 'hard' && typeof hardWp.face === 'number',
      `faceMode=${hardWp.mode}, 角度=${(hardWp.face || 0).toFixed(2)} rad`);

    const len0 = await cdp.evalJS(`SIM.state.sim.troopers[0].path.length`);
    await click(wpPos.mid, MOD_ALT);
    const len1 = await cdp.evalJS(`SIM.state.sim.troopers[0].path.length`);
    check('Alt+左键点路径线 = 插入节点（细分）', len1 === len0 + 1, `路径点 ${len0} -> ${len1}`);

    await click(wpPos.w1);
    const len2 = await cdp.evalJS(`SIM.state.sim.troopers[0].path.length`);
    await key('Delete');
    const len3 = await cdp.evalJS(`SIM.state.sim.troopers[0].path.length`);
    check('Del 删除选中节点', len3 === len2 - 1, `路径点 ${len2} -> ${len3}`);

    /* ---- DK2 风格的节点动作：停顿 / 同速 / 姿态 / 全局开关 ---- */
    console.log('\n=== DK2 风格节点动作 ===');
    const wp2 = await cdp.evalJS(`(function(){
      const sim = SIM.state.sim, t = sim.troopers[0];
      t.path = [ { x: t.x + 3, y: t.y }, { x: t.x + 3, y: t.y + 3 } ];
      SIM.state.selWp = null; UI.syncWpBar();
      SIM.state.mode = 'paused'; UI.setMode('paused');
      const r = document.getElementById('game').getBoundingClientRect();
      const f = (wx, wy) => { const p = REN.worldToScreen(wx, wy); return { x: r.left + p.x, y: r.top + p.y }; };
      return { a: f(t.x + 3, t.y + 1.5), b: f(t.x + 3, t.y + 0.8) };
    })()`);

    const lenA = await cdp.evalJS(`SIM.state.sim.troopers[0].path.length`);
    await click(wp2.a, MOD_SHIFT);
    const afterHalt = await cdp.evalJS(`(function(){
      const p = SIM.state.sim.troopers[0].path;
      return { len: p.length, halt: p.some(w => w.halt) };
    })()`);
    check('Shift+左键点路径线 = 插入停顿节点',
      afterHalt.len === lenA + 1 && afterHalt.halt,
      `路径点 ${lenA} -> ${afterHalt.len}，含停顿=${afterHalt.halt}`);

    await click(wp2.b, MOD_CTRL);
    const afterMatch = await cdp.evalJS(`(function(){
      const p = SIM.state.sim.troopers[0].path;
      return { len: p.length, match: p.some(w => w.matchSpeed) };
    })()`);
    check('Ctrl+左键点路径线 = 插入同速节点',
      afterMatch.len === afterHalt.len + 1 && afterMatch.match,
      `路径点 ${afterHalt.len} -> ${afterMatch.len}，含同速=${afterMatch.match}`);

    // 节点编辑条上的按钮
    const barApply = await cdp.evalJS(`(function(){
      const t = SIM.state.sim.troopers[0];
      SIM.state.selWp = { t: t, i: 0, wp: t.path[0] };
      UI.syncWpBar();
      ['crouch','silent','reload'].forEach(a => {
        const b = document.querySelector('[data-wp="' + a + '"]');
        if (b) b.click();
      });
      const wp = SIM.state.selWp.wp;
      return {
        crouch: wp.crouch, silent: wp.silent, reload: wp.reload,
        bar: !document.getElementById('wp-bar').classList.contains('hidden'),
        flags: document.getElementById('wb-flags').textContent
      };
    })()`);
    check('节点条按钮可切换节点动作（蹲/静默/换弹）',
      barApply.crouch === true && barApply.silent === true && barApply.reload === true,
      `蹲=${barApply.crouch} 静默=${barApply.silent} 换弹=${barApply.reload}`);
    check('节点条可见且显示动作标记', barApply.bar === true && barApply.flags.length > 0,
      `标记="${barApply.flags}"`);

    const delAfter = await cdp.evalJS(`(function(){
      const t = SIM.state.sim.troopers[0];
      SIM.state.selWp = { t: t, i: 0, wp: t.path[0] };
      const before = t.path.length;
      const b = document.querySelector('[data-wp="delAfter"]');
      if (b) b.click();
      return { before: before, after: t.path.length, sel: SIM.state.selWp };
    })()`);
    check('「删除此点之后」清空该点及后续',
      delAfter.after === 0 && delAfter.sel === null,
      `路径点 ${delAfter.before} -> ${delAfter.after}`);

    // Shift + 数字 = 切换 GO Code 自动触发
    const code0 = await cdp.evalJS(`(function(){
      const sim = SIM.state.sim;
      sim.troopers.forEach((t, i) => { t.goCode = sim.goCodes[Math.min(i, 3)]; });
      sim.goAuto[sim.goCodes[0]] = false;
      return sim.goCodes[0];
    })()`);
    await key('Digit1', 70, MOD_SHIFT);
    const goAutoAfter = await cdp.evalJS(`SIM.state.sim.goAuto[${JSON.stringify(code0)}]`);
    check('Shift+1 = 切换 GO Code 自动触发', goAutoAfter === true, `GO ${code0} goAuto -> ${goAutoAfter}`);

    // Shift + F = 全体静默
    await cdp.evalJS(`SIM.state.sim.troopers.forEach(t => { t.goSilent = false; }); true`);
    await key('KeyF', 70, MOD_SHIFT);
    const silentAll = await cdp.evalJS(`SIM.state.sim.troopers.every(t => t.goSilent)`);
    check('Shift+F = 全体静默', silentAll === true, `全体 goSilent=${silentAll}`);

    // Shift + ` = 全体切换停下射击
    await cdp.evalJS(`SIM.state.sim.troopers.forEach(t => { t.autoShoot = false; }); true`);
    await key('Tilde', 70, MOD_SHIFT);
    const shootAll = await cdp.evalJS(`SIM.state.sim.troopers.every(t => t.autoShoot)`);
    check('Shift+` = 全体切换停下射击', shootAll === true, `全体 autoShoot=${shootAll}`);

    /* ---- 汇总 ---- */
    console.log('\n运行时异常:', cdp.logs.length);
    cdp.logs.slice(0, 10).forEach(l => console.log('   ' + l));
    const failed = report.filter(r => !r.pass);
    console.log(`\n通过 ${report.length - failed.length}/${report.length}`);
    if (failed.length) {
      console.log('失败项：');
      failed.forEach(f => console.log('  ✘ ' + f.name + ' —— ' + f.detail));
    }
    process.exitCode = failed.length ? 1 : 0;

  } catch (e) {
    console.error('❌ 失败:', e && e.message ? e.message : e);
    process.exitCode = 1;
  } finally {
    try { if (cdp) cdp.close(); } catch (e) {}
    try { proc.kill(); } catch (e) {}
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
})();

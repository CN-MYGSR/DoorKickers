/* ============================================================
   shots.js —— 用系统 Chrome (headless) 真实渲染游戏并截图
   零 npm 依赖：Node 22 自带 fetch + WebSocket，直接走 CDP
   ------------------------------------------------------------
   产出：_shots/*.png
   同时收集运行时异常 / console.error —— 比 DOM 桩测试更硬的证据
   ============================================================ */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, '_shots');
const PORT = 9333;

const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

function findBrowser() {
  for (const p of CANDIDATES) { if (fs.existsSync(p)) return p; }
  return null;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitForPort(port, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return await r.json();
    } catch (e) { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('浏览器调试端口未就绪');
}

/* ---------------- 极简 CDP 客户端 ---------------- */
function makeCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const logs = [];

    ws.onopen = () => resolve({ send, evalJS, logs, close: () => ws.close() });
    ws.onerror = (e) => reject(new Error('WebSocket 连接失败'));

    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        if (m.error) p.reject(new Error(JSON.stringify(m.error)));
        else p.resolve(m.result);
        return;
      }
      // 收集异常与错误日志
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails || {};
        logs.push({
          kind: 'exception',
          text: (d.exception && (d.exception.description || d.exception.value)) || d.text || '未知异常'
        });
      } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        logs.push({
          kind: 'console.error',
          text: (m.params.args || []).map(a => a.value !== undefined ? a.value : (a.description || a.type)).join(' ')
        });
      }
    };

    function send(method, params) {
      return new Promise((res, rej) => {
        const mid = ++id;
        pending.set(mid, { resolve: res, reject: rej });
        ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
      });
    }

    async function evalJS(expr) {
      const r = await send('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true
      });
      if (r.exceptionDetails) {
        const d = r.exceptionDetails;
        throw new Error('页面内异常: ' + ((d.exception && d.exception.description) || d.text));
      }
      return r.result ? r.result.value : undefined;
    }
  });
}

/* ---------------- 主流程 ---------------- */
(async function main() {
  const browserPath = findBrowser();
  if (!browserPath) { console.error('未找到 Chrome / Edge'); process.exit(2); }
  console.log('浏览器:', browserPath);

  fs.mkdirSync(SHOTS, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dk2d-shot-'));

  const proc = spawn(browserPath, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--remote-allow-origins=*',
    '--window-size=1440,900',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-gpu',
    '--mute-audio',
    'about:blank'
  ], { stdio: 'ignore' });

  let cdp;
  const results = [];
  try {
    const ver = await waitForPort(PORT, 20000);
    console.log('内核:', ver.Browser);

    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find(t => t.type === 'page');
    if (!page) throw new Error('没有可用 page target');

    cdp = await makeCDP(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 900, deviceScaleFactor: 1, mobile: false
    });

    const url = pathToFileURL(path.join(ROOT, 'index.html')).href;
    console.log('加载:', url);
    await cdp.send('Page.navigate', { url });

    // 等 readyState=complete
    for (let i = 0; i < 60; i++) {
      const rs = await cdp.evalJS('document.readyState').catch(() => null);
      if (rs === 'complete') break;
      await sleep(200);
    }
    await sleep(700); // 给 MAIN.init / 首帧留时间

    // 自检：脚本是否全部就位
    const boot = await cdp.evalJS(`(function(){
      return {
        hasUI: typeof UI !== 'undefined',
        hasSIM: typeof SIM !== 'undefined',
        hasREN: typeof REN !== 'undefined',
        hasMAIN: typeof MAIN !== 'undefined',
        canvasW: (document.getElementById('game')||{}).width,
        missions: (typeof SIM !== 'undefined') ? SIM.MISSIONS.length : -1,
        screenMenuVisible: !document.getElementById('screen-menu').classList.contains('hidden')
      };
    })()`);
    console.log('启动自检:', JSON.stringify(boot));

    async function shot(name, note) {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const file = path.join(SHOTS, name);
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      const size = fs.statSync(file).size;
      results.push({ name, size, note });
      console.log(`  ✔ ${name}  (${(size / 1024).toFixed(1)} KB)  ${note}`);
    }

    /* 1. 主菜单 */
    await shot('01_menu.png', '主菜单 + 任务列表');

    /* 1b. 战术信条（技能树） */
    await cdp.evalJS(`(function(){
      // 造一点进度，让技能树上有"已解锁 / 可解锁 / 锁定"三种状态可看
      DOCTRINE.reset();
      DOCTRINE.state.xp = 2400;   // 13 级 = 12 点
      // 只花 9 点，留 3 点让界面上同时能看到"可解锁"状态
      ['ps','surg','qd','ce','mr','bar','sa','eod','fr'].forEach(id => DOCTRINE.buy(id));
      DOCTRINE.save();
      UI.openDoctrine();
      return true;
    })()`);
    await sleep(350);
    const docInfo = await cdp.evalJS(`(function(){
      return { level: DOCTRINE.level(), points: DOCTRINE.availablePoints(),
               nodes: document.querySelectorAll('.doc-node').length,
               owned: document.querySelectorAll('.doc-node.owned').length,
               buyable: document.querySelectorAll('.doc-node.buyable').length,
               locked: document.querySelectorAll('.doc-node.locked').length };
    })()`);
    console.log('  · 技能树:', JSON.stringify(docInfo));
    await shot('01b_doctrine.png', '战术信条技能树（手枪/长枪/破门 三系）');
    await cdp.evalJS(`UI.closeDoctrine()`);
    await sleep(150);

    /* 2. 帮助 */
    await cdp.evalJS(`UI.el('screen-help').classList.remove('hidden')`);
    await sleep(200);
    await shot('02_help.png', '操作与机制说明');
    await cdp.evalJS(`UI.el('screen-help').classList.add('hidden')`);

    /* 3. 简报 */
    await cdp.evalJS(`UI.openBrief(SIM.MISSIONS[0])`);
    await sleep(250);
    await shot('03_brief.png', '任务简报');

    /* 4. 编队配置 */
    await cdp.evalJS(`UI.openLoadout(SIM.MISSIONS[0])`);
    await sleep(250);
    await shot('04_loadout.png', '编队配置');

    /* 5. 开始任务 → 规划态 */
    await cdp.evalJS(`UI.startMission()`);
    await sleep(400);
    const s1 = await cdp.evalJS(`(function(){
      const sim = SIM.state.sim;
      REN.draw(sim); UI.syncHud(sim);
      return { time: +sim.time.toFixed(1), units: sim.units.length,
               players: sim.units.filter(u=>u.side==='player').length,
               hostiles: sim.units.filter(u=>u.side==='hostile').length,
               neutrals: sim.units.filter(u=>u.side==='neutral').length,
               mode: SIM.state.mode };
    })()`);
    console.log('  · 开局:', JSON.stringify(s1));
    await shot('05_planning.png', '开局规划态（视野锥 / 地图）');

    /* 5b. 细分规划：节点朝向 / 切角 / 取消点 */
    await cdp.evalJS(`(function(){
      const sim = SIM.state.sim, t = sim.troopers[0];
      const x0 = t.x, y0 = t.y;
      t.path = [
        { x: x0 - 1.5, y: y0 + 0.5, faceMode: 'hard', face: -Math.PI / 2, crouch: true, reload: true },
        { x: x0 - 3.5, y: y0 + 0.5, faceMode: 'focus', lookX: x0 - 3.5, lookY: y0 + 5, halt: true, silent: true },
        { x: x0 - 5.0, y: y0 + 2.5, cancel: true, matchSpeed: true },
        { x: x0 - 3.0, y: y0 + 4.5, faceMode: 'focus', lookX: x0 - 7, lookY: y0 + 4, sprint: true, swap: true }
      ];
      SIM.state.selWp = { t: t, i: 1, wp: t.path[1] };
      SIM.state.selected = [t];
      // 把镜头挪到路径中心，让各节点的朝向箭头都进画面
      SIM.state.cam.x = x0 - 3; SIM.state.cam.y = y0 + 2.5;
      SIM.state.zoom = 1.15;
      REN.draw(sim); UI.syncHud(sim);
      return true;
    })()`);
    await sleep(280);
    const wpInfo = await cdp.evalJS(`(function(){
      return { nodes: SIM.state.sim.troopers[0].path.length,
               bar: !document.getElementById('wp-bar').classList.contains('hidden') };
    })()`);
    console.log('  · 节点编辑:', JSON.stringify(wpInfo));
    await shot('05b_waypoints.png', '细分规划：节点朝向（蓝=固定角度，紫=切角）+ 取消点');
    await cdp.evalJS(`SIM.state.selWp = null; UI.syncWpBar(); true`);

    /* 6. 实时推进 ~12s */
    const s2 = await cdp.evalJS(`(function(){
      const S = SIM.state, sim = S.sim;
      S.mode = 'live';
      for (let i = 0; i < 240; i++) SIM.step(0.05);
      REN.draw(sim); UI.syncHud(sim);
      return { time: +sim.time.toFixed(1), alive: sim.units.filter(u=>u.alive).length,
               kills: sim.stats.kills, over: !!sim.over,
               moved: sim.units.filter(u=>u.moving).length };
    })()`);
    console.log('  · 12s 后:', JSON.stringify(s2));
    await shot('06_live.png', '实时执行 12 秒');

    /* 7. 再推进 ~28s（总 ~40s） */
    const s3 = await cdp.evalJS(`(function(){
      const sim = SIM.state.sim;
      for (let i = 0; i < 560; i++) SIM.step(0.05);
      REN.draw(sim); UI.syncHud(sim);
      return { time: +sim.time.toFixed(1), alive: sim.units.filter(u=>u.alive).length,
               kills: sim.stats.kills, deaths: sim.stats.deaths, over: !!sim.over };
    })()`);
    console.log('  · 40s 后:', JSON.stringify(s3));
    await shot('07_late.png', '实时执行 40 秒');

    /* 8. 结算界面 */
    await cdp.evalJS(`(function(){
      const sim = SIM.state.sim;
      if (!sim.over) SIM.endMission(sim, true, '全部目标达成');
      UI.showResult(sim);
      return true;
    })()`);
    await sleep(300);
    await shot('08_result.png', '任务结算（星级）');

    /* 9. 另一个任务的地图（展示程序化生成的多样性） */
    await cdp.evalJS(`(function(){
      UI.el('screen-result').classList.add('hidden');
      UI.openBrief(SIM.MISSIONS[5]);
      UI.openLoadout(SIM.MISSIONS[5]);
      UI.startMission();
      const sim = SIM.state.sim;
      for (let i = 0; i < 120; i++) SIM.step(0.05);
      REN.draw(sim); UI.syncHud(sim);
      return true;
    })()`);
    await sleep(300);
    await shot('09_mission6.png', '第 6 关地图（程序化生成）');

    /* ---- 结果汇总 ---- */
    console.log('\n运行时错误:', cdp.logs.length);
    cdp.logs.slice(0, 20).forEach(l => console.log('   [' + l.kind + '] ' + String(l.text).split('\n')[0]));

    const ok = cdp.logs.length === 0 && results.length >= 10 && boot.hasUI && boot.hasSIM;
    console.log('\n截图数:', results.length);
    console.log(ok ? '✅ 真实浏览器渲染验证通过（无运行时错误）' : '⚠️ 存在异常或截图缺失，请查看上面输出');
    process.exitCode = ok ? 0 : 1;

  } catch (err) {
    console.error('❌ 失败:', err && err.message ? err.message : err);
    process.exitCode = 1;
  } finally {
    try { if (cdp) cdp.close(); } catch (e) {}
    try { proc.kill(); } catch (e) {}
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
})();

/* ============================================================
   DK2D - 主入口 & 游戏循环
   ============================================================ */
const MAIN = {};

MAIN.init = function () {
  const canvas = UI.el('game');
  REN.resize(canvas);
  IN.init(canvas);

  window.addEventListener('resize', () => REN.resize(canvas));

  /* ---- 主菜单按钮 ---- */
  UI.el('btn-menu-help').onclick = () => UI.el('screen-help').classList.remove('hidden');
  UI.el('btn-help-close').onclick = () => UI.el('screen-help').classList.add('hidden');

  /* ---- 战术信条（技能树） ---- */
  DOCTRINE.load();
  UI.el('btn-menu-doctrine').onclick = () => UI.openDoctrine();
  UI.el('btn-doc-close').onclick = () => UI.closeDoctrine();
  UI.el('btn-doc-reset').onclick = () => UI.resetDoctrine();

  /* ---- 路径节点编辑条 ---- */
  document.querySelectorAll('[data-wp]').forEach(el => {
    el.onclick = () => UI.wpAction(el.dataset.wp);
  });

  UI.el('btn-brief-back').onclick = () => { UI.toMenu(); UI.renderMissionList(); };
  UI.el('btn-brief-next').onclick = () => UI.openLoadout(SIM.state.pendingMission);
  UI.el('btn-loadout-back').onclick = () => UI.openBrief(SIM.state.pendingMission);
  UI.el('btn-loadout-go').onclick = () => UI.startMission();

  UI.el('btn-result-retry').onclick = () => {
    UI.el('screen-result').classList.add('hidden');
    UI.startMission();
  };
  UI.el('btn-result-next').onclick = () => {
    UI.el('screen-result').classList.add('hidden');
    // 下一个任务
    const cur = SIM.state.pendingMission;
    const idx = SIM.MISSIONS.findIndex(m => m.id === cur.id);
    if (idx >= 0 && idx < SIM.MISSIONS.length - 1) {
      UI.openBrief(SIM.MISSIONS[idx + 1]);
    } else { UI.toMenu(); UI.renderMissionList(); }
  };
  UI.el('btn-result-menu').onclick = () => { UI.toMenu(); UI.renderMissionList(); };

  /* ---- HUD 按钮 ---- */
  UI.el('btn-play').onclick = () => UI.togglePlay();
  UI.el('btn-stop').onclick = () => {
    const sim = SIM.state.sim; if (!sim) return;
    SIM.state.selected.forEach(t => SIM.stopTrooper(t));
    UI.syncHud(sim);
  };
  UI.el('btn-grenade').onclick = () => {
    const sim = SIM.state.sim; if (!sim) return;
    SIM.state.tool = 'grenade';
    UI.toast(sim, '右键点击投掷位置', '#ffd479');
  };
  UI.el('btn-abort').onclick = () => {
    const sim = SIM.state.sim; if (!sim || sim.over) return;
    SIM.endMission(sim, false, '主动中止');
  };
  UI.el('btn-help').onclick = () => UI.el('screen-help').classList.toggle('hidden');
  UI.el('btn-roster').onclick = () => UI.el('trooper-panel').classList.toggle('collapsed');

  // 投掷物选择
  document.querySelectorAll('[data-gtype]').forEach(el => {
    el.onclick = () => {
      const sim = SIM.state.sim; if (!sim) return;
      const t = SIM.state.selected[0]; if (!t) return;
      const type = el.dataset.gtype;
      if (!t.gadgets.includes(type)) { UI.toast(sim, '该队员未装备此投掷物', '#ff8a8a'); return; }
      SIM.state.pendingGrenade = type;
      SIM.state.tool = 'grenade';
      document.querySelectorAll('[data-gtype]').forEach(e2 => e2.classList.remove('active'));
      el.classList.add('active');
      UI.toast(sim, '右键点击投掷位置', '#ffd479');
    };
  });

  /* ---- 启动 ---- */
  UI.toMenu();
  UI.renderMissionList();
  requestAnimationFrame(MAIN.loop);
};

MAIN.loop = function (ts) {
  const now = ts / 1000;
  const last = MAIN.last || now;
  let dt = Math.min(0.05, now - last);
  MAIN.last = now;

  const S = SIM.state;
  const sim = S.sim;

  if (sim && !sim.over) {
    if (S.mode === 'live') {
      const steps = S.speed > 2 ? 3 : 1;
      for (let i = 0; i < steps; i++) SIM.step(dt * Math.min(S.speed, 3) / steps);
    }
  }

  // 渲染
  if (sim) {
    REN.draw(sim);
    UI.syncHud(sim);
    if (sim.over && S.mode !== 'result') S.mode = 'result';
    if (sim.over && UI.el('screen-result').classList.contains('hidden')) {
      UI.showResult(sim);
    }
  } else {
    REN.ctx && (REN.ctx.fillStyle = '#12161c', REN.ctx.fillRect(0, 0, REN.cw, REN.ch));
  }

  requestAnimationFrame(MAIN.loop);
};

/* ---------- 播放控制 ---------- */
UI.togglePlay = function () {
  const S = SIM.state;
  if (!S.sim || S.sim.over) return;
  if (S.mode === 'live') {
    S.mode = 'paused';
    UI.setMode('paused');
  } else {
    S.mode = 'live';
    UI.setMode('live');
  }
};

/* ---------- Esc：取消/关闭优先，其次暂停切换 ---------- */
UI.togglePauseMenu = function () {
  const S = SIM.state;

  // 1) 帮助面板开着 → 先关它
  const help = UI.el('screen-help');
  if (help && !help.classList.contains('hidden')) { help.classList.add('hidden'); return; }

  if (!S.sim) return;

  // 2) 正在用某个工具（投掷/破墙）→ 取消工具
  if (S.tool) { S.tool = null; UI.toast(S.sim, '已取消', '#9fb0c0'); return; }

  // 3) 暂停 / 继续（planning 本身就是暂停态，按了无操作）
  if (S.mode === 'live') { S.mode = 'paused'; UI.setMode('paused'); }
  else if (S.mode === 'paused') { S.mode = 'live'; UI.setMode('live'); }
};

/* ---------- 投掷 ---------- */
UI.throwGrenade = function (sim, t, w) {
  const type = SIM.state.pendingGrenade || 'frag';
  if (!t.gadgets.includes(type)) { UI.toast(sim, '未装备该投掷物', '#ff8a8a'); return; }
  ENG.doGrenade(sim, t, { type, tx: w.x, ty: w.y });
  SIM.state.pendingGrenade = null;
  document.querySelectorAll('[data-gtype]').forEach(e => e.classList.remove('active'));
  UI.toast(sim, '已投掷', '#ffd479');
};

/* ---------- 爆破墙 ---------- */
UI.placeCharge = function (sim, t, w) {
  const gx = Math.floor(w.x), gy = Math.floor(w.y);
  if (MAPGEN.at(sim.grid, gx, gy) !== MAPGEN.T.BRWALL) {
    UI.toast(sim, '只能对灰色裂纹墙使用（需先侦察到）', '#ff8a8a');
    return;
  }
  if (!t.breachTools.includes('charge')) { UI.toast(sim, '该队员未携带破门炸药', '#ff8a8a'); return; }
  t.path = t.path || [];
  t.path.push({ x: gx + .5, y: gy + .5, breach: true, method: 'wallcharge', wx: gx, wy: gy });
  UI.toast(sim, '已规划破墙', '#ffb84a');
};

window.MAIN = MAIN;
document.addEventListener('DOMContentLoaded', MAIN.init);

/* ============================================================
   DK2D - 界面 & 输入
   ============================================================ */
const UI = {};
const IN = {};

UI.el = (id) => document.getElementById(id);

/* ---------- 屏幕切换 ---------- */
UI.show = function (which) {
  ['menu', 'brief', 'loadout', 'result', 'help', 'doctrine'].forEach(k => {
    const e = UI.el('screen-' + k);
    if (e) e.classList.toggle('hidden', k !== which);
  });
  UI.el('hud').classList.toggle('hidden', which !== null);
};

UI.toMenu = function () {
  UI.el('screen-menu').classList.remove('hidden');
  UI.el('screen-brief').classList.add('hidden');
  UI.el('screen-loadout').classList.add('hidden');
  UI.el('screen-result').classList.add('hidden');
  UI.el('screen-help').classList.add('hidden');
  UI.el('screen-doctrine').classList.add('hidden');
  UI.el('hud').classList.add('hidden');
  SIM.state.mode = 'menu';
};

/* ---------- 任务列表 ---------- */
UI.renderMissionList = function () {
  const wrap = UI.el('mission-list');
  wrap.innerHTML = '';
  const cats = {};
  SIM.MISSIONS.forEach(m => { (cats[m.cat] = cats[m.cat] || []).push(m); });

  Object.keys(cats).forEach(cat => {
    const h = document.createElement('div');
    h.className = 'cat-title';
    h.textContent = cat;
    wrap.appendChild(h);
    cats[cat].forEach(m => {
      const d = document.createElement('button');
      d.className = 'mission-card';
      const rec = UI.progress()[m.id];
      d.innerHTML = `
        <div class="mc-top">
          <span class="mc-name">${m.name}</span>
          <span class="mc-type">${DATA.MISSION_TYPES[m.type].icon} ${DATA.MISSION_TYPES[m.type].name}</span>
        </div>
        <div class="mc-sub">${m.squadSize} 人 · ${m.enemies} 敌人 · ${SIM.DIFF_LABEL[m.diff]} · 达标 ${m.timeBeat}s</div>
        <div class="mc-stars">${rec ? UI.stars(rec.stars) : '<span class="dim">未通关</span>'}</div>
      `;
      d.onclick = () => UI.openBrief(m);
      wrap.appendChild(d);
    });
  });
};

UI.stars = function (n) {
  return `<span class="st">${'★'.repeat(n)}</span><span class="st-dim">${'☆'.repeat(3 - n)}</span>`;
};

UI.progress = function () {
  try { return JSON.parse(localStorage.getItem('dk2d_progress') || '{}'); }
  catch (e) { return {}; }
};
UI.saveProgress = function (id, stars) {
  const p = UI.progress();
  if (!p[id] || p[id].stars < stars) p[id] = { stars };
  try { localStorage.setItem('dk2d_progress', JSON.stringify(p)); } catch (e) {}
};

/* ---------- 路径节点编辑条 ---------- */
UI.syncWpBar = function () {
  const bar = UI.el('wp-bar');
  if (!bar) return;
  const sel = SIM.state.selWp;
  if (!sel || !sel.t || !sel.t.path) { bar.classList.add('hidden'); return; }
  // 路径推进会让下标失效：按对象引用重新定位
  if (sel.t.path[sel.i] !== sel.wp) {
    const idx = sel.t.path.indexOf(sel.wp);
    if (idx < 0) { SIM.state.selWp = null; bar.classList.add('hidden'); return; }
    sel.i = idx;
  }
  const wp = sel.wp;

  bar.classList.remove('hidden');
  UI.el('wb-index').textContent = '#' + (sel.i + 1);

  const m = UI.el('wb-mode');
  if (wp.cancel) {
    m.textContent = '取消点';
    m.className = 'wb-mode cancel';
  } else if (wp.faceMode === FACE.HARD) {
    const deg = Math.round(((wp.face || 0) * 180 / Math.PI + 360) % 360);
    m.textContent = '固定角度 ' + deg + '°';
    m.className = 'wb-mode hard';
  } else if (wp.faceMode === FACE.FOCUS) {
    m.textContent = '切角 · 注视某点';
    m.className = 'wb-mode focus';
  } else {
    m.textContent = '无朝向设置';
    m.className = 'wb-mode';
  }

  // 动作标记汇总
  const flags = [];
  if (wp.halt) flags.push('停顿');
  if (wp.matchSpeed) flags.push('同速');
  if (wp.crouch === true) flags.push('蹲');
  if (wp.crouch === false) flags.push('站');
  if (wp.sprint === true) flags.push('跑');
  if (wp.sprint === false) flags.push('走');
  if (wp.reload) flags.push('换弹');
  if (wp.swap) flags.push('换枪');
  if (wp.silent === true) flags.push('静默');
  if (wp.silent === false) flags.push('解除静默');
  if (wp.autoShoot === true) flags.push('停下射击');
  if (wp.autoShoot === false) flags.push('不停下');
  UI.el('wb-flags').textContent = flags.length ? '· ' + flags.join(' · ') : '';

  // 按钮激活态
  bar.querySelectorAll('[data-wp]').forEach(b => {
    const a = b.dataset.wp;
    let on = false;
    if (a === 'halt') on = !!wp.halt;
    else if (a === 'matchSpeed') on = !!wp.matchSpeed;
    else if (a === 'crouch') on = wp.crouch === true;
    else if (a === 'sprint') on = wp.sprint === true;
    else if (a === 'reload') on = !!wp.reload;
    else if (a === 'swap') on = !!wp.swap;
    else if (a === 'silent') on = wp.silent === true;
    else if (a === 'autoShoot') on = wp.autoShoot === false;   // 高亮表示「不停下」
    else if (a === 'cancel') on = !!wp.cancel;
    else if (a === 'hard') on = wp.faceMode === FACE.HARD;
    else if (a === 'focus') on = wp.faceMode === FACE.FOCUS;
    b.classList.toggle('active', on);
  });
};

/* 节点编辑条上的按钮动作 */
UI.wpAction = function (act) {
  const sel = SIM.state.selWp;
  const sim = SIM.state.sim;
  if (!sel || !sel.t || !sel.t.path) return;
  const wp = sel.t.path[sel.i];
  if (!wp) return;

  if (act === 'del') {
    sel.t.path.splice(sel.i, 1);
    SIM.state.selWp = null;
  } else if (act === 'delAfter') {
    // 对齐 DK2 的 "Delete path from that point onwards"
    sel.t.path.splice(sel.i);
    SIM.state.selWp = null;
  } else if (act === 'clear') {
    delete wp.faceMode; delete wp.lookX; delete wp.lookY; delete wp.face;
    delete wp.crouch; delete wp.sprint; delete wp.silent; delete wp.autoShoot;
    wp.cancel = false; wp.halt = false; wp.matchSpeed = false;
    wp.reload = false; wp.swap = false;
  } else if (act === 'cancel') {
    wp.cancel = !wp.cancel;
    if (wp.cancel) { delete wp.faceMode; delete wp.lookX; delete wp.lookY; delete wp.face; }
  } else if (act === 'halt') {
    wp.halt = !wp.halt;
  } else if (act === 'matchSpeed') {
    wp.matchSpeed = !wp.matchSpeed;
  } else if (act === 'reload') {
    wp.reload = !wp.reload;
  } else if (act === 'swap') {
    wp.swap = !wp.swap;
  } else if (act === 'crouch' || act === 'sprint' || act === 'silent' || act === 'autoShoot') {
    // 三态循环：未设置 -> 开 -> 关 -> 未设置
    wp[act] = (wp[act] === undefined) ? true : (wp[act] ? false : undefined);
  } else if (act === 'hard' || act === 'focus') {
    wp.cancel = false;
    // 默认方向：朝下一个节点；没有下一个就顺着行进方向往前
    const nxt = sel.t.path[sel.i + 1];
    const prev = sel.i > 0 ? sel.t.path[sel.i - 1] : { x: sel.t.x, y: sel.t.y };
    let dx, dy;
    if (nxt) { dx = nxt.x - wp.x; dy = nxt.y - wp.y; }
    else { dx = wp.x - prev.x; dy = wp.y - prev.y; }
    if (Math.hypot(dx, dy) < 1e-3) { dx = 1; dy = 0; }
    if (act === 'hard') {
      wp.faceMode = FACE.HARD;
      wp.face = Math.atan2(dy, dx);
      delete wp.lookX; delete wp.lookY;
    } else {
      wp.faceMode = FACE.FOCUS;
      wp.lookX = wp.x + dx * 3;
      wp.lookY = wp.y + dy * 3;
      delete wp.face;
    }
  }

  UI.syncWpBar();
  if (sim) UI.syncHud(sim);
};

/* ---------- 战术信条（技能树） ---------- */
UI.openDoctrine = function () {
  UI.el('screen-menu').classList.add('hidden');
  UI.el('screen-doctrine').classList.remove('hidden');
  UI.docHint('信条对全队所有队员生效，按武器类别分三棵树。每升 1 级得 1 点，重置不消耗点数。');
  UI.renderDoctrine();
};

UI.closeDoctrine = function () {
  UI.el('screen-doctrine').classList.add('hidden');
  UI.el('screen-menu').classList.remove('hidden');
  UI.renderMissionList();
};

UI.docHint = function (msg, color) {
  const h = UI.el('doc-hint');
  if (!h) return;
  h.innerHTML = msg;
  h.style.color = color || '';
};

UI.resetDoctrine = function () {
  DOCTRINE.refundAll();
  UI.docHint('已重置全部加点，点数已退回。', '#ffd479');
  UI.renderDoctrine();
};

UI.renderDoctrine = function () {
  const lv = DOCTRINE.level();
  const maxed = DOCTRINE.isMaxLevel();

  UI.el('doc-level').textContent = lv;
  UI.el('doc-points').textContent = DOCTRINE.availablePoints();

  const cur = DOCTRINE.state.xp - DOCTRINE.xpAtLevel(lv);
  const need = maxed ? 0 : DOCTRINE.XP_PER_LEVEL;
  UI.el('doc-xpfill').style.width = (maxed ? 100 : Math.min(100, Math.round(cur / need * 100))) + '%';
  UI.el('doc-xptext').textContent = maxed
    ? ('已满级 · 总经验 ' + DOCTRINE.state.xp)
    : (cur + ' / ' + need + ' XP　（总 ' + DOCTRINE.state.xp + '）');

  const wrap = UI.el('doc-trees');
  wrap.innerHTML = '';

  ['pistol', 'longgun', 'breach'].forEach(treeId => {
    const tree = DOCTRINE.TREES[treeId];
    const nodes = DOCTRINE.NODES.filter(n => n.tree === treeId).sort((a, b) => a.tier - b.tier);
    const maxTier = nodes.reduce((m, n) => Math.max(m, n.tier), 1);

    const col = document.createElement('div');
    col.className = 'doc-tree';

    let html = `<div class="doc-tree-head" style="--tc:${tree.color}">
        <span class="dt-name">${tree.name}</span>
        <span class="dt-pts">已投入 ${DOCTRINE.pointsInTree(treeId)} 点</span>
      </div>
      <div class="doc-tree-desc">${tree.desc}</div>`;

    for (let tier = 1; tier <= maxTier; tier++) {
      const tn = nodes.filter(n => n.tier === tier);
      if (!tn.length) continue;
      html += '<div class="doc-tier">';
      tn.forEach(n => {
        const owned = DOCTRINE.owned(n.id);
        const can = DOCTRINE.canBuy(n.id);
        const state = owned ? 'owned' : (can.ok ? 'buyable' : 'locked');
        const badge = owned ? '已解锁' : (can.ok ? '点击解锁' : can.reason);
        html += `<button class="doc-node ${state}" data-node="${n.id}" style="--tc:${tree.color}">
            <span class="dn-name">${n.name}</span>
            <span class="dn-desc">${n.desc}</span>
            <span class="dn-badge">${badge}</span>
          </button>`;
      });
      html += '</div>';
    }

    col.innerHTML = html;
    wrap.appendChild(col);
  });

  wrap.querySelectorAll('.doc-node').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.node;
      const n = DOCTRINE.BY_ID[id];
      const r = DOCTRINE.buy(id);
      if (!r.ok) UI.docHint('无法解锁「' + (n ? n.name : id) + '」：' + r.reason, '#ff8a8a');
      else UI.docHint('已解锁「' + n.name + '」—— ' + n.desc, '#8fe08f');
      UI.renderDoctrine();
    };
  });
};

/* ---------- 简报 ---------- */
UI.openBrief = function (m) {
  UI.el('screen-menu').classList.add('hidden');
  UI.el('screen-brief').classList.remove('hidden');
  SIM.state.pendingMission = m;
  const ty = DATA.MISSION_TYPES[m.type];
  UI.el('brief-title').textContent = m.name;
  UI.el('brief-cat').textContent = m.cat;
  UI.el('brief-body').innerHTML = `
    <div class="brief-grid">
      <div class="bg-item"><span>任务类型</span><b>${ty.icon} ${ty.name}</b></div>
      <div class="bg-item"><span>主要目标</span><b>${ty.goal}</b></div>
      <div class="bg-item"><span>投入兵力</span><b>${m.squadSize} 人</b></div>
      <div class="bg-item"><span>情报：敌军</span><b>${m.enemies} 名左右</b></div>
      <div class="bg-item"><span>难度</span><b class="d-${m.diff}">${SIM.DIFF_LABEL[m.diff]}</b></div>
      <div class="bg-item"><span>三星达标</span><b>${m.timeBeat} 秒</b></div>
    </div>
    <p class="brief-desc">${m.desc}</p>
  `;
  UI.el('brief-enemies').innerHTML = (m.enemyMix || []).map(k => {
    const e = DATA.ENEMIES[k];
    if (!e) return '';
    return `<div class="enemy-chip" style="border-color:${e.color}">
      <b>${e.name}</b>
      <span>视野 ${e.fov}° · 视距 ${e.sight}m · 反应 ${e.react}ms</span>
      <span>${e.weapon ? DATA.WEAPONS[e.weapon].name : '自杀背心'} · 护甲 ${DATA.ARMOR[e.armor].name}</span>
    </div>`;
  }).join('');
};

/* ---------- 装备配置 ---------- */
UI.DEFAULT_SQUADS = {
  A: [
    { name: 'Pointman', cls: 'assault',   primary: 'M4',     secondary: 'G17', armor: 'plate3', nvg: true,  gadgets: ['frag', 'flash'], breachTools: ['hand','kick','shotgun'], goCode: 'A' },
    { name: 'Rifleman', cls: 'assault',   primary: 'HK416',  secondary: 'G17', armor: 'plate3', nvg: true,  gadgets: ['frag', 'flash'], breachTools: ['hand','kick'],          goCode: 'A' }
  ],
  B: [
    { name: 'Pointman', cls: 'assault',   primary: 'M4',     secondary: 'G17', armor: 'plate3', nvg: true,  gadgets: ['frag', 'flash'], breachTools: ['hand','kick','shotgun'], goCode: 'A' },
    { name: 'Rifleman', cls: 'assault',   primary: 'HK416',  secondary: 'G17', armor: 'plate3', nvg: true,  gadgets: ['frag', 'flash'], breachTools: ['hand','kick'],          goCode: 'A' },
    { name: 'Support',  cls: 'support',   primary: 'M249',   secondary: 'G17', armor: 'extprot',nvg: true, gadgets: ['smoke'],         breachTools: ['hand','kick'],          goCode: 'B' }
  ],
  C: [
    { name: 'Pointman', cls: 'assault',   primary: 'M4',     secondary: 'G17', armor: 'plate3', nvg: true,  gadgets: ['frag', 'flash'], breachTools: ['hand','kick','shotgun'], goCode: 'A' },
    { name: 'Rifleman', cls: 'assault',   primary: 'HK416',  secondary: 'G17', armor: 'plate3', nvg: true,  gadgets: ['frag', 'flash'], breachTools: ['hand','kick'],          goCode: 'A' },
    { name: 'Support',  cls: 'support',   primary: 'M249',   secondary: 'G17', armor: 'extprot',nvg: true, gadgets: ['smoke'],         breachTools: ['hand','kick'],          goCode: 'B' },
    { name: 'Marksman', cls: 'marksman',  primary: 'MK17LB', secondary: 'G17', armor: 'plate3', nvg: true,  gadgets: ['smoke'],         breachTools: ['hand','kick'],          goCode: 'B' }
  ]
};

UI.squad = null;

UI.openLoadout = function (m) {
  const base = m.squadSize <= 2 ? 'A' : (m.squadSize === 3 ? 'B' : 'C');
  UI.squad = JSON.parse(JSON.stringify(UI.DEFAULT_SQUADS[base]));
  UI.el('screen-brief').classList.add('hidden');
  UI.el('screen-loadout').classList.remove('hidden');
  UI.el('loadout-title').textContent = m.name + ' · 编队';
  UI.renderLoadout();
};

UI.renderLoadout = function () {
  const wrap = UI.el('loadout-list');
  wrap.innerHTML = '';
  UI.squad.forEach((op, i) => {
    const card = document.createElement('div');
    card.className = 'op-card';
    const w = DATA.WEAPONS[op.primary];
    const arm = DATA.ARMOR[op.armor];
    const avail = DATA.CLASSES[op.cls].primary;
    const arms = ['none','soft','plate3a','plate3','extprot','plate4'];
    card.innerHTML = `
      <div class="op-head">
        <input class="op-name" value="${op.name}" data-i="${i}" data-k="name">
        <select data-i="${i}" data-k="cls">
          ${Object.keys(DATA.CLASSES).map(c => `<option value="${c}" ${c === op.cls ? 'selected' : ''}>${DATA.CLASSES[c].name}</option>`).join('')}
        </select>
        <select data-i="${i}" data-k="goCode">
          ${['A','B','C','D'].map(c => `<option ${c === op.goCode ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="op-row">
        <label>主武器</label>
        <select data-i="${i}" data-k="primary">
          ${avail.map(k => `<option value="${k}" ${k === op.primary ? 'selected' : ''}>${DATA.WEAPONS[k].name} · 穿甲${DATA.WEAPONS[k].pen} · 伤害${DATA.WEAPONS[k].dmg}</option>`).join('')}
        </select>
      </div>
      <div class="op-row">
        <label>护甲</label>
        <select data-i="${i}" data-k="armor">
          ${arms.map(a => `<option value="${a}" ${a === op.armor ? 'selected' : ''}>${DATA.ARMOR[a].name} · 等级${DATA.ARMOR[a].level}</option>`).join('')}
        </select>
      </div>
      <div class="op-row">
        <label>破门工具</label>
        <div class="chips">
          ${['hand','kick','crowbar','bolt','shotgun','charge'].map(t => `
            <span class="chip ${op.breachTools.includes(t) ? 'on' : ''}" data-bt="${t}" data-i="${i}">${DATA.BREACH[t].name}</span>
          `).join('')}
        </div>
      </div>
      <div class="op-row">
        <label>投掷物</label>
        <div class="chips">
          ${['frag','flash','smoke'].map(t => `
            <span class="chip ${op.gadgets.includes(t) ? 'on' : ''}" data-gd="${t}" data-i="${i}">${{frag:'破片手雷',flash:'闪光弹',smoke:'烟雾弹'}[t]}</span>
          `).join('')}
        </div>
      </div>
      <div class="op-row">
        <label>夜视仪</label>
        <span class="chip ${op.nvg ? 'on' : ''}" data-nvg="${i}">夜视仪 ${op.nvg ? '已装备' : '无'}</span>
      </div>
      <div class="op-stats">
        ${w ? `射程${w.range}m · 精度${w.start}→${w.end}% · 暴击${w.crit}% · 瞄准${w.aim[0]}-${w.aim[1]}ms · 噪音${w.sound}m` : ''}
      </div>
    `;
    wrap.appendChild(card);
  });

  // 事件
  wrap.querySelectorAll('select,input').forEach(el => {
    el.onchange = () => {
      const i = +el.dataset.i, k = el.dataset.k;
      UI.squad[i][k] = el.value;
      if (k === 'cls') {
        const c = DATA.CLASSES[el.value];
        UI.squad[i].primary = c.primary[0];
        UI.squad[i].secondary = c.secondary[0];
      }
      UI.renderLoadout();
    };
  });
  wrap.querySelectorAll('.chip[data-bt]').forEach(el => {
    el.onclick = () => {
      const i = +el.dataset.i, t = el.dataset.bt;
      const arr = UI.squad[i].breachTools;
      const idx = arr.indexOf(t);
      if (idx >= 0) arr.splice(idx, 1); else if (arr.length < 3) arr.push(t);
      UI.renderLoadout();
    };
  });
  wrap.querySelectorAll('.chip[data-gd]').forEach(el => {
    el.onclick = () => {
      const i = +el.dataset.i, t = el.dataset.gd;
      const arr = UI.squad[i].gadgets;
      const idx = arr.indexOf(t);
      if (idx >= 0) arr.splice(idx, 1); else if (arr.length < 3) arr.push(t);
      UI.renderLoadout();
    };
  });
  wrap.querySelectorAll('.chip[data-nvg]').forEach(el => {
    el.onclick = () => {
      const i = +el.dataset.nvg;
      UI.squad[i].nvg = !UI.squad[i].nvg;
      UI.renderLoadout();
    };
  });
};

/* ---------- 开始任务 ---------- */
UI.startMission = function () {
  const m = SIM.state.pendingMission;
  UI.el('screen-loadout').classList.add('hidden');
  UI.el('screen-brief').classList.add('hidden');
  UI.el('hud').classList.remove('hidden');
  const sim = SIM.startMission(m, UI.squad);
  REN.resize(UI.el('game'));
  UI.syncHud(sim);
  UI.setMode('planning');
  UI.toast(sim, '规划阶段：拖拽队员画路径，空格开始执行');
};

/* ---------- HUD ---------- */
UI.setMode = function (mode) {
  SIM.state.mode = mode;
  const badge = UI.el('mode-badge');
  badge.className = 'mode-badge ' + mode;
  badge.textContent = { planning: '规划中 · 已暂停', live: '实时执行', paused: '已暂停', result: '任务结束' }[mode] || mode;
  UI.el('btn-play').textContent = (mode === 'live') ? '❚❚ 暂停' : '▶ 执行';
};

UI.syncHud = function (sim) {
  if (!sim) return;
  UI.el('hud-time').textContent = UI.fmtTime(sim.time);
  UI.el('hud-enemies').textContent = sim.obj.enemiesLeft;
  UI.el('hud-total').textContent = sim.obj.enemiesTotal;
  UI.el('hud-kills').textContent = sim.stats.kills;
  UI.el('hud-arrest').textContent = sim.stats.arrested;
  UI.el('hud-deaths').textContent = sim.stats.deaths;
  const beat = sim.mission.timeBeat;
  UI.el('hud-time').className = sim.time <= beat ? 'good' : (sim.time <= beat * 1.25 ? 'warn' : 'bad');

  // 目标进度
  const objs = [];
  if (sim.mission.type === 'hostage' || sim.mission.type === 'execute') {
    const hs = sim.units.filter(u => u.role === 'hostage');
    const saved = hs.filter(h => h.escaped).length;
    objs.push(`人质撤离 ${saved}/${hs.length}`);
  }
  if (sim.mission.type === 'bomb') objs.push(sim.bomb.defused ? '✔ 炸弹已拆' : `炸弹倒计时 ${UI.fmtTime(Math.max(0, sim.bomb.timer))}`);
  if (sim.mission.type === 'hvt') objs.push(sim.hvt && sim.hvt.arrested ? '✔ 目标已逮捕' : '□ 逮捕高价值目标');
  if (sim.mission.type === 'vip') objs.push(sim.vip && sim.vip.escaped ? '✔ 要员撤离' : '□ 护送要员至撤离点');
  if (sim.execTimerOn && sim.execLeft > 0) objs.push(`⚠ 处决倒计时 ${Math.ceil(sim.execLeft)}s`);
  UI.el('hud-objectives').innerHTML = objs.map(o => `<div>${o}</div>`).join('');

  // 队员列表
  const list = UI.el('trooper-list');
  list.innerHTML = '';
  sim.troopers.forEach((t, i) => {
    const col = REN.COL.pathCols[i % REN.COL.pathCols.length];
    const d = document.createElement('div');
    d.className = 'tp' + (t.alive ? '' : ' dead') + (SIM.state.selected.includes(t) ? ' sel' : '');
    const w = DATA.WEAPONS[t.weapon];
    d.innerHTML = `
      <span class="tp-dot" style="background:${col}"></span>
      <span class="tp-name">${t.name}</span>
      <span class="tp-go">GO ${t.goCode}${(sim.goAuto && sim.goAuto[t.goCode]) ? ' ⚑' : ''}</span>
      <span class="tp-hp">${t.alive ? Math.round(t.hp) : '阵亡'}</span>
      <span class="tp-ammo">${t.reloading ? '换弹' : t.ammo + '发'}</span>
      <span class="tp-st">${t.crouch ? '蹲' : ''}${t.sprint ? '跑' : ''}${t.roe === 'hold' ? '禁火' : ''}</span>
    `;
    d.onclick = (e) => {
      if (e.shiftKey) {
        if (!SIM.state.selected.includes(t)) SIM.state.selected.push(t);
      } else SIM.state.selected = [t];
      UI.syncHud(sim);
    };
    list.appendChild(d);
  });

  UI.el('sel-info').textContent = SIM.state.selected.length
    ? SIM.state.selected.map(t => t.name).join(' + ')
    : '未选中';

  UI.syncWpBar();
};

UI.fmtTime = function (s) {
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
};

UI.toast = function (sim, text, col) {
  sim.fx.push({ type: 'text', x: SIM.state.selected[0] ? SIM.state.selected[0].x : sim.grid.w / 2, y: SIM.state.selected[0] ? SIM.state.selected[0].y - 2 : sim.grid.h / 2, text, color: col || '#cfe4f0', t: 2.6 });
};

/* ---------- 结算 ---------- */
UI.showResult = function (sim) {
  UI.el('hud').classList.add('hidden');
  UI.el('screen-result').classList.remove('hidden');
  const s = sim.stars;
  UI.el('res-title').textContent = sim.win ? '任务成功' : '任务失败';
  UI.el('res-title').className = sim.win ? 'res-win' : 'res-lose';
  UI.el('res-reason').textContent = sim.win ? (sim.endReason || '目标达成') : (sim.failReason || sim.endReason || '任务中止');
  UI.el('res-stars').innerHTML = `<span class="big-st">${'★'.repeat(s)}</span>${'☆'.repeat(3 - s)}`;

  const hs = sim.units.filter(u => u.role === 'hostage' || u.role === 'vip');
  UI.el('res-stats').innerHTML = `
    <div><span>用时</span><b class="${sim.time <= sim.mission.timeBeat ? 'good' : 'warn'}">${UI.fmtTime(sim.time)}</b></div>
    <div><span>三星达标</span><b>${UI.fmtTime(sim.mission.timeBeat)}</b></div>
    <div><span>击毙敌人</span><b>${sim.stats.kills}</b></div>
    <div><span>逮捕</span><b>${sim.stats.arrested}</b></div>
    <div><span>队员伤亡</span><b class="${sim.stats.deaths ? 'bad' : 'good'}">${sim.stats.deaths}</b></div>
    <div><span>平民伤亡</span><b class="${sim.stats.civDeaths ? 'bad' : 'good'}">${sim.stats.civDeaths}</b></div>
    <div><span>踹门/开门</span><b>${sim.stats.doorsKicked} / ${sim.stats.doorsOpened}</b></div>
    <div><span>强制破门</span><b>${sim.stats.doorsForced}</b></div>
    <div><span>破墙</span><b>${sim.stats.wallsBreached}</b></div>
    <div><span>投掷物</span><b>${sim.stats.grenades}</b></div>
    <div><span>开火/命中</span><b>${sim.stats.shotsFired} / ${sim.stats.shotsHit} (${sim.stats.shotsFired ? Math.round(sim.stats.shotsHit / sim.stats.shotsFired * 100) : 0}%)</b></div>
    <div><span>受伤队员</span><b>${sim.troopers.filter(t => t.hp < t.maxHp).length}</b></div>
  `;
  if (sim.win) UI.saveProgress(sim.mission.id, s);

  // 战术信条：本次获得的经验与升级情况
  const xpEl = UI.el('res-xp');
  if (xpEl) {
    if (sim.xpGain !== undefined) {
      const up = sim.xpLevelAfter > sim.xpLevelBefore;
      const lvTxt = up
        ? ` <span class="lvup">小队升级 → ${sim.xpLevelAfter} 级` +
          (sim.xpPointsGained ? `，获得 ${sim.xpPointsGained} 点信条点` : '') + '</span>'
        : `　小队等级 ${sim.xpLevelAfter}`;
      xpEl.innerHTML = `获得经验 <b>+${sim.xpGain}</b> XP` +
        (sim.xpRepeat ? '（重复通关按 30% 计）' : '') + lvTxt;
    } else {
      xpEl.innerHTML = '';
    }
  }

  // 失败/掉星原因
  const notes = [];
  if (sim.stats.deaths > 0) notes.push(`队员阵亡 ${sim.stats.deaths} 人：损失 1-2 星`);
  if (sim.stats.civDeaths > 0) notes.push(`平民死亡 ${sim.stats.civDeaths} 人：损失 1 星`);
  if (sim.time > sim.mission.timeBeat) notes.push(`超出达标时间：损失 1-2 星`);
  if (!notes.length && sim.win) notes.push('完美执行：无伤亡、无附带损伤、时间达标');
  UI.el('res-notes').innerHTML = notes.map(n => `<div>· ${n}</div>`).join('');
};

/* ============================================================
   输入
   ============================================================ */
IN.init = function (canvas) {
  const S = SIM.state;
  let panning = false, panStart = null, panCam = null;
  let drawing = false, drawTarget = null;
  let focusDrag = null;

  const worldPos = (e) => {
    const r = canvas.getBoundingClientRect();
    return REN.screenToWorld(e.clientX - r.left, e.clientY - r.top);
  };

  // 找鼠标下的队员
  const unitAt = (e) => {
    const w = worldPos(e);
    const sim = S.sim;
    if (!sim) return null;
    let best = null, bd = 0.75;
    sim.troopers.forEach(t => {
      if (!t.alive) return;
      const d = Math.hypot(t.x - w.x, t.y - w.y);
      if (d < bd) { bd = d; best = t; }
    });
    return best;
  };

  /* 找鼠标下的路径节点（已选中的队员优先，其次全体） */
  const waypointAt = (e, radius) => {
    const w = worldPos(e);
    const sim = S.sim;
    if (!sim) return null;
    const rad = radius || 0.55;
    const cands = S.selected.length ? S.selected.concat(sim.troopers) : sim.troopers;
    let best = null, bd = rad;
    for (const t of cands) {
      if (!t || !t.alive || !t.path) continue;
      for (let i = 0; i < t.path.length; i++) {
        const wp = t.path[i];
        const d = Math.hypot(wp.x - w.x, wp.y - w.y);
        if (d < bd) { bd = d; best = { t, i, wp }; }
      }
    }
    return best;
  };

  /* 点路径线 -> 在这条线段上插入一个新节点（"细分规划"） */
  const pathInsertPoint = (e) => {
    const w = worldPos(e);
    const sim = S.sim;
    if (!sim) return null;
    const cands = S.selected.length ? S.selected : sim.troopers;
    let best = null, bd = 0.7;
    for (const t of cands) {
      if (!t || !t.alive || !t.path || !t.path.length) continue;
      const ins = SIM.pathInsertPoint(t, w.x, w.y, bd);
      if (ins) {
        bd = Math.hypot(ins.x - w.x, ins.y - w.y);
        best = { t, i: ins.i, x: ins.x, y: ins.y };
      }
    }
    return best;
  };

  /* 右键拖拽调朝向：拖拽过程中视野锥实时跟随鼠标，松手落定。
     - 无修饰键：注视鼠标点（切角 / 临时）
     - Ctrl：固定角度（Strafe，角度不随位置变化）
     - Shift：持续注视（切角）
     多选时若点中的队员在选中集内，则整组一起转。
     若当前选中了一个路径节点，则只给那个节点设朝向。 */
  const applyFaceDrag = (sim, w, release) => {
    if (!focusDrag) return;

    // ---- 给选中的路径节点设朝向 ----
    if (focusDrag.wp) {
      const { t, i } = focusDrag.wp;
      const wp = t.path && t.path[i];
      if (!wp) return;
      const ang = Math.atan2(w.y - wp.y, w.x - wp.x);
      if (focusDrag.hard) {
        wp.faceMode = FACE.HARD;
        wp.face = ang;
        delete wp.lookX; delete wp.lookY;
      } else {
        wp.faceMode = FACE.FOCUS;   // 切角
        wp.lookX = w.x; wp.lookY = w.y;
        delete wp.face;
      }
      return;
    }

    // ---- 给队员设朝向 ----
    for (const t of focusDrag.group) {
      if (!t.alive) continue;
      const ang = Math.atan2(w.y - t.y, w.x - t.x);
      // 直接对准：拖拽要求 1:1 跟手。不能只设 lookX/lookY 交给 updateTrooper 平滑转，
      // 因为规划态（暂停）下 updateTrooper 不执行，视野锥会纹丝不动。
      t.face = ang;
      if (focusDrag.hard) {
        t.hardFace = ang;
        t.faceMode = FACE.HARD;
        t.faceTemp = false;
      } else {
        t.lookX = w.x; t.lookY = w.y;
        t.faceMode = FACE.FOCUS;
        // 拖拽过程中始终生效；松手后才决定是"临时朝向"还是"持续锁定注视"
        t.faceTemp = release ? focusDrag.temp : false;
      }
    }
  };

  canvas.addEventListener('mousedown', (e) => {
    const sim = S.sim;
    if (!sim || sim.over) return;
    const w = worldPos(e);

    // 中键 / 右键拖拽 = 平移
    if (e.button === 1) {
      panning = true; panStart = { x: e.clientX, y: e.clientY }; panCam = { x: S.cam.x, y: S.cam.y };
      e.preventDefault(); return;
    }

    if (e.button === 2) {
      // 若选中了某个路径节点 -> 右键拖拽只给那个节点设朝向
      // （无修饰=切角/注视，Ctrl=固定角度）
      if (S.selWp && S.selWp.t.alive && S.selWp.t.path && S.selWp.t.path[S.selWp.i]) {
        focusDrag = { wp: S.selWp, hard: !!e.ctrlKey, temp: false };
        applyFaceDrag(sim, w, false);
        UI.syncWpBar();
        UI.syncHud(sim);
        e.preventDefault();
        return;
      }

      // 右键：朝向 / 破门菜单
      const u = unitAt(e);
      if (u) {
        if (S.tool === 'grenade') { UI.throwGrenade(sim, u, w); S.tool = null; return; }
        if (S.tool === 'wallcharge') { UI.placeCharge(sim, u, w); S.tool = null; return; }

        // 右键按住不放即可拖拽连续调整朝向（视野锥跟随鼠标）
        const inSel = S.selected.includes(u);
        const group = (inSel && S.selected.length > 1)
          ? S.selected.filter(t => t.alive)
          : [u];
        if (!inSel) S.selected = [u];
        focusDrag = {
          group,
          hard: !!e.ctrlKey,                                   // Ctrl = 强制朝向
          temp: !e.ctrlKey && !e.shiftKey                      // 无修饰键 = 临时朝向
        };
        applyFaceDrag(sim, w, false);
        UI.syncHud(sim);
        return;
      }
      // 空白右键：取消工具
      S.tool = null;
      return;
    }

    // 左键

    // 点路径线插入节点（细分规划）—— 对齐 DK2：
    //   Alt   = 普通节点
    //   Shift = 停顿点（Halt）：走到这里停住，直到触发该队员的 GO Code
    //   Ctrl  = 同速点（Match speed）：这一段跟着附近最慢的友军走
    // 不用双击是因为：双击的第一下会先落下一条移动命令，把原路径冲掉。
    if (e.altKey || e.shiftKey || e.ctrlKey) {
      const ins = pathInsertPoint(e);
      if (ins && !unitAt(e)) {
        const wp = { x: ins.x, y: ins.y };
        if (e.shiftKey) wp.halt = true;
        else if (e.ctrlKey) wp.matchSpeed = true;
        ins.t.path.splice(ins.i, 0, wp);
        S.selWp = { t: ins.t, i: ins.i, wp: wp };
        UI.syncWpBar();
        UI.syncHud(sim);
        e.preventDefault();
        return;
      }
    }

    const u = unitAt(e);

    // 点路径节点 -> 选中（之后可右键拖拽设朝向 / Del 删除 / 双击删除）
    const wpHit = waypointAt(e);
    if (wpHit) {
      if (e.detail >= 2) {
        wpHit.t.path.splice(wpHit.i, 1);   // 双击节点 = 删除
        S.selWp = null;
        UI.syncWpBar();
        UI.syncHud(sim);
        return;
      }
      S.selWp = wpHit;
      UI.syncWpBar();
      UI.syncHud(sim);
      return;
    }
    if (S.selWp) { S.selWp = null; UI.syncWpBar(); }   // 点别处取消节点选中

    // 点门 -> 破门选择
    if (!u) {
      const gx = Math.floor(w.x), gy = Math.floor(w.y);
      const dr = sim.grid.doors.find(d => d.x === gx && d.y === gy && !d.open);
      if (dr) { UI.openDoorMenu(sim, dr, w); return; }
      // 空地点：移动选中的队员
      if (S.selected.length) {
        const u2 = S.selected[0];
        u2.path = [{ x: w.x, y: w.y }];
        u2.faceMode = FACE.PATH;
        UI.syncHud(sim);
      }
      return;
    }

    // 点队员：选中 + 开始画路径
    if (!e.shiftKey) S.selected = [u];
    else if (!S.selected.includes(u)) S.selected.push(u);

    // 点人质/HVT -> 规划动作
    drawing = true; drawTarget = u;
    const inside = REN.worldToScreen(u.x, u.y);
    // 重画路径
    u.path = [];
    S.dragFrom = u;
    UI.syncHud(sim);
  });

  canvas.addEventListener('mousemove', (e) => {
    const sim = S.sim;
    if (!sim) return;
    S.mouse = worldPos(e);
    S.hoverUnit = unitAt(e);

    if (panning) {
      const dx = (e.clientX - panStart.x) / (REN.TILE * S.zoom);
      const dy = (e.clientY - panStart.y) / (REN.TILE * S.zoom);
      S.cam.x = panCam.x - dx;
      S.cam.y = panCam.y - dy;
      return;
    }
    if (focusDrag) { applyFaceDrag(sim, S.mouse, false); return; }
    if (drawing && drawTarget) {
      // 追加路径点（距离阈值）
      const w = worldPos(e);
      const last = drawTarget.path[drawTarget.path.length - 1] || { x: drawTarget.x, y: drawTarget.y };
      if (Math.hypot(w.x - last.x, w.y - last.y) > 0.55) {
        drawTarget.path.push({ x: w.x, y: w.y });
      }
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 1) panning = false;
    // 右键拖拽调朝向：松手落定
    if (e.button === 2 && focusDrag) {
      const sim = S.sim;
      if (sim && !sim.over) applyFaceDrag(sim, worldPos(e), true);
      focusDrag = null;
      return;
    }
    if (e.button === 0 && drawing) {
      drawing = false;
      const sim = S.sim;
      if (sim && drawTarget) {
        // 若路径终点靠近门/人质/炸弹，自动加动作
        UI.autoAssignAction(sim, drawTarget);
        drawTarget = null;
        UI.syncHud(sim);
      }
    }
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // 窗口失焦时清掉拖拽状态：否则松手事件可能丢在窗口外，视野锥会一直粘着鼠标
  window.addEventListener('blur', () => { focusDrag = null; panning = false; drawing = false; });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const before = REN.screenToWorld(e.clientX - canvas.getBoundingClientRect().left, e.clientY - canvas.getBoundingClientRect().top);
    S.zoom = Math.max(0.45, Math.min(2.6, S.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    const after = REN.screenToWorld(e.clientX - canvas.getBoundingClientRect().left, e.clientY - canvas.getBoundingClientRect().top);
    S.cam.x += before.x - after.x;
    S.cam.y += before.y - after.y;
  }, { passive: false });

  // 键盘
  window.addEventListener('keydown', (e) => {
    const sim = S.sim;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!sim || sim.over) return;
      UI.togglePlay();
      return;
    }
    if (!sim || sim.over) return;
    const k = e.key.toUpperCase();

    // TAB —— 循环多选队员（依次加入，全部选完则回到第一个）
    if (k === 'TAB') {
      e.preventDefault();
      const alive = sim.troopers.filter(t => t.alive);
      if (!alive.length) return;
      const next = alive.find(t => !S.selected.includes(t));
      S.selected = next ? S.selected.concat([next]) : [alive[0]];
      UI.syncHud(sim);
      return;
    }

    // Del / Backspace —— 删除选中的路径节点
    if (k === 'DELETE' || k === 'BACKSPACE') {
      const w0 = S.selWp;
      if (w0 && w0.t.path && w0.t.path[w0.i]) {
        w0.t.path.splice(w0.i, 1);
        S.selWp = null;
        UI.syncWpBar();
        UI.syncHud(sim);
      }
      return;
    }

    // [ / ] —— 微调选中节点的朝向角度（切成固定角度模式，每次 5°）
    if (k === '[' || k === ']') {
      const wp = S.selWp && S.selWp.t.path && S.selWp.t.path[S.selWp.i];
      if (wp) {
        if (wp.faceMode !== FACE.HARD) { wp.faceMode = FACE.HARD; wp.face = wp.face || 0; }
        wp.face += (k === ']' ? 1 : -1) * (Math.PI / 36);
        delete wp.lookX; delete wp.lookY;
        UI.syncWpBar();
      }
      return;
    }

    // GO Code —— 数字键 1-4（对应 A/B/C/D 组）。
    // Shift + 数字 = 切换该组的「自动触发」（对齐 DK2）：该组全部到位后自动激活
    if (k === '1' || k === '2' || k === '3' || k === '4') {
      const idx = +k - 1;
      const code = sim.goCodes[idx];
      if (code) {
        if (e.shiftKey) {
          const on = SIM.toggleGoAuto(sim, code);
          UI.toast(sim, 'GO ' + code + (on ? '：自动触发 开' : '：自动触发 关'), on ? '#8fe08f' : '#9fb0c0');
        } else {
          SIM.executeGo(sim, code);
          UI.toast(sim, 'GO ' + code, '#7fc8ff');
        }
      }
      return;
    }

    // Shift + ` = 全体切换「停下射击 / 不停下」（DK2 的 Wait for clear / Keep moving）
    if (k === '`' || k === '~') {
      const anyShoot = sim.troopers.some(t => t.alive && t.autoShoot);
      sim.troopers.forEach(t => { if (t.alive) t.autoShoot = !anyShoot; });
      UI.toast(sim, anyShoot ? '全体：不停下，边走边打' : '全体：停下射击', '#ffd479');
      return;
    }
    if (k === 'L') { S.speed = S.speed === 1 ? 0.35 : 1; UI.toast(sim, S.speed < 1 ? '慢动作 开' : '慢动作 关', '#ffd479'); return; }
    if (k === 'N') { S.speed = S.speed === 1 ? 3 : 1; UI.toast(sim, S.speed > 1 ? '快进 ×3' : '正常速度', '#ffd479'); return; }
    if (k === 'F') {
      // Shift + F = 全体切换静默（对齐 DK2 的 Go Silent）
      if (e.shiftKey) {
        const anyOn = sim.troopers.some(t => t.alive && t.goSilent);
        sim.troopers.forEach(t => { if (t.alive) t.goSilent = !anyOn; });
        UI.toast(sim, anyOn ? '全体解除静默' : '全体静默（跑动/破门噪音降低）', '#8fe08f');
      } else S.showFov = !S.showFov;
      return;
    }
    if (k === 'P') { S.showPlans = !S.showPlans; return; }
    if (k === 'Q') { S.showGrid = !S.showGrid; return; }
    if (k === 'C') {
      // 蹲
      S.selected.forEach(t => { if (t.alive) t.crouch = !t.crouch; });
      UI.syncHud(sim); return;
    }
    if (k === 'R') {
      S.selected.forEach(t => { if (t.alive) { t.reloading = true; t.reloadT = 2400; } });
      return;
    }
    if (k === 'X') {
      // 切换主/副武器（各自保留剩弹）
      S.selected.forEach(t => { if (t.alive) ENG.swapWeapon(sim, t); });
      UI.syncHud(sim); return;
    }
    if (k === 'H') {
      const allHold = S.selected.every(t => t.roe === 'hold');
      S.selected.forEach(t => t.roe = allHold ? 'free' : 'hold');
      UI.toast(sim, allHold ? '自由开火' : '停火', '#ffb84a');
      UI.syncHud(sim); return;
    }
    if (k === 'G') { S.tool = 'grenade'; UI.toast(sim, '选择投掷物后右键目标位置', '#ffd479'); return; }
    if (k === 'B') { S.tool = 'wallcharge'; UI.toast(sim, '右键点击可破坏墙安放炸药', '#ffd479'); return; }
    if (k === 'ESCAPE' || k === 'ESC') { UI.togglePauseMenu(); return; }
    if (k === 'F1' || k === '/') { UI.el('screen-help').classList.toggle('hidden'); return; }
    // 视角
    if (e.key === 'ArrowLeft') S.cam.x -= 2;
    if (e.key === 'ArrowRight') S.cam.x += 2;
    if (e.key === 'ArrowUp') S.cam.y -= 2;
    if (e.key === 'ArrowDown') S.cam.y += 2;
  });
};

/* 自动给路径终点分配动作 */
UI.autoAssignAction = function (sim, t) {
  if (!t.path || !t.path.length) return;
  const last = t.path[t.path.length - 1];
  const gx = Math.floor(last.x), gy = Math.floor(last.y);
  const tt = MAPGEN.at(sim.grid, gx, gy);
  if (tt === MAPGEN.T.DOOR || tt === MAPGEN.T.LOCKED) {
    const dr = sim.grid.doors.find(d => d.x === gx && d.y === gy);
    if (dr && !dr.open) {
      const method = dr.locked
        ? (t.breachTools.includes('shotgun') ? 'shotgun' : (t.breachTools.includes('bolt') ? 'bolt' : (t.breachTools.includes('crowbar') ? 'crowbar' : 'kick')))
        : (t.breachTools.includes('kick') ? 'kick' : 'hand');
      last.breach = true; last.door = dr; last.method = method;
    }
  }
  // 终点附近有交互物
  if (t.visible && t.visible.interactive) {
    t.visible.interactive.forEach(o => {
      if (Math.hypot(last.x - o.x, last.y - o.y) < 1.6) {
        if (o.kind === 'arrest') { last.arrest = true; last.unit = o.unit; }
        if (o.kind === 'free') { last.free = true; last.unit = o.unit; }
        if (o.kind === 'defuse') { last.defuse = true; }
        if (o.kind === 'power') { last.power = true; }
      }
    });
  }
};

/* 破门菜单 */
UI.openDoorMenu = function (sim, door, w) {
  const menu = UI.el('ctx-menu');
  menu.innerHTML = '';
  const t = SIM.state.selected[0] || sim.troopers[0];
  const tools = t ? t.breachTools : ['hand', 'kick'];
  tools.forEach(m => {
    const b = DATA.BREACH[m];
    const btn = document.createElement('button');
    btn.className = 'ctx-btn';
    btn.innerHTML = `<b>${b.name}</b><span>噪音 ${b.noise}m · 耗时 ${(b.time / 1000).toFixed(1)}s${b.stun ? ' · 眩晕 ' + (b.stun / 1000).toFixed(1) + 's' : ''}</span>`;
    btn.onclick = () => {
      sim.troopers.forEach(tt => {
        if (!tt.alive) return;
        if (SIM.state.selected.includes(tt) || SIM.state.selected.length === 0) {
          tt.path = tt.path || [];
          tt.path.push({ x: door.x + .5, y: door.y + .5, breach: true, door, method: m });
        }
      });
      menu.classList.add('hidden');
      UI.toast(sim, `${b.name}（噪音 ${b.noise}m）`, '#ffb84a');
    };
    menu.appendChild(btn);
  });
  menu.style.left = Math.min(window.innerWidth - 240, w ? 0 : 0) + 'px';
  menu.style.left = '50%';
  menu.style.top = '50%';
  menu.style.transform = 'translate(-50%,-50%)';
  menu.classList.remove('hidden');
};

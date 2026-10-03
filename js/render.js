/* ============================================================
   DK2D - 渲染器（Canvas 2D 俯视）
   地板/墙/门/窗/掩体、战争迷雾、视野锥、路径线、
   GO Code 路径着色、单位、特效、HUD
   ============================================================ */
const REN = {};
REN.TILE = 32;

REN.COL = {
  bg:        '#12161c',
  outside:   '#171c23',
  floor:     '#2b3138',
  floorAlt:  '#262c33',
  wall:      '#4a5460',
  wallTop:   '#5d6874',
  door:      '#b8863f',
  locked:    '#8f5a2a',
  window:    '#4a86a8',
  brwall:    '#7a5a3a',
  cover:     '#5a6a4a',
  lowcover:  '#46543c',
  furn:      '#3d4750',
  grid:      '#2f363d',
  fog:       'rgba(8,10,13,0.88)',
  halfFog:   'rgba(8,10,13,0.55)',
  planLine:  '#e8eef5',
  pathCols:  ['#ff6b6b', '#4ecdc4', '#ffd93d', '#a78bfa'],
  vision:    'rgba(255,238,170,0.13)',
  visionEnemy:'rgba(255,90,90,0.13)',
  player:    '#5ec8ff',
  hostile:   '#ff5c5c',
  neutral:   '#ffd479'
};

/* ---------- 相机 ---------- */
REN.worldToScreen = function (wx, wy) {
  const s = SIM.state;
  return {
    x: (wx - s.cam.x) * REN.TILE * s.zoom + REN.cw / 2,
    y: (wy - s.cam.y) * REN.TILE * s.zoom + REN.ch / 2
  };
};
REN.screenToWorld = function (sx, sy) {
  const s = SIM.state;
  return {
    x: (sx - REN.cw / 2) / (REN.TILE * s.zoom) + s.cam.x,
    y: (sy - REN.ch / 2) / (REN.TILE * s.zoom) + s.cam.y
  };
};

REN.resize = function (canvas) {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.floor(r.width * dpr);
  canvas.height = Math.floor(r.height * dpr);
  REN.ctx = canvas.getContext('2d');
  REN.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  REN.cw = r.width; REN.ch = r.height;
};

/* ---------- 主渲染 ---------- */
REN.draw = function (sim) {
  const ctx = REN.ctx;
  if (!ctx) return;
  const s = SIM.state;
  const T = REN.TILE * s.zoom;

  ctx.fillStyle = REN.COL.bg;
  ctx.fillRect(0, 0, REN.cw, REN.ch);

  if (!sim) return;
  const g = sim.grid;

  /* --- 地板 / 墙 --- */
  const x0 = Math.max(0, Math.floor(s.cam.x - REN.cw / 2 / T) - 2);
  const x1 = Math.min(g.w, Math.ceil(s.cam.x + REN.cw / 2 / T) + 2);
  const y0 = Math.max(0, Math.floor(s.cam.y - REN.ch / 2 / T) - 2);
  const y1 = Math.min(g.h, Math.ceil(s.cam.y + REN.ch / 2 / T) + 2);

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const t = g.tiles[y][x];
      const p = REN.worldToScreen(x, y);
      const inB = x >= g.building.x && x < g.building.x + g.building.w &&
                  y >= g.building.y && y < g.building.y + g.building.h;

      if (t === MAPGEN.T.EMPTY) {
        ctx.fillStyle = REN.COL.outside;
        ctx.fillRect(p.x, p.y, T + 1, T + 1);
        continue;
      }
      // 地板底色
      ctx.fillStyle = ((x + y) % 2 === 0) ? REN.COL.floor : REN.COL.floorAlt;
      ctx.fillRect(p.x, p.y, T + 1, T + 1);

      if (t === MAPGEN.T.WALL) {
        ctx.fillStyle = REN.COL.wall;
        ctx.fillRect(p.x, p.y, T + 1, T + 1);
        ctx.fillStyle = REN.COL.wallTop;
        ctx.fillRect(p.x, p.y, T + 1, Math.max(2, T * 0.14));
      } else if (t === MAPGEN.T.BRWALL) {
        ctx.fillStyle = REN.COL.brwall;
        ctx.fillRect(p.x, p.y, T + 1, T + 1);
        // 裂纹
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(p.x + T * 0.2, p.y + T * 0.2);
        ctx.lineTo(p.x + T * 0.6, p.y + T * 0.55);
        ctx.lineTo(p.x + T * 0.8, p.y + T * 0.85);
        ctx.stroke();
      } else if (t === MAPGEN.T.DOOR || t === MAPGEN.T.LOCKED) {
        const d = g.doors.find(dd => dd.x === x && dd.y === y);
        if (d && (d.open || d.broken)) {
          // 开着的门：只画门框
          ctx.strokeStyle = d.broken ? 'rgba(184,134,63,0.35)' : REN.COL.door;
          ctx.lineWidth = 2;
          ctx.strokeRect(p.x + 2, p.y + 2, T - 4, T - 4);
        } else {
          ctx.fillStyle = t === MAPGEN.T.LOCKED ? REN.COL.locked : REN.COL.door;
          ctx.fillRect(p.x + 1, p.y + 1, T - 1, T - 1);
          if (t === MAPGEN.T.LOCKED) {
            ctx.fillStyle = '#d9c47a';
            ctx.fillRect(p.x + T / 2 - 2, p.y + T / 2 - 3, 4, 6);
          }
        }
      } else if (t === MAPGEN.T.WINDOW) {
        ctx.fillStyle = REN.COL.window;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(p.x, p.y, T + 1, T + 1);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#8fc8e8';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(p.x + 1, p.y + 1, T - 2, T - 2);
      } else if (t === MAPGEN.T.COVER) {
        ctx.fillStyle = REN.COL.cover;
        ctx.fillRect(p.x + 1, p.y + 1, T - 1, T - 1);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(p.x + 3, p.y + 3, T - 6, T - 6);
      } else if (t === MAPGEN.T.LOWCOVER) {
        ctx.fillStyle = REN.COL.lowcover;
        ctx.fillRect(p.x + 3, p.y + 3, T - 5, T - 5);
      } else if (t === MAPGEN.T.FURN) {
        ctx.fillStyle = REN.COL.furn;
        ctx.fillRect(p.x + 2, p.y + 2, T - 3, T - 3);
      }
    }
  }

  /* --- 网格线（规划阶段） --- */
  if (s.showGrid && (s.mode === 'planning' || s.mode === 'paused')) {
    ctx.strokeStyle = REN.COL.grid;
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = 0.4;
    for (let x = x0; x <= x1; x++) {
      const p = REN.worldToScreen(x, 0);
      ctx.beginPath(); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, REN.ch); ctx.stroke();
    }
    for (let y = y0; y <= y1; y++) {
      const p = REN.worldToScreen(0, y);
      ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(REN.cw, p.y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* --- 配电箱 / 炸弹 / 撤离点 --- */
  if (sim.powerBox) {
    const p = REN.worldToScreen(sim.powerBox.x + .5, sim.powerBox.y + .5);
    ctx.fillStyle = sim.powerBox.off ? '#555' : '#4ad07a';
    ctx.fillRect(p.x - T * 0.28, p.y - T * 0.32, T * 0.56, T * 0.64);
    ctx.fillStyle = '#0b0e12';
    ctx.font = `${Math.max(8, T * 0.3)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('⚡', p.x, p.y);
  }
  if (sim.bomb && !sim.bomb.defused) {
    const p = REN.worldToScreen(sim.bomb.x, sim.bomb.y);
    const blink = (Math.sin(sim.time * 8) > 0);
    ctx.fillStyle = blink ? '#ff3b3b' : '#8a1f1f';
    ctx.beginPath(); ctx.arc(p.x, p.y, T * 0.4, 0, 6.29); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(9, T * 0.36)}px monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(Math.ceil(sim.bomb.timer), p.x, p.y);
  }
  g.exits.forEach(e => {
    const p = REN.worldToScreen(e.x + .5, e.y + .5);
    ctx.strokeStyle = '#4ad07a';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 5]);
    ctx.strokeRect(p.x - T * 0.7, p.y - T * 0.7, T * 1.4, T * 1.4);
    ctx.setLineDash([]);
    ctx.fillStyle = '#4ad07a';
    ctx.font = `bold ${Math.max(8, T * 0.28)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('EXIT', p.x, p.y);
  });

  /* --- 视野锥（迷雾先算） --- */
  const visMask = REN.buildVisionMask(sim);
  REN.paintFog(ctx, sim, visMask, T);

  /* --- 路径线 ---
     必须画在迷雾【之后】：路径是玩家自己画的规划层，
     如果在迷雾前绘制，未探索区域的路线会被压暗到看不清 —— 而规划恰恰最需要看清它。 */
  if (s.showPlans) {
    sim.troopers.forEach((t, i) => {
      if (!t.alive) return;
      const col = REN.COL.pathCols[i % REN.COL.pathCols.length];
      if (t.path && t.path.length) REN.drawPath(ctx, t, col, T);
      // 停顿中的标记（停顿会消费掉那个节点，用 haltAt 保留可视化）
      if (t.halted && t.haltAt) {
        const hp = REN.worldToScreen(t.haltAt.x, t.haltAt.y);
        REN.badge(ctx, hp.x, hp.y, '停', '#ffb84a');
      }
    });
  }

  /* --- 单位 --- */
  sim.units.forEach(u => {
    if (!u.alive) return;
    REN.drawUnit(ctx, sim, u, T);
  });

  /* --- 烟雾 --- */
  (sim.smokes || []).forEach(sm => {
    sm.t -= 1 / 60;
    const p = REN.worldToScreen(sm.x, sm.y);
    const r = sm.r * T;
    const grd = ctx.createRadialGradient(p.x, p.y, r * 0.2, p.x, p.y, r);
    const a = Math.min(0.75, sm.t / 4);
    grd.addColorStop(0, `rgba(200,205,210,${a * 0.9})`);
    grd.addColorStop(1, 'rgba(200,205,210,0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.29); ctx.fill();
  });
  sim.smokes = (sim.smokes || []).filter(sm => sm.t > 0);

  /* --- 投掷物 --- */
  sim.projectiles.forEach(p => {
    const sp = REN.worldToScreen(p.x, p.y);
    const r = T * 0.18 * (1 + (p.h || 0) * 0.4);
    ctx.fillStyle = p.type === 'frag' ? '#4a5a3a' : (p.type === 'flash' ? '#d8d8d8' : '#9aa8b5');
    ctx.beginPath(); ctx.arc(sp.x, sp.y - (p.h || 0) * T * 0.5, r, 0, 6.29); ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
  });

  /* --- 特效 --- */
  REN.drawFx(ctx, sim, T);

  /* --- 交互提示 --- */
  REN.drawInteract(ctx, sim, T);
};

/* ---------- 路径线绘制 ---------- */
REN.drawPath = function (ctx, t, col, T) {
  const pts = [{ x: t.x, y: t.y }].concat(t.path.map(w => ({ x: w.x, y: w.y })));
  ctx.strokeStyle = col;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const sp = REN.worldToScreen(p.x, p.y);
    if (i === 0) ctx.moveTo(sp.x, sp.y); else ctx.lineTo(sp.x, sp.y);
  });
  ctx.stroke();
  // 路径点
  t.path.forEach(w => {
    const sp = REN.worldToScreen(w.x, w.y);
    const isSel = !!(SIM.state.selWp && SIM.state.selWp.wp === w);

    // 切角（Slice the Pie）：从节点指向注视点的虚线 + 视野锥扫过的弧线
    if (w.faceMode === FACE.FOCUS && w.lookX !== undefined) {
      const lp = REN.worldToScreen(w.lookX, w.lookY);
      const ang = Math.atan2(w.lookY - w.y, w.lookX - w.x);
      const half = ((t.fov || 90) * Math.PI / 180) / 2;
      const r = Math.max(24, T * 1.7);
      ctx.save();
      ctx.strokeStyle = '#c08bff';
      ctx.lineWidth = 1.4;
      ctx.globalAlpha = 0.55;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(lp.x, lp.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.34;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, r, ang - half, ang + half); ctx.stroke();
      ctx.restore();
    }

    // 节点本体（选中的高亮）
    ctx.fillStyle = isSel ? '#ffffff' : col;
    ctx.beginPath(); ctx.arc(sp.x, sp.y, isSel ? 4.8 : 3.2, 0, 6.29); ctx.fill();
    if (isSel) {
      ctx.strokeStyle = '#5ec8ff'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 8.5, 0, 6.29); ctx.stroke();
    }

    // 朝向箭头：蓝 = 固定角度，紫 = 切角/注视
    if (w.faceMode === FACE.HARD) {
      REN.drawFaceArrow(ctx, sp.x, sp.y, w.face, T * 0.9, '#6ec8ff', 8);
    } else if (w.faceMode === FACE.FOCUS) {
      REN.drawFaceArrow(ctx, sp.x, sp.y, Math.atan2((w.lookY) - w.y, (w.lookX) - w.x), T * 1.4, '#c08bff', 8);
    }
    if (w.cancel) { REN.badge(ctx, sp.x, sp.y - 13, '✕', '#ff8a8a'); }

    // 动作图标：横向排开，避免原来 6 种徽章全叠在同一个点上
    const icons = [];
    if (w.breach) icons.push([w.method === 'kick' ? '踹' : (w.method === 'charge' ? '炸' : '开'), '#e0a040']);
    if (w.grenade) icons.push([w.grenade.type === 'frag' ? '雷' : (w.grenade.type === 'flash' ? '闪' : '烟'), '#d0d0d0']);
    if (w.arrest) icons.push(['捕', '#7fc8ff']);
    if (w.free) icons.push(['救', '#8fe08f']);
    if (w.defuse) icons.push(['拆', '#8fe08f']);
    if (w.power) icons.push(['电', '#ffd479']);
    if (w.halt) icons.push(['停', '#ffb84a']);
    if (w.matchSpeed) icons.push(['速', '#8fe08f']);
    if (w.reload) icons.push(['弹', '#cfe4f0']);
    if (w.swap) icons.push(['枪', '#cfe4f0']);
    if (w.silent === true) icons.push(['静', '#8fe08f']);
    if (w.crouch === true) icons.push(['蹲', '#9fd0ea']);
    if (w.sprint === true) icons.push(['跑', '#ffb84a']);
    const iw = 18;
    icons.forEach((ic, k) => {
      REN.badge(ctx, sp.x - (icons.length - 1) * iw / 2 + k * iw, sp.y + 15, ic[0], ic[1]);
    });
  });
  ctx.globalAlpha = 1;
};

REN.badge = function (ctx, x, y, txt, col) {
  ctx.fillStyle = 'rgba(10,14,18,0.9)';
  ctx.beginPath(); ctx.arc(x, y, 8, 0, 6.29); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.stroke();
  ctx.fillStyle = col;
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(txt, x, y + 0.5);
};

REN.drawFaceArrow = function (ctx, x, y, ang, len, col, w) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  ctx.strokeStyle = col; ctx.lineWidth = w / 4;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(len, 0); ctx.lineTo(len - 6, -4); ctx.lineTo(len - 6, 4);
  ctx.closePath(); ctx.fillStyle = col; ctx.fill();
  ctx.restore();
};

/* ---------- 视野/迷雾 ---------- */
REN.buildVisionMask = function (sim) {
  const mask = {};
  const add = (x, y, v) => {
    const k = x + ',' + y;
    mask[k] = Math.max(mask[k] || 0, v);
  };
  const stamp = (cx, cy, face, fovDeg, range, val) => {
    const half = fovDeg * Math.PI / 180 / 2;
    const R = Math.ceil(range);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const x = Math.floor(cx) + dx, y = Math.floor(cy) + dy;
        if (x < 0 || y < 0 || x >= sim.grid.w || y >= sim.grid.h) continue;
        const px = x + .5, py = y + .5;
        const d = Math.hypot(px - cx, py - cy);
        if (d > range) continue;
        if (d > 1.4) {
          const a = Math.atan2(py - cy, px - cx);
          if (Math.abs(ENG.angDiff(a, face)) > half) continue;
        }
        if (d > 1.4 && !ENG.hasLOS(sim.grid, { x: cx, y: cy }, { x: px, y: py })) continue;
        add(x, y, val);
      }
  };

  sim.troopers.forEach(t => {
    if (!t.alive) return;
    let range = t.sight;
    if (sim.night && !t.hasNVG) range *= 0.45;
    stamp(t.x, t.y, t.face, t.fov, range, 2);
  });
  // 已发现过的区域保留记忆（半亮）
  sim.units.forEach(u => {
    if (!u.alive || u.side === 'player') return;
    if (u.alert > 0.35 || u.visibleTarget || u.state === 'engage' || u.state === 'hunt') {
      stamp(u.x, u.y, u.face, u.fov, Math.min(u.sight, 7), 1);
    }
  });
  return mask;
};

/* 迷雾：未探索 = 全黑，记忆区 = 半暗 */
REN.paintFog = function (ctx, sim, mask, T) {
  if (!sim.explored) sim.explored = {};
  const g = sim.grid;

  // 更新已探索
  Object.keys(mask).forEach(k => {
    if (mask[k] >= 2) sim.explored[k] = 1;
  });

  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const k = x + ',' + y;
      const v = mask[k] || 0;
      if (v >= 2) continue;   // 完全可见
      const p = REN.worldToScreen(x, y);
      if (p.x + T < 0 || p.y + T < 0 || p.x > REN.cw || p.y > REN.ch) continue;
      if (v === 1 || sim.explored[k]) {
        ctx.fillStyle = REN.COL.halfFog;
      } else {
        ctx.fillStyle = REN.COL.fog;
      }
      ctx.fillRect(p.x, p.y, T + 1, T + 1);
    }
  }
};

/* ---------- 单位 ---------- */
REN.drawUnit = function (ctx, sim, u, T) {
  const p = REN.worldToScreen(u.x, u.y);
  const r = T * 0.32;
  const isPlayer = u.side === 'player';
  const isHostile = u.side === 'hostile';
  const isNeutral = u.side === 'neutral';

  // 视野锥（可见时）
  if (SIM.state.showFov && (isPlayer || (isHostile && (u.alert > 0.3 || u.visibleTarget || u.state === 'engage')))) {
    const half = u.fov * Math.PI / 180 / 2;
    let range = (isPlayer ? u.sight : Math.min(u.sight, 12));
    if (sim.night && !u.hasNVG) range *= 0.45;
    const R = range * T;
    const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
    const col = isPlayer ? '255,238,170' : '255,90,90';
    grd.addColorStop(0, `rgba(${col},0.20)`);
    grd.addColorStop(1, `rgba(${col},0.02)`);
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.arc(p.x, p.y, R, u.face - half, u.face + half);
    ctx.closePath(); ctx.fill();
    // 边缘线
    ctx.strokeStyle = `rgba(${col},0.35)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + Math.cos(u.face - half) * R, p.y + Math.sin(u.face - half) * R);
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + Math.cos(u.face + half) * R, p.y + Math.sin(u.face + half) * R);
    ctx.stroke();
  }

  // 身体
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(u.face);

  if (!u.alive) {
    ctx.fillStyle = isPlayer ? 'rgba(94,200,255,0.28)' : 'rgba(140,70,70,0.5)';
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.15, r * 0.7, 0, 0, 6.29);
    ctx.fill();
    ctx.restore();
    return;
  }

  // 阴影
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.arc(1.5, 2, r, 0, 6.29); ctx.fill();

  // 主体圆
  const base = isPlayer ? REN.COL.player : (isHostile ? (u.color || REN.COL.hostile) : (u.color || REN.COL.neutral));
  ctx.fillStyle = base;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.29); ctx.fill();

  // 护甲环
  const arm = DATA.ARMOR[u.armor] || DATA.ARMOR.none;
  if (arm && arm.level > 0) {
    ctx.strokeStyle = arm.level >= 40 ? '#c8d8e8' : '#8fa8b8';
    ctx.lineWidth = arm.level >= 40 ? 2.2 : 1.5;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.72, -1.2, 1.2); ctx.stroke();
  }

  // 枪
  const w = DATA.WEAPONS[u.weapon];
  if (w) {
    ctx.fillStyle = '#20262c';
    const gl = w.cls === 'marksman' || w.cls === 'lmg' ? r * 1.5 : r * 1.05;
    ctx.fillRect(r * 0.5, -r * 0.22, gl, Math.max(2, r * 0.34));
  }

  // 朝向标记
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath(); ctx.arc(r * 0.55, 0, r * 0.2, 0, 6.29); ctx.fill();

  // 蹲下标记
  if (u.crouch) {
    ctx.strokeStyle = 'rgba(120,220,255,0.9)';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.25, 0, 6.29); ctx.stroke();
  }

  // 枪口火焰
  if (u.muzzleT > 0) {
    ctx.fillStyle = 'rgba(255,220,120,0.95)';
    const fl = r * (1.6 + Math.random() * 0.9);
    ctx.beginPath();
    ctx.moveTo(r * 1.2, 0);
    ctx.lineTo(r * 1.2 + fl, -r * 0.5);
    ctx.lineTo(r * 1.2 + fl * 1.2, 0);
    ctx.lineTo(r * 1.2 + fl, r * 0.5);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();

  // 受击闪白
  if (u.hurtT > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(0.75, u.hurtT / 260)})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.1, 0, 6.29); ctx.fill();
  }

  // 眩晕星
  if (u.stunT > 0) {
    ctx.fillStyle = '#ffe066';
    ctx.font = `${Math.max(10, T * 0.34)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('✦', p.x, p.y - r * 1.9);
  }

  // 血条（受伤时）
  if (u.hp < u.maxHp) {
    const bw = T * 0.8, bh = 3.5;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(p.x - bw / 2, p.y - r - 10, bw, bh);
    const hp = u.hp / u.maxHp;
    ctx.fillStyle = hp > 0.6 ? '#5ad07a' : (hp > 0.3 ? '#e0c040' : '#e04a4a');
    ctx.fillRect(p.x - bw / 2, p.y - r - 10, bw * hp, bh);
  }

  // 状态图标
  if (isHostile) {
    let icon = '';
    let col = '#ffb84a';
    if (u.state === 'investigate' || u.state === 'hunt') { icon = '?'; col = '#ffd479'; }
    else if (u.state === 'engage') { icon = '!'; col = '#ff4a4a'; }
    else if (u.ai && u.ai.includes('executioner')) { icon = '☠'; col = '#c060c0'; }
    else if (u.ai && u.ai.includes('suicide')) { icon = '☢'; col = '#ff7a3a'; }
    else if (u.ai && u.ai.includes('sniper')) { icon = '◎'; col = '#9fd0ff'; }
    if (icon) {
      ctx.fillStyle = col;
      ctx.font = `bold ${Math.max(11, T * 0.42)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(icon, p.x, p.y - r - 18);
    }
  }
  if (isNeutral && u.role === 'hvt' && u.surrendering) {
    ctx.fillStyle = '#7fc8ff';
    ctx.font = `bold ${Math.max(11, T * 0.4)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('!', p.x, p.y - r - 16);
  }

  // 选中环
  if (SIM.state.selected.includes(u)) {
    ctx.strokeStyle = '#ffe066';
    ctx.lineWidth = 2.2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.6, 0, 6.29); ctx.stroke();
    ctx.setLineDash([]);
  }

  // 名字
  if (isPlayer && SIM.state.zoom > 0.85) {
    ctx.fillStyle = 'rgba(220,235,245,0.9)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(u.name, p.x, p.y + r + 3);
  }
};

/* ---------- 交互提示 ---------- */
REN.drawInteract = function (ctx, sim, T) {
  const s = SIM.state;
  const t = s.hoverUnit;
  if (!t || !t.alive || t.side !== 'player') return;
  let y = REN.worldToScreen(t.x, t.y).y + T * 0.7;
  const x = REN.worldToScreen(t.x, t.y).x;
  const items = [];
  if (t.visible && t.visible.interactive) {
    t.visible.interactive.forEach(o => items.push(o));
  }
  if (!items.length) return;
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  items.slice(0, 4).forEach((o, i) => {
    const label = { door: '门（右键→破门）', power: '配电箱', bomb: '炸弹', arrest: '逮捕', free: '解救人质' }[o.kind] || o.kind;
    ctx.fillStyle = 'rgba(10,14,18,0.85)';
    const w = ctx.measureText(label).width + 12;
    ctx.fillRect(x + T * 0.7, y + i * 17, w, 15);
    ctx.fillStyle = '#cfe4f0';
    ctx.fillText(label, x + T * 0.7 + 6, y + i * 17 + 11);
  });
};

/* ---------- 特效 ---------- */
REN.drawFx = function (ctx, sim, T) {
  sim.fx.forEach(f => {
    if (f.type === 'corpse') return;
    const p = REN.worldToScreen(f.x, f.y);
    if (f.type === 'text') {
      ctx.globalAlpha = Math.min(1, f.t * 1.4);
      ctx.fillStyle = f.color || '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(f.text, p.x, p.y - (1.2 - f.t) * 18);
      ctx.globalAlpha = 1;
    } else if (f.type === 'dmg') {
      ctx.globalAlpha = Math.min(1, f.t * 1.6);
      ctx.fillStyle = f.crit ? '#ffd479' : '#ff8a8a';
      ctx.font = `bold ${f.crit ? 14 : 12}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText((f.crit ? '✦' : '') + f.v, p.x, p.y - 22 - (0.9 - f.t) * 20);
      ctx.globalAlpha = 1;
    } else if (f.type === 'flash') {
      const r = T * 0.5;
      ctx.fillStyle = `rgba(255,225,140,${f.t * 12})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.29); ctx.fill();
    } else if (f.type === 'boom') {
      const k = 1 - f.t / 0.5;
      const r = f.r * T * k;
      const grd = ctx.createRadialGradient(p.x, p.y, r * 0.3, p.x, p.y, r);
      grd.addColorStop(0, `rgba(255,220,120,${(1 - k) * 0.9})`);
      grd.addColorStop(0.6, `rgba(255,120,40,${(1 - k) * 0.55})`);
      grd.addColorStop(1, 'rgba(120,40,20,0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.29); ctx.fill();
    } else if (f.type === 'flashbang') {
      ctx.fillStyle = `rgba(255,255,255,${f.t * 0.85})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, f.r * T, 0, 6.29); ctx.fill();
    }
  });
  // 尸体画在底层（先画）
  const corpses = sim.fx.filter(f => f.type === 'corpse');
  corpses.forEach(c => {
    const p = REN.worldToScreen(c.x, c.y);
    ctx.fillStyle = c.side === 'player' ? 'rgba(94,200,255,0.25)' : (c.side === 'hostile' ? 'rgba(120,50,50,0.55)' : 'rgba(150,140,100,0.4)');
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, T * 0.36, T * 0.22, 0.6, 0, 6.29);
    ctx.fill();
  });
};

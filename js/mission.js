/* ============================================================
   DK2D - 任务装配 & 胜负判定（补充模块）
   ============================================================ */

/* ---------- 任务结局 ----------
   ⚠️ 胜负判定只有一处权威实现：SIM.checkEnd（在 sim.js 的 SIM.step 里每帧调用）。
   这里曾有一份重复的 SIM.checkWin，条件与权威实现不一致（要求人质"撤离"而非"获救"），
   一旦被调用就会产生互相矛盾的结局判定。已删除，不要再加回来。 */

SIM.endMission = function (sim, win, reason) {
  if (sim.over) return;
  sim.over = true;
  sim.win = win;
  sim.endReason = reason;
  sim.endTime = sim.time;
  SIM.computeStars(sim);
  SIM.state.mode = 'result';
  SIM.awardMissionXp(sim);
};

/* 结算时授予小队经验（用于战术信条）。
   重复通关同一关只给 30%，避免反复刷第一关把整棵树点满。 */
SIM.awardMissionXp = function (sim) {
  if (typeof DOCTRINE === 'undefined' || !sim.mission) return;
  let repeat = false;
  try {
    if (typeof UI !== 'undefined' && UI.progress) {
      const rec = UI.progress()[sim.mission.id];
      repeat = !!(rec && rec.stars > 0);
    }
  } catch (e) { /* 没有存档就当首次 */ }
  const xp = DOCTRINE.missionXp(sim.win, sim.stars || 0, repeat);
  const r = DOCTRINE.awardXp(xp);
  sim.xpGain = r.gained;
  sim.xpRepeat = repeat;
  sim.xpLevelBefore = r.levelBefore;
  sim.xpLevelAfter = r.levelAfter;
  sim.xpPointsGained = r.pointsGained;
};

/* ---------- GO Code 执行 ---------- */
SIM.executeGo = function (sim, code) {
  let n = 0;
  sim.troopers.forEach(t => {
    if (!t.alive) return;
    if (t.goCode !== code) return;
    t.hold = false;
    t.halted = false;      // 释放「停顿」节点：这就是 Halt + GO Code 的同步突入用法
    t.haltAt = null;
    t.goTriggered = true;
    n++;
  });
  if (n) {
    sim.fx.push({ type: 'text', x: sim.troopers[0].x, y: sim.troopers[0].y, text: '▶ GO ' + code, color: '#7fc8ff', t: 1.4 });
  }
  return n;
};

/* ---------- GO Code 自动触发（DK2 的 Shift+数字） ----------
   语义：该组有人开始移动 -> 武装；等这组【全部】到位（都不再移动）-> 自动激活。
   激活后置 goFired，等有人重新移动才重新武装，避免每帧重复触发。
   配合「停顿」节点就是标准的同步突入：各自走到门口停住，全员到位自动一起进。 */
SIM.updateGoAuto = function (sim) {
  if (!sim.goAuto || !sim.goArmed) return;
  ['A', 'B', 'C', 'D'].forEach(code => {
    if (!sim.goAuto[code]) return;
    const grp = sim.troopers.filter(t => t.alive && t.goCode === code);
    if (!grp.length) return;
    if (grp.some(t => t.moving)) {
      sim.goArmed[code] = true;
      sim.goFired[code] = false;
      return;
    }
    if (!sim.goArmed[code] || sim.goFired[code]) return;
    sim.goFired[code] = true;
    SIM.executeGo(sim, code);
    sim.fx.push({
      type: 'text', x: grp[0].x, y: grp[0].y - 1.2,
      text: '⚑ ' + code + ' 自动触发', color: '#8fe08f', t: 2.2
    });
  });
};

/* 切换某个 GO Code 的自动触发 */
SIM.toggleGoAuto = function (sim, code) {
  if (!sim.goAuto) return false;
  sim.goAuto[code] = !sim.goAuto[code];
  sim.goArmed[code] = false;
  sim.goFired[code] = false;
  return sim.goAuto[code];
};

/* ---------- 全员停火/自由开火 ---------- */
SIM.setROE = function (sim, roe) {
  sim.troopers.forEach(t => { if (t.alive) t.roe = roe; });
};

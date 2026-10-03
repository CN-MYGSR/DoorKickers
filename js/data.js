/* ============================================================
   DK2D - 数据层
   所有数值参考 Door Kickers 2: Task Force North 实测/公开数据
   - 护甲/穿甲采用 0-70 制（DK2 1.0 官方改为 0-70）
   - 视野锥：士兵 90° / 敌人 90° / 外国顾问 110°
   - 噪音半径、瞄准时间、精度区间均按 DK2 量级
   ============================================================ */

const DATA = {};

/* ---------- 护甲等级（0-70） ---------- */
DATA.ARMOR = {
  none:     { id: 'none',     name: '无护甲',      level: 0,  side: false, speedMod: 0    },
  soft:     { id: 'soft',     name: 'IIIA 软甲',   level: 10, side: false, speedMod: -2   },
  plate3:   { id: 'plate3',   name: 'III 级插板',  level: 30, side: true,  speedMod: -6   },
  plate3a:  { id: 'plate3a',  name: 'IIIA 轻背心', level: 20, side: false, speedMod: -4   },
  extprot:  { id: 'extprot',  name: '扩展防护',    level: 40, side: true,  speedMod: -10  },
  plate4:   { id: 'plate4',   name: 'IV 级插板',   level: 50, side: true,  speedMod: -12  }
};

/* ---------- 武器 ----------
   pen   : 穿甲值（对比护甲 level，>= 则可穿透）
   dmg   : 命中伤害（士兵 100 HP 计）
   crit  : 暴击(秒杀)概率 %
   aim   : 瞄准时间 ms（min~max 随机）
   reset : 射击间隔 ms
   start/end : 精度曲线（近距离/远距离）
   range : 有效射程 m
   sound : 开火噪音半径 m（消音武器很低）
   mob   : 机动性修正
   shots : 每次扣扳机连发数
   burst : 连发间隔 ms
   ------------------------------------------------------ */
DATA.WEAPONS = {
  /* 突击步枪 */
  M4:      { name:'M4 卡宾枪',      cls:'assault', pen:32, dmg:38, crit:22, aim:[180,320], reset:320, start:88, end:62, range:40, sound:60, mob:-3, shots:3, burst:90,  mag:30 },
  HK416:   { name:'HK416D10',       cls:'assault', pen:34, dmg:40, crit:24, aim:[190,340], reset:330, start:90, end:64, range:40, sound:60, mob:-4, shots:3, burst:88,  mag:30 },
  MK17:    { name:'Mk17 长管',      cls:'assault', pen:44, dmg:52, crit:26, aim:[260,430], reset:520, start:92, end:74, range:50, sound:66, mob:-7, shots:2, burst:120, mag:20 },
  G36C:    { name:'G36C',           cls:'assault', pen:30, dmg:34, crit:20, aim:[170,300], reset:300, start:86, end:60, range:36, sound:58, mob:-2, shots:3, burst:85,  mag:30 },
  AK47S:   { name:'AK-47S',         cls:'assault', pen:26, dmg:40, crit:18, aim:[300,520], reset:420, start:78, end:54, range:38, sound:64, mob:-5, shots:3, burst:110, mag:30 },
  SR3M:    { name:'SR3-M 卡宾',     cls:'assault', pen:34, dmg:34, crit:26, aim:[140,240], reset:260, start:84, end:52, range:28, sound:58, mob:-1, shots:4, burst:70,  mag:30 },
  MP5SD:   { name:'MP5SD3 消音',    cls:'smg',     pen:16, dmg:26, crit:20, aim:[120,210], reset:230, start:82, end:48, range:22, sound:8,  mob:0,  shots:3, burst:75,  mag:30 },
  P90:     { name:'P90-SD',         cls:'smg',     pen:34, dmg:26, crit:22, aim:[110,200], reset:210, start:84, end:50, range:24, sound:8,  mob:0,  shots:4, burst:60,  mag:50 },
  MP7:     { name:'MP7',            cls:'smg',     pen:26, dmg:24, crit:18, aim:[100,180], reset:200, start:80, end:46, range:20, sound:56, mob:1,  shots:4, burst:58,  mag:40 },
  /* 手枪 */
  G17:     { name:'G17 手枪',       cls:'pistol',  pen:10, dmg:22, crit:16, aim:[80,140],  reset:190, start:80, end:40, range:14, sound:54, mob:8,  shots:2, burst:110, mag:17 },
  M1911:   { name:'M1911',          cls:'pistol',  pen:12, dmg:28, crit:18, aim:[80,150],  reset:200, start:78, end:38, range:13, sound:56, mob:7,  shots:2, burst:120, mag:8  },
  /* 精确射手 */
  MK17LB:  { name:'Mk17 精确型',    cls:'marksman',pen:48, dmg:62, crit:34, aim:[420,700], reset:900, start:94, end:82, range:56, sound:70, mob:-9, shots:1, burst:0,   mag:20 },
  SVD:     { name:'SVD-63 狙击',    cls:'marksman',pen:42, dmg:58, crit:32, aim:[480,780], reset:1000,start:93, end:80, range:60, sound:72, mob:-10,shots:1, burst:0,   mag:10 },
  SCARH:   { name:'SCAR-H',         cls:'marksman',pen:44, dmg:54, crit:30, aim:[380,640], reset:780, start:91, end:76, range:52, sound:70, mob:-8, shots:2, burst:160, mag:20 },
  /* 机枪 */
  RPK74:   { name:'RPK-74',         cls:'lmg',     pen:26, dmg:30, crit:10, aim:[260,420], reset:110, start:74, end:50, range:42, sound:66, mob:-8, shots:5, burst:70,  mag:45 },
  M249:    { name:'M249 SAW',       cls:'lmg',     pen:30, dmg:28, crit:10, aim:[280,440], reset:100, start:72, end:50, range:44, sound:68, mob:-9, shots:5, burst:68,  mag:100 },
  /* 霰弹 */
  M590:    { name:'M590 霰弹枪',    cls:'shotgun', pen:6,  dmg:70, crit:30, aim:[200,340], reset:820, start:96, end:20, range:9,  sound:68, mob:-4, shots:1, burst:0,   mag:6 },
  /* 掷弹兵 */
  M203:    { name:'M4 + M203',      cls:'grenadier',pen:32,dmg:38, crit:22, aim:[180,320], reset:320, start:88, end:62, range:40, sound:60, mob:-5, shots:3, burst:90,  mag:30, gl:'40mm' }
};

/* ---------- 兵种 ---------- */
DATA.CLASSES = {
  assault:   { name:'突击兵',   desc:'小队骨干，负责清房与正面突击',       primary:['M4','HK416','G36C','MK17','MP5SD','P90'], secondary:['G17','M1911'] },
  support:   { name:'支援兵',   desc:'机枪压制，把人钉死在掩体后',         primary:['RPK74','M249'],                           secondary:['G17'] },
  marksman:  { name:'精确射手', desc:'中远距离一枪一个，靠掩体稳定',       primary:['MK17LB','SVD','SCARH'],                   secondary:['G17'] },
  grenadier: { name:'掷弹兵',   desc:'40mm 榴弹，远距离掀翻掩体',          primary:['M203'],                                   secondary:['G17'] }
};

/* ---------- 敌人 ----------
   fov   : 视野锥角度
   sight : 视野半径 m
   react : 反应延迟 ms（普通 ~1500 / 老兵 ~900 / 精英 ~500）
   hp / armor / weapon
   ai    : 行为标签
   ------------------------------------------------------ */
DATA.ENEMIES = {
  rabble:    { name:'劣质新兵',   fov:90,  sight:11, react:1900, hp:100, armor:'none',    weapon:'AK47S', ai:['guard','flee'],      color:'#c9a86a', threat:1 },
  grunt:     { name:'叛乱分子',   fov:90,  sight:13, react:1600, hp:100, armor:'none',    weapon:'AK47S', ai:['guard','patrol'],    color:'#b8935a', threat:2 },
  pistoler:  { name:'手枪叛乱',   fov:90,  sight:10, react:900,  hp:100, armor:'none',    weapon:'G17',   ai:['guard'],             color:'#c0b088', threat:2 },
  veteran:   { name:'老兵叛乱',   fov:95,  sight:15, react:900,  hp:100, armor:'soft',    weapon:'AK47S', ai:['guard','blindfire','patrol'], color:'#8f6f42', threat:4 },
  machinegun:{ name:'机枪手',     fov:90,  sight:15, react:1200, hp:100, armor:'none',    weapon:'RPK74', ai:['guard','blindfire'], color:'#9a7d4a', threat:4 },
  sniper:    { name:'狙击叛乱',   fov:80,  sight:34, react:1100, hp:100, armor:'none',    weapon:'SVD',   ai:['guard','sniper'],    color:'#7d6a45', threat:5 },
  rocket:    { name:'火箭叛军',   fov:90,  sight:18, react:2200, hp:100, armor:'none',    weapon:'RPK74', ai:['guard','rocket'],    color:'#a0623a', threat:5 },
  advisor:   { name:'外国顾问',   fov:110, sight:16, react:600,  hp:100, armor:'plate3a', weapon:'SR3M',  ai:['guard','buff','flank'], color:'#b07a4a', threat:6 },
  executioner:{name:'行刑者',     fov:100, sight:14, react:800,  hp:100, armor:'none',    weapon:'AK47S', ai:['executioner'],       color:'#6b4a6b', threat:6 },
  bomber:    { name:'自杀袭击者', fov:100, sight:13, react:500,  hp:100, armor:'none',    weapon:null,    ai:['suicide'],           color:'#d05a3a', threat:6 },
  bomberS:   { name:'自杀袭击者(重)',fov:100,sight:13,react:500, hp:170, armor:'none',    weapon:null,    ai:['suicide'],           color:'#e07040', threat:7 },
  merc:      { name:'雇佣兵',     fov:100, sight:16, react:700,  hp:100, armor:'plate3',  weapon:'SR3M',  ai:['guard','flank'],     color:'#5f7a8f', threat:5 },
  qrf:       { name:'安保快反',   fov:95,  sight:16, react:900,  hp:100, armor:'plate3',  weapon:'AK47S', ai:['guard','patrol'],    color:'#6f8f9f', threat:5 },
  juggernaut:{ name:'重装兵',     fov:95,  sight:16, react:1000, hp:100, armor:'extprot', weapon:'RPK74', ai:['guard','ambush'],    color:'#4a4a5a', threat:7 },
  ssi:       { name:'SSI 特战',   fov:110, sight:18, react:450,  hp:100, armor:'plate4',  weapon:'P90',   ai:['guard','flank','suppress'], color:'#3f5f7f', threat:9 }
};

/* ---------- 平民 / 目标 ---------- */
DATA.CIV = { name:'平民', hp:100, sight:10, fov:120, speedFlee:2.6 };

/* ---------- 噪音半径表（DK2 实测） ---------- */
DATA.NOISE = {
  openDoor:   2.5,
  kickDoor:   7,
  breakGlass: 7,
  shotgunBreach: 25,
  breachingCharge: 40,
  crowbar:    12,
  boltCutter: 4.5,
  hammer:     12,
  lockpick:   1.5,
  jump:       5.5,
  run:        4,
  death:      4,
  arrest:     3,
  defuse:     1.5,
  smokeBreak: 10,
  flashBreak: 25,
  fragBreak:  30,
  shot:       null   // 用武器 sound 值
};

/* ---------- 破门工具 ---------- */
DATA.BREACH = {
  hand:   { name:'手动开门',   noise:DATA.NOISE.openDoor,   time:800,  stun:0,    access:['door'] },
  kick:   { name:'踹门',       noise:DATA.NOISE.kickDoor,   time:600,  stun:2200, access:['door'] },
  crowbar:{ name:'撬棍',       noise:DATA.NOISE.crowbar,    time:2200, stun:0,    access:['door','locked'] },
  bolt:   { name:'断线钳',     noise:DATA.NOISE.boltCutter, time:2600, stun:0,    access:['locked','grating'] },
  shotgun:{ name:'破门霰弹',   noise:DATA.NOISE.shotgunBreach,time:450,stun:2600, access:['door','locked','window'] },
  charge: { name:'破门炸药',   noise:DATA.NOISE.breachingCharge,time:1800,stun:3400,access:['door','locked','wall'] }
};

/* ---------- 任务类型 ---------- */
DATA.MISSION_TYPES = {
  clear:    { name:'清剿',     icon:'✕', goal:'消灭/逮捕全部敌人' },
  hostage:  { name:'人质救援', icon:'☂', goal:'救出所有人质' },
  execute:  { name:'阻止处决', icon:'⏱', goal:'在处决倒计时前突入' },
  bomb:     { name:'拆除炸弹', icon:'◉', goal:'拆除炸弹并清场' },
  hvt:      { name:'抓捕',     icon:'☆', goal:'逮捕高价值目标' },
  vip:      { name:'护送要员', icon:'◆', goal:'护送要员至撤离点' }
};

/* ---------- 星星评分 ---------- */
DATA.STARS = {
  // 三星条件：时间达标 + 无队员死亡 + 无平民死亡
  tiers: [
    { min: 0, label: '失败' },
    { min: 1, label: '★' },
    { min: 2, label: '★★' },
    { min: 3, label: '★★★' }
  ]
};

DATA.DIFFICULTY = {
  normal: { name:'普通', sightMul:1.0,  reactMul:1.0,  accMul:1.0, aimMul:1.0,  dmgCapMul:1.0 },
  hard:   { name:'困难', sightMul:1.12, reactMul:0.8,  accMul:1.05, aimMul:0.88, dmgCapMul:1.1 },
  expert: { name:'专家', sightMul:1.25, reactMul:0.55, accMul:1.12, aimMul:0.78, dmgCapMul:1.25 }
};

/* ---------- 提示 ---------- */
DATA.TIPS = [
  '视野锥之外的敌人开枪时，队员必须先转身才能瞄准 —— 机动性决定转身速度。',
  '踹门比手动开门快约 35%，但噪音半径 7m，会惊动隔壁房间。',
  '躲在掩体后只对掩体方向的射击提供减伤，侧面和背后不受保护。',
  '蹲下时无法射击，但躲在低掩体后几乎不会被命中，敌人打空弹匣会自动起立反击。',
  'Shift + 右键 = 持续注视着某点移动，切角（pie-cut）就靠它。',
  'Ctrl + 右键 = 强制朝向，用来架住走廊。',
  '闪光弹爆炸噪音 25m，既是控场也是侦察 —— 敌人惨叫就说明房间里有人。',
  '破门炸药引爆噪音 40m，绝不要在任务目标（人质/平民）附近使用。',
  '自杀袭击者被爆炸击杀时也会引爆，可以连锁清场，也可能炸死自己人。',
  '行刑者看到同伴尸体、听到狙击枪声或看到门被打开，就会提前处决人质。',
  '消音武器的开火噪音只有 8m，用手枪清理单个目标几乎无声。',
  '烟雾弹的爆炸噪音仅 10m，是唯一能用来无声骗开锁门的工具。',
  '永远检查厕所和储物间 —— RPG 常常就蹲在里面。',
  '关掉配电箱能让整栋楼停电，但关闸的噪音很大，开打前再关。',
  '逮捕敌人同样算完成任务，而且能给更多经验。'
];

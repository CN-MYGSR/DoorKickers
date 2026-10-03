/* 验证：修复后的穿甲矩阵 + 双向 TTK */
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.join(__dirname,'..');
const files=['data.js','doctrine.js','mapgen.js','engine.js','ai.js','player.js','sim.js','mission.js','render.js'];
const sandbox={console,Math,JSON,Object,Array,Set,Map,Date,Number,String,Boolean,Error,parseInt,parseFloat,isNaN,isFinite,
localStorage:{getItem:()=>null,setItem:()=>{}},requestAnimationFrame:()=>{},
document:{getElementById:()=>null,createElement:()=>({style:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},appendChild(){},addEventListener(){},querySelectorAll:()=>[],dataset:{}}),querySelectorAll:()=>[],addEventListener:()=>{}},
window:{addEventListener:()=>{},devicePixelRatio:1}};
sandbox.window=sandbox;sandbox.globalThis=sandbox;
const ctx=vm.createContext(sandbox);
files.forEach(f=>vm.runInContext(fs.readFileSync(path.join(ROOT,'js',f),'utf8'),ctx,{filename:f}));
const {SIM,MAPGEN,DATA,ENG,EngMove}=sandbox;

function effDmg(w,lvl){ let d=w.dmg; if(w.pen<=lvl){const r=w.pen/Math.max(1,lvl);d*=0.18+r*0.22;} return d; }

console.log('=== 修复后：敌人武器 vs 玩家各护甲 ===');
const armors=['none','soft','plate3a','plate3','extprot','plate4'];
console.log('武器'.padEnd(10)+armors.map(a=>a.padStart(9)).join(''));
['AK47S','RPK74','SVD','SR3M','P90','G17'].forEach(wk=>{
  const w=DATA.WEAPONS[wk];
  let row=wk.padEnd(10);
  armors.forEach(a=>{
    const lvl=DATA.ARMOR[a].level;
    const d=effDmg(w,lvl);
    const shots=Math.ceil(100/d);
    row+=(shots+'发').padStart(9);
  });
  console.log(row);
});

console.log('\n=== 玩家武器 vs 各敌人护甲（需几发）===');
Object.entries(DATA.ENEMIES).forEach(([k,e])=>{
  const lvl=(DATA.ARMOR[e.armor]||DATA.ARMOR.none).level;
  const m4=effDmg(DATA.WEAPONS.M4,lvl);
  const mk17=effDmg(DATA.WEAPONS.MK17LB,lvl);
  console.log(`  ${k.padEnd(12)} armor${String(lvl).padStart(2)}  M4:${Math.ceil(e.hp/m4)}发  Mk17:${Math.ceil(e.hp/mk17)}发`);
});

console.log('\n=== 关键对照（应成立）===');
const p3=DATA.ARMOR.plate3.level, p4=DATA.ARMOR.plate4.level;
console.log(`  AK(pen${DATA.WEAPONS.AK47S.pen}) 被 III级插板(${p3})挡: ${DATA.WEAPONS.AK47S.pen<=p3?'✅':'❌'}`);
console.log(`  SVD(pen${DATA.WEAPONS.SVD.pen}) 穿透 III级(${p3})但被 IV级(${p4})挡: ${DATA.WEAPONS.SVD.pen>p3&&DATA.WEAPONS.SVD.pen<=p4?'✅':'❌'}`);
console.log(`  Mk17(pen${DATA.WEAPONS.MK17LB.pen}) 被 IV级(${p4})挡: ${DATA.WEAPONS.MK17LB.pen<=p4?'✅':'❌'}`);
console.log(`  M4(pen${DATA.WEAPONS.M4.pen}) 穿透 III级但被 IV级挡: ${DATA.WEAPONS.M4.pen>p3&&DATA.WEAPONS.M4.pen<=p4?'✅':'❌'}`);

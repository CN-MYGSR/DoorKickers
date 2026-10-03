/* 诊断23：真实加载 index.html 的脚本顺序 + 调用 MAIN.init / IN.init，验证启动路径无错
   用最小 DOM 桩，但覆盖面比之前的 vm 测试完整得多（包含 ui.js / main.js） */
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.join(__dirname,'..');

// 从 index.html 里按顺序解析 <script src>
const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const scriptRe=/<script[^>]*src=["']([^"']+)["'][^>]*>/g;
const scripts=[];
let m;
while((m=scriptRe.exec(html))) scripts.push(m[1].replace(/^\.\//,''));
console.log('index.html 中的脚本加载顺序:');
scripts.forEach((s,i)=>console.log(`  ${i+1}. ${s}`));

// ---- 构造一个够用的 DOM 桩 ----
const listeners={};
function makeEl(tag,id){
  const el={
    tagName:(tag||'div').toUpperCase(), id:id||'', _children:[], style:{}, dataset:{},
    innerHTML:'', textContent:'', value:'', checked:false,
    classList:{ _s:new Set(),
      add(...c){c.forEach(x=>this._s.add(x))}, remove(...c){c.forEach(x=>this._s.delete(x))},
      toggle(c,f){ if(f===undefined){this._s.has(c)?this._s.delete(c):this._s.add(c)} else {f?this._s.add(c):this._s.delete(c)} },
      contains(c){return this._s.has(c)} },
    appendChild(c){this._children.push(c);return c},
    removeChild(c){const i=this._children.indexOf(c);if(i>=0)this._children.splice(i,1);return c},
    querySelector(sel){return makeEl('div')}, querySelectorAll(){return []},
    addEventListener(ev,fn){ (listeners[ev]=listeners[ev]||[]).push(fn) },
    removeEventListener(){}, focus(){}, blur(){}, click(){}, getBoundingClientRect(){return {left:0,top:0,width:800,height:600,right:800,bottom:600}},
    getContext(){ return makeCtx() }, setAttribute(){}, getAttribute(){return null}, contains(){return false}
  };
  return el;
}
function makeCtx(){
  const noop=()=>{};
  const ctx={ canvas:{width:800,height:600,style:{}},
    save:noop,restore:noop,translate:noop,rotate:noop,scale:noop,setTransform:noop,transform:noop,
    beginPath:noop,closePath:noop,moveTo:noop,lineTo:noop,arc:noop,arcTo:noop,rect:noop,roundRect:noop,
    quadraticCurveTo:noop,bezierCurveTo:noop,ellipse:noop,
    fill:noop,stroke:noop,clip:noop,
    fillRect:noop,strokeRect:noop,clearRect:noop,
    fillText:noop,strokeText:noop,measureText:()=>({width:10}),
    createLinearGradient:()=>({addColorStop:noop}),
    createRadialGradient:()=>({addColorStop:noop}),
    createPattern:()=>null, drawImage:noop, putImageData:noop,
    getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h}),
    createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h}),
    setLineDash:noop, getLineDash:()=>[], globalAlpha:1, globalCompositeOperation:'source-over',
    fillStyle:'#000', strokeStyle:'#000', lineWidth:1, font:'10px sans-serif',
    textAlign:'left', textBaseline:'top', shadowBlur:0, shadowColor:'#000',
    imageSmoothingEnabled:true, filter:'none', lineCap:'butt', lineJoin:'miter', miterLimit:10
  };
  return ctx;
}

const elCache={};
const doc={
  getElementById(id){ if(!elCache[id]) elCache[id]=makeEl('div',id); return elCache[id]; },
  createElement(tag){ return makeEl(tag) },
  querySelector(sel){ return makeEl('div') },
  querySelectorAll(){ return [] },
  addEventListener(ev,fn){ (listeners[ev]=listeners[ev]||[]).push(fn) },
  body:makeEl('body'), documentElement:makeEl('html'),
  hidden:false, visibilityState:'visible', fonts:{ready:Promise.resolve()}
};

const sandbox={
  console,Math,JSON,Object,Array,Set,Map,Date,Number,String,Boolean,Error,TypeError,RangeError,
  parseInt,parseFloat,isNaN,isFinite,Promise,Symbol,WeakMap,WeakSet,Uint8ClampedArray,
  setTimeout:(fn)=>{ try{fn()}catch(e){ console.log('setTimeout 内异常:',e.message); } return 0 },
  clearTimeout:()=>{}, setInterval:()=>0, clearInterval:()=>{},
  requestAnimationFrame:(fn)=>{ return 0 },   // 不真的循环，避免死循环
  cancelAnimationFrame:()=>{},
  localStorage:{ _d:{}, getItem(k){return this._d[k]||null}, setItem(k,v){this._d[k]=String(v)}, removeItem(k){delete this._d[k]} },
  document:doc, navigator:{userAgent:'node-test'}, location:{href:'file:///index.html',reload(){}},
  performance:{now:()=>Date.now()}, innerWidth:1280, innerHeight:800
};
sandbox.window=sandbox; sandbox.globalThis=sandbox; sandbox.self=sandbox;
sandbox.addEventListener=(ev,fn)=>{ (listeners[ev]=listeners[ev]||[]).push(fn) };

const ctx=vm.createContext(sandbox);

let failed=false;
// 按 index.html 的顺序加载
for(const s of scripts){
  const fp=path.join(ROOT,s);
  if(!fs.existsSync(fp)){ console.log(`  ❌ 脚本不存在: ${s}`); failed=true; continue; }
  try{
    vm.runInContext(fs.readFileSync(fp,'utf8'),ctx,{filename:s});
    console.log(`  ✔ 加载 ${s}`);
  }catch(e){
    console.log(`  ❌ 加载失败 ${s}: ${e.message}`);
    console.log('     '+String(e.stack).split('\n')[1]);
    failed=true;
  }
}

console.log('\n=== 模拟浏览器启动序列 ===');
try{
  // 关键：模拟浏览器触发 DOMContentLoaded（main.js 就是靠这个启动的）
  const domReady = listeners['DOMContentLoaded'] || [];
  if (domReady.length) {
    domReady.forEach(fn => fn());
    console.log(`  ✔ 触发 DOMContentLoaded（${domReady.length} 个回调）—— 应用正式启动路径执行成功`);
  } else {
    console.log('  ⚠ 没有 DOMContentLoaded 回调');
  }

  // 注意：UI / IN / REN / MAIN 都用 const 声明，是脚本级词法作用域，
  // 不会挂到 sandbox 全局对象上，所以不能用 sandbox.UI 访问。
  // 这里改用"重新 eval 一次拿引用"的方式验证它们确实存在。
  const probe = vm.runInContext(
    `(function(){ try{
        return {
          hasUI: typeof UI !== 'undefined' && !!UI.toMenu,
          hasIN: typeof IN !== 'undefined' && !!IN.init,
          hasREN: typeof REN !== 'undefined' && !!REN.draw,
          hasMAIN: typeof MAIN !== 'undefined' && !!MAIN.init,
          hasSIM: typeof SIM !== 'undefined' && SIM.MISSIONS.length
        };
      }catch(e){ return {err:e.message}; } })()`, ctx);
  console.log('  模块存在性:', JSON.stringify(probe));

  // 用 eval 在同一个词法环境里跑一关 + 渲染一帧
  const frameRes = vm.runInContext(
    `(function(){
       try{
         const M = SIM.MISSIONS[0];
         const lo = [];
         for (let i=0;i<M.squadSize;i++) lo.push({name:'T'+(i+1),cls:'assault',primary:'M4',secondary:'G17',
           armor:'plate3',nvg:true,gadgets:['frag'],breachTools:['hand','kick'],
           skill:{marksmanship:7,assault:7,field:7,mobility:7},goCode:'A'});
         const sim = SIM.startMission(M, lo);
         const units = sim.units.length;
         // REN.resize 需要一个 canvas 对象（浏览器里由 MAIN.init 传入 UI.el('game')）
         REN.resize(UI.el('game'));
         REN.draw(sim);
         UI.syncHud(sim);
         // 推进 300 帧（5 秒）
         for(let f=0;f<300;f++) SIM.step(1/60);
         REN.draw(sim);
         // 再模拟：选中队员 + 下一条路径 + 渲染
         const t = sim.troopers[0];
         if (t) { t.path = [{x:t.x+2,y:t.y+2}]; REN.draw(sim); }
         return {ok:true, units, enemies:sim.units.filter(u=>u.alive&&u.side==='hostile').length, t:sim.time.toFixed(1)};
       }catch(e){ return {ok:false, err:e.message, stack:String(e.stack).split('\\n').slice(1,4)}; }
     })()`, ctx);
  if (frameRes.ok) {
    console.log(`  ✔ 开一关 → 渲染 → 推进 5 秒 → 再渲染 全部无异常（单位${frameRes.units} 剩余敌${frameRes.enemies} t=${frameRes.t}s）`);
  } else {
    console.log(`  ❌ 关卡运行异常: ${frameRes.err}`);
    console.log('     '+(frameRes.stack||[]).join('\n     '));
    failed=true;
  }
}catch(e){
  console.log(`  ❌ 启动序列异常: ${e.message}`);
  console.log('     '+String(e.stack).split('\n').slice(1,4).join('\n     '));
  failed=true;
}

console.log('\n'+(failed?'❌ 存在失败项':'✅ 启动路径与渲染路径全部通过'));

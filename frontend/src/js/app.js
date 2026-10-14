/* EkCode browser client. Data and decisions live in Django; this file draws the UI and calls the REST API.
   Build: npm run build:js  (source: frontend/src/js/app.js, output: static/js/app.js) */
(() => {
'use strict';
/* ================= helpers ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const fmt = n => Math.round(n).toLocaleString('en-IN');
function inr(v){ v = Math.round(v); if (v >= 1e7) return '₹' + (v / 1e7).toFixed(2) + ' crore'; if (v >= 1e5) return '₹' + (v / 1e5).toFixed(2) + ' lakh'; return '₹' + fmt(v); }
const uniq = a => [...new Set(a)];
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ================= reference data (defaults; the server's meta replaces them after sign-in) ================= */
let CPSES = [
  {id:'REF', short:'Refinery', name:'Refinery CPSE', city:'Chennai', erp:'SAP ECC 6.0', color:'#FF7A45'},
  {id:'STL', short:'Steel', name:'Steel CPSE', city:'Bhilai', erp:'SAP S/4HANA', color:'#4EA8FF'},
  {id:'PWR', short:'Power', name:'Power CPSE', city:'Ramagundam', erp:'SAP ECC 6.0', color:'#2FD6C3'},
  {id:'MIN', short:'Mining', name:'Mining CPSE', city:'Dhanbad', erp:'Oracle EBS', color:'#C08BFF'},
];
let UPL = {id:'UPL', short:'Upload', name:'Your upload', city:'CSV file', erp:'Any ERP extract', color:'#E8ECF3'};
const cpseById = id => CPSES.find(c => c.id === id) || UPL;
let CLASSES = {
  VGT:{name:'Gate valves', noun:'VALVE, GATE', group:'valve', type:'GATE', unspsc:'40141600', unspscName:'Valves', nat:'VLV-GAT', mtart:'ERSA'},
  VGL:{name:'Globe valves', noun:'VALVE, GLOBE', group:'valve', type:'GLOBE', unspsc:'40141600', unspscName:'Valves', nat:'VLV-GLB', mtart:'ERSA'},
  VBL:{name:'Ball valves', noun:'VALVE, BALL', group:'valve', type:'BALL', unspsc:'40141600', unspscName:'Valves', nat:'VLV-BAL', mtart:'ERSA'},
  PMP:{name:'Centrifugal pumps', noun:'PUMP, CENTRIFUGAL', group:'pump', unspsc:'40151500', unspscName:'Pumps', nat:'PMP-CEN', mtart:'ERSA'},
  BRG:{name:'Bearings', noun:'BEARING', group:'bearing', unspsc:'31171500', unspscName:'Bearings', nat:'BRG-ROL', mtart:'ERSA'},
  BLT:{name:'Hex bolts', noun:'BOLT, HEX HEAD', group:'bolt', unspsc:'31161600', unspscName:'Bolts', nat:'FST-BLT', mtart:'HAWA'},
  NUT:{name:'Hex nuts', noun:'NUT, HEX', group:'nut', unspsc:'31161700', unspscName:'Nuts', nat:'FST-NUT', mtart:'HAWA'},
  CBL:{name:'Power cables', noun:'CABLE, POWER', group:'cable', unspsc:'26121600', unspscName:'Electrical cable and accessories', nat:'CBL-PWR', mtart:'HAWA'},
};
let CLS_ORDER = Object.keys(CLASSES);
let SCHEMA = {
  valve:[{k:'size',label:'Size',w:3,key:1},{k:'rating',label:'Pressure class',w:3,key:1},{k:'end',label:'End connection',w:2,key:1},{k:'material',label:'Body material',w:2},{k:'standard',label:'Standard',w:1,soft:1}],
  pump:[{k:'flow',label:'Flow',w:3,key:1},{k:'head',label:'Head',w:3,key:1},{k:'power',label:'Motor',w:2},{k:'material',label:'Casing',w:2},{k:'standard',label:'Standard',w:1,soft:1}],
  bearing:[{k:'designation',label:'Designation',w:3,key:1},{k:'seal',label:'Seal',w:2,key:1},{k:'clearance',label:'Clearance',w:1},{k:'brand',label:'Make',w:0,brand:1}],
  bolt:[{k:'thread',label:'Thread',w:3,key:1},{k:'length',label:'Length',w:3,key:1},{k:'grade',label:'Grade',w:2,key:1},{k:'finish',label:'Finish',w:2},{k:'standard',label:'Standard',w:1,soft:1}],
  nut:[{k:'thread',label:'Thread',w:3,key:1},{k:'grade',label:'Grade',w:2,key:1},{k:'finish',label:'Finish',w:2}],
  cable:[{k:'cores',label:'Cores',w:3,key:1},{k:'csa',label:'Size',w:3,key:1},{k:'conductor',label:'Conductor',w:2,key:1},{k:'insulation',label:'Insulation',w:2},{k:'armour',label:'Armour',w:1},{k:'voltage',label:'Voltage',w:2,key:1}],
};
let EQUIV = [['A105','A216 WCB'],['SS316','CF8M']];
const isEquiv = (x, y) => EQUIV.some(([p, q]) => (x === p && y === q) || (x === q && y === p));
const INCH = {15:'1/2',20:'3/4',25:'1',40:'1-1/2',50:'2',80:'3',100:'4',150:'6',200:'8'};
const MATN = {A105:'ASTM A105','A216 WCB':'ASTM A216 WCB',SS316:'SS 316',CF8M:'ASTM A351 CF8M',CS:'CARBON STEEL',CI:'CAST IRON'};
const ENDN = {RF:'FLANGED RF',BW:'BUTT WELD',SW:'SOCKET WELD',NPT:'THREADED NPT'};
const FINN = {HDG:'HOT DIP GALVANISED',ZINC:'ZINC PLATED',PLAIN:'PLAIN'};
const fmtVal = (k, v) => {
  if (v == null) return '—';
  if (k === 'size') return `DN${v} (${INCH[v] || '?'} in)`;
  if (k === 'rating') return `Class ${v}`;
  if (k === 'material') return MATN[v] || v;
  if (k === 'end') return ENDN[v] || v;
  if (k === 'flow') return `${v} m³/h`;
  if (k === 'head') return `${v} m`;
  if (k === 'power') return `${v} kW`;
  if (k === 'length') return `${v} mm`;
  if (k === 'thread') return `M${v}`;
  if (k === 'csa') return `${v} sq mm`;
  if (k === 'cores') return `${v} core`;
  if (k === 'voltage') return `${v} kV`;
  if (k === 'finish') return FINN[v] || v;
  if (k === 'conductor') return v === 'AL' ? 'Aluminium' : v === 'CU' ? 'Copper' : v;
  return String(v);
};
const TYPE_LABEL = {duplicate:'Exact duplicate', near:'Near-duplicate', equivalent:'Equivalent', single:'No duplicate', unclassified:'Unrecognised', different:'Look-alike'};
const STATUS_LABEL = {proposed:'To approve', approved:'Approved, to verify', verified:'Verified, code active', auto:'New code', hold:'Needs a person'};
// Demo accounts shown on the sign-in card and in the account switcher (the server holds the real users)
const USERS = {
  maker:{name:'Priya Menon', title:'Maker, data steward', init:'PM', color:'#FFB547', email:'priya.menon@cpcl.example'},
  checker:{name:'R. Iyer', title:'Checker, materials manager', init:'RI', color:'#9BE36B', email:'r.iyer@cpcl.example'},
  auditor:{name:'Anita Rao', title:'Auditor, read-only', init:'AR', color:'#7CC4FF', email:'anita.rao@audit.example'},
};

/* ================= state mirrored from the server ================= */
let store = {me:null, facts:{records:0, materials:0, precision:0}, harmonized:false, role:'maker', status:{}, std:{}, requests:[], prevented:0, confirmed:{}, audit:[], uploads:0};
let ENG = {recs:[], byId:{}, clusters:[], byRec:{}, lookalikes:[], holds:[], acc:{precision:0, recall:0}, compared:0, blocks:0, version:-1, changed:false};
const S = {view:'login', sel:null, look:null, req:null, qf:'approve', hidden:{}, catQ:'', catCls:'', catSt:'', mapCpse:'ALL', mapSel:null, editing:false, chain:null,
  chk:{desc:'', cpse:'REF', uom:'EA'}, chkAn:null, reqAn:{}, disc:5, findIdx:0, busy:false};
const stOf = c => { const s = store.status[c.id]; if (s) return s.s; if (c.hold) return 'hold'; return c.members.length > 1 ? 'proposed' : 'auto'; };
const stdOf = c => store.std[c.id] || c.std;
const clusterById = id => ENG.clusters.find(c => c.id === id);

function hydrate(st){
  if (st.facts) store.facts = st.facts;
  store.me = st.me || null;
  if (!st.me) return;
  const m = st.meta;
  CPSES = m.companies.filter(c => c.id !== 'UPL'); UPL = m.companies.find(c => c.id === 'UPL') || UPL;
  CLASSES = m.classes; CLS_ORDER = m.clsOrder; SCHEMA = m.schema; EQUIV = m.equiv;
  Object.assign(store, {harmonized:st.harmonized, role:st.me.role, status:st.decisions, std:st.std, requests:st.requests, prevented:st.prevented,
    confirmed:Object.fromEntries(st.confirmed.map(k => [k, true])), audit:st.audit, uploads:st.uploads});
  const prev = ENG.version, byId = {};
  st.records.forEach(r => { r.cls = r.cls || null; byId[r.id] = r; });
  const clusters = st.materials.map(x => ({...x, members:x.members.map(id => byId[id]).filter(Boolean)}));
  const byC = Object.fromEntries(clusters.map(c => [c.id, c])), byRec = {};
  clusters.forEach(c => c.members.forEach(r => { byRec[r.id] = c; }));
  clusters.forEach(c => { if (c.hold) c.hold = {rec:byId[c.hold.rec], cid:c.id, options:c.hold.options.map(id => byC[id]).filter(Boolean), missing:c.hold.missing}; });
  ENG = {recs:st.records, byId, clusters, byRec, holds:clusters.filter(c => c.hold).map(c => c.hold),
    lookalikes:st.lookalikes.map(l => ({...l, ra:byId[l.a], rb:byId[l.b]})).filter(l => l.ra && l.rb),
    acc:st.acc, compared:st.compared, blocks:st.blocks, version:st.version, changed:prev !== st.version};
}

/* ================= REST API ================= */
function csrf(){ const m = document.cookie.match(/(?:^|;\s*)ekcode_csrftoken=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; }
async function api(path, opts = {}){
  const init = {method:opts.method || 'GET', credentials:'same-origin', headers:{'X-CSRFToken':csrf(), Accept:'application/json'}};
  if (opts.form) init.body = opts.form;
  else if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  let res;
  try { res = await fetch('/api/' + path, init); }
  catch (e) { const err = new Error('Cannot reach the EkCode server. Check that it is running.'); err.status = 0; throw err; }
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    const err = new Error((data && (data.error || data.detail)) || `The server answered ${res.status}.`);
    err.status = res.status; err.data = data; throw err;
  }
  return data;
}
function sessionGone(e){ return (e.status === 401 || e.status === 403) && /credentials|authenticat/i.test(e.message); }
// Run an action: apply the returned state, show its message, redraw.
async function call(path, body, opts = {}){
  if (S.busy && !opts.force) return null;
  S.busy = true;
  try {
    const d = await api(path, {method:opts.method || 'POST', body});
    if (d && d.state) hydrate(d.state);
    if (d && d.toast && !opts.quiet) toast(d.toast);
    return d;
  } catch (e) {
    if (sessionGone(e)) { toast('Your session ended. Sign in again.'); store.me = null; showLogin(); return null; }
    toast(e.message); return null;
  } finally { S.busy = false; }
}
function applyState(){ if (ENG.changed) { Scene.build(ENG, store.harmonized); ENG.changed = false; } renderAll(); }
function download(url){ const a = document.createElement('a'); a.href = url; a.rel = 'noopener'; a.setAttribute('download', ''); document.body.appendChild(a); a.click(); a.remove(); toast('Download started.'); }
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 3400); }

/* ================= 3D particle scene ================= */
function hashInt(s){ let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const Scene = (() => {
  let ok = false, renderer, scene, camera, W = 1, H = 1;
  let recPts, recGeo, corePts, coreGeo, lineSeg, lineGeo, lineMat;
  let ids = [], rawPos, tgtPos, fromPos, curPos, delays, baseSize, sizes, alphas, colors;
  let cores = [], coreTgtAlpha = 0, coreAlphaNow = 0, lineAlphaNow = 0, lineTgtAlpha = 0;
  let anim = null, harm = false, focusCid = null, shift = 0, hover = -1, sectors = {};
  const cam = {theta:.72, phi:1.02, dist:138, tx:0, ty:-7, tz:0}, goal = {...cam};
  let dragging = false, lastX = 0, lastY = 0, moved = 0;
  const labelEls = {};
  const ray = window.THREE ? new THREE.Raycaster() : null, mouse = window.THREE ? new THREE.Vector2() : null;
  const hexRGB = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const coreColor = st => hexRGB(st === 'verified' ? '#FFC34D' : st === 'approved' ? '#FFB547' : '#FFE9BF');

  function mat(){
    return new THREE.ShaderMaterial({
      uniforms:{uPR:{value:Math.min(2, window.devicePixelRatio || 1)}},
      vertexShader:'attribute float size; attribute float alpha; attribute vec3 aColor; varying vec3 vC; varying float vA; uniform float uPR;' +
        'void main(){ vC = aColor; vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * uPR * (300.0 / -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader:'varying vec3 vC; varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard;' +
        ' float k = smoothstep(0.5, 0.0, d); float core = smoothstep(0.16, 0.0, d); gl_FragColor = vec4(vC * (0.5 + 0.9 * k) + vec3(core * 0.55), pow(k, 1.6) * vA); }',
      transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
    });
  }
  function init(){
    const cv = $('#gl');
    try {
      if (!window.THREE) throw new Error('no three');
      renderer = new THREE.WebGLRenderer({canvas:cv, antialias:true, alpha:false});
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setClearColor(0x06101C, 1);
    } catch (e) { $('#noscene').style.display = 'grid'; return; }
    ok = true;
    scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x06101C, .0042);
    camera = new THREE.PerspectiveCamera(48, 1, .5, 900);
    // drafting-table floor: grid, class ring and spokes
    const grid = new THREE.GridHelper(300, 60, 0x1d3a5c, 0x10243a); grid.position.y = -18;
    grid.material.transparent = true; grid.material.opacity = .45; scene.add(grid);
    const ringPts = []; for (let i = 0; i <= 128; i++) { const a = i / 128 * Math.PI * 2; ringPts.push(new THREE.Vector3(Math.cos(a) * 40, -17.8, Math.sin(a) * 40)); }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), new THREE.LineBasicMaterial({color:0x2b5a8a, transparent:true, opacity:.5})));
    const spokes = [];
    CLS_ORDER.forEach((c, k) => { const a = (k / CLS_ORDER.length) * Math.PI * 2 + Math.PI / 8 + Math.PI / CLS_ORDER.length; spokes.push(new THREE.Vector3(Math.cos(a) * 22, -17.8, Math.sin(a) * 22), new THREE.Vector3(Math.cos(a) * 68, -17.8, Math.sin(a) * 68)); });
    scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(spokes), new THREE.LineBasicMaterial({color:0x1f4670, transparent:true, opacity:.45})));
    // ambient dust
    const DN = 1400, dp = new Float32Array(DN * 3), dc = new Float32Array(DN * 3), ds = new Float32Array(DN), da = new Float32Array(DN), rd = mulberry32(11);
    for (let i = 0; i < DN; i++) {
      const r = 60 + rd() * 240, th = rd() * Math.PI * 2, ph = Math.acos(2 * rd() - 1);
      dp.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * .55, r * Math.sin(ph) * Math.sin(th)], i * 3);
      dc.set(hexRGB(rd() < .15 ? '#3f6f9f' : '#274a70'), i * 3); ds[i] = .6 + rd() * 1.2; da[i] = .25 + rd() * .35;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dp, 3)); dg.setAttribute('aColor', new THREE.BufferAttribute(dc, 3));
    dg.setAttribute('size', new THREE.BufferAttribute(ds, 1)); dg.setAttribute('alpha', new THREE.BufferAttribute(da, 1));
    scene.add(new THREE.Points(dg, mat()));
    // labels
    const lab = $('#labels');
    CLS_ORDER.forEach(c => { const el = document.createElement('div'); el.className = 'clabel'; lab.appendChild(el); labelEls[c] = el; });
    // input
    cv.addEventListener('pointerdown', e => { dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => {
      if (dragging) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY; moved += Math.abs(dx) + Math.abs(dy); lastX = e.clientX; lastY = e.clientY;
        goal.theta -= dx * .005; goal.phi = Math.max(.35, Math.min(1.45, goal.phi - dy * .004)); hideTip(); return;
      }
      pickAt(e.clientX, e.clientY);
    });
    cv.addEventListener('pointerup', e => { dragging = false; if (moved < 6 && hover >= 0 && !document.body.classList.contains('auth')) App.openRecord(ids[hover]); });
    cv.addEventListener('pointerleave', () => { dragging = false; hover = -1; hideTip(); });
    cv.addEventListener('wheel', e => { e.preventDefault(); goal.dist = Math.max(40, Math.min(240, goal.dist * (1 + Math.sign(e.deltaY) * .08))); }, {passive:false});
    addEventListener('resize', resize); resize();
    requestAnimationFrame(frame);
  }
  function resize(){
    if (!ok) return; W = innerWidth; H = innerHeight;
    renderer.setSize(W, H, false); camera.aspect = W / H; applyShift(); camera.updateProjectionMatrix();
  }
  function applyShift(){ if (!ok) return; if (shift) camera.setViewOffset(W, H, -shift, 0, W, H); else camera.clearViewOffset(); }

  function layout(eng){
    const tgt = {}, coreList = []; sectors = {};
    CLS_ORDER.forEach((cls, k) => {
      const th = (k / CLS_ORDER.length) * Math.PI * 2 + Math.PI / 8, cx = Math.cos(th) * 40, cz = Math.sin(th) * 40;
      const cl = eng.clusters.filter(c => c.cls === cls).sort((a, b) => b.members.length - a.members.length || a.std.localeCompare(b.std));
      let maxR = 0;
      cl.forEach((c, j) => {
        const rr = 3.05 * Math.sqrt(j + .5), aa = j * 2.39996, h = hashInt(c.id);
        maxR = Math.max(maxR, rr);
        const px = cx + Math.cos(aa) * rr, pz = cz + Math.sin(aa) * rr, py = ((h % 100) / 100 - .5) * 6;
        if (c.members.length > 1) coreList.push({cid:c.id, p:[px, py, pz]});
        c.members.forEach((m, i) => {
          if (c.members.length === 1) { tgt[m.id] = [px, py, pz]; return; }
          const ang = (i / c.members.length) * Math.PI * 2 + (h % 7), rad = 1.1 + c.members.length * .17;
          tgt[m.id] = [px + Math.cos(ang) * rad, py + (i % 2 ? .5 : -.5), pz + Math.sin(ang) * rad];
        });
      });
      sectors[cls] = {p:[Math.cos(th) * (40 + maxR + 6), 8, Math.sin(th) * (40 + maxR + 6)], n:cl.length, recs:eng.recs.filter(r => r.cls === cls).length};
    });
    eng.clusters.filter(c => !c.cls).forEach((c, j) => { const rr = 2.6 * Math.sqrt(j + .5), aa = j * 2.39996; tgt[c.members[0].id] = [Math.cos(aa) * rr, 0, Math.sin(aa) * rr]; });
    return {tgt, coreList};
  }
  function rawOf(id){
    const r = mulberry32(hashInt(id)); const rad = 12 + Math.sqrt(r()) * 58, th = r() * Math.PI * 2;
    return [Math.cos(th) * rad, (r() - .5) * 26 * (1 - rad / 110), Math.sin(th) * rad];
  }
  function build(eng, harmonized){
    if (!ok) return;
    const prev = {}; if (curPos) ids.forEach((id, i) => { prev[id] = [curPos[i * 3], curPos[i * 3 + 1], curPos[i * 3 + 2]]; });
    const had = ids.length > 0;
    ids = eng.recs.map(r => r.id); const N = ids.length;
    const L = layout(eng);
    rawPos = new Float32Array(N * 3); tgtPos = new Float32Array(N * 3); curPos = new Float32Array(N * 3); fromPos = new Float32Array(N * 3);
    colors = new Float32Array(N * 3); sizes = new Float32Array(N); baseSize = new Float32Array(N); alphas = new Float32Array(N); delays = new Float32Array(N);
    eng.recs.forEach((r, i) => {
      const rp = rawOf(r.id), tp = L.tgt[r.id] || rp;
      rawPos.set(rp, i * 3); tgtPos.set(tp, i * 3);
      const start = prev[r.id] || (harmonized && !had ? tp : rp);
      curPos.set(start, i * 3); fromPos.set(start, i * 3);
      colors.set(hexRGB(cpseById(r.cpse).color), i * 3);
      baseSize[i] = 2.6 + Math.min(2.6, Math.log10(1 + r.stockValue) / 2.2); sizes[i] = baseSize[i];
      alphas[i] = .92;
      delays[i] = (CLS_ORDER.indexOf(r.cls) + 1) * 120 + (hashInt(r.id) % 1000) * .38;
    });
    if (recPts) { scene.remove(recPts); recGeo.dispose(); }
    recGeo = new THREE.BufferGeometry();
    recGeo.setAttribute('position', new THREE.BufferAttribute(curPos, 3)); recGeo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    recGeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1)); recGeo.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
    recPts = new THREE.Points(recGeo, mat()); scene.add(recPts);
    // national code cores and member threads
    cores = L.coreList.map(c => ({...c, st:stOf(clusterById(c.cid))}));
    const cn = cores.length, cp = new Float32Array(cn * 3), cc = new Float32Array(cn * 3), cs = new Float32Array(cn), ca = new Float32Array(cn);
    cores.forEach((c, i) => { cp.set(c.p, i * 3); cc.set(coreColor(c.st), i * 3); cs[i] = c.st === 'verified' ? 12 : 9; ca[i] = 0; });
    if (corePts) { scene.remove(corePts); coreGeo.dispose(); }
    coreGeo = new THREE.BufferGeometry();
    coreGeo.setAttribute('position', new THREE.BufferAttribute(cp, 3)); coreGeo.setAttribute('aColor', new THREE.BufferAttribute(cc, 3));
    coreGeo.setAttribute('size', new THREE.BufferAttribute(cs, 1)); coreGeo.setAttribute('alpha', new THREE.BufferAttribute(ca, 1));
    corePts = new THREE.Points(coreGeo, mat()); scene.add(corePts);
    const segs = [], scol = [];
    cores.forEach(c => { const cl = clusterById(c.cid); cl.members.forEach(m => { const tp = L.tgt[m.id]; segs.push(...tp, ...c.p); scol.push(...hexRGB(cpseById(m.cpse).color), ...coreColor(c.st)); }); });
    if (lineSeg) { scene.remove(lineSeg); lineGeo.dispose(); }
    lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3)); lineGeo.setAttribute('color', new THREE.Float32BufferAttribute(scol, 3));
    lineMat = new THREE.LineBasicMaterial({vertexColors:true, transparent:true, opacity:lineAlphaNow, blending:THREE.AdditiveBlending, depthWrite:false});
    lineSeg = new THREE.LineSegments(lineGeo, lineMat); scene.add(lineSeg);
    harm = harmonized;
    coreTgtAlpha = harm ? 1 : 0; lineTgtAlpha = harm ? .3 : 0;
    if (harm && !had) { coreAlphaNow = 1; lineAlphaNow = .3; lineMat.opacity = .3; }
    applyVisibility();
    CLS_ORDER.forEach(c => { labelEls[c].innerHTML = `${esc(CLASSES[c].name)}<b>${sectors[c].recs} → ${sectors[c].n}</b>`; });
    document.body.classList.toggle('harm', harm);
    // records that moved (after a split, attach or upload) glide to their new place
    if (had && harm) moveTo(tgtPos, 900, 0);
  }
  function moveTo(target, dur, stagger){
    fromPos.set(curPos); anim = {t0:performance.now(), dur, stagger, target};
    if (reduceMotion) { curPos.set(target); recGeo.attributes.position.needsUpdate = true; anim = null; }
  }
  function harmonize(){
    if (!ok) return;
    harm = true; coreTgtAlpha = 0; lineTgtAlpha = 0; coreAlphaNow = 0; lineAlphaNow = 0;
    moveTo(tgtPos, 1700, 1);
    const total = reduceMotion ? 0 : 1700 + 1600;
    setTimeout(() => { coreTgtAlpha = 1; lineTgtAlpha = .3; document.body.classList.add('harm'); }, total * .82);
  }
  function scatter(){ if (!ok) return; harm = false; coreTgtAlpha = 0; lineTgtAlpha = 0; document.body.classList.remove('harm'); moveTo(rawPos, 700, 0); }
  function replay(){ scatter(); setTimeout(harmonize, reduceMotion ? 0 : 850); }
  function refreshCores(){
    if (!ok || !coreGeo) return;
    const cc = coreGeo.attributes.aColor.array, cs = coreGeo.attributes.size.array;
    cores.forEach((c, i) => { const cl = clusterById(c.cid); c.st = cl ? stOf(cl) : c.st; cc.set(coreColor(c.st), i * 3); cs[i] = c.st === 'verified' ? 12 : 9; });
    coreGeo.attributes.aColor.needsUpdate = true; coreGeo.attributes.size.needsUpdate = true;
  }
  function applyVisibility(){
    if (!ok || !recGeo) return;
    const fc = focusCid ? clusterById(focusCid) : null, inFocus = new Set(fc ? fc.members.map(m => m.id) : []);
    ENG.recs.forEach((r, i) => {
      let a = .92, s = baseSize[i];
      if (S.hidden[r.cpse]) a = .05;
      else if (fc) { if (inFocus.has(r.id)) { a = 1; s = baseSize[i] * 2.1; } else a = .16; }
      if (i === hover) s *= 1.6;
      alphas[i] = a; sizes[i] = s;
    });
    recGeo.attributes.alpha.needsUpdate = true; recGeo.attributes.size.needsUpdate = true;
    if (coreGeo) { const ca = coreGeo.attributes.alpha.array; cores.forEach((c, i) => { ca[i] = coreAlphaNow * (fc ? (c.cid === focusCid ? 1 : .2) : 1); }); coreGeo.attributes.alpha.needsUpdate = true; }
  }
  function centerOf(cid){
    const c = cores.find(x => x.cid === cid); if (c) return c.p;
    const cl = clusterById(cid); if (!cl) return null; const i = ids.indexOf(cl.members[0].id); return i < 0 ? null : [tgtPos[i * 3], tgtPos[i * 3 + 1], tgtPos[i * 3 + 2]];
  }
  function focus(cid){
    focusCid = cid; applyVisibility();
    const p = harm && cid ? centerOf(cid) : null;
    if (p) { goal.tx = p[0]; goal.ty = p[1]; goal.tz = p[2]; goal.dist = 40; } else clearFocus(true);
  }
  function clearFocus(keep){ if (!keep) { focusCid = null; applyVisibility(); } goal.tx = 0; goal.ty = -7; goal.tz = 0; goal.dist = 138; }
  function setShift(px){ shift = px; applyShift(); if (ok) camera.updateProjectionMatrix(); }

  function pickAt(x, y){
    if (!ok || !recPts || document.body.classList.contains('auth') || !(S.view === 'overview' || S.view === 'review')) { if (hover >= 0) { hover = -1; applyVisibility(); } hideTip(); return; }
    mouse.set(x / W * 2 - 1, -(y / H) * 2 + 1); ray.setFromCamera(mouse, camera);
    ray.params.Points.threshold = Math.max(.9, cam.dist / 110);
    const hits = ray.intersectObject(recPts).filter(h => alphas[h.index] > .3).sort((a, b) => a.distanceToRay - b.distanceToRay);
    const i = hits.length ? hits[0].index : -1;
    if (i !== hover) { hover = i; applyVisibility(); }
    if (i < 0) { hideTip(); $('#gl').style.cursor = ''; return; }
    $('#gl').style.cursor = 'pointer';
    const r = ENG.byId[ids[i]], c = ENG.byRec[r.id], p = cpseById(r.cpse), tip = $('#tip');
    tip.innerHTML = `<div class="t-code"><span class="dot" style="background:${p.color}"></span> ${esc(p.name)}, ${esc(r.code)}</div><div class="t-desc">${esc(r.desc)}</div>` +
      (harm ? `<div class="t-nmc">${esc(c.nmc)}</div><div class="faint">${c.members.length > 1 ? `Fused with ${c.members.length - 1} other record${c.members.length > 2 ? 's' : ''}. ` : ''}${esc(STATUS_LABEL[stOf(c)])}. Click to open.</div>` : '<div class="faint">Run harmonization to see its national code.</div>');
    const tw = 320; tip.style.left = Math.min(x + 16, innerWidth - tw - 12) + 'px'; tip.style.top = Math.min(y + 16, innerHeight - 140) + 'px'; tip.classList.add('show');
  }
  function hideTip(){ $('#tip').classList.remove('show'); }

  function frame(now){
    requestAnimationFrame(frame);
    if (anim) {
      const t = now - anim.t0, N = ids.length; let done = true;
      for (let i = 0; i < N; i++) {
        const d = anim.stagger ? delays[i] : 0; let k = (t - d) / anim.dur;
        if (k < 1) done = false; k = Math.max(0, Math.min(1, k)); const e = ease(k);
        for (let j = 0; j < 3; j++) curPos[i * 3 + j] = fromPos[i * 3 + j] + (anim.target[i * 3 + j] - fromPos[i * 3 + j]) * e;
      }
      recGeo.attributes.position.needsUpdate = true;
      if (done) anim = null;
    }
    const fade = reduceMotion ? 1 : .05;
    if (Math.abs(coreAlphaNow - coreTgtAlpha) > .002) { coreAlphaNow += (coreTgtAlpha - coreAlphaNow) * fade; applyVisibility(); }
    if (Math.abs(lineAlphaNow - lineTgtAlpha) > .002) { lineAlphaNow += (lineTgtAlpha - lineAlphaNow) * fade; if (lineMat) lineMat.opacity = lineAlphaNow * (focusCid ? .4 : 1); }
    if (coreGeo && cores.length && !reduceMotion) {
      const cs = coreGeo.attributes.size.array, pulse = 1 + Math.sin(now / 480) * .12;
      cores.forEach((c, i) => { if (c.st === 'verified') cs[i] = 12 * pulse; });
      coreGeo.attributes.size.needsUpdate = true;
    }
    if (!dragging && !reduceMotion && !focusCid && (S.view === 'overview' || S.view === 'review' || S.view === 'login')) goal.theta += .00055;
    const k = .07;
    for (const key of ['theta', 'phi', 'dist', 'tx', 'ty', 'tz']) cam[key] += (goal[key] - cam[key]) * k;
    camera.position.set(cam.tx + cam.dist * Math.sin(cam.phi) * Math.cos(cam.theta), cam.ty + cam.dist * Math.cos(cam.phi), cam.tz + cam.dist * Math.sin(cam.phi) * Math.sin(cam.theta));
    camera.lookAt(cam.tx, cam.ty, cam.tz);
    renderer.render(scene, camera);
    // class labels follow their sectors
    const v = new THREE.Vector3();
    CLS_ORDER.forEach(c => {
      const el = labelEls[c], s = sectors[c]; if (!s) return;
      v.set(...s.p).project(camera);
      const x = (v.x * .5 + .5) * W, y = (-v.y * .5 + .5) * H;
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      el.style.visibility = v.z < 1 && x > -60 && x < W + 60 ? 'visible' : 'hidden';
    });
  }
  return {init, build, harmonize, replay, scatter, refreshCores, applyVisibility, focus, clearFocus, setShift, get ok(){ return ok; }};
})();

/* ================= shared view helpers ================= */
const App = {};
const dot = id => `<span class="dot" style="background:${cpseById(id).color}"></span>`;
const when = t => new Date(t).toLocaleString('en-IN', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'});
const cpseList = () => CPSES.concat(store.uploads ? [UPL] : []);
function stats(){
  let dupStock = 0, priceGap = 0, retire = 0, cross = 0;
  const counts = {proposed:0, approved:0, verified:0, hold:0, auto:0};
  ENG.clusters.forEach(c => {
    counts[stOf(c)]++;
    if (c.members.length < 2) return;
    const vals = c.members.map(m => m.stockValue); dupStock += vals.reduce((a, b) => a + b, 0) - Math.max(...vals);
    const byCp = uniq(c.members.map(m => m.cpse)); retire += c.members.length - byCp.length;
    const priced = c.members.filter(m => m.unitPrice > 0);
    if (byCp.length > 1) { cross++; if (priced.length > 1) { const minP = Math.min(...priced.map(m => m.unitPrice)); priced.forEach(m => { priceGap += m.annualQty * (m.unitPrice - minP); }); } }
  });
  return {dupStock, priceGap, retire, cross, counts};
}
function notYet(title){
  return `<div class="empty"><div><h3>${esc(title)} appears after harmonization</h3><p>Run harmonization on the Overview to read, match and code the four companies' records.</p><p style="margin-top:14px"><button class="btn primary" data-act="run">Run harmonization</button></p></div></div>`;
}

/* ================= header ================= */
function renderHeader(){
  const u = store.me ? {name:store.me.name, title:store.me.title, init:store.me.init, color:store.me.color} : USERS[store.role];
  $('#roleAv').textContent = u.init; $('#roleAv').style.background = u.color;
  $('#roleName').textContent = u.name; $('#roleTitle').textContent = u.title;
  const acc = store.me || {};
  $('#roleMenu').innerHTML = `<div class="who-info"><strong>${esc(u.name)}</strong><small>${esc(u.title)}</small><small>${esc(acc.email || '')}</small><small>${esc(acc.org || '')}</small></div>
    <p>Demo shortcut: switch account</p>
    ${['maker', 'checker', 'auditor'].filter(k => k !== store.role).map(k => `<button data-act="demoSwitch" data-uid="${k}" role="menuitem"><span class="av" style="background:${USERS[k].color}">${USERS[k].init}</span><span>${esc(USERS[k].name)}<small>${esc(USERS[k].title)}</small></span></button>`).join('')}
    <hr>${store.role !== 'auditor' ? `<button data-act="reset" role="menuitem"><span>Reset demo<small>Clears approvals, requests, uploads and the audit trail</small></span></button>` : ''}
    <button data-act="signout" role="menuitem"><span>Sign out</span></button>`;
  const c = stats().counts, openReq = store.requests.filter(r => r.status === 'requested').length;
  const n = store.role === 'maker' ? c.proposed + c.hold + openReq : store.role === 'checker' ? c.approved : 0;
  $('#qBadge').textContent = store.harmonized && n ? String(n) : '';
  $$('.nav button').forEach(b => b.dataset.view === S.view ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
}

/* ================= overview ================= */
function renderOverview(){
  const e = ENG, H = store.harmonized, n = e.recs.length, m = e.clusters.length;
  const multi = e.clusters.filter(c => c.members.length > 1).length;
  const dq = Math.round(e.recs.reduce((s, r) => s + r.dq, 0) / n);
  const steps = [
    ['Normalise text', 'Expand abbreviations, fix typos, align units', fmt(n)],
    ['Extract attributes', 'Size, class, grade, material, standard', dq + '%'],
    ['Group candidates', 'Compare only parts that could match', fmt(e.blocks)],
    ['Match and score', 'Attribute agreement plus text similarity', fmt(e.compared)],
    ['Cluster', 'Strongest evidence first, never across a conflict', fmt(multi)],
    ['Standardise', 'One description per material', fmt(m)],
    ['Classify and code', 'UNSPSC class and national code', fmt(m)],
  ];
  const a = e.acc;
  $('#ovLeft').innerHTML = `
    <h1 class="hl">${H ? `<span class="n">${fmt(n)}</span> codes.<br><span class="n">${fmt(m)}</span> materials.` : `<span class="n">${fmt(n)}</span> codes<br>in four ERPs.`}</h1>
    <p class="lede">${H ? 'Each glowing core is one national code. Every company keeps its own code as an alias, so nothing breaks in SAP or Oracle.'
      : 'Four public sector companies describe the same valves, bearings, bolts and cables in their own words. Harmonization reads each description, works out what the part is, and fuses duplicates into one national code.'}</p>
    <button class="btn primary lg" data-act="run">${H ? 'Replay harmonization' : 'Run harmonization'}</button>
    <ol class="pipe">${steps.map(([t, s, v]) => `<li class="${H ? 'done' : ''}"><span>${t}<small>${s}</small></span><em>${H ? v : '—'}</em></li>`).join('')}</ol>
    ${H ? `<div class="acc"><strong>${(a.precision * 100).toFixed(1)}% precision, ${(a.recall * 100).toFixed(1)}% recall</strong>
      <p>Checked against the answer key built into this sample. Of the records it merged, ${(a.precision * 100).toFixed(1)}% were truly the same part; of the true duplicates, it found ${(a.recall * 100).toFixed(1)}%.
      ${e.holds.length ? `${e.holds.length} record${e.holds.length > 1 ? 's are' : ' is'} held for a person because a key attribute is missing.` : ''} Real data will score lower until reviewers' decisions are used to retrain it.</p></div>` : ''}`;
  const right = $('#ovRight');
  if (!H) {
    right.innerHTML = `<section><h2>What harmonizing finds</h2><p class="empty-note">Run harmonization to see duplicate stock, price gaps between companies and codes to retire.</p></section>
      <section><h2>How to read the view</h2><p class="muted small">Each particle is one material record. Colour shows the company, size shows the stock value. Drag to turn, scroll to zoom, hover to read a record.</p></section>`;
  } else {
    const st = stats(), c = st.counts, tot = Math.max(1, c.proposed + c.approved + c.verified + c.hold);
    const looks = e.lookalikes.filter(l => !store.confirmed[l.key]), ex = e.lookalikes[0];
    let reason = '';
    if (ex) { const sch = SCHEMA[CLASSES[ex.ra.cls].group].filter(f => ex.det[f.k] === 'conflict'); reason = sch.map(f => `${f.label}: ${fmtVal(f.k, ex.ra.a[f.k])} vs ${fmtVal(f.k, ex.rb.a[f.k])}`).join('; '); }
    right.innerHTML = `
      <section><h2>What this frees up</h2><dl class="save">
        <div><dt>Duplicate stock across companies</dt><dd>${inr(st.dupStock)}</dd><small>Spares for the same part held more than once.</small></div>
        <div><dt>Price gap, per year</dt><dd>${inr(st.priceGap)}</dd><small>If every company paid the lowest price another company already pays.</small></div>
        <div><dt>Legacy codes to retire</dt><dd>${fmt(st.retire)}</dd><small>Second codes for the same part inside one company.</small></div>
        <div><dt>New duplicates stopped</dt><dd>${fmt(store.prevented)}</dd><small>Times Check a part found an existing code, so no new one was created.</small></div>
      </dl></section>
      <section><h2>Review</h2>
        <div class="progress" aria-label="Review progress"><i style="width:${c.verified / tot * 100}%;background:var(--lime)"></i><i style="width:${c.approved / tot * 100}%;background:var(--amber)"></i><i style="width:${(c.proposed + c.hold) / tot * 100}%;background:rgba(163,181,203,.35)"></i></div>
        <div class="legend-row"><span><span class="dot" style="background:var(--lime)"></span>${c.verified} verified</span><span><span class="dot" style="background:var(--amber)"></span>${c.approved} approved</span><span><span class="dot" style="background:rgba(163,181,203,.6)"></span>${c.proposed + c.hold} waiting</span></div>
        <p style="margin-top:12px"><button class="btn sm" data-view="review">Open review</button></p></section>
      <section><h2>Look-alikes kept apart</h2>
        <p class="muted small">${e.lookalikes.length} pairs read almost the same but differ in one critical attribute, so each keeps its own code.</p>
        ${ex ? `<p class="small" style="margin-top:8px">${esc(ex.ra.desc)}<br>${esc(ex.rb.desc)}<br><span style="color:var(--red)">${esc(reason)}</span></p>` : ''}
        <p style="margin-top:10px"><button class="btn sm" data-act="looks">See look-alikes${looks.length ? ` (${looks.length})` : ''}</button></p></section>`;
  }
  $('#cpseBar').innerHTML = cpseList().map(p => {
    const rs = e.recs.filter(r => r.cpse === p.id), q = rs.length ? Math.round(rs.reduce((s, r) => s + r.dq, 0) / rs.length) : 0;
    return `<button class="cpse-chip" data-cpse="${p.id}" aria-pressed="${!S.hidden[p.id]}" title="${esc(p.name)}: ${rs.length} records, ${q}% of key attributes stated. Click to hide or show."><span class="dot" style="background:${p.color}"></span><strong>${esc(p.short)}</strong><small>${rs.length}</small></button>`;
  }).join('') + `<span class="cpse-chip" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="none" stroke="#FFB547" stroke-width="2.2"/></svg><strong>National code</strong></span>`;
}

/* ================= data sources ================= */
function renderSources(){
  const e = ENG;
  const cards = cpseList().map(p => {
    const rs = e.recs.filter(r => r.cpse === p.id), q = rs.length ? Math.round(rs.reduce((s, r) => s + r.dq, 0) / rs.length) : 0;
    const sample = []; const seen = new Set();
    rs.forEach(r => { if (sample.length < 4 && !seen.has(r.cls)) { seen.add(r.cls); sample.push(r); } });
    return `<div class="src"><div class="src-top"><div><h3>${dot(p.id)}${esc(p.name)}</h3><div class="meta">${esc(p.city)}, ${esc(p.erp)}</div></div><div class="big">${fmt(rs.length)}<small>records</small></div></div>
      <div class="meter"><i style="width:${q}%;background:${p.color}"></i></div><div class="small muted">${q}% of key attributes are stated in the descriptions</div>
      <div class="rows">${sample.map(r => `<div><span class="code">${esc(r.code)}</span><span>${esc(r.desc)}</span></div>`).join('')}</div></div>`;
  }).join('');
  const best = e.clusters.filter(c => uniq(c.members.map(m => m.cpse)).length >= 3).sort((a, b) => b.members.length - a.members.length)[0];
  $('#srcSheet').innerHTML = `<div class="sheet-head"><div><h2>Data sources</h2><p>Material master extracts from each company's ERP. Same parts, four ways of writing them.</p></div>
      <div class="tools"><button class="btn" data-act="template">Download CSV template</button><button class="btn primary" data-act="choose">Upload your extract</button></div></div>
    <div class="sheet-body"><div class="src-grid">${cards}</div>
      <div class="drop" id="drop"><div><h3>Add your own extract</h3><p>Drop a CSV with columns code, description, uom, price and stock. EkCode reads it in your browser and matches it against the four companies. Nothing is sent to a server.</p></div>
        <div class="tools"><button class="btn primary" data-act="choose">Choose CSV file</button>${store.uploads ? `<button class="btn bad" data-act="clearUploads">Remove ${store.uploads} uploaded records</button>` : ''}</div></div>
      ${fixesHtml()}
      ${best ? `<div class="ba"><div class="raw"><h3>How the companies write it</h3>${best.members.map(m => `<div>${dot(m.cpse)} ${esc(m.desc)}</div>`).join('')}</div><div class="arrow" aria-hidden="true">→</div>
        <div><h3>One national material</h3>${store.harmonized ? `<div class="nmc">${esc(best.nmc)}</div>` : ''}<div class="std">${esc(stdOf(best))}</div><div class="small muted" style="margin-top:6px">SAP short text, 40 characters: ${esc(best.short)}</div></div></div>` : ''}
    </div>`;
  const drop = $('#drop');
  if (drop) {
    ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, ev => { ev.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, ev => { ev.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', ev => { const f = ev.dataTransfer.files[0]; if (f) readFile(f); });
  }
}

/* ================= review ================= */
function queueItems(){
  const cs = ENG.clusters, order = {duplicate:0, near:1, equivalent:2};
  if (S.qf === 'looks') return ENG.lookalikes.filter(l => !store.confirmed[l.key]);
  if (S.qf === 'requests') return store.requests.filter(r => r.status === 'requested').slice().reverse();
  const want = {approve:'proposed', verify:'approved', verified:'verified', hold:'hold'}[S.qf];
  return cs.filter(c => stOf(c) === want).sort((a, b) => (order[a.type] ?? 3) - (order[b.type] ?? 3) || b.score - a.score || a.std.localeCompare(b.std));
}
function renderReview(){
  const el = $('#rvSheet');
  if (!store.harmonized) { el.innerHTML = `<div style="grid-column:1/-1">${notYet('Review')}</div>`; return; }
  const c = stats().counts, looks = ENG.lookalikes.filter(l => !store.confirmed[l.key]);
  const openReq = store.requests.filter(r => r.status === 'requested');
  const tabs = [['approve', 'Approve', c.proposed], ['hold', 'Held', c.hold], ['requests', 'Requests', openReq.length], ['verify', 'Verify', c.approved], ['verified', 'Verified', c.verified], ['looks', 'Look-alikes', looks.length]];
  const items = queueItems();
  if (S.sel && !clusterById(S.sel)) S.sel = null;
  if (S.req && !openReq.some(r => r.id === S.req)) S.req = null;
  if (!S.sel && !S.look && !S.req && items.length) { if (S.qf === 'looks') S.look = items[0].key; else if (S.qf === 'requests') S.req = items[0].id; else S.sel = items[0].id; }
  const bulkN = store.role === 'maker' && S.qf === 'approve' ? ENG.clusters.filter(x => stOf(x) === 'proposed' && x.type === 'duplicate' && x.score >= 85).length : 0;
  const EMPTY = {approve:['Nothing to approve', 'Every proposed match has a decision. Switch to the checker to verify them.'],
    hold:['Nothing held', 'Records missing a key attribute come here when more than one material could fit.'],
    verify:['Nothing to verify', 'Matches the maker approves appear here for the checker.'],
    verified:['No verified codes yet', 'A national code goes live once the checker verifies it.'],
    looks:['No look-alikes left', 'Every look-alike pair has been confirmed as different.'],
    requests:['No open requests', 'New-code requests from Check a part arrive here for the maker.']}[S.qf];
  const item = x => S.qf === 'requests'
    ? `<button class="qi" data-req="${x.id}" aria-current="${S.req === x.id}"><div class="q1">${esc(x.desc)}</div><div class="q2"><span class="pill s-proposed">${esc(x.id)}</span>${dot(x.cpse)}<span>${esc(x.by)}</span><span>${when(x.at)}</span></div></button>`
    : S.qf === 'looks'
    ? (() => { const conf = SCHEMA[CLASSES[x.ra.cls].group].filter(f => x.det[f.k] === 'conflict'); return `<button class="qi" data-look="${x.key}" aria-current="${S.look === x.key}"><div class="q1">${esc(ENG.byRec[x.a].short)}</div><div class="q2"><span class="pill t-different">Look-alike</span><span>${conf.map(f => `${f.label.toLowerCase()} ${fmtVal(f.k, x.ra.a[f.k])} vs ${fmtVal(f.k, x.rb.a[f.k])}`).join('; ')}</span></div></button>`; })()
    : `<button class="qi" data-sel="${x.id}" aria-current="${S.sel === x.id}"><div class="q1">${esc(x.hold ? x.members[0].desc : x.short)}</div><div class="q2"><span class="pill t-${x.hold ? 'near' : x.type}">${x.hold ? 'Key attribute missing' : TYPE_LABEL[x.type]}</span><span class="dots">${uniq(x.members.map(m => m.cpse)).map(dot).join('')}</span><span>${x.members.length} record${x.members.length > 1 ? 's' : ''}</span>${x.members.length > 1 ? `<span>${x.score}%</span>` : ''}</div></button>`;
  el.innerHTML = `<div class="rv-list"><div class="qtabs" role="tablist">${tabs.map(([k, l, n]) => `<button data-qf="${k}" aria-pressed="${S.qf === k}">${l}<b>${n}</b></button>`).join('')}</div>
      ${bulkN ? `<div class="qbulk"><button class="btn sm primary" data-act="bulk">Approve all ${bulkN} exact duplicates</button></div>` : ''}
      <div class="qlist">${items.length ? items.map(item).join('') : `<div class="empty"><div><h3>${EMPTY[0]}</h3><p>${EMPTY[1]}</p></div></div>`}</div>
      <div class="kbd-hint"><kbd>J</kbd> <kbd>K</kbd> move${store.role === 'maker' ? ', <kbd>A</kbd> approve' : store.role === 'checker' ? ', <kbd>V</kbd> verify' : ''}, <kbd>Ctrl K</kbd> find</div></div>
    <div class="rv-detail" id="rvDetail">${detailHtml()}</div>`;
  const focusId = S.look ? ENG.byRec[(ENG.lookalikes.find(l => l.key === S.look) || {}).a]?.id : S.req ? null : S.sel;
  Scene.focus(focusId || null);
}
function detailHtml(){
  if (S.req) return reqDetail(store.requests.find(r => r.id === S.req));
  if (S.look) return lookDetail(ENG.lookalikes.find(l => l.key === S.look));
  const c = S.sel && clusterById(S.sel);
  if (!c) return `<div class="empty"><div><h3>Pick an item</h3><p>Choose a match from the list, or click any particle in the 3D view.</p></div></div>`;
  return c.hold ? holdDetail(c) : clusterDetail(c);
}
function cellStatus(f, v, c){
  if (v == null) return 'missing';
  if (f.brand) return 'same';
  const gv = c.golden[f.k]; if (gv == null || String(v) === String(gv)) return 'same';
  if (isEquiv(v, gv) || c.alts.includes(v)) return 'equiv';
  if (v === 'CS') return 'partial';
  return f.soft ? 'soft' : 'conflict';
}
function clusterDetail(c){
  const st = stOf(c), s = store.status[c.id] || {}, g = c.cls ? CLASSES[c.cls] : null, sch = g ? SCHEMA[g.group] : [];
  const multi = c.members.length > 1, maker = store.role === 'maker', checker = store.role === 'checker', cps = uniq(c.members.map(m => m.cpse));
  const canEdit = maker && (st === 'proposed' || st === 'auto'), canSplit = maker && multi && st === 'proposed';
  const why = [];
  if (multi) {
    const keys = sch.filter(f => f.key).map(f => f.label.toLowerCase());
    why.push(`${keys.join(', ').replace(/, ([^,]*)$/, ' and $1').replace(/^./, x => x.toUpperCase())} agree in every record that states them.`);
  } else if (g) why.push('No other company describes this part, so it gets its own national code.');
  c.notes.forEach(n => why.push(n)); c.flags.forEach(f => why.push(f + '. Confirm with the user department.'));
  let price = '';
  const priced = c.members.filter(m => m.unitPrice > 0);
  if (uniq(priced.map(m => m.cpse)).length > 1) {
    const ps = priced.map(m => m.unitPrice), mn = Math.min(...ps), mx = Math.max(...ps);
    const lo = priced.find(m => m.unitPrice === mn), hi = priced.find(m => m.unitPrice === mx);
    const gap = priced.reduce((t, m) => t + m.annualQty * (m.unitPrice - mn), 0), unit = priced[0].baseUom === 'M' ? 'm' : 'ea';
    price = `<div class="block"><h3>What each company pays</h3><div class="prices">${priced.map(m => `<div><span>${dot(m.cpse)} ${esc(m.code)}</span><span class="bar"><i style="width:${m.unitPrice / mx * 100}%;background:${cpseById(m.cpse).color}"></i></span><span class="num">${inr(m.unitPrice)}/${unit}</span></div>`).join('')}</div>
      <p class="small muted" style="margin-top:8px">Lowest ${inr(mn)} at ${esc(cpseById(lo.cpse).name)}. ${esc(cpseById(hi.cpse).name)} pays ${Math.round((mx / mn - 1) * 100)}% more. One national rate saves about ${inr(gap)} a year on this part.</p></div>`;
  }
  let acts = '';
  const as = uid => `<button class="btn sm" data-act="demoSwitch" data-uid="${uid}">Sign in as ${esc(USERS[uid].name)} (demo)</button>`;
  if (store.role === 'auditor' && st !== 'verified') {
    acts = `<span class="note">Read-only. The auditor account can review, trace and export, but not change records.</span>`;
  } else if (st === 'proposed') {
    acts = maker ? `<button class="btn primary" data-act="approve" data-cid="${c.id}">Approve match</button><button class="btn bad" data-act="reject" data-cid="${c.id}">Reject match</button>${canEdit ? `<button class="btn" data-act="edit">Edit description</button>` : ''}`
      : `<span class="note">Waiting for the maker to approve this match. ${as('maker')}</span>`;
  } else if (st === 'approved') {
    acts = checker ? `<button class="btn good" data-act="verify" data-cid="${c.id}">Verify and activate code</button><input class="in" id="sbReason" placeholder="Reason for sending back" aria-label="Reason for sending back" style="flex:1;min-width:180px"><button class="btn" data-act="sendback" data-cid="${c.id}">Send back</button>`
      : `<span class="note">Approved by ${esc(s.approvedBy)}. A different person, the checker, must verify before the code goes live. ${as('checker')}</span>`;
  } else if (st === 'verified') {
    acts = `<span class="note">Verified by ${esc(s.verifiedBy)} on ${when(s.verifiedAt)}. The code is active and mapped to ${c.members.length} legacy code${c.members.length > 1 ? 's' : ''}.</span>`;
  } else if (st === 'auto') {
    acts = canEdit ? `<button class="btn" data-act="edit">Edit description</button><span class="note">New materials without duplicates get a code straight away.</span>` : `<span class="note">New material without duplicates. It gets a code straight away.</span>`;
  }
  const trail = [s.approvedBy ? `Approved by ${esc(s.approvedBy)}, ${when(s.approvedAt)}` : '', s.verifiedBy ? `verified by ${esc(s.verifiedBy)}, ${when(s.verifiedAt)}` : '', s.note ? `sent back: "${esc(s.note)}"` : ''].filter(Boolean).join('; ');
  return `<div class="meta-row"><span class="pill s-${st}">${STATUS_LABEL[st]}</span><span class="pill t-${c.type}">${TYPE_LABEL[c.type]}</span>${multi ? `<span>Match confidence <b>${c.score}%</b></span>` : ''}</div>
    ${S.editing ? `<div class="edit-std"><textarea class="in" id="stdEdit" aria-label="Standard description">${esc(stdOf(c))}</textarea><div class="tools" style="margin-top:8px"><button class="btn sm primary" data-act="saveEdit" data-cid="${c.id}">Save description</button><button class="btn sm" data-act="cancelEdit">Cancel</button></div></div>` : `<h2>${esc(stdOf(c))}</h2>`}
    <div class="meta-row"><span>National code <span class="nmc ${st === 'verified' ? '' : 'prov'}">${esc(c.nmc)}</span>${st === 'verified' ? '' : ' provisional'}</span>${g ? `<span>Class <b>${g.nat}</b></span><span>UNSPSC <b>${g.unspsc}</b> ${esc(g.unspscName)}</span>` : ''}<span>SAP short text <b>${esc(c.short)}</b></span></div>
    ${trail ? `<p class="small faint" style="margin-top:6px">${trail}</p>` : ''}
    <div class="block"><h3>${multi ? `${c.members.length} records from ${cps.length} compan${cps.length > 1 ? 'ies' : 'y'}` : 'Record'}</h3><div class="wrapx"><table class="t"><thead><tr><th>Legacy code</th><th>Description as written</th><th class="num">Unit price</th><th class="num">Stock value</th></tr></thead><tbody>
      ${c.members.map(m => `<tr><td style="white-space:nowrap">${dot(m.cpse)} <span class="code">${esc(m.code)}</span><div class="faint small">${esc(cpseById(m.cpse).short)}, UoM ${esc(m.uom)}${/^KM$/i.test(m.uom) ? ' to m' : ''}</div>${canSplit ? `<button class="btn sm" style="margin-top:6px" data-act="split" data-cid="${c.id}" data-rid="${m.id}">Remove from match</button>` : ''}</td><td>${esc(m.desc)}</td><td class="num">${inr(m.unitPrice)}/${m.baseUom === 'M' ? 'm' : 'ea'}</td><td class="num">${inr(m.stockValue)}</td></tr>`).join('')}</tbody></table></div></div>
    ${g ? `<div class="block"><h3>What the engine read</h3><div class="wrapx"><table class="t agrid"><thead><tr><th>Attribute</th>${c.members.map(m => `<th>${dot(m.cpse)} ${esc(m.code)}</th>`).join('')}<th>Standard</th></tr></thead><tbody>
      ${sch.map(f => `<tr><td class="muted">${f.label}</td>${c.members.map(m => `<td class="c ${cellStatus(f, m.a[f.k], c)}">${m.a[f.k] == null ? 'not stated' : esc(fmtVal(f.k, m.a[f.k]))}</td>`).join('')}<td class="g">${f.brand ? esc(c.brands.join(', ') || '—') : esc(fmtVal(f.k, c.golden[f.k]))}</td></tr>`).join('')}</tbody></table></div>
      <p class="small faint" style="margin-top:6px"><span style="color:var(--rose)">Pink</span>: accepted equivalent. <span style="color:var(--sky)">Blue</span>: less specific or differing standard. Grey italics: not stated.</p></div>` : ''}
    <div class="block"><h3>Why</h3><ul class="why">${why.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>
    ${price}
    <div class="actions">${acts}</div>`;
}
function holdDetail(c){
  const h = c.hold, m = h.rec, maker = store.role === 'maker';
  return `<div class="meta-row"><span class="pill s-proposed">Needs a person</span><span class="pill t-near">Key attribute missing</span></div>
    <h2>${esc(m.desc)}</h2>
    <div class="meta-row"><span>${dot(m.cpse)} ${esc(cpseById(m.cpse).name)}, <b>${esc(m.code)}</b></span></div>
    <div class="block"><h3>Why it is held</h3><p class="muted">The description does not state the ${esc(h.missing.join(' or '))}. ${h.options.length} national materials fit everything else, so EkCode will not guess. Attach it to the right one, or leave it as a new code.</p></div>
    <div class="block"><h3>Materials it could be</h3><div class="wrapx"><table class="t"><thead><tr><th>National code</th><th>Standard description</th><th class="num">Records</th><th></th></tr></thead><tbody>
      ${h.options.map(o => `<tr><td class="nmc prov">${esc(o.nmc)}</td><td>${esc(stdOf(o))}</td><td class="num">${o.members.length}</td><td>${maker ? `<button class="btn sm primary" data-act="attach" data-rid="${m.id}" data-target="${o.id}">Attach here</button>` : ''}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="actions">${maker ? '<span class="note">Attaching sends the material back for approval with this record in it.</span>' : `<span class="note">Only the maker can attach records. <button class="btn sm" data-act="demoSwitch" data-uid="maker">Sign in as ${esc(USERS.maker.name)} (demo)</button></span>`}</div>`;
}
function lookDetail(l){
  if (!l) return `<div class="empty"><div><h3>Pick a look-alike</h3></div></div>`;
  const conf = SCHEMA[CLASSES[l.ra.cls].group].filter(f => l.det[f.k] === 'conflict');
  const reason = conf.map(f => `${f.label}: ${fmtVal(f.k, l.ra.a[f.k])} vs ${fmtVal(f.k, l.rb.a[f.k])}`).join('; ');
  return `<div class="meta-row"><span class="pill t-different">Look-alike</span><span>Text similarity <b>${Math.round(l.text * 100)}%</b></span></div>
    <h2>Almost the same words. Different parts.</h2>
    <p class="muted">${esc(reason)}. Merging these would send the wrong part to a job, so each keeps its own national code.</p>
    <div class="block pair">${[l.ra, l.rb].map(r => { const c = ENG.byRec[r.id]; return `<div class="rec"><div class="small">${dot(r.cpse)} ${esc(cpseById(r.cpse).name)}, <span class="code">${esc(r.code)}</span></div><div style="margin:6px 0 8px">${esc(r.desc)}</div><div class="nmc prov">${esc(c.nmc)}</div><div class="small muted">${esc(stdOf(c))}</div></div>`; }).join('')}</div>
    <div class="actions">${store.role === 'maker' ? `<button class="btn primary" data-act="confirm" data-key="${esc(l.key)}">Confirm they are different</button>` : '<span class="note">The maker confirms look-alikes.</span>'}</div>`;
}

/* ================= national catalogue ================= */
function renderCatalogue(){
  const el = $('#catSheet');
  if (!store.harmonized) { el.dataset.built = ''; el.innerHTML = notYet('The national catalogue'); return; }
  if (!el.dataset.built) {
    el.innerHTML = `<div class="sheet-head"><div><h2>National catalogue</h2><p>One entry per material, with its national code and every company code mapped to it.</p></div>
      <div class="tools"><input class="in" id="catQ" type="search" placeholder="Search codes or descriptions" aria-label="Search catalogue">
      <select class="in" id="catCls" aria-label="Class"><option value="">All classes</option>${CLS_ORDER.map(c => `<option value="${c}">${CLASSES[c].name}</option>`).join('')}</select>
      <select class="in" id="catSt" aria-label="Status"><option value="">Any status</option>${['proposed', 'approved', 'verified', 'auto', 'hold'].map(s => `<option value="${s}">${STATUS_LABEL[s]}</option>`).join('')}</select>
      <button class="btn" data-act="expCat">Download catalogue (CSV)</button></div></div>
      <div class="sheet-body"><div class="stat-row" id="catStats"></div><div class="wrapx"><table class="t"><thead><tr><th>National code</th><th>Standard description</th><th>Class</th><th>UNSPSC</th><th>Held by</th><th class="num">Codes mapped</th><th>Status</th></tr></thead><tbody id="catBody"></tbody></table></div><p class="more" id="catMore"></p></div>`;
    el.dataset.built = '1';
    $('#catQ').value = S.catQ; $('#catCls').value = S.catCls; $('#catSt').value = S.catSt;
  }
  renderCatTable();
}
function catRows(){
  const q = S.catQ.trim().toUpperCase();
  return ENG.clusters.filter(c => (!S.catCls || c.cls === S.catCls) && (!S.catSt || stOf(c) === S.catSt) &&
    (!q || stdOf(c).includes(q) || c.nmc.includes(q) || c.members.some(m => m.code.toUpperCase().includes(q) || m.desc.toUpperCase().includes(q))));
}
function renderCatTable(){
  const rows = catRows(), st = stats();
  $('#catStats').innerHTML = `<div><b>${fmt(ENG.clusters.length)}</b>materials</div><div><b>${fmt(ENG.recs.length - ENG.clusters.length)}</b>duplicate codes absorbed</div><div><b>${fmt(st.cross)}</b>shared by two or more companies</div><div><b>${fmt(st.counts.verified)}</b>verified and active</div>`;
  $('#catBody').innerHTML = rows.slice(0, 250).map(c => { const g = c.cls ? CLASSES[c.cls] : null, s = stOf(c);
    return `<tr class="click" data-cid="${c.id}"><td class="nmc ${s === 'verified' ? '' : 'prov'}">${esc(c.nmc)}</td><td>${esc(stdOf(c))}</td><td>${g ? esc(g.name) : 'Unrecognised'}</td><td>${g ? g.unspsc : '—'}</td><td><span class="dots">${uniq(c.members.map(m => m.cpse)).map(dot).join('')}</span></td><td class="num">${c.members.length}</td><td><span class="pill s-${s === 'hold' ? 'proposed' : s}">${STATUS_LABEL[s]}</span></td></tr>`; }).join('')
    || `<tr><td colspan="7" class="faint">No materials match. Clear the search or filters.</td></tr>`;
  $('#catMore').textContent = rows.length > 250 ? `Showing 250 of ${fmt(rows.length)}. Search to narrow the list.` : `${fmt(rows.length)} material${rows.length === 1 ? '' : 's'}.`;
}

/* ================= mapping and SAP ================= */
function mappingRows(){
  const rows = [];
  ENG.clusters.forEach(c => {
    const st = stOf(c), by = {};
    c.members.forEach(m => (by[m.cpse] = by[m.cpse] || []).push(m));
    Object.values(by).forEach(list => {
      list.sort((a, b) => b.stockValue - a.stockValue);
      list.forEach((m, i) => rows.push({m, c, st, action:list.length > 1 ? (i === 0 ? 'Keep as primary' : `Retire, move stock to ${list[0].code}`) : 'Map as alias'}));
    });
  });
  return rows.sort((a, b) => a.m.cpse.localeCompare(b.m.cpse) || a.m.code.localeCompare(b.m.code));
}
const MAPST = {verified:'Ready to load', approved:'Waiting for checker', proposed:'Waiting for approval', hold:'Held for a person', auto:'New code'};
function erpPreview(r){
  const c = ENG.byRec[r.id], g = c.cls ? CLASSES[c.cls] : {}, p = cpseById(r.cpse), live = stOf(c) === 'verified';
  if (/Oracle/.test(p.erp)) return `Oracle EBS item import
Table   MTL_SYSTEM_ITEMS_INTERFACE

SEGMENT1           ${r.code}
DESCRIPTION        ${c.short}
LONG_DESCRIPTION   ${stdOf(c)}
PRIMARY_UOM_CODE   ${r.baseUom}
ATTRIBUTE1 (NMC)   ${c.nmc}
ATTRIBUTE2 (UNSPSC) ${g.unspsc || ''}
PROCESS_FLAG       1
TRANSACTION_TYPE   UPDATE
STATUS             ${live ? 'ACTIVE' : 'PROVISIONAL'}`;
  return `IDoc type  MATMAS05 (material master)
Receiver   ${p.erp}, ${p.name}

E1MARAM   MATNR   ${r.code}
          MTART   ${g.mtart || 'ERSA'}
          MATKL   ${g.nat || 'UNCL'}
          MEINS   ${r.baseUom}
E1MAKTM   SPRAS   E
          MAKTX   ${c.short}
Z1NMCHD   NMC     ${c.nmc}   (custom segment)
          UNSPSC  ${g.unspsc || ''}
          STATUS  ${live ? 'ACTIVE' : 'PROVISIONAL'}`;
}
function apiSample(r){
  const c = ENG.byRec[r.id], g = c.cls ? CLASSES[c.cls] : {};
  return JSON.stringify({request:`GET /api/v1/nmc/lookup?company=${r.cpse}&code=${r.code}`, response:{
    nmc:c.nmc, status:stOf(c) === 'verified' ? 'active' : 'provisional', standard_description:stdOf(c), short_text:c.short,
    national_class:g.nat || null, unspsc:g.unspsc || null, base_uom:r.baseUom,
    aliases:c.members.map(m => ({company:m.cpse, code:m.code, uom:m.uom}))}}, null, 2);
}
function renderMapping(){
  const el = $('#mapSheet');
  if (!store.harmonized) { el.innerHTML = notYet('Mapping'); return; }
  const all = mappingRows(), rows = S.mapCpse === 'ALL' ? all : all.filter(x => x.m.cpse === S.mapCpse);
  const ready = rows.filter(x => x.st === 'verified').length, retire = rows.filter(x => x.action.startsWith('Retire')).length;
  const sel = S.mapSel && ENG.byId[S.mapSel];
  const side = sel ? `<h3>Load into ${esc(cpseById(sel.cpse).erp)}</h3><p class="small muted" style="margin-bottom:8px">${esc(sel.code)} maps to ${esc(ENG.byRec[sel.id].nmc)}.</p>
      <pre class="codeblock">${esc(erpPreview(sel))}</pre><h3>Lookup API</h3><pre class="codeblock">${esc(apiSample(sel))}</pre>
      <div class="tools"><button class="btn" data-act="expApi">Download API sample (JSON)</button><button class="btn" data-act="mapBack">Back to switch-over plan</button></div>`
    : `<h3>How the switch-over works</h3><ol class="steps">
      <li><b>Verify</b> each national code: the maker approves, the checker verifies.</li>
      <li><b>Load</b> the national code into every ERP against the legacy code.</li>
      <li><b>Block</b> retired duplicate codes for new purchase orders.</li>
      <li><b>Move stock</b> from retired codes to the primary code in each plant.</li>
      <li><b>Buy together</b>: tenders quote the national code, so demand from all companies can be pooled.</li></ol>
      <p class="small muted" style="margin-bottom:12px">Click a row to preview its SAP IDoc or Oracle item import.</p>
      <div class="tools"><button class="btn" data-act="expMap">Download mapping (CSV)</button><button class="btn primary" data-act="expSap">Download SAP load file (TXT)</button></div>`;
  el.innerHTML = `<div class="sheet-head"><div><h2>Mapping and SAP</h2><p>Every legacy code keeps working. It points to its national code, so purchase orders and stock move over without a big-bang cutover.</p></div>
      <div class="tools">${[['ALL', 'All companies']].concat(cpseList().map(p => [p.id, p.name])).map(([id, l]) => `<button class="btn sm${S.mapCpse === id ? ' primary' : ''}" data-mapc="${id}">${esc(l)}</button>`).join('')}</div></div>
    <div class="sheet-body"><div class="map-wrap"><div style="min-width:0"><div class="stat-row"><div><b>${fmt(rows.length)}</b>legacy codes mapped</div><div><b>${fmt(ready)}</b>ready to load</div><div><b>${fmt(retire)}</b>to retire</div></div>
      <div class="wrapx"><table class="t"><thead><tr><th>Company</th><th>Legacy code</th><th>Description as written</th><th>National code</th><th>Action</th><th>Status</th></tr></thead><tbody>
      ${rows.slice(0, 300).map(x => `<tr class="click${S.mapSel === x.m.id ? ' sel' : ''}" data-rec="${x.m.id}"><td>${dot(x.m.cpse)} ${x.m.cpse}</td><td class="code">${esc(x.m.code)}</td><td>${esc(x.m.desc)}</td><td class="nmc ${x.st === 'verified' ? '' : 'prov'}">${esc(x.c.nmc)}</td><td>${esc(x.action)}</td><td class="small ${x.st === 'verified' ? '' : 'muted'}">${MAPST[x.st]}</td></tr>`).join('')}
      </tbody></table></div>${rows.length > 300 ? `<p class="more">Showing 300 of ${fmt(rows.length)}. Download the CSV for the full list.</p>` : ''}</div>
      <aside class="side">${side}</aside></div></div>`;
}

/* ================= audit ================= */
function renderAudit(){
  const ch = S.chain;
  $('#audSheet').innerHTML = `<div class="sheet-head"><div><h2>Audit trail</h2><p>Every decision, who made it and when. Each entry carries a hash of the one before it, so an edited entry breaks the chain.</p></div>
      <div class="tools">${ch ? `<span class="chain ${ch.ok ? 'ok' : 'bad'}">${ch.ok ? `Chain intact, ${ch.n} entries` : `Chain broken at entry ${ch.at}`}</span>` : ''}<button class="btn" data-act="chain">Check chain</button><button class="btn" data-act="expAudit">Download audit log (CSV)</button></div></div>
    <div class="sheet-body">${store.audit.length ? `<div class="wrapx"><table class="t"><thead><tr><th class="num">#</th><th>Time</th><th>Person</th><th>Action</th><th>Item</th><th>Detail</th><th>Hash</th></tr></thead><tbody>
      ${store.audit.slice().reverse().map(e => `<tr><td class="num faint">${e.n}</td><td class="small">${when(e.t)}</td><td>${esc(e.actor)}<div class="faint small">${esc(e.role)}</div></td><td>${esc(e.action)}</td><td class="code">${esc(e.obj)}</td><td class="small muted">${esc(e.detail)}</td><td class="hash">${e.hash.slice(0, 12)}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty"><div><h3>No actions yet</h3><p>Run harmonization on the Overview. Every step and decision is recorded here.</p></div></div>`}</div>`;
}

/* ================= navigation and rendering ================= */
function renderAll(){
  if (document.body.classList.contains('auth') || S.view === 'login') { renderLogin(); return; }
  renderHeader();
  ({overview:renderOverview, sources:renderSources, check:renderCheck, review:renderReview, catalogue:renderCatalogue, savings:renderSavings, mapping:renderMapping, audit:renderAudit})[S.view]();
  Scene.refreshCores(); Scene.applyVisibility();
}
function go(v){
  S.view = v; S.editing = false; document.body.dataset.view = v;
  $$('.view').forEach(s => s.classList.toggle('active', s.id === 'v-' + v));
  closeMenu();
  if (v !== 'review') Scene.clearFocus();
  renderAll();
  requestAnimationFrame(() => Scene.setShift(v === 'review' && innerWidth > 900 ? Math.round($('#rvSheet').getBoundingClientRect().right / 2) : 0));
}
App.openCluster = cid => {
  if (!store.harmonized) { toast('Run harmonization first to see national codes.'); return; }
  const c = clusterById(cid); if (!c) return;
  const q = {proposed:'approve', approved:'verify', verified:'verified', hold:'hold'}[stOf(c)];
  if (q) S.qf = q;
  S.sel = cid; S.look = null; S.req = null; go('review');
};
App.openRecord = rid => { const c = ENG.byRec[rid]; if (c) App.openCluster(c.id); };
function closeMenu(){ $('#roleMenu').classList.remove('open'); $('#roleBtn').setAttribute('aria-expanded', 'false'); }


/* ================= permissions (the server enforces the same rules; these only give a quicker message) ================= */
const needMaker = () => { if (store.role === 'maker') return true; toast(store.role === 'auditor' ? 'The auditor account is read-only.' : 'Only the maker, Priya Menon, can do this. Switch account from the menu at the top right.'); return false; };
const needChecker = () => { if (store.role === 'checker') return true; toast(store.role === 'auditor' ? 'The auditor account is read-only.' : 'Only the checker, R. Iyer, can verify. Switch account from the menu at the top right.'); return false; };
const needOperator = () => { if (store.role !== 'auditor') return true; toast('The auditor account is read-only.'); return false; };
function nextAfter(cid){
  const items = queueItems(), i = items.findIndex(x => x.id === cid);
  return i >= 0 ? (items[i + 1] || items[i - 1] || null) : null;
}
async function decideApi(path, cid, body){
  const nxt = nextAfter(cid);
  const d = await call(path, body); if (!d) return;
  const items = queueItems();
  S.sel = nxt && items.some(x => x.id === nxt.id) ? nxt.id : (items[0] ? items[0].id : null);
  S.editing = false; applyState();
}
async function runHarmonization(){
  if (!store.harmonized) {
    if (!needOperator()) return;
    const d = await call('run/', undefined, {quiet:true}); if (!d) return;
    if (S.view !== 'overview') go('overview');
    Scene.harmonize(); renderAll();
    setTimeout(() => { if (d.toast) toast(d.toast); }, reduceMotion ? 0 : 2800);
  } else {
    if (S.view !== 'overview') go('overview');
    Scene.replay();
  }
}

/* ================= every button with data-act ================= */
let pendingTender = null;
async function act(a, el){
  const cid = el.dataset.cid;
  switch (a) {
    case 'run': return runHarmonization();
    case 'looks': S.qf = 'looks'; S.sel = null; S.look = null; S.req = null; return go('review');
    case 'approve': if (!needMaker()) return; return decideApi(`materials/${cid}/approve/`, cid);
    case 'bulk': { if (!needMaker()) return; const d = await call('materials/bulk-approve/'); if (d) { S.sel = null; applyState(); } return; }
    case 'reject': { if (!needMaker()) return; const d = await call(`materials/${cid}/reject/`); if (d) { S.sel = null; applyState(); } return; }
    case 'split': { if (!needMaker()) return; const d = await call(`records/${el.dataset.rid}/split/`); if (d) { S.sel = d.focus || null; applyState(); } return; }
    case 'attach': { if (!needMaker()) return; const d = await call(`records/${el.dataset.rid}/attach/`, {target:el.dataset.target}); if (d) { S.qf = 'approve'; S.sel = d.focus || null; applyState(); } return; }
    case 'edit': if (!needMaker()) return; S.editing = true; return renderReview();
    case 'cancelEdit': S.editing = false; return renderReview();
    case 'saveEdit': {
      if (!needMaker()) return;
      const txt = ($('#stdEdit').value || '').trim();
      if (txt.length < 8) return toast('Write the full standard description.');
      const d = await call(`materials/${cid}/edit/`, {text:txt}); if (d) { S.editing = false; applyState(); } return;
    }
    case 'verify': if (!needChecker()) return; return decideApi(`materials/${cid}/verify/`, cid);
    case 'sendback': if (!needChecker()) return; return decideApi(`materials/${cid}/sendback/`, cid, {note:($('#sbReason') ? $('#sbReason').value : '').trim()});
    case 'confirm': {
      if (!needMaker()) return;
      const items = queueItems(), i = items.findIndex(x => x.key === el.dataset.key);
      const d = await call('lookalikes/confirm/', {key:el.dataset.key}); if (!d) return;
      const rest = queueItems(); S.look = (rest[i] || rest[i - 1] || {}).key || null; applyState(); return;
    }
    case 'reset': {
      if (!needOperator()) return;
      if (!act.armed) { act.armed = true; setTimeout(() => { act.armed = false; }, 4000); return toast('Select Reset demo again to confirm.'); }
      act.armed = false;
      const d = await call('reset/'); if (!d) return;
      Object.assign(S, {sel:null, look:null, req:null, qf:store.role === 'checker' ? 'verify' : 'approve', mapSel:null, editing:false, chain:null, catQ:'', catCls:'', catSt:'', chkAn:null, reqAn:{}});
      S.chk.desc = ''; ['catSheet', 'chkSheet', 'savSheet'].forEach(id => { $('#' + id).dataset.built = ''; });
      closeMenu(); Scene.build(ENG, false); ENG.changed = false; Scene.scatter(); return go('overview');
    }
    case 'template': return download('/static/ekcode-material-extract-template.csv');
    case 'choose': if (!needMaker()) return; return $('#fileIn').click();
    case 'clearUploads': { if (!needMaker()) return; const d = await call('uploads/', undefined, {method:'DELETE'}); if (d) applyState(); return; }
    case 'expCat': return download('/api/export/catalogue/?' + new URLSearchParams({q:S.catQ, cls:S.catCls, st:S.catSt}));
    case 'expMap': return download('/api/export/mapping/?company=' + encodeURIComponent(S.mapCpse));
    case 'expSap': {
      const rows = mappingRows().filter(x => x.st === 'verified' && (S.mapCpse === 'ALL' || x.m.cpse === S.mapCpse));
      if (!rows.length) return toast('No verified codes yet. The checker verifies codes in Review.');
      return download('/api/export/sap/?company=' + encodeURIComponent(S.mapCpse));
    }
    case 'expApi': { const r = S.mapSel && ENG.byId[S.mapSel]; if (!r) return toast('Pick a row first.'); return download(`/api/export/api/${encodeURIComponent(r.id)}/`); }
    case 'mapBack': S.mapSel = null; return renderMapping();
    case 'chain': try { S.chain = await api('audit/verify/'); } catch (e) { return toast(e.message); } return renderAudit();
    case 'expAudit': if (!store.audit.length) return toast('The audit trail is empty.'); return download('/api/export/audit/');
    case 'find': return openFind();
    case 'signout': return signOut();
    case 'demoSwitch': return demoSwitch(el.dataset.uid);
    case 'pwToggle': { const i = $('#lgPw'); if (!i) return; const show = i.type === 'password'; i.type = show ? 'text' : 'password'; el.textContent = show ? 'Hide' : 'Show'; el.setAttribute('aria-pressed', show); return; }
    case 'fill': { const k = el.dataset.uid; L.email = USERS[k].email; L.err = ''; renderLogin(); $('#lgPw').value = 'EkCode@2026'; $('#lgPw').focus(); return; }
    case 'sso': L.step = 'sso'; L.err = ''; return renderLogin();
    case 'ssoPick': return ssoPick(el.dataset.uid);
    case 'otpFill': { const i = $('#otpIn'); if (i) { i.value = L.demo; i.focus(); } return; }
    case 'otpResend': return resendOtp();
    case 'lgBack': L.step = 'pw'; L.err = ''; return renderLogin();
    case 'chipEx': S.chk.desc = el.dataset.text; $('#chkDesc').value = S.chk.desc; return runCheck();
    case 'reuse': {
      if (!needOperator()) return;
      const d = await call('check/reuse/', {cid, desc:S.chk.desc.trim(), company:S.chk.cpse}); if (!d) return;
      S.chk.desc = ''; $('#chkDesc').value = ''; S.chkAn = null; renderCheckOut(); renderHeader(); return;
    }
    case 'request': {
      if (!needOperator()) return;
      const desc = S.chk.desc.trim(); if (desc.length < 3) return toast('Describe the part first.');
      const whyEl = $('#reqWhy'), why = whyEl ? whyEl.value.trim() : '';
      if (whyEl && why.length < 5) { whyEl.focus(); return toast('Add a short reason: similar materials already exist or a key attribute is missing.'); }
      const d = await call('requests/', {desc, company:S.chk.cpse, uom:S.chk.uom, reason:why}); if (!d) return;
      S.chk.desc = ''; $('#chkDesc').value = ''; S.chkAn = null; renderCheckOut(); renderHeader(); return;
    }
    case 'approveReq': { if (!needMaker()) return; const d = await call(`requests/${el.dataset.req}/approve/`); if (d) { S.req = null; applyState(); } return; }
    case 'rejectReq': { if (!needMaker()) return; const d = await call(`requests/${el.dataset.req}/reject/`, {reason:($('#rejWhy') ? $('#rejWhy').value : '').trim()}); if (d) { S.req = null; applyState(); } return; }
    case 'reuseReq': { if (!needMaker()) return; const d = await call(`requests/${el.dataset.req}/reuse/`, {cid}); if (d) { S.req = null; applyState(); } return; }
    case 'tender': {
      const x = savingsRows().find(y => y.c.id === cid); if (!x) return;
      pendingTender = x;
      return openDialog(`Joint tender draft: ${x.c.nmc}`, `<pre class="codeblock" style="white-space:pre-wrap">${esc(tenderText(x))}</pre>`,
        `<button class="btn" data-act="closeDlg">Close</button><button class="btn primary" data-act="tenderDl">Download (TXT)</button>`);
    }
    case 'tenderDl': if (!pendingTender) return; return download(`/api/export/tender/${encodeURIComponent(pendingTender.c.id)}/?disc=${S.disc}`);
    case 'closeDlg': return closeDialog();
    case 'expSav': return download('/api/export/savings/?disc=' + S.disc);
    case 'expFix': return download('/api/export/enrichment/');
  }
}

/* ================= CSV upload (parsed and matched on the server) ================= */
async function readFile(f){
  if (!needMaker()) return;
  if (!/\.csv$/i.test(f.name)) { toast('Choose a .csv file. The template shows the columns.'); return; }
  const form = new FormData(); form.append('file', f);
  try { const d = await api('uploads/', {method:'POST', form}); hydrate(d.state); applyState(); toast(d.toast); }
  catch (e) { toast(e.message); }
}

/* ================= sign-in (Django sessions; the one-time code is checked on the server) ================= */
const blankLogin = () => ({step:'pw', email:'', keep:true, lockUntil:0, mobile:'', demo:'', err:'', busy:false});
let L = blankLogin(), lockTimer = null;
function renderLogin(){
  const f = store.facts || {};
  $('#lgFacts').innerHTML = `<div><dt>${fmt(f.records || 0)}</dt><dd>legacy codes across four company ERPs</dd></div><div><dt>${fmt(f.materials || 0)}</dt><dd>materials once duplicates are fused</dd></div><div><dt>${Math.round((f.precision || 0) * 100)}%</dt><dd>precision on the sample answer key; unclear records wait for a person</dd></div>`;
  const card = $('#lgCard'), locked = Date.now() < L.lockUntil, secs = Math.ceil((L.lockUntil - Date.now()) / 1000);
  const err = L.err ? `<div class="form-err" role="alert">${esc(L.err)}</div>` : '';
  if (L.step === 'otp') {
    card.innerHTML = `<h2>Enter the code</h2><p class="sub">A 6-digit code went to the mobile number ending ${esc(L.mobile)}. It works for 2 minutes.</p>${err}
      ${L.demo ? `<div class="demo-code"><span>Demo, no SMS is sent. Code: <b>${esc(L.demo)}</b></span><button class="btn sm" type="button" data-act="otpFill">Fill it in</button></div>` : ''}
      <form id="otpForm" novalidate><label class="fld"><span>One-time code</span><input class="in otp-in" id="otpIn" name="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" aria-describedby="otpHelp"></label>
      <p class="small faint" id="otpHelp" style="margin:-6px 0 14px">Three wrong codes send you back to the password step.</p>
      <button class="btn primary lg w-full" type="submit">Verify and sign in</button></form>
      <div class="lg-links"><button class="linkbtn" type="button" data-act="otpResend">Send a new code</button><button class="linkbtn" type="button" data-act="lgBack">Use a different account</button></div>`;
    return;
  }
  if (L.step === 'sso') {
    card.innerHTML = `<h2>Jan Parichay</h2><p class="sub">Simulated government single sign-on. Pick the account to continue; the identity provider handles the second factor.</p>${err}
      ${['maker', 'checker', 'auditor'].map(k => `<button class="acc-row" type="button" data-act="ssoPick" data-uid="${k}"><span class="av" style="background:${USERS[k].color}">${USERS[k].init}</span><span>${esc(USERS[k].name)}<small>${esc(USERS[k].email)}</small></span></button>`).join('')}
      <div class="lg-links"><button class="linkbtn" type="button" data-act="lgBack">Back to password sign-in</button></div>`;
    return;
  }
  card.innerHTML = `<h2>Sign in</h2><p class="sub">Use your official email. Every sign-in is written to the audit trail.</p>${err}
    <form id="lgForm" novalidate>
      <label class="fld"><span>Official email</span><input class="in" id="lgEmail" name="email" type="email" autocomplete="username" value="${esc(L.email)}" placeholder="name@organisation.gov.in"></label>
      <label class="fld"><span>Password</span><span class="pwwrap"><input class="in" id="lgPw" name="pw" type="password" autocomplete="current-password"><button type="button" data-act="pwToggle" aria-pressed="false">Show</button></span></label>
      <label class="check"><input type="checkbox" name="keep"${L.keep ? ' checked' : ''}> Keep me signed in on this device</label>
      <button class="btn primary lg mt-4 w-full" type="submit"${locked ? ' disabled' : ''}>${locked ? `Locked. Try again in ${secs} s` : 'Continue'}</button>
    </form>
    <div class="or">or</div>
    <button class="btn w-full" type="button" data-act="sso">Continue with Jan Parichay (simulated)</button>
    <div class="demo-acc"><p>Demo accounts. The password for all three is EkCode@2026</p>
      ${['maker', 'checker', 'auditor'].map(k => `<button class="acc-row" type="button" data-act="fill" data-uid="${k}"><span class="av" style="background:${USERS[k].color}">${USERS[k].init}</span><span>${esc(USERS[k].name)}<small>${esc(USERS[k].title)}</small></span></button>`).join('')}</div>`;
}
function startLockTimer(){
  clearInterval(lockTimer);
  lockTimer = setInterval(() => { if (Date.now() >= L.lockUntil) { clearInterval(lockTimer); L.err = ''; } if (S.view === 'login' && L.step === 'pw') renderLogin(); }, 1000);
}
const focusSoon = sel => setTimeout(() => { const i = $(sel); if (i) i.focus(); }, 0);
// Show that the click registered while the server checks the password (password hashing is slow on purpose).
const busyButton = (sel, label) => { const btn = $(sel); if (btn) { btn.disabled = true; btn.textContent = label; } };
async function doPassword(fd){
  if (Date.now() < L.lockUntil || L.busy) return;
  const email = String(fd.get('email') || '').trim().toLowerCase(), pw = String(fd.get('pw') || '');
  L.email = email; L.keep = !!fd.get('keep');
  if (!email || !pw) { L.err = 'Enter your official email and password.'; renderLogin(); return; }
  L.busy = true; busyButton('#lgForm button[type=submit]', 'Checking…');
  try {
    const d = await api('auth/login/', {method:'POST', body:{email, pw, keep:L.keep}});
    Object.assign(L, {err:'', step:'otp', mobile:d.mobile || '', demo:d.demoCode || ''});
    renderLogin(); focusSoon('#otpIn');
  } catch (e) {
    L.err = e.message;
    if (e.status === 423 && e.data && e.data.lockUntil) { L.lockUntil = e.data.lockUntil; startLockTimer(); }
    renderLogin(); focusSoon('#lgPw');
  } finally { L.busy = false; }
}
async function doOtp(code){
  if (L.busy) return; L.busy = true; busyButton('#otpForm button[type=submit]', 'Checking…');
  try { enterApp(await api('auth/otp/', {method:'POST', body:{code:String(code || '')}})); }
  catch (e) { L.err = e.message; if (e.data && e.data.restart) L.step = 'pw'; renderLogin(); focusSoon(L.step === 'otp' ? '#otpIn' : '#lgPw'); }
  finally { L.busy = false; }
}
async function resendOtp(){
  try { const d = await api('auth/otp/resend/', {method:'POST', body:{}}); L.demo = d.demoCode || ''; L.err = ''; renderLogin(); toast('A new code was sent.'); }
  catch (e) { L.err = e.message; if (e.data && e.data.restart) L.step = 'pw'; renderLogin(); }
}
async function ssoPick(uid){
  try { enterApp(await api('auth/sso/', {method:'POST', body:{uid}})); } catch (e) { L.err = e.message; renderLogin(); }
}
function enterApp(d){
  hydrate(d.state);
  document.body.classList.remove('auth'); clearInterval(lockTimer);
  Object.assign(S, {qf:store.role === 'checker' ? 'verify' : 'approve', sel:null, look:null, req:null, editing:false, chkAn:null, reqAn:{}, chain:null});
  ['catSheet', 'chkSheet', 'savSheet'].forEach(id => { $('#' + id).dataset.built = ''; });
  L = blankLogin();
  Scene.build(ENG, store.harmonized); ENG.changed = false;
  go('overview');
  if (d.toast) toast(d.toast);
}
function showLogin(){
  closeMenu(); closeFind(); closeDialog();
  document.body.classList.add('auth'); S.view = 'login'; document.body.dataset.view = 'login';
  Scene.clearFocus(); Scene.setShift(0);
  const keepEmail = L.email; L = blankLogin(); L.email = keepEmail;
  renderLogin();
}
async function signOut(){
  const email = store.me ? store.me.email : '';
  try { await api('auth/logout/', {method:'POST', body:{}}); } catch (e) {}
  store.me = null; L.email = email; showLogin(); toast('Signed out.');
}
async function demoSwitch(uid){
  if (!USERS[uid] || uid === store.role) return;
  try { enterApp(await api('auth/switch/', {method:'POST', body:{uid}})); } catch (e) { toast(e.message); }
}

/* ================= check a part: the server's engine reads the description as you type ================= */
let chkT = null, chkSeq = 0;
function queueCheck(){ clearTimeout(chkT); chkT = setTimeout(runCheck, 200); }
async function runCheck(){
  const d = S.chk.desc.trim();
  if (!store.harmonized || d.length < 3) { S.chkAn = null; renderCheckOut(); return; }
  const my = ++chkSeq;
  try { const an = await api('check/', {method:'POST', body:{desc:d}}); if (my !== chkSeq) return; S.chkAn = {desc:d, an}; }
  catch (e) { if (my !== chkSeq) return; if (sessionGone(e)) { store.me = null; showLogin(); return; } S.chkAn = {desc:d, err:e.message}; }
  renderCheckOut();
}
function renderCheckOut(){
  const out = $('#chkOut'); if (!out) return;
  $('#chkKpis').innerHTML = `<div class="kpi"><b>${fmt(store.prevented)}</b><span>duplicates stopped</span></div><div class="kpi"><b>${fmt(store.requests.filter(r => r.status === 'requested').length)}</b><span>new-code requests open</span></div>`;
  if (!store.harmonized) { out.innerHTML = notYet('Check a part'); return; }
  const d = S.chk.desc.trim();
  if (d.length < 3) { out.innerHTML = `<div class="empty"><div><h3>Start typing a description</h3><p>Size, pressure class, grade, material and standard make the check exact. Abbreviations like GT VLV, CS or FLGD are fine.</p></div></div>`; return; }
  const res = S.chkAn;
  if (!res) { out.innerHTML = `<div class="empty"><div><h3>Reading the description</h3><p>Matching it against every national material.</p></div></div>`; return; }
  if (res.desc !== d) return;   // keep the last answer on screen until the new one arrives
  if (res.err) { out.innerHTML = `<div class="verdict warn"><h3>Could not check this part</h3><p>${esc(res.err)}</p></div>`; return; }
  const an = res.an, canAct = store.role !== 'auditor';
  if (!an.cls) {
    out.innerHTML = `<div class="verdict warn"><h3>Not recognised yet</h3><p>This prototype reads gate, globe and ball valves, centrifugal pumps, bearings, bolts, nuts and power cables. You can still request a new code, and the maker will classify it by hand.</p></div>${requestBox(d, false, canAct)}`;
    return;
  }
  const sch = SCHEMA[CLASSES[an.cls].group], missingKey = sch.filter(f => an.missingKey.includes(f.k)), exact = an.exact || [];
  const stdFor = x => { const c = clusterById(x.cid); return c ? stdOf(c) : x.std; };
  let verdict;
  if (exact.length) verdict = `<div class="verdict stop"><h3>Already exists. Use ${esc(exact[0].nmc)}.</h3><p>${esc(stdFor(exact[0]))}. Held by ${exact[0].companies.map(k => esc(cpseById(k).name)).join(', ')}.</p></div>`;
  else if (missingKey.length) verdict = `<div class="verdict warn"><h3>Add the ${esc(missingKey.map(f => f.label.toLowerCase()).join(' and '))}</h3><p>Without it, ${an.matches.length} material${an.matches.length === 1 ? '' : 's'} could fit. EkCode will not guess.</p></div>`;
  else if (an.matches.length) verdict = `<div class="verdict warn"><h3>Similar materials exist</h3><p>Nothing identical, but check these before asking for a new code.</p></div>`;
  else verdict = `<div class="verdict new"><h3>No existing material matches</h3><p>This looks new to all four companies. Request a national code below.</p></div>`;
  const chips = sch.filter(f => !f.brand || an.a.brand).map(f => an.a[f.k] != null
    ? `<span class="attr"><small>${esc(f.label)}</small>${esc(fmtVal(f.k, an.a[f.k]))}</span>`
    : `<span class="attr miss${f.key ? ' key' : ''}"><small>${esc(f.label)}${f.key ? ', needed to match' : ''}</small>not stated</span>`).join('');
  const list = an.matches.map(x => `<div class="mrow"><div><div class="m1">${esc(stdFor(x))}</div><div class="m2"><span class="nmc ${x.status === 'verified' ? '' : 'prov'}">${esc(x.nmc)}</span><span class="pill t-${x.type}">${TYPE_LABEL[x.type]}</span><span class="dots">${x.companies.map(dot).join('')}</span><span>${x.score}% match</span></div></div>
    <div>${canAct ? `<button class="btn sm${x.type === 'duplicate' && !x.keyMissing ? ' primary' : ''}" data-act="reuse" data-cid="${x.cid}">Use this code</button>` : ''}</div></div>`).join('');
  out.innerHTML = `${verdict}
    <div class="block"><h3>What EkCode read</h3><div class="attrs">${chips}</div><p class="small muted" style="margin-top:8px">Class ${esc(CLASSES[an.cls].name.toLowerCase())}. ${an.dq}% of attributes stated.</p></div>
    <div class="block"><h3>Standard description it would get</h3><p class="std" style="font:700 18px/1.25 var(--display);letter-spacing:.02em">${esc(an.std)}</p></div>
    ${an.matches.length ? `<div class="block"><h3>Existing materials</h3>${list}</div>` : ''}
    ${exact.length ? '' : requestBox(d, an.matches.length > 0 || missingKey.length > 0, canAct)}`;
}

/* ================= new-code requests ================= */
async function loadReqAn(r){
  if (S.reqAn[r.id]) return;
  S.reqAn[r.id] = {loading:true};
  try { S.reqAn[r.id] = {an:await api('check/', {method:'POST', body:{desc:r.desc}})}; }
  catch (e) { S.reqAn[r.id] = {err:e.message}; }
  if (S.view === 'review' && S.req === r.id) { const box = $('#rvDetail'); if (box) box.innerHTML = detailHtml(); }
}
function reqDetail(r){
  if (!r) return `<div class="empty"><div><h3>Pick a request</h3></div></div>`;
  const cached = S.reqAn[r.id]; if (!cached) loadReqAn(r);
  const an = cached && cached.an, maker = store.role === 'maker';
  const read = !cached || cached.loading ? '<p class="muted">Reading the description…</p>'
    : cached.err ? `<p class="muted">${esc(cached.err)}</p>`
    : an.cls ? `<p class="std" style="font:700 17px/1.25 var(--display);letter-spacing:.02em">${esc(an.std)}</p><p class="small muted">${an.dq}% of attributes stated${an.missingKey.length ? `. Missing: ${esc(an.missingKey.join(', '))}` : ''}.</p>`
    : '<p class="muted">Not recognised. Classify it by hand before approving.</p>';
  const matches = an && an.cls ? an.matches.slice(0, 3) : [];
  return `<div class="meta-row"><span class="pill s-proposed">New code request</span><span class="code">${esc(r.id)}</span></div>
    <h2>${esc(r.desc)}</h2>
    <div class="meta-row"><span>${dot(r.cpse)} ${esc(cpseById(r.cpse).name)}</span><span>Asked by <b>${esc(r.by)}</b>, ${when(r.at)}</span><span>Unit <b>${esc(r.uom)}</b></span></div>
    ${r.reason ? `<p class="small muted" style="margin-top:8px">Reason given: "${esc(r.reason)}"</p>` : ''}
    <div class="block"><h3>What EkCode read</h3>${read}</div>
    ${matches.length ? `<div class="block"><h3>Existing materials that look similar</h3>${matches.map(x => `<div class="mrow"><div><div class="m1">${esc(x.std)}</div><div class="m2"><span class="nmc prov">${esc(x.nmc)}</span><span class="pill t-${x.type}">${TYPE_LABEL[x.type]}</span><span>${x.score}% match</span></div></div><div>${maker ? `<button class="btn sm" data-act="reuseReq" data-req="${r.id}" data-cid="${x.cid}">Use this instead</button>` : ''}</div></div>`).join('')}</div>` : ''}
    <div class="actions">${maker ? `<button class="btn primary" data-act="approveReq" data-req="${r.id}">Create the new code</button><input class="in" id="rejWhy" placeholder="Reason for rejecting" aria-label="Reason for rejecting" style="flex:1;min-width:180px"><button class="btn bad" data-act="rejectReq" data-req="${r.id}">Reject request</button>`
      : `<span class="note">${store.role === 'auditor' ? 'Read-only.' : 'The maker decides on new-code requests.'}</span>`}</div>`;
}

// Example chips come from the live catalogue, so the first ones always show a real match.
function examples(){
  const ex = [], full = (c, keys) => c.members.length >= 3 && keys.every(k => c.golden[k] != null);
  const v = ENG.clusters.find(c => c.cls === 'VGT' && full(c, ['size', 'rating', 'material', 'end', 'standard']));
  if (v) { const g = v.golden; ex.push(`${INCH[g.size]} inch gate valve ${g.material} class ${g.rating} ${ENDN[g.end].toLowerCase()} ${g.standard}`); }
  const br = ENG.clusters.find(c => c.cls === 'BRG' && c.golden.designation < 20000 && full(c, ['designation', 'seal']));
  if (br) { const g = br.golden; ex.push(`Bearing ${g.designation}${g.seal !== 'OPEN' ? '-' + g.seal : ' open'}${g.clearance ? ' ' + g.clearance : ''}`); }
  const bl = ENG.clusters.find(c => c.cls === 'BLT' && full(c, ['thread', 'length', 'grade', 'finish', 'standard']));
  if (bl) { const g = bl.golden; ex.push(`Hex bolt M${g.thread} x ${g.length} grade ${g.grade} ${{HDG:'HDG', ZINC:'zinc plated', PLAIN:'plain'}[g.finish]} ${g.standard}`); }
  ex.push('Globe valve 4 inch A105 flanged RF', '4 core 16 sqmm copper armoured cable 1.1kV', 'Butterfly valve 12 inch rubber lined');
  return ex;
}
function renderCheck(){
  const el = $('#chkSheet');
  if (!el.dataset.built) {
    el.innerHTML = `<div class="sheet-head"><div><h2>Check a part</h2><p>Describe a part the way you would in your ERP. EkCode reads it as you type and shows any national code that already exists, so no one creates a duplicate.</p></div></div>
      <div class="sheet-body"><div class="chk">
        <form id="chkForm" novalidate>
          <label class="fld"><span>Part description</span><textarea class="in" id="chkDesc" placeholder="For example: 2 inch gate valve A105 class 150 flanged RF"></textarea></label>
          <div class="row"><label class="fld"><span>Company</span><select class="in" id="chkCpse">${CPSES.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
          <label class="fld"><span>Unit</span><select class="in" id="chkUom"><option value="EA">Each (EA)</option><option value="M">Metre (M)</option><option value="KG">Kilogram (KG)</option></select></label></div>
          <p class="small faint">Try one of these</p><div class="chips">${examples().map(x => `<button type="button" class="chip" data-act="chipEx" data-text="${esc(x)}">${esc(x)}</button>`).join('')}</div>
          <div class="kpis" id="chkKpis"></div>
        </form>
        <div id="chkOut" aria-live="polite"></div></div></div>`;
    el.dataset.built = '1';
    $('#chkDesc').value = S.chk.desc; $('#chkCpse').value = S.chk.cpse; $('#chkUom').value = S.chk.uom;
  }
  renderCheckOut();
  if (S.chk.desc.trim().length >= 3 && (!S.chkAn || S.chkAn.desc !== S.chk.desc.trim())) queueCheck();
}

function requestBox(desc, needReason, canAct){
  if (!canAct) return `<p class="note small faint" style="margin-top:16px">Read-only. The auditor account cannot raise requests.</p>`;
  return `<div class="block"><h3>Request a new national code</h3>
    ${needReason ? `<label class="fld"><span>Why is a new code needed?</span><input class="in" id="reqWhy" placeholder="For example: different service rating, not interchangeable"></label>` : ''}
    <button class="btn primary" data-act="request">Request a new code</button></div>`;
}


/* ================= data-fix suggestions ================= */
function enrichment(){
  const out = [];
  ENG.clusters.forEach(c => {
    if (c.members.length < 2 || !c.cls) return;
    const sch = SCHEMA[CLASSES[c.cls].group];
    c.members.forEach(m => sch.forEach(f => { if (!f.brand && m.a[f.k] == null && c.golden[f.k] != null) out.push({m, c, f, value:c.golden[f.k]}); }));
  });
  return out;
}
function fixesHtml(){
  if (!store.harmonized) return '';
  const fx = enrichment(); if (!fx.length) return '';
  const by = {}; fx.forEach(x => { by[x.m.cpse] = (by[x.m.cpse] || 0) + 1; });
  return `<div class="fixes"><div class="src-top" style="align-items:flex-end;flex-wrap:wrap"><div><h3>Fixes EkCode can suggest</h3><p class="small muted">${fx.length} missing attributes can be filled in from matched records: ${Object.entries(by).map(([k, v]) => `${esc(cpseById(k).short)} ${v}`).join(', ')}.</p></div>
    <button class="btn" data-act="expFix">Download enrichment file (CSV)</button></div>
    <div class="wrapx" style="margin-top:10px"><table class="t"><thead><tr><th>Legacy code</th><th>Description as written</th><th>Missing</th><th>Suggested value</th><th>From</th></tr></thead><tbody>
    ${fx.slice(0, 8).map(x => `<tr><td style="white-space:nowrap">${dot(x.m.cpse)} <span class="code">${esc(x.m.code)}</span></td><td>${esc(x.m.desc)}</td><td>${esc(x.f.label)}</td><td><b>${esc(fmtVal(x.f.k, x.value))}</b></td><td class="nmc prov">${esc(x.c.nmc)}</td></tr>`).join('')}
    </tbody></table></div>${fx.length > 8 ? `<p class="more">Showing 8 of ${fx.length}. The download has all of them.</p>` : ''}</div>`;
}


/* ================= savings planner ================= */
function savingsRows(){
  return ENG.clusters.map(c => {
    const priced = c.members.filter(m => m.unitPrice > 0 && m.annualQty > 0), cps = uniq(priced.map(m => m.cpse));
    if (cps.length < 2) return null;
    const qty = priced.reduce((t, m) => t + m.annualQty, 0), spend = priced.reduce((t, m) => t + m.annualQty * m.unitPrice, 0);
    const minP = Math.min(...priced.map(m => m.unitPrice)), best = priced.find(m => m.unitPrice === minP);
    const atBest = qty * minP, pooled = atBest * (1 - S.disc / 100);
    return {c, priced, cps, qty, spend, minP, best, saveBest:spend - atBest, savePool:spend - pooled, unit:priced[0].baseUom === 'M' ? 'm' : 'ea'};
  }).filter(Boolean).sort((x, y) => y.savePool - x.savePool);
}
function shareRows(){
  const out = [];
  ENG.clusters.forEach(c => {
    const by = {};
    c.members.forEach(m => { const b = by[m.cpse] = by[m.cpse] || {qty:0, annual:0, price:0}; b.qty += m.qty; b.annual += m.annualQty; b.price = Math.max(b.price, m.unitPrice); });
    const ent = Object.entries(by); if (ent.length < 2) return;
    const donors = ent.filter(([, b]) => b.annual > 0 && b.qty > 1.5 * b.annual).map(([cp, b]) => ({cp, b, surplus:b.qty - b.annual}));
    const takers = ent.filter(([, b]) => b.annual > 0 && b.qty < .5 * b.annual).map(([cp, b]) => ({cp, b, need:b.annual - b.qty}));
    donors.forEach(dn => takers.forEach(tk => {
      const q = Math.floor(Math.min(dn.surplus, tk.need));
      if (q >= 1) out.push({c, from:dn.cp, to:tk.cp, qty:q, value:q * (tk.b.price || dn.b.price), unit:c.members[0].baseUom === 'M' ? 'm' : 'ea'});
    }));
  });
  return out.sort((x, y) => y.value - x.value);
}
function renderSavings(){
  const el = $('#savSheet');
  if (!store.harmonized) { el.dataset.built = ''; el.innerHTML = notYet('The savings planner'); return; }
  if (!el.dataset.built) {
    el.innerHTML = `<div class="sheet-head"><div><h2>Savings</h2><p>Buy shared materials together at the best price any company already gets, and move spare stock between companies before buying more.</p></div>
      <div class="tools"><button class="btn" data-act="expSav">Download opportunities (CSV)</button></div></div>
      <div class="sheet-body"><div class="kpis" id="savKpis"></div>
        <div class="slider"><label for="discIn">Extra discount expected from pooled tenders</label><input type="range" id="discIn" min="0" max="15" step="1" value="${S.disc}"><b id="discVal">${S.disc}%</b><span class="small faint">An assumption. Set it to your procurement team's estimate.</span></div>
        <div class="two"><div><h3 style="font:700 19px var(--display);margin-bottom:8px">Buy together</h3><div class="wrapx" id="savTable"></div></div>
        <div><h3 style="font:700 19px var(--display);margin-bottom:8px">Share spares first</h3><div class="wrapx" id="shareTable"></div></div></div></div>`;
    el.dataset.built = '1';
  }
  renderSavingsBody();
}
function renderSavingsBody(){
  const rows = savingsRows(), share = shareRows();
  const spend = rows.reduce((t, x) => t + x.spend, 0), best = rows.reduce((t, x) => t + x.saveBest, 0), pool = rows.reduce((t, x) => t + x.savePool, 0), avoid = share.reduce((t, x) => t + x.value, 0);
  $('#discVal').textContent = S.disc + '%';
  $('#savKpis').innerHTML = `<div class="kpi"><b>${inr(spend)}</b><span>yearly spend on materials two or more companies buy</span></div>
    <div class="kpi"><b>${inr(best)}</b><span>saved a year if all pay today's lowest price</span></div>
    <div class="kpi"><b style="color:var(--amber)">${inr(pool)}</b><span>saved a year with pooled tenders at ${S.disc}% extra</span></div>
    <div class="kpi"><b>${inr(avoid)}</b><span>of purchases avoided by moving spare stock</span></div>`;
  $('#savTable').innerHTML = `<table class="t"><thead><tr><th>Material</th><th>Buyers</th><th class="num">Yearly qty</th><th class="num">Lowest price</th><th class="num">Saving a year</th><th></th></tr></thead><tbody>
    ${rows.slice(0, 20).map(x => `<tr><td><div class="nmc ${stOf(x.c) === 'verified' ? '' : 'prov'}" style="font-size:13.5px">${esc(x.c.nmc)}</div><div class="small">${esc(x.c.short)}</div></td><td><span class="dots">${x.cps.map(dot).join('')}</span></td><td class="num">${fmt(x.qty)} ${x.unit}</td><td class="num">${inr(x.minP)}<div class="faint small">${esc(cpseById(x.best.cpse).short)}</div></td><td class="num"><b>${inr(x.savePool)}</b></td><td><button class="btn sm" data-act="tender" data-cid="${x.c.id}">Draft tender</button></td></tr>`).join('')}
    </tbody></table>${rows.length > 20 ? `<p class="more">Top 20 of ${rows.length}. The download has all of them.</p>` : ''}`;
  $('#shareTable').innerHTML = share.length ? `<table class="t"><thead><tr><th>Material</th><th>Move</th><th class="num">Qty</th><th class="num">Purchase avoided</th></tr></thead><tbody>
    ${share.slice(0, 14).map(x => `<tr><td><div class="small"><b>${esc(x.c.short)}</b></div><div class="nmc prov" style="font-size:12.5px">${esc(x.c.nmc)}</div></td><td style="white-space:nowrap">${dot(x.from)} ${esc(cpseById(x.from).short)} to ${dot(x.to)} ${esc(cpseById(x.to).short)}</td><td class="num">${fmt(x.qty)} ${x.unit}</td><td class="num">${inr(x.value)}</td></tr>`).join('')}
    </tbody></table><p class="more">A company holding more than 1.5 years of stock lends to one holding less than half a year.</p>` : `<p class="empty-note">No company holds surplus that another company is short of.</p>`;
}
function tenderText(x){
  const g = CLASSES[x.c.cls];
  const lines = x.cps.map(cp => { const ms = x.priced.filter(m => m.cpse === cp), q = ms.reduce((t, m) => t + m.annualQty, 0), p = ms[0]; return `  ${cpseById(cp).name}, ${cpseById(cp).city}: ${fmt(q)} ${x.unit} a year (pays ${inr(p.unitPrice)}/${x.unit} under code ${p.code})`; });
  return `DRAFT JOINT TENDER BRIEF, generated by EkCode for discussion

Item              ${x.c.nmc}
Specification     ${stdOf(x.c)}
SAP short text    ${x.c.short}
UNSPSC class      ${g.unspsc} ${g.unspscName}
Combined demand   ${fmt(x.qty)} ${x.unit} a year

Consignees
${lines.join('\n')}

Benchmark         ${inr(x.minP)}/${x.unit}, the lowest price already paid (${cpseById(x.best.cpse).name})
Current spend     ${inr(x.spend)} a year
Saving at benchmark               ${inr(x.saveBest)} a year
Saving with ${S.disc}% pooled discount     ${inr(x.savePool)} a year (assumption)

Suggested terms to discuss: technically compliant bids against the national specification,
evaluation on landed cost per consignee, and a rate contract so each company orders against it.
Confirm quantities with each company before issue.`;
}


/* ================= quick find and dialog ================= */
function openFind(){
  if (document.body.classList.contains('auth')) return;
  closeMenu(); $('#findOv').hidden = false; S.findIdx = 0;
  const i = $('#findIn'); i.value = ''; renderFind(); setTimeout(() => i.focus(), 0);
}
function closeFind(){ $('#findOv').hidden = true; }
function findResults(){
  const toks = ($('#findIn').value || '').trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  return ENG.clusters.filter(c => { const hay = [c.nmc, stdOf(c), c.short, ...c.members.map(m => m.code + ' ' + m.desc.toUpperCase())].join(' '); return toks.every(t => hay.includes(t)); }).slice(0, 8);
}
function renderFind(){
  const res = $('#findRes');
  if (!store.harmonized) { res.innerHTML = `<p class="find-hint">Run harmonization first, then search national codes and legacy codes here.</p>`; return; }
  const rs = findResults();
  if (!($('#findIn').value || '').trim()) { res.innerHTML = `<p class="find-hint">Try a legacy code such as ${esc(ENG.recs[0].code)}, a national code, or words like gate valve DN50.</p>`; return; }
  S.findIdx = Math.max(0, Math.min(S.findIdx, rs.length - 1));
  res.innerHTML = rs.length ? rs.map((c, i) => `<button class="fr" role="option" data-fr="${c.id}" aria-selected="${i === S.findIdx}"><div class="fr1">${esc(stdOf(c))}</div><div class="fr2"><span class="nmc ${stOf(c) === 'verified' ? '' : 'prov'}">${esc(c.nmc)}</span><span class="dots">${uniq(c.members.map(m => m.cpse)).map(dot).join('')}</span><span>${c.members.length} code${c.members.length > 1 ? 's' : ''}</span><span>${STATUS_LABEL[stOf(c)]}</span></div></button>`).join('')
    : `<p class="find-hint">No material matches. Check a part lets you look up a description by its attributes.</p>`;
}
function openDialog(title, body, actions){
  $('#dlgTitle').textContent = title; $('#dlgBody').innerHTML = body; $('#dlgActs').innerHTML = actions;
  $('#dlgOv').hidden = false; setTimeout(() => { const b = $('#dlgActs button'); if (b) b.focus(); }, 0);
}
function closeDialog(){ $('#dlgOv').hidden = true; }


/* ================= events ================= */
function moveSel(d){
  const items = queueItems(); if (!items.length) return;
  const key = S.qf === 'looks' ? S.look : S.qf === 'requests' ? S.req : S.sel;
  const ids = items.map(x => S.qf === 'looks' ? x.key : x.id);
  let i = ids.indexOf(key); i = Math.max(0, Math.min(ids.length - 1, (i < 0 ? 0 : i + d)));
  if (S.qf === 'looks') S.look = ids[i]; else if (S.qf === 'requests') S.req = ids[i]; else S.sel = ids[i];
  S.editing = false; renderReview();
  const cur = $('.qi[aria-current="true"]'); if (cur) cur.scrollIntoView({block:'nearest'});
}
document.addEventListener('click', e => {
  if (e.target.id === 'findOv') return closeFind();
  if (e.target.id === 'dlgOv') return closeDialog();
  const b = e.target.closest('button, tr[data-cid], tr[data-rec]');
  if (!e.target.closest('.role')) closeMenu();
  if (!b) return;
  if (b.id === 'roleBtn') { const m = $('#roleMenu'), open = !m.classList.contains('open'); m.classList.toggle('open', open); b.setAttribute('aria-expanded', open); return; }
  if (b.dataset.fr) { closeFind(); return App.openCluster(b.dataset.fr); }
  if (b.dataset.view) return go(b.dataset.view);
  if (b.dataset.cpse) { S.hidden[b.dataset.cpse] = !S.hidden[b.dataset.cpse]; Scene.applyVisibility(); return renderOverview(); }
  if (b.dataset.qf) { S.qf = b.dataset.qf; S.sel = null; S.look = null; S.req = null; S.editing = false; return renderReview(); }
  if (b.dataset.sel) { S.sel = b.dataset.sel; S.look = null; S.req = null; S.editing = false; return renderReview(); }
  if (b.dataset.look) { S.look = b.dataset.look; S.sel = null; S.req = null; return renderReview(); }
  if (b.dataset.req && !b.dataset.act) { S.req = b.dataset.req; S.sel = null; S.look = null; return renderReview(); }
  if (b.dataset.mapc) { S.mapCpse = b.dataset.mapc; S.mapSel = null; return renderMapping(); }
  if (b.tagName === 'TR' && b.dataset.cid) return App.openCluster(b.dataset.cid);
  if (b.tagName === 'TR' && b.dataset.rec) { S.mapSel = b.dataset.rec; return renderMapping(); }
  if (b.dataset.act) return act(b.dataset.act, b);
});
document.addEventListener('input', e => {
  const id = e.target.id;
  if (id === 'catQ') { S.catQ = e.target.value; renderCatTable(); }
  else if (id === 'chkDesc') { S.chk.desc = e.target.value; queueCheck(); }
  else if (id === 'findIn') { S.findIdx = 0; renderFind(); }
  else if (id === 'discIn') { S.disc = +e.target.value; renderSavingsBody(); }
  else if (id === 'otpIn') { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); }
});
document.addEventListener('change', e => {
  const id = e.target.id;
  if (id === 'catCls') { S.catCls = e.target.value; renderCatTable(); }
  if (id === 'catSt') { S.catSt = e.target.value; renderCatTable(); }
  if (id === 'chkCpse') S.chk.cpse = e.target.value;
  if (id === 'chkUom') S.chk.uom = e.target.value;
  if (id === 'fileIn') { const f = e.target.files[0]; if (f) readFile(f); e.target.value = ''; }
});
document.addEventListener('submit', e => {
  const f = e.target; e.preventDefault();
  if (f.id === 'lgForm') doPassword(new FormData(f));
  else if (f.id === 'otpForm') doOtp(new FormData(f).get('otp'));
});
document.addEventListener('keydown', e => {
  const k = e.key, typing = e.target.closest && e.target.closest('input, textarea, select');
  if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'k') { e.preventDefault(); if ($('#findOv').hidden) openFind(); else closeFind(); return; }
  if (!$('#findOv').hidden) {
    if (k === 'Escape') { e.preventDefault(); closeFind(); }
    else if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); S.findIdx += k === 'ArrowDown' ? 1 : -1; renderFind(); }
    else if (k === 'Enter') { e.preventDefault(); const r = findResults()[S.findIdx]; if (r) { closeFind(); App.openCluster(r.id); } }
    return;
  }
  if (k === 'Escape') { if (!$('#dlgOv').hidden) return closeDialog(); closeMenu(); if (S.editing) { S.editing = false; renderReview(); } return; }
  if (typing || document.body.classList.contains('auth') || S.view !== 'review' || !store.harmonized || !$('#dlgOv').hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  const key = k.toLowerCase();
  if (key === 'j' || k === 'ArrowDown') { e.preventDefault(); moveSel(1); }
  else if (key === 'k' || k === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
  else if (key === 'a' && store.role === 'maker' && S.sel && clusterById(S.sel) && stOf(clusterById(S.sel)) === 'proposed') act('approve', {dataset:{cid:S.sel}});
  else if (key === 'v' && store.role === 'checker' && S.sel && clusterById(S.sel) && stOf(clusterById(S.sel)) === 'approved') act('verify', {dataset:{cid:S.sel}});
});
let rsz; addEventListener('resize', () => { clearTimeout(rsz); rsz = setTimeout(() => Scene.setShift(S.view === 'review' && innerWidth > 900 ? Math.round($('#rvSheet').getBoundingClientRect().right / 2) : 0), 120); });


/* ================= boot ================= */
function decor(){
  // A backdrop for the sign-in screen: particles in the four company colours, no data until someone signs in.
  const n = store.facts.records || 327, r = mulberry32(99);
  const recs = Array.from({length:n}, (_, i) => ({id:'D' + i, cpse:CPSES[Math.floor(r() * CPSES.length)].id, cls:null, stockValue:Math.pow(10, 1 + r() * 5)}));
  Scene.build({recs, clusters:[]}, false);
}
Scene.init();
(async () => {
  try {
    const st = await api('state/');
    hydrate(st);
    if (st.me) { Scene.build(ENG, store.harmonized); ENG.changed = false; document.body.classList.remove('auth'); go('overview'); }
    else { decor(); showLogin(); }
  } catch (e) { decor(); showLogin(); L.err = e.message; renderLogin(); }
})();
window.EkCode = {S, get ENG(){ return ENG; }, get store(){ return store; }};
})();

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
function csrf(){ const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; }
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

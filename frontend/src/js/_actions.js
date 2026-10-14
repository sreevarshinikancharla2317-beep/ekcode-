
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

/* ============================================================
   Claude Certifications — Exam Prep Review
   MC pass (easiest -> hardest) + Mastery items (cloze, ordering,
   matching, scenario), per-domain scoring, weakness prompt.
   ============================================================ */
'use strict';

const LS_RESULTS = 'cc.results';
const LS_STATS   = 'cc.stats';
const OPT_KEYS   = ['A', 'B', 'C', 'D'];
const WEAK_THRESHOLD = 0.8;
const ADVANCE_MS = 3000;
const CAT_LABELS = {
  ccaof: 'Associate — Foundations',
  ccdvf: 'Developer — Foundations',
  ccarf: 'Architect — Foundations',
  ccarp: 'Architect — Professional',
};
const CAT_CODE = { ccaof:'CCAO-F', ccdvf:'CCDV-F', ccarf:'CCAR-F', ccarp:'CCAR-P' };
const TYPE_LABELS = { cloze:'Recall', order:'Sequence', match:'Matching', scenario:'Scenario' };

const state = {
  cards: [], byId: {}, byCat: {},
  category: null,
  direction: 'AB',
  order: [], index: 0,
  results: {},
  streak: 0, best: 0, correct: 0, total: 0,
  lastTier: null,
  advanceTimer: null,
  ui: {},            // per-card transient UI state (order picks, match pairs)
};

/* ---------- storage ---------- */
function loadAllResults(){ try { return JSON.parse(localStorage.getItem(LS_RESULTS)) || {}; } catch(e){ return {}; } }
function saveResults(){ const all = loadAllResults(); all[state.category] = state.results; localStorage.setItem(LS_RESULTS, JSON.stringify(all)); }
function saveStats(){ localStorage.setItem(LS_STATS, JSON.stringify({ best: state.best, correct: state.correct, total: state.total })); }
function loadStats(){ try { const s = JSON.parse(localStorage.getItem(LS_STATS)); if (s){ state.best=s.best||0; state.correct=s.correct||0; state.total=s.total||0; } } catch(e){} }

/* ---------- helpers ---------- */
function catCards(cat){ return state.byCat[cat] || []; }
function cardType(card){ return card.type || 'mc'; }
function isMastery(card){ return cardType(card) !== 'mc'; }
function domainNum(card){ const m = /^Domain (\d+)/.exec(card.domain); return m ? +m[1] : 99; }
function promptSide(card){ return state.direction === 'AB' ? card.a[0] : card.b[0]; }
function answerSide(card){ return state.direction === 'AB' ? card.b[0] : card.a[0]; }
function answeredCount(){ return Object.keys(state.results).length; }
function currentCard(){ return state.byId[state.order[state.index]]; }

function buildOrder(cat){
  const arr = catCards(cat).slice().sort((x,y) =>
    ((isMastery(x)?1:0) - (isMastery(y)?1:0)) ||
    (x.difficulty - y.difficulty) || (domainNum(x) - domainNum(y)));
  state.order = arr.map(c => c.id);
}

function shuffle(arr){ for (let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; }

function buildOptions(card){
  const correctVal = answerSide(card);
  // hand-authored distractors (A->B direction only, where the answer side matches them)
  if (state.direction === 'AB' && Array.isArray(card.distractors) && card.distractors.length >= 3){
    return { opts: shuffle([correctVal, ...card.distractors.slice(0,3)]), correctVal };
  }
  const others = catCards(card.category).filter(c => c.id !== card.id && !isMastery(c)).map(c => answerSide(c)).filter(v => v !== correctVal);
  const seen = new Set([correctVal]); const uniq = [];
  for (const v of shuffle(others.slice())){ if (!seen.has(v)){ seen.add(v); uniq.push(v); } if (uniq.length === 3) break; }
  return { opts: shuffle([correctVal, ...uniq]), correctVal };
}

function setDots(el, n, total){
  el.innerHTML = '';
  for (let i=0;i<total;i++){ const d = document.createElement('i'); if (i<n) d.className='on'; el.appendChild(d); }
}
function el(tag, cls, text){ const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function normalize(s){ return String(s).toLowerCase().replace(/[^a-z0-9]+/g,''); }

/* ---------- render ---------- */
function renderCard(id){
  const card = state.byId[id];
  if (!card) return;
  clearAdvance();
  state.index = state.order.indexOf(id);
  state.ui = {};
  const result = state.results[id];
  const type = cardType(card);

  // meta
  document.getElementById('cardConcept').textContent = card.domain;
  document.getElementById('cardTopic').textContent = card.concept.replace(/^.*?—\s*/, '');
  setDots(document.getElementById('cardDiff'), card.difficulty, 5);
  const badge = document.getElementById('masteryBadge');
  badge.hidden = !isMastery(card);
  if (isMastery(card)) badge.textContent = 'MASTERY · ' + (TYPE_LABELS[type] || type).toUpperCase();

  document.getElementById('cardPrompt').textContent = isMastery(card) ? card.a[0] : promptSide(card);

  // answer block content
  document.getElementById('abA').textContent = card.a[0];
  document.getElementById('abB').textContent = answerBlockText(card);
  document.getElementById('abNotes').textContent = card.notes;
  renderRubric(card);
  const tagsRow = document.getElementById('tagsRow');
  tagsRow.innerHTML = '';
  card.tags.filter(t => !/^d\d$/.test(t)).forEach(t => tagsRow.appendChild(el('span','tag',t)));

  document.getElementById('dirBtn').textContent = (state.direction === 'AB') ? 'A→B' : 'B→A';
  document.getElementById('dirBtn').disabled = isMastery(card);

  // interaction area
  const optWrap = document.getElementById('options');
  const interact = document.getElementById('interact');
  optWrap.innerHTML = ''; interact.innerHTML = '';
  optWrap.hidden = (type !== 'mc');
  interact.hidden = (type === 'mc');

  if (result){
    renderAnsweredState(card, result);
  } else {
    document.getElementById('answerBlock').hidden = true;
    if (type === 'mc') renderMC(card);
    else if (type === 'cloze') renderCloze(card);
    else if (type === 'order') renderOrderType(card);
    else if (type === 'match') renderMatch(card);
    else if (type === 'scenario') renderScenario(card);
  }

  updateTier(card);
  renderStats();
  document.getElementById('prevBtn').disabled = (state.index === 0);
}

function answerBlockText(card){
  const type = cardType(card);
  if (type === 'order') return card.items.map((s,i)=>`${i+1}. ${s}`).join('  ');
  if (type === 'match') return card.pairs.map(p=>`${p[0]} → ${p[1]}`).join('  ·  ');
  return card.b[0];
}
function renderRubric(card){
  const r = document.getElementById('abRubric');
  r.innerHTML = ''; r.hidden = true;
  if (cardType(card) === 'scenario' && Array.isArray(card.rubric)){
    card.rubric.forEach(p => r.appendChild(el('li','',p)));
    r.hidden = false;
  }
}

function renderAnsweredState(card, result){
  const s = result.status;
  const msg = s === 'correct' ? 'Answered — correct' : s === 'revealed' ? 'Revealed — not scored' : 'Answered — missed';
  const note = el('div', 'answered-note ' + (s === 'correct' ? 'good' : 'bad'), msg);
  if (cardType(card) === 'mc'){
    const optWrap = document.getElementById('options');
    const { opts, correctVal } = buildOptions(card);
    // deterministic re-render: show correct + chosen
    opts.forEach((val, i) => {
      const li = document.createElement('li');
      const b = mcOptionButton(val, i);
      b.disabled = true;
      if (val === correctVal) b.classList.add('correct');
      else if (result.chosen && val === result.chosen) b.classList.add('wrong');
      else b.classList.add('dim');
      li.appendChild(b);
      optWrap.appendChild(li);
    });
  } else {
    document.getElementById('interact').appendChild(note);
  }
  document.getElementById('answerBlock').hidden = false;
}

/* ---------- MC ---------- */
function mcOptionButton(val, i){
  const b = el('button','opt');
  b.type = 'button';
  b.innerHTML = `<span class="opt-key">${OPT_KEYS[i]}</span><span class="opt-text"></span>`;
  b.querySelector('.opt-text').textContent = val;
  return b;
}
function renderMC(card){
  const { opts, correctVal } = buildOptions(card);
  const optWrap = document.getElementById('options');
  opts.forEach((val, i) => {
    const li = document.createElement('li');
    const b = mcOptionButton(val, i);
    b.addEventListener('click', () => {
      [...optWrap.querySelectorAll('.opt')].forEach(x => {
        x.disabled = true;
        const t = x.querySelector('.opt-text').textContent;
        if (t === correctVal) x.classList.add('correct');
        else if (x === b) x.classList.add('wrong');
        else x.classList.add('dim');
      });
      finish(card, val === correctVal, val);
    });
    li.appendChild(b);
    optWrap.appendChild(li);
  });
}

/* ---------- CLOZE ---------- */
function renderCloze(card){
  const interact = document.getElementById('interact');
  const row = el('div','cloze-row');
  const input = el('input','cloze-input');
  input.type = 'text'; input.placeholder = 'Type the missing term…';
  input.autocapitalize = 'off'; input.autocomplete = 'off'; input.spellcheck = false;
  const btn = el('button','check-btn','Check');
  btn.type = 'button';
  const submit = () => {
    const guess = normalize(input.value);
    if (!guess) return;
    const ok = [card.b[0], ...(card.accept || [])].some(a => normalize(a) === guess);
    input.disabled = true; btn.disabled = true;
    input.classList.add(ok ? 'good' : 'bad');
    finish(card, ok, input.value);
  };
  btn.addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  row.appendChild(input); row.appendChild(btn);
  interact.appendChild(el('div','interact-hint','Free recall — no options. Type the exact term.'));
  interact.appendChild(row);
  setTimeout(()=>input.focus(), 50);
}

/* ---------- ORDER ---------- */
function renderOrderType(card){
  const interact = document.getElementById('interact');
  interact.appendChild(el('div','interact-hint','Tap the steps in the correct order.'));
  const picked = el('ol','order-picked');
  const pool = el('div','order-pool');
  const controls = el('div','interact-controls');
  const clearB = el('button','check-btn ghost','Clear'); clearB.type='button';
  const checkB = el('button','check-btn','Check'); checkB.type='button'; checkB.disabled = true;
  state.ui.picks = [];
  const shuffled = shuffle(card.items.slice());
  // ensure the shuffle isn't accidentally the correct order
  if (shuffled.join('|') === card.items.join('|')) shuffled.reverse();
  const rebuild = () => {
    picked.innerHTML = '';
    state.ui.picks.forEach(s => picked.appendChild(el('li','',s)));
    [...pool.children].forEach(b => { b.disabled = state.ui.picks.includes(b.textContent); });
    checkB.disabled = state.ui.picks.length !== card.items.length;
  };
  shuffled.forEach(stp => {
    const b = el('button','order-item',stp); b.type='button';
    b.addEventListener('click', () => { if (!state.ui.picks.includes(stp)){ state.ui.picks.push(stp); rebuild(); } });
    pool.appendChild(b);
  });
  clearB.addEventListener('click', () => { state.ui.picks = []; rebuild(); });
  checkB.addEventListener('click', () => {
    const ok = state.ui.picks.join('|') === card.items.join('|');
    [...pool.children].forEach(b => b.disabled = true);
    clearB.disabled = true; checkB.disabled = true;
    picked.classList.add(ok ? 'good' : 'bad');
    finish(card, ok, null);
  });
  controls.appendChild(clearB); controls.appendChild(checkB);
  interact.appendChild(pool); interact.appendChild(picked); interact.appendChild(controls);
}

/* ---------- MATCH ---------- */
function renderMatch(card){
  const interact = document.getElementById('interact');
  interact.appendChild(el('div','interact-hint','Tap a term, then tap its match.'));
  const grid = el('div','match-grid');
  const leftCol = el('div','match-col');
  const rightCol = el('div','match-col');
  const controls = el('div','interact-controls');
  const checkB = el('button','check-btn','Check'); checkB.type='button'; checkB.disabled = true;
  const resetB = el('button','check-btn ghost','Clear'); resetB.type='button';
  const terms = card.pairs.map(p => p[0]);
  const defs = shuffle(card.pairs.map(p => p[1]));
  state.ui.sel = null;                 // selected term button
  state.ui.assign = {};                // term -> def
  const marks = {};                    // term -> small index label
  const refresh = () => {
    [...leftCol.children].forEach(b => {
      b.classList.toggle('sel', b === state.ui.sel);
      b.classList.toggle('paired', !!state.ui.assign[b.dataset.v]);
    });
    [...rightCol.children].forEach(b => {
      const used = Object.values(state.ui.assign).includes(b.dataset.v);
      b.classList.toggle('paired', used);
    });
    checkB.disabled = Object.keys(state.ui.assign).length !== terms.length;
  };
  terms.forEach(t => {
    const b = el('button','match-item',t); b.type='button'; b.dataset.v = t;
    b.addEventListener('click', () => {
      if (state.ui.locked) return;
      if (state.ui.assign[t]) delete state.ui.assign[t];
      state.ui.sel = (state.ui.sel === b) ? null : b;
      refresh();
    });
    leftCol.appendChild(b);
  });
  defs.forEach(d => {
    const b = el('button','match-item def',d); b.type='button'; b.dataset.v = d;
    b.addEventListener('click', () => {
      if (state.ui.locked || !state.ui.sel) return;
      if (Object.values(state.ui.assign).includes(d)) return;
      state.ui.assign[state.ui.sel.dataset.v] = d;
      state.ui.sel = null;
      refresh();
    });
    rightCol.appendChild(b);
  });
  resetB.addEventListener('click', () => { if (!state.ui.locked){ state.ui.assign = {}; state.ui.sel = null; refresh(); } });
  checkB.addEventListener('click', () => {
    state.ui.locked = true;
    let ok = true;
    card.pairs.forEach(([t,d]) => { if (state.ui.assign[t] !== d) ok = false; });
    [...leftCol.children, ...rightCol.children].forEach(b => b.classList.add('locked'));
    checkB.disabled = true; resetB.disabled = true;
    grid.classList.add(ok ? 'good' : 'bad');
    finish(card, ok, null);
  });
  grid.appendChild(leftCol); grid.appendChild(rightCol);
  controls.appendChild(resetB); controls.appendChild(checkB);
  interact.appendChild(grid); interact.appendChild(controls);
}

/* ---------- SCENARIO ---------- */
function renderScenario(card){
  const interact = document.getElementById('interact');
  interact.appendChild(el('div','interact-hint','Think through (or say aloud) your full answer, then compare with the model answer and grade yourself honestly.'));
  const showB = el('button','check-btn','Show model answer'); showB.type='button';
  const grade = el('div','interact-controls'); grade.style.display = 'none';
  const gotB = el('button','check-btn good-btn','I covered the rubric'); gotB.type='button';
  const missB = el('button','check-btn bad-btn','I missed points'); missB.type='button';
  showB.addEventListener('click', () => {
    document.getElementById('answerBlock').hidden = false;
    showB.style.display = 'none';
    grade.style.display = 'flex';
  });
  gotB.addEventListener('click', () => { gotB.disabled = missB.disabled = true; finish(card, true, null); });
  missB.addEventListener('click', () => { gotB.disabled = missB.disabled = true; finish(card, false, null); });
  grade.appendChild(missB); grade.appendChild(gotB);
  interact.appendChild(showB); interact.appendChild(grade);
}

/* ---------- shared finish ---------- */
function finish(card, correct, chosen){
  const id = card.id;
  if (state.results[id]) return;
  document.getElementById('answerBlock').hidden = false;
  state.total++;
  if (correct){ state.correct++; state.streak++; if (state.streak > state.best) state.best = state.streak; }
  else { state.streak = 0; }
  state.results[id] = { status: correct ? 'correct' : 'wrong', chosen: chosen || null };
  saveResults(); saveStats(); renderStats();
  const complete = answeredCount() === catCards(state.category).length;
  if (correct){
    scheduleAdvance(complete ? showResults : goNext, ADVANCE_MS,
      complete ? 'Correct — showing results…' : 'Correct — next question…');
  } else if (complete){
    scheduleAdvance(showResults, ADVANCE_MS + 2000, 'Category complete — showing results…');
  }
}

function revealCurrent(){
  const card = currentCard();
  if (!card || state.results[card.id]) return;
  if (cardType(card) === 'mc'){
    const optWrap = document.getElementById('options');
    const correctVal = answerSide(card);
    [...optWrap.querySelectorAll('.opt')].forEach(x => {
      x.disabled = true;
      if (x.querySelector('.opt-text').textContent === correctVal) x.classList.add('correct');
      else x.classList.add('dim');
    });
  } else {
    document.getElementById('interact').querySelectorAll('button,input').forEach(x => x.disabled = true);
  }
  document.getElementById('answerBlock').hidden = false;
  state.results[card.id] = { status: 'revealed', chosen: null };
  state.streak = 0;
  saveResults(); renderStats();
}

/* ---------- auto-advance ---------- */
function scheduleAdvance(fn, ms, bannerText){
  clearAdvance();
  if (bannerText) showAutoAdvance(bannerText, ms);
  state.advanceTimer = setTimeout(() => { state.advanceTimer = null; hideAutoAdvance(); fn(); }, ms);
}
function clearAdvance(){
  if (state.advanceTimer){ clearTimeout(state.advanceTimer); state.advanceTimer = null; }
  hideAutoAdvance();
}
function showAutoAdvance(text, ms){
  const banner = document.getElementById('autoAdvance');
  document.getElementById('autoAdvanceText').textContent = text;
  banner.hidden = false;
  const bar = document.querySelector('#autoAdvanceBar i');
  bar.style.transition = 'none'; bar.style.width = '100%';
  void bar.offsetWidth;
  bar.style.transition = `width ${ms}ms linear`; bar.style.width = '0%';
}
function hideAutoAdvance(){ document.getElementById('autoAdvance').hidden = true; }

/* ---------- stats / tier ---------- */
function renderStats(){
  const cat = state.category, n = catCards(cat).length;
  document.getElementById('statMastered').textContent = `${answeredCount()}/${n}`;
  document.getElementById('statStreak').textContent = state.streak;
  document.getElementById('statBest').textContent = state.best;
  document.getElementById('statScore').textContent = `${state.correct}/${state.total}`;
}
function updateTier(card){
  const tier = card.difficulty;
  document.getElementById('levelNum').textContent = tier;
  setDots(document.getElementById('levelBar'), tier, 5);
  const label = isMastery(card) ? `Mastery · Q ${state.index + 1} / ${state.order.length}` : `Q ${state.index + 1} / ${state.order.length}`;
  document.getElementById('levelHint').textContent = label;
  if (state.lastTier !== null && tier !== state.lastTier){
    const e = document.getElementById('level');
    e.classList.remove('bump'); void e.offsetWidth; e.classList.add('bump');
    setTimeout(() => e.classList.remove('bump'), 600);
  }
  state.lastTier = tier;
}

/* ---------- navigation ---------- */
function goNext(){
  if (state.index < state.order.length - 1) renderCard(state.order[state.index + 1]);
  else showResults();
}
function goPrev(){ if (state.index > 0) renderCard(state.order[state.index - 1]); }
function toggleDirection(){
  const card = currentCard();
  if (card && isMastery(card)) return;
  state.direction = (state.direction === 'AB') ? 'BA' : 'AB';
  renderCard(state.order[state.index]);
}
function jumpNextUnanswered(){
  for (let k=1;k<=state.order.length;k++){
    const idx = (state.index + k) % state.order.length;
    if (!state.results[state.order[idx]]){ renderCard(state.order[idx]); return; }
  }
  showResults();
}

/* ---------- results & weakness prompt ---------- */
function domainStats(){
  const cat = state.category;
  const map = {};
  catCards(cat).forEach(card => {
    const d = card.domain;
    if (!map[d]) map[d] = { correct:0, total:0, missed:[] };
    map[d].total++;
    const r = state.results[card.id];
    if (r && r.status === 'correct') map[d].correct++;
    else map[d].missed.push(card.concept.replace(/^.*?—\s*/, '') + (isMastery(card) ? ` [${TYPE_LABELS[cardType(card)]}]` : ''));
  });
  return map;
}
function domNum(d){ const m=/^Domain (\d+)/.exec(d); return m?+m[1]:99; }

function buildWeakPrompt(map){
  const cat = state.category;
  const rows = Object.entries(map).sort((a,b)=>domNum(a[0])-domNum(b[0]));
  const weak = rows.filter(([d,s]) => (s.correct / s.total) < WEAK_THRESHOLD);
  const target = weak.length ? weak : rows.slice().sort((a,b)=>(a[1].correct/a[1].total)-(b[1].correct/b[1].total)).slice(0,2);
  const lines = [];
  lines.push(`Add more Claude Certifications practice questions to the claude_certs deck.`);
  lines.push('');
  lines.push(`I just finished the "${CAT_LABELS[cat]}" (${CAT_CODE[cat]}) category and want to reinforce my weak sections.`);
  lines.push('');
  lines.push('My section scores:');
  rows.forEach(([d,s]) => lines.push(`- ${d}: ${s.correct}/${s.total} (${Math.round(100*s.correct/s.total)}%)`));
  lines.push('');
  lines.push('Focus the new questions on these weaker sections and the specific topics I missed:');
  target.forEach(([d,s]) => {
    const miss = s.missed.slice(0,6).join('; ');
    lines.push(`- ${d}${miss ? ` — missed: ${miss}` : ''}`);
  });
  lines.push('');
  lines.push(`Please generate 15 new practice items concentrated on the sections above for the "${cat}" category — a mix of multiple-choice (with hand-crafted plausible distractors in the "distractors" field) and mastery formats (cloze, order, match, scenario), following the existing card schema, each labeled with its exam domain, ordered easiest to hardest, with answers distinct within the category. Add them to claude_certs/cards.json, then commit and deploy.`);
  return lines.join('\n');
}

function showResults(){
  clearAdvance();
  const cat = state.category;
  const map = domainStats();
  const totalCorrect = Object.values(map).reduce((a,s)=>a+s.correct,0);
  const totalQ = Object.values(map).reduce((a,s)=>a+s.total,0);
  const pct = Math.round(100*totalCorrect/totalQ);
  document.getElementById('resultTitle').textContent = `${CAT_LABELS[cat]} — Results`;
  document.getElementById('resultOverall').textContent =
    `Overall: ${totalCorrect}/${totalQ} (${pct}%)${answeredCount() < totalQ ? ' · unanswered questions count as missed' : ''}`;
  const rowsEl = document.getElementById('resultRows');
  rowsEl.innerHTML = '';
  Object.entries(map).sort((a,b)=>domNum(a[0])-domNum(b[0])).forEach(([d,s]) => {
    const p = Math.round(100*s.correct/s.total);
    const weak = (s.correct/s.total) < WEAK_THRESHOLD;
    const row = el('div','res-row' + (weak ? ' weak' : ''));
    row.innerHTML = `<span class="res-dom"></span><span class="res-bar"><i style="width:${p}%"></i></span><span class="res-score">${s.correct}/${s.total} · ${p}%</span>`;
    row.querySelector('.res-dom').textContent = d;
    rowsEl.appendChild(row);
  });
  document.getElementById('weakPrompt').value = buildWeakPrompt(map);
  document.getElementById('completeOverlay').hidden = false;
}

function copyPrompt(){
  const ta = document.getElementById('weakPrompt');
  ta.select();
  const done = () => { const b = document.getElementById('copyPromptBtn'); b.textContent = 'Copied'; setTimeout(()=>b.textContent='Copy', 1500); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, () => { document.execCommand('copy'); done(); });
  else { document.execCommand('copy'); done(); }
}

function restartCategory(){
  state.results = {};
  saveResults();
  closeOverlay();
  renderCard(state.order[0]);
}
function closeOverlay(){ document.getElementById('completeOverlay').hidden = true; }

/* ---------- category ---------- */
function buildCategorySelect(){
  const sel = document.getElementById('catSelect');
  sel.innerHTML = '';
  Object.keys(CAT_LABELS).forEach(cat => {
    if (!state.byCat[cat]) return;
    const o = document.createElement('option');
    o.value = cat;
    o.textContent = `${CAT_LABELS[cat]} (${catCards(cat).length})`;
    sel.appendChild(o);
  });
  sel.value = state.category;
  sel.addEventListener('change', () => switchCategory(sel.value));
}
function switchCategory(cat){
  state.category = cat;
  state.results = loadAllResults()[cat] || {};
  state.lastTier = null;
  document.getElementById('catSelect').value = cat;
  buildOrder(cat);
  let start = state.order.findIndex(id => !state.results[id]);
  if (start < 0) start = 0;
  renderCard(state.order[start]);
}

/* ---------- reset ---------- */
function resetAll(){
  localStorage.removeItem(LS_RESULTS);
  state.results = {}; state.streak = 0; state.best = 0; state.correct = 0; state.total = 0; state.lastTier = null;
  saveStats();
  switchCategory(state.category);
}

/* ---------- controls ---------- */
function wireControls(){
  document.getElementById('prevBtn').addEventListener('click', goPrev);
  document.getElementById('nextBtn').addEventListener('click', goNext);
  document.getElementById('shuffleBtn').addEventListener('click', jumpNextUnanswered);
  document.getElementById('revealBtn').addEventListener('click', revealCurrent);
  document.getElementById('dirBtn').addEventListener('click', toggleDirection);
  document.getElementById('resetBtn').addEventListener('click', resetAll);
  document.getElementById('restartCatBtn').addEventListener('click', restartCategory);
  document.getElementById('closeOverlayBtn').addEventListener('click', closeOverlay);
  document.getElementById('copyPromptBtn').addEventListener('click', copyPrompt);
  document.getElementById('resultsBtn').addEventListener('click', showResults);
  document.getElementById('stayBtn').addEventListener('click', clearAdvance);
}

/* ---------- boot ---------- */
async function boot(){
  loadStats();
  wireControls();
  try {
    const res = await fetch('cards.json', { cache: 'no-cache' });
    const cards = await res.json();
    state.cards = cards;
    cards.forEach(c => { state.byId[c.id] = c; (state.byCat[c.category] = state.byCat[c.category] || []).push(c); });
  } catch(e){
    document.getElementById('cardPrompt').textContent = 'Failed to load deck: ' + e.message;
    return;
  }
  state.category = Object.keys(CAT_LABELS).find(c => state.byCat[c]) || Object.keys(state.byCat)[0];
  buildCategorySelect();
  switchCategory(state.category);
}

if ('serviceWorker' in navigator){
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
document.addEventListener('DOMContentLoaded', boot);

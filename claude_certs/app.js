/* ============================================================
   Claude Certifications — Exam Prep Review
   Sequential easiest->hardest pass, per-domain scoring,
   and a paste-ready weakness prompt on completion.
   ============================================================ */
'use strict';

const LS_RESULTS = 'cc.results';
const LS_STATS   = 'cc.stats';
const OPT_KEYS   = ['A', 'B', 'C', 'D'];
const WEAK_THRESHOLD = 0.8; // domains below 80% are flagged as weak
const CAT_LABELS = {
  ccaof: 'Associate — Foundations',
  ccdvf: 'Developer — Foundations',
  ccarf: 'Architect — Foundations',
  ccarp: 'Architect — Professional',
};
const CAT_CODE = { ccaof:'CCAO-F', ccdvf:'CCDV-F', ccarf:'CCAR-F', ccarp:'CCAR-P' };

const state = {
  cards: [], byId: {}, byCat: {},
  category: null,
  direction: 'AB',
  order: [],          // sorted card ids for current category (easiest -> hardest)
  index: 0,
  results: {},        // current category: cardId -> {status:'correct'|'wrong'|'revealed', chosen}
  streak: 0, best: 0, correct: 0, total: 0,
  lastTier: null,
  advanceTimer: null,
};
const ADVANCE_MS = 3000; // correct-answer explanation shown, then auto-advance

/* ---------- storage ---------- */
function loadAllResults(){ try { return JSON.parse(localStorage.getItem(LS_RESULTS)) || {}; } catch(e){ return {}; } }
function saveResults(){ const all = loadAllResults(); all[state.category] = state.results; localStorage.setItem(LS_RESULTS, JSON.stringify(all)); }
function saveStats(){ localStorage.setItem(LS_STATS, JSON.stringify({ best: state.best, correct: state.correct, total: state.total })); }
function loadStats(){ try { const s = JSON.parse(localStorage.getItem(LS_STATS)); if (s){ state.best=s.best||0; state.correct=s.correct||0; state.total=s.total||0; } } catch(e){} }

/* ---------- helpers ---------- */
function catCards(cat){ return state.byCat[cat] || []; }
function domainNum(card){ const m = /^Domain (\d+)/.exec(card.domain); return m ? +m[1] : 99; }
function promptSide(card){ return state.direction === 'AB' ? card.a[0] : card.b[0]; }
function answerSide(card){ return state.direction === 'AB' ? card.b[0] : card.a[0]; }
function answeredCount(){ return Object.keys(state.results).length; }

function buildOrder(cat){
  const arr = catCards(cat).slice().sort((x,y) =>
    (x.difficulty - y.difficulty) || (domainNum(x) - domainNum(y)));
  state.order = arr.map(c => c.id);
}

function shuffle(arr){ for (let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; }

function buildOptions(card){
  const correctVal = answerSide(card);
  const others = catCards(card.category).filter(c => c.id !== card.id).map(c => answerSide(c)).filter(v => v !== correctVal);
  const seen = new Set([correctVal]); const uniq = [];
  for (const v of shuffle(others.slice())){ if (!seen.has(v)){ seen.add(v); uniq.push(v); } if (uniq.length === 3) break; }
  return { opts: shuffle([correctVal, ...uniq]), correctVal };
}

function setDots(el, n, total){
  el.innerHTML = '';
  for (let i=0;i<total;i++){ const d = document.createElement('i'); if (i<n) d.className='on'; el.appendChild(d); }
}

/* ---------- render ---------- */
function renderCard(id){
  const card = state.byId[id];
  if (!card) return;
  clearAdvance();
  state.index = state.order.indexOf(id);
  const result = state.results[id];

  document.getElementById('cardConcept').textContent = card.domain;   // section reference
  document.getElementById('cardTopic').textContent = card.concept.replace(/^.*?—\s*/, '');
  setDots(document.getElementById('cardDiff'), card.difficulty, 5);
  document.getElementById('cardPrompt').textContent = promptSide(card);

  const { opts, correctVal } = buildOptions(card);
  const optWrap = document.getElementById('options');
  optWrap.innerHTML = '';
  opts.forEach((val, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = 'opt';
    b.type = 'button';
    b.innerHTML = `<span class="opt-key">${OPT_KEYS[i]}</span><span class="opt-text"></span>`;
    b.querySelector('.opt-text').textContent = val;
    b.addEventListener('click', () => onAnswer(b, val, correctVal, false));
    li.appendChild(b);
    optWrap.appendChild(li);
  });

  // answer block content
  document.getElementById('abA').textContent = card.a[0];
  document.getElementById('abB').textContent = card.b[0];
  document.getElementById('abNotes').textContent = card.notes;
  const tagsRow = document.getElementById('tagsRow');
  tagsRow.innerHTML = '';
  card.tags.filter(t => !/^d\d$/.test(t)).forEach(t => { const s=document.createElement('span'); s.className='tag'; s.textContent=t; tagsRow.appendChild(s); });

  document.getElementById('dirBtn').textContent = (state.direction === 'AB') ? 'A→B' : 'B→A';

  if (result){
    // already answered: re-render locked state
    [...optWrap.querySelectorAll('.opt')].forEach(b => {
      b.disabled = true;
      const text = b.querySelector('.opt-text').textContent;
      if (text === correctVal) b.classList.add('correct');
      else if (result.chosen && text === result.chosen) b.classList.add('wrong');
      else b.classList.add('dim');
    });
    document.getElementById('answerBlock').hidden = false;
  } else {
    document.getElementById('answerBlock').hidden = true;
  }

  updateTier(card);
  renderStats();
  document.getElementById('prevBtn').disabled = (state.index === 0);
}

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
  document.getElementById('levelHint').textContent = `Q ${state.index + 1} / ${state.order.length}`;
  if (state.lastTier !== null && tier !== state.lastTier){
    const el = document.getElementById('level');
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
    setTimeout(() => el.classList.remove('bump'), 600);
  }
  state.lastTier = tier;
}

/* ---------- answering ---------- */
function onAnswer(btn, val, correctVal, isReveal){
  const id = state.order[state.index];
  if (state.results[id]) return; // already answered
  const card = state.byId[id];

  [...document.getElementById('options').querySelectorAll('.opt')].forEach(b => {
    b.disabled = true;
    const text = b.querySelector('.opt-text').textContent;
    if (text === correctVal) b.classList.add('correct');
    else if (b === btn) b.classList.add('wrong');
    else b.classList.add('dim');
  });
  document.getElementById('answerBlock').hidden = false;

  if (isReveal){
    state.results[id] = { status: 'revealed', chosen: null };
    state.streak = 0;
  } else {
    const correct = (val === correctVal);
    state.total++;
    if (correct){ state.correct++; state.streak++; if (state.streak > state.best) state.best = state.streak; }
    else { state.streak = 0; }
    state.results[id] = { status: correct ? 'correct' : 'wrong', chosen: val };
  }
  saveResults(); saveStats(); renderStats();

  const complete = answeredCount() === catCards(state.category).length;
  if (!isReveal && val === correctVal){
    // correct: show the explanation, then auto-advance after 3s
    scheduleAdvance(
      complete ? showResults : goNext,
      ADVANCE_MS,
      complete ? 'Correct — showing results…' : 'Correct — next question…'
    );
  }
  // wrong or revealed answers stay on screen for review (manual Next / Score)
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
  bar.style.transition = 'none';
  bar.style.width = '100%';
  void bar.offsetWidth;                     // reflow so the animation restarts
  bar.style.transition = `width ${ms}ms linear`;
  bar.style.width = '0%';
}
function hideAutoAdvance(){ document.getElementById('autoAdvance').hidden = true; }

function revealCurrent(){
  const id = state.order[state.index];
  if (state.results[id]) return;
  const correctVal = answerSide(state.byId[id]);
  onAnswer(null, correctVal, correctVal, true);
}

/* ---------- navigation ---------- */
function goNext(){
  if (state.index < state.order.length - 1){ renderCard(state.order[state.index + 1]); }
  else { showResults(); }
}
function goPrev(){ if (state.index > 0) renderCard(state.order[state.index - 1]); }
function toggleDirection(){ state.direction = (state.direction === 'AB') ? 'BA' : 'AB'; renderCard(state.order[state.index]); }
function jumpNextUnanswered(){
  for (let k=1;k<=state.order.length;k++){
    const idx = (state.index + k) % state.order.length;
    if (!state.results[state.order[idx]]){ renderCard(state.order[idx]); return; }
  }
  showResults(); // none left
}

/* ---------- results & weakness prompt ---------- */
function domainStats(){
  const cat = state.category;
  const map = {}; // domain -> {correct, total}
  catCards(cat).forEach(card => {
    const d = card.domain;
    if (!map[d]) map[d] = { correct:0, total:0, missed:[] };
    map[d].total++;
    const r = state.results[card.id];
    if (r && r.status === 'correct') map[d].correct++;
    else if (r) map[d].missed.push(card.concept.replace(/^.*?—\s*/, ''));
    else map[d].missed.push(card.concept.replace(/^.*?—\s*/, '')); // unanswered = missed
  });
  return map;
}

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
  lines.push(`Please generate 15 new exam-style multiple-choice questions concentrated on the sections above for the "${cat}" category, following the existing card schema (id, category "${cat}", difficulty 1-5, domain, concept, a, b, notes, tags), each labeled with its exam domain, ordered easiest to hardest, with answers distinct within the category. Add them to claude_certs/cards.json, then commit and deploy.`);
  return lines.join('\n');
}
function domNum(d){ const m=/^Domain (\d+)/.exec(d); return m?+m[1]:99; }

function showResults(){
  clearAdvance();
  const cat = state.category;
  const map = domainStats();
  const totalCorrect = Object.values(map).reduce((a,s)=>a+s.correct,0);
  const totalQ = Object.values(map).reduce((a,s)=>a+s.total,0);
  const pct = Math.round(100*totalCorrect/totalQ);

  document.getElementById('resultTitle').textContent = `${CAT_LABELS[cat]} — Results`;
  document.getElementById('resultOverall').textContent =
    `Overall: ${totalCorrect}/${totalQ} (${pct}%)${answeredCount() < totalQ ? ' · some questions unanswered (counted as missed)' : ''}`;

  const rowsEl = document.getElementById('resultRows');
  rowsEl.innerHTML = '';
  Object.entries(map).sort((a,b)=>domNum(a[0])-domNum(b[0])).forEach(([d,s]) => {
    const p = Math.round(100*s.correct/s.total);
    const weak = (s.correct/s.total) < WEAK_THRESHOLD;
    const row = document.createElement('div');
    row.className = 'res-row' + (weak ? ' weak' : '');
    row.innerHTML =
      `<span class="res-dom"></span>` +
      `<span class="res-bar"><i style="width:${p}%"></i></span>` +
      `<span class="res-score">${s.correct}/${s.total} · ${p}%</span>`;
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
  state.index = 0;
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
  // resume at first unanswered, else start at 0
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

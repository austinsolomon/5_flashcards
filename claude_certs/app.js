/* ============================================================
   Claude Certifications — Exam Prep Review
   ============================================================ */
'use strict';

const LS_COUNTS = 'cc.correctCounts';
const LS_STATS  = 'cc.stats';
const MASTERY   = 2; // correct answers (since last wrong) to master a card
const OPT_KEYS  = ['A', 'B', 'C', 'D'];
const CAT_LABELS = {
  ccaof: 'Associate — Foundations',
  ccdvf: 'Developer — Foundations',
  ccarf: 'Architect — Foundations',
  ccarp: 'Architect — Professional',
};
const CAT_SHORT = {
  ccaof: 'Associate',
  ccdvf: 'Developer',
  ccarf: 'Architect (F)',
  ccarp: 'Architect (P)',
};

const state = {
  cards: [], byId: {}, byCat: {},
  category: null,
  direction: 'AB',     // 'AB' prompt a -> pick b ; 'BA' prompt b -> pick a
  current: null,
  answered: false,
  history: [],
  streak: 0, best: 0, correct: 0, total: 0,
  lastRenderedLevel: null,
};

/* ---------- storage ---------- */
function loadCounts(){ try { return JSON.parse(localStorage.getItem(LS_COUNTS)) || {}; } catch(e){ return {}; } }
function saveCounts(c){ localStorage.setItem(LS_COUNTS, JSON.stringify(c)); }
function getCount(id){ return loadCounts()[id] || 0; }
function setCount(id, n){ const c = loadCounts(); c[id] = n; saveCounts(c); }
function saveStats(){ localStorage.setItem(LS_STATS, JSON.stringify({ best: state.best, correct: state.correct, total: state.total })); }
function loadStats(){
  try { const s = JSON.parse(localStorage.getItem(LS_STATS));
    if (s){ state.best = s.best||0; state.correct = s.correct||0; state.total = s.total||0; } } catch(e){}
}

/* ---------- difficulty / streak (single source of truth) ---------- */
function targetLevel(streak){ return Math.min(5, Math.floor(streak / 5) + 1); }

/* ---------- pools ---------- */
function catCards(cat){ return state.byCat[cat] || []; }
function activePool(cat){ return catCards(cat).filter(c => getCount(c.id) < MASTERY); }
function masteredInCat(cat){ return catCards(cat).filter(c => getCount(c.id) >= MASTERY); }

/* ---------- weighted next-card picker ---------- */
function weightFor(diff, target){
  const dist = Math.abs(diff - target);
  if (dist === 0) return 5;
  if (dist === 1) return 2;
  return diff < target ? 0.6 : 0.4;
}
function pickNextCard(){
  const cat = state.category;
  const target = targetLevel(state.streak);
  let pool = activePool(cat).filter(c => c.id !== state.current);
  if (pool.length === 0) pool = activePool(cat);
  if (pool.length === 0) return null;
  const weights = pool.map(c => {
    let w = weightFor(c.difficulty, target);
    if (getCount(c.id) === MASTERY - 1) w *= 1.6;
    return w;
  });
  let r = Math.random() * weights.reduce((a,b)=>a+b, 0);
  for (let i=0;i<pool.length;i++){ r -= weights[i]; if (r <= 0) return pool[i].id; }
  return pool[pool.length-1].id;
}

/* ---------- side helpers ---------- */
function promptSide(card){ return state.direction === 'AB' ? card.a[0] : card.b[0]; }
function answerSide(card){ return state.direction === 'AB' ? card.b[0] : card.a[0]; }

function buildOptions(card){
  const correctVal = answerSide(card);
  const others = catCards(card.category)
    .filter(c => c.id !== card.id)
    .map(c => answerSide(c))
    .filter(v => v !== correctVal);
  const seen = new Set([correctVal]);
  const uniq = [];
  for (const v of shuffle(others.slice())){
    if (!seen.has(v)){ seen.add(v); uniq.push(v); }
    if (uniq.length === 3) break;
  }
  return { opts: shuffle([correctVal, ...uniq]), correctVal };
}

/* ---------- difficulty / level dots ---------- */
function setDots(el, n, total){
  el.innerHTML = '';
  for (let i=0;i<total;i++){
    const dot = document.createElement('i');
    if (i < n) dot.className = 'on';
    el.appendChild(dot);
  }
}

/* ---------- card rendering ---------- */
function renderCard(id){
  const card = state.byId[id];
  if (!card) return;
  state.current = id;
  state.answered = false;

  document.getElementById('cardConcept').textContent = card.concept;
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

  const ab = document.getElementById('answerBlock');
  ab.hidden = true;
  document.getElementById('abA').textContent = card.a[0];
  document.getElementById('abB').textContent = card.b[0];
  document.getElementById('abNotes').textContent = card.notes;
  const tagsRow = document.getElementById('tagsRow');
  tagsRow.innerHTML = '';
  card.tags.forEach(t => {
    const s = document.createElement('span');
    s.className = 'tag';
    s.textContent = t;
    tagsRow.appendChild(s);
  });

  document.getElementById('dirBtn').textContent = (state.direction === 'AB') ? 'A→B' : 'B→A';
}

/* ---------- answering ---------- */
function onAnswer(btn, val, correctVal, isReveal){
  if (state.answered) return;
  state.answered = true;
  const card = state.byId[state.current];

  [...document.getElementById('options').querySelectorAll('.opt')].forEach(b => {
    b.disabled = true;
    const text = b.querySelector('.opt-text').textContent;
    if (text === correctVal) b.classList.add('correct');
    else if (b === btn) b.classList.add('wrong');
    else b.classList.add('dim');
  });

  document.getElementById('answerBlock').hidden = false;
  if (isReveal) return; // no scoring

  state.total++;
  if (val === correctVal){
    state.correct++;
    state.streak++;
    if (state.streak > state.best) state.best = state.streak;
    setCount(card.id, Math.min(MASTERY, getCount(card.id) + 1));
    updateLevel();
    renderStats(); saveStats();
    if (activePool(state.category).length === 0) setTimeout(showCategoryComplete, 450);
  } else {
    state.streak = 0;
    setCount(card.id, 0);
    demoteRandomMastered(card.category);
    updateLevel();
    renderStats(); saveStats();
  }
}

function demoteRandomMastered(cat){
  const mastered = masteredInCat(cat);
  if (mastered.length === 0) return;
  setCount(mastered[Math.floor(Math.random() * mastered.length)].id, 0);
}

function revealCurrent(){
  if (state.answered) return;
  const correctVal = answerSide(state.byId[state.current]);
  onAnswer(null, correctVal, correctVal, true);
}

/* ---------- stats + level ---------- */
function renderStats(){
  const cat = state.category;
  document.getElementById('statMastered').textContent =
    `${masteredInCat(cat).length}/${catCards(cat).length}`;
  document.getElementById('statStreak').textContent = state.streak;
  document.getElementById('statBest').textContent = state.best;
  document.getElementById('statScore').textContent = `${state.correct}/${state.total}`;
}

function updateLevel(){
  const streak = state.streak;
  const level = targetLevel(streak);
  const within = streak % 5;
  document.getElementById('levelNum').textContent = level;
  setDots(document.getElementById('levelBar'), level, 5);
  document.getElementById('levelHint').textContent =
    (level === 5) ? 'max level' : `+${5 - within} → L${level + 1}`;

  if (state.lastRenderedLevel !== null && level !== state.lastRenderedLevel){
    const el = document.getElementById('level');
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
    setTimeout(() => el.classList.remove('bump'), 600);
  }
  state.lastRenderedLevel = level;
}

/* ---------- category complete ---------- */
function showCategoryComplete(){
  const cat = state.category;
  document.getElementById('completeSub').textContent =
    `You have mastered all ${catCards(cat).length} ${CAT_SHORT[cat]} cards.`;
  document.getElementById('completeOverlay').hidden = false;
}
function restartCategory(){
  const cat = state.category;
  const counts = loadCounts();
  catCards(cat).forEach(c => { counts[c.id] = 0; });
  saveCounts(counts);
  closeOverlay();
  renderStats();
  const next = pickNextCard();
  if (next) renderCard(next);
}
function closeOverlay(){ document.getElementById('completeOverlay').hidden = true; }

/* ---------- navigation ---------- */
function goNext(){
  if (activePool(state.category).length === 0){ showCategoryComplete(); return; }
  if (state.current) state.history.push(state.current);
  const next = pickNextCard();
  if (next) renderCard(next);
}
function goPrev(){
  if (state.history.length === 0) return;
  renderCard(state.history.pop());
}
function goShuffle(){
  const pool = activePool(state.category).filter(c => c.id !== state.current);
  const src = pool.length ? pool : activePool(state.category);
  if (src.length === 0){ showCategoryComplete(); return; }
  if (state.current) state.history.push(state.current);
  renderCard(src[Math.floor(Math.random()*src.length)].id);
}
function toggleDirection(){
  state.direction = (state.direction === 'AB') ? 'BA' : 'AB';
  if (state.current) renderCard(state.current);
}

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
  state.current = null;
  state.history = [];
  document.getElementById('catSelect').value = cat;
  renderStats();
  if (activePool(cat).length === 0){ showCategoryComplete(); return; }
  const next = pickNextCard();
  if (next) renderCard(next);
}

/* ---------- reset ---------- */
function resetStats(){
  saveCounts({});
  state.streak = 0; state.best = 0; state.correct = 0; state.total = 0;
  state.lastRenderedLevel = null;
  saveStats();
  renderStats();
  updateLevel();
  switchCategory(state.category);
}

/* ---------- util ---------- */
function shuffle(arr){
  for (let i=arr.length-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; }
  return arr;
}

/* ---------- controls ---------- */
function wireControls(){
  document.getElementById('prevBtn').addEventListener('click', goPrev);
  document.getElementById('nextBtn').addEventListener('click', goNext);
  document.getElementById('shuffleBtn').addEventListener('click', goShuffle);
  document.getElementById('revealBtn').addEventListener('click', revealCurrent);
  document.getElementById('dirBtn').addEventListener('click', toggleDirection);
  document.getElementById('resetBtn').addEventListener('click', resetStats);
  document.getElementById('restartCatBtn').addEventListener('click', restartCategory);
  document.getElementById('closeOverlayBtn').addEventListener('click', closeOverlay);
}

/* ---------- boot ---------- */
async function boot(){
  loadStats();
  wireControls();
  try {
    const res = await fetch('cards.json', { cache: 'no-cache' });
    const cards = await res.json();
    state.cards = cards;
    cards.forEach(c => {
      state.byId[c.id] = c;
      (state.byCat[c.category] = state.byCat[c.category] || []).push(c);
    });
  } catch(e){
    document.getElementById('cardPrompt').textContent = 'Failed to load deck: ' + e.message;
    return;
  }
  state.category = Object.keys(CAT_LABELS).find(c => state.byCat[c]) || Object.keys(state.byCat)[0];
  buildCategorySelect();
  renderStats();
  updateLevel();
  const first = pickNextCard();
  if (first) renderCard(first); else showCategoryComplete();
}

if ('serviceWorker' in navigator){
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
document.addEventListener('DOMContentLoaded', boot);

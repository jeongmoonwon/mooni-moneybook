/* ================= 카테고리 ================= */
const TYPES = ['지출', '수입', '저축', '투자'];
// 기본 카테고리. 사용자가 편집하면 설정(settings.cats)에 저장된 목록을 쓴다.
const DEFAULT_CATS = {
  '수입': ['월급', '환급금', '기타'],
  '지출': ['식비', '간식', '카공', '생필품', '취미/문화생활', '자기개발', '의료/건강', '의류', '미용', '여행',
          '경조사/선물', '가전', '교통비', '통신비', '월세', '기타'],
  '저축': ['비상금', '적금', '청약', '연금저축'],
  '투자': ['주식', 'ETF'],
};
const cats = t => (state.settings.cats && state.settings.cats[t]) || DEFAULT_CATS[t];
const allCats = () => Object.fromEntries(TYPES.map(t => [t, cats(t).slice()]));
const TYPE_COLOR = { '지출': 'var(--s1)', '저축': 'var(--s2)', '투자': 'var(--s3)', '수입': 'var(--income)' };

/* ================= 날짜 · 기간 ================= */
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }
function today() { return ymd(new Date()); }

// 한 달 = 월급일 ~ 다음 월급일 전날. 이름은 "그 돈으로 사는 달" (예: 9/25~10/24 → 10월)
function periodOfDate(s) {
  const d = parse(s), p = state.settings.payday;
  let y = d.getFullYear(), m = d.getMonth() + 1;
  if (p > 1 && d.getDate() >= p) { m++; if (m > 12) { m = 1; y++; } }
  return `${y}-${String(m).padStart(2, '0')}`;
}
// 모든 기록(월급 포함)은 실제 날짜가 속한 기간의 몫이다
const periodOf = e => periodOfDate(e.date);
function periodRange(key) {
  const [y, m] = key.split('-').map(Number), p = state.settings.payday;
  if (p === 1) return { start: ymd(new Date(y, m - 1, 1)), end: ymd(new Date(y, m, 0)) };
  return { start: ymd(new Date(y, m - 2, p)), end: ymd(new Date(y, m - 1, p - 1)) };
}
function shiftPeriod(key, n) {
  const [y, m] = key.split('-').map(Number); const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const md = s => { const d = parse(s); return `${d.getMonth() + 1}.${d.getDate()}`; };

// 공휴일: 우주항공청 월력요항을 정리한 공개 데이터(holidays-kr)를 해마다 받아와 이 기기에 저장해 둔다.
// 대체공휴일·임시공휴일·선거일까지 들어 있고, 새 해 데이터가 올라오면 앱을 고치지 않아도 자동으로 반영된다.
const HOLIDAY_URL = y => `https://cdn.jsdelivr.net/gh/hyunbinseo/holidays-kr@main/public/${y}.json`;
const holidays = {}; // { 'YYYY': { 'YYYY-MM-DD': '이름' } | null(아직 없음) }
function loadHolidays(y) {
  if (y in holidays) return;
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem('holidays-' + y)); } catch { /* 저장소를 못 쓰면 매번 받아옴 */ }
  holidays[y] = cached ? cached.days : null;
  if (cached && Date.now() - cached.at < 7 * 864e5) return; // 일주일에 한 번만 새로 확인
  fetch(HOLIDAY_URL(y)).then(r => r.ok ? r.json() : null).then(json => {
    if (!json) return; // 아직 발표 전인 해
    const days = Object.fromEntries(Object.entries(json).map(([d, names]) => [d, names.join(' · ')]));
    holidays[y] = days;
    try { localStorage.setItem('holidays-' + y, JSON.stringify({ at: Date.now(), days })); } catch { /* 무시 */ }
    if (state.view === 'home') renderCalendar();
  }).catch(() => { /* 오프라인이면 저장해 둔 것(또는 일요일만)으로 표시 */ });
}
function holidayName(s) { const y = s.slice(0, 4); loadHolidays(y); return (holidays[y] || {})[s] || ''; }
const WD = ['일', '월', '화', '수', '목', '금', '토'];

/* ================= 표시 ================= */
const won = n => Math.round(n).toLocaleString('ko-KR') + '원';
const compact = n => n >= 10000 ? (Math.round(n / 1000) / 10).toLocaleString('ko-KR') + '만' : Math.round(n).toLocaleString('ko-KR');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = s => document.querySelector(s);
const sign = e => e.type === '수입' ? '+' : e.type === '지출' ? '−' : '';
const errMsg = err => (err && err.message) || String(err);

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ================= 상태 ================= */
let store = null;
const state = {
  user: null, entries: [], held: [], settings: { payday: 25 }, pending: false,
  view: 'home', type: '지출', category: '식비', date: today(), editing: null, heldEditing: null, rv: [], rvI: 0,
  period: null, calDay: today(), trendType: '지출', trendCat: '', fltType: '', fltCat: '', q: '', visible: [],
  info: false, ceType: '지출', ceDelete: null,
};
function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// 앱 맨 위 제목만 사용자가 바꿀 수 있다. 브라우저 탭·홈 화면·내보내기 파일 이름은 항상 'mooni의 가계부'.
const DEFAULT_TITLE = 'mooni의 가계부';
const appTitle = () => (state.settings.title || '').trim() || DEFAULT_TITLE;
function renderTitle() {
  $('#app-title').textContent = appTitle();
}

function renderSync() {
  $('#sync').textContent = store.demo ? '' : !navigator.onLine ? '오프라인 · 연결되면 동기화' : state.pending ? '동기화 중…' : '동기화됨';
}

/* ================= 기록하기 창 ================= */
function renderForm() {
  if (!cats(state.type).includes(state.category)) state.category = cats(state.type)[0];
  $('#type-seg').innerHTML = TYPES.map(t =>
    `<button data-type="${t}" aria-pressed="${t === state.type}">${t}</button>`).join('');
  $('#cat-chips').innerHTML = cats(state.type).map(c =>
    `<button class="chip" data-cat="${esc(c)}" aria-pressed="${c === state.category}">${esc(c)}</button>`).join('')
    + '<button class="chip ghost-chip" id="open-cats">＋ 편집</button>';
  $('#f-date').value = state.date;
  $('#form-card').classList.toggle('editing', !!state.editing);
  $('#entry-title').textContent = state.editing ? '기록 수정' : '기록하기';
  $('#form-actions').innerHTML = state.editing
    ? `<button class="btn danger" id="del" style="width:auto;padding:14px 18px">삭제</button>
       <button class="btn ghost" id="cancel" style="width:auto;padding:14px 18px">취소</button>
       <button class="btn primary" id="submit">수정 저장</button>`
    : `<button class="btn primary" id="submit">저장</button>`;
  renderSuggest();
}

// 전체 기간 기록에서 이 카테고리 상세내역의 사용 횟수가 많은 순
function renderSuggest() {
  const freq = new Map();
  for (const e of state.entries) {
    const detail = (e.detail || '').trim();
    if (e.type !== state.type || e.category !== state.category || !detail) continue;
    freq.set(detail, (freq.get(detail) || 0) + 1);
  }
  const top = [...freq].sort((a, b) => b[1] - a[1]).slice(0, 8).map(x => x[0]);
  $('#suggest').innerHTML = top.map(d => `<button class="chip sm" data-detail="${esc(d)}">${esc(d)}</button>`).join('');
}

function itemHtml(e) {
  return `<li class="item" data-id="${esc(e.id)}">
    <span class="dot" style="background:${TYPE_COLOR[e.type]}"></span>
    <div class="main"><div class="cat">${e.type} · ${esc(e.category)}</div>
      <div class="det">${esc(e.detail || '—')}${FEELS[e.feel] ? ` <span title="${e.feel}">${FEELS[e.feel]}</span>` : ''}${e.memo ? ` <span class="cat">· ${esc(e.memo)}</span>` : ''}</div></div>
    <div class="amt num">${sign(e)}${won(e.amount)}</div></li>`;
}
function heldItemHtml(h) {
  return `<li class="item" data-held="${esc(h.id)}">
    <span class="held-ic">🙌</span>
    <div class="main"><div class="cat">참은 소비${h.memo ? ` · ${esc(h.memo)}` : ''}</div><div class="det">${esc(h.detail)}</div></div>
    <div class="amt num saved">${h.amount ? won(h.amount) + ' 아낌' : ''}</div></li>`;
}

function amountValue() { return Number($('#f-amount').value.replace(/[^\d]/g, '')) || 0; }
function setAmount(n) { $('#f-amount').value = n ? n.toLocaleString('ko-KR') : ''; }

function resetForm() {
  state.editing = null;
  $('#f-detail').value = ''; setAmount(0); $('#f-memo').value = '';
  renderForm();
}

// 새 기록: 홈에서 고른 날짜(또는 달력에서 고른 날짜)로 기록하기 창을 연다
function openEntry(day) {
  state.date = day || state.calDay || today();
  resetForm();
  $('#entry-sheet').showModal(); document.activeElement.blur();
}

function startEdit(id) {
  const e = state.entries.find(x => x.id === id); if (!e) return;
  state.editing = e; state.type = e.type; state.category = e.category; state.date = e.date;
  $('#f-detail').value = e.detail; setAmount(e.amount); $('#f-memo').value = e.memo || '';
  renderForm();
  if (!$('#entry-sheet').open) $('#entry-sheet').showModal();
}

// 저장하면 화면에는 바로 반영되고, 클라우드 동기화는 뒤에서 진행된다 (오프라인이면 연결될 때까지 대기).
function submit() {
  const amount = amountValue();
  if (!amount) { toast('금액을 입력해 주세요'); $('#f-amount').focus(); return; }
  const prev = state.editing;
  const e = {
    id: prev ? prev.id : newId(), date: $('#f-date').value || today(),
    type: state.type, category: state.category,
    detail: $('#f-detail').value.trim(), amount, memo: $('#f-memo').value.trim(), feel: prev && prev.feel,
  };
  state.date = state.calDay = e.date;
  resetForm();
  $('#entry-sheet').close();
  store.save(e, prev).catch(err => toast('동기화 실패: ' + errMsg(err)));
  toast(prev ? '수정했어요' : `${e.category} ${won(e.amount)} 저장`);
}

function removeEditing() {
  const e = state.editing; if (!e || !confirm(`${e.category} ${won(e.amount)} 기록을 삭제할까요?`)) return;
  resetForm();
  $('#entry-sheet').close();
  store.remove(e).catch(err => toast('동기화 실패: ' + errMsg(err)));
  toast('삭제했어요');
}

/* ================= 홈 ================= */
const HELD = '참음'; // 참은 소비는 기록과 같은 곳에 이 구분으로 저장
const FEELS = { '필수': '🧾', '만족': '😊', '후회': '😣' };

function renderHome() {
  const key = periodOfDate(today()), m = Number(key.slice(5));
  const goal = (state.settings.goals || {})[key] || '';
  $('#home-goal').innerHTML = goal
    ? `<button class="goal" data-goal><span class="e">🎯</span><span class="g-main"><small>${m}월 목표</small><b>${esc(goal)}</b></span><span class="pen">✎</span></button>`
    : `<button class="goal empty" data-goal><span class="e">🎯</span><span class="g-main"><b>${m}월 소비 목표를 정해 보세요</b><small>앱을 켤 때마다 여기에 보여요</small></span></button>`;

  const n = reviewQueue().length;
  $('#home-review').innerHTML = n ? `<button class="review-card" data-review><span class="e">💭</span>
    <span><b>리뷰할 소비 ${n}개</b><small>${reviewCfg().days}일 전에 쓴 돈, 지금 돌아보니 어때요?</small></span><span class="go">›</span></button>` : '';

  const held = state.held.filter(h => periodOf(h) === key), saved = held.reduce((s, h) => s + h.amount, 0);
  $('#home-held').innerHTML = `<div class="held-card"><span class="e">🙌</span>
    <span>${held.length ? `<b>이번 달 참은 소비 ${held.length}번</b><small>${saved ? won(saved) + ' 아꼈어요' : '잘 참았어요!'}</small>`
      : '<b>사려다 참은 게 있나요?</b><small>참은 것도 기록해 두면 뿌듯해요</small>'}</span>
    <button class="chip sm" data-held="">+ 참았어요</button></div>`;

  renderPeriodNav();
  renderCalendar();
}

/* ================= 이번 달 목표 ================= */
function openGoal() {
  state.goalKey = periodOfDate(today());
  $('#g-title').textContent = `${Number(state.goalKey.slice(5))}월 소비 목표`;
  $('#g-text').value = (state.settings.goals || {})[state.goalKey] || '';
  $('#goal-editor').showModal(); $('#g-text').focus();
}
function saveGoal() {
  $('#goal-editor').close();
  store.saveSettings({ goals: { ...state.settings.goals, [state.goalKey]: $('#g-text').value.trim() } }).catch(err => toast('목표 저장 실패: ' + errMsg(err)));
}

/* ================= 참은 소비 ================= */
function openHeld(id) {
  const h = state.heldEditing = state.held.find(x => x.id === id) || null;
  $('#h-title').textContent = h ? '🙌 참은 소비 수정' : '🙌 참은 소비';
  $('#h-date').value = h ? h.date : state.calDay || today();
  $('#h-what').value = h ? h.detail : ''; $('#h-how').value = h ? h.memo : '';
  $('#h-amount').value = h && h.amount ? h.amount.toLocaleString('ko-KR') : '';
  $('#h-actions').innerHTML = (h ? '<button class="btn danger" data-helddel style="width:auto;padding:14px 18px">삭제</button>' : '')
    + '<button class="btn primary" data-heldok>저장</button>';
  $('#held-sheet').showModal();
}
function saveHeld() {
  const what = $('#h-what').value.trim();
  if (!what) { toast('무엇을 참았는지 적어 주세요'); return $('#h-what').focus(); }
  const prev = state.heldEditing;
  const h = { id: prev ? prev.id : newId(), date: $('#h-date').value || today(), type: HELD, category: '', detail: what,
    memo: $('#h-how').value.trim(), amount: Number($('#h-amount').value.replace(/[^\d]/g, '')) || 0 };
  $('#held-sheet').close();
  store.save(h, prev).catch(err => toast('동기화 실패: ' + errMsg(err)));
  toast(prev ? '수정했어요' : '잘 참았어요! 🙌');
}
function removeHeld() {
  const h = state.heldEditing; if (!h || !confirm(`'${h.detail}' 기록을 삭제할까요?`)) return;
  $('#held-sheet').close();
  store.remove(h).catch(err => toast('동기화 실패: ' + errMsg(err)));
}

/* ================= 소비 리뷰 ================= */
// 고른 카테고리(기본: 전체) 중 min원 이상 지출을, 쓴 지 days일 지나면 물어본다. 너무 오래된 건 묻지 않음(그 뒤 30일까지만)
const REVIEW_DEFAULT = { min: 50000, days: 7, cats: null };
const reviewCfg = () => ({ ...REVIEW_DEFAULT, ...(state.settings.review || {}) });
function reviewQueue() {
  const { min, days, cats: rc } = reviewCfg(), until = addDays(today(), -days), from = addDays(until, -30);
  return state.entries.filter(e => e.type === '지출' && !e.feel && e.date >= from && e.date <= until
    && e.amount >= min && (!rc || rc.includes(e.category))).sort((a, b) => a.date.localeCompare(b.date));
}
function openReview() {
  state.rv = reviewQueue(); state.rvI = 0;
  renderReview(); $('#review').showModal(); document.activeElement.blur(); // 첫 버튼에 포커스 테두리가 생기지 않게
}
function renderReview() {
  const e = state.rv[state.rvI];
  if (!e) {
    $('#rv-body').innerHTML = `<div class="rv-done"><span>👏</span><h2>다 돌아봤어요</h2><p class="note">한 달 탭에서 이번 달 소비 만족도를 볼 수 있어요</p>
      <div class="actions"><button class="btn ghost" data-close>닫기</button><button class="btn primary" data-view="month">만족도 보기</button></div></div>`;
    return;
  }
  const d = parse(e.date), ago = Math.round((parse(today()) - d) / 864e5);
  $('#rv-body').innerHTML = `<div class="rv-prog"><span>소비 리뷰</span><span>${state.rvI + 1} / ${state.rv.length}</span></div>
    <div class="rv-card"><p class="rv-when">${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]}) · ${ago}일 전</p>
      <h3>${esc(e.detail || e.category)}</h3><span class="rv-cat">지출 · ${esc(e.category)}</span>
      <div class="rv-amt num">${won(e.amount)}</div>
      <p class="rv-q">지금 돌아보니 어때요?</p>
      <div class="rv-choices">${Object.entries(FEELS).map(([f, ic]) => `<button data-feel="${f}"><span>${ic}</span>${f}</button>`).join('')}</div></div>
    <div class="actions"><button class="btn ghost" data-close>나중에</button><button class="btn ghost" data-feel="skip">이건 안 물어보기</button></div>`;
}
function answerReview(feel) {
  const e = state.rv[state.rvI]; if (!e) return;
  store.save({ ...e, feel }, e).catch(err => toast('동기화 실패: ' + errMsg(err)));
  state.rvI++; renderReview();
}

function saveReviewCfg(patch) {
  store.saveSettings({ review: { ...reviewCfg(), ...patch } }).catch(err => toast('설정 저장 실패: ' + errMsg(err)));
}
function renderReviewCats() {
  const rc = reviewCfg().cats;
  $('#s-rv-cats').innerHTML = `<button class="chip sm" data-rvcat="" aria-pressed="${!rc}">전체</button>`
    + cats('지출').map(c => `<button class="chip sm" data-rvcat="${esc(c)}" aria-pressed="${!rc || rc.includes(c)}">${esc(c)}</button>`).join('');
}
// '전체'를 누르면 모두 선택. 카테고리를 누르면 켜고 끄기 (다 켜지면 다시 '전체')
function toggleReviewCat(c) {
  const all = cats('지출'), cur = reviewCfg().cats || all;
  let next = c === '' ? null : cur.includes(c) ? cur.filter(x => x !== c) : [...cur, c];
  if (next && all.every(x => next.includes(x))) next = null;
  state.settings.review = { ...reviewCfg(), cats: next }; // 화면 먼저 바꾸고 저장은 뒤에서
  renderReviewCats();
  saveReviewCfg({ cats: next });
}

/* ================= 한 달 탭 ================= */
function sumBy(list, keyFn) {
  const m = new Map();
  for (const e of list) m.set(keyFn(e), (m.get(keyFn(e)) || 0) + e.amount);
  return m;
}
function periodEntries(key) { return state.entries.filter(e => periodOf(e) === key); }

function renderPeriodNav() {
  const r = periodRange(state.period);
  const [y, m] = state.period.split('-').map(Number);
  const html = `<button class="step" data-pshift="-1" aria-label="이전 달">‹</button>
    <button class="title" data-pickmonth aria-label="달 고르기"><b>${y}년 ${m}월 <i>▾</i></b><span>${md(r.start)} ~ ${md(r.end)}</span></button>
    <button class="step" data-pshift="1" aria-label="다음 달">›</button>`;
  document.querySelectorAll('[data-period-nav]').forEach(el => el.innerHTML = html);
}

// 달 고르기 창: 연도·월 두 줄을 위아래로 돌려서 가운데 칸에 온 값을 고름 (첫 기록 해 ~ 내년)
const WHEEL_ROW = 44;
function openMonthPicker() {
  const [py, pm] = state.period.split('-').map(Number);
  const years = state.entries.map(e => Number(periodOf(e).slice(0, 4)));
  const from = Math.min(py, new Date().getFullYear(), ...years), to = Math.max(py, new Date().getFullYear() + 1);
  const ys = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const fill = (el, vals, unit) => el.innerHTML = vals.map(v => `<div class="wheel-item">${v}${unit}</div>`).join('');
  fill($('#mp-y'), ys, '년'); fill($('#mp-m'), Array.from({ length: 12 }, (_, i) => i + 1), '월');
  $('#month-picker').showModal();
  setWheel($('#mp-y'), ys.indexOf(py)); setWheel($('#mp-m'), pm - 1);
}
const wheelIndex = el => Math.min(el.children.length - 1, Math.max(0, Math.round(el.scrollTop / WHEEL_ROW)));
function setWheel(el, i, smooth) { if (smooth) el.scrollTo({ top: i * WHEEL_ROW, behavior: 'smooth' }); else el.scrollTop = i * WHEEL_ROW; markWheel(el, i); }
function markWheel(el, i = wheelIndex(el)) { [...el.children].forEach((c, j) => c.classList.toggle('on', j === i)); }
document.querySelectorAll('.wheel').forEach(el => {
  el.addEventListener('scroll', () => markWheel(el), { passive: true });
  el.addEventListener('click', ev => { const it = ev.target.closest('.wheel-item'); if (it) setWheel(el, [...el.children].indexOf(it), true); }); // 위아래 칸을 눌러도 이동
});

// 비교 기준: 보고 있는 달 직전 12개월 중 기록이 있는 달들의 월평균
function baseline(key) {
  const from = shiftPeriod(key, -12);
  const sums = new Map(), months = new Set();
  for (const e of state.entries) {
    const p = periodOf(e);
    if (p < from || p >= key) continue;
    months.add(p);
    for (const k of [e.type, e.type + '|' + e.category]) sums.set(k, (sums.get(k) || 0) + e.amount);
  }
  const n = months.size;
  return { n, avg: k => n ? (sums.get(k) || 0) / n : 0 };
}

// 월평균 대비 변화: ▲ 12% / ▼ 8% / 신규
function chg(cur, k) {
  const b = state.base;
  if (!b.n || !cur) return '<span class="chg"></span>';
  const avg = b.avg(k);
  if (!avg) return '<span class="chg" title="최근 1년 기록 없음">신규</span>';
  const p = Math.round((cur - avg) / avg * 100);
  const txt = p > 0 ? `▲${p}%` : p < 0 ? `▼${-p}%` : '–0%';
  return `<span class="chg num ${p > 0 ? 'up' : p < 0 ? 'down' : ''}" title="최근 1년 월평균 ${won(avg)}">${txt}</span>`;
}

function renderMonth() {
  renderPeriodNav();
  const list = periodEntries(state.period);
  state.base = baseline(state.period);
  const byType = sumBy(list, e => e.type);
  const notes = [
    '예산은 지출만 계산해요. 저축·투자는 아래 카드에 따로 보여줘요.',
    '예산을 정하지 않은 달은 직전에 정한 달의 예산을 그대로 써요.',
    state.base.n ? `▲▼ 최근 1년(${state.base.n}개월) 월평균 대비예요. <span class="up">▲ 늘어남</span> · <span class="down">▼ 줄어듦</span>` : '▲▼ 비교할 최근 1년 기록이 아직 없어요.',
    '수입·지출 모두 실제 날짜가 이 기간 안에 있는 기록만 계산해요.',
  ];
  $('#summary').innerHTML = `
    <div class="card-head">
      <h2 style="margin:0">${state.period === periodOfDate(today()) ? '이번 달 ' : ''}예산</h2>
      <div style="display:flex;align-items:center;gap:4px">
        <button class="chip sm bud-edit" data-budget>${budgetOf(state.period).v ? `예산 ${won(budgetOf(state.period).v)} ✎` : '예산 정하기'}</button>
        <button class="icon-btn info-btn" id="info" aria-label="계산 기준 보기" aria-expanded="${state.info}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="7.8" r=".6" fill="currentColor"/></svg>
        </button>
      </div>
    </div>
    ${state.info ? `<div class="info-box">${notes.map(n => `<p>${n}</p>`).join('')}</div>` : ''}
    ${budgetHtml(list.filter(e => e.type === '지출'))}`;

  const income = byType.get('수입') || 0;
  $('#save-head').innerHTML = `수입 <b class="num">${won(income)}</b> ${chg(income, '수입')}`;
  $('#save-tiles').innerHTML = ['저축', '투자'].map((t, i) => `<div class="tile">
      <div class="t"><span class="sw" style="background:var(--s${i + 2})"></span>${t}</div>
      <b class="num">${won(byType.get(t) || 0)}</b>${chg(byType.get(t) || 0, t)}</div>`).join('');

  const exp = list.filter(e => e.type === '지출');
  $('#cat-bars').innerHTML = barsHtml(sumBy(exp, e => e.category), 'var(--s1)', '지출');
  const sv = list.filter(e => e.type === '저축' || e.type === '투자');
  $('#save-bars').innerHTML = barsHtml(sumBy(sv, e => e.type + '|' + e.category), null, null);
  renderFeel(list.filter(e => e.type === '지출'));
  renderHeldCard(state.held.filter(h => periodOf(h) === state.period));

}

// 소비 만족도: 리뷰한 지출을 금액 기준으로 필수·만족·후회 비율로. 후회한 소비는 큰 순서로
function renderFeel(exp) {
  const done = exp.filter(e => FEELS[e.feel]), total = done.reduce((s, e) => s + e.amount, 0);
  const { min, days } = reviewCfg();
  if (!done.length) {
    $('#feel-card').innerHTML = `<h2>소비 만족도</h2><p class="empty" style="padding:4px 0">아직 리뷰한 소비가 없어요<br>${won(min)} 이상 지출을 ${days}일 뒤 홈에서 물어봐요</p>`;
    return;
  }
  const by = sumBy(done, e => e.feel), col = { '만족': 'var(--brand)', '필수': 'var(--base)', '후회': 'var(--s1)' };
  const order = ['만족', '필수', '후회'], pct = f => Math.round((by.get(f) || 0) / total * 100);
  const regret = done.filter(e => e.feel === '후회').sort((a, b) => b.amount - a.amount).slice(0, 3);
  $('#feel-card').innerHTML = `<h2 style="margin-bottom:2px">소비 만족도</h2><p class="label">리뷰한 지출 ${done.length}건 · ${won(total)} 기준</p>
    <div class="sat">${order.map(f => by.get(f) ? `<i style="flex:${by.get(f)};background:${col[f]}" title="${f} ${won(by.get(f))}"></i>` : '').join('')}</div>
    <div class="sat-leg">${order.map(f => `<span>${FEELS[f]} ${f} <b class="num">${pct(f)}%</b></span>`).join('')}</div>
    ${regret.length ? `<p class="label" style="margin-top:12px">후회한 소비</p><ul class="list">${regret.map(itemHtml).join('')}</ul>` : ''}`;
}

function renderHeldCard(held) {
  const saved = held.reduce((s, h) => s + h.amount, 0);
  $('#held-card').innerHTML = `<div class="card-head" style="margin:0 0 6px"><h2 style="margin:0">참은 소비</h2><button class="chip sm" data-held="">+ 참았어요</button></div>
    ${held.length ? `<p class="label">${held.length}번 참았어요${saved ? ` · ${won(saved)} 아낌` : ''}</p>
      <ul class="list">${held.slice().sort((a, b) => b.date.localeCompare(a.date)).map(heldItemHtml).join('')}</ul>`
      : '<p class="empty" style="padding:4px 0">사려다 참은 게 있으면 기록해 보세요</p>'}`;
}

// 예산: 달마다 정하고, 정하지 않은 달은 직전에 정한 달의 예산을 그대로 쓴다
function budgetOf(key) {
  const b = state.settings.budgets || {};
  if (b[key]) return { v: b[key], own: true };
  const prev = Object.keys(b).filter(k => k < key && b[k]).sort().at(-1);
  return { v: prev ? b[prev] : 0, own: false };
}

// 예산 카드: 남은 예산 + 날짜별 누적 지출 선 vs 예산을 고르게 쓸 때의 선. 이번 달이면 이 속도로 월말에 얼마가 될지 예상
function budgetHtml(exp) {
  const { start, end } = periodRange(state.period), t = today();
  const days = Math.round((parse(end) - parse(start)) / 864e5) + 1;
  const now = t < start ? -1 : t > end ? days - 1 : Math.round((parse(t) - parse(start)) / 864e5); // 선을 그릴 마지막 날
  const live = t >= start && t <= end;
  const budget = budgetOf(state.period).v;
  const byDay = sumBy(exp, e => e.date), cum = [];
  for (let i = 0, c = 0; i <= now; i++) { c += byDay.get(addDays(start, i)) || 0; cum.push(c); }
  const spent = exp.reduce((s, e) => s + e.amount, 0), rest = budget - spent;
  const proj = live && now >= 2 ? spent / (now + 1) * days : 0; // 3일은 지나야 예상

  const top = budget
    ? `<div><p class="label">${rest >= 0 ? '남은 예산' : '예산 초과'}</p><div class="hero num ${rest < 0 ? 'over' : ''}">${rest < 0 ? '−' : ''}${won(Math.abs(rest))}</div></div>
       ${live ? `<div class="bud-side"><p class="label">하루에</p><b class="num">${won(Math.max(rest, 0) / (days - now))}</b></div>`
              : `<div class="bud-side"><p class="label">쓴 돈</p><b class="num">${won(spent)}</b></div>`}`
    : `<div><p class="label">쓴 돈</p><div class="hero num">${won(spent)}</div></div>`;

  const W = 320, H = 170, L = 8, T = 18, B = 24;
  const max = Math.max(budget, spent, 1) * 1.08; // 월말 예상은 그래프에 안 그리니 높이 계산에서 빼서, 예산선이 위쪽에 오게
  const X = i => L + (W - L * 2) * (days > 1 ? i / (days - 1) : 0.5), Y = v => T + (H - T - B) * (1 - v / max);
  let g = `<line class="axis-l" x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}"/>`;
  if (budget) g += `<line class="bud-l" x1="0" x2="${W}" y1="${Y(budget)}" y2="${Y(budget)}"/>
    <text class="bud-t" x="${W - 2}" y="${Y(budget) - 5}" text-anchor="end">예산 ${compact(budget)}</text>
    <line class="pace-l" x1="${X(0)}" y1="${Y(0)}" x2="${X(days - 1)}" y2="${Y(budget)}"/>`;
  if (cum.length) {
    const pts = cum.map((v, i) => `${X(i)},${Y(v)}`).join(' '), lx = X(now), ly = Y(spent);
    g += `<polygon class="cum-a" points="${X(0)},${Y(0)} ${pts} ${lx},${Y(0)}"/><polyline class="cum-l" points="${pts}"/>
      <circle class="cum-d" cx="${lx}" cy="${ly}" r="4.5"/>
      <text class="cum-t" x="${Math.min(Math.max(lx, 20), W - 20)}" y="${ly - 9}" text-anchor="middle">${compact(spent)}</text>`;
  }
  g += `<text x="${X(0)}" y="${H - 6}">${md(start)}</text><text x="${X(days - 1)}" y="${H - 6}" text-anchor="end">${md(end)}</text>`;
  if (live && now > 2 && now < days - 3) g += `<text class="today-t" x="${X(now)}" y="${H - 6}" text-anchor="middle">오늘</text>`;

  let note = '';
  if (budget && live && proj) note = proj > budget
    ? `<p class="bud-note bad">이 속도면 월말에 약 ${compact(proj)}원 · ${compact(proj - budget)}원 초과 예상</p>`
    : `<p class="bud-note good">이 속도면 월말에 약 ${compact(proj)}원 · 예산 안이에요</p>`;
  else if (budget && t > end) note = rest < 0
    ? `<p class="bud-note bad">예산보다 ${won(-rest)} 더 썼어요</p>`
    : `<p class="bud-note good">예산보다 ${won(rest)} 덜 썼어요</p>`;
  else if (!budget) note = '<p class="bud-note">예산을 정하면 남은 돈과 하루에 쓸 수 있는 돈을 알려줘요</p>';

  return `<div class="bud-top">${top}</div>
    <svg class="bud-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="날짜별 누적 지출">${g}</svg>
    <div class="bud-legend"><span><i class="k-cum"></i>쓴 돈(누적)</span>${budget ? '<span><i class="k-pace"></i>고르게 쓸 때</span><span><i class="k-bud"></i>예산</span>' : ''}</div>
    ${note}`;
}

function openBudget(key = state.period) {
  state.budgetKey = key;
  const [y, m] = key.split('-').map(Number), v = budgetOf(key).v;
  $('#b-title').textContent = `${y}년 ${m}월 예산`;
  $('#b-amount').value = v ? v.toLocaleString('ko-KR') : '';
  $('#budget-editor').showModal(); $('#b-amount').focus();
}
function saveBudget() {
  const v = Number($('#b-amount').value.replace(/[^\d]/g, ''));
  if (!v) { toast('예산을 입력해 주세요'); return $('#b-amount').focus(); }
  $('#budget-editor').close();
  store.saveSettings({ budgets: { ...state.settings.budgets, [state.budgetKey]: v } }).catch(err => toast('예산 저장 실패: ' + errMsg(err)));
}

function barsHtml(map, color, type) {
  const rows = [...map].sort((a, b) => b[1] - a[1]);
  if (!rows.length) return '<p class="empty">기록이 없어요</p>';
  const max = rows[0][1];
  return rows.map(([k, v]) => {
    let t = type, c = k;
    if (!type) [t, c] = k.split('|');
    const col = color || `var(--s${t === '저축' ? 2 : 3})`;
    return `<div class="bar-row" data-jump="${esc(t)}|${esc(c)}"><span class="name">${esc(c)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${v / max * 100}%;background:${col}"></div></div>
      <span class="v num">${won(v)}</span>${chg(v, t + '|' + c)}</div>`;
  }).join('');
}

// 하루 지출을 "평소 하루 지출"(최근 1년, 지출이 있던 날들의 중간값)과 비교해 4단계 점으로 표시.
// 중간값이라 월세 같은 큰 결제에 기준이 끌려가지 않는다. 최근 1년 기록이 없으면 이번 달 기록으로 계산.
const LEVELS = [[0.5, '평소의 절반 미만'], [1, '평소보다 적음'], [2, '평소의 2배 미만'], [Infinity, '평소의 2배 이상']];
function median(nums) {
  if (!nums.length) return 0;
  const a = nums.slice().sort((x, y) => x - y), m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function dailySpend(from, to) {
  return [...sumBy(state.entries.filter(e => e.type === '지출' && e.date >= from && e.date <= to), e => e.date).values()];
}
// 달력은 계산 기준(어느 달 몫인지)과 상관없이 실제 날짜 그대로 보여준다.
// 예: 9/23에 일찍 들어온 월급은 10월 수입으로 계산되지만, 달력에는 9/23에 표시된다.
function renderCalendar() {
  const { start, end } = periodRange(state.period);
  const list = state.entries.filter(e => e.date >= start && e.date <= end);
  const ex = sumBy(list.filter(e => e.type === '지출'), e => e.date);
  const inc = sumBy(list.filter(e => e.type === '수입'), e => e.date);
  const t = today();
  const past = dailySpend(periodRange(shiftPeriod(state.period, -12)).start, addDays(start, -1));
  const ref = median(past.length ? past : [...ex.values()]);
  const level = v => LEVELS.findIndex(([r]) => v < ref * r) + 1;

  let html = WD.map(w => `<div class="wd">${w}</div>`).join('');
  html += '<div></div>'.repeat(parse(start).getDay());
  for (let s = start; s <= end; s = addDays(s, 1)) {
    const d = parse(s), v = ex.get(s);
    const lab = d.getDate() === 1 || s === start ? `${d.getMonth() + 1}/${d.getDate()}` : d.getDate();
    const hol = holidayName(s);
    html += `<button data-day="${s}" aria-pressed="${s === state.calDay}" class="${d.getDay() === 0 || hol ? 'sun' : ''}"
      aria-label="${d.getMonth() + 1}월 ${d.getDate()}일${hol ? ' ' + esc(hol) : ''}${v ? ' 지출 ' + won(v) : ''}"${hol ? ` title="${esc(hol)}"` : ''}>
      <span class="d ${s === t ? 'today' : ''}">${lab}</span>
      ${v ? `<span class="lv lv${level(v)}" title="지출 ${won(v)}"></span>` : '<span class="lv"></span>'}
      ${inc.get(s) ? `<span class="in num">+${compact(inc.get(s))}</span>` : ''}</button>`;
  }
  $('#cal').innerHTML = html;
  $('#cal-legend').innerHTML = ref ? `<span>지출 적음</span>${[1, 2, 3, 4].map(i => `<span class="lv lv${i}" title="${LEVELS[i - 1][1]}"></span>`).join('')}
    <span>많음</span><span class="mu">· 평소 하루 ${won(ref)} 기준 (${past.length ? '최근 1년' : '이번 달'} 중간값)</span>` : '';

  if (!state.calDay) { $('#cal-list').innerHTML = ''; return; }
  const dayList = state.entries.filter(e => e.date === state.calDay), heldList = state.held.filter(h => h.date === state.calDay);
  const dd = parse(state.calDay), dayEx = ex.get(state.calDay) || 0;
  $('#cal-list').innerHTML = `<div class="day-head"><span>${dd.getMonth() + 1}월 ${dd.getDate()}일 (${WD[dd.getDay()]})${holidayName(state.calDay) ? ` · <span class="hol-name">${esc(holidayName(state.calDay))}</span>` : ''}</span>
    <span class="num">${dayEx ? '지출 ' + won(dayEx) : ''}</span></div>
    <button class="btn ghost add-day" data-addday="${state.calDay}">＋ 이 날 내역 추가</button>
    <ul class="list">${dayList.length || heldList.length ? dayList.map(itemHtml).join('') + heldList.map(heldItemHtml).join('') : '<li class="empty">이 날은 기록이 없어요</li>'}</ul>`;
}

// 달력에서 고른 날짜로 기록하기 창을 연다
function addOnDay(day) { openEntry(day); }

/* ================= 내역 탭 ================= */
function renderList() {
  renderPeriodNav();
  $('#flt-type').innerHTML = ['<option value="">전체 구분</option>', ...TYPES.map(t =>
    `<option ${t === state.fltType ? 'selected' : ''}>${t}</option>`)].join('');
  const names = state.fltType ? cats(state.fltType) : [...new Set(TYPES.flatMap(cats))];
  if (!names.includes(state.fltCat)) state.fltCat = '';
  $('#flt-cat').innerHTML = ['<option value="">전체 카테고리</option>', ...names.map(c =>
    `<option ${c === state.fltCat ? 'selected' : ''}>${esc(c)}</option>`)].join('');

  const q = state.q.trim().toLowerCase();
  let list = q ? state.entries : periodEntries(state.period);
  list = list.filter(e => (!state.fltType || e.type === state.fltType) && (!state.fltCat || e.category === state.fltCat)
    && (!q || (e.detail + ' ' + e.memo).toLowerCase().includes(q)));
  list.sort((a, b) => b.date.localeCompare(a.date));
  state.visible = list;

  const shown = list.slice(0, 400);
  let html = '', cur = null;
  const dayExp = sumBy(shown.filter(e => e.type === '지출'), e => e.date);
  for (const e of shown) {
    if (e.date !== cur) {
      if (cur) html += '</ul>';
      cur = e.date; const d = parse(cur);
      html += `<div class="day-head"><span>${d.getFullYear() !== new Date().getFullYear() ? d.getFullYear() + '. ' : ''}${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})</span>
        <span class="num">${dayExp.get(cur) ? '지출 ' + won(dayExp.get(cur)) : ''}</span></div><ul class="list">`;
    }
    html += itemHtml(e);
  }
  if (cur) html += '</ul>';
  const byType = sumBy(list, e => e.type);
  const totals = TYPES.filter(t => byType.get(t))
    .map(t => `<span style="white-space:nowrap">${t} <b class="num" style="color:var(--t1)">${won(byType.get(t))}</b></span>`).join('');
  const head = `<div class="day-head"><span style="white-space:nowrap">${list.length}건${list.length > shown.length ? ` (최근 ${shown.length}건 표시)` : ''}</span>
    <span style="display:flex;flex-wrap:wrap;justify-content:flex-end;gap:2px 12px">${totals}</span></div>`;
  $('#all-list').innerHTML = list.length ? head + html : '<p class="empty">조건에 맞는 기록이 없어요</p>';
}

/* ================= 추이 탭 ================= */
const PEAK_RATIO = 1.5; // 평소(직전 12개월 월 금액의 평균)의 1.5배 이상이면 피크

// 첫 기록이 있는 달부터 이번 달까지, 월(월급일 기준)별 합계와 평소 수준 (type: 지출 또는 수입, cat: 비우면 전체)
// 카테고리를 골라도 기간은 그 type 전체 기록 기준이라, 카테고리를 바꿔도 가로축이 그대로예요
function monthlyTotals(type, cat = '') {
  const sums = new Map(), seen = new Set();
  for (const e of state.entries) {
    if (e.type !== type) continue;
    seen.add(periodOf(e));
    if (!cat || e.category === cat) sums.set(periodOf(e), (sums.get(periodOf(e)) || 0) + e.amount);
  }
  if (!sums.size) return [];
  const keys = [...seen].sort();
  const last = [keys.at(-1), periodOfDate(today())].sort().at(-1);
  const months = [];
  for (let k = keys[0]; k <= last; k = shiftPeriod(k, 1)) months.push(k);
  return months.map((k, i) => {
    const v = sums.get(k) || 0;
    const prev = months.slice(Math.max(0, i - 12), i).map(x => sums.get(x) || 0);
    const base = prev.length >= 3 ? Math.round(prev.reduce((a, b) => a + b, 0) / prev.length) : 0; // 비교할 달이 3개 이상 쌓여야 판단
    return { k, v, base, peak: base > 0 && v >= base * PEAK_RATIO };
  });
}

// 세로축 최댓값: 전체 기간 실제 최댓값을 100만원 단위로 올림(100만원 미만이면 10만원 단위). 눈금은 그 최댓값을 5칸 이하로 나누는 간격
function niceMax(v) {
  const UNIT = v < 1000000 ? 100000 : 1000000;
  const max = Math.max(1, Math.ceil(v / UNIT)) * UNIT;
  const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].map(x => x * 10000).find(st => max % st === 0 && max / st <= 5) || UNIT;
  return { max, step };
}

const TREND_TYPES = {
  '지출': { color: 'var(--s1)', peak: 'var(--up)', verb: '쓴', top: '가장 큰 지출' },
  '수입': { color: 'var(--income)', peak: 'var(--income)', verb: '들어온', top: '가장 큰 수입' },
};

function renderTrend() {
  const type = state.trendType, cfg = TREND_TYPES[type];
  if (state.trendCat && !cats(type).includes(state.trendCat)) state.trendCat = '';
  const cat = state.trendCat;
  $('#trend-seg').innerHTML = Object.keys(TREND_TYPES).map(t => `<button data-trendtype="${t}" aria-pressed="${t === type}">${t}</button>`).join('');
  $('#trend-cats').innerHTML = ['', ...cats(type)].map(c =>
    `<button class="chip" data-trendcat="${esc(c)}" aria-pressed="${c === cat}">${c ? esc(c) : '전체'}</button>`).join('');
  $('#trend-title').textContent = `월별 ${type}${cat ? ' · ' + cat : ''}`;
  $('#trend-leg-name').textContent = type;
  const view = $('#view-trend');
  view.style.setProperty('--series', cfg.color); view.style.setProperty('--peak', cfg.peak);
  const data = monthlyTotals(type, cat);
  const H = 236, T = 26, B = 34, COL = 44, PAD = 18;
  const ph = H - T - B;
  if (!data.length) {
    $('#trend-sub').textContent = '';
    $('#trend-axis').innerHTML = ''; $('#trend-chart').innerHTML = '';
    $('#trend-detail').innerHTML = `<p class="empty">${cat ? '이 카테고리' : type} 기록이 쌓이면 그래프가 그려져요</p>`;
    return;
  }
  const { max, step } = niceMax(Math.max(...data.map(d => Math.max(d.v, d.base))));
  // 달이 적어도 그래프가 카드 가로폭을 다 채우게 간격을 넓힘 (달이 많으면 COL 간격으로 옆으로 밀어 보기)
  const n = data.length, fill = $('#trend-scroll').clientWidth;
  const col = n > 1 ? Math.max(COL, (fill - PAD * 2) / (n - 1)) : COL;
  const W = n > 1 ? PAD * 2 + col * (n - 1) : Math.max(fill, PAD * 2);
  const X = i => n > 1 ? PAD + col * i : W / 2, Y = v => T + ph * (1 - v / max);
  const peaks = data.filter(d => d.peak).length;
  const label = k => `${k.slice(2, 4)}.${Number(k.slice(5))}`;
  $('#trend-sub').textContent = `${label(data[0].k)} ~ ${label(data.at(-1).k)} · ${data.length}개월 · 피크 ${peaks}번`;

  const ticks = []; for (let v = 0; v <= max; v += step) ticks.push(v);
  $('#trend-axis').setAttribute('viewBox', `0 0 40 ${H}`);
  $('#trend-axis').innerHTML = ticks.map(v => `<text x="36" y="${Y(v) + 3}" text-anchor="end">${v ? compact(v) : 0}</text>`).join('');

  const svg = $('#trend-chart');
  svg.setAttribute('width', W); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('aria-label', `월별 ${type}${cat ? ' ' + cat : ''} 그래프, 피크 ${peaks}번`);
  const line = data.map((d, i) => `${X(i)},${Y(d.v)}`).join(' ');
  const baseSegs = data.map((d, i) => d.base ? `${X(i)},${Y(d.base)}` : null);
  const basePath = baseSegs.reduce((acc, p, i) => acc + (p ? `${i && baseSegs[i - 1] ? 'L' : 'M'}${p}` : ''), '');
  const sel = data.findIndex(d => d.k === state.trendSel);

  let g = ticks.map(v => `<line class="grid-l" x1="0" x2="${W}" y1="${Y(v)}" y2="${Y(v)}"/>`).join('');
  g += `<polygon class="area" points="${X(0)},${Y(0)} ${line} ${X(data.length - 1)},${Y(0)}"/>`;
  g += `<path class="base-l" d="${basePath}"/><polyline class="line" points="${line}"/>`;
  data.forEach((d, i) => {
    const m = Number(d.k.slice(5));
    g += `<text x="${X(i)}" y="${H - 18}" text-anchor="middle">${m}월</text>`;
    if (m === 1 || i === 0) g += `<text class="yr" x="${X(i)}" y="${H - 4}" text-anchor="middle">${d.k.slice(0, 4)}</text>`;
    g += `<rect class="hit" data-tm="${d.k}" x="${X(i) - col / 2}" y="0" width="${col}" height="${H}"><title>${label(d.k)} ${won(d.v)}</title></rect>`;
    g += `<line class="guide ${i === sel ? 'on' : ''}" x1="${X(i)}" x2="${X(i)}" y1="${Y(d.v)}" y2="${T + ph}"/>`; // 점에서 바닥까지만
  });
  data.forEach((d, i) => { if (d.peak) g += `<circle class="pk" cx="${X(i)}" cy="${Y(d.v)}" r="5.5"/>`; });
  if (sel >= 0) {
    const d = data[sel], txt = compact(d.v) + '원', w = txt.length * 6.6 + 14;
    const bx = Math.min(Math.max(X(sel) - w / 2, 2), W - w - 2), by = Math.max(Y(d.v) - 30, 0);
    g += `<circle class="sel" cx="${X(sel)}" cy="${Y(d.v)}" r="5"/>
      <g class="bubble"><rect x="${bx}" y="${by}" width="${w}" height="20" rx="10"/><text x="${bx + w / 2}" y="${by + 14}" text-anchor="middle">${txt}</text></g>`;
  }
  svg.innerHTML = g;

  const sc = $('#trend-scroll');
  if (!state.trendScrolled) { sc.scrollLeft = sc.scrollWidth; state.trendScrolled = true; } // 처음엔 최근 달부터
  if (sel >= 0) { // 고른 달이 가장자리에 걸리면 안쪽으로 당겨서 말풍선까지 보이게
    const x = X(sel), room = 50;
    if (x < sc.scrollLeft + room) sc.scrollLeft = x - room;
    else if (x > sc.scrollLeft + sc.clientWidth - room) sc.scrollLeft = x - sc.clientWidth + room;
  }
  renderTrendDetail(sel >= 0 ? data[sel] : null);
}

function renderTrendDetail(d) {
  const box = $('#trend-detail');
  if (!d) {
    const cfg = TREND_TYPES[state.trendType];
    box.innerHTML = `<p class="empty" style="padding:6px 0">그래프의 점을 누르면 그 달을 자세히 볼 수 있어요<br>동그라미는 평소보다 1.5배 넘게 ${cfg.verb} 달이에요</p>`;
    return;
  }
  const r = periodRange(d.k), [y, m] = d.k.split('-').map(Number), cat = state.trendCat;
  const inMonth = state.entries.filter(e => e.type === state.trendType && periodOf(e) === d.k);
  const top = inMonth.filter(e => !cat || e.category === cat).sort((a, b) => b.amount - a.amount).slice(0, 3);
  const total = inMonth.reduce((s, e) => s + e.amount, 0);
  const diff = d.base ? Math.round((d.v - d.base) / d.base * 100) : null;
  box.innerHTML = `
    <div class="td-top">
      <div><p class="label" style="margin:0">${y}년 ${m}월 · ${md(r.start)} ~ ${md(r.end)}${d.peak ? '<span class="peak-badge">피크</span>' : ''}</p>
        <div class="hero num">${won(d.v)}</div></div>
      <button class="chip" data-gomonth="${d.k}">이 달 보기</button>
    </div>
    <p class="td-cmp">${d.base && !diff ? `평소(${won(d.base)})와 같아요` : d.base ? `평소 ${won(d.base)}보다 <b class="${diff > 0 ? 'chg up' : 'chg down'}" style="font-size:13px">${diff > 0 ? '▲' : '▼'}${Math.abs(diff)}%</b>` : '평소와 비교하려면 3개월 이상 기록이 필요해요'}</p>
    ${cat && total ? `<p class="td-cmp">이 달 ${state.trendType}의 ${Math.round(d.v / total * 100)}%</p>` : ''}
    ${top.length ? `<p class="label">${TREND_TYPES[state.trendType].top}${cat ? ` (${esc(cat)})` : ''}</p><ul class="list">${top.map(itemHtml).join('')}</ul>` : ''}`;
}

/* ================= 화면 전환 ================= */
function go(view) {
  state.view = view;
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'view-' + view));
  document.querySelectorAll('nav.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.view === view));
  refreshAll();
}
function refreshAll() {
  if (!state.user) return;
  renderSync();
  renderTitle();
  if ($('#entry-sheet').open) renderForm();
  if (state.view === 'home') renderHome();
  if (state.view === 'month') renderMonth();
  if (state.view === 'list') renderList();
  if (state.view === 'trend') renderTrend();
}

/* ================= 내보내기 ================= */
const EXPORT_HEAD = ['날짜', '구분', '카테고리', '상세내역', '금액', '메모', 'ID'];
function exportRows() {
  const scope = document.querySelector('input[name=ex-scope]:checked').value;
  const list = (scope === 'view' ? state.visible : state.entries).slice().sort((a, b) => a.date.localeCompare(b.date));
  return [EXPORT_HEAD].concat(list.map(e => [e.date, e.type, e.category, e.detail, e.amount, e.memo, e.id]));
}

function openExport() {
  $('#ex-all').textContent = `전체 기록 (${state.entries.length.toLocaleString()}건)`;
  $('#ex-view').textContent = `지금 내역 탭에 보이는 것 (${state.visible.length.toLocaleString()}건)`;
  $('#ex-msg').textContent = '';
  $('#export').showModal();
}

function exportCsv() {
  const cell = v => /[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
  const csv = exportRows().map(r => r.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })); // BOM: 엑셀 한글 깨짐 방지
  a.download = `mooni의 가계부_${today()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  $('#ex-msg').textContent = 'CSV 파일을 저장했어요.';
}

async function exportSheet() {
  const msg = $('#ex-msg');
  msg.textContent = '구글 계정 확인 중…';
  try {
    const url = await store.exportToSheet(`mooni의 가계부 ${today()}`, exportRows());
    msg.innerHTML = `내 구글 드라이브에 만들었어요. <a href="${esc(url)}" target="_blank" rel="noopener">스프레드시트 열기 →</a>`;
  } catch (err) {
    msg.textContent = err && err.code === 'auth/popup-closed-by-user' ? '취소했어요.' : '만들기 실패: ' + errMsg(err);
  }
}

/* ================= 카테고리 편집 ================= */
function openCats(type) {
  state.ceType = type || state.type; state.ceDelete = null;
  $('#ce-new').value = '';
  renderCats();
  if (!$('#cat-editor').open) $('#cat-editor').showModal();
}

function renderCats() {
  const t = state.ceType;
  const counts = new Map();
  for (const e of state.entries) if (e.type === t) counts.set(e.category, (counts.get(e.category) || 0) + 1);
  $('#ce-seg').innerHTML = TYPES.map(x => `<button data-cetype="${x}" aria-pressed="${x === t}">${x}</button>`).join('');
  $('#ce-list').innerHTML = cats(t).map(c => {
    const k = counts.get(c) || 0;
    const row = `<li class="ce-row">
      <input class="input ce-name" data-old="${esc(c)}" value="${esc(c)}" maxlength="20" aria-label="${esc(c)} 이름">
      <span class="ce-count num">${k ? k.toLocaleString() + '건' : ''}</span>
      <button class="icon-btn" data-cedel="${esc(c)}" aria-label="${esc(c)} 삭제">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
      </button></li>`;
    if (state.ceDelete !== c) return row;
    const others = cats(t).filter(x => x !== c);
    return row + `<li class="ce-move">기록 ${k.toLocaleString()}건을
      <select class="input" id="ce-target">${others.map(x => `<option>${esc(x)}</option>`).join('')}</select>로 옮기고
      <span class="row" style="margin-top:8px"><button class="btn danger" id="ce-del-ok" style="padding:8px">삭제</button>
      <button class="btn ghost" id="ce-del-cancel" style="padding:8px">취소</button></span></li>`;
  }).join('');
}

function saveCats(type, list) {
  const next = allCats(); next[type] = list;
  return store.saveSettings({ cats: next }).catch(err => toast('저장 실패: ' + errMsg(err)));
}

function moveCategory(type, from, to) {
  const list = state.entries.filter(e => e.type === type && e.category === from);
  if (state.type === type && state.category === from) state.category = to;
  if (state.fltType === type && state.fltCat === from) state.fltCat = to;
  if (list.length) store.moveEntries(list, to).catch(err => toast('기록 옮기기 실패: ' + errMsg(err)));
}

function addCat() {
  const t = state.ceType, name = $('#ce-new').value.trim();
  if (!name) return $('#ce-new').focus();
  if (cats(t).includes(name)) return toast('이미 있는 카테고리예요');
  saveCats(t, cats(t).concat(name));
  $('#ce-new').value = '';
  toast(`${t} · ${name} 추가`);
}

function renameCat(input) {
  const t = state.ceType, from = input.dataset.old, to = input.value.trim();
  if (!to || to === from) { input.value = from; return; }
  const list = cats(t);
  if (list.includes(to)) {
    if (!confirm(`'${to}' 카테고리가 이미 있어요. '${from}' 기록을 '${to}'로 합칠까요?`)) { input.value = from; return; }
    saveCats(t, list.filter(c => c !== from));
  } else {
    saveCats(t, list.map(c => c === from ? to : c));
  }
  moveCategory(t, from, to);
  toast(`'${from}' → '${to}'`);
}

function deleteCat(name) {
  const t = state.ceType, list = cats(t);
  if (list.length === 1) return toast('카테고리는 하나 이상 있어야 해요');
  const has = state.entries.some(e => e.type === t && e.category === name);
  if (has) { // 기록을 옮길 곳부터 고르게 한다
    state.ceDelete = name; renderCats();
    return $('.ce-move').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  if (!confirm(`'${name}' 카테고리를 삭제할까요?`)) return;
  saveCats(t, list.filter(c => c !== name));
  toast(`'${name}' 삭제`);
}

function confirmDeleteCat() {
  const t = state.ceType, name = state.ceDelete, to = $('#ce-target').value;
  state.ceDelete = null;
  saveCats(t, cats(t).filter(c => c !== name));
  moveCategory(t, name, to);
  toast(`'${name}' 삭제 · 기록은 '${to}'로 옮겼어요`);
}

/* ================= 설정 · 가져오기 ================= */
function openSettings() {
  $('#s-account').textContent = state.user.email || '';
  $('#s-title').value = appTitle();
  $('#sign-out').hidden = store.demo;
  $('#s-payday').innerHTML = Array.from({ length: 28 }, (_, i) => i + 1)
    .map(n => `<option value="${n}" ${n === state.settings.payday ? 'selected' : ''}>${n === 1 ? '매달 1일 (달력 그대로)' : `매달 ${n}일`}</option>`).join('');
  const rv = reviewCfg();
  $('#s-rv-min').value = rv.min ? rv.min.toLocaleString('ko-KR') : '';
  $('#s-rv-days').innerHTML = Array.from({ length: 30 }, (_, i) => i + 1)
    .map(n => `<option value="${n}" ${n === rv.days ? 'selected' : ''}>${n}일 뒤</option>`).join('');
  renderReviewCats();
  $('#s-import-msg').textContent = '';
  $('#settings').showModal();
}

function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(Boolean));
}

async function importCsv(file) {
  const msg = $('#s-import-msg');
  const [head, ...body] = parseCsv(await file.text());
  const col = n => head.indexOf(n);
  const need = ['날짜', '구분', '카테고리', '상세내역', '금액'];
  if (need.some(n => col(n) < 0)) { msg.textContent = `열 이름이 달라요. 필요한 열: ${need.join(', ')}`; return; }
  const known = new Set(state.entries.map(e => e.id));
  const rows = body.map(r => ({
    id: (col('ID') >= 0 && r[col('ID')]) || newId(), date: r[col('날짜')], type: r[col('구분')], category: r[col('카테고리')],
    detail: r[col('상세내역')], amount: Number(String(r[col('금액')]).replace(/[^\d.-]/g, '')) || 0,
    memo: col('메모') >= 0 ? r[col('메모')] || '' : '',
  })).filter(e => !known.has(e.id));
  const bad = rows.filter(e => !TYPES.includes(e.type) || !cats(e.type).includes(e.category) || !/^\d{4}-\d{2}-\d{2}$/.test(e.date));
  if (bad.length) { msg.textContent = `형식이 맞지 않는 행이 ${bad.length}개 있어요 (예: ${bad[0].date} ${bad[0].type}/${bad[0].category}). 없는 카테고리라면 먼저 카테고리 편집에서 추가해 주세요.`; return; }
  if (!rows.length) { msg.textContent = '새로 가져올 내역이 없어요 (이미 모두 들어 있어요).'; return; }
  if (!confirm(`${rows.length.toLocaleString()}건을 가져올까요?`)) return;
  msg.textContent = '가져오는 중…';
  try { await store.importMany(rows); msg.textContent = `${rows.length.toLocaleString()}건을 가져왔어요.`; }
  catch (err) { msg.textContent = '가져오기 실패: ' + errMsg(err) + ' — 다시 시도하면 빠진 것만 이어서 가져와요.'; }
}

/* ================= 이벤트 ================= */
addEventListener('resize', () => { if (state.view === 'trend') renderTrend(); }); // 화면 폭이 바뀌면 그래프 폭도 다시 맞춤
document.querySelectorAll('dialog').forEach(dl => dl.addEventListener('click', ev => { if (ev.target === dl) dl.close(); })); // 바깥 누르면 닫기
$('#entry-sheet').addEventListener('close', () => { state.editing = null; });
$('#trend-chart').addEventListener('click', ev => {
  const r = ev.target.closest('[data-tm]'); if (!r) return;
  state.trendSel = state.trendSel === r.dataset.tm ? null : r.dataset.tm;
  renderTrend();
});
document.addEventListener('click', ev => {
  const b = ev.target.closest('button, .item, .bar-row'); if (!b) return;
  const d = b.dataset;
  if (d.view) { if (b.closest('dialog')) b.closest('dialog').close(); return go(d.view); }
  if (d.type) { state.type = d.type; state.category = cats(d.type)[0]; return renderForm(); }
  if (d.cat) { state.category = d.cat; return renderForm(); }
  if (d.detail) { $('#f-detail').value = d.detail; return $('#f-amount').focus(); }
  if (d.add !== undefined) { setAmount(d.add === '0' ? 0 : amountValue() + Number(d.add)); return; }
  if (d.shift) { state.date = addDays($('#f-date').value || today(), Number(d.shift)); return renderForm(); }
  if (d.pickmonth !== undefined) return openMonthPicker();
  if (d.budget !== undefined) return openBudget(d.budget || state.period);
  if (d.goal !== undefined) return openGoal();
  if (d.goalok !== undefined) return saveGoal();
  if (d.review !== undefined) return openReview();
  if (d.feel) return answerReview(d.feel);
  if (d.held !== undefined) return openHeld(d.held);
  if (d.heldok !== undefined) return saveHeld();
  if (d.helddel !== undefined) return removeHeld();
  if (d.rvcat !== undefined) return toggleReviewCat(d.rvcat);
  if (d.budgetok !== undefined) return saveBudget();
  if (d.pickok !== undefined) {
    const y = parseInt($('#mp-y').children[wheelIndex($('#mp-y'))].textContent), m = wheelIndex($('#mp-m')) + 1;
    $('#month-picker').close(); state.period = `${y}-${String(m).padStart(2, '0')}`; state.calDay = null; return refreshAll();
  }
  if (d.pshift) { state.period = shiftPeriod(state.period, Number(d.pshift)); state.calDay = null; return refreshAll(); }
  if (d.trendtype) { state.trendType = d.trendtype; state.trendCat = ''; state.trendSel = null; state.trendScrolled = false; return renderTrend(); }
  if (d.trendcat !== undefined) { state.trendCat = d.trendcat; return renderTrend(); }
  if (d.addday) return addOnDay(d.addday);
  if (d.gomonth) { state.period = d.gomonth; state.calDay = null; return go('month'); }
  if (d.day) { state.calDay = state.calDay === d.day ? null : d.day; return renderCalendar(); }
  if (d.jump) { [state.fltType, state.fltCat] = d.jump.split('|'); state.q = ''; $('#flt-q').value = ''; return go('list'); }
  if (d.id) return startEdit(d.id);
  if (d.close !== undefined) return b.closest('dialog').close();
  if (d.cetype) { state.ceType = d.cetype; state.ceDelete = null; return renderCats(); }
  if (d.cedel) return deleteCat(d.cedel);
  switch (b.id) {
    case 'submit': return submit();
    case 'cancel': resetForm(); return $('#entry-sheet').close();
    case 'open-entry': return openEntry();
    case 'del': return removeEditing();
    case 'open-settings': return openSettings();
    case 'open-export': return openExport();
    case 'open-cats': if ($('#settings').open) $('#settings').close(); return openCats();
    case 'ce-add': return addCat();
    case 'ce-del-ok': return confirmDeleteCat();
    case 'ce-del-cancel': state.ceDelete = null; return renderCats();
    case 'info': state.info = !state.info; return renderMonth();
    case 'ex-csv': return exportCsv();
    case 'ex-sheet': return exportSheet();
    case 'sign-in': return store.signIn().catch(err => toast('로그인 실패: ' + errMsg(err)));
    case 'sign-out': $('#settings').close(); return store.signOut();
  }
});
$('#f-date').addEventListener('change', e => { state.date = e.target.value || today(); });
$('#h-amount').addEventListener('input', e => { const n = Number(e.target.value.replace(/[^\d]/g, '')); e.target.value = n ? n.toLocaleString('ko-KR') : ''; });
$('#s-rv-min').addEventListener('input', e => { const n = Number(e.target.value.replace(/[^\d]/g, '')); e.target.value = n ? n.toLocaleString('ko-KR') : ''; });
$('#s-rv-min').addEventListener('change', e => saveReviewCfg({ min: Number(e.target.value.replace(/[^\d]/g, '')) || 0 }));
$('#s-rv-days').addEventListener('change', e => saveReviewCfg({ days: Number(e.target.value) }));
$('#g-text').addEventListener('keydown', e => { if (e.key === 'Enter') saveGoal(); });
$('#f-amount').addEventListener('input', () => setAmount(amountValue()));
$('#b-amount').addEventListener('input', e => { const n = Number(e.target.value.replace(/[^\d]/g, '')); e.target.value = n ? n.toLocaleString('ko-KR') : ''; });
$('#b-amount').addEventListener('keydown', e => { if (e.key === 'Enter') saveBudget(); });
$('#f-amount').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
$('#flt-type').addEventListener('change', e => { state.fltType = e.target.value; renderList(); });
$('#flt-cat').addEventListener('change', e => { state.fltCat = e.target.value; renderList(); });
$('#flt-q').addEventListener('input', e => { state.q = e.target.value; renderList(); });
$('#s-payday').addEventListener('change', e => {
  store.saveSettings({ payday: Number(e.target.value) }).catch(err => toast('설정 저장 실패: ' + errMsg(err)));
  toast('월급일을 바꿨어요');
});
$('#s-title').addEventListener('change', e => {
  const title = e.target.value.trim(); // 비우면 기본 이름으로 돌아감
  e.target.value = title || DEFAULT_TITLE;
  store.saveSettings({ title }).catch(err => toast('설정 저장 실패: ' + errMsg(err)));
  toast(title ? '이름을 바꿨어요' : `기본 이름(${DEFAULT_TITLE})으로 돌아갔어요`);
});
$('#s-title').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
$('#s-import').addEventListener('change', ev => {
  const file = ev.target.files[0]; ev.target.value = '';
  if (file) importCsv(file);
});
$('#ce-new').addEventListener('keydown', e => { if (e.key === 'Enter') addCat(); });
$('#ce-list').addEventListener('change', e => { if (e.target.classList.contains('ce-name')) renameCat(e.target); });
$('#ce-list').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList.contains('ce-name')) e.target.blur(); });
addEventListener('online', renderSync);
addEventListener('offline', renderSync);

/* ================= 시작 ================= */
function onData(data) {
  const paydayChanged = data.settings.payday !== state.settings.payday;
  state.entries = data.entries.filter(e => e.type !== HELD); state.held = data.entries.filter(e => e.type === HELD); // 참은 소비는 합계에 안 섞이게 따로
  state.settings = data.settings; state.pending = data.pending;
  if (paydayChanged || !state.period) state.period = periodOfDate(today());
  if (state.editing && !state.entries.some(e => e.id === state.editing.id)) state.editing = null; // 다른 기기에서 삭제됨
  refreshAll();
  if ($('#cat-editor').open && !document.activeElement.classList.contains('ce-name')) renderCats();
}

createStore().then(s => {
  store = s;
  document.body.classList.toggle('demo', store.demo);
  const hash = new URLSearchParams(location.hash.slice(1));
  store.onAuth(user => {
    state.user = user;
    document.body.classList.remove('booting');
    document.body.classList.toggle('signed-out', !user);
    if (!user) { state.entries = []; state.visible = []; state.editing = null; return; }
    if (!state.period) state.period = periodOfDate(today());
    store.listen(onData);
    go(hash.get('tab') && hash.get('tab') !== 'add' ? hash.get('tab') : 'home');
    if (hash.get('day')) { state.calDay = hash.get('day'); refreshAll(); }
  });
}).catch(err => {
  document.body.classList.remove('booting');
  document.body.innerHTML = `<p class="empty" style="padding:40px 16px">앱을 불러오지 못했어요: ${esc(errMsg(err))}</p>`;
});

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');

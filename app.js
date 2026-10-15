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
    if (state.view === 'record') renderCalendar();
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
  period: null, calDay: today(), trendType: '지출', trendCat: '', ...savedTrendRange(), trendRangeOpen: false, fltType: '', fltCat: '', q: '', visible: [],
  info: false, ceType: '지출', ceDelete: null, calc: '', split: null,
};
// 추이 탭에서 고른 기간(최근 1년 · 전체 · 직접 선택)을 이 기기에 기억
function savedTrendRange() {
  try { const r = JSON.parse(localStorage.getItem('trendRange') || 'null'); if (r && ['year', 'all', 'custom'].includes(r.range)) return { trendRange: r.range, trendFrom: r.from || '', trendTo: r.to || '' }; } catch { /* 무시 */ }
  return { trendRange: 'year', trendFrom: '', trendTo: '' };
}
function saveTrendRange() {
  try { localStorage.setItem('trendRange', JSON.stringify({ range: state.trendRange, from: state.trendFrom, to: state.trendTo })); } catch { /* 기억 못 해도 동작에는 문제 없음 */ }
}

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
  renderFormFeel();
}

// 기록 수정 창의 '리뷰' 줄: 예전에 고른 만족 · 필수 · 후회를 바꾸고, 후회면 그때 기분도 고칠 수 있게
function renderFormFeel() {
  const show = !!state.editing && state.type === '지출';
  $('#f-feel-f').hidden = !show;
  if (!show) return;
  const f = FEELS[state.formFeel] ? state.formFeel : '';
  $('#f-feel').innerHTML = Object.entries(FEELS).map(([k, ic]) => `<button class="chip sm" data-ffeel="${k}" aria-pressed="${f === k}">${ic} ${k}</button>`).join('')
    + (f ? '<button class="chip sm ghost-chip" data-ffeel="">리뷰 지우기</button>' : '');
  $('#f-mood').hidden = !withMood(f);
  $('#f-mood').innerHTML = withMood(f) ? moodsFor(f).map(([t, ic]) => `<button class="chip sm" data-fmood="${esc(t)}" aria-pressed="${state.formMood === t}">${ic} ${esc(t)}</button>`).join('') : '';
  $('#f-feel-note').textContent = f ? '' : '아직 리뷰하지 않았어요. 여기서 바로 골라도 돼요';
}

// 이 카테고리 상세내역을 최근에 자주 쓴 순: 한 번 쓸 때마다 1점인데 30일 지날 때마다 반씩 줄어서
// 예전에 많이 쓴 것보다 요즘 입력하는 것이 금방 위로 올라온다
function renderSuggest() {
  const freq = new Map(), now = Date.parse(today());
  for (const e of state.entries) {
    const detail = (e.detail || '').trim();
    if (e.type !== state.type || e.category !== state.category || !detail) continue;
    const days = Math.max(0, (now - Date.parse(e.date)) / 864e5) || 0;
    freq.set(detail, (freq.get(detail) || 0) + 0.5 ** (days / 30));
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

/* ================= 계산기 · N빵 ================= */
// 금액 칸 아래에 여는 작은 계산기. eval 없이 + − × ÷ 만 직접 계산 (곱셈·나눗셈 먼저)
const CALC_OPS = '+−×÷';
function calcValue(expr) {
  const t = expr.match(/\d+|[+−×÷]/g) || [];
  while (t.length && CALC_OPS.includes(t.at(-1))) t.pop(); // 끝에 연산자만 있으면 무시
  if (!t.length) return 0;
  let sum = 0, sign = 1, term = Number(t[0]);
  for (let i = 1; i < t.length; i += 2) {
    const op = t[i], v = Number(t[i + 1]);
    if (op === '×') term *= v;
    else if (op === '÷') term = v ? term / v : NaN;
    else { sum += sign * term; sign = op === '+' ? 1 : -1; term = v; }
  }
  return sum + sign * term;
}
function renderCalc() {
  const e = state.calc, v = calcValue(e);
  $('#calc-expr').textContent = e ? e.replace(/\d+/g, n => Number(n).toLocaleString('ko-KR')) : '0';
  $('#calc-res').textContent = /[+−×÷]\d/.test(e) ? (Number.isFinite(v) ? '= ' + won(Math.round(v)) : '0으로 나눌 수 없어요') : '';
}
function toggleCalc(open = $('#calc').hidden) {
  $('#calc').hidden = !open;
  $('[data-calctoggle]').setAttribute('aria-expanded', open);
  if (open) { state.calc = amountValue() ? String(amountValue()) : ''; renderCalc(); }
}
function calcKey(k) {
  let e = state.calc;
  if (k === 'C') e = '';
  else if (k === '⌫') e = e.slice(0, -1);
  else if (CALC_OPS.includes(k)) { if (e) e = (CALC_OPS.includes(e.at(-1)) ? e.slice(0, -1) : e) + k; }
  else e = /(^|[+−×÷])0$/.test(e) ? e.slice(0, -1) + k : e + k; // 맨 앞 0 뒤에 숫자 붙이지 않기
  state.calc = e.slice(0, 40); renderCalc();
}
// N빵: 지금 계산 결과(없으면 입력된 금액)를 n명으로 나눔
function calcSplit(n) {
  const total = Math.round(calcValue(state.calc)) || amountValue();
  if (!total) { toast('먼저 전체 금액을 입력해 주세요'); return; }
  state.calc = `${total}÷${n}`; state.split = { total, n }; renderCalc();
}
function calcApply() {
  const v = Math.round(calcValue(state.calc));
  if (!Number.isFinite(v) || v <= 0) { toast('계산 결과가 0원보다 커야 해요'); return; }
  setAmount(v);
  const sp = state.split; // N빵이었으면 메모가 비어 있을 때 계산 내역을 남김
  if (sp && state.calc === `${sp.total}÷${sp.n}` && !$('#f-memo').value.trim()) $('#f-memo').value = `총 ${won(sp.total)} ${sp.n}명 N빵`;
  state.split = null; toggleCalc(false);
}

function amountValue() { return Number($('#f-amount').value.replace(/[^\d]/g, '')) || 0; }
function setAmount(n) { $('#f-amount').value = n ? n.toLocaleString('ko-KR') : ''; }

function resetForm() {
  state.editing = null; state.formFeel = ''; state.formMood = '';
  toggleCalc(false);
  $('#f-detail').value = ''; setAmount(0); $('#f-memo').value = '';
  renderForm();
}

// 새 기록: 기록 탭에서 고른 날짜(또는 달력에서 고른 날짜)로 기록하기 창을 연다
function openEntry(day) {
  state.date = day || state.calDay || today();
  resetForm();
  $('#entry-sheet').showModal(); document.activeElement.blur();
}

function startEdit(id) {
  const e = state.entries.find(x => x.id === id); if (!e) return;
  state.editing = e; state.type = e.type; state.category = e.category; state.date = e.date;
  state.formFeel = e.feel || ''; state.formMood = e.mood || '';
  $('#f-detail').value = e.detail; setAmount(e.amount); $('#f-memo').value = e.memo || '';
  renderForm();
  if (!$('#entry-sheet').open) { $('#entry-sheet').showModal(); document.activeElement.blur(); }
}

// 저장하면 화면에는 바로 반영되고, 클라우드 동기화는 뒤에서 진행된다 (오프라인이면 연결될 때까지 대기).
function submit() {
  const amount = amountValue();
  if (!amount) { toast('금액을 입력해 주세요'); $('#f-amount').focus(); return; }
  const prev = state.editing;
  const e = {
    id: prev ? prev.id : newId(), date: $('#f-date').value || today(),
    type: state.type, category: state.category,
    detail: $('#f-detail').value.trim(), amount, memo: $('#f-memo').value.trim(),
  };
  // 리뷰 결과 (수정할 때만 고칠 수 있음). 지출이 아니게 바뀌면 리뷰는 지움
  if (prev && state.type === '지출') {
    const f = state.formFeel;
    if (f && f !== 'none') e.feel = f; // 'none' = 리뷰 지우기 (feel 없이 저장)
    if (withMood(f)) { if (state.formMood) e.mood = state.formMood; if (prev.feelMemo) e.feelMemo = prev.feelMemo; }
  }
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
// 만족도: 만족 + 후회 금액 중 만족 비율(%). 필수는 좋고 나쁨이 없어서 뺀다. 둘 다 없으면 null
function satRate(list) {
  let sat = 0, reg = 0;
  for (const e of list) { if (e.feel === '만족') sat += e.amount; else if (e.feel === '후회') reg += e.amount; }
  return sat + reg ? Math.round(sat / (sat + reg) * 100) : null;
}
// 후회를 고르면 한 번 더 묻는 그때 기분 (타이핑 없이 톡)
const withMood = f => f === '만족' || f === '후회'; // 만족 · 후회를 고르면 그때 기분 · 한 줄 메모도 남김
const MOODS = [['지쳐서', '😩'], ['스트레스', '😤'], ['심심해서', '🥱'], ['들떠서', '🎉'], ['분위기상', '🤝'], ['늦은 밤', '🌙']];
// 설정에서 추가·삭제한 목록 (없으면 기본). Firestore는 배열 안에 배열을 못 담아서 {t, ic} 객체로 저장한다
// 만족할 때 기분 (설정에서 따로 고침)
const GOOD_MOODS = [['오래 고민해서', '🤔'], ['잘 쓰는 중', '👍'], ['기분 전환', '🌈'], ['나를 위해', '🎁'], ['함께라서', '🥰'], ['가성비 굿', '💰']];
const MOOD_KINDS = { bad: { key: 'moods', def: MOODS, feel: '후회' }, good: { key: 'goodMoods', def: GOOD_MOODS, feel: '만족' } };
const moods = (kind = 'bad') => { const k = MOOD_KINDS[kind], v = state.settings[k.key]; return v ? v.map(m => Array.isArray(m) ? m : [m.t, m.ic]) : k.def; };
const moodsFor = feel => moods(feel === '만족' ? 'good' : 'bad');
const moodIcon = m => ([...moods('bad'), ...moods('good'), ...MOODS, ...GOOD_MOODS].find(([t]) => t === m) || [])[1] || '💭';

function renderHome() {
  const key = periodOfDate(today());
  ensureMonthBadges();
  renderStatus();
  renderEmoMap();
  renderHomeBadges();
}
// 기록 탭: 달력 + 고른 날의 내역, ＋로 기록
function renderRecord() {
  renderPeriodNav();
  renderCalSum();
  renderCalendar();
}

// 기록 탭 달력 위: 보고 있는 달의 수입·지출 합계 (이번 달이면 오늘까지). 오른쪽 남은 돈 = 수입 − 지출
function renderCalSum() {
  const { start, end } = periodRange(state.period), t = today(), live = t >= start && t <= end;
  const list = state.entries.filter(e => e.date >= start && e.date <= (live ? t : end));
  const sum = type => list.filter(e => e.type === type).reduce((s, e) => s + e.amount, 0);
  const left = sum('수입') - sum('지출');
  $('#cal-sum').innerHTML = `<div><p>수입 <b class="num in">+${won(sum('수입'))}</b></p><p>지출 <b class="num ex">−${won(sum('지출'))}</b></p></div>
    <p class="cs-left">남은 돈 <b class="num${left < 0 ? ' minus' : ''}">${left < 0 ? '−' : ''}${won(Math.abs(left))}</b></p>`;
}

/* ================= 배지 (한 달 단위 도전) ================= */
// settings.badges = { 'YYYY-MM': [배지, ...] }. 배지 = { id, kind, cat, n, unit('count'|'amount'), title, origin }
// origin: basic(기본) · carry(지난달에서 이어짐) · mine(내가 만든) · rec(추천)
// 달이 바뀌면 기본 배지 + 지난달에 못 받은 배지로 새 목록을 만든다. 받았는지는 기록으로 매번 계산한다
const BADGE_KINDS = {
  held: { icon: '🙌', color: '#FFB59A', label: '참기', units: ['count', 'amount'], cat: true },
  reduce: { icon: '📉', color: '#8ED9B4', label: '줄이기', units: ['count', 'amount'], cat: true },
  sat: { icon: '😊', color: '#FFDB6E', label: '만족 비율', units: ['pct'] },
  regret: { icon: '🌱', color: '#B8E0A0', label: '후회 줄이기', units: ['count'] },
  daily: { icon: '🔥', color: '#FFB566', label: '꾸준히 기록', units: ['days'] },
  budget: { icon: '🎯', color: '#F7A3BE', label: '예산 지키기', units: [] },
  custom: { icon: '✏️', color: '#C8B6FF', label: '직접 적기', units: ['count', 'amount'] }, // 기록으로 못 세니 홈에서 눌러 직접 기록
};
const BADGE_COLORS = ['#FFB59A', '#FFDB6E', '#8ED9B4', '#9CC8FF', '#C8B6FF', '#F7A3BE', '#FFB566', '#B8E0A0', '#BFD7EA', '#E2C2A3'];
const badgeColor = b => b.color || BADGE_KINDS[b.kind].color;
const matchWords = (e, words) => words.some(w => { const k = w.toLowerCase(); return [e.detail, e.memo, e.category].some(x => (x || '').toLowerCase().includes(k)); });
const CAT_ICON = { '식비': '🍚', '간식': '🍰', '카공': '☕', '생필품': '🧴', '취미/문화생활': '🎬', '자기개발': '📚', '의료/건강': '💊',
  '의류': '👕', '미용': '💇', '여행': '✈️', '경조사/선물': '🎁', '가전': '📺', '교통비': '🚌', '통신비': '📱', '월세': '🏠', '배달': '🛵' };
const BASIC_BADGES = () => [
  { id: 'basic-held', kind: 'held', n: 3, unit: 'count', origin: 'basic' },
];
const nfmt = (v, unit) => unit === 'amount' ? compact(v) + '원' : unit === 'pct' ? v + '%' : unit === 'days' ? v + '일' : v + '번';
function badgeName(b) {
  if (b.title) return b.title;
  const c = b.cat ? b.cat + ' ' : '';
  return { held: `${c}${nfmt(b.n, b.unit)} 참기`, reduce: `${c || '지출 '}${nfmt(b.n, b.unit)} 이하`, sat: `만족 ${b.n}% 넘기기`,
    regret: `후회 ${b.n}번 이하`, custom: `나만의 목표 ${nfmt(b.n, b.unit)} ${b.dir === 'down' ? '이하' : '이상'}`, daily: `${b.n}일 기록하기`, budget: '예산 안에서 쓰기' }[b.kind];
}
const badgeIcon = b => b.icon || (b.cat && CAT_ICON[b.cat]) || BADGE_KINDS[b.kind].icon;
const badgesOf = key => ((state.settings.badges || {})[key] || []).filter(b => BADGE_KINDS[b.kind]); // 없어진 종류(예전 '리뷰 다 하기')는 건너뜀

// 진행도: fill(0~1) · label · done(받음) · fail(이번 달은 못 받음)
function badgeProgress(b, key) {
  const { start, end } = periodRange(key), t = today(), past = t > end;
  const days = Math.round((parse(end) - parse(start)) / 864e5) + 1;
  const elapsed = past ? 1 : t < start ? 0 : (Math.round((parse(t) - parse(start)) / 864e5) + 1) / days;
  const exp = periodEntries(key).filter(e => e.type === '지출');
  const mine = exp.filter(e => !b.cat || e.category === b.cat);
  const val = (list, unit) => unit === 'amount' ? list.reduce((s, e) => s + e.amount, 0) : list.length;
  // '이하' 배지: 한 달을 넘지 않고 버티는 동안 날짜만큼 차오르고, 넘으면 비워진다
  const keepUnder = (used, n, unit) => used > n ? { fill: 0, label: '넘었어요', fail: true }
    : past ? { fill: 1, label: '받았어요', done: true } : { fill: elapsed, label: `${nfmt(n - used, unit)} 남음` };
  if (b.kind === 'custom') {
    const u = b.unit || 'count', auto = (b.words || []).length > 0;
    // 지정한 단어가 상세내역 · 메모 · 카테고리에 들어간 지출은 자동으로 센다. 단어가 없으면 홈에서 눌러 직접 기록
    const v = auto ? val(exp.filter(e => matchWords(e, b.words) && !(b.exclude || []).includes(e.id)), u) : b.count || 0;
    if (b.dir === 'down') return keepUnder(v, b.n, u); // 적게 할수록 좋은 목표: 넘지 않고 한 달을 버티면 받음
    return v >= b.n ? { fill: 1, label: '받았어요', done: true } : { fill: v / b.n, label: `${nfmt(v, u)} / ${nfmt(b.n, u)}${auto ? '' : ' · 눌러서 기록'}`, fail: past };
  }
  if (b.kind === 'held') {
    const v = val(state.held.filter(h => periodOf(h) === key && (!b.cat || h.category === b.cat)), b.unit);
    return v >= b.n ? { fill: 1, label: '받았어요', done: true } : { fill: v / b.n, label: `${nfmt(v, b.unit)} / ${nfmt(b.n, b.unit)}`, fail: past };
  }
  if (b.kind === 'reduce') return keepUnder(val(mine, b.unit), b.n, b.unit);
  if (b.kind === 'regret') return keepUnder(exp.filter(e => e.feel === '후회').length, b.n, 'count');
  if (b.kind === 'budget') {
    const budget = sumOf(catBudgetsOf(key).map);
    return budget ? keepUnder(val(exp, 'amount'), budget, 'amount') : { fill: 0, label: '예산을 정해 주세요' };
  }
  if (b.kind === 'sat') {
    const r = satRate(exp);
    if (r == null) return { fill: 0, label: '리뷰가 쌓이면 보여요', fail: past };
    return r >= b.n ? (past ? { fill: 1, label: '받았어요', done: true } : { fill: 1, label: `지금 ${r}% · 달성 중` })
      : { fill: r / b.n, label: `지금 ${r}%`, fail: past };
  }
  if (b.kind === 'daily') {
    const v = new Set([...periodEntries(key), ...state.held.filter(h => periodOf(h) === key)].map(e => e.date)).size;
    return v >= b.n ? { fill: 1, label: '받았어요', done: true } : { fill: v / b.n, label: `${v} / ${b.n}일`, fail: past };
  }
  return { fill: 0, label: '' };
}

// 이번 달 목록이 없으면 기본 배지 + 지난달에 못 받은 배지로 만든다 (한 번만 저장)
function ensureMonthBadges() {
  // 설정(배지 목록)이 아직 안 왔을 때 만들면 저장된 목록을 기본 목록으로 덮어쓰게 되니 기다린다
  if (!state.settingsReady) return;
  const key = periodOfDate(today()), all = state.settings.badges || {};
  if (all[key] || state.badgeInit === key) return;
  state.badgeInit = key;
  const prevKey = Object.keys(all).filter(k => k < key).sort().at(-1);
  const carry = prevKey ? badgesOf(prevKey).filter(b => b.origin !== 'basic' && !badgeProgress(b, prevKey).done)
    .map(b => ({ ...b, count: 0, id: newId(), origin: 'carry', from: prevKey })) : [];
  saveBadges(key, [...BASIC_BADGES(), ...carry]);
}
function saveBadges(key, list) {
  state.settings.badges = { ...state.settings.badges, [key]: list }; // 저장이 돌아오기 전에도 바로 보이게
  store.saveSettings({ badges: state.settings.badges }).catch(err => toast('배지 저장 실패: ' + errMsg(err)));
}
function earnedBadges() {
  const all = state.settings.badges || {}, out = [];
  for (const k of Object.keys(all).sort()) for (const b of badgesOf(k)) if (badgeProgress(b, k).done) out.push({ ...b, key: k });
  return out;
}

function badgeHtml(b, p, small) {
  return `<span class="bd ${p.done ? 'full' : p.fill > 0 ? 'mid' : 'todo'}${small ? ' sm' : ''}" style="--c:${badgeColor(b)};--p:${Math.round(p.fill * 100)}%"><span>${badgeIcon(b)}</span></span>`;
}
/* ================= 홈: 감정 지도 ================= */
// 이번 달 리뷰에서 고른 기분을 세서, 왼쪽은 만족 · 오른쪽은 후회 버블로. 자주 느낀 기분일수록 크게
const EMO_W = 340, EMO_H = 236, EMO_TOP = 24;
function packBubbles(items, x0, x1) { // 큰 것부터, 안 겹치면서 이쪽 가운데에 가장 가까운 자리에 둔다
  const placed = [], cx = (x0 + x1) / 2, cy = (EMO_TOP + EMO_H) / 2;
  for (const it of items) {
    let best = null;
    for (let x = x0 + it.r; x <= x1 - it.r; x += 3) for (let y = EMO_TOP + it.r; y <= EMO_H - it.r; y += 3) {
      if (placed.some(p => Math.hypot(p.x - x, p.y - y) < p.r + it.r + 3)) continue;
      const d = Math.hypot(x - cx, (y - cy) * 1.3);
      if (!best || d < best.d) best = { x, y, d };
    }
    if (best) placed.push({ ...it, x: best.x, y: best.y });
  }
  return placed;
}
function renderEmoMap() {
  const key = periodOfDate(today()), m = Number(key.slice(5));
  const exp = periodEntries(key).filter(e => e.type === '지출' && e.mood && withMood(e.feel));
  const count = feel => { const c = new Map(); for (const e of exp) if (e.feel === feel) c.set(e.mood, (c.get(e.mood) || 0) + 1);
    return [...c].sort((a, b) => b[1] - a[1]).slice(0, 6); }; // 한쪽에 6개까지 (많으면 작은 원이 들어갈 자리가 없어서)
  const good = count('만족'), bad = count('후회'), max = Math.max(1, ...[...good, ...bad].map(x => x[1]));
  const size = list => list.map(([t, n]) => ({ t, n, ic: moodIcon(t), r: 15 + 24 * Math.sqrt(n / max) }));
  const half = EMO_W / 2;
  const bubble = (b, cls) => { const big = b.r >= 32, mid = b.r >= 25;
    return `<g class="${cls}"><circle cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="${b.r.toFixed(1)}"/>
      <text x="${b.x.toFixed(1)}" y="${(b.y + (mid ? -b.r * 0.18 : 5)).toFixed(1)}" font-size="${(b.r * 0.55).toFixed(1)}" class="ic">${b.ic}</text>
      ${mid ? `<text x="${b.x.toFixed(1)}" y="${(b.y + b.r * 0.38).toFixed(1)}" font-size="${big ? 11 : 9.5}">${esc(b.t.length > 7 ? b.t.slice(0, 6) + '…' : b.t)}${big ? ` ${b.n}` : ''}</text>` : ''}
      <title>${esc(b.t)} ${b.n}번</title></g>`; };
  const total = exp.length;
  $('#home-emo').innerHTML = `<div class="card emo">
    <h2 style="margin:0">${m}월 감정 지도</h2>
    <p class="label" style="margin:2px 0 6px">${total ? `리뷰에 남긴 기분 ${total}개 · 클수록 자주 느낀 기분` : '리뷰할 때 그때 기분을 고르면 여기에 모여요'}</p>
    ${total ? `<svg viewBox="0 0 ${EMO_W} ${EMO_H}" role="img" aria-label="만족할 때 기분 ${good.map(([t, n]) => `${t} ${n}번`).join(', ') || '없음'}, 후회할 때 기분 ${bad.map(([t, n]) => `${t} ${n}번`).join(', ') || '없음'}">
      <line x1="${half}" y1="6" x2="${half}" y2="${EMO_H - 4}" class="mid"/>
      <text x="4" y="14" class="side good" text-anchor="start">😊 만족 ${exp.filter(e => e.feel === '만족').length}</text>
      <text x="${EMO_W - 4}" y="14" class="side bad" text-anchor="end">후회 ${exp.filter(e => e.feel === '후회').length} 😣</text>
      ${packBubbles(size(good), 2, half - 4).map(b => bubble(b, 'good')).join('')}
      ${packBubbles(size(bad), half + 4, EMO_W - 2).map(b => bubble(b, 'bad')).join('')}
      ${good.length ? '' : `<text x="${half / 2}" y="${EMO_H / 2}" class="none">아직 없어요</text>`}${bad.length ? '' : `<text x="${half * 1.5}" y="${EMO_H / 2}" class="none">아직 없어요</text>`}
    </svg>` : ''}</div>`;
}

function renderHomeBadges() {
  const key = periodOfDate(today()), list = badgesOf(key), m = Number(key.slice(5));
  const ps = list.map(b => badgeProgress(b, key)), got = ps.filter(p => p.done).length;
  $('#home-badges').innerHTML = `<div class="card">
    <div class="card-head" style="margin:0"><div><h2 style="margin:0">${m}월 배지</h2><p class="label" style="margin:2px 0 0">도전 중 ${list.length - got}개 · 받은 배지 ${got}개</p></div>
      <button class="chip sm bud-edit" data-badgeedit>✎ 목록 편집하기</button></div>
    ${list.length ? `<div class="bgrid">${list.map((b, i) => `<div${b.kind === 'custom' ? ` class="bcheck" ${(b.words || []).length ? 'data-bmatch' : 'data-bcheck'}="${i}"` : ''}>${badgeHtml(b, ps[i])}<small>${esc(badgeName(b))}</small><em>${esc(ps[i].label)}</em></div>`).join('')}</div>`
      : '<p class="empty">목록 편집하기에서 배지를 추가해 보세요</p>'}
    <button class="link-btn" data-badgeall style="margin-top:12px">지금까지 받은 배지 · ${earnedBadges().length}개 ›</button></div>`;
}

/* ----- 배지 목록 편집 (목록 편집하기를 눌러야 열림) ----- */
const ORIGIN_TAG = { basic: ['기본', 'p1'], carry: ['지난달에서 이어짐', 'p2'], mine: ['내가 만든', 'p3'], rec: ['추천', 'p3'] };
function openBadgeEditor() {
  const key = periodOfDate(today());
  state.badgeDraft = badgesOf(key).map(b => ({ ...b }));
  renderBadgeEditor(); $('#badge-editor').showModal(); document.activeElement.blur();
}
function renderBadgeEditor() {
  const key = periodOfDate(today()), L = state.badgeDraft;
  const tag = b => { const [t, c] = ORIGIN_TAG[b.origin] || ORIGIN_TAG.mine; return `<span class="otag ${c}">${b.origin === 'carry' && b.from ? Number(b.from.slice(5)) + '월에서 이어짐' : t}</span>`; };
  $('#be-list').innerHTML = L.length ? L.map((b, i) => `<div class="be-row">
      <span class="ce-order"><button data-bemove="${i}|-1" ${i ? '' : 'disabled'} aria-label="위로">▲</button><button data-bemove="${i}|1" ${i < L.length - 1 ? '' : 'disabled'} aria-label="아래로">▼</button></span>
      ${badgeHtml(b, badgeProgress(b, key), true)}
      <button class="be-main" data-beedit="${i}"><b>${esc(badgeName(b))}</b>${tag(b)}<small>${badgeDesc(b)} · 눌러서 고치기</small></button>
      <button class="icon-btn" data-bedel="${i}" aria-label="빼기">✕</button></div>`).join('')
    : '<p class="empty">아직 배지가 없어요</p>';
  const recs = badgeRecs().filter(r => !L.some(b => b.kind === r.kind && (b.cat || '') === (r.cat || '')));
  $('#be-recs').innerHTML = recs.length ? recs.map((r, i) => `<div class="be-sug"><span class="bb" style="background:${BADGE_KINDS[r.kind].color}">${badgeIcon(r)}</span>
      <span><b>${esc(badgeName(r))}</b><small>${esc(r.why)}</small></span><button class="chip sm" data-berec="${i}">+ 추가</button></div>`).join('')
    : '<p class="note" style="margin:4px 0 0">지금은 추천할 배지가 없어요. 기록이 더 쌓이면 보여드릴게요</p>';
  state.badgeRecs = recs;
}
const badgeDesc = b => [BADGE_KINDS[b.kind].label, b.cat, b.n != null && b.kind !== 'budget' ? nfmt(b.n, b.unit || BADGE_KINDS[b.kind].units[0]) : ''].filter(Boolean).join(' · ');
function saveBadgeEditor() {
  saveBadges(periodOfDate(today()), state.badgeDraft);
  $('#badge-editor').close(); renderHome(); toast('배지 목록을 저장했어요');
}

// 지난달 기록으로 '조금만 더' 해 볼 만한 배지를 추천
function lastMonthStats() {
  const key = shiftPeriod(periodOfDate(today()), -1), exp = periodEntries(key).filter(e => e.type === '지출');
  const cnt = new Map(); for (const e of exp) cnt.set(e.category, (cnt.get(e.category) || 0) + 1);
  return { key, exp, cnt, held: state.held.filter(h => periodOf(h) === key).length,
    sat: satRate(exp),
    regret: exp.filter(e => e.feel === '후회').length };
}
function badgeRecs() {
  const L = lastMonthStats(), out = [], fixed = new Set(['월세', '통신비']);
  const top = [...L.cnt].filter(([c]) => !fixed.has(c)).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 4) out.push({ kind: 'reduce', cat: top[0], n: Math.round(top[1] * 0.75), unit: 'count', why: `지난달 ${top[1]}번 · 조금만 줄여 봐요` });
  if (L.sat != null) out.push({ kind: 'sat', n: Math.min(95, Math.ceil((L.sat + 5) / 5) * 5), why: `지난달 만족 ${L.sat}%` });
  out.push({ kind: 'held', n: Math.max(3, L.held + 2), unit: 'count', why: L.held ? `지난달 ${L.held}번 참았어요` : '참은 소비를 기록해 봐요' });
  if (L.regret >= 2) out.push({ kind: 'regret', n: L.regret - 1, why: `지난달 후회 ${L.regret}번` });
  out.push({ kind: 'daily', n: 20, why: '꾸준히 기록하는 습관' });
  return out.slice(0, 4);
}

/* ----- 나만의 배지 만들기: 무엇을 · 어떤 걸 · 얼마나 (한 달 단위) ----- */
function openBadgeMaker(i) {
  const b = i != null ? state.badgeDraft[i] : null;
  state.maker = b ? { ...b, idx: i } : { kind: 'held', cat: '', n: 3, unit: 'count', title: '', idx: null };
  renderBadgeMaker(); $('#badge-maker').showModal(); document.activeElement.blur();
}
// 난이도 숫자: 지난달 내 기록을 기준으로
function makerLevels(m) {
  const L = lastMonthStats(), amt = m.unit === 'amount';
  const used = L.exp.filter(e => !m.cat || e.category === m.cat), base = amt ? used.reduce((s, e) => s + e.amount, 0) : used.length;
  const r = v => amt ? Math.max(10000, Math.round(v / 10000) * 10000) : Math.max(0, Math.round(v));
  if (m.kind === 'held') { const h = state.held.filter(x => periodOf(x) === L.key && (!m.cat || x.category === m.cat)); const hb = amt ? h.reduce((s, x) => s + x.amount, 0) : h.length;
    return [r(Math.max(amt ? 30000 : 1, hb)), r(Math.max(amt ? 50000 : 3, hb + (amt ? 30000 : 2))), r(Math.max(amt ? 100000 : 5, hb + (amt ? 60000 : 4)))]; }
  if (m.kind === 'reduce') return base ? [r(base * 0.9), r(base * 0.75), r(base * 0.5)] : [amt ? 50000 : 5, amt ? 30000 : 3, amt ? 10000 : 1];
  if (m.kind === 'sat') { const v = L.sat ?? 50; const c = x => Math.min(95, Math.round(x / 5) * 5); return [c(v), c(v + 5), c(v + 10)]; }
  if (m.kind === 'regret') return [Math.max(0, L.regret), Math.max(0, L.regret - 1), Math.max(0, L.regret - 2)];
  if (m.kind === 'daily') return [10, 20, 28];
  return null;
}
function renderBadgeMaker() {
  const m = state.maker, K = BADGE_KINDS[m.kind], lv = makerLevels(m);
  if (!K.units.includes(m.unit)) m.unit = K.units[0];
  if (!K.cat) m.cat = '';
  $('#bm-kind').innerHTML = Object.entries(BADGE_KINDS).map(([k, v]) => `<button class="chip${k === 'custom' ? ' bm-custom' : ''}" data-bmkind="${k}" aria-pressed="${m.kind === k}">${v.icon} ${v.label}</button>`).join('');
  $('#bm-cat-f').hidden = !K.cat;
  $('#bm-cat').innerHTML = ['', ...cats('지출')].map(c => `<button class="chip sm" data-bmcat="${esc(c)}" aria-pressed="${m.cat === c}">${c ? esc(c) : '전체'}</button>`).join('');
  const custom = m.kind === 'custom';
  $('#bm-custom-f').hidden = !custom;
  if (custom && document.activeElement !== $('#bm-icon-in')) $('#bm-icon-in').value = m.icon || '';
  $('#bm-n-f').hidden = !K.units.length;
  if (K.units.length) {
    $('#bm-unit').innerHTML = K.units.length > 1 ? K.units.map(u => `<button class="chip sm" data-bmunit="${u}" aria-pressed="${m.unit === u}">${u === 'amount' ? '금액으로' : '횟수로'}</button>`).join('') : '';
    if (document.activeElement !== $('#bm-n-in')) $('#bm-n-in').value = m.unit === 'amount' ? m.n.toLocaleString('ko-KR') : m.n;
    $('#bm-n-unit').textContent = { amount: '원', pct: '%', days: '일', count: '번' }[m.unit];
    $('#bm-lv').innerHTML = lv ? ['쉬움', '보통', '도전'].map((t, i) => `<button data-bmlv="${lv[i]}" aria-pressed="${m.n === lv[i]}"><b>${t}</b>${nfmt(lv[i], m.unit)}</button>`).join('') : '';
    $('#bm-lv-note').hidden = !lv;
  }
  $('#bm-color').innerHTML = BADGE_COLORS.map(c => `<button class="bm-sw" data-bmcolor="${c}" style="background:${c}" aria-pressed="${badgeColor(m) === c}" aria-label="색 ${c}"></button>`).join('');
  $('#bm-title-l').textContent = custom ? '배지 이름' : '이름 (선택)';
  if (custom) renderMakerWords();
  $('#bm-title').placeholder = custom ? (m.dir === 'down' ? '예: 카페 줄이기, 편의점 덜 가기' : '예: 도시락 싸기, 아낀 돈 모으기') : badgeName({ ...m, title: '' });
  $('#bm-dir').hidden = !custom;
  if (custom) $('#bm-dir').innerHTML = [['up', '⬆️ 많이 할수록 좋아요', '목표만큼 채우면 받아요'], ['down', '⬇️ 적게 할수록 좋아요', '한 달 동안 넘지 않으면 받아요']]
    .map(([v, t, s]) => `<button data-bmdir="${v}" aria-pressed="${(m.dir || 'up') === v}"><b>${t}</b><small>${s}</small></button>`).join('');
  if (document.activeElement !== $('#bm-title')) $('#bm-title').value = m.title || '';
  $('#bm-prev').innerHTML = `${badgeHtml(m, { fill: 1, done: true })}<span><b>${esc(badgeName(m))}</b><small>이번 달 안에 이루면 받아요</small></span>`;
}
// 자동으로 셀 단어: 칩으로 여러 개. 아래에 자주 쓴 상세내역을 추천
function renderMakerWords() {
  const W = state.maker.words || [];
  $('#bm-words').innerHTML = W.map((w, i) => `<span class="chip sm mood-item word-item"><span>${esc(w)}</span><button data-bmworddel="${i}" aria-label="${esc(w)} 빼기">✕</button></span>`).join('')
    || '<span class="note">아직 없어요 · 없으면 홈에서 배지를 눌러 직접 기록해요</span>';
  const freq = new Map();
  for (const e of state.entries) if (e.type === '지출' && e.detail) freq.set(e.detail.trim(), (freq.get(e.detail.trim()) || 0) + 1);
  const sug = [...freq].sort((a, b) => b[1] - a[1]).map(([d]) => d).filter(d => !W.includes(d)).slice(0, 8);
  $('#bm-wsug').innerHTML = sug.map(d => `<button class="chip sm" data-bmwordsug="${esc(d)}">+ ${esc(d)}</button>`).join('');
}
function addMakerWord(w) {
  w = (w || '').trim(); if (!w) return;
  const m = state.maker; m.words = [...new Set([...(m.words || []), w])];
  $('#bm-word-in').value = ''; renderBadgeMaker();
}

function makerNumInput(el) { // 숫자 직접 입력 (금액이면 콤마)
  const m = state.maker; let n = Number(el.value.replace(/[^\d]/g, '')) || 0;
  if (m.unit === 'pct') n = Math.min(100, n);
  m.n = n; if (m.unit === 'amount') el.value = n ? n.toLocaleString('ko-KR') : '';
  renderBadgeMaker();
}
function saveBadgeMaker() {
  const m = state.maker, { idx, ...b } = m;
  b.title = $('#bm-title').value.trim();
  if (b.kind === 'custom' && !b.title) { toast('무엇을 할지 적어 주세요'); return $('#bm-title').focus(); }
  if (b.kind !== 'custom' || !b.icon) delete b.icon; // Firestore는 undefined 값을 못 받음
  if (b.kind !== 'custom') delete b.dir; else b.dir = b.dir || 'up';
  if ($('#bm-word-in').value.trim()) b.words = [...new Set([...(b.words || []), $('#bm-word-in').value.trim()])];
  if (b.kind !== 'custom' || !(b.words || []).length) delete b.words;
  if (BADGE_KINDS[b.kind].units.length && !b.n && b.kind !== 'reduce' && b.kind !== 'regret') { toast('목표 숫자를 넣어 주세요'); return $('#bm-n-in').focus(); }
  if (idx != null) state.badgeDraft[idx] = { ...state.badgeDraft[idx], ...b };
  else state.badgeDraft.push({ ...b, id: newId(), origin: 'mine' });
  $('#badge-maker').close(); renderBadgeEditor();
}

// '직접 적기' 배지: 홈에서 누르면 한 번씩 직접 체크 (이번 달 목록에 횟수를 저장)
function openBadgeCheck(i) {
  state.bcheck = i; renderBadgeCheck(); $('#badge-check').showModal(); document.activeElement.blur();
}
function renderBadgeCheck() {
  const key = periodOfDate(today()), b = badgesOf(key)[state.bcheck]; if (!b) return;
  const u = b.unit || 'count';
  $('#bc-body').innerHTML = `${badgeHtml(b, badgeProgress(b, key))}<h3>${esc(badgeName(b))}</h3>
    <p class="num">${nfmt(b.count || 0, u)} / ${nfmt(b.n, u)}</p>`;
  $('#bc-amt-f').hidden = u !== 'amount';
  $('#bc-plus').textContent = u === 'amount' ? '＋ 더하기' : b.dir === 'down' ? '＋ 했어요 (1번)' : '＋ 했어요!';
  $('#bc-hint').textContent = b.dir === 'down' ? `${nfmt(b.n, u)}을 넘지 않으면 받아요` : `${nfmt(b.n, u)}을 채우면 받아요`;
  $('#bc-minus').textContent = u === 'amount' ? '− 빼기' : '− 하나 빼기';
}
function badgeCheckStep(dir) {
  const key = periodOfDate(today()), list = badgesOf(key).map(x => ({ ...x })), b = list[state.bcheck]; if (!b) return;
  let step = 1;
  if ((b.unit || 'count') === 'amount') { // 금액 배지는 입력한 금액만큼 더하고 뺀다
    step = Number($('#bc-amt').value.replace(/[^\d]/g, '')) || 0;
    if (!step) { toast('금액을 입력해 주세요'); return $('#bc-amt').focus(); }
    $('#bc-amt').value = '';
  }
  b.count = Math.max(0, (b.count || 0) + dir * step);
  saveBadges(key, list); renderBadgeCheck(); renderHome();
  if (dir > 0) toast(b.dir === 'down' ? (b.count > b.n ? '이번 달 목표를 넘었어요 😢' : '기록했어요') : b.count >= b.n ? `🎉 '${badgeName(b)}' 배지를 받았어요!` : '기록했어요 👍');
}

// 자동으로 세는 배지: 누르면 이번 달에 잡힌 기록 목록. 해당 없는 건 '빼기'로 제외하고, 뺀 건 아래에서 다시 넣을 수 있음
function openBadgeMatch(i) { state.bmatch = i; renderBadgeMatch(); $('#badge-match').showModal(); document.activeElement.blur(); }
function renderBadgeMatch() {
  const key = periodOfDate(today()), b = badgesOf(key)[state.bmatch]; if (!b) return;
  const ex = b.exclude || [], hits = periodEntries(key).filter(e => e.type === '지출' && matchWords(e, b.words)).sort((a, c) => c.date.localeCompare(a.date));
  const on = hits.filter(e => !ex.includes(e.id)), off = hits.filter(e => ex.includes(e.id));
  const row = (e, out) => `<li class="bm-hit${out ? ' out' : ''}"><div class="main"><div class="cat">${md(e.date)} · ${esc(e.category)}</div><div class="det">${esc(e.detail || '—')}</div></div>
    <div class="amt num">${won(e.amount)}</div><button class="chip sm" data-bmx="${esc(e.id)}">${out ? '다시 넣기' : '빼기'}</button></li>`;
  $('#bm-hit-body').innerHTML = `<div class="bc">${badgeHtml(b, badgeProgress(b, key))}<h3>${esc(badgeName(b))}</h3><p>${esc(badgeProgress(b, key).label)}</p></div>
    <p class="note" style="margin:10px 0 4px">'${b.words.map(esc).join("', '")}'(으)로 잡힌 이번 달 기록이에요. 해당 없는 건 빼 주세요</p>
    <ul class="list">${on.length ? on.map(e => row(e)).join('') : '<li class="empty">아직 잡힌 기록이 없어요</li>'}</ul>
    ${off.length ? `<p class="label" style="margin-top:12px">뺀 기록 ${off.length}개</p><ul class="list">${off.map(e => row(e, true)).join('')}</ul>` : ''}`;
}
function toggleExclude(id) {
  const key = periodOfDate(today()), list = badgesOf(key).map(x => ({ ...x })), b = list[state.bmatch]; if (!b) return;
  const ex = new Set(b.exclude || []); ex.has(id) ? ex.delete(id) : ex.add(id);
  b.exclude = [...ex]; if (!b.exclude.length) delete b.exclude;
  saveBadges(key, list); renderBadgeMatch(); renderHome();
}

function openEarned() {
  const list = earnedBadges();
  $('#earned-list').innerHTML = list.length ? list.slice().reverse().map(b => `<div>${badgeHtml(b, { fill: 1, done: true })}<small>${esc(badgeName(b))}</small><em>${Number(b.key.slice(5))}월</em></div>`).join('')
    : '<p class="empty" style="grid-column:1/-1">아직 받은 배지가 없어요</p>';
  $('#earned').showModal();
}

/* ================= 첫 화면: 나의 상태 · 월말 결산 ================= */
// 한 달 결과로 다음 달 칭호를 정한다 (햄스터 그림은 레벨로: img/hamster-1~5)
function monthStats(key) {
  const exp = periodEntries(key).filter(e => e.type === '지출');
  return { days: new Set([...periodEntries(key), ...state.held.filter(h => periodOf(h) === key)].map(e => e.date)).size,
    held: state.held.filter(h => periodOf(h) === key).length,
    sat: satRate(exp),
    regret: exp.filter(e => e.feel === '후회').length,
    badges: badgesOf(key).filter(b => badgeProgress(b, key).done).length };
}
// 그 달 리뷰 대상 지출(기준 금액 이상)을 하나도 빠짐없이 리뷰했는지 (칭호 '꼼꼼한 리뷰러')
function allReviewed(key) {
  const { min, cats: rc } = reviewCfg();
  const elig = periodEntries(key).filter(e => e.type === '지출' && e.amount >= min && (!rc || rc.includes(e.category)));
  return elig.length >= 3 && elig.every(e => e.feel);
}
function monthLook(key) {
  const s = monthStats(key);
  if (s.days < 5) return { face: '🐣', title: '다시 시작하는 햄스터' };
  const title = s.held >= 5 ? '잘 참는 햄스터' : s.sat != null && s.sat >= 60 ? '만족 소비 요정'
    : allReviewed(key) ? '꼼꼼한 리뷰러' : '차곡차곡 햄스터';
  return { face: '🐥', title };
}
// 월말 결산 그림: 기록이 적었던 달은 걱정하는 햄스터, 아니면 윙크하는 햄스터
const hamsterImg = look => `<img src="img/hamster-${look.face === '🐣' ? 1 : 3}.webp" alt="">`;
function renderStatus() {
  const key = periodOfDate(today()), prev = shiftPeriod(key, -1), m = Number(key.slice(5));
  const hasPrev = periodEntries(prev).length > 0, look = hasPrev ? monthLook(prev) : { face: '🐣', title: '새내기 기록러' };
  const cur = monthStats(key), lv = Math.min(5, Math.floor(earnedBadges().length / 3) + 1); // 배지 3개마다 Lv.1씩, Lv.5까지 (저금통이 점점 차오름)
  const { start } = periodRange(key), day = Math.round((parse(today()) - parse(start)) / 864e5) + 1;
  const goal = (state.settings.goals || {})[key] || '', rq = reviewQueue().length;
  $('#home-status').innerHTML = `<div class="card status">
    <div class="st-top"><div class="st-face lv${lv}"><img class="st-art" src="img/hamster-${lv}.webp" alt="Lv.${lv} 햄스터"><span class="st-lv">Lv.${lv}</span></div>
      <div style="flex:1;min-width:0"><p class="st-title">${esc(look.title)} · ${m}월 ${day}일째</p>
        <button class="st-goal-big${goal ? '' : ' empty'}" data-goal aria-label="${m}월 다짐 ${goal ? '고치기' : '적기'}"><span class="g-lab">🎯 ${m}월 다짐</span>${goal
          ? `${esc(goal)} <span class="g-pen">✎</span>` : '<span class="g-add">＋ 이번 달 다짐 적기</span>'}</button></div></div>
    <div class="st-act"><button class="st-rv" data-review ${rq ? '' : 'disabled'}>💭 리뷰하기${rq ? `<span class="st-badge">${rq}</span>` : ''}</button>
      <button class="st-hd" data-held="">🙌 참았어요</button></div>
    ${rq ? '' : '<p class="st-none">지금은 리뷰할 소비가 없어요</p>'}
    <div class="st-nums"><button class="n-sat" data-lookback><small>😊 만족 ›</small><b>${cur.sat != null ? cur.sat + '%' : '–'}</b></button>
      <button class="n-held" data-lookback><small>🙌 참음 ›</small><b>${cur.held}번</b></button><button class="n-reg" data-lookback><small>😣 후회 ›</small><b>${cur.regret}번</b></button></div>
    </div>`;
  renderRecap(key, prev, look, hasPrev);
}
// 월말 결산: 새 달 첫 7일 동안, 지난달 기록이 있으면 '지난달의 나 → 이번 달의 나'를 보여준다 (닫으면 이 기기에서 안 보임)
function renderRecap(key, prev, look, hasPrev) {
  let seen = ''; try { seen = localStorage.getItem('recapSeen') || ''; } catch { /* 무시 */ }
  const { start } = periodRange(key), day = Math.round((parse(today()) - parse(start)) / 864e5) + 1;
  if (!hasPrev || day > 7 || seen === key) { $('#home-recap').innerHTML = ''; return; }
  const before = shiftPeriod(prev, -1), was = periodEntries(before).length ? monthLook(before) : { face: '🐣', title: '새내기 기록러' };
  const a = monthStats(prev), b = monthStats(before), pm = Number(prev.slice(5)), m = Number(key.slice(5));
  const cmp = (x, y, good) => y == null || x == null ? '' : x === y ? '<small>지난달과 같아요</small>' : `<small class="${(x > y) === good ? 'good' : 'bad'}">지난달 ${y} ${x > y ? '↑' : '↓'}</small>`;
  $('#home-recap').innerHTML = `<div class="card recap">
    <div class="card-head" style="margin:0"><h2 style="margin:0">${pm}월 결산 → ${m}월의 나</h2><button class="icon-btn" data-recapclose aria-label="닫기">✕</button></div>
    <div class="rc-months"><div class="rc-mo"><div class="rc-face">${hamsterImg(was)}</div><b>${pm}월의 나</b><span>${esc(was.title)}</span></div><span class="rc-arrow">→</span>
      <div class="rc-mo now"><div class="rc-face">${hamsterImg(look)}</div><b>${m}월의 나</b><span>✨ ${esc(look.title)}</span></div></div>
    <div class="rc-res"><div>😊 만족 <b>${a.sat != null ? a.sat + '%' : '–'}</b>${cmp(a.sat, b.sat, true)}</div><div>🙌 참음 <b>${a.held}번</b>${cmp(a.held, b.held, true)}</div>
      <div>🏅 받은 배지 <b>${a.badges}개</b></div><div>😣 후회 <b>${a.regret}번</b>${cmp(a.regret, b.regret, false)}</div></div></div>`;
}

/* ================= 이번 달 목표 ================= */
function openGoal() {
  state.goalKey = periodOfDate(today());
  $('#g-title').textContent = `${Number(state.goalKey.slice(5))}월 다짐`;
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
  state.heldCat = h ? h.category : ''; renderHeldCats();
  $('#h-actions').innerHTML = (h ? '<button class="btn danger" data-helddel style="width:auto;padding:14px 18px">삭제</button>' : '')
    + '<button class="btn primary" data-heldok>저장</button>';
  $('#held-sheet').showModal();
}
// 참은 소비의 카테고리 (배지에서 '배달 참기'처럼 셀 때 씀). 다시 누르면 해제
function renderHeldCats() {
  $('#h-cats').innerHTML = cats('지출').map(c => `<button class="chip sm" data-hcat="${esc(c)}" aria-pressed="${state.heldCat === c}">${esc(c)}</button>`).join('');
}
function saveHeld() {
  const what = $('#h-what').value.trim();
  if (!what) { toast('무엇을 참았는지 적어 주세요'); return $('#h-what').focus(); }
  const prev = state.heldEditing;
  const h = { id: prev ? prev.id : newId(), date: $('#h-date').value || today(), type: HELD, category: state.heldCat || '', detail: what,
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
  state.rv = reviewQueue(); state.rvI = 0; state.rvLater = 0; state.rvSel = null;
  renderReview(); $('#review').showModal(); document.activeElement.blur(); // 첫 버튼에 포커스 테두리가 생기지 않게
}
function renderReview() {
  const e = state.rv[state.rvI];
  if (!e) {
    const later = state.rvLater;
    $('#rv-body').innerHTML = `<div class="rv-done"><span>👏</span><h2>${later === state.rv.length ? '다음에 다시 물어볼게요' : '다 돌아봤어요'}</h2>
      <p class="note">${later ? `나중에로 넘긴 ${later}개는 다음에 리뷰하기를 누르면 다시 나와요<br>` : ''}한 달 탭에서 이번 달 소비 만족도를 볼 수 있어요</p>
      <div class="actions"><button class="btn ghost" data-close>닫기</button><button class="btn primary" data-view="month">만족도 보기</button></div></div>`;
    return;
  }
  // 고르기만 하고 '확인'을 눌러야 저장하고 다음으로. 만족 · 후회를 고르면 그 아래에 그때 기분 · 한 줄 메모가 펼쳐짐
  const sel = state.rvSel || (state.rvSel = { feel: '', mood: '', memo: '', open: false });
  const d = parse(e.date), ago = Math.round((parse(today()) - d) / 864e5);
  $('#rv-body').innerHTML = `<div class="rv-prog"><span>소비 리뷰 · ${state.rvI + 1} / ${state.rv.length}</span><button class="icon-btn" data-close aria-label="리뷰 그만하기">✕</button></div>
    <div class="rv-card"><p class="rv-when">${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]}) · ${ago}일 전</p>
      <h3>${esc(e.detail || e.category)}</h3><span class="rv-cat">지출 · ${esc(e.category)}</span>
      <div class="rv-amt num">${won(e.amount)}</div>
      <p class="rv-q">지금 돌아보니 어때요?</p>
      <div class="rv-choices">${Object.entries(FEELS).map(([f, ic]) => `<button data-feel="${f}" aria-pressed="${sel.feel === f}"><span>${ic}</span>${f}</button>`).join('')}</div>
      ${withMood(sel.feel) ? `<div class="rv-mood"><p class="rv-q" style="margin:14px 0 8px">그때 기분이 어땠어요? <small>(선택)</small></p>
        <div class="mood-chips">${moodsFor(sel.feel).map(([t, ic]) => `<button class="chip" data-mood="${esc(t)}" aria-pressed="${sel.mood === t}">${ic} ${esc(t)}</button>`).join('')}</div>
        ${sel.open ? `<textarea class="input mood-memo" id="rv-memo" rows="2" maxlength="80" placeholder="${sel.feel === '만족' ? '어떤 점이 좋았어요?' : '다음엔 어떻게 해 볼까요?'} (선택)">${esc(sel.memo)}</textarea>`
          : '<button class="link-btn" data-moodmemo>✎ 한 줄 남기기 (선택)</button>'}</div>` : ''}</div>
    <div class="actions"><button class="btn primary" data-moodok ${sel.feel ? '' : 'disabled'}>확인</button></div>
    <div class="actions rv-sub"><button class="btn ghost" data-rvlater>이건 나중에</button><button class="btn ghost" data-feel="skip">이건 안 물어보기</button></div>`;
  if (sel.open && state.rvMemoFocus) { $('#rv-memo').focus(); state.rvMemoFocus = false; }
}
function answerReview(feel) {
  const e = state.rv[state.rvI]; if (!e) return;
  if (feel === 'skip') { // 안 물어보기는 바로 저장하고 다음으로
    store.save({ ...e, feel }, e).catch(err => toast('동기화 실패: ' + errMsg(err)));
    state.rvI++; state.rvSel = null; return renderReview();
  }
  const sel = state.rvSel; keepMemo();
  if (sel.feel !== feel) sel.mood = ''; // 만족 ↔ 후회는 기분 목록이 달라서 고른 기분을 비움
  sel.feel = feel;
  renderReview();
}
const keepMemo = () => { if ($('#rv-memo') && state.rvSel) state.rvSel.memo = $('#rv-memo').value; };
// '확인': 고른 결과 저장 후 다음으로
function saveMood() {
  const e = state.rv[state.rvI], sel = state.rvSel; if (!e || !sel || !sel.feel) return;
  keepMemo();
  const r = { ...e, feel: sel.feel }; delete r.mood; delete r.feelMemo;
  if (withMood(sel.feel)) { if (sel.mood) r.mood = sel.mood; if (sel.memo.trim()) r.feelMemo = sel.memo.trim(); }
  store.save(r, e).catch(err => toast('동기화 실패: ' + errMsg(err)));
  state.rvI++; state.rvSel = null; renderReview();
}

// 설정: 후회할 때 기분 · 만족할 때 기분 목록 추가 · 삭제 (예전 기록에 남은 기분은 그대로 보여요)
// 기분 칩을 누르면 아래 칸에 불러와서 고치고('수정'), 다시 누르면 고치기 취소. kind: 'bad'(후회) · 'good'(만족)
const moodBox = kind => $(`[data-moodbox="${kind}"]`), moodInput = kind => moodBox(kind).querySelector('input');
function renderMoodSettings() {
  for (const kind of ['bad', 'good']) {
    const E = (state.moodEdit || {})[kind], box = moodBox(kind);
    box.querySelector('.chips').innerHTML = moods(kind).map(([t, ic], i) => `<span class="chip sm mood-item" aria-pressed="${E === i}">
      <button class="mood-lab" data-moodedit="${kind}|${i}" aria-label="${esc(t)} 고치기">${ic} ${esc(t)}</button><button data-mooddel="${kind}|${i}" aria-label="${esc(t)} 삭제">✕</button></span>`).join('');
    box.querySelector('[data-moodadd]').textContent = E != null ? '수정' : '추가';
    box.querySelector('[data-moodcancel]').hidden = E == null;
    moodInput(kind).placeholder = E != null ? '바꿀 이름 (앞에 이모지를 쓰면 아이콘도 바뀌어요)' : kind === 'good' ? '예: 😍 갖고 싶었던 거' : '예: 😴 졸려서';
  }
}
const setMoodEdit = (kind, i) => { state.moodEdit = { ...state.moodEdit, [kind]: i }; };
function cancelMoodEdit(kind) { setMoodEdit(kind, null); moodInput(kind).value = ''; renderMoodSettings(); }
function editMood(kind, i) {
  if ((state.moodEdit || {})[kind] === i) return cancelMoodEdit(kind);
  const [t, ic] = moods(kind)[i];
  setMoodEdit(kind, i); moodInput(kind).value = `${ic} ${t}`;
  renderMoodSettings(); moodInput(kind).focus();
}
function saveMoods(kind, list) {
  const objs = list.map(([t, ic]) => ({ t, ic })), key = MOOD_KINDS[kind].key;
  state.settings[key] = objs; renderMoodSettings();
  store.saveSettings({ [key]: objs }).catch(err => toast('설정 저장 실패: ' + errMsg(err)));
}
function addMood(kind) {
  const raw = moodInput(kind).value.trim(); if (!raw) return moodInput(kind).focus();
  const m = raw.match(/^(\p{Extended_Pictographic}[\uFE0F\u200D\p{Extended_Pictographic}]*)\s*(.+)$/u); // "😴 졸려서"처럼 앞에 이모지가 있으면 아이콘으로
  const E = (state.moodEdit || {})[kind], list = moods(kind).slice();
  const [t, ic] = m ? [m[2].trim(), m[1]] : [raw, E != null ? list[E][1] : '💭'];
  if (list.some(([x], i) => x === t && i !== E)) { toast('이미 있는 기분이에요'); return; }
  moodInput(kind).value = '';
  if (E == null) return saveMoods(kind, [...list, [t, ic]]);
  const old = list[E][0];
  list[E] = [t, ic]; setMoodEdit(kind, null);
  saveMoods(kind, list);
  if (old !== t) { // 이름을 바꾸면 예전 기록(만족 또는 후회)에 남은 기분 이름도 같이 바꾼다
    const hit = state.entries.filter(e => e.mood === old && e.feel === MOOD_KINDS[kind].feel);
    hit.forEach(e => store.save({ ...e, mood: t }, e).catch(err => toast('동기화 실패: ' + errMsg(err))));
    toast(hit.length ? `'${t}'(으)로 바꿨어요 · 예전 기록 ${hit.length}개도 함께` : `'${t}'(으)로 바꿨어요`);
  } else toast('수정했어요');
}
function removeMood(kind, i) {
  setMoodEdit(kind, null); moodInput(kind).value = '';
  const list = moods(kind).slice(); list.splice(i, 1);
  saveMoods(kind, list);
}

function saveReviewCfg(patch) {
  state.settings.review = { ...reviewCfg(), ...patch }; // 저장이 돌아오기 전에 다른 설정을 바꿔도 덮어쓰지 않게
  store.saveSettings({ review: state.settings.review }).catch(err => toast('설정 저장 실패: ' + errMsg(err)));
}
const rvMinValue = () => Number($('#s-rv-min').value.replace(/[^\d]/g, '')) || 0;
function setRvMin(n) { $('#s-rv-min').value = n ? n.toLocaleString('ko-KR') : ''; }
// 설정은 묶음 목록 → 세부 화면 두 단계. 세부 화면에선 위 ‹ 로 목록으로 돌아감
const SET_PAGES = { book: '가계부', look: '화면', review: '소비 리뷰', data: '데이터 · 계정' };
function setPage(k) {
  // 세부 화면은 오른쪽에서 밀려 들어오고, 목록으로 돌아갈 땐 왼쪽에서 들어옴 (새 화면이 뜨는 느낌)
  const into = k ? document.querySelector(`#settings .set-page[data-page="${k}"]`) : $('#set-menu');
  into.classList.remove('slide-in', 'slide-back'); void into.offsetWidth; into.classList.add(k ? 'slide-in' : 'slide-back');
  $('#set-menu').hidden = !!k;
  document.querySelectorAll('#settings .set-page').forEach(el => { el.hidden = el.dataset.page !== k; });
  $('#set-title').textContent = k ? SET_PAGES[k] : '설정';
  $('[data-setback]').setAttribute('aria-label', k ? '설정 목록으로' : '설정 나가기'); // 목록에서 ‹ 는 설정 닫기
  $('#settings .body').scrollTop = 0;
}

// 설정 '확인': 입력 중인 값(이름, 리뷰 금액)을 반영하고 닫기
function applySettings() {
  // 칸에 쓰고 '추가' 대신 '확인'을 눌러도 들어가게. 고치던 중이면 바꾼 게 있을 때만 반영하고, 그대로면 그냥 닫기
  for (const kind of ['bad', 'good']) {
    const E = (state.moodEdit || {})[kind], v = moodInput(kind).value.trim();
    if (E != null) { const [t, ic] = moods(kind)[E]; if (v && v !== `${ic} ${t}` && v !== t) addMood(kind); else cancelMoodEdit(kind); }
    else if (v) addMood(kind);
  }
  if (rvMinValue() !== reviewCfg().min) saveReviewCfg({ min: rvMinValue() });
  const title = $('#s-title').value.trim();
  if (title !== appTitle()) $('#s-title').dispatchEvent(new Event('change'));
  $('#settings').close();
  toast('설정을 반영했어요');
}
function renderReviewCats() {
  const rc = reviewCfg().cats;
  $('#s-rv-cats').innerHTML = `<button class="chip sm" data-rvcat="" aria-pressed="${!rc}">전체</button>`
    + cats('지출').map(c => `<button class="chip sm" data-rvcat="${esc(c)}" aria-pressed="${!rc || rc.includes(c)}">${esc(c)}</button>`).join('');
}
// '전체'를 누르면 모두 켜기 ↔ 모두 끄기. 카테고리를 누르면 하나씩 켜고 끄기 (다 켜지면 다시 '전체')
function toggleReviewCat(c) {
  const all = cats('지출'), rc = reviewCfg().cats, cur = rc || all;
  let next = c === '' ? (rc ? null : []) : cur.includes(c) ? cur.filter(x => x !== c) : [...cur, c];
  if (next && all.every(x => next.includes(x))) next = null;
  saveReviewCfg({ cats: next });
  renderReviewCats();
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
// base: 비교 기준 { n: 비교한 달 수, avg(키) }. 기본은 최근 1년 월평균, 지출은 같은 기간 평균(spendPace)
function chg(cur, k, base = state.base, label = '최근 1년 월평균') {
  if (!base || !base.n || !cur) return '<span class="chg"></span>';
  const avg = base.avg(k);
  if (!avg) return '<span class="chg" title="최근 1년 기록 없음">신규</span>';
  const p = Math.round((cur - avg) / avg * 100);
  const txt = p > 0 ? `▲${p}%` : p < 0 ? `▼${-p}%` : '–0%';
  return `<span class="chg num ${p > 0 ? 'up' : p < 0 ? 'down' : ''}" title="${label} ${won(avg)}">${txt}</span>`;
}

function renderMonth() {
  renderPeriodNav();
  const list = periodEntries(state.period);
  state.base = baseline(state.period);
  state.pace = spendPace(state.period);
  const byType = sumBy(list, e => e.type);
  const notes = [
    '전체 예산을 정하면 모든 지출 카테고리에 똑같이 나눠 넣어요. 그 뒤 카테고리별로 조정하면 총 예산도 같이 바뀌어요. 저축·투자는 들어가지 않아요.',
    '예산을 정하지 않은 달은 직전에 정한 달의 예산을 그대로 써요.',
    '원그래프 가운데 %는 최근 12개월 같은 기간(첫날~오늘과 같은 일째) 평균보다 얼마나 더/덜 썼는지예요.',
    '지출과 지출 카테고리의 ▲▼는 최근 12개월 각 달의 같은 기간(첫날~오늘과 같은 일째) 지출 평균과 비교해요. 지난 달을 볼 때는 달 전체끼리 비교해요.',
    state.base.n ? `▲▼ 최근 1년(${state.base.n}개월) 월평균 대비예요. <span class="up">▲ 늘어남</span> · <span class="down">▼ 줄어듦</span>` : '▲▼ 비교할 최근 1년 기록이 아직 없어요.',
    '수입·지출 모두 실제 날짜가 이 기간 안에 있는 기록만 계산해요.',
  ];
  $('#summary').innerHTML = `
    <div class="card-head">
      <h2 style="margin:0">${state.period === periodOfDate(today()) ? '이번 달 ' : ''}예산</h2>
      <div style="display:flex;align-items:center;gap:4px">
        ${sumOf(catBudgetsOf(state.period).map) ? `<button class="chip sm bud-edit" data-budget>전체 ${compact(sumOf(catBudgetsOf(state.period).map))}원 ✎</button>`
          : `<button class="chip sm bud-edit bud-new" data-budget>＋ ${state.period === periodOfDate(today()) ? '이번 달 ' : ''}예산 정하기</button>`}
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

  const sv = list.filter(e => e.type === '저축' || e.type === '투자');
  $('#save-bars').innerHTML = barsHtml(sumBy(sv, e => e.type + '|' + e.category), null, null);
  renderLookback(list.filter(e => e.type === '지출'), state.held.filter(h => periodOf(h) === state.period), state.period);

}

// 소비 만족도: 리뷰한 지출 중 만족 · 후회 금액끼리 비율(필수는 빼고 금액만). 후회한 소비는 큰 순서로
// 돌아보기: 만족 · 후회 비율(금액 기준), 참음, 받은 배지, 후회할 때 가장 많았던 기분. 만족 · 참음 · 후회 칸을 누르면 그 목록이 펼쳐짐
function renderLookback(exp, held, key) {
  const done = exp.filter(e => FEELS[e.feel]), total = done.reduce((s, e) => s + e.amount, 0), sat = satRate(done);
  const byAmt = f => done.filter(e => e.feel === f).sort((a, b) => b.amount - a.amount);
  const good = byAmt('만족'), regret = byAmt('후회');
  const moods = new Map(); for (const e of regret) if (e.mood) moods.set(e.mood, (moods.get(e.mood) || 0) + 1);
  const topMood = [...moods].sort((a, b) => b[1] - a[1])[0], moodIc = moodIcon;
  const saved = held.reduce((s, h) => s + h.amount, 0), open = state.lookOpen;
  const badges = badgesOf(key), got = badges.filter(b => badgeProgress(b, key).done).length;
  // 펼친 목록은 종류 · 이모지 없이 날짜 · 카테고리(· 그때 기분)와 내용만
  const feelItem = e => `<li class="item" data-id="${esc(e.id)}"><div class="main"><div class="cat">${md(e.date)} · ${esc(e.category)}${e.mood ? ` · ${esc(e.mood)}` : ''}</div>
    <div class="det">${esc(e.detail || '—')}${e.memo ? ` <span class="cat">· ${esc(e.memo)}</span>` : ''}</div>${e.feelMemo ? `<div class="cat">“${esc(e.feelMemo)}”</div>` : ''}</div>
    <div class="amt num">${won(e.amount)}</div></li>`;
  const heldItem = h => `<li class="item" data-held="${esc(h.id)}"><div class="main"><div class="cat">${md(h.date)}${h.category ? ` · ${esc(h.category)}` : ''}${h.memo ? ` · ${esc(h.memo)}` : ''}</div>
    <div class="det">${esc(h.detail)}</div></div><div class="amt num saved">${h.amount ? won(h.amount) + ' 아낌' : ''}</div></li>`;
  const heldList = held.slice().sort((a, b) => b.date.localeCompare(a.date));
  // 순서는 홈 상태 카드와 같게: 만족 · 참음 · 후회 (누르면 아래에 그 목록), 그 뒤 배지
  const tile = (k, cls, num, label) => `<button class="lb-tap ${cls}" data-lookfold="${k}" aria-expanded="${open === k}"><b>${num}</b><small>${label} ${open === k ? '▴' : '▾'}</small></button>`;
  const panel = open === 'good' ? [`😊 만족한 소비 ${good.length}개`, good, feelItem, '만족한 소비가 없어요']
    : open === 'held' ? [`🙌 참은 소비 ${held.length}개${saved ? ` · ${won(saved)} 아낌` : ''}`, heldList, heldItem, '사려다 참은 게 있으면 홈에서 기록해 보세요']
    : open === 'regret' ? [`😣 후회한 소비 ${regret.length}개`, regret, feelItem, '후회한 소비가 없어요'] : null;
  $('#lookback').innerHTML = `<h2 style="margin-bottom:2px">돌아보기</h2>
    <p class="label">${done.length ? `리뷰한 지출 ${done.length}건 · ${won(total)} 기준` : `아직 리뷰한 소비가 없어요 · ${won(reviewCfg().min)} 이상 지출을 ${reviewCfg().days}일 뒤 물어봐요`}</p>
    <div class="lb-nums">${tile('good', 'lb-sat', sat != null ? sat + '%' : '–', `😊 만족 ${good.length}개`)}${tile('held', 'lb-held', `${held.length}번`, `🙌 참음${saved ? ` ${compact(saved)}` : ''}`)}${tile('regret', 'lb-reg', sat != null ? 100 - sat + '%' : '–', `😣 후회 ${regret.length}개`)}
      <div class="lb-badge"><b>${badges.length ? `${got}/${badges.length}` : '–'}</b><small>🏅 배지</small></div></div>
    ${panel ? `<div class="lb-panel"><p>${panel[0]}</p>${panel[1].length ? `<ul class="list">${panel[1].map(panel[2]).join('')}</ul>` : `<p class="empty" style="padding:4px 0">${panel[3]}</p>`}</div>` : ''}
    ${topMood ? `<p class="lb-mood">후회할 때 가장 많았던 기분 · <b>${moodIc(topMood[0])} ${esc(topMood[0])}</b> ${topMood[1]}번</p>` : ''}`;
}

// 카테고리별 예산: 달마다 정한다. 전체 예산을 정하면 모든 카테고리에 똑같이 나눠 넣고(openBudget),
// 그 뒤 카테고리마다 손잡이로 조정한다. 그 달에 안 정했으면 직전에 정한 달의 값을 쓴다. 총 예산 = 카테고리 예산의 합
function catAverages(key) {
  const b = baseline(key);
  return Object.fromEntries(cats('지출').map(c => [c, Math.round(b.avg('지출|' + c) / 1000) * 1000]));
}
function catBudgetsOf(key) {
  const all = state.settings.catBudgets || {};
  const prevKey = Object.keys(all).filter(k => k < key).sort().at(-1);
  const base = all[key] || (prevKey && all[prevKey]) || {}, avg = catAverages(key); // avg는 예산 창 막대의 ▲ 평소 금액 · 눈금에 씀
  return { map: Object.fromEntries(cats('지출').map(c => [c, base[c] || 0])), avg };
}
const sumOf = map => Object.values(map).reduce((a, b) => a + b, 0);

// 지출 비교: 보고 있는 달의 첫날부터 k일째까지 쓴 돈을, 직전 12개월 각 달의 같은 기간(첫날~k일째) 지출 평균과 비교.
// 달 전체 평균과 비교하면 달 초에는 늘 적게 나오니, 같은 날짜까지끼리 비교한다. 기록이 하나도 없는 달은 평균에서 뺀다.
// 지난 달을 볼 때는 k = 그 달 일수(달 전체끼리 비교). 아직 시작 안 한 달은 null.
function spendPace(key) {
  const { start, end } = periodRange(key), t = today();
  if (t < start) return null;
  const k = Math.round((parse(t > end ? end : t) - parse(start)) / 864e5) + 1;
  const sums = new Map(); let n = 0;
  for (let i = 1; i <= 12; i++) {
    const p = shiftPeriod(key, -i), list = periodEntries(p);
    if (!list.length) continue;
    n++;
    const r = periodRange(p), until = [addDays(r.start, k - 1), r.end].sort()[0];
    for (const e of list) if (e.type === '지출' && e.date <= until)
      for (const kk of ['지출', '지출|' + e.category]) sums.set(kk, (sums.get(kk) || 0) + e.amount);
  }
  return { n, k, live: t <= end, avg: kk => n ? (sums.get(kk) || 0) / n : 0 };
}

// 예산 카드: 위에는 총 예산 대비 쓴 돈(막대)과 카테고리별 지출 비율(원그래프),
// '카테고리별 예산'을 펼치면 카테고리마다 예산 대비 쓴 돈. 동그란 손잡이를 끌면 바로 예산이 바뀌고 저장된다
function budgetHtml(exp) {
  const cb = catBudgetsOf(state.period), map = cb.map, byCat = sumBy(exp, e => e.category);
  state.budCtx = { byCat, avg: cb.avg, spent: exp.reduce((s, e) => s + e.amount, 0) };
  return `<div id="bud-total">${budTotalHtml(map)}</div>
    ${catPieHtml(byCat)}
    ${sumOf(map) ? catSpendSection(map, byCat) : ''}`;
}
// 원그래프 아래 '지출 카테고리별로 보기': 예산 대비 쓴 비율이 높은 순서로 같은 모양의 막대
function catSpendSection(map, byCat) {
  const open = state.budOpen;
  if (!open) return '<button class="cb-toggle" data-budopen aria-expanded="false"><span>지출 카테고리별로 보기</span><i>펼치기 ▾</i></button>';
  const rows = cats('지출').map(c => ({ c, b: map[c] || 0, s: byCat.get(c) || 0 })).filter(r => r.b || r.s)
    .map(r => ({ ...r, r: r.b ? r.s / r.b : Infinity })).sort((x, y) => y.r - x.r || y.s - x.s);
  return `<button class="cb-toggle" data-budopen aria-expanded="true"><span>지출 카테고리별로 보기</span><i>접기 ▴</i></button>
    <div class="cs-list">${rows.map(({ c, b, s }) => {
      // 예산 대비 %. 넘었으면 막대 끝 = 지금 쓴 돈, 예산까지는 보통 색 + 넘은 부분은 진한 빨강
      const p = b ? Math.round(s / b * 100) : null, over = b && s > b;
      const bar = !b ? '<i class="ovr" style="left:0;width:100%"></i>'
        : over ? `<i style="width:${b / s * 100}%"></i><i class="ovr" style="left:${b / s * 100}%;width:${(s - b) / s * 100}%"></i><u style="left:${b / s * 100}%"></u>`
        : `<i style="width:${s / b * 100}%"></i>`;
      return `<button class="cs-row" data-jump="지출|${esc(c)}">
      <span class="cs-head"><span>${esc(c)}</span><span class="num">${b ? `${compact(s)} / <b>${compact(b)}</b> · <b class="${over ? 'over' : ''}">${p}%</b>` : `<b class="over">예산 없이 ${compact(s)}</b>`}</span></span>
      <span class="cs-track">${bar}</span>${over ? `<span class="cs-over">예산보다 ${compact(s - b)}원 더 썼어요</span>` : ''}</button>`;
    }).join('')}</div>`;
}
// 원그래프 카테고리 색: 순위가 아니라 카테고리마다 고정(카테고리 목록 순서대로 배지 파스텔). 목록에 없는 카테고리는 이름으로 고름
// '그 외' 색(#E2C2A3)은 빼 둠
const CAT_COLORS = ['#FFB59A', '#9CC8FF', '#FFDB6E', '#C8B6FF', '#8ED9B4', '#F7A3BE', '#FFB566', '#B8E0A0', '#BFD7EA'];
function catColor(c) {
  let i = cats('지출').indexOf(c);
  if (i < 0) i = [...c].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7) >>> 0;
  return CAT_COLORS[i % CAT_COLORS.length];
}
// 카테고리별 지출 비율 원그래프: 큰 순서로 5개(5% 이상)만 따로, 나머지는 '기타'. 조각 사이 2px 틈.
// 범례 대신 각 조각 바깥쪽에 이름·비율을 글자로 붙인다 (색 위에 글자를 얹으면 밝은 색에서 안 읽혀서)
function catPieHtml(byCat) {
  const rows = [...byCat].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((s, [, v]) => s + v, 0);
  if (!total) return '';
  const top = rows.slice(0, 5).filter(([, v]) => v / total >= 0.05), restRows = rows.slice(top.length);
  const rest = restRows.reduce((s, [, v]) => s + v, 0);
  const parts = top.map(([c, v]) => ({ c, v, color: catColor(c) }));
  // 작은 카테고리는 '그 외'로 묶음 (지출 카테고리 '기타'와 헷갈리지 않게 다른 이름). 누르면 옆에 안에 든 카테고리가 펼쳐짐
  if (rest) parts.push({ c: '그 외', v: rest, color: 'var(--c-other)', etc: restRows.map(([c]) => c).join(', ') });
  const CX = 170, CY = 118, R = 74, W = 30, C = 2 * Math.PI * R, GAP = parts.length > 1 ? 2 : 0;
  let off = 0, labels = '';
  const arcs = parts.map(p => {
    const len = p.v / total * C, dash = Math.max(len - GAP, 0.5), pct = Math.round(p.v / total * 100);
    const mid = (off + len / 2) / C * 2 * Math.PI - Math.PI / 2, lr = R + W / 2 + 10; // 조각 가운데 각도, 12시에서 시계방향
    const x = CX + Math.cos(mid) * lr, y = CY + Math.sin(mid) * lr, anchor = Math.abs(Math.cos(mid)) < 0.25 ? 'middle' : Math.cos(mid) > 0 ? 'start' : 'end';
    const jump = p.etc ? ' data-pieetc="1"' : ` data-jump="지출|${esc(p.c)}"`;
    labels += `<g class="pl"${jump}><text x="${x}" y="${y - 1}" text-anchor="${anchor}" class="pl-n">${esc(p.c)}${p.etc ? (state.pieEtc ? ' ▴' : ' ▾') : ''}</text>
      <text x="${x}" y="${y + 12}" text-anchor="${anchor}" class="pl-v">${pct}% · ${compact(p.v)}</text></g>`;
    const arc = `<circle r="${R}" cx="${CX}" cy="${CY}" fill="none" stroke="${p.color}" stroke-width="${W}" stroke-dasharray="${dash} ${C - dash}" stroke-dashoffset="${-off}" transform="rotate(-90 ${CX} ${CY})"${jump}>
      <title>${esc(p.c)} ${won(p.v)} (${pct}%)${p.etc ? ' · ' + esc(p.etc) : ''}</title></circle>`;
    off += len; return arc;
  }).join('');
  const open = rest && state.pieEtc;
  const etc = open ? `<div class="pie-etc"><p>그 외 ${restRows.length}개 · 누르면 상세내역</p>${restRows.map(([c, v]) => `<button data-jump="지출|${esc(c)}"><span>${esc(c)}</span><b class="num">${compact(v)}</b><small>${Math.round(v / total * 100)}%</small></button>`).join('')}</div>` : '';
  return `<div class="pie${open ? ' open' : ''}"><svg viewBox="0 0 340 236" role="img" aria-label="카테고리별 지출 비율">${arcs}${labels}${paceText(total, CX, CY)}</svg>${etc}</div>`;
}

// 원그래프 가운데: 쓴 돈 + 평소 이맘때(최근 12개월 같은 기간 평균) 대비 %
function paceText(total, X = 64, Y = 64) {
  const pace = state.pace, avg = pace ? pace.avg('지출') : 0;
  const p = avg ? Math.round((total - avg) / avg * 100) : null;
  const tip = avg ? `<title>평소 ${pace.live ? '이맘때' : ''} ${won(avg)} (최근 ${pace.n}개월 ${pace.live ? `${pace.k}일째까지 ` : ''}평균)</title>` : '';
  if (p === null) return `<text x="${X}" y="${Y - 4}" text-anchor="middle" class="p-top">쓴 돈</text><text x="${X}" y="${Y + 16}" text-anchor="middle" class="p-val">${compact(total)}</text>`;
  return `<g>${tip}<text x="${X}" y="${Y - 14}" text-anchor="middle" class="p-top">쓴 돈</text><text x="${X}" y="${Y + 6}" text-anchor="middle" class="p-val">${compact(total)}</text>
    <text x="${X}" y="${Y + 24}" text-anchor="middle" class="p-cmp ${p > 0 ? 'up' : p < 0 ? 'down' : ''}">평소보다 ${p > 0 ? '▲' : p < 0 ? '▼' : ''}${Math.abs(p)}%</text></g>`;
}

// 카테고리마다 자기 눈금: 최근 12개월 평균의 2배(쓴 돈·예산이 더 크면 그만큼)를 1·2·5 단위로 올림.
// 예산을 바꿔도 평균은 그대로라 끝점이 잘 안 바뀐다
function catScale(b, s, avg) {
  const v = Math.max(avg * 2, s * 1.2, b * 1.25, 50000), p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].map(m => m * p).find(x => x >= v);
}

function budTotalHtml(map) {
  const { end } = periodRange(state.period), t = today();
  const budget = sumOf(map), spent = state.budCtx.spent, rest = budget - spent;
  if (!budget) return `<div class="bud-top"><div><p class="label">쓴 돈</p><div class="hero num">${won(spent)}</div></div></div>`;
  const note = t > end ? (rest < 0 ? `<p class="bud-note bad">예산보다 ${won(-rest)} 더 썼어요</p>` : `<p class="bud-note good">예산보다 ${won(rest)} 덜 썼어요</p>`) : '';
  return `<div class="bud-top"><div><p class="label">${rest >= 0 ? '남은 예산' : '예산 초과'}</p><div class="hero num ${rest < 0 ? 'over' : ''}">${rest < 0 ? '−' : ''}${won(Math.abs(rest))}</div></div></div>
    <div class="tb"><div class="tb-track"><i style="width:${Math.min(100, spent / budget * 100)}%" class="${rest < 0 ? 'over' : ''}"></i></div>
    <div class="tb-lab"><span>쓴 돈 <b class="num">${won(spent)}</b></span><span>총 예산 <b class="num">${won(budget)}</b></span></div></div>${note}`;
}

// 'N월 예산' 창: 전체 예산(입력·끌기) + 카테고리별 예산(손잡이). 고치는 동안은 초안에만 두고 '저장'을 눌러야 반영
// 전체를 바꾸면 카테고리 예산을 지금 비율대로 늘리거나 줄이고(처음이면 똑같이), 카테고리를 바꾸면 전체가 다시 계산된다
function openBudget() {
  const [y, m] = state.period.split('-').map(Number), cb = catBudgetsOf(state.period);
  state.budDraft = { ...cb.map }; state.budAvg = cb.avg;
  $('#b-title').textContent = `${y}년 ${m}월 예산`;
  const v = sumOf(state.budDraft), avg = baseline(state.period).avg('지출'), sl = $('#b-slider');
  state.budTotalAvg = avg;
  sl.max = catScale(v, avg * 2 / 1.2, 1500000); sl.step = 10000;
  if (!v && avg) splitBudget(Math.round(avg / 10000) * 10000, true);
  renderBudgetSheet();
  $('#budget-editor').showModal(); document.activeElement.blur();
}
function splitBudget(total, equal) {
  const cs = cats('지출'), cur = sumOf(state.budDraft);
  if (equal || !cur) {
    const each = Math.floor(total / cs.length / 1000) * 1000;
    state.budDraft = Object.fromEntries(cs.map((c, i) => [c, i ? each : total - each * (cs.length - 1)]));
  } else {
    const k = total / cur; let acc = 0;
    cs.forEach(c => { state.budDraft[c] = Math.round((state.budDraft[c] || 0) * k / 1000) * 1000; acc += state.budDraft[c]; });
    const big = cs.reduce((a, c) => (state.budDraft[c] > state.budDraft[a] ? c : a), cs[0]);
    state.budDraft[big] += total - acc; // 반올림 차이는 가장 큰 카테고리에서 맞춤
  }
}
// 전체 막대 눈금: 0 · ▲최근 평균 · 끝값. 끝값은 금액이 넘으면 늘어난다
function renderTotalScale() {
  const sl = $('#b-slider'), max = Number(sl.max), avg = state.budTotalAvg;
  $('#b-scale').innerHTML = `<span>0</span>${avg && avg < max ? `<span class="b-avg" style="left:${avg / max * 100}%">▲ 최근 평균 ${compact(avg)}</span>` : ''}<span>${compact(max)}</span>`;
}
function renderBudgetTotal() {
  const v = sumOf(state.budDraft), sl = $('#b-slider');
  $('#b-amount').value = v ? v.toLocaleString('ko-KR') : '';
  if (v > Number(sl.max)) sl.max = catScale(v, 0, 0);
  sl.value = v; paintBudgetSlider(); renderTotalScale();
}
// 카테고리 막대는 모두 같은 눈금이라 서로 길이를 견줄 수 있다: 기본 끝값 50만, 가장 큰 예산·평소 금액이 안 들어가면 넉넉히 늘림
function budScale() {
  const avg = state.budAvg || {};
  return Math.max(500000, catScale(Math.max(0, ...cats('지출').map(c => Math.max(state.budDraft[c] || 0, avg[c] || 0))), 0, 0));
}
function renderBudgetSheet() {
  renderBudgetTotal();
  const M = state.budScale = budScale();
  $('#b-cats').innerHTML = cats('지출').map(c => cbRowHtml(c, state.budDraft[c] || 0, M)).join('');
}
function paintBudgetSlider() { // 막대의 채워진 부분 색칠
  const sl = $('#b-slider'); sl.style.setProperty('--p', `${Math.min(100, sl.value / sl.max * 100)}%`);
}
function setBudgetTotal(v, equal) { splitBudget(v, equal); renderBudgetSheet(); }
// 전체 칸에 입력만 하고 바로 버튼을 누르면 iOS는 change가 안 와서 초안에 반영이 안 됨 → 버튼 누를 때 칸의 값을 먼저 반영
function applyBudgetInput() {
  const typed = Number($('#b-amount').value.replace(/[^\d]/g, '')) || 0;
  if (typed && typed !== sumOf(state.budDraft)) splitBudget(typed, false);
}
function saveBudget() {
  applyBudgetInput();
  if (!sumOf(state.budDraft)) { toast('예산을 정해 주세요'); return; }
  $('#budget-editor').close();
  saveCatBudgets({ ...state.budDraft });
  toast('예산을 저장했어요');
}
// 예산 창의 카테고리 줄: 지출은 보여주지 않고 예산만. 막대 아래 ▲는 그 카테고리 평소(최근 12개월 평균) 지출
function cbRowHtml(c, b, M) {
  const pct = v => `${Math.min(100, v / M * 100)}%`, avg = (state.budAvg || {})[c] || 0;
  return `<div class="cb-row" data-cbcat="${esc(c)}">
    <div class="cb-head"><span class="cb-name">${esc(c)}</span><span class="cb-amt num"><b>${b ? won(b) : '–'}</b></span></div>
    <div class="cb-track"><i class="cb-fill bud" style="width:${pct(b)}"></i>
      <button class="cb-knob" style="left:${pct(b)}" aria-label="${esc(c)} 예산 ${won(b)}, 좌우로 끌어서 바꾸기"></button></div>
    <div class="cb-scale num">${avg ? `<span class="cb-avg">${avgLabel(avg, M)}</span>` : '<span></span>'}<span class="cb-max">${compact(M)}</span></div>
  </div>`;
}
// ▲가 막대 오른쪽에 가까우면 글자를 ▲ 왼쪽에 둬서 끝값과 겹치지 않게
function avgLabel(avg, M) {
  const p = Math.min(100, avg / M * 100), right = p > 55;
  return `<i style="left:${p}%;transform:translateX(${right ? 'calc(-100% + 4px)' : '-4px'})">${right ? `평소 ${compact(avg)} ▲` : `▲ 평소 ${compact(avg)}`}</i>`;
}
// 눈금이 바뀌면(끝까지 끌어서 늘어날 때) 모든 줄의 막대 · 손잡이 · ▲ 위치를 다시 맞춘다
function paintBudgetRows() {
  const M = state.budScale, avg = state.budAvg || {}, pct = v => `${Math.min(100, v / M * 100)}%`;
  for (const row of $('#b-cats').children) {
    const c = row.dataset.cbcat, b = state.budDraft[c] || 0;
    row.querySelector('.cb-amt b').textContent = b ? won(b) : '–';
    row.querySelector('.cb-fill').style.width = row.querySelector('.cb-knob').style.left = pct(b);
    const a = row.querySelector('.cb-avg'); if (a) a.innerHTML = avgLabel(avg[c] || 0, M);
    row.querySelector('.cb-max').textContent = compact(M);
  }
}
function saveCatBudgets(map) {
  state.settings.catBudgets = { ...state.settings.catBudgets, [state.period]: map }; // 저장이 돌아오기 전에도 바로 보이게
  renderMonth();
  store.saveSettings({ catBudgets: state.settings.catBudgets }).catch(err => toast('예산 저장 실패: ' + errMsg(err)));
}
// 손잡이 끌기: 누른 곳에서 움직인 만큼만 바꾼다(톡 누르기만 하면 금액이 그대로). 오른쪽 끝에 대고 있으면 눈금이 점점 늘어난다
function budDragStart(ev) {
  const knob = ev.target.closest('.cb-knob'); if (!knob) return;
  const tr = knob.parentElement, row = tr.closest('.cb-row'), c = row.dataset.cbcat;
  let x0 = ev.clientX, v0 = state.budDraft[c] || 0;
  let lastX = x0, moved = false, grow = null;
  ev.preventDefault();
  knob.classList.add('on');
  const step = () => { const M = state.budScale; return M <= 100000 ? 1000 : M <= 500000 ? 5000 : 10000; };
  const set = v => {
    if (v === state.budDraft[c]) return;
    state.budDraft[c] = v; paintBudgetRows(); renderBudgetTotal();
  };
  const update = () => {
    const r = tr.getBoundingClientRect(), M = state.budScale, st = step();
    const v = Math.round((v0 + (lastX - x0) / r.width * M) / st) * st;
    set(Math.min(Math.max(v, 0), M));
    // 끝에 닿아 있으면 0.4초마다 눈금을 한 단계씩 늘려서 계속 끌 수 있게
    const atEnd = lastX >= r.right - 2 || state.budDraft[c] >= M;
    if (atEnd && !grow) grow = setInterval(() => { // 끝값을 한 칸(50만이면 10만)씩 늘리고 금액은 원래 끝값까지
      const M0 = state.budScale; state.budScale = M0 + 10 ** Math.floor(Math.log10(M0));
      state.budDraft[c] = M0; paintBudgetRows(); renderBudgetTotal();
      x0 = lastX; v0 = state.budDraft[c]; // 늘어난 눈금에서 지금 위치부터 다시 끌기
    }, 400);
    if (!atEnd && grow) { clearInterval(grow); grow = null; }
  };
  const move = e => {
    lastX = e.clientX;
    if (!moved && Math.abs(lastX - x0) < 4) return; // 손 떨림 정도는 무시
    moved = true; update();
  };
  const up = () => { // 손가락이 손잡이 밖으로 나가도 따라가도록 화면 전체에서 듣는다
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    clearInterval(grow); knob.classList.remove('on');
    if (moved) renderBudgetSheet(); // 놓으면 눈금을 다시 맞춤(가장 큰 금액이 넉넉히 들어가게)
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
}
function barsHtml(map, color, type, base, label) {
  const rows = [...map].sort((a, b) => b[1] - a[1]);
  if (!rows.length) return '<p class="empty">기록이 없어요</p>';
  const max = rows[0][1];
  return rows.map(([k, v]) => {
    let t = type, c = k;
    if (!type) [t, c] = k.split('|');
    const col = color || `var(--s${t === '저축' ? 2 : 3})`;
    return `<div class="bar-row" data-jump="${esc(t)}|${esc(c)}"><span class="name">${esc(c)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${v / max * 100}%;background:${col}"></div></div>
      <span class="v num">${won(v)}</span>${chg(v, t + '|' + c, base, label)}</div>`;
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
    html += `<button data-day="${s}" aria-pressed="${s === state.calDay}" class="${d.getDay() === 0 || hol ? 'sun' : d.getDay() === 6 ? 'saturday' : ''}${v ? ' cl' + level(v) : ''}"
      aria-label="${d.getMonth() + 1}월 ${d.getDate()}일${hol ? ' ' + esc(hol) : ''}${v ? ' 지출 ' + won(v) : ''}"${hol ? ` title="${esc(hol)}"` : ''}>
      <span class="d ${s === t ? 'today' : ''}">${lab}</span>
      ${inc.get(s) ? `<span class="in num">+${compact(inc.get(s))}</span>` : ''}
      ${v ? `<span class="ex num">−${compact(v)}</span>` : ''}</button>`;
  }
  $('#cal').innerHTML = html;
  $('#cal-legend').innerHTML = ref ? `<span>지출 적음</span>${[1, 2, 3, 4].map(i => `<span class="cl-key cl${i}" title="${LEVELS[i - 1][1]}"></span>`).join('')}
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

// 볼 기간: 최근 1년(12개월) · 전체 · 직접 선택(시작 달 ~ 끝 달). 그래프 제목 아래 기간 글자를 누르면 펼쳐짐
function trendRangeSlice(all) {
  const ks = all.map(d => d.k), r = state.trendRange;
  if (ks.length && (!ks.includes(state.trendFrom) || !ks.includes(state.trendTo))) { // 처음이거나 범위 밖이면 최근 1년으로 채움
    state.trendTo = ks.at(-1); state.trendFrom = ks[Math.max(0, ks.length - 12)];
  }
  const fmt = k => `${k.slice(0, 4)}년 ${Number(k.slice(5))}월`;
  const opts = sel => ks.map(k => `<option value="${k}" ${k === sel ? 'selected' : ''}>${fmt(k)}</option>`).join('');
  $('#trend-range').hidden = !state.trendRangeOpen;
  $('#trend-range').innerHTML = `<div class="seg seg-3">${[['year', '최근 1년'], ['all', '전체'], ['custom', '직접 선택']]
    .map(([v, t]) => `<button data-trange="${v}" aria-pressed="${v === r}">${t}</button>`).join('')}</div>
    ${r === 'custom' && ks.length ? `<div class="range-pick"><select class="input" id="tr-from" aria-label="시작 달">${opts(state.trendFrom)}</select>
      <span>~</span><select class="input" id="tr-to" aria-label="끝 달">${opts(state.trendTo)}</select></div>` : ''}`;
  if (r === 'all') return all;
  if (r === 'year') return all.slice(-12);
  const [a, b] = [state.trendFrom, state.trendTo].sort();
  return all.filter(d => d.k >= a && d.k <= b);
}

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
  const all = monthlyTotals(type, cat); // 평소선은 범위 밖의 지난 달까지 보고 계산되도록, 자르기 전에 전체로 구함
  const data = trendRangeSlice(all);
  const H = 236, T = 26, B = 34, COL = 44, PAD = 18;
  const ph = H - T - B;
  if (!data.length) {
    $('#trend-sub').innerHTML = '';
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
  $('#trend-sub').innerHTML = `${{ year: '최근 1년', all: '전체', custom: '직접 선택' }[state.trendRange]} · ${label(data[0].k)} ~ ${label(data.at(-1).k)} · ${data.length}개월 <i>${state.trendRangeOpen ? '▴' : '▾'}</i>`;
  $('#trend-sub').setAttribute('aria-expanded', state.trendRangeOpen);

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
  box.innerHTML = `
    <div class="td-top">
      <div><p class="label" style="margin:0">${y}년 ${m}월 · ${md(r.start)} ~ ${md(r.end)}${d.peak ? '<span class="peak-badge">피크</span>' : ''}</p>
        <div class="hero num">${won(d.v)}</div></div>
      <button class="chip" data-gomonth="${d.k}">이 달 보기</button>
    </div>
    ${cat && total ? `<p class="td-cmp">이 달 ${state.trendType}의 ${Math.round(d.v / total * 100)}%</p>` : ''}
    ${top.length ? `<p class="label">${TREND_TYPES[state.trendType].top}${cat ? ` (${esc(cat)})` : ''}</p><ul class="list">${top.map(itemHtml).join('')}</ul>` : ''}`;
}

/* ================= 화면 전환 ================= */
function go(view) {
  state.view = view;
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'view-' + view));
  document.querySelectorAll('nav.tabs [data-view]').forEach(b => b.setAttribute('aria-selected', b.dataset.view === view));
  refreshAll();
}
function refreshAll() {
  if (!state.user) return;
  renderSync();
  renderTitle();
  if ($('#entry-sheet').open) renderForm();
  if (state.view === 'home') renderHome();
  if (state.view === 'record') renderRecord();
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
  const list = cats(t);
  $('#ce-list').innerHTML = list.map((c, i) => {
    const k = counts.get(c) || 0;
    const row = `<li class="ce-row">
      <span class="ce-order"><button data-cemove="${i}|-1" aria-label="${esc(c)} 위로" ${i ? '' : 'disabled'}>▲</button><button data-cemove="${i}|1" aria-label="${esc(c)} 아래로" ${i < list.length - 1 ? '' : 'disabled'}>▼</button></span>
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

// 카테고리 순서 바꾸기: 기록 화면 버튼, 한 달 탭 예산 줄 등 카테고리가 나오는 곳 모두 이 순서를 따른다
function moveCat(i, dir) {
  const t = state.ceType, list = cats(t).slice(), j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  state.settings.cats = { ...allCats(), [t]: list }; // 저장이 돌아오기 전에도 바로 보이게
  renderCats();
  saveCats(t, list);
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
  if (type === '지출') moveSpendSettings(from, to);
}
// 지출 카테고리 이름이 바뀌거나 합쳐지면 이름으로 저장해 둔 설정도 따라 바꾼다:
// 소비 리뷰에서 고른 카테고리, 달마다 정한 카테고리 예산(합치면 더함), 배지의 카테고리
function moveSpendSettings(from, to) {
  const S = state.settings, patch = {};
  const rc = reviewCfg().cats;
  if (rc && rc.includes(from)) patch.review = state.settings.review = { ...reviewCfg(), cats: [...new Set(rc.map(c => c === from ? to : c))] };
  const cb = S.catBudgets || {};
  if (Object.values(cb).some(m => m && from in m)) {
    patch.catBudgets = S.catBudgets = Object.fromEntries(Object.entries(cb).map(([k, m]) => {
      if (!m || !(from in m)) return [k, m];
      const { [from]: v, ...rest } = m; return [k, { ...rest, [to]: (rest[to] || 0) + v }];
    }));
  }
  const bg = S.badges || {};
  if (Object.values(bg).some(L => L.some(b => b.cat === from))) {
    patch.badges = S.badges = Object.fromEntries(Object.entries(bg).map(([k, L]) => [k, L.map(b => b.cat === from ? { ...b, cat: to } : b)]));
  }
  if (Object.keys(patch).length) store.saveSettings(patch).catch(err => toast('설정 저장 실패: ' + errMsg(err)));
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

/* ================= 화면 모드 · 글씨체 (이 기기에만 저장) ================= */
const FONTS = [['Poor Story', '푸어스토리'], ['Gowun Dodum', '고운돋움'], ['Gaegu', '개구'], ['Hi Melody', '하이멜로디'], ['Gamja Flower', '감자꽃'], ['Jua', '주아'], ['system', '기본 (휴대폰 글씨)']];
const THEME_BG = { light: '#FFF6EE', dark: '#221A17' };
function loadPrefs() { try { return { theme: 'system', font: 'Poor Story', ...JSON.parse(localStorage.getItem('prefs') || '{}') }; } catch { return { theme: 'system', font: 'Poor Story' }; } }
let prefs = loadPrefs();
// 구글 폰트는 고른 글씨체만, 설정을 열었을 때는 미리보기용으로 전부 불러온다
function loadFont(f) {
  const id = 'font-' + (f || 'all').replace(/\s/g, '');
  if (document.getElementById(id)) return;
  const fams = (f ? [f, 'Jua'] : FONTS.map(([x]) => x).filter(x => x !== 'system')).map(x => 'family=' + x.replace(/ /g, '+')).join('&');
  const l = document.createElement('link'); l.id = id; l.rel = 'stylesheet';
  l.href = `https://fonts.googleapis.com/css2?${fams}&display=swap`;
  document.head.appendChild(l);
}
function applyPrefs() {
  const r = document.documentElement;
  if (prefs.theme === 'system') delete r.dataset.theme; else r.dataset.theme = prefs.theme;
  if (prefs.font === 'system' || !prefs.font) { r.style.setProperty('--kfont', '"Apple SD Gothic Neo"'); loadFont('Jua'); }
  else { r.style.setProperty('--kfont', `"${prefs.font}"`); loadFont(prefs.font); }
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
    m.content = prefs.theme === 'system' ? THEME_BG[m.media.includes('dark') ? 'dark' : 'light'] : THEME_BG[prefs.theme];
  });
}
function setPref(key, value) {
  prefs = { ...prefs, [key]: value };
  try { localStorage.setItem('prefs', JSON.stringify(prefs)); } catch { /* 저장 못 해도 지금 화면엔 적용 */ }
  applyPrefs(); renderPrefs();
  if (state.view === 'trend') renderTrend(); // 그래프 글자 폭이 바뀔 수 있어서
}
function renderPrefs() {
  $('#s-theme').innerHTML = [['system', '기기 설정 따라'], ['light', '항상 밝게'], ['dark', '항상 어둡게']]
    .map(([v, t]) => `<button data-pref="theme|${v}" aria-pressed="${prefs.theme === v}">${t}</button>`).join('');
  $('#s-font').innerHTML = FONTS.map(([f, t]) => `<button class="font-opt" data-pref="font|${f}" aria-pressed="${prefs.font === f}"
    style="font-family:${f !== 'system' ? `'${f}',` : ''}'Apple SD Gothic Neo',sans-serif">${t}<small>오늘 쓴 돈 12,000원</small></button>`).join('');
}
applyPrefs();

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
  state.moodEdit = null; moodInput('bad').value = moodInput('good').value = '';
  renderReviewCats(); renderMoodSettings();
  $('#s-import-msg').textContent = '';
  loadFont(); renderPrefs();
  setPage(''); // 늘 묶음 목록부터
  $('#settings').showModal(); document.activeElement.blur(); // 닫기(✕) 버튼에 포커스 테두리가 생기지 않게
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
$('#trend-range').addEventListener('change', ev => {
  if (ev.target.id === 'tr-from') state.trendFrom = ev.target.value;
  if (ev.target.id === 'tr-to') state.trendTo = ev.target.value;
  saveTrendRange();
  state.trendSel = null; state.trendScrolled = false; renderTrend();
});
$('#trend-chart').addEventListener('click', ev => {
  const r = ev.target.closest('[data-tm]'); if (!r) return;
  state.trendSel = state.trendSel === r.dataset.tm ? null : r.dataset.tm;
  renderTrend();
});
document.addEventListener('click', ev => {
  const b = ev.target.closest('button, .item, .bar-row, .cb-head, .pie [data-jump], .pie [data-pieetc], [data-bcheck], [data-bmatch]'); if (!b) return;
  const d = b.dataset;
  if (d.view) { if (b.closest('dialog')) b.closest('dialog').close(); return go(d.view); }
  if (d.lookback !== undefined) { state.period = periodOfDate(today()); go('month'); return $('#lookback').scrollIntoView({ behavior: 'smooth', block: 'start' }); } // 홈 상태 카드 → 이번 달 돌아보기
  if (d.type) { state.type = d.type; state.category = cats(d.type)[0]; return renderForm(); }
  if (d.cat) { state.category = d.cat; return renderForm(); }
  if (d.detail) { $('#f-detail').value = d.detail; return $('#f-amount').focus(); }
  if (d.calctoggle !== undefined) return toggleCalc();
  if (d.ck) return calcKey(d.ck);
  if (d.split) return calcSplit(Number(d.split));
  if (d.calcok !== undefined) return calcApply();
  if (d.add !== undefined) { setAmount(d.add === '0' ? 0 : amountValue() + Number(d.add)); return; }
  if (d.shift) { state.date = addDays($('#f-date').value || today(), Number(d.shift)); return renderForm(); }
  if (d.pickmonth !== undefined) return openMonthPicker();
  if (d.budget !== undefined) return openBudget();
  if (d.budgetok !== undefined) return saveBudget();
  if (d.budopen !== undefined) { state.budOpen = !state.budOpen; return renderMonth(); }
  if (d.budsplit !== undefined) { applyBudgetInput(); setBudgetTotal(sumOf(state.budDraft) || Number($('#b-slider').value), true); return toast('카테고리마다 똑같이 나눴어요'); }
  if (d.goal !== undefined) return openGoal();
  if (d.badgeedit !== undefined) return openBadgeEditor();
  if (d.badgeall !== undefined) return openEarned();
  if (d.recapclose !== undefined) { try { localStorage.setItem('recapSeen', periodOfDate(today())); } catch { /* 무시 */ } return renderHome(); }
  if (d.bemove) { const [i, dir] = d.bemove.split('|').map(Number), L = state.badgeDraft, j = i + dir; if (j >= 0 && j < L.length) [L[i], L[j]] = [L[j], L[i]]; return renderBadgeEditor(); }
  if (d.bedel !== undefined) { state.badgeDraft.splice(Number(d.bedel), 1); return renderBadgeEditor(); }
  if (d.beedit !== undefined) return openBadgeMaker(Number(d.beedit));
  if (d.berec !== undefined) { const { why, ...r } = state.badgeRecs[Number(d.berec)]; state.badgeDraft.push({ ...r, id: newId(), origin: 'rec' }); return renderBadgeEditor(); }
  if (d.bemake !== undefined) return openBadgeMaker();
  if (d.besave !== undefined) return saveBadgeEditor();
  if (d.bmkind) { state.maker.kind = d.bmkind; const lv = makerLevels({ ...state.maker, unit: BADGE_KINDS[d.bmkind].units[0] }); state.maker.unit = BADGE_KINDS[d.bmkind].units[0]; if (lv) state.maker.n = lv[1]; return renderBadgeMaker(); }
  if (d.bmcat !== undefined) { state.maker.cat = d.bmcat; const lv = makerLevels(state.maker); if (lv) state.maker.n = lv[1]; return renderBadgeMaker(); }
  if (d.bmunit) { state.maker.unit = d.bmunit; const lv = makerLevels(state.maker); if (lv) state.maker.n = lv[1]; return renderBadgeMaker(); }
  if (d.bmlv) { state.maker.n = Number(d.bmlv); return renderBadgeMaker(); }
  if (d.bmcolor) { state.maker.color = d.bmcolor; return renderBadgeMaker(); }
  if (d.bcheck !== undefined) return openBadgeCheck(Number(d.bcheck));
  if (d.bmatch !== undefined) return openBadgeMatch(Number(d.bmatch));
  if (d.bmx) return toggleExclude(d.bmx);
  if (d.bmwordadd !== undefined) return addMakerWord($('#bm-word-in').value);
  if (d.bmwordsug !== undefined) return addMakerWord(d.bmwordsug);
  if (d.bmworddel !== undefined) { state.maker.words.splice(Number(d.bmworddel), 1); return renderBadgeMaker(); }
  if (d.bmdir) { state.maker.dir = d.bmdir; return renderBadgeMaker(); }
  if (d.bcstep) return badgeCheckStep(Number(d.bcstep));
  if (d.bcadd) { const el = $('#bc-amt'), n = (Number(el.value.replace(/[^\d]/g, '')) || 0) + Number(d.bcadd); el.value = n.toLocaleString('ko-KR'); return; }
  if (d.bmsave !== undefined) return saveBadgeMaker();
  if (d.goalok !== undefined) return saveGoal();
  if (d.review !== undefined) return openReview();
  if (d.feel) return answerReview(d.feel);
  if (d.mood) { keepMemo(); state.rvSel.mood = state.rvSel.mood === d.mood ? '' : d.mood; return renderReview(); }
  if (d.moodmemo !== undefined) { state.rvSel.open = true; state.rvMemoFocus = true; return renderReview(); }
  if (d.moodok !== undefined) return saveMood();
  if (d.rvlater !== undefined) { state.rvI++; state.rvLater++; state.rvSel = null; return renderReview(); } // 이 항목만 건너뛰고 다음으로 (저장 안 함 → 다음에 다시 나옴)
  if (d.held !== undefined) return openHeld(d.held);
  if (d.heldok !== undefined) return saveHeld();
  if (d.hcat !== undefined) { state.heldCat = state.heldCat === d.hcat ? '' : d.hcat; return renderHeldCats(); }
  if (d.helddel !== undefined) return removeHeld();
  if (d.rvcat !== undefined) return toggleReviewCat(d.rvcat);
  if (d.pickok !== undefined) {
    const y = parseInt($('#mp-y').children[wheelIndex($('#mp-y'))].textContent), m = wheelIndex($('#mp-m')) + 1;
    $('#month-picker').close(); state.period = `${y}-${String(m).padStart(2, '0')}`; state.calDay = null; return refreshAll();
  }
  if (d.pshift) { state.period = shiftPeriod(state.period, Number(d.pshift)); state.calDay = null; return refreshAll(); }
  if (d.trendtype) { state.trendType = d.trendtype; state.trendCat = ''; state.trendSel = null; state.trendScrolled = false; return renderTrend(); }
  if (d.trangetoggle !== undefined) { state.trendRangeOpen = !state.trendRangeOpen; return renderTrend(); }
  if (d.trange) { state.trendRange = d.trange; saveTrendRange(); state.trendSel = null; state.trendScrolled = false; return renderTrend(); }
  if (d.trendcat !== undefined) { state.trendCat = d.trendcat; return renderTrend(); }
  if (d.addday) return addOnDay(d.addday);
  if (d.gomonth) { state.period = d.gomonth; state.calDay = null; return go('month'); }
  if (d.day) { state.calDay = state.calDay === d.day ? null : d.day; return renderCalendar(); }
  if (d.jump) { [state.fltType, state.fltCat] = d.jump.split('|'); state.q = ''; $('#flt-q').value = ''; return go('list'); }
  if (d.id) return startEdit(d.id);
  if (d.close !== undefined) return b.closest('dialog').close();
  if (d.cetype) { state.ceType = d.cetype; state.ceDelete = null; return renderCats(); }
  if (d.cedel) return deleteCat(d.cedel);
  if (d.rvadd !== undefined) { setRvMin(d.rvadd === '0' ? 0 : rvMinValue() + Number(d.rvadd)); return saveReviewCfg({ min: rvMinValue() }); }
  if (d.setok !== undefined) return applySettings();
  if (d.setpage) return setPage(d.setpage);
  if (d.setback !== undefined) return $('#set-menu').hidden ? setPage('') : $('#settings').close();
  if (d.pieetc) { state.pieEtc = !state.pieEtc; return renderMonth(); }
  if (d.lookfold) { state.lookOpen = state.lookOpen === d.lookfold ? null : d.lookfold; return renderMonth(); }
  if (d.ffeel !== undefined) { if (state.formFeel !== d.ffeel) state.formMood = ''; state.formFeel = d.ffeel || 'none'; return renderFormFeel(); }
  if (d.fmood !== undefined) { state.formMood = state.formMood === d.fmood ? '' : d.fmood; return renderFormFeel(); }
  if (d.mooddel !== undefined) { const [k, i] = d.mooddel.split('|'); return removeMood(k, Number(i)); }
  if (d.moodedit !== undefined) { const [k, i] = d.moodedit.split('|'); return editMood(k, Number(i)); }
  if (d.moodcancel !== undefined) return cancelMoodEdit(b.closest('[data-moodbox]').dataset.moodbox);
  if (d.moodadd !== undefined) return addMood(b.closest('[data-moodbox]').dataset.moodbox);
  if (d.pref) { const [k, v] = d.pref.split('|'); return setPref(k, v); }
  if (d.cemove) { const [i, dir] = d.cemove.split('|').map(Number); return moveCat(i, dir); }
  switch (b.id) {
    case 'submit': return submit();
    case 'cancel': resetForm(); return $('#entry-sheet').close();
    case 'open-entry': return openEntry();
    case 'del': return removeEditing();
    case 'open-settings': return openSettings();
    case 'open-export': return openExport();
    case 'open-cats': $('#cat-editor').classList.toggle('full', $('#settings').open); return openCats(); // 설정에서 열면 설정 위에 전체 화면으로, 닫으면 설정으로 돌아감
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
$('#s-rv-min').addEventListener('input', () => setRvMin(rvMinValue()));
$('#s-rv-min').addEventListener('change', () => saveReviewCfg({ min: rvMinValue() }));
$('#s-rv-min').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
$('#s-rv-days').addEventListener('change', e => saveReviewCfg({ days: Number(e.target.value) }));
$('#g-text').addEventListener('keydown', e => { if (e.key === 'Enter') saveGoal(); });
$('#bm-n-in').addEventListener('input', e => makerNumInput(e.target));
$('#bm-word-in').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addMakerWord(e.target.value); } });
$('#bm-icon-in').addEventListener('input', e => { state.maker.icon = e.target.value.trim() || undefined; renderBadgeMaker(); });
$('#bc-amt').addEventListener('input', e => { const n = Number(e.target.value.replace(/[^\d]/g, '')); e.target.value = n ? n.toLocaleString('ko-KR') : ''; });
$('#bm-title').addEventListener('input', e => { state.maker.title = e.target.value; $('#bm-prev').innerHTML = `${badgeHtml(state.maker, { fill: 1, done: true })}<span><b>${esc(badgeName({ ...state.maker, title: e.target.value.trim() }))}</b><small>이번 달 안에 이루면 받아요</small></span>`; });
for (const kind of ['bad', 'good']) moodInput(kind).addEventListener('keydown', e => { if (e.key === 'Enter') addMood(kind); });
$('#f-amount').addEventListener('input', () => setAmount(amountValue()));
$('#budget-editor').addEventListener('pointerdown', budDragStart);
$('#b-amount').addEventListener('input', e => { const n = Number(e.target.value.replace(/[^\d]/g, '')); e.target.value = n ? n.toLocaleString('ko-KR') : ''; $('#b-slider').value = n; paintBudgetSlider(); });
$('#b-amount').addEventListener('change', e => setBudgetTotal(Number(e.target.value.replace(/[^\d]/g, '')) || 0));
$('#b-slider').addEventListener('input', e => setBudgetTotal(Number(e.target.value)));
$('#b-slider').addEventListener('change', e => { const sl = e.target; if (Number(sl.value) >= Number(sl.max)) { sl.max = catScale(Number(sl.max), 0, 0); paintBudgetSlider(); renderTotalScale(); } });
$('#b-amount').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
$('#f-amount').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
$('#flt-type').addEventListener('change', e => { state.fltType = e.target.value; renderList(); });
$('#flt-cat').addEventListener('change', e => { state.fltCat = e.target.value; renderList(); });
$('#flt-q').addEventListener('input', e => { state.q = e.target.value; renderList(); });
$('#s-payday').addEventListener('change', e => {
  store.saveSettings({ payday: Number(e.target.value) }).catch(err => toast('설정 저장 실패: ' + errMsg(err)));
  toast('한 달 시작일을 바꿨어요');
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
  state.settings = data.settings; state.pending = data.pending; state.settingsReady = data.settingsReady;
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
    go(hash.get('tab') && hash.get('tab') !== 'add' ? hash.get('tab') : hash.get('day') ? 'record' : 'home');
    if (hash.get('day')) { state.calDay = hash.get('day'); refreshAll(); }
  });
}).catch(err => {
  document.body.classList.remove('booting');
  document.body.innerHTML = `<p class="empty" style="padding:40px 16px">앱을 불러오지 못했어요: ${esc(errMsg(err))}</p>`;
});

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');

// 홈 화면에 추가한 앱은 완전히 닫지 않으면 예전 화면이 그대로 남는다.
// 앱으로 다시 돌아올 때 서버의 app.js가 바뀌었으면(새 버전을 올렸으면) 새로고침한다. 입력 창이 열려 있으면 건드리지 않음.
const versionTag = () => fetch('app.js', { method: 'HEAD', cache: 'no-store' })
  .then(r => r.ok ? r.headers.get('etag') || r.headers.get('last-modified') : null).catch(() => null);
let loadedTag = null;
versionTag().then(t => { loadedTag = t; });
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !loadedTag) return;
  const t = await versionTag();
  if (t && t !== loadedTag && !document.querySelector('dialog[open]')) location.reload();
});

/**
 * 데이터 저장소
 *
 * - firebase-config.js가 채워져 있으면: 구글 로그인 + Firestore 클라우드 동기화
 *   저장 구조: users/{uid}                 → 설정 { payday, cats }
 *             users/{uid}/months/{YYYY-MM} → { entries: { [id]: 기록 } }  (한 달 기록을 문서 하나에 모음)
 *   오프라인에서 입력해도 기기에 먼저 저장되고, 연결되면 자동으로 올라간다.
 * - 비어 있으면: 데모 모드 (이 브라우저의 localStorage에만 저장)
 *
 * 두 저장소는 같은 모양의 함수를 제공한다:
 *   onAuth(cb) · signIn() · signOut() · listen(onData) · save(entry, prev) · remove(entry)
 *   importMany(rows) · moveEntries(entries, category) · saveSettings(settings) · exportToSheet(title, rows)
 */

const FIREBASE_VERSION = '11.0.2';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/drive.file'; // 앱이 만든 파일에만 접근하는 최소 권한

function createStore() {
  const cfg = window.FIREBASE_CONFIG;
  return cfg && cfg.apiKey ? firebaseStore(cfg) : Promise.resolve(demoStore());
}

const monthOf = e => e.date.slice(0, 7);
const pick = e => ({ date: e.date, type: e.type, category: e.category, detail: e.detail || '', amount: Number(e.amount) || 0, memo: e.memo || '', ...(e.feel ? { feel: e.feel } : {}) });

async function firebaseStore(cfg) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${base}/firebase-app.js`), import(`${base}/firebase-auth.js`), import(`${base}/firebase-firestore.js`),
  ]);
  const app = initializeApp(cfg);
  const auth = A.getAuth(app);
  const db = F.initializeFirestore(app, {
    localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }),
  });
  let uid = null, unsubs = [];
  const monthDoc = ym => F.doc(db, 'users', uid, 'months', ym);

  return {
    demo: false,

    onAuth(cb) {
      A.onAuthStateChanged(auth, u => {
        uid = u ? u.uid : null;
        if (!u) { unsubs.forEach(f => f()); unsubs = []; }
        cb(u && { uid: u.uid, email: u.email, name: u.displayName });
      });
    },

    async signIn() {
      const provider = new A.GoogleAuthProvider();
      try { await A.signInWithPopup(auth, provider); }
      catch (err) {
        if (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment') {
          return A.signInWithRedirect(auth, provider);
        }
        if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') throw err;
      }
    },

    signOut: () => A.signOut(auth),

    listen(onData) {
      unsubs.forEach(f => f());
      const months = new Map();
      let settings = { payday: 25 }, pending = false;
      const emit = () => onData({ entries: [...months.values()].flat(), settings, pending });
      unsubs = [
        F.onSnapshot(F.collection(db, 'users', uid, 'months'), { includeMetadataChanges: true }, snap => {
          snap.docChanges().forEach(ch => {
            if (ch.type === 'removed') return months.delete(ch.doc.id);
            const map = ch.doc.data().entries || {};
            months.set(ch.doc.id, Object.keys(map).map(id => ({ ...map[id], id })));
          });
          pending = snap.metadata.hasPendingWrites;
          emit();
        }),
        F.onSnapshot(F.doc(db, 'users', uid), d => { settings = { payday: 25, ...(d.data() || {}) }; emit(); }),
      ];
    },

    save(e, prev) {
      const batch = F.writeBatch(db);
      batch.set(monthDoc(monthOf(e)), { entries: { [e.id]: pick(e) } }, { merge: true });
      if (prev && monthOf(prev) !== monthOf(e)) {
        batch.update(monthDoc(monthOf(prev)), new F.FieldPath('entries', e.id), F.deleteField());
      }
      return batch.commit();
    },

    remove(e) {
      return F.updateDoc(monthDoc(monthOf(e)), new F.FieldPath('entries', e.id), F.deleteField());
    },

    async importMany(rows) {
      const byMonth = new Map();
      for (const e of rows) {
        if (!byMonth.has(monthOf(e))) byMonth.set(monthOf(e), {});
        byMonth.get(monthOf(e))[e.id] = pick(e);
      }
      const months = [...byMonth];
      for (let i = 0; i < months.length; i += 400) { // 배치 한 번에 최대 500건
        const batch = F.writeBatch(db);
        months.slice(i, i + 400).forEach(([ym, entries]) => batch.set(monthDoc(ym), { entries }, { merge: true }));
        await batch.commit();
      }
    },

    // 카테고리 이름 바꾸기·합치기·삭제할 때 기존 기록의 카테고리를 옮긴다. 한 달 문서당 쓰기 1번.
    async moveEntries(list, category) {
      const byMonth = new Map();
      for (const e of list) {
        if (!byMonth.has(monthOf(e))) byMonth.set(monthOf(e), []);
        byMonth.get(monthOf(e)).push(new F.FieldPath('entries', e.id, 'category'), category);
      }
      const months = [...byMonth];
      for (let i = 0; i < months.length; i += 400) {
        const batch = F.writeBatch(db);
        months.slice(i, i + 400).forEach(([ym, pairs]) => batch.update(monthDoc(ym), ...pairs));
        await batch.commit();
      }
    },

    saveSettings: s => F.setDoc(F.doc(db, 'users', uid), s, { merge: true }),

    // 사용자 본인의 구글 드라이브에 새 스프레드시트를 만든다. 버튼을 누른 직후에 호출해야 팝업이 막히지 않는다.
    async exportToSheet(title, rows) {
      const provider = new A.GoogleAuthProvider();
      provider.addScope(SHEETS_SCOPE);
      provider.setCustomParameters({ login_hint: auth.currentUser.email });
      const res = await A.reauthenticateWithPopup(auth.currentUser, provider);
      const token = A.GoogleAuthProvider.credentialFromResult(res).accessToken;
      const call = async (url, method, body) => {
        const r = await fetch(url, {
          method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const json = await r.json();
        if (!r.ok) throw new Error((json.error && json.error.message) || r.statusText);
        return json;
      };
      const sheet = await call('https://sheets.googleapis.com/v4/spreadsheets', 'POST', {
        properties: { title, locale: 'ko_KR', timeZone: 'Asia/Seoul' },
        sheets: [{ properties: { title: '내역', gridProperties: { frozenRowCount: 1 } } }],
      });
      await call(`https://sheets.googleapis.com/v4/spreadsheets/${sheet.spreadsheetId}/values/${encodeURIComponent('내역!A1')}?valueInputOption=RAW`,
        'PUT', { values: rows });
      return sheet.spreadsheetUrl;
    },
  };
}

function demoStore() {
  const KEY = 'mooni.demo';
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* 저장소 차단 */ }
  db = db || { entries: demoEntries(), settings: { payday: 25 } };
  let listener = () => {};
  const commit = () => {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* 저장소 차단 */ }
    listener({ entries: db.entries.slice(), settings: { ...db.settings }, pending: false });
    return Promise.resolve();
  };
  return {
    demo: true,
    onAuth: cb => cb({ uid: 'demo', email: '데모 모드 (이 브라우저에만 저장)' }),
    signIn: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
    listen(onData) { listener = onData; commit(); },
    save(e) { db.entries = db.entries.filter(x => x.id !== e.id).concat({ ...pick(e), id: e.id }); return commit(); },
    remove(e) { db.entries = db.entries.filter(x => x.id !== e.id); return commit(); },
    importMany(rows) { db.entries.push(...rows.map(e => ({ ...pick(e), id: e.id }))); return commit(); },
    moveEntries(list, category) {
      const ids = new Set(list.map(e => e.id));
      db.entries = db.entries.map(e => ids.has(e.id) ? { ...e, category } : e);
      return commit();
    },
    saveSettings(s) { db.settings = { ...db.settings, ...s }; return commit(); },
    exportToSheet: () => Promise.reject(new Error('데모 모드에서는 구글 스프레드시트로 내보낼 수 없어요')),
  };
}

// 데모 모드 첫 화면용 예시 데이터
function demoEntries() {
  const out = []; let seed = 7;
  const rnd = n => { seed = (seed * 16807) % 2147483647; return seed % n; };
  const pad = n => String(n).padStart(2, '0');
  for (let back = 75; back >= 0; back--) {
    const d = new Date(); d.setDate(d.getDate() - back);
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const add = (type, category, detail, amount) => out.push({ id: 'demo' + out.length, date, type, category, detail, amount, memo: '' });
    if (d.getDate() === 25) {
      add('수입', '월급', '월급', 2850000); add('저축', '적금', '청년도약계좌', 700000);
      add('저축', '청약', '청약', 100000); add('투자', 'ETF', 'S&P500', 300000);
      add('지출', '통신비', '통신비', 45000); add('지출', '월세', '월세', 450000);
    }
    add('지출', '식비', ['점심', '저녁', '밥'][rnd(3)], 8000 + rnd(8) * 1000);
    if (rnd(2)) add('지출', rnd(2) ? '간식' : '카공', rnd(2) ? '카페' : '빵', 3000 + rnd(5) * 1000);
    if (!rnd(5)) add('지출', '교통비', '택시', 9000 + rnd(10) * 1000);
    if (!rnd(12)) add('지출', ['의류', '생필품', '취미/문화생활', '미용'][rnd(4)], '쇼핑', 20000 + rnd(8) * 10000);
  }
  return out;
}

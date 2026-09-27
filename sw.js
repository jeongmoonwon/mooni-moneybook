// 앱 파일을 기기에 저장해 두어 인터넷이 없어도 앱이 열리게 한다.
// 항상 새 버전을 먼저 받아보고, 실패할 때만 저장된 파일을 쓴다. (기록 데이터 동기화는 Firestore가 따로 처리)
const CACHE = 'mooni-app';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const mine = url.origin === location.origin || url.host === 'www.gstatic.com'; // 앱 파일 + Firebase 라이브러리
  if (e.request.method !== 'GET' || !mine) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});

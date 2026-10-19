/* Diem の読み込み係
   ・いつもサーバーを先に見に行き、取れたときだけ控えを入れ替えます（つながらないときは控えを出す）
   ・res.ok を必ず見ます。見ないと、エラー画面そのものを控えてしまいます */
var VERSION = 'diem-359e09b5';
// ★同じ住所（kodai0625.github.io）には、ほかのアプリや、もう1つの Diem の控えも置かれている。
//   消すのは「自分の名前で始まる古い控え」だけ。全部消すと、ほかのアプリが電波なしで開けなくなる
var PREFIX = VERSION.slice(0, VERSION.indexOf('-') + 1);

self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) {
      return (k !== VERSION && k.indexOf(PREFIX) === 0) ? caches.delete(k) : null;
    }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || caches.match('./index.html');
      });
    })
  );
});

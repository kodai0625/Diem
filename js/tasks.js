/* Diem  Task Board のタスクを読む（見るだけ）

   ・個人の分（space 'personal'）は、取り込みを入れたらいつも読む
   ・会社の分（space 'work'）は、設定の「会社のタスクも出す」が入のときだけ読む（2026-09-30 に ko-dai さんの指示で追加）
     ★どちらの側のものかの印（side）を付けて持ち、画面でも見分けられるようにする
   ・★取ったものは共有の箱（送信箱）に入れない。この端末の中だけに置く＝一緒に使う相手には、個人も会社も出ない
   ・出すのは「やる日か期限があって、まだ終わっていないタスク」。メモと、くり返しのタスク（習慣）は出さない
     ★出す日は Task Board の予定の画面と同じ決め方：**やる日（doOn）があればやる日、なければ期限（due）の日**。
       時刻（time・dur）があれば時刻も持つ（2026-09-30。Task Board に「やる日」が増えたのに合わせた）
   ・直すのは Task Board 側。こちらは読むだけ

   2026-09-30 に作り直した点
   ・受け口の返事がときどき崩れるので、送り方は同期と同じもの（崩れたら2回まで送り直す）を使う
   ・個人と会社を**別々に**読んで、別々に持つ。片方が失敗しても、もう片方は取り込む。
     失敗した側は、前に取れた分を消さずに残す（崩れた返事で、タスクが全部消えて見えないように） */
(function (global) {
  'use strict';
  var PB = global.PB = global.PB || {};

  var KEY = 'diem.tasks';         // 予定（diem.data）とは別の入れ物にする
  var SIDES = { personal: '個人', work: '会社' };   // Task Board の受け口の側 → 画面での呼び名
  var Store = null;
  var cache = null;               // { v: 2, sides: { personal: { items: [...], at: 時刻 }, work: {...} } }
  var busy = false;
  var timer = null;

  function empty() { return { v: 3, sides: {} }; }

  function load() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || 'null');
      cache = (v && v.v === 3 && v.sides) ? v : empty();   // 前の形は捨てて、次の取り込みで作り直す
    } catch (e) { cache = empty(); }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) {}
  }

  function conf() {
    var m = Store.meta();
    return { url: (m.taskUrl || '').trim(), pin: (m.taskPin || '').trim() };
  }

  function enabled() {
    var c = conf();
    return !!c.url && !!c.pin;
  }

  /** 会社の分も読むか（設定で切れる。はじめは入） */
  function wantWork() { return Store.meta().taskWork !== false; }

  /** 読む側の一覧。個人はいつも、会社は入のときだけ */
  function sides() { return wantWork() ? ['personal', 'work'] : ['personal']; }

  /* ---------- 受け口とのやりとり（送り方は同期と同じ。崩れた返事は送り直す） ---------- */

  function pull(side) {
    var c = conf();
    return PB.Sync.request(c.url, { pin: c.pin, action: 'pull', space: side, since: 0 });
  }

  /* ---------- 取ったものを、出す形に絞る ---------- */

  function itemsOf(rows, side) {
    var out = [];
    (rows || []).forEach(function (row) {
      if (row.kind !== 'task') return;          // メモは出さない
      if (row.deleted) return;
      var t;
      try { t = JSON.parse(row.json); } catch (e) { return; }
      if (!t || t.done) return;                 // 終わったものは出さない
      if (t.repeat) return;                     // くり返し（習慣）は日が決まっていないので出さない
      var day = t.doOn || t.due;                // ★やる日があればやる日、なければ期限（Task Board の予定の画面と同じ）
      if (!day) return;                         // 日の無いものは出さない
      // ★出すのに要るものだけ残す（メモ本文などは持たない）
      out.push({ id: side + ':' + row.id, side: side, day: day,
                 by: t.doOn ? 'do' : 'due',     // どちらの日で出しているか
                 title: String(t.title || t.text || '（題名なし）'),
                 due: t.due || '', time: t.time || '', dur: Number(t.dur) || 0,
                 prio: t.prio || t.priority || '' });
    });
    return out;
  }

  /** いま出してよい側の、全部のタスク */
  function all() {
    var out = [];
    ['personal', 'work'].forEach(function (side) {
      if (side === 'work' && !wantWork()) return;
      var s = cache && cache.sides[side];
      if (s && s.items) out = out.concat(s.items);
    });
    return out;
  }

  var Tasks = {
    lastError: '',

    init: function (store) {
      Store = store;
      load();
    },

    enabled: enabled,
    wantWork: wantWork,
    sideName: function (side) { return SIDES[side] || SIDES.personal; },

    /** その日のタスク（個人 → 会社の順、その中は題名の順） */
    on: function (dateStr) {
      if (!enabled()) return [];
      return all().filter(function (t) { return t.day === dateStr; }).sort(function (a, b) {
        if (a.side !== b.side) return a.side === 'personal' ? -1 : 1;
        var ta = a.time || '99', tb = b.time || '99';      // 時刻のあるものを先に、早い順
        if (ta !== tb) return ta < tb ? -1 : 1;
        return (a.title < b.title) ? -1 : 1;
      });
    },

    count: function (side) {
      return all().filter(function (t) { return !side || t.side === side; }).length;
    },

    lastAt: function () {
      var at = 0;
      Object.keys((cache && cache.sides) || {}).forEach(function (k) { at = Math.max(at, cache.sides[k].at || 0); });
      return at;
    },

    /** 取り直す。側ごとに読み、うまくいった側だけ入れ替える */
    run: function (force) {
      if (!enabled()) return Promise.resolve({ skipped: 'off' });
      if (busy) return Promise.resolve({ skipped: 'busy' });
      busy = true;
      var list = sides();
      return Promise.all(list.map(function (side) {
        return pull(side).then(
          function (res) { return { side: side, ok: true, rows: res.rows }; },
          function (err) { return { side: side, ok: false, err: err }; });
      })).then(function (results) {
        results.forEach(function (r) {
          if (r.ok) cache.sides[r.side] = { items: itemsOf(r.rows, r.side), at: Date.now() };
        });
        if (!wantWork()) delete cache.sides.work;     // 切のときは、会社の分を持っておかない
        save();
        var bad = results.filter(function (r) { return !r.ok; });
        Tasks.lastError = bad.map(function (r) {
          return SIDES[r.side] + 'の分：' + ((r.err && r.err.message) || '読めませんでした');
        }).join('／');
        busy = false;
        Tasks.onData && Tasks.onData();
        if (force && bad.length) throw new Error(Tasks.lastError);
        return { count: Tasks.count(), failed: bad.length };
      });
    },

    /** つながるか確かめるだけ */
    test: function (url, pin) {
      return PB.Sync.test(url, pin).catch(function (e) {
        if (/返事が読めません/.test(e.message)) {
          throw new Error('返事が読めません。Task Board の受け口のURLか確かめてください');
        }
        throw e;
      });
    },

    /** 取り込みをやめる（溜めたものも消す） */
    clear: function () {
      cache = empty();
      save();
    },

    start: function () {
      if (timer) clearInterval(timer);
      timer = setInterval(function () { Tasks.run(false); }, 5 * 60 * 1000);   // 5分ごと
      global.addEventListener('visibilitychange', function () {
        if (!document.hidden) Tasks.run(false);
      });
      Tasks.run(false);
    }
  };

  PB.Tasks = Tasks;
})(window);

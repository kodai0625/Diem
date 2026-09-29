/* Diem  Task Board のタスクを読む（見るだけ）

   ・個人の分（space 'personal'）は、取り込みを入れたらいつも読む
   ・会社の分（space 'work'）は、設定の「会社のタスクも出す」が入のときだけ読む（2026-09-30 に ko-dai さんの指示で追加）
     ★どちらも、どちらの側のものかの印（side）を付けて持ち、画面でも見分けられるようにする
   ・★取ったものは共有の箱（送信箱）に入れない。この端末の中だけに置く＝一緒に使う相手には、個人も会社も出ない
   ・出すのは「期限があって、まだ終わっていないタスク」だけ。メモは出さない
   ・直すのは Task Board 側。こちらは読むだけ */
(function (global) {
  'use strict';
  var PB = global.PB = global.PB || {};

  var KEY = 'diem.tasks';         // 予定（diem.data）とは別の入れ物にする
  var SIDES = {                   // Task Board の受け口の側 → 画面での呼び名
    personal: '個人',
    work: '会社'
  };
  var Store = null;
  var cache = null;               // { since: 0, byDate: { 'YYYY-MM-DD': [ {...} ] }, at: 0 }
  var busy = false;
  var timer = null;

  function load() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || 'null');
      cache = (v && typeof v === 'object' && v.byDate) ? v : { since: 0, byDate: {}, at: 0 };
    } catch (e) { cache = { since: 0, byDate: {}, at: 0 }; }
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

  /* ---------- 受け口とのやりとり ---------- */

  function post(payload) {
    var c = conf();
    return fetch(c.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    }).catch(function () {
      throw new Error('つながりませんでした（電波かURLを確かめてください）');
    }).then(function (r) { return r.text(); }).then(function (t) {
      var obj;
      try { obj = JSON.parse(t); }
      catch (e) { throw new Error('返事が読めません（URLが違うかもしれません）'); }
      if (!obj.ok) {
        throw new Error({
          bad_pin: '合言葉が違います',
          locked: 'まちがいが続いたので、しばらく止まっています',
          not_setup: 'Task Board 側の用意がまだです',
          bad_space: '取りに行く先が違います'
        }[obj.error] || (obj.error || '断られました'));
      }
      return obj;
    });
  }

  /** 全部を取り直す。差分だけだと「終わった」「消した」を取りこぼすため */
  /** 会社の分も読むか（設定で切れる。はじめは入） */
  function wantWork() { return Store.meta().taskWork !== false; }

  /** 読む側の一覧。個人はいつも、会社は入のときだけ */
  function sides() { return wantWork() ? ['personal', 'work'] : ['personal']; }

  /** 1つの側を全部取り直す。差分だけだと「終わった」「消した」を取りこぼすため */
  function fetchSide(side) {
    return post({ pin: conf().pin, action: 'pull', space: side, since: 0 })
      .then(function (res) { return { side: side, rows: res.rows || [] }; });
  }

  /* ---------- 取ったものを、出す形に絞る ---------- */

  function rebuild(sets) {
    var byDate = {};
    sets.forEach(function (set) {
    set.rows.forEach(function (row) {
      if (row.kind !== 'task') return;          // メモは出さない
      if (row.deleted) return;
      var t;
      try { t = JSON.parse(row.json); } catch (e) { return; }
      if (!t || !t.due) return;                 // ★期限のあるものだけ
      if (t.done) return;                       // 終わったものは出さない
      // ★出すのに要るものだけ残す（メモ本文などは持たない）
      var item = { id: set.side + ':' + row.id, side: set.side,
                   title: String(t.title || t.text || '（題名なし）'), due: t.due, prio: t.prio || t.priority || '' };
      (byDate[t.due] = byDate[t.due] || []).push(item);
    });
    });
    // 同じ日の中は、個人 → 会社の順、その中は題名の順
    Object.keys(byDate).forEach(function (d) {
      byDate[d].sort(function (a, b) {
        if (a.side !== b.side) return a.side === 'personal' ? -1 : 1;
        return (a.title < b.title) ? -1 : 1;
      });
    });
    return byDate;
  }

  var Tasks = {
    lastError: '',

    init: function (store) {
      Store = store;
      load();
    },

    enabled: enabled,

    /** その日のタスク（無ければ空） */
    on: function (dateStr) {
      if (!enabled()) return [];
      return (cache && cache.byDate[dateStr]) || [];
    },

    count: function (side) {
      if (!cache) return 0;
      var n = 0;
      Object.keys(cache.byDate).forEach(function (d) {
        cache.byDate[d].forEach(function (t) {
          if (!side || (t.side || 'personal') === side) n++;
        });
      });
      return n;
    },

    wantWork: wantWork,
    sideName: function (side) { return SIDES[side] || SIDES.personal; },

    lastAt: function () { return (cache && cache.at) || 0; },

    /** 取り直す */
    run: function (force) {
      if (!enabled()) return Promise.resolve({ skipped: 'off' });
      if (busy) return Promise.resolve({ skipped: 'busy' });
      busy = true;
      return Promise.all(sides().map(fetchSide)).then(function (sets) {
        cache.byDate = rebuild(sets);
        cache.at = Date.now();
        save();
        Tasks.lastError = '';
        busy = false;
        Tasks.onData && Tasks.onData();
        return { count: Tasks.count() };
      }).catch(function (e) {
        busy = false;
        Tasks.lastError = e.message || String(e);
        if (force) throw e;
        return { error: Tasks.lastError };
      });
    },

    /** つながるか確かめるだけ */
    test: function (url, pin) {
      return fetch((url || '').trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ pin: (pin || '').trim(), action: 'ping' }),
        redirect: 'follow'
      }).catch(function () {
        throw new Error('つながりませんでした（電波かURLを確かめてください）');
      }).then(function (r) { return r.text(); }).then(function (t) {
        var obj;
        try { obj = JSON.parse(t); } catch (e) { throw new Error('返事が読めません。Task Board の受け口のURLか確かめてください'); }
        if (!obj.ok) throw new Error(obj.error === 'bad_pin' ? '合言葉が違います' : (obj.error || '断られました'));
        return obj;
      });
    },

    /** 取り込みをやめる（溜めたものも消す） */
    clear: function () {
      cache = { since: 0, byDate: {}, at: 0 };
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

/* Diem 同期
   ・送信箱に積まれた分をまとめて送り、そのあとサーバーの新しい分を受け取ります
   ・次に受け取る目印（since）は必ずサーバーが返した now を使います。
     手元の時計はGoogleの時計とズレるので、自分の時計を使うと取りこぼします */
(function (global) {
  'use strict';

  var Store = null;
  var busy = false;
  var timer = null;

  function url() {
    var m = Store.meta();
    return (m.syncUrl || (global.APP && APP.syncUrl) || '').trim();
  }
  function pin() { return (Store.meta().pin || '').trim(); }

  function enabled() { return !!url() && !!pin(); }

  function wait(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

  /* ★Google の Apps Script は、受け口が動いたあと返事を受け取る段（script.googleusercontent.com）で、
     ときどき返事が崩れる。6回に1回ほど「404」、ほかに「中身が空・JSON でない」「ok なのに要るものが無い」。
     **受け口の処理（シートへの書き込み）は済んでいる**ので、少し待って2回まで送り直す（Task Board と同じ形）。
     送り直してよいのは、書き込みが **id ごとの上書き**で、2回届いても1行のままだから（gas/コード.gs の push）。
     2026-09-30 まで Diem には入っておらず、右上が「送れません」になったり、タスクが出なかったりした */
  var NEED = { ping: 'now', pull: 'rows', push: 'applied' };   // 動きごとに、返事に要るもの

  function explain(code) {
    return ({
      bad_pin: '合言葉が違います',
      locked: 'まちがいが続いたので、しばらく止まっています（10分ほど待ってください）',
      not_setup: '受け口の用意がまだです',
      bad_space: '取りに行く先が違います',
      bad_json: '送った中身が読めませんでした'
    })[code] || (code || '断られました');
  }

  /** 受け口に送る（崩れた返事は送り直す）。Diem の同期と、Task Board のタスクの取り込みの両方で使う */
  function request(u, payload, tries) {
    tries = tries || 0;
    return fetch(u, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    }).catch(function () {
      throw new Error('つながりませんでした（電波かURLを確かめてください）');
    }).then(function (r) { return r.text(); }).then(function (t) {
      var obj = null;
      try { obj = JSON.parse(t); } catch (e) { obj = null; }
      var need = NEED[payload.action];
      if (obj && obj.ok && need && !(need in obj)) obj = null;   // 形が違う返事は、読めなかったのと同じに扱う
      if (!obj) {
        if (tries < 2) return wait(800 * (tries + 1)).then(function () { return request(u, payload, tries + 1); });
        throw new Error('返事が読めません（3回試しました。少し待ってから、もう一度試してください）');
      }
      if (!obj.ok) { var e = new Error(explain(obj.error)); e.code = obj.error; throw e; }
      return obj;
    });
  }

  function post(payload) { return request(url(), payload); }

  var Sync = {
    setStore: function (s) { Store = s; },

    enabled: enabled,

    state: function () {
      var m = Store.meta();
      if (!enabled()) return { kind: 'off', pending: m.outbox.length };
      if (busy) return { kind: 'busy', pending: m.outbox.length };
      if (Sync.lastError) return { kind: 'error', pending: m.outbox.length, message: Sync.lastError };
      if (m.outbox.length) return { kind: 'pending', pending: m.outbox.length };
      return { kind: 'ok', pending: 0, at: m.lastSyncAt };
    },

    lastError: '',

    /** 送って受け取る。手で押したときは force=true */
    run: function (force) {
      if (!enabled()) return Promise.resolve({ skipped: 'off' });
      if (busy) return Promise.resolve({ skipped: 'busy' });
      busy = true;
      Sync.onChange && Sync.onChange();

      var m = Store.meta();
      var ops = Store.outboxPayload();

      var step = ops.length
        ? post({ pin: pin(), action: 'push', by: m.me || '', ops: ops })
            .then(function (res) { Store.outboxDone(res.applied || []); return res; })
        : Promise.resolve(null);

      return step.then(function () {
        return post({ pin: pin(), action: 'pull', since: Store.meta().since || 0 });
      }).then(function (res) {
        var n = Store.applyRows(res.rows || []);
        Store.setSince(res.now);
        Sync.lastError = '';
        busy = false;
        Sync.onChange && Sync.onChange();
        if (n) Sync.onData && Sync.onData(n);
        return { pulled: n };
      }).catch(function (e) {
        busy = false;
        Sync.lastError = e.message || String(e);
        Sync.onChange && Sync.onChange();
        if (force) throw e;
        return { error: Sync.lastError };
      });
    },

    /** つながるか確かめるだけ */
    test: function (u, p) {
      return request((u || '').trim(), { pin: (p || '').trim(), action: 'ping' });
    },

    /** ほかの受け口（Task Board）にも同じ送り方で送る */
    request: request,

    start: function () {
      if (timer) clearInterval(timer);
      var sec = (global.APP && APP.autoSyncSec) || 60;
      timer = setInterval(function () { Sync.run(false); }, sec * 1000);
      global.addEventListener('online', function () { Sync.run(false); });
      global.addEventListener('visibilitychange', function () {
        if (!document.hidden) Sync.run(false);
      });
      Sync.run(false);
    }
  };

  global.PB = global.PB || {};
  global.PB.Sync = Sync;
})(window);

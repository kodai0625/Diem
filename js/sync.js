/* Pair Board 同期
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

  function post(payload) {
    return fetch(url(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    }).then(function (r) { return r.text(); }).then(function (t) {
      var obj;
      try { obj = JSON.parse(t); }
      catch (e) { throw new Error('返事が読めません（URLが違うかもしれません）'); }
      if (!obj.ok) throw new Error(obj.error || '断られました');
      return obj;
    });
  }

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
      return fetch(u.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ pin: (p || '').trim(), action: 'ping' }),
        redirect: 'follow'
      }).then(function (r) { return r.text(); }).then(function (t) {
        var obj;
        try { obj = JSON.parse(t); } catch (e) { throw new Error('返事が読めません。URLがウェブアプリのものか確かめてください'); }
        if (!obj.ok) throw new Error(obj.error === 'bad_pin' ? 'PINが違います' : (obj.error || '断られました'));
        return obj;
      });
    },

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

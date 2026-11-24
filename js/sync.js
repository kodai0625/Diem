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
     **受け口の処理（シートへの書き込み）は済んでいる**ので、少し待って2回まで送り直す。
     送り直してよいのは、書き込みが **id ごとの上書き**で、2回届いても1行のままだから（gas/コード.gs の push）。
     2026-09-30 まで Diem には入っておらず、右上が「送れません」になることがあった */
  var NEED = { ping: 'now', pull: 'rows', push: 'applied' };   // 動きごとに、返事に要るもの

  function explain(code) {
    return ({
      bad_pin: '合言葉が違います',
      locked: '間違いが続いたので、しばらく止まっています（10分ほど待ってください）',
      not_setup: '受け口の用意がまだです',
      bad_space: '取りに行く先が違います',
      bad_json: '送った中身が読めませんでした'
    })[code] || (code || '断られました');
  }

  /** 受け口に送る（崩れた返事は送り直す）。Diem の同期のほか、追加の機能（PB.Extra）からも使う */
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

  /* ---------- 自分だけの予定を、自分の端末どうしで同じにする（2026-11-24。私用だけ） ----------
     ・送信箱に自分だけの予定が入っているのは、PB.Mine が入っていて自分の合言葉が決まっているときだけ（store.js の isLocalOnly）
     ・★自分だけの予定は、ここで必ず暗号にしてから送る。種類は 'mine' にする（相手のアプリは知らない種類なので受け取っても捨てる）。
       PB.Mine が無い・暗号にできないときは、送る分から外す（決してそのままの形では送らない）
     ・受け取った 'mine' は、自分の合言葉で開けたものだけを自分だけの予定に戻す。開けないもの（合言葉が違う等）は捨てる */
  function isPrivate(op) { return op.kind === 'event' && op.rec && op.rec.scope === 'private'; }

  function sealOps(ops) {
    var plain = ops.filter(function (o) { return !isPrivate(o); });
    var priv = ops.filter(isPrivate);
    var Mine = global.PB && global.PB.Mine;
    if (!priv.length || !Mine || !Mine.on()) return Promise.resolve(plain);
    return Promise.all(priv.map(function (o) { return Mine.seal(o.id, o.rec); })).then(function (sealed) {
      return plain.concat(sealed.map(function (rec, i) { return { kind: 'mine', id: priv[i].id, rec: rec }; }));
    }).catch(function () { return plain; });
  }

  /** 送れた分の知らせを、手元の種類に戻す（'mine' → 'event'）。送信箱は手元の種類で持っているため */
  function backToEvent(applied) {
    return (applied || []).map(function (a) {
      return a.kind === 'mine' ? { kind: 'event', id: a.id, updatedAt: a.updatedAt } : a;
    });
  }

  function openRows(rows) {
    var Mine = global.PB && global.PB.Mine;
    var mine = rows.filter(function (r) { return r.kind === 'mine'; });
    var rest = rows.filter(function (r) { return r.kind !== 'mine'; });
    if (!mine.length || !Mine || !Mine.on()) return Promise.resolve(rest);
    return Promise.all(mine.map(function (r) {
      return Mine.open(r.id, r.json).catch(function () { return null; });
    })).then(function (recs) {
      recs.forEach(function (rec, i) {
        if (!rec) return;
        var r = mine[i];
        rest.push({ kind: 'event', id: r.id, json: JSON.stringify(rec), updatedAt: r.updatedAt, by: r.by, deleted: r.deleted, mine: true });
      });
      return rest;
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

      var step = sealOps(Store.outboxPayload()).then(function (ops) {
        if (!ops.length) return null;
        return post({ pin: pin(), action: 'push', by: m.me || '', ops: ops })
          .then(function (res) { Store.outboxDone(backToEvent(res.applied)); return res; });
      });

      var now = 0;
      return step.then(function () {
        return post({ pin: pin(), action: 'pull', since: Store.meta().since || 0 });
      }).then(function (res) {
        now = res.now;
        return openRows(res.rows || []);
      }).then(function (rows) {
        var n = Store.applyRows(rows);
        Store.setSince(now);
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

    /** ほかの受け口にも同じ送り方で送る（追加の機能が使う） */
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

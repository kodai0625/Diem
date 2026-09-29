/* Diem データの入れ物
   ・すべて端末の localStorage に持ちます（電波がなくても入力できます）
   ・「2人で共有」の予定と立替金だけが送信箱に積まれ、あとでサーバーへ送られます
   ・「自分だけ」の予定は送信箱に入れません。端末の外へは出ません */
(function (global) {
  'use strict';

  var KEY_DATA = 'diem.data';
  var KEY_META = 'diem.meta';

  var KINDS = ['event', 'trip', 'expense', 'settle'];

  var data = null;   // { event:{id:rec}, trip:{}, expense:{}, settle:{} }
  var meta = null;   // { since, me, partner, members, pin, syncUrl, outbox:[{kind,id}], filter }

  function emptyData() {
    var d = {};
    KINDS.forEach(function (k) { d[k] = {}; });
    return d;
  }

  function defaultMeta() {
    return {
      since: 0,
      me: '',
      partner: '',
      colors: {},
      pin: '',
      syncUrl: '',
      outbox: [],
      lastSyncAt: 0,
      lastTrip: '',
      taskUrl: '',      // Task Board の受け口（入れたときだけタスクを読む）
      taskPin: '',
      taskShow: false   // 設定に「Task Board のタスク」を出すか（自分の端末だけ）
    };
  }

  function read(key, fallback) {
    try {
      var s = localStorage.getItem(key);
      if (!s) return fallback;
      var v = JSON.parse(s);
      return (v && typeof v === 'object') ? v : fallback;
    } catch (e) { return fallback; }
  }

  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { Store.onQuotaError && Store.onQuotaError(e); return false; }
  }

  function load() {
    data = read(KEY_DATA, null) || emptyData();
    KINDS.forEach(function (k) { if (!data[k]) data[k] = {}; });
    var m = read(KEY_META, null) || defaultMeta();
    var def = defaultMeta();
    Object.keys(def).forEach(function (k) { if (!(k in m)) m[k] = def[k]; });
    meta = m;
  }

  function saveData() { write(KEY_DATA, data); }
  function saveMeta() { write(KEY_META, meta); }

  function newId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function isLocalOnly(kind, rec) {
    return kind === 'event' && rec && rec.scope === 'private';
  }

  function queue(kind, id) {
    for (var i = 0; i < meta.outbox.length; i++) {
      if (meta.outbox[i].kind === kind && meta.outbox[i].id === id) return;
    }
    meta.outbox.push({ kind: kind, id: id });
  }

  var Store = {
    KINDS: KINDS,

    init: function () { load(); },

    meta: function () { return meta; },
    saveMeta: saveMeta,

    /** 一覧（消したものは除く） */
    list: function (kind) {
      var out = [];
      var m = data[kind] || {};
      Object.keys(m).forEach(function (id) {
        if (!m[id].deleted) out.push(m[id]);
      });
      return out;
    },

    get: function (kind, id) { return (data[kind] || {})[id] || null; },

    /** 足す・直す。id がなければ新しく作る */
    put: function (kind, rec) {
      if (!rec.id) rec.id = newId();
      rec.updatedAt = Date.now();
      rec.updatedBy = meta.me || '';
      data[kind][rec.id] = rec;
      if (!isLocalOnly(kind, rec)) queue(kind, rec.id);
      saveData(); saveMeta();
      return rec;
    },

    /** 消す（記録は残して deleted の印を付ける） */
    remove: function (kind, id) {
      var rec = data[kind][id];
      if (!rec) return;
      var wasLocal = isLocalOnly(kind, rec);
      rec.deleted = true;
      rec.updatedAt = Date.now();
      rec.updatedBy = meta.me || '';
      if (!wasLocal) queue(kind, id);
      saveData(); saveMeta();
    },

    /** 「自分だけ」→「2人で共有」に変えたときは、送信箱に積む必要がある */
    queue: function (kind, id) { queue(kind, id); saveMeta(); },

    /* ---------------- 同期の受け口 ---------------- */

    outbox: function () { return meta.outbox.slice(); },

    /** 送る分の中身を取り出す */
    outboxPayload: function () {
      var ops = [];
      meta.outbox.forEach(function (o) {
        var rec = (data[o.kind] || {})[o.id];
        if (!rec) return;
        if (isLocalOnly(o.kind, rec) && !rec.deleted) return; // 念のため
        ops.push({ kind: o.kind, id: o.id, rec: rec });
      });
      return ops;
    },

    /** 送れた分を送信箱から外す。送ったあとに直したものは残す */
    outboxDone: function (sent) {
      var map = {};
      sent.forEach(function (s) { map[s.kind + '/' + s.id] = s.updatedAt; });
      meta.outbox = meta.outbox.filter(function (o) {
        var key = o.kind + '/' + o.id;
        if (!(key in map)) return true;
        var rec = (data[o.kind] || {})[o.id];
        return !!(rec && rec.updatedAt > map[key]); // 送ったあとに直っていれば残す
      });
      saveMeta();
    },

    /** サーバーから来た分を取り込む。送信箱に残っている id は手元を優先する */
    applyRows: function (rows) {
      var pending = {};
      meta.outbox.forEach(function (o) { pending[o.kind + '/' + o.id] = true; });
      var changed = 0;
      rows.forEach(function (row) {
        if (KINDS.indexOf(row.kind) < 0) return;
        if (pending[row.kind + '/' + row.id]) return;
        var rec;
        try { rec = JSON.parse(row.json); } catch (e) { return; }
        rec.id = row.id;
        rec.updatedAt = Number(row.updatedAt) || Date.now();
        if (row.deleted) rec.deleted = true;
        if (rec.scope === 'private') rec.scope = 'shared'; // 共有に載ったものは共有として扱う
        data[row.kind][row.id] = rec;
        changed++;
      });
      if (changed) saveData();
      return changed;
    },

    setSince: function (now) { meta.since = now; meta.lastSyncAt = Date.now(); saveMeta(); },

    /* ---------------- 持ち出し・持ち込み ---------------- */

    exportAll: function () {
      return JSON.stringify({
        app: 'Diem', version: (global.APP && APP.version) || '',
        exportedAt: new Date().toISOString(),
        data: data,
        settings: { me: meta.me, partner: meta.partner, colors: meta.colors }
      }, null, 1);
    },

    importAll: function (text) {
      var obj = JSON.parse(text);
      if (!obj || !obj.data) throw new Error('中身が読めません');
      KINDS.forEach(function (k) {
        var m = obj.data[k] || {};
        Object.keys(m).forEach(function (id) {
          var rec = m[id];
          rec.id = id;
          var cur = data[k][id];
          if (!cur || (rec.updatedAt || 0) >= (cur.updatedAt || 0)) data[k][id] = rec;
        });
      });
      if (obj.settings) {
        if (obj.settings.me) meta.me = obj.settings.me;
        if (obj.settings.partner) meta.partner = obj.settings.partner;
        if (obj.settings.colors) meta.colors = obj.settings.colors;
      }
      saveData(); saveMeta();
    },

    /** 全部消す */
    wipe: function (keepSettings) {
      data = emptyData();
      var m = defaultMeta();
      if (keepSettings) { m.me = meta.me; m.partner = meta.partner; m.colors = meta.colors; m.pin = meta.pin; m.syncUrl = meta.syncUrl; }
      meta = m;
      saveData(); saveMeta();
    },

    /** 端末の中だけの予定が何件あるか（消える危険を伝えるため） */
    privateCount: function () {
      return Store.list('event').filter(function (e) { return e.scope === 'private'; }).length;
    }
  };

  global.PB = global.PB || {};
  global.PB.Store = Store;
})(window);

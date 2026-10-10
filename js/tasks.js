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
     失敗した側は、前に取れた分を消さずに残す（崩れた返事で、タスクが全部消えて見えないように）

   2026-10-11 にまとめ直した点（★配布用を分けたため）
   ・Task Board に関するものは、**このファイルと css/tasks.css の2つだけ**に置く。
     カレンダー（calendar.js）と設定（app.js）は、下の PB.Extra という口を通して呼ぶだけで、中身を知らない
   ・★配布用（一緒に使う相手に渡す方）は、この2つを入れずに組み立てる（公開用を作る.py）。
     ここに書いたものは相手の側には1行も入らない。ほかのファイルに Task Board の処理を書き足さないこと */
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

  /* ---------- 画面とのつなぎ（カレンダーと設定は、この口だけを通して呼ぶ） ---------- */
  var api = null;   // app.js から受け取る { store, toast, refresh }

  /** タスクの「いつ」：やる日なら「やる日 13:00〜13:30」、期限の日なら「期限」 */
  function when(t) {
    var U = PB.U;
    var s = t.by === 'do' ? 'やる日' : '期限';
    if (t.time) {
      var h = +t.time.slice(0, 2), mi = +t.time.slice(3, 5) + (t.dur || 30);
      s += ' ' + t.time + '〜' + U.pad((h + Math.floor(mi / 60)) % 24) + ':' + U.pad(mi % 60);
    }
    if (t.by === 'do' && t.due) s += '（期限 ' + U.short(t.due) + '）';
    return s;
  }

  /** その日の一覧・「これから」に出す1行（見るだけなので押せない） */
  function rowHtml(t) {
    var U = PB.U;
    var work = t.side === 'work';
    return '<div class="card"><div class="row">'
      + '<span class="bar task' + (work ? ' work' : '') + '"></span>'
      + '<span class="body"><span class="ttl">' + U.esc(t.title) + '</span>'
      + '<span class="sub">' + U.esc(when(t)) + '　Task Board の' + (work ? '会社' : '個人') + 'のタスク</span></span>'
      + '<span class="tag task' + (work ? ' work' : '') + '">' + (work ? '会社のタスク' : 'タスク') + '</span>'
      + '</div></div>';
  }

  /** 設定の欄。★合図を受けた端末にだけ出す */
  function settingsHtml() {
    var U = PB.U, m = Store.meta(), T = Tasks;
    if (!(m.taskShow || T.enabled())) return '';
    return '<div class="secttl">Task Board のタスク</div><div class="card">'
      + '<div class="setrow"><div><div class="k">取り込み</div><div class="d">'
      + (T.enabled() ? '入（期限のあるタスクをカレンダーに出します）' : '切（Task Board の受け口を入れると始まります）')
      + '</div></div><button type="button" class="mini" id="t-url">' + (T.enabled() ? '直す' : '入れる') + '</button></div>'
      + (T.enabled()
          ? '<div class="setrow"><div><div class="k">出ているタスク</div>'
            + '<div class="d"><b>個人 ' + T.count('personal') + '件' + (T.wantWork() ? '・会社 ' + T.count('work') + '件' : '') + '</b>'
            + '（やる日か期限があって、まだ終わっていないもの。やる日があればやる日、なければ期限の日に出します）</div></div>'
            + '<button type="button" class="mini" id="t-now">今すぐ読む</button></div>'
            + '<div class="setrow"><div><div class="k">会社のタスクも出す</div>'
            + '<div class="d">入にすると、会社の側のタスクも出します（色を変えて見分けます）</div></div>'
            + '<button type="button" class="mini" id="t-work">' + (T.wantWork() ? '入' : '切') + '</button></div>'
            + '<div class="setrow"><div><div class="k">取り込みをやめる</div>'
            + '<div class="d">溜めたタスクも消します</div></div>'
            + '<button type="button" class="mini" id="t-off">やめる</button></div>'
          : '')
      + (T.lastError ? '<div class="warnbox">前回うまくいきませんでした：' + U.esc(T.lastError) + '</div>' : '')
      + '<div class="note" style="margin-top:6px">★会社のタスクは「会社のタスクも出す」が入のときだけ読みます。'
      + '個人も会社も、タスクは<b>この端末の中だけ</b>に置き、一緒に使う相手には出ません。直すのは Task Board 側です</div>'
      + '</div>';
  }

  /** 設定の押しどころ */
  function bindSettings(body) {
    var m = Store.meta(), T = Tasks, toast = api.toast, refresh = api.refresh;

    var tUrl = body.querySelector('#t-url');
    if (tUrl) tUrl.onclick = function () {
      var u = prompt('Task Board の受け口のURL（空にすると取り込みをやめます）', m.taskUrl || '');
      if (u === null) return;
      u = u.trim();
      if (!u) { m.taskUrl = ''; m.taskPin = ''; Store.saveMeta(); T.clear(); refresh(); return; }
      var pin = prompt('Task Board の合言葉', m.taskPin || '');
      if (pin === null) return;
      toast('つないでいます…');
      T.test(u, pin).then(function () {
        m.taskUrl = u; m.taskPin = pin.trim(); Store.saveMeta();
        return T.run(true);
      }).then(function () {
        toast('タスクを読み込みました'); T.start(); refresh();
      }).catch(function (e) { alert('つながりませんでした：\n' + e.message); refresh(); });
    };
    var tNow = body.querySelector('#t-now');
    if (tNow) tNow.onclick = function () {
      toast('読んでいます…');
      T.run(true).then(function () { toast('読み込みました'); refresh(); })
        .catch(function (e) { alert('うまくいきませんでした：\n' + e.message); refresh(); });
    };
    var tWork = body.querySelector('#t-work');
    if (tWork) tWork.onclick = function () {
      m.taskWork = !T.wantWork(); Store.saveMeta();
      toast(m.taskWork ? '会社のタスクも読みます…' : '会社のタスクを出さないようにしました');
      T.run(false).then(function () { refresh(); });
    };
    var tOff = body.querySelector('#t-off');
    if (tOff) tOff.onclick = function () {
      if (!confirm('タスクの取り込みをやめますか？\n（Task Board 側のタスクは消えません）')) return;
      m.taskUrl = ''; m.taskPin = ''; m.taskShow = false; Store.saveMeta(); T.clear();
      refresh(); toast('やめました。見出しも隠しました');
    };

    // ★「版」の行を5回続けて押すと、Task Board の設定を出す／隠す（自分の端末だけ）。
    //   iPhone のホーム画面のアプリは Safari と保存場所が別なので、?task=1 のリンクが届かない。
    //   アプリの中で合図を送れるように、ここに置いた。偶然見つけないよう、5回にしてある
    var ver = body.querySelector('#s-ver'), taps = 0, tapTimer = null;
    if (ver) ver.onclick = function () {
      taps++;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(function () { taps = 0; }, 2500);
      if (taps < 5) return;
      taps = 0;
      m.taskShow = !(m.taskShow || T.enabled());
      if (!m.taskShow) { m.taskUrl = ''; m.taskPin = ''; T.clear(); }
      Store.saveMeta();
      refresh();
      toast(m.taskShow ? 'Task Board の設定を出しました' : 'Task Board の設定を隠しました');
    };
  }

  /** 起動のとき。カレンダーを描く前に呼ばれる */
  function boot(a) {
    api = a;
    // ★合図つきのリンク（…/?task=1）で開いた端末にだけ、タスクの設定を出す。?task=0 で隠せる
    try {
      var q = new URLSearchParams(location.search);
      if (q.has('task')) {
        a.store.meta().taskShow = (q.get('task') !== '0');
        a.store.saveMeta();
        q.delete('task');
        var rest = q.toString();
        history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
      }
    } catch (e) {}
    Tasks.init(a.store);
    Tasks.onData = a.refresh;
  }

  PB.Extra = {
    boot: boot,
    autoStart: function () { if (enabled()) Tasks.start(); },
    enabled: enabled,
    on: Tasks.on,
    barClass: function (t) { return t.side === 'work' ? 'task work' : 'task'; },
    rowHtml: rowHtml,
    dayHint: 'タスクは見るだけです。直すときは Task Board を開いてください',
    settingsHtml: settingsHtml,
    bindSettings: bindSettings
  };
})(window);

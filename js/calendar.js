/* Diem カレンダー画面

   2026-09-29 にタイムツリーの操作感へ寄せて作り直した。
   ・月は左右にスワイプして送る（矢印も残す）。表はいつも6週で、送っても高さが変わらない
   ・何日かにまたがる予定は、週の中で1本の帯として引く
   ・予定は題名だけで保存できる。日付・時刻・メモは「詳しく」の中
   ・「これから」の画面で、近い予定を日付順に並べて見る */
(function (global) {
  'use strict';
  var PB = global.PB = global.PB || {};
  var Store;

  /* ---------- 小道具 ---------- */
  var U = PB.U = {
    pad: function (n) { return (n < 10 ? '0' : '') + n; },
    ymd: function (d) { return d.getFullYear() + '-' + U.pad(d.getMonth() + 1) + '-' + U.pad(d.getDate()); },
    parse: function (s) { var a = String(s || '').split('-'); return new Date(+a[0], +a[1] - 1, +a[2]); },
    addDays: function (d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; },
    today: function () { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); },
    yen: function (n) { return '¥' + Math.round(n).toLocaleString('ja-JP'); },
    esc: function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    },
    wday: ['日', '月', '火', '水', '木', '金', '土'],
    short: function (s) {
      if (!s) return '';
      var a = String(s).split('-');
      return a.length === 3 ? (+a[1]) + '月' + (+a[2]) + '日' : s;
    },
    label: function (s) {
      var d = U.parse(s);
      return (d.getMonth() + 1) + '月' + d.getDate() + '日（' + U.wday[d.getDay()] + '）';
    },
    /** 今日・明日・あさって、それより先は日付 */
    rel: function (s) {
      var n = Math.round((U.parse(s) - U.today()) / 86400000);
      if (n === 0) return '今日';
      if (n === 1) return '明日';
      if (n === 2) return 'あさって';
      return U.label(s);
    }
  };

  /* ---------- 人と色 ---------- */
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
  var Who = PB.Who = {
    me: function () { return Store.meta().me || '自分'; },
    partner: function () { return Store.meta().partner || '相手'; },
    color: function (name) {
      var m = Store.meta();
      if (m.colors && m.colors[name]) return m.colors[name];
      if (name === m.me) return css('--me');
      if (name === m.partner) return css('--you');
      return css('--other');
    }
  };

  /* ---------- 状態 ---------- */
  var cur = U.today();
  cur = new Date(cur.getFullYear(), cur.getMonth(), 1);   // 表示している月の1日
  var sel = U.ymd(U.today());                             // 選んでいる日
  var filter = 'all';
  var LANES = 3;                                          // 1日に帯を何段まで出すか

  function passFilter(e) {
    if (filter === 'shared' && e.scope !== 'shared') return false;
    if (filter === 'private' && e.scope !== 'private') return false;
    return true;
  }

  function byTime(a, b) {
    var aa = a.allDay ? '' : (a.st || '');
    var bb = b.allDay ? '' : (b.st || '');
    if (aa !== bb) return aa < bb ? -1 : 1;
    return (a.title || '') < (b.title || '') ? -1 : 1;
  }

  function eventsOn(dateStr) {
    return Store.list('event').filter(function (e) {
      return passFilter(e) && dateStr >= e.start && dateStr <= (e.end || e.start);
    }).sort(byTime);
  }

  /** その日の「期限が来るタスク」。自分だけの側のものとして扱う */
  function tasksOn(dateStr) {
    if (filter === 'shared') return [];
    return (PB.Tasks && PB.Tasks.on(dateStr)) || [];
  }

  /* ---------- 月の表 ---------- */

  /** 1週間ぶんの帯を、重ならないように段へ振り分ける */
  function layoutWeek(days) {
    var first = days[0], last = days[6];
    var items = [];

    Store.list('event').forEach(function (e) {
      if (!passFilter(e)) return;
      var s = e.start, t = e.end || e.start;
      if (t < first || s > last) return;
      var sc = Math.max(0, days.indexOf(s < first ? first : s));
      var ec = days.indexOf(t > last ? last : t);
      if (ec < 0) ec = 6;
      items.push({ kind: 'event', rec: e, sc: sc, ec: ec, contL: s < first, contR: t > last });
    });
    days.forEach(function (d, i) {
      tasksOn(d).forEach(function (t) {
        items.push({ kind: 'task', rec: t, sc: i, ec: i, contL: false, contR: false });
      });
    });

    // 長いもの・早く始まるものを上の段に
    items.sort(function (a, b) {
      if (a.sc !== b.sc) return a.sc - b.sc;
      var la = a.ec - a.sc, lb = b.ec - b.sc;
      if (la !== lb) return lb - la;
      if (a.kind !== b.kind) return a.kind === 'event' ? -1 : 1;
      return a.kind === 'event' ? byTime(a.rec, b.rec) : 0;
    });

    var lanes = [];      // lanes[段] = その段で埋まっている最後の列
    items.forEach(function (it) {
      var l = 0;
      while (lanes[l] !== undefined && lanes[l] >= it.sc) l++;
      lanes[l] = it.ec;
      it.lane = l;
    });
    return items;
  }

  function barHtml(it) {
    var cls = ['bar2'];
    var style = 'left:calc(100% / 7 * ' + it.sc + ' + 2px);'
      + 'width:calc(100% / 7 * ' + (it.ec - it.sc + 1) + ' - 4px);'
      + 'top:' + (21 + it.lane * 17) + 'px;';
    var title;
    if (it.kind === 'task') {
      cls.push('task');
      if (it.rec.side === 'work') cls.push('work');     // 会社のタスクは色を変える
      title = it.rec.title;
    } else {
      var e = it.rec;
      if (e.scope === 'private') cls.push('priv');
      style += '--c:' + Who.color(e.owner) + ';';
      title = e.title || '（題名なし）';          // 表は題名だけ（幅が狭いので時刻は下の一覧で見せる）
    }
    if (it.contL) cls.push('contL');
    if (it.contR) cls.push('contR');
    return '<span class="' + cls.join(' ') + '" style="' + style + '">' + U.esc(title) + '</span>';
  }

  function renderGrid() {
    var grid = document.getElementById('grid');
    var first = new Date(cur.getFullYear(), cur.getMonth(), 1);
    var start = U.addDays(first, -first.getDay());
    var todayStr = U.ymd(U.today());
    var html = '';

    for (var w = 0; w < 6; w++) {                 // ★いつも6週。送っても高さが変わらない
      var days = [];
      for (var i = 0; i < 7; i++) days.push(U.ymd(U.addDays(start, w * 7 + i)));
      var items = layoutWeek(days);

      // 段からあふれた数を、日ごとに数える
      var over = [0, 0, 0, 0, 0, 0, 0];
      items.forEach(function (it) {
        if (it.lane < LANES) return;
        for (var c = it.sc; c <= it.ec; c++) over[c]++;
      });

      html += '<div class="week"><div class="days">';
      days.forEach(function (s, c) {
        var d = U.parse(s);
        var cls = ['cell', 's' + d.getDay()];
        if (d.getMonth() !== cur.getMonth()) cls.push('out');
        if (s === todayStr) cls.push('today');
        if (s === sel) cls.push('sel');
        html += '<button type="button" class="' + cls.join(' ') + '" data-date="' + s + '" aria-label="' + U.label(s) + '">'
             + '<span class="dnum">' + d.getDate() + '</span>'
             + (over[c] ? '<span class="more">+' + over[c] + '</span>' : '')
             + '</button>';
      });
      html += '</div><div class="bars">';
      items.forEach(function (it) { if (it.lane < LANES) html += barHtml(it); });
      html += '</div></div>';
    }

    grid.innerHTML = html;
    document.getElementById('monthLabel').textContent = cur.getFullYear() + '年' + (cur.getMonth() + 1) + '月';
  }

  /* ---------- その日の中身 ---------- */
  function rowHtml(e) {
    var c = Who.color(e.owner);
    var time = e.allDay ? '終日' : ((e.st || '') + (e.et ? '〜' + e.et : ''));
    var span = (e.end && e.end !== e.start) ? '　' + U.short(e.start) + '〜' + U.short(e.end) : '';
    var sub = time + span + (e.memo ? '　' + e.memo.replace(/\n/g, ' ') : '');
    return '<div class="card"><button type="button" class="row" data-ev="' + e.id + '">'
      + '<span class="bar' + (e.scope === 'private' ? ' priv' : '') + '" style="--c:' + c + '"></span>'
      + '<span class="body"><span class="ttl">' + U.esc(e.title || '（題名なし）') + '</span>'
      + '<span class="sub">' + U.esc(sub) + '</span></span>'
      + (e.scope === 'private'
          ? '<span class="tag priv">自分だけ</span>'
          : '<span class="tag">' + U.esc(e.owner || '') + '</span>')
      + '</button></div>';
  }

  /** タスクの「いつ」：やる日なら「やる日 13:00〜13:30」、期限の日なら「期限」 */
  function taskWhen(t) {
    var s = t.by === 'do' ? 'やる日' : '期限';
    if (t.time) {
      var h = +t.time.slice(0, 2), mi = +t.time.slice(3, 5) + (t.dur || 30);
      s += ' ' + t.time + '〜' + U.pad((h + Math.floor(mi / 60)) % 24) + ':' + U.pad(mi % 60);
    }
    if (t.by === 'do' && t.due) s += '（期限 ' + U.short(t.due) + '）';
    return s;
  }

  function taskRowHtml(t) {
    var work = t.side === 'work';
    return '<div class="card"><div class="row">'
      + '<span class="bar task' + (work ? ' work' : '') + '"></span>'
      + '<span class="body"><span class="ttl">' + U.esc(t.title) + '</span>'
      + '<span class="sub">' + U.esc(taskWhen(t)) + '　Task Board の' + (work ? '会社' : '個人') + 'のタスク</span></span>'
      + '<span class="tag task' + (work ? ' work' : '') + '">' + (work ? '会社のタスク' : 'タスク') + '</span>'
      + '</div></div>';
  }

  function renderDay() {
    var el = document.getElementById('dayPanel');
    var evs = eventsOn(sel);
    var tks = tasksOn(sel);
    var n = evs.length + tks.length;
    var html = '<div class="dayttl"><b>' + U.label(sel) + '</b><span>' + (n ? n + '件' : '予定なし') + '</span></div>';
    if (!n) {
      html += '<div class="card"><div class="empty">この日の予定はまだありません。<br>右下の ＋ か、この日をもう一度押すと足せます</div></div>';
    } else {
      evs.forEach(function (e) { html += rowHtml(e); });
      tks.forEach(function (t) { html += taskRowHtml(t); });
      if (tks.length) html += '<div class="hint" style="margin:2px 4px 0">タスクは見るだけです。直すときは Task Board を開いてください</div>';
    }
    el.innerHTML = html;
  }

  /* ---------- これから（近い予定を日付順に） ---------- */
  function renderFeed() {
    var el = document.getElementById('feedBody');
    if (!el) return;
    var today = U.ymd(U.today());
    var until = U.ymd(U.addDays(U.today(), 90));
    var byDate = {};

    Store.list('event').forEach(function (e) {
      var s = e.start, t = e.end || e.start;
      if (t < today || s > until) return;
      var key = s < today ? today : s;           // もう始まっているものは今日に出す
      (byDate[key] = byDate[key] || []).push({ kind: 'event', rec: e, cont: s < today });
    });
    if (PB.Tasks && PB.Tasks.enabled()) {
      for (var d = U.today(), k = 0; k <= 90; k++, d = U.addDays(d, 1)) {
        var ds = U.ymd(d);
        PB.Tasks.on(ds).forEach(function (t) {
          (byDate[ds] = byDate[ds] || []).push({ kind: 'task', rec: t });
        });
      }
    }

    var dates = Object.keys(byDate).sort();
    if (!dates.length) {
      el.innerHTML = '<div class="card"><div class="empty">これから90日の予定はありません。<br>右下の ＋ から足せます</div></div>';
      return;
    }
    var html = '';
    dates.forEach(function (ds) {
      var list = byDate[ds].sort(function (a, b) {
        if (a.kind !== b.kind) return a.kind === 'event' ? -1 : 1;
        return a.kind === 'event' ? byTime(a.rec, b.rec) : 0;
      });
      var d = U.parse(ds);
      html += '<div class="feedday s' + d.getDay() + (ds === today ? ' is-today' : '') + '">'
        + '<b>' + U.rel(ds) + '</b>' + (U.rel(ds) !== U.label(ds) ? '<span>' + U.label(ds) + '</span>' : '')
        + '</div>';
      list.forEach(function (it) {
        if (it.kind === 'task') { html += taskRowHtml(it.rec); return; }
        html += rowHtml(it.rec);
      });
    });
    el.innerHTML = html;
    el.onclick = function (ev) {
      var b = ev.target.closest('[data-ev]'); if (!b) return;
      openEvent(b.dataset.ev);
    };
  }

  function render() { renderGrid(); renderDay(); renderFeed(); }

  /* ---------- 月を送る ---------- */
  function shiftMonth(n) {
    cur = new Date(cur.getFullYear(), cur.getMonth() + n, 1);
    var grid = document.getElementById('grid');
    render();
    if (grid && grid.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      grid.animate(
        [{ transform: 'translateX(' + (n > 0 ? 28 : -28) + 'px)', opacity: 0.35 },
         { transform: 'translateX(0)', opacity: 1 }],
        { duration: 220, easing: 'cubic-bezier(.2,.7,.3,1)' });
    }
  }

  /** 左右のスワイプで月を送る。縦のスクロールや、日を押すのは邪魔しない */
  function wireSwipe(el) {
    var x0 = 0, y0 = 0, t0 = 0, on = false;
    el.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { on = false; return; }
      on = true; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
    }, { passive: true });
    el.addEventListener('touchend', function (e) {
      if (!on) return;
      on = false;
      var p = e.changedTouches[0];
      var dx = p.clientX - x0, dy = p.clientY - y0;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5 || Date.now() - t0 > 700) return;
      shiftMonth(dx < 0 ? 1 : -1);    // 左へはらう＝次の月
    }, { passive: true });
  }

  /* ---------- 予定の入力窓（題名だけで保存できる） ---------- */
  function openEvent(id, dateStr) {
    var e = id ? Store.get('event', id) : null;
    var isNew = !e;
    if (!e) {
      e = { title: '', start: dateStr || sel, end: dateStr || sel, allDay: true,
            st: '', et: '', memo: '', scope: 'shared', owner: Who.me() };
    }
    var draft = JSON.parse(JSON.stringify(e));
    // 何か詳しいことが入っている予定は、はじめから開いておく
    var openMore = !isNew && (!e.allDay || (e.end && e.end !== e.start) || !!e.memo);

    function summary() {
      var s = U.label(draft.start);
      if (draft.end && draft.end !== draft.start) s += '〜' + U.short(draft.end);
      s += '　' + (draft.allDay ? '終日' : ((draft.st || '時刻') + (draft.et ? '〜' + draft.et : '')));
      return s;
    }

    var html = ''
      + '<div class="evhead"><h2>' + (isNew ? '予定を足す' : '予定を直す') + '</h2>'
      + '<button type="button" class="go small" id="f-save">保存</button></div>'
      + '<input type="text" class="bigtitle" id="f-title" value="' + U.esc(draft.title) + '" placeholder="予定の題名" enterkeyhint="done" autocomplete="off">'
      + '<div class="seg" id="f-scope">'
        + '<button type="button" data-v="shared"' + (draft.scope === 'shared' ? ' class="on"' : '') + '>2人で共有</button>'
        + '<button type="button" data-v="private"' + (draft.scope === 'private' ? ' class="on"' : '') + '>自分だけ</button>'
      + '</div>'
      + '<button type="button" class="summary" id="f-toggle" aria-expanded="' + openMore + '">'
        + '<span id="f-sum">' + U.esc(summary()) + '</span><span class="chev">詳しく</span></button>'
      + '<div id="f-more"' + (openMore ? '' : ' hidden') + '>'
        + '<div class="f f2"><div><label>始まる日</label><input type="date" id="f-start" value="' + draft.start + '"></div>'
          + '<div><label>終わる日</label><input type="date" id="f-end" value="' + (draft.end || draft.start) + '"></div></div>'
        + '<div class="f"><label class="check"><input type="checkbox" id="f-allday"' + (draft.allDay ? ' checked' : '') + '> 終日</label></div>'
        + '<div class="f f2" id="f-times"' + (draft.allDay ? ' hidden' : '') + '>'
          + '<div><label>始まる時刻</label><input type="time" id="f-st" value="' + (draft.st || '') + '"></div>'
          + '<div><label>終わる時刻</label><input type="time" id="f-et" value="' + (draft.et || '') + '"></div></div>'
        + '<div class="f"><label>メモ</label><textarea id="f-memo" placeholder="場所や持ち物など">' + U.esc(draft.memo) + '</textarea></div>'
        + '<div class="hint">「自分だけ」は相手に見えません。この端末の中だけに残ります</div>'
      + '</div>'
      + '<div class="acts">'
        + (isNew ? '' : '<button type="button" class="del" id="f-del">消す</button>')
        + '<button type="button" id="f-cancel">やめる</button>'
      + '</div>';

    PB.App.modal(html, function (root) {
      var $ = function (q) { return root.querySelector(q); };
      function sync() {
        draft.start = $('#f-start').value || draft.start;
        draft.end = $('#f-end').value || draft.start;
        draft.allDay = $('#f-allday').checked;
        draft.st = $('#f-st').value; draft.et = $('#f-et').value;
        $('#f-sum').textContent = summary();
      }

      root.querySelectorAll('#f-scope button').forEach(function (b) {
        b.onclick = function () {
          draft.scope = b.dataset.v;
          root.querySelectorAll('#f-scope button').forEach(function (x) { x.classList.toggle('on', x === b); });
        };
      });
      $('#f-toggle').onclick = function () {
        var more = $('#f-more');
        more.hidden = !more.hidden;
        this.setAttribute('aria-expanded', String(!more.hidden));
      };
      $('#f-allday').onchange = function () { $('#f-times').hidden = this.checked; sync(); };
      $('#f-start').onchange = function () {
        if ($('#f-end').value < this.value) $('#f-end').value = this.value;
        sync();
      };
      ['#f-end', '#f-st', '#f-et'].forEach(function (q) { $(q).onchange = sync; });
      $('#f-cancel').onclick = PB.App.closeModal;
      $('#f-title').onkeydown = function (ev) {
        if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); save(); }   // 変換中の Enter は無視
      };

      var del = $('#f-del');
      if (del) del.onclick = function () {
        if (!confirm('この予定を消しますか？')) return;
        Store.remove('event', e.id);
        PB.App.closeModal(); render(); PB.App.refreshSync();
        PB.App.toast('消しました');
      };

      function save() {
        sync();
        var wasShared = !isNew && e.scope === 'shared';
        var rec = {
          id: e.id,
          title: $('#f-title').value.trim(),
          scope: draft.scope,
          owner: e.owner || Who.me(),
          allDay: draft.allDay,
          start: draft.start,
          end: draft.end || draft.start,
          st: draft.st, et: draft.et,
          memo: $('#f-memo').value
        };
        if (!rec.title) { $('#f-title').focus(); PB.App.toast('題名を入れてください'); return; }
        if (rec.end < rec.start) rec.end = rec.start;
        if (rec.allDay) { rec.st = ''; rec.et = ''; }
        if (wasShared && rec.scope === 'private') {
          if (!confirm('共有をやめると、相手の画面からこの予定が消えます。よろしいですか？')) return;
          Store.remove('event', e.id);   // 相手側から消す
          delete rec.id;                 // 自分の端末だけに作り直す
        }
        var saved = Store.put('event', rec);
        sel = saved.start;
        var d = U.parse(sel);
        cur = new Date(d.getFullYear(), d.getMonth(), 1);
        PB.App.closeModal(); render(); PB.App.refreshSync();
        PB.App.toast('保存しました');
      }
      $('#f-save').onclick = save;

      // ★新しく足すときは、すぐ題名を打てるようにする（iPhone で鍵盤が出るよう、待たずに当てる）
      if (isNew) $('#f-title').focus();
    });
  }

  /* ---------- 組み立て ---------- */
  PB.Cal = {
    init: function (store) {
      Store = store;
      document.getElementById('prevMonth').onclick = function () { shiftMonth(-1); };
      document.getElementById('nextMonth').onclick = function () { shiftMonth(1); };
      document.getElementById('todayBtn').onclick = function () {
        var t = U.today(); cur = new Date(t.getFullYear(), t.getMonth(), 1); sel = U.ymd(t); render();
      };
      document.getElementById('filters').onclick = function (ev) {
        var b = ev.target.closest('.chip'); if (!b) return;
        filter = b.dataset.filter;
        this.querySelectorAll('.chip').forEach(function (x) { x.classList.toggle('on', x === b); });
        render();
      };
      document.getElementById('grid').onclick = function (ev) {
        var c = ev.target.closest('.cell'); if (!c) return;
        var d = c.dataset.date;
        if (d === sel) { openEvent(null, d); return; }      // もう一度押すと、その日に足す
        sel = d;
        var dd = U.parse(d);
        if (dd.getMonth() !== cur.getMonth()) { shiftMonth(dd < cur ? -1 : 1); return; }
        render();
      };
      document.getElementById('dayPanel').onclick = function (ev) {
        var b = ev.target.closest('[data-ev]'); if (!b) return;
        openEvent(b.dataset.ev);
      };
      wireSwipe(document.getElementById('grid'));
      render();
    },
    render: render,
    renderFeed: renderFeed,
    add: function () { openEvent(null, sel); }
  };
})(window);

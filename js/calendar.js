/* Pair Board カレンダー画面 */
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
  var cur = U.today();          // 表示している月の1日
  cur = new Date(cur.getFullYear(), cur.getMonth(), 1);
  var sel = U.ymd(U.today());   // 選んでいる日
  var filter = 'all';

  function eventsOn(dateStr) {
    var list = Store.list('event').filter(function (e) {
      if (filter === 'shared' && e.scope !== 'shared') return false;
      if (filter === 'private' && e.scope !== 'private') return false;
      return dateStr >= e.start && dateStr <= (e.end || e.start);
    });
    list.sort(function (a, b) {
      var aa = a.allDay ? '' : (a.st || '');
      var bb = b.allDay ? '' : (b.st || '');
      if (aa !== bb) return aa < bb ? -1 : 1;
      return (a.title || '') < (b.title || '') ? -1 : 1;
    });
    return list;
  }

  /* ---------- 月の表 ---------- */
  function renderGrid() {
    var grid = document.getElementById('grid');
    var first = new Date(cur.getFullYear(), cur.getMonth(), 1);
    var start = U.addDays(first, -first.getDay());
    var todayStr = U.ymd(U.today());
    var days = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
    var cells = Math.ceil((first.getDay() + days) / 7) * 7;   // 5週で足りる月は5週で描く
    var html = '';
    for (var i = 0; i < cells; i++) {
      var d = U.addDays(start, i);
      var s = U.ymd(d);
      var out = d.getMonth() !== cur.getMonth();
      var evs = eventsOn(s);
      var cls = ['cell', 's' + d.getDay()];
      if (out) cls.push('out');
      if (s === todayStr) cls.push('today');
      if (s === sel) cls.push('sel');
      html += '<button type="button" class="' + cls.join(' ') + '" data-date="' + s + '">';
      html += '<span class="dnum">' + d.getDate() + '</span>';
      var show = evs.slice(0, 3);
      show.forEach(function (e) {
        var c = Who.color(e.owner);
        html += '<span class="ev' + (e.scope === 'private' ? ' priv' : '') + '" style="--c:' + c + '">'
             + U.esc(e.title || '（題名なし）') + '</span>';
      });
      if (evs.length > 3) html += '<span class="more">他' + (evs.length - 3) + '件</span>';
      html += '</button>';
    }
    grid.innerHTML = html;
    document.getElementById('monthLabel').textContent = cur.getFullYear() + '年' + (cur.getMonth() + 1) + '月';
  }

  /* ---------- その日の中身 ---------- */
  function renderDay() {
    var el = document.getElementById('dayPanel');
    var evs = eventsOn(sel);
    var html = '<div class="dayttl"><b>' + U.label(sel) + '</b><span>' + (evs.length ? evs.length + '件' : '予定なし') + '</span></div>';
    if (!evs.length) {
      html += '<div class="card"><div class="empty">この日の予定はまだありません。<br>右下の ＋ から足せます</div></div>';
    } else {
      evs.forEach(function (e) {
        var c = Who.color(e.owner);
        var time = e.allDay ? '終日' : ((e.st || '') + (e.et ? '〜' + e.et : ''));
        var span = (e.end && e.end !== e.start) ? '　' + U.label(e.start) + '〜' + U.label(e.end) : '';
        var sub = time + span + (e.memo ? '　' + e.memo.replace(/\n/g, ' ') : '');
        html += '<div class="card"><button type="button" class="row" data-ev="' + e.id + '">'
             + '<span class="bar" style="--c:' + c + '"></span>'
             + '<span class="body"><span class="ttl">' + U.esc(e.title || '（題名なし）') + '</span>'
             + '<span class="sub">' + U.esc(sub) + '</span></span>'
             + (e.scope === 'private'
                 ? '<span class="tag priv">自分だけ</span>'
                 : '<span class="tag">' + U.esc(e.owner || '') + '</span>')
             + '</button></div>';
      });
    }
    el.innerHTML = html;
  }

  function render() { renderGrid(); renderDay(); }

  /* ---------- 予定の入力窓 ---------- */
  function openEvent(id, dateStr) {
    var e = id ? Store.get('event', id) : null;
    var isNew = !e;
    if (!e) {
      e = {
        title: '', start: dateStr || sel, end: dateStr || sel, allDay: true,
        st: '', et: '', memo: '', scope: 'shared', owner: Who.me()
      };
    }
    var draft = JSON.parse(JSON.stringify(e));

    function body() {
      return ''
      + '<h2>' + (isNew ? '予定を足す' : '予定を直す') + '</h2>'
      + '<div class="f"><label>題名</label><input type="text" id="f-title" value="' + U.esc(draft.title) + '" placeholder="例）ごはん・美容院・出張"></div>'
      + '<div class="f"><label>どちらの予定か</label><div class="seg" id="f-scope">'
        + '<button type="button" data-v="shared"' + (draft.scope === 'shared' ? ' class="on"' : '') + '>2人で共有</button>'
        + '<button type="button" data-v="private"' + (draft.scope === 'private' ? ' class="on"' : '') + '>自分だけ</button>'
      + '</div></div>'
      + '<div class="hint">「自分だけ」は相手に見えません。この端末の中だけに残ります</div>'
      + '<div class="f"><label class="check"><input type="checkbox" id="f-allday"' + (draft.allDay ? ' checked' : '') + '> 終日</label></div>'
      + '<div class="f f2"><div><label>始まる日</label><input type="date" id="f-start" value="' + draft.start + '"></div>'
        + '<div><label>終わる日</label><input type="date" id="f-end" value="' + (draft.end || draft.start) + '"></div></div>'
      + '<div class="f f2" id="f-times"' + (draft.allDay ? ' hidden' : '') + '>'
        + '<div><label>始まる時刻</label><input type="time" id="f-st" value="' + (draft.st || '') + '"></div>'
        + '<div><label>終わる時刻</label><input type="time" id="f-et" value="' + (draft.et || '') + '"></div></div>'
      + '<div class="f"><label>メモ</label><textarea id="f-memo" placeholder="場所や持ち物など">' + U.esc(draft.memo) + '</textarea></div>'
      + '<div class="acts">'
        + (isNew ? '' : '<button type="button" class="del" id="f-del">消す</button>')
        + '<button type="button" id="f-cancel">やめる</button>'
        + '<button type="button" class="go" id="f-save">保存</button>'
      + '</div>';
    }

    PB.App.modal(body(), function (root) {
      root.querySelectorAll('#f-scope button').forEach(function (b) {
        b.onclick = function () {
          draft.scope = b.dataset.v;
          root.querySelectorAll('#f-scope button').forEach(function (x) { x.classList.toggle('on', x === b); });
        };
      });
      root.querySelector('#f-allday').onchange = function () {
        root.querySelector('#f-times').hidden = this.checked;
      };
      root.querySelector('#f-start').onchange = function () {
        var end = root.querySelector('#f-end');
        if (end.value < this.value) end.value = this.value;
      };
      root.querySelector('#f-cancel').onclick = PB.App.closeModal;
      var del = root.querySelector('#f-del');
      if (del) del.onclick = function () {
        if (!confirm('この予定を消しますか？')) return;
        Store.remove('event', e.id);
        PB.App.closeModal(); render(); PB.App.refreshSync();
        PB.App.toast('消しました');
      };
      root.querySelector('#f-save').onclick = function () {
        var wasShared = !isNew && e.scope === 'shared';
        var rec = {
          id: e.id,
          title: root.querySelector('#f-title').value.trim(),
          scope: draft.scope,
          owner: e.owner || Who.me(),
          allDay: root.querySelector('#f-allday').checked,
          start: root.querySelector('#f-start').value,
          end: root.querySelector('#f-end').value || root.querySelector('#f-start').value,
          st: root.querySelector('#f-st').value,
          et: root.querySelector('#f-et').value,
          memo: root.querySelector('#f-memo').value
        };
        if (!rec.title) { alert('題名を入れてください'); return; }
        if (!rec.start) { alert('日付を入れてください'); return; }
        if (rec.end < rec.start) rec.end = rec.start;
        if (rec.allDay) { rec.st = ''; rec.et = ''; }
        if (wasShared && rec.scope === 'private') {
          if (!confirm('共有をやめると、相手の画面からこの予定が消えます。よろしいですか？')) return;
          Store.remove('event', e.id);   // 相手側から消す
          delete rec.id;                 // 自分の端末だけに作り直す
        }
        var saved = Store.put('event', rec);
        sel = saved.start;
        PB.App.closeModal(); render(); PB.App.refreshSync();
        PB.App.toast('保存しました');
      };
    });
  }

  /* ---------- 組み立て ---------- */
  PB.Cal = {
    init: function (store) {
      Store = store;
      document.getElementById('prevMonth').onclick = function () { cur = new Date(cur.getFullYear(), cur.getMonth() - 1, 1); render(); };
      document.getElementById('nextMonth').onclick = function () { cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1); render(); };
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
        if (d === sel) { openEvent(null, d); return; }
        sel = d;
        if (U.parse(d).getMonth() !== cur.getMonth()) cur = new Date(U.parse(d).getFullYear(), U.parse(d).getMonth(), 1);
        render();
      };
      document.getElementById('dayPanel').onclick = function (ev) {
        var b = ev.target.closest('[data-ev]'); if (!b) return;
        openEvent(b.dataset.ev);
      };
      render();
    },
    render: render,
    add: function () { openEvent(null, sel); }
  };
})(window);

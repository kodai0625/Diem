/* Diem カレンダー画面

   2026-09-29 にタイムツリーの操作感へ寄せて作り直した。
   ・月は左右にスワイプして送る（矢印も残す）。表はいつも6週で、送っても高さが変わらない
   ・何日かにまたがる予定は、週の中で1本の帯として引く
   ・予定は題名だけで保存できる。日付・時刻・メモは「詳しく」の中
   ・「これから」の画面で、近い予定を日付順に並べて見る

   2026-10-11 に足したもの（ko-dai さんの指示）
   ・特別な予定（記念日・誕生日・旅行）の強調、記念日からの日数
   ・くり返し（毎週・毎月・毎年）と、予定の複製
   ・祝日の表示（計算は holidays.js）
   ・相手が足した・直した予定の「新着」のしるし（覚えるのは store.js）
   ・予定の検索（「これから」の上の欄） */
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

  /** 予定の色は、人ではなく「2人の予定か、自分だけか」で分ける（2026-09-30 から） */
  function evColor(e) { return css(e.scope === 'private' ? '--mine' : '--shared'); }

  /* ---------- 特別な予定（記念日・誕生日・旅行）と、くり返し（2026-10-11） ----------
     ・kind … 'anniv'（記念日）／'birth'（誕生日）／'trip'（旅行）／''（ふつう）。月の表や一覧で強調して出す
     ・repeat … 'week'（毎週）／'month'（毎月）／'year'（毎年）／''（くり返さない）。入れるのは最初の1回だけ
       ★くり返す予定は1日だけのものとして扱う（始まる日だけを見る。時刻は付けられる）
       ★その日が無い月は月末に出す（31日→30日、2月29日→2月28日）
       ★until（終わる日）があれば、その日まで。空なら、ずっと
       ★1回だけ消す・1回だけ直す、はできない。直すと全部の回が変わる
     ・前の形（yearly: true だけ）も「毎年」として読む。前からある予定には何も無い＝ふつう・くり返さない
       （データの形は変えていない。項目が増えただけなので、Apps Script もシートも直していない） */
  var KINDS = { anniv: '記念日', birth: '誕生日', trip: '旅行' };
  var REPEATS = { week: '毎週', month: '毎月', year: '毎年' };
  function kindOf(e) { return KINDS[e.kind] ? e.kind : ''; }
  function repOf(e) { return REPEATS[e.repeat] ? e.repeat : (e.yearly ? 'year' : ''); }
  function lastDay(y, m) { return new Date(y, m, 0).getDate(); }      // m は 1〜12
  /** くり返す予定が、その年・その月に来る日 */
  function monthlyDate(e, y, m) {
    return y + '-' + U.pad(m) + '-' + U.pad(Math.min(+e.start.slice(8, 10), lastDay(y, m)));
  }
  function yearlyDate(e, y) { return monthlyDate(e, y, +e.start.slice(5, 7)); }
  /** その日に、この予定があるか */
  function occursOn(e, dateStr) {
    var r = repOf(e);
    if (!r) return dateStr >= e.start && dateStr <= (e.end || e.start);
    if (dateStr < e.start || (e.until && dateStr > e.until)) return false;
    if (r === 'week') return daysBetween(e.start, dateStr) % 7 === 0;
    var y = +dateStr.slice(0, 4), m = +dateStr.slice(5, 7);
    return (r === 'month' ? monthlyDate(e, y, m) : yearlyDate(e, y)) === dateStr;
  }
  /** 今日以降で一番近い「その日」。くり返しが終わっていれば ''（くり返さない予定は、始まる日） */
  function nextDate(e, todayStr) {
    var r = repOf(e), d;
    if (!r) return e.start;
    if (todayStr <= e.start) d = e.start;
    else if (r === 'week') {
      d = U.ymd(U.addDays(U.parse(e.start), Math.ceil(daysBetween(e.start, todayStr) / 7) * 7));
    } else if (r === 'month') {
      var y = +todayStr.slice(0, 4), m = +todayStr.slice(5, 7);
      d = monthlyDate(e, y, m);
      if (d < todayStr) { m++; if (m > 12) { m = 1; y++; } d = monthlyDate(e, y, m); }
    } else {
      var yy = +todayStr.slice(0, 4);
      d = yearlyDate(e, yy);
      if (d < todayStr) d = yearlyDate(e, yy + 1);
    }
    return (e.until && d > e.until) ? '' : d;
  }
  /** 何回目か（記念日＝◯周年、誕生日＝◯歳）。毎年くり返すものだけ。はじめの年は出さない */
  function countLabel(e, dateStr) {
    if (repOf(e) !== 'year' || (e.kind !== 'anniv' && e.kind !== 'birth')) return '';
    var n = +dateStr.slice(0, 4) - +e.start.slice(0, 4);
    if (n <= 0) return '';
    return n + (e.kind === 'birth' ? '歳' : '周年');
  }
  /** 記念日からの日数（はじめの日を1日目と数える）。まだ来ていない記念日は出さない */
  function dayCount(e, dateStr) {
    if (e.kind !== 'anniv' || dateStr < e.start) return '';
    return (daysBetween(e.start, dateStr) + 1).toLocaleString('ja-JP') + '日目';
  }
  /** くり返しの中身を言葉で（毎週 月曜日／毎月 15日／毎年 10月17日） */
  function repeatWords(e) {
    var r = repOf(e);
    if (!r) return '';
    if (r === 'week') return '毎週 ' + U.wday[U.parse(e.start).getDay()] + '曜日';
    if (r === 'month') return '毎月 ' + (+e.start.slice(8, 10)) + '日';
    return '毎年 ' + (+e.start.slice(5, 7)) + '月' + (+e.start.slice(8, 10)) + '日';
  }
  /** 祝日の名前（holidays.js が無ければ空） */
  function holiday(dateStr) { return PB.Holidays ? PB.Holidays.name(dateStr) : ''; }
  /** 帯の色：特別な予定はその種類の色、ほかは「2人の予定か、自分だけか」の色 */
  function barColor(e) { var k = kindOf(e); return k ? css('--k-' + k) : evColor(e); }
  function daysBetween(a, b) { return Math.round((U.parse(b) - U.parse(a)) / 86400000); }

  /* ---------- 状態 ---------- */
  var cur = U.today();
  cur = new Date(cur.getFullYear(), cur.getMonth(), 1);   // 表示している月の1日
  var sel = U.ymd(U.today());                             // 選んでいる日
  var filter = 'all';
  var query = '';                                         // 「これから」の検索の言葉
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
      return passFilter(e) && occursOn(e, dateStr);
    }).sort(byTime);
  }

  /** その日の「見るだけの項目」。追加の機能（PB.Extra）が入っているときだけ出る。自分だけの側のものとして扱う */
  function extrasOn(dateStr) {
    if (filter === 'shared') return [];
    return (PB.Extra && PB.Extra.on(dateStr)) || [];
  }

  /* ---------- 月の表 ---------- */

  /** 1週間分の帯を、重ならないように段へ振り分ける */
  function layoutWeek(days) {
    var first = days[0], last = days[6];
    var items = [];

    Store.list('event').forEach(function (e) {
      if (!passFilter(e)) return;
      if (repOf(e)) {                          // くり返す予定は、その日に1日だけ
        days.forEach(function (d, i) {
          if (occursOn(e, d)) items.push({ kind: 'event', rec: e, sc: i, ec: i, contL: false, contR: false });
        });
        return;
      }
      var s = e.start, t = e.end || e.start;
      if (t < first || s > last) return;
      var sc = Math.max(0, days.indexOf(s < first ? first : s));
      var ec = days.indexOf(t > last ? last : t);
      if (ec < 0) ec = 6;
      items.push({ kind: 'event', rec: e, sc: sc, ec: ec, contL: s < first, contR: t > last });
    });
    days.forEach(function (d, i) {
      extrasOn(d).forEach(function (t) {
        items.push({ kind: 'extra', rec: t, sc: i, ec: i, contL: false, contR: false });
      });
    });

    // 長いもの・早く始まるものを上の段に
    items.sort(function (a, b) {
      if (a.sc !== b.sc) return a.sc - b.sc;
      var la = a.ec - a.sc, lb = b.ec - b.sc;
      if (la !== lb) return lb - la;
      if (a.kind !== b.kind) return a.kind === 'event' ? -1 : 1;
      if (a.kind !== 'event') return 0;
      var ka = kindOf(a.rec) ? 0 : 1, kb = kindOf(b.rec) ? 0 : 1;   // 特別な予定を上の段に（あふれて隠れないように）
      if (ka !== kb) return ka - kb;
      return byTime(a.rec, b.rec);
    });

    // 祝日の名前は、いつも一番上の段（日付の数字のすぐ下）に置く。予定はその下から詰める
    var used = [];       // used[段][列] = 埋まっているか
    function free(l, sc, ec) {
      if (!used[l]) return true;
      for (var c = sc; c <= ec; c++) if (used[l][c]) return false;
      return true;
    }
    function take(l, sc, ec) {
      if (!used[l]) used[l] = [];
      for (var c = sc; c <= ec; c++) used[l][c] = true;
    }
    var hols = [];
    days.forEach(function (d, i) {
      var h = PB.Holidays ? PB.Holidays.short(d) : '';
      if (!h) return;
      take(0, i, i);
      hols.push({ kind: 'holiday', title: h, sc: i, ec: i, lane: 0, contL: false, contR: false });
    });
    items.forEach(function (it) {
      var l = 0;
      while (!free(l, it.sc, it.ec)) l++;
      take(l, it.sc, it.ec);
      it.lane = l;
    });
    return hols.concat(items);
  }

  function barHtml(it) {
    var cls = ['bar2'];
    var style = 'left:calc(100% / 7 * ' + it.sc + ' + 2px);'
      + 'width:calc(100% / 7 * ' + (it.ec - it.sc + 1) + ' - 4px);'
      + 'top:' + (21 + it.lane * 17) + 'px;';
    var title;
    if (it.kind === 'holiday') {                       // 祝日は、色を塗らない赤い字だけ
      return '<span class="bar2 hol" style="' + style + '">' + U.esc(it.title) + '</span>';
    }
    if (it.kind === 'extra') {
      cls.push(PB.Extra.barClass(it.rec));              // 見た目は追加の機能の側で決める
      title = it.rec.title;
    } else {
      var e = it.rec;
      if (e.scope === 'private') cls.push('priv');
      if (kindOf(e)) cls.push('k-' + kindOf(e));
      if (fresh[e.id]) cls.push('fresh');             // 相手が足した・直した予定
      style += '--c:' + barColor(e) + ';';
      title = e.title || '（題名なし）';          // 表は題名だけ（幅が狭いので時刻は下の一覧で見せる）
    }
    if (it.contL) cls.push('contL');
    if (it.contR) cls.push('contR');
    return '<span class="' + cls.join(' ') + '" style="' + style + '">' + U.esc(title) + '</span>';
  }

  var fresh = {};      // 相手が足した・直した予定のしるし（描くたびに読み直す）

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

      // 記念日・誕生日のある日（帯が段からあふれても分かるよう、升目そのものにしるしを付ける）
      var mark = ['', '', '', '', '', '', ''];
      items.forEach(function (it) {
        if (it.kind !== 'event') return;
        var k = kindOf(it.rec);
        if (k !== 'anniv' && k !== 'birth') return;
        for (var c = it.sc; c <= it.ec; c++) if (!mark[c] || k === 'anniv') mark[c] = k;
      });

      html += '<div class="week"><div class="days">';
      days.forEach(function (s, c) {
        var d = U.parse(s);
        var cls = ['cell', 's' + d.getDay()];
        if (d.getMonth() !== cur.getMonth()) cls.push('out');
        if (s === todayStr) cls.push('today');
        if (s === sel) cls.push('sel');
        if (mark[c]) cls.push('sp', 'k-' + mark[c]);
        var hn = holiday(s);
        if (hn) cls.push('hol');
        html += '<button type="button" class="' + cls.join(' ') + '" data-date="' + s + '" aria-label="' + U.label(s)
             + (hn ? '　' + hn : '') + (mark[c] ? '（' + KINDS[mark[c]] + '）' : '') + '">'
             + (mark[c] ? '<i class="spmark" aria-hidden="true"></i>' : '')
             + '<span class="dnum">' + d.getDate() + '</span>'
             + (over[c] ? '<span class="more">+' + over[c] + '</span>' : '')
             + '</button>';
      });
      html += '</div><div class="bars">';
      items.forEach(function (it) { if (it.lane < LANES) html += barHtml(it); });
      html += '</div></div>';
    }

    grid.innerHTML = html;
    var ml = document.getElementById('monthLabel');
    ml.innerHTML = '<span class="yy">' + cur.getFullYear() + '</span>'
      + '<span class="mm">' + (cur.getMonth() + 1) + '<small>月</small></span>';
    ml.setAttribute('aria-label', cur.getFullYear() + '年' + (cur.getMonth() + 1) + '月');
  }

  /* ---------- その日の中身 ---------- */
  /** 一覧の1行。on＝いま出している日（「◯周年」「◯日目」を数えるのに使う） */
  function rowHtml(e, on) {
    var k = kindOf(e), r = repOf(e);
    var c = barColor(e);
    var time = e.allDay ? '終日' : ((e.st || '') + (e.et ? '〜' + e.et : ''));
    var span = (!r && e.end && e.end !== e.start) ? '　' + U.short(e.start) + '〜' + U.short(e.end) : '';
    var bits = [];
    if (k) { var cnt = on ? countLabel(e, on) : ''; bits.push(KINDS[k] + (cnt ? '・' + cnt : '')); }
    if (!(k && r === 'year' && e.allDay)) bits.push(time + span);      // 毎年の記念日・誕生日は「終日」を省く
    if (r) bits.push(REPEATS[r]);
    if (on && dayCount(e, on)) bits.push(dayCount(e, on));
    if (e.memo) bits.push(e.memo.replace(/\n/g, ' '));
    var f = fresh[e.id];
    return '<div class="card' + (k ? ' sp k-' + k : '') + '"><button type="button" class="row" data-ev="' + e.id + '">'
      + '<span class="bar' + (e.scope === 'private' ? ' priv' : '') + '" style="--c:' + c + '"></span>'
      + '<span class="body"><span class="ttl">'
        + (f ? '<em class="newtag">' + (f === 'new' ? '新着' : '変更') + '</em>' : '')
        + (k ? '<i class="kicon k-' + k + '"></i>' : '') + U.esc(e.title || '（題名なし）') + '</span>'
      + '<span class="sub">' + U.esc(bits.join('　')) + '</span></span>'
      + (e.scope === 'private'
          ? '<span class="tag priv">自分だけ</span>'
          : '<span class="tag">' + U.esc(e.owner || '') + '</span>')
      + '</button></div>';
  }

  function renderDay() {
    var el = document.getElementById('dayPanel');
    var evs = eventsOn(sel);
    var xs = extrasOn(sel);
    var n = evs.length + xs.length;
    var hn = holiday(sel);
    var html = '<div class="dayttl"><b>' + U.label(sel) + '</b>' + (hn ? '<span class="holname">' + U.esc(hn) + '</span>' : '')
      + '<span>' + (n ? n + '件' : '予定なし') + '</span></div>';
    if (!n) {
      html += '<div class="card"><div class="empty">この日の予定はまだありません。<br>右下の ＋ か、この日をもう一度押すと足せます</div></div>';
    } else {
      evs.forEach(function (e) { html += rowHtml(e, sel); });
      xs.forEach(function (t) { html += PB.Extra.rowHtml(t); });
      if (xs.length && PB.Extra.dayHint) html += '<div class="hint" style="margin:2px 4px 0">' + U.esc(PB.Extra.dayHint) + '</div>';
    }
    el.innerHTML = html;
  }

  /* ---------- もうすぐ（近い記念日・誕生日・旅行を、あと何日かで出す） ---------- */
  function soonList(today) {
    var limit = U.ymd(U.addDays(U.parse(today), 365));     // 1年先まで
    var out = [];
    Store.list('event').forEach(function (e) {
      if (!kindOf(e)) return;
      var end = e.end || e.start;
      if (!repOf(e) && end < today) return;                 // 終わった旅行・1回きりの記念日は出さない
      var d = nextDate(e, today);
      if (!d || d > limit) return;                          // くり返しが終わったもの・1年より先のものは出さない
      out.push({ rec: e, date: d, left: daysBetween(today, d), going: !repOf(e) && e.start < today });
    });
    out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return out.slice(0, 3);                                 // 多すぎると目立たなくなるので3件まで
  }

  function soonHtml(today) {
    var list = soonList(today);
    if (!list.length) return '';
    var h = '<div class="soon"><div class="soonttl">もうすぐ</div>';
    list.forEach(function (it) {
      var e = it.rec, k = kindOf(e);
      var cnt = countLabel(e, it.date);
      var when = it.going ? KINDS[k] + '中' : it.left === 0 ? '今日' : it.left === 1 ? '明日' : 'あと' + it.left + '日';
      var sub = it.going ? (daysBetween(e.start, today) + 1) + '日目　' + U.short(e.end || e.start) + 'まで' : U.label(it.date);
      if (dayCount(e, today)) sub += '　今日で' + dayCount(e, today);       // 記念日からの日数
      h += '<button type="button" class="soonrow k-' + k + (it.going || it.left === 0 ? ' now' : '') + '" data-ev="' + e.id + '">'
        + '<i class="kicon k-' + k + '"></i>'
        + '<span class="sbody"><span class="st">' + U.esc(e.title || '（題名なし）') + (cnt ? '<small>' + cnt + '</small>' : '') + '</span>'
        + '<span class="sd">' + U.esc(sub) + '</span></span>'
        + '<b class="sn">' + when + '</b></button>';
    });
    return h + '</div>';
  }

  /* ---------- 新着（相手が足した・直した予定。開くか「見た」を押すまで残る） ---------- */
  function freshHtml(today) {
    var ids = Object.keys(fresh);
    if (!ids.length) return '';
    var list = ids.map(function (id) {
      var e = Store.get('event', id);
      return { rec: e, date: repOf(e) ? (nextDate(e, today) || e.start) : e.start };
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var h = '<div class="freshbox"><div class="freshttl"><b>' + U.esc(Who.partner()) + 'さんからの新着</b><span>' + list.length + '件</span>'
      + '<button type="button" class="mini" id="freshSeen">全部見た</button></div>';
    list.slice(0, 6).forEach(function (it) { h += '<div class="sdate">' + U.esc(dateWords(it.date, today)) + '</div>' + rowHtml(it.rec, it.date); });
    if (list.length > 6) h += '<div class="hint" style="margin:0 4px 6px">ほか' + (list.length - 6) + '件</div>';
    return h + '</div>';
  }

  /** 日付を、年が今年でなければ年つきで */
  function dateWords(dateStr, today) {
    return (dateStr.slice(0, 4) !== today.slice(0, 4) ? dateStr.slice(0, 4) + '年' : '') + U.label(dateStr);
  }

  /* ---------- 検索（題名・メモ・種類から探す。昔の予定も出る） ---------- */
  /** 見比べやすい形にそろえる（全角半角・大文字小文字・カタカナとひらがなの違いを無くす） */
  function norm(s) {
    s = String(s == null ? '' : s);
    if (s.normalize) s = s.normalize('NFKC');
    return s.toLowerCase().replace(/[\u30a1-\u30f6]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); });
  }
  function searchHtml(q, today) {
    var words = norm(q).split(/\s+/).filter(Boolean);
    var hits = [];
    Store.list('event').forEach(function (e) {
      var k = kindOf(e);
      var text = norm([e.title, e.memo, k ? KINDS[k] : '', repOf(e) ? REPEATS[repOf(e)] : '', e.owner].join(' '));
      for (var i = 0; i < words.length; i++) if (text.indexOf(words[i]) < 0) return;
      var d = repOf(e) ? (nextDate(e, today) || e.start) : e.start;
      hits.push({ rec: e, date: d, coming: (repOf(e) ? d : (e.end || e.start)) >= today });
    });
    if (!hits.length) {
      return '<div class="card"><div class="empty">「' + U.esc(q) + '」に合う予定は見つかりませんでした</div></div>';
    }
    var coming = hits.filter(function (h) { return h.coming; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var past = hits.filter(function (h) { return !h.coming; }).sort(function (a, b) { return a.date > b.date ? -1 : 1; });
    var html = '';
    [['これから', coming], ['これまで', past]].forEach(function (g) {
      if (!g[1].length) return;
      html += '<div class="secttl">' + g[0] + '（' + g[1].length + '件）</div>';
      g[1].slice(0, 60).forEach(function (h) {
        html += '<div class="sdate">' + U.esc(dateWords(h.date, today)) + (holiday(h.date) ? '　' + U.esc(holiday(h.date)) : '') + '</div>'
          + rowHtml(h.rec, h.date);
      });
      if (g[1].length > 60) html += '<div class="hint" style="margin:0 4px 6px">ほか' + (g[1].length - 60) + '件。言葉を足すと絞れます</div>';
    });
    return html;
  }

  /* ---------- これから（近い予定を日付順に） ---------- */
  function renderFeed() {
    var el = document.getElementById('feedBody');
    if (!el) return;
    fresh = Store.fresh();
    var today = U.ymd(U.today());
    el.onclick = function (ev) {
      if (ev.target.closest('#freshSeen')) { Store.seenAll(); render(); return; }
      var b = ev.target.closest('[data-ev]'); if (!b) return;
      openEvent(b.dataset.ev);
    };
    if (query) { el.innerHTML = searchHtml(query, today); return; }
    var until = U.ymd(U.addDays(U.today(), 90));
    var byDate = {};

    Store.list('event').forEach(function (e) {
      if (repOf(e)) {                            // くり返す予定は、次に来る1回だけを出す（毎週のものが並びすぎないように）
        var occ = nextDate(e, today);
        if (occ && occ <= until) (byDate[occ] = byDate[occ] || []).push({ kind: 'event', rec: e });
        return;
      }
      var s = e.start, t = e.end || e.start;
      if (t < today || s > until) return;
      var key = s < today ? today : s;           // もう始まっているものは今日に出す
      (byDate[key] = byDate[key] || []).push({ kind: 'event', rec: e, cont: s < today });
    });
    if (PB.Extra && PB.Extra.enabled()) {
      for (var d = U.today(), k = 0; k <= 90; k++, d = U.addDays(d, 1)) {
        var ds = U.ymd(d);
        PB.Extra.on(ds).forEach(function (t) {
          (byDate[ds] = byDate[ds] || []).push({ kind: 'extra', rec: t });
        });
      }
    }

    var dates = Object.keys(byDate).sort();
    var html = freshHtml(today) + soonHtml(today);
    if (!dates.length) {
      el.innerHTML = html + '<div class="card"><div class="empty">これから90日の予定はありません。<br>右下の ＋ から足せます</div></div>';
      return;
    }
    dates.forEach(function (ds) {
      var list = byDate[ds].sort(function (a, b) {
        if (a.kind !== b.kind) return a.kind === 'event' ? -1 : 1;
        return a.kind === 'event' ? byTime(a.rec, b.rec) : 0;
      });
      var d = U.parse(ds);
      html += '<div class="feedday s' + d.getDay() + (ds === today ? ' is-today' : '') + '">'
        + '<b>' + U.rel(ds) + '</b>' + (U.rel(ds) !== U.label(ds) ? '<span>' + U.label(ds) + '</span>' : '')
        + (holiday(ds) ? '<span class="holname">' + U.esc(holiday(ds)) + '</span>' : '')
        + '</div>';
      list.forEach(function (it) {
        if (it.kind === 'extra') { html += PB.Extra.rowHtml(it.rec); return; }
        html += rowHtml(it.rec, ds);
      });
    });
    el.innerHTML = html;
  }

  function render() {
    fresh = Store.fresh();
    renderGrid(); renderDay(); renderFeed();
    // 新着があるあいだ、「これから」のタブに点を付ける
    var tab = document.querySelector('.tab[data-view="feed"]');
    if (tab) tab.classList.toggle('fresh', Object.keys(fresh).length > 0);
  }

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
  /** tpl＝複製のもと（あれば、その中身を写した新しい予定として開く） */
  function openEvent(id, dateStr, tpl) {
    var e = id ? Store.get('event', id) : null;
    var isNew = !e;
    if (id && Store.seen(id)) render();          // 開いたら、新着のしるしを外す
    if (!e) {
      e = tpl || { title: '', start: dateStr || sel, end: dateStr || sel, allDay: true,
                   st: '', et: '', memo: '', scope: 'shared', kind: '', repeat: '', until: '' };
      e.owner = Who.me();
    }
    var draft = JSON.parse(JSON.stringify(e));
    draft.kind = kindOf(e);
    draft.repeat = repOf(e);
    draft.until = e.until || '';
    // 何か詳しいことが入っている予定は、はじめから開いておく
    var openMore = !!tpl || (!isNew && (!e.allDay || (e.end && e.end !== e.start) || !!e.memo));

    function summary() {
      if (draft.repeat) {
        return repeatWords(draft) + '　' + (draft.allDay ? '終日' : ((draft.st || '時刻') + (draft.et ? '〜' + draft.et : '')));
      }
      var s = U.label(draft.start);
      if (draft.end && draft.end !== draft.start) s += '〜' + U.short(draft.end);
      s += '　' + (draft.allDay ? '終日' : ((draft.st || '時刻') + (draft.et ? '〜' + draft.et : '')));
      return s;
    }

    var html = ''
      + '<div class="evhead"><h2>' + (tpl ? '予定を足す（複製）' : isNew ? '予定を足す' : '予定を直す') + '</h2>'
      + '<button type="button" class="go small" id="f-save">保存</button></div>'
      + '<input type="text" class="bigtitle" id="f-title" value="' + U.esc(draft.title) + '" placeholder="予定の題名" enterkeyhint="done" autocomplete="off">'
      + '<div class="seg" id="f-scope">'
        + '<button type="button" data-v="shared"' + (draft.scope === 'shared' ? ' class="on"' : '') + '><i class="dot shared"></i>2人で共有</button>'
        + '<button type="button" data-v="private"' + (draft.scope === 'private' ? ' class="on"' : '') + '><i class="dot mine"></i>自分だけ</button>'
      + '</div>'
      + '<div class="seg kinds" id="f-kind" aria-label="予定の種類">'
        + '<button type="button" data-v=""' + (!draft.kind ? ' class="on"' : '') + '>ふつう</button>'
        + ['anniv', 'birth', 'trip'].map(function (k) {
            return '<button type="button" data-v="' + k + '"' + (draft.kind === k ? ' class="on"' : '') + '>'
              + '<i class="kicon k-' + k + '"></i>' + KINDS[k] + '</button>';
          }).join('')
      + '</div>'
      + '<div class="reprow">'
        + '<label for="f-repeat">くり返し</label>'
        + '<select id="f-repeat">'
          + [['', 'しない'], ['week', '毎週'], ['month', '毎月'], ['year', '毎年']].map(function (o) {
              return '<option value="' + o[0] + '"' + (draft.repeat === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
            }).join('')
        + '</select>'
        + '<span class="until" id="f-until-wrap"' + (draft.repeat ? '' : ' hidden') + '>'
          + '<label for="f-until">いつまで</label><input type="date" id="f-until" value="' + draft.until + '"></span>'
      + '</div>'
      + (tpl ? '<div class="hint" style="margin:6px 0 0">もとの予定を写しました。日付を選び直して保存してください</div>' : '')
      + '<button type="button" class="summary" id="f-toggle" aria-expanded="' + openMore + '">'
        + '<span id="f-sum">' + U.esc(summary()) + '</span><span class="chev">詳しく</span></button>'
      + '<div id="f-more"' + (openMore ? '' : ' hidden') + '>'
        + '<div class="f f2"><div><label>始まる日</label><input type="date" id="f-start" value="' + draft.start + '"></div>'
          + '<div id="f-end-wrap"' + (draft.repeat ? ' hidden' : '') + '><label>終わる日</label><input type="date" id="f-end" value="' + (draft.end || draft.start) + '"></div></div>'
        + '<div class="f"><label class="check"><input type="checkbox" id="f-allday"' + (draft.allDay ? ' checked' : '') + '> 終日</label></div>'
        + '<div class="f f2" id="f-times"' + (draft.allDay ? ' hidden' : '') + '>'
          + '<div><label>始まる時刻</label><input type="time" id="f-st" value="' + (draft.st || '') + '"></div>'
          + '<div><label>終わる時刻</label><input type="time" id="f-et" value="' + (draft.et || '') + '"></div></div>'
        + '<div class="f"><label>メモ</label><textarea id="f-memo" placeholder="場所や持ち物など">' + U.esc(draft.memo) + '</textarea></div>'
        + '<div class="hint">「自分だけ」は相手に見えません。この端末の中だけに残ります。'
          + 'くり返す予定は1日だけのものになり、直すと全部の回が変わります。「いつまで」が空なら、ずっと続きます</div>'
      + '</div>'
      + '<div class="acts">'
        + (isNew ? '' : '<button type="button" class="del" id="f-del">消す</button>')
        + (isNew ? '' : '<button type="button" id="f-dup">複製</button>')
        + '<button type="button" id="f-cancel">やめる</button>'
      + '</div>';

    PB.App.modal(html, function (root) {
      var $ = function (q) { return root.querySelector(q); };
      function sync() {
        draft.start = $('#f-start').value || draft.start;
        draft.end = $('#f-end').value || draft.start;
        draft.allDay = $('#f-allday').checked;
        draft.st = $('#f-st').value; draft.et = $('#f-et').value;
        draft.repeat = $('#f-repeat').value;
        draft.until = draft.repeat ? $('#f-until').value : '';
        $('#f-until-wrap').hidden = !draft.repeat;
        $('#f-end-wrap').hidden = !!draft.repeat;         // くり返す予定は1日だけなので、「終わる日」は出さない
        $('#f-sum').textContent = summary();
      }

      root.querySelectorAll('#f-kind button').forEach(function (b) {
        b.onclick = function () {
          var was = draft.kind;
          draft.kind = b.dataset.v;
          root.querySelectorAll('#f-kind button').forEach(function (x) { x.classList.toggle('on', x === b); });
          var yearlyKind = draft.kind === 'anniv' || draft.kind === 'birth';
          // 記念日・誕生日を選んだら、くり返しを「毎年」にしておく（外したければ「しない」に直せる）
          if (yearlyKind && was !== 'anniv' && was !== 'birth' && !$('#f-repeat').value) $('#f-repeat').value = 'year';
          // 記念日・誕生日をやめたら、自動で入れた「毎年」は外す
          if (!yearlyKind && (was === 'anniv' || was === 'birth') && $('#f-repeat').value === 'year') $('#f-repeat').value = '';
          // 旅行は終わる日を入れることが多いので、詳しい欄を開いておく
          if (draft.kind === 'trip' && $('#f-more').hidden) $('#f-toggle').click();
          sync();
        };
      });
      $('#f-repeat').onchange = sync;
      $('#f-until').onchange = sync;

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
        if (!confirm(repOf(e) ? 'くり返しの予定です。全部の回を消します。よろしいですか？' : 'この予定を消しますか？')) return;
        Store.remove('event', e.id);
        PB.App.closeModal(); render(); PB.App.refreshSync();
        PB.App.toast('消しました');
      };

      // 複製：いまの中身を写した、新しい予定の窓を開く（もとの予定は変えない）
      var dup = $('#f-dup');
      if (dup) dup.onclick = function () {
        sync();
        var copy = {
          title: $('#f-title').value.trim(), scope: draft.scope, allDay: draft.allDay,
          start: draft.start, end: draft.end || draft.start, st: draft.st, et: draft.et,
          memo: $('#f-memo').value, kind: draft.kind || '', repeat: draft.repeat || '', until: draft.until || ''
        };
        PB.App.closeModal();
        openEvent(null, null, copy);
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
          memo: $('#f-memo').value,
          kind: draft.kind || '',
          repeat: draft.repeat || '',
          until: draft.repeat ? (draft.until || '') : '',
          yearly: draft.repeat === 'year'                 // 前の形でも読めるように残す
        };
        if (!rec.title) { $('#f-title').focus(); PB.App.toast('題名を入れてください'); return; }
        if (rec.end < rec.start) rec.end = rec.start;
        if (rec.repeat) rec.end = rec.start;              // くり返す予定は、1日だけ
        if (rec.until && rec.until < rec.start) rec.until = '';
        if (rec.allDay) { rec.st = ''; rec.et = ''; }
        if (wasShared && rec.scope === 'private') {
          if (!confirm('共有をやめると、相手の画面からこの予定が消えます。よろしいですか？')) return;
          Store.remove('event', e.id);   // 相手側から消す
          delete rec.id;                 // 自分の端末だけに作り直す
        }
        var saved = Store.put('event', rec);
        // 毎年の予定は、はじめの日ではなく「いま見ている日」か「次に来る日」を選ぶ（何年も前へ飛ばないように）
        sel = !repOf(saved) ? saved.start : (occursOn(saved, sel) ? sel : (nextDate(saved, U.ymd(U.today())) || saved.start));
        var d = U.parse(sel);
        cur = new Date(d.getFullYear(), d.getMonth(), 1);
        PB.App.closeModal(); render(); PB.App.refreshSync();
        PB.App.toast('保存しました');
      }
      $('#f-save').onclick = save;

      // ★新しく足すときは、すぐ題名を打てるようにする（iPhone で鍵盤が出るよう、待たずに当てる）。複製のときは当てない
      if (isNew && !tpl) $('#f-title').focus();
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
      var fs = document.getElementById('feedSearch');
      if (fs) fs.oninput = function () { query = this.value.trim(); renderFeed(); };
      render();
    },
    render: render,
    renderFeed: renderFeed,
    add: function () { openEvent(null, sel); }
  };
})(window);

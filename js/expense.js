/* Pair Board 立替金の画面（旅行ごとの割り勘と精算） */
(function (global) {
  'use strict';
  var PB = global.PB = global.PB || {};
  var Store, U, Who;
  var curTrip = '';

  /* ---------- 計算 ---------- */

  /** 1件の立替を、誰がいくら負担するかに割る（1円の端数は先の人から） */
  function shareOf(exp, members) {
    var who = (exp.share && exp.share.length) ? exp.share : members;
    who = who.filter(function (n) { return members.indexOf(n) >= 0; });
    if (!who.length) who = members.slice();
    var order = members.filter(function (n) { return who.indexOf(n) >= 0; });
    var base = Math.floor(exp.amount / order.length);
    var rest = exp.amount - base * order.length;
    var out = {};
    order.forEach(function (n, i) { out[n] = base + (i < rest ? 1 : 0); });
    return out;
  }

  function calc(trip) {
    var members = trip.members || [];
    var exps = Store.list('expense').filter(function (e) { return e.tripId === trip.id; });
    var sets = Store.list('settle').filter(function (s) { return s.tripId === trip.id; });

    var paid = {}, owed = {}, net = {};
    members.forEach(function (n) { paid[n] = 0; owed[n] = 0; });

    var total = 0;
    exps.forEach(function (e) {
      total += e.amount;
      if (paid[e.payer] === undefined) paid[e.payer] = 0;
      paid[e.payer] += e.amount;
      var sh = shareOf(e, members);
      Object.keys(sh).forEach(function (n) { owed[n] = (owed[n] || 0) + sh[n]; });
    });

    members.forEach(function (n) { net[n] = (paid[n] || 0) - (owed[n] || 0); });
    sets.forEach(function (s) {
      if (net[s.from] === undefined) net[s.from] = 0;
      if (net[s.to] === undefined) net[s.to] = 0;
      net[s.from] += s.amount;   // 払った側は借りが減る
      net[s.to] -= s.amount;
    });

    // 誰から誰へ、を最小の回数で
    var minus = [], plus = [];
    Object.keys(net).forEach(function (n) {
      if (net[n] < -0.5) minus.push({ n: n, v: -net[n] });
      else if (net[n] > 0.5) plus.push({ n: n, v: net[n] });
    });
    minus.sort(function (a, b) { return b.v - a.v; });
    plus.sort(function (a, b) { return b.v - a.v; });

    var moves = [], i = 0, j = 0, guard = 0;
    while (i < minus.length && j < plus.length && guard++ < 200) {
      var m = Math.min(minus[i].v, plus[j].v);
      var amt = Math.round(m);
      if (amt > 0) moves.push({ from: minus[i].n, to: plus[j].n, amount: amt });
      minus[i].v -= m; plus[j].v -= m;
      if (minus[i].v < 0.5) i++;
      if (plus[j].v < 0.5) j++;
    }

    return { members: members, exps: exps, sets: sets, paid: paid, owed: owed, net: net, total: total, moves: moves };
  }

  /* ---------- 画面 ---------- */

  function trips() {
    return Store.list('trip').sort(function (a, b) {
      return (b.start || '') < (a.start || '') ? -1 : 1;
    });
  }

  function renderPicker() {
    var sel = document.getElementById('tripSelect');
    var list = trips();
    if (!list.length) { curTrip = ''; sel.innerHTML = '<option>旅行がまだありません</option>'; return list; }
    if (!curTrip || !Store.get('trip', curTrip) || Store.get('trip', curTrip).deleted) {
      curTrip = Store.meta().lastTrip && Store.get('trip', Store.meta().lastTrip) && !Store.get('trip', Store.meta().lastTrip).deleted
        ? Store.meta().lastTrip : list[0].id;
    }
    sel.innerHTML = list.map(function (t) {
      return '<option value="' + t.id + '"' + (t.id === curTrip ? ' selected' : '') + '>' + U.esc(t.name) + '</option>';
    }).join('');
    return list;
  }

  function render() {
    var list = renderPicker();
    var body = document.getElementById('expBody');
    if (!list.length) {
      body.innerHTML = '<div class="card"><div class="empty">旅行を作ると、立て替えたお金を記録できます。<br>「旅行を足す」から始めてください</div></div>';
      return;
    }
    var trip = Store.get('trip', curTrip);
    var r = calc(trip);
    var perHead = r.members.length ? Math.round(r.total / r.members.length) : 0;

    var h = '';
    h += '<div class="sum">'
      + '<div class="box"><div class="k">かかった合計</div><div class="v">' + U.yen(r.total) + '</div></div>'
      + '<div class="box"><div class="k">1人あたり</div><div class="v">' + U.yen(perHead) + '</div></div>'
      + '</div>';

    // 精算
    h += '<div class="secttl">精算</div><div class="card">';
    if (!r.moves.length) {
      h += '<div class="done">' + (r.total ? '精算は終わっています' : 'まだ記録がありません') + '</div>';
    } else {
      r.moves.forEach(function (m, i) {
        h += '<div class="settle">'
          + '<span class="who"><b style="color:' + Who.color(m.from) + '">' + U.esc(m.from) + '</b>'
          + ' <span class="arrow">→</span> <b style="color:' + Who.color(m.to) + '">' + U.esc(m.to) + '</b></span>'
          + '<span class="amt">' + U.yen(m.amount) + '</span>'
          + '<button type="button" class="mini" data-pay="' + i + '">返した</button>'
          + '</div>';
      });
    }
    h += '</div>';

    // 内訳
    h += '<div class="secttl">1人ずつの内訳</div><div class="card">';
    r.members.forEach(function (n) {
      var v = Math.round(r.net[n] || 0);
      var s = v === 0 ? '差し引きなし' : (v > 0 ? U.yen(v) + ' 受け取る' : U.yen(-v) + ' 払う');
      h += '<div class="who-line"><span><b style="color:' + Who.color(n) + '">' + U.esc(n) + '</b>'
        + ' <span style="color:var(--dim);font-size:12px">立替 ' + U.yen(r.paid[n] || 0) + ' ／ 負担 ' + U.yen(r.owed[n] || 0) + '</span></span>'
        + '<span class="' + (v > 0 ? 'pos' : (v < 0 ? 'neg' : '')) + '">' + s + '</span></div>';
    });
    h += '</div>';

    // 明細
    h += '<div class="secttl">立て替えた記録（' + r.exps.length + '件）</div>';
    if (!r.exps.length) {
      h += '<div class="card"><div class="empty">右下の ＋ から立替を足せます</div></div>';
    } else {
      var sorted = r.exps.slice().sort(function (a, b) { return (a.date || '') < (b.date || '') ? 1 : -1; });
      h += '<div class="card">';
      sorted.forEach(function (e, i) {
        var whoShare = (e.share && e.share.length && e.share.length < r.members.length)
          ? e.share.join('・') + 'の分' : '全員の分';
        h += '<div class="settle"><button type="button" class="row" data-exp="' + e.id + '">'
          + '<span class="bar" style="--c:' + Who.color(e.payer) + '"></span>'
          + '<span class="body"><span class="ttl">' + U.esc(e.title || '（内容なし）') + '</span>'
          + '<span class="sub">' + U.esc(U.short(e.date) + '　' + e.payer + 'が立替　' + whoShare) + '</span></span>'
          + '<span class="amtcell">' + U.yen(e.amount) + '</span>'
          + '</button></div>';
      });
      h += '</div>';
    }

    // 返した記録
    if (r.sets.length) {
      h += '<div class="secttl">返した記録</div><div class="card">';
      r.sets.slice().sort(function (a, b) { return (a.date || '') < (b.date || '') ? 1 : -1; }).forEach(function (s) {
        h += '<div class="settle"><span class="who">' + U.esc(U.short(s.date)) + '　'
          + U.esc(s.from) + ' → ' + U.esc(s.to) + '</span>'
          + '<span class="amtcell">' + U.yen(s.amount) + '</span>'
          + '<button type="button" class="mini" data-unpay="' + s.id + '">消す</button></div>';
      });
      h += '</div>';
    }

    body.innerHTML = h;

    body.querySelectorAll('[data-pay]').forEach(function (b) {
      b.onclick = function () { payBack(r.moves[+b.dataset.pay]); };
    });
    body.querySelectorAll('[data-unpay]').forEach(function (b) {
      b.onclick = function () {
        if (!confirm('この「返した記録」を消しますか？')) return;
        Store.remove('settle', b.dataset.unpay); render(); PB.App.refreshSync();
      };
    });
    body.querySelectorAll('[data-exp]').forEach(function (b) {
      b.onclick = function () { openExpense(b.dataset.exp); };
    });
  }

  /* ---------- 返した ---------- */
  function payBack(move) {
    var msg = move.from + ' → ' + move.to + ' に ' + U.yen(move.amount) + ' 返しましたか？\n（一部だけ返したときは、あとで金額を直せます）';
    if (!confirm(msg)) return;
    Store.put('settle', {
      tripId: curTrip, from: move.from, to: move.to,
      amount: move.amount, date: U.ymd(U.today())
    });
    render(); PB.App.refreshSync();
    PB.App.toast('返した記録を足しました');
  }

  /* ---------- 立替の入力窓 ---------- */
  function openExpense(id) {
    var trip = Store.get('trip', curTrip);
    if (!trip) { alert('先に旅行を足してください'); return; }
    var members = trip.members || [];
    var e = id ? Store.get('expense', id) : null;
    var isNew = !e;
    if (!e) {
      var d = U.ymd(U.today());
      if (trip.start && d < trip.start) d = trip.start;
      if (trip.end && d > trip.end) d = trip.end;
      e = { tripId: trip.id, date: d, title: '', amount: 0, payer: Who.me(), share: members.slice() };
    }
    if (members.indexOf(e.payer) < 0 && members.length) e.payer = members[0];
    var share = (e.share && e.share.length) ? e.share.slice() : members.slice();
    var payer = e.payer;

    var h = ''
      + '<h2>' + (isNew ? '立替を足す' : '立替を直す') + '</h2>'
      + '<div class="f f2"><div><label>日付</label><input type="date" id="x-date" value="' + (e.date || '') + '"></div>'
      + '<div><label>金額</label><input type="number" id="x-amt" inputmode="numeric" step="1" value="' + (e.amount || '') + '" placeholder="0"></div></div>'
      + '<div class="f"><label>内容</label><input type="text" id="x-title" value="' + U.esc(e.title) + '" placeholder="例）新幹線・宿・晩ごはん"></div>'
      + '<div class="f"><label>払った人</label><div class="seg who" id="x-payer">'
      + members.map(function (n) {
          return '<button type="button" data-n="' + U.esc(n) + '" style="--c:' + Who.color(n) + '"'
            + (n === payer ? ' class="on"' : '') + '>' + U.esc(n) + '</button>';
        }).join('')
      + '</div></div>'
      + '<div class="f"><label>誰の分か（割り勘する相手）</label>'
      + members.map(function (n) {
          return '<label class="check"><input type="checkbox" class="x-share" value="' + U.esc(n) + '"'
            + (share.indexOf(n) >= 0 ? ' checked' : '') + '> ' + U.esc(n) + '</label>';
        }).join('')
      + '</div>'
      + '<div class="hint">1人だけに印を付ければ「その人の分を立て替えた」になります</div>'
      + '<div class="acts">'
      + (isNew ? '' : '<button type="button" class="del" id="x-del">消す</button>')
      + '<button type="button" id="x-cancel">やめる</button>'
      + '<button type="button" class="go" id="x-save">保存</button></div>';

    PB.App.modal(h, function (root) {
      root.querySelectorAll('#x-payer button').forEach(function (b) {
        b.onclick = function () {
          payer = b.dataset.n;
          root.querySelectorAll('#x-payer button').forEach(function (x) { x.classList.toggle('on', x === b); });
        };
      });
      root.querySelector('#x-cancel').onclick = PB.App.closeModal;
      var del = root.querySelector('#x-del');
      if (del) del.onclick = function () {
        if (!confirm('この記録を消しますか？')) return;
        Store.remove('expense', e.id);
        PB.App.closeModal(); render(); PB.App.refreshSync();
      };
      root.querySelector('#x-save').onclick = function () {
        var amt = Math.round(Number(root.querySelector('#x-amt').value) || 0);
        if (amt <= 0) { alert('金額を入れてください'); return; }
        var sh = [];
        root.querySelectorAll('.x-share').forEach(function (c) { if (c.checked) sh.push(c.value); });
        if (!sh.length) { alert('誰の分かを1人以上選んでください'); return; }
        Store.put('expense', {
          id: e.id, tripId: trip.id,
          date: root.querySelector('#x-date').value || U.ymd(U.today()),
          title: root.querySelector('#x-title').value.trim(),
          amount: amt, payer: payer, share: sh
        });
        PB.App.closeModal(); render(); PB.App.refreshSync();
        PB.App.toast('保存しました');
      };
    });
  }

  /* ---------- 旅行の入力窓 ---------- */
  function openTrip(id) {
    var t = id ? Store.get('trip', id) : null;
    var isNew = !t;
    if (!t) {
      var d = U.ymd(U.today());
      t = { name: '', start: d, end: d, members: [Who.me(), Who.partner()] };
    }
    var h = ''
      + '<h2>' + (isNew ? '旅行を足す' : '旅行を直す') + '</h2>'
      + '<div class="f"><label>名前</label><input type="text" id="t-name" value="' + U.esc(t.name) + '" placeholder="例）沖縄旅行"></div>'
      + '<div class="f f2"><div><label>始まる日</label><input type="date" id="t-start" value="' + (t.start || '') + '"></div>'
      + '<div><label>終わる日</label><input type="date" id="t-end" value="' + (t.end || '') + '"></div></div>'
      + '<div class="f"><label>行く人（1行に1人）</label><textarea id="t-mem">' + U.esc((t.members || []).join('\n')) + '</textarea></div>'
      + '<div class="hint">2人以外と行くときは、ここに名前を足してください</div>'
      + '<div class="acts">'
      + (isNew ? '' : '<button type="button" class="del" id="t-del">消す</button>')
      + '<button type="button" id="t-cancel">やめる</button>'
      + '<button type="button" class="go" id="t-save">保存</button></div>';

    PB.App.modal(h, function (root) {
      root.querySelector('#t-cancel').onclick = PB.App.closeModal;
      var del = root.querySelector('#t-del');
      if (del) del.onclick = function () {
        var n = Store.list('expense').filter(function (x) { return x.tripId === t.id; }).length;
        if (!confirm('この旅行を消しますか？　立替の記録' + n + '件も一緒に消えます')) return;
        Store.list('expense').forEach(function (x) { if (x.tripId === t.id) Store.remove('expense', x.id); });
        Store.list('settle').forEach(function (x) { if (x.tripId === t.id) Store.remove('settle', x.id); });
        Store.remove('trip', t.id);
        curTrip = '';
        PB.App.closeModal(); render(); PB.App.refreshSync();
      };
      root.querySelector('#t-save').onclick = function () {
        var name = root.querySelector('#t-name').value.trim();
        if (!name) { alert('名前を入れてください'); return; }
        var mem = root.querySelector('#t-mem').value.split('\n')
          .map(function (s) { return s.trim(); }).filter(function (s) { return s; });
        if (mem.length < 1) { alert('行く人を入れてください'); return; }
        var saved = Store.put('trip', {
          id: t.id, name: name,
          start: root.querySelector('#t-start').value,
          end: root.querySelector('#t-end').value,
          members: mem
        });
        curTrip = saved.id;
        Store.meta().lastTrip = curTrip; Store.saveMeta();
        PB.App.closeModal(); render(); PB.App.refreshSync();
        PB.App.toast('保存しました');
      };
    });
  }

  PB.Exp = {
    init: function (store) {
      Store = store; U = PB.U; Who = PB.Who;
      document.getElementById('tripSelect').onchange = function () {
        curTrip = this.value;
        Store.meta().lastTrip = curTrip; Store.saveMeta();
        render();
      };
      document.getElementById('addTrip').onclick = function () { openTrip(null); };
      document.getElementById('editTrip').onclick = function () {
        if (!curTrip) { alert('先に旅行を足してください'); return; }
        openTrip(curTrip);
      };
      render();
    },
    render: render,
    add: function () {
      if (!curTrip) { openTrip(null); return; }
      openExpense(null);
    }
  };
})(window);

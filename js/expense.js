/* Pair Board 立替金の画面

   ・旅行にひもづけません。**立て替えて払ったら、そのまま1件として記録します**（2026-09-29 に変更）
   ・精算は、まだ返していないぶん全部をまとめて計算します
   ・前に旅行ごとに付けていた記録も、そのまま混ぜて数えます
     （旅行の名前が残っているものは、小さな札で見えるようにしてあります） */
(function (global) {
  'use strict';
  var PB = global.PB = global.PB || {};
  var Store, U, Who;

  /* ---------- 誰がいるか ---------- */

  /** 自分と相手。古い記録に別の人がいれば、その人も足す */
  function members() {
    var list = [Who.me(), Who.partner()];
    function add(n) { if (n && list.indexOf(n) < 0) list.push(n); }
    Store.list('expense').forEach(function (e) {
      add(e.payer);
      (e.share || []).forEach(add);
    });
    Store.list('settle').forEach(function (s) { add(s.from); add(s.to); });
    return list;
  }

  /* ---------- 計算 ---------- */

  /** 1件の立替を、誰がいくら負担するかに割る（1円の端数は先の人から） */
  function shareOf(exp, mem) {
    var who = (exp.share && exp.share.length) ? exp.share : mem;
    who = who.filter(function (n) { return mem.indexOf(n) >= 0; });
    if (!who.length) who = mem.slice();
    var order = mem.filter(function (n) { return who.indexOf(n) >= 0; });
    var base = Math.floor(exp.amount / order.length);
    var rest = exp.amount - base * order.length;
    var out = {};
    order.forEach(function (n, i) { out[n] = base + (i < rest ? 1 : 0); });
    return out;
  }

  function calc() {
    var mem = members();
    var exps = Store.list('expense');
    var sets = Store.list('settle');

    var paid = {}, owed = {}, net = {};
    mem.forEach(function (n) { paid[n] = 0; owed[n] = 0; });

    var total = 0;
    exps.forEach(function (e) {
      total += e.amount;
      paid[e.payer] = (paid[e.payer] || 0) + e.amount;
      var sh = shareOf(e, mem);
      Object.keys(sh).forEach(function (n) { owed[n] = (owed[n] || 0) + sh[n]; });
    });

    mem.forEach(function (n) { net[n] = (paid[n] || 0) - (owed[n] || 0); });
    sets.forEach(function (s) {
      net[s.from] = (net[s.from] || 0) + s.amount;   // 払った側は借りが減る
      net[s.to] = (net[s.to] || 0) - s.amount;
    });

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
    return { members: mem, exps: exps, sets: sets, paid: paid, owed: owed, net: net, total: total, moves: moves };
  }

  /* ---------- 画面 ---------- */

  /** 古い記録に残っている旅行の名前（あれば） */
  function tripName(e) {
    if (!e.tripId) return '';
    var t = Store.get('trip', e.tripId);
    return (t && !t.deleted && t.name) ? t.name : '';
  }

  function render() {
    var body = document.getElementById('expBody');
    var r = calc();
    var perHead = r.members.length ? Math.round(r.total / r.members.length) : 0;
    var h = '';

    if (!r.exps.length && !r.sets.length) {
      body.innerHTML = '<div class="card"><div class="empty">'
        + '立て替えて払ったら、右下の ＋ から記録してください。<br>'
        + 'あとで「誰が誰へいくら返すか」を計算します</div></div>';
      return;
    }

    h += '<div class="sum">'
      + '<div class="box"><div class="k">立て替えた合計</div><div class="v">' + U.yen(r.total) + '</div></div>'
      + '<div class="box"><div class="k">1人あたり</div><div class="v">' + U.yen(perHead) + '</div></div>'
      + '</div>';

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

    h += '<div class="secttl">1人ずつの内訳</div><div class="card">';
    r.members.forEach(function (n) {
      var v = Math.round(r.net[n] || 0);
      var s = v === 0 ? '差し引きなし' : (v > 0 ? U.yen(v) + ' 受け取る' : U.yen(-v) + ' 払う');
      h += '<div class="who-line"><span><b style="color:' + Who.color(n) + '">' + U.esc(n) + '</b>'
        + ' <span style="color:var(--dim);font-size:12px">立替 ' + U.yen(r.paid[n] || 0) + ' ／ 負担 ' + U.yen(r.owed[n] || 0) + '</span></span>'
        + '<span class="' + (v > 0 ? 'pos' : (v < 0 ? 'neg' : '')) + '">' + s + '</span></div>';
    });
    h += '</div>';

    h += '<div class="secttl">立て替えた記録（' + r.exps.length + '件）</div>';
    if (!r.exps.length) {
      h += '<div class="card"><div class="empty">右下の ＋ から記録できます</div></div>';
    } else {
      var sorted = r.exps.slice().sort(function (a, b) { return (a.date || '') < (b.date || '') ? 1 : -1; });
      h += '<div class="card">';
      sorted.forEach(function (e) {
        var whoShare = (e.share && e.share.length && e.share.length < r.members.length)
          ? e.share.join('・') + 'の分' : '全員の分';
        var tn = tripName(e);
        h += '<div class="settle"><button type="button" class="row" data-exp="' + e.id + '">'
          + '<span class="bar" style="--c:' + Who.color(e.payer) + '"></span>'
          + '<span class="body"><span class="ttl">' + U.esc(e.title || '（内容なし）')
          + (tn ? ' <span class="tag">' + U.esc(tn) + '</span>' : '') + '</span>'
          + '<span class="sub">' + U.esc(U.short(e.date) + '　' + e.payer + 'が立替　' + whoShare) + '</span></span>'
          + '<span class="amtcell">' + U.yen(e.amount) + '</span>'
          + '</button></div>';
      });
      h += '</div>';
    }

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
    Store.put('settle', { from: move.from, to: move.to, amount: move.amount, date: U.ymd(U.today()) });
    render(); PB.App.refreshSync();
    PB.App.toast('返した記録を足しました');
  }

  /* ---------- 立替の入力窓 ---------- */
  function openExpense(id) {
    var mem = members();
    var e = id ? Store.get('expense', id) : null;
    var isNew = !e;
    if (!e) e = { date: U.ymd(U.today()), title: '', amount: 0, payer: Who.me(), share: [Who.me(), Who.partner()] };
    if (mem.indexOf(e.payer) < 0 && mem.length) e.payer = mem[0];
    var share = (e.share && e.share.length) ? e.share.slice() : mem.slice();
    var payer = e.payer;

    var h = ''
      + '<h2>' + (isNew ? '立替を記録する' : '立替を直す') + '</h2>'
      + '<div class="f f2"><div><label>金額</label><input type="number" id="x-amt" inputmode="numeric" step="1" value="' + (e.amount || '') + '" placeholder="0"></div>'
      + '<div><label>日付</label><input type="date" id="x-date" value="' + (e.date || '') + '"></div></div>'
      + '<div class="f"><label>何に使ったか</label><input type="text" id="x-title" value="' + U.esc(e.title) + '" placeholder="例）ごはん・電車・宿"></div>'
      + '<div class="f"><label>払った人</label><div class="seg who" id="x-payer">'
      + mem.map(function (n) {
          return '<button type="button" data-n="' + U.esc(n) + '" style="--c:' + Who.color(n) + '"'
            + (n === payer ? ' class="on"' : '') + '>' + U.esc(n) + '</button>';
        }).join('')
      + '</div></div>'
      + '<div class="f"><label>誰の分か（割り勘する相手）</label>'
      + mem.map(function (n) {
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
          id: e.id,
          tripId: e.tripId || '',          // 古い記録の名札はそのまま残す
          date: root.querySelector('#x-date').value || U.ymd(U.today()),
          title: root.querySelector('#x-title').value.trim(),
          amount: amt, payer: payer, share: sh
        });
        PB.App.closeModal(); render(); PB.App.refreshSync();
        PB.App.toast('記録しました');
      };
      var amtEl = root.querySelector('#x-amt');
      if (isNew && amtEl) amtEl.focus();   // 待たずに当てる（iPhone で鍵盤が出るように）
    });
  }

  PB.Exp = {
    init: function (store) {
      Store = store; U = PB.U; Who = PB.Who;
      var add = document.getElementById('addExpense');
      if (add) add.onclick = function () { openExpense(null); };
      render();
    },
    render: render,
    add: function () { openExpense(null); }
  };
})(window);

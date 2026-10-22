/* Diem やりたいこと（2人でやりたいこと・行きたい場所）

   2026-10-23 に足した（ko-dai さんの指示「2人でやりたいことや行きたい場所を登録しておいて、
   遊びに行く日に何をするか見れるように。登録したものに関する情報を追加で記入できるように」）

   ・記録は2種類。どちらも2人で共有するだけ（「自分だけ」は無い）
       wish  … 1件。題名・種類（やりたいこと／行きたい場所）・エリア・場所・URL・費用のめやす・メモ・
                行く日（date）・何時ごろ（time）・行った（done・doneOn）
       wnote … 1件に書き足した情報。だれがいつ書いたかを付けて、何件でも足せる
     ★書き足しを wish の中に並べて持たないのは、2人が同時に書き足したとき片方が消えないようにするため
       （同期は id ごとの上書きなので、別々の記録にしておけば両方残る）
   ・行く日を入れると、カレンダーのその日に「この日にやること」として出る（calendar.js が PB.Wish を呼ぶ）
   ・遊ぶ日を決めて、その日にやることをまとめて選べる（pick）
   ・Diem の記録に種類が増えただけなので、Apps Script もシートも直していない（store.js の KINDS に足しただけ） */
(function (global) {
  'use strict';
  var PB = global.PB = global.PB || {};
  var Store, U, Who;

  var TYPES = { do: 'やりたいこと', go: '行きたい場所' };
  var wfilter = 'all';     // all（全部）／do／go／done（行った）
  var wquery = '';         // 検索の言葉

  function typeOf(w) { return w.type === 'go' ? 'go' : 'do'; }
  function today() { return U.ymd(U.today()); }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function byMe(r) { return !r.owner || r.owner === Who.me(); }
  function whoColor(r) { return Who.color(byMe(r) ? Who.me() : Who.partner()); }
  function created(r) { return r.createdAt || r.updatedAt || 0; }

  /** 年が今年でなければ年つきで */
  function dateWords(ds) {
    return (ds.slice(0, 4) !== today().slice(0, 4) ? ds.slice(0, 4) + '年' : '') + U.label(ds);
  }
  /** 今日・明日・あと◯日 */
  function leftWords(ds) {
    var n = Math.round((U.parse(ds) - U.today()) / 86400000);
    if (n === 0) return '今日';
    if (n === 1) return '明日';
    if (n > 0) return 'あと' + n + '日';
    return (-n) + '日前';
  }
  /** 次の土曜（日曜なら今日）。遊ぶ日を選ぶ窓のはじめの日 */
  function nextHoliday() {
    var d = U.today(), w = d.getDay();
    return U.ymd(U.addDays(d, w === 0 ? 0 : 6 - w));
  }

  /* ---------- 読む ---------- */

  /** 書き足しを、やりたいことの id ごとに（古い順） */
  function groupNotes() {
    var by = {};
    Store.list('wnote').forEach(function (n) { (by[n.wishId] = by[n.wishId] || []).push(n); });
    Object.keys(by).forEach(function (id) { by[id].sort(function (a, b) { return created(a) - created(b); }); });
    return by;
  }
  function notesOf(id) { return groupNotes()[id] || []; }

  /** 同じ日の中：時刻のあるものを先に早い順、そのあと足した順 */
  function byPlan(a, b) {
    var ta = a.time || '99', tb = b.time || '99';
    if (ta !== tb) return ta < tb ? -1 : 1;
    return created(a) - created(b);
  }
  function byNew(a, b) { return created(b) - created(a); }

  /** その日にやること（行ったものも、その日の記録として出す） */
  function on(ds) {
    return Store.list('wish').filter(function (w) { return w.date === ds; }).sort(byPlan);
  }

  /* ---------- URL・地図 ---------- */
  var URL_RE = /https?:\/\/[A-Za-z0-9\-._~:\/?#\[\]@!$&'()*+,;=%]+/g;
  function linkify(text) {
    return U.esc(text).replace(URL_RE, function (u) {
      return '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>';
    });
  }
  function cleanUrl(s) {
    s = String(s || '').trim();
    if (/^www\./i.test(s)) s = 'https://' + s;
    return s;
  }
  function isLink(s) { return /^https?:\/\/\S+$/i.test(s || ''); }
  function hostOf(s) {
    var m = /^https?:\/\/([^\/?#]+)/i.exec(s || '');
    return m ? m[1].replace(/^www\./i, '') : s;
  }
  /** 地図で探す言葉（場所。エリアが場所の中に無ければ足す） */
  function mapQuery(w) {
    var q = (w.place || '').trim(), a = (w.area || '').trim();
    if (a && q.indexOf(a) < 0) q = q ? q + ' ' + a : a;
    return q;
  }

  /* ---------- 一覧の1行 ---------- */
  /** opt.date＝日付も出す　opt.notes＝書き足しの数（渡さなければ数える） */
  function rowHtml(w, opt) {
    opt = opt || {};
    var t = typeOf(w);
    var n = opt.notes != null ? opt.notes : notesOf(w.id).length;
    var bits = [];
    if (opt.date && w.date) bits.push(U.short(w.date));
    if (w.time) bits.push(w.time + 'ごろ');
    if (w.area) bits.push(w.area);
    if (w.cost) bits.push(w.cost);
    if (n) bits.push('書き足し' + n + '件');
    if (!bits.length && w.memo) bits.push(w.memo.replace(/\n/g, ' '));
    if (!bits.length) bits.push(TYPES[t]);
    return '<div class="card wcard' + (w.done ? ' wdone' : '') + '"><button type="button" class="row" data-wish="' + w.id + '">'
      + '<span class="bar wbar"></span>'
      + '<span class="body"><span class="ttl">'
        + (w.done ? '<em class="wcheck">行った</em>' : '')
        + '<i class="wicon w-' + t + '"></i>' + U.esc(w.title || '（題名なし）') + '</span>'
      + '<span class="sub">' + U.esc(bits.join('　')) + '</span></span>'
      + (w.owner ? '<span class="tag who" style="--c:' + whoColor(w) + '">' + U.esc(w.owner) + '</span>' : '')
      + '</button></div>';
  }

  /* ---------- 「やりたい」の画面 ---------- */
  function pass(w, notesBy) {
    if ((wfilter === 'do' || wfilter === 'go') && typeOf(w) !== wfilter) return false;
    if (!wquery) return true;
    var words = U.norm(wquery).split(/\s+/).filter(Boolean);
    var text = U.norm([w.title, w.area, w.place, w.url, w.cost, w.memo, w.owner, TYPES[typeOf(w)]]
      .concat((notesBy[w.id] || []).map(function (n) { return n.text; })).join(' '));
    for (var i = 0; i < words.length; i++) if (text.indexOf(words[i]) < 0) return false;
    return true;
  }

  function render() {
    var el = document.getElementById('wishBody');
    if (!el || !Store) return;
    var td = today();
    var notesBy = groupNotes();
    var all = Store.list('wish');
    function row(w, opt) { opt = opt || {}; opt.notes = (notesBy[w.id] || []).length; return rowHtml(w, opt); }

    if (!all.length) {
      el.innerHTML = '<div class="card"><div class="empty">2人でやりたいこと・行きたい場所を、右下の ＋ から足してください。'
        + '<br>行く日を決めると、カレンダーのその日に出ます</div></div>';
      return;
    }
    var list = all.filter(function (w) { return pass(w, notesBy); });
    var html = '';

    if (wfilter === 'done') {
      var done = list.filter(function (w) { return w.done; })
        .sort(function (a, b) { return (a.doneOn || '') < (b.doneOn || '') ? 1 : (a.doneOn || '') > (b.doneOn || '') ? -1 : byNew(a, b); });
      if (!done.length) {
        html = '<div class="card"><div class="empty">' + (wquery ? '「' + U.esc(wquery) + '」に合うものはありません'
          : 'まだありません。行ったら、開いて「行った」を押してください') + '</div></div>';
      } else {
        html += '<div class="secttl">行った（' + done.length + '件）</div>';
        done.forEach(function (w) { html += '<div class="sdate">' + U.esc(dateWords(w.doneOn || w.date || td)) + '</div>' + row(w); });
      }
      el.innerHTML = html;
      return;
    }

    var plan = list.filter(function (w) { return !w.done && w.date && w.date >= td; });
    var past = list.filter(function (w) { return !w.done && w.date && w.date < td; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var open = list.filter(function (w) { return !w.done && !w.date; }).sort(byNew);

    if (plan.length) {
      html += '<div class="secttl">行く日が決まっているもの</div>';
      var byDate = {};
      plan.forEach(function (w) { (byDate[w.date] = byDate[w.date] || []).push(w); });
      Object.keys(byDate).sort().forEach(function (ds) {
        var d = U.parse(ds);
        var hn = PB.Holidays ? PB.Holidays.name(ds) : '';
        html += '<div class="feedday wdate s' + d.getDay() + (ds === td ? ' is-today' : '') + '">'
          + '<b>' + U.esc(dateWords(ds)) + '</b>' + (hn ? '<span class="holname">' + U.esc(hn) + '</span>' : '')
          + '<span class="wleft">' + leftWords(ds) + '</span>'
          + '<button type="button" class="dayadd" data-wpick="' + ds + '">選ぶ</button></div>';
        byDate[ds].sort(byPlan).forEach(function (w) { html += row(w); });
      });
    }
    if (past.length) {
      html += '<div class="secttl">行く日が過ぎたもの</div>'
        + '<div class="hint" style="margin:0 4px 8px">行ったら開いて「行った」を、まだなら行く日を決め直してください</div>';
      past.forEach(function (w) { html += row(w, { date: true }); });
    }
    html += '<div class="secttl">まだ決めていない（' + open.length + '件）</div>';
    if (!open.length) {
      html += '<div class="card"><div class="empty">' + (wquery ? '「' + U.esc(wquery) + '」に合うものはありません'
        : (wfilter === 'all' ? '' : TYPES[wfilter] + 'で、') + '行く日を決めていないものはありません') + '</div></div>';
    } else {
      open.forEach(function (w) { html += row(w); });
    }
    if (wquery) {     // 探しているときは、行ったものも下に出す
      var hit = list.filter(function (w) { return w.done; }).sort(byNew);
      if (hit.length) {
        html += '<div class="secttl">行った（' + hit.length + '件）</div>';
        hit.forEach(function (w) { html += row(w); });
      }
    }
    el.innerHTML = html;
  }

  /* ---------- 1件を開く（中身を見る・行く日を決める・書き足す） ---------- */
  function planHtml(w) {
    var td = today();
    if (w.done) {
      return '<div class="wplanrow"><span class="k">行った日</span><b>' + U.esc(dateWords(w.doneOn || w.date || td)) + '</b></div>';
    }
    return '<div class="wplanrow"><label class="k" for="w-date">行く日</label>'
      + '<input type="date" id="w-date" value="' + (w.date || '') + '">'
      + (w.date ? '<span class="wtime"><label for="w-time">何時ごろ</label><input type="time" id="w-time" value="' + (w.time || '') + '"></span>' : '')
      + '</div>'
      + '<div class="wplanhint">'
      + (w.date
          ? '<b>' + leftWords(w.date) + '</b><span>カレンダーのこの日に出ます</span><button type="button" class="linkbtn" id="w-undate">未定に戻す</button>'
          : '<span>決めると、カレンダーのその日に出ます</span>')
      + '</div>';
  }

  function infoHtml(w) {
    var rows = '';
    function irow(k, v) { rows += '<div class="irow"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>'; }
    if (w.area) irow('エリア', U.esc(w.area));
    var q = mapQuery(w);
    if (w.place || q) {
      irow('場所', (w.place ? U.esc(w.place) : '')
        + '<span class="maplinks">'
        + '<a href="https://www.google.com/maps/search/?api=1&amp;query=' + encodeURIComponent(q) + '" target="_blank" rel="noopener">Googleマップ</a>'
        + '<a href="https://maps.apple.com/?q=' + encodeURIComponent(q) + '" target="_blank" rel="noopener">Appleマップ</a>'
        + '</span>');
    }
    if (w.url) {
      irow('URL', isLink(w.url)
        ? '<a href="' + U.esc(w.url) + '" target="_blank" rel="noopener">' + U.esc(hostOf(w.url)) + '</a>'
        : U.esc(w.url));
    }
    if (w.cost) irow('費用', U.esc(w.cost));
    if (w.memo) irow('メモ', linkify(w.memo));
    return rows ? '<div class="card winfo">' + rows + '</div>' : '';
  }

  function stampWords(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
  }

  function notesHtml(id) {
    var ns = notesOf(id);
    if (!ns.length) {
      return '<div class="card"><div class="empty">まだありません。営業時間・予約のこと・行き方など、<br>分かったことを下から書き足せます</div></div>';
    }
    return '<div class="card wnotes">' + ns.map(function (n) {
      return '<div class="wnote"><div class="nh"><b style="color:' + whoColor(n) + '">' + U.esc(n.owner || '') + '</b>'
        + '<span>' + stampWords(created(n)) + '</span>'
        + '<button type="button" class="nedit" data-note="' + n.id + '">直す</button></div>'
        + '<div class="nt">' + linkify(n.text) + '</div></div>';
    }).join('') + '</div>';
  }

  /** 直したあと、カレンダーと一覧を描き直して送る（カレンダーの描き直しで、この一覧も描き直される） */
  function changed(msg) {
    if (PB.Cal) PB.Cal.render(); else render();
    PB.App.refreshSync();
    if (msg) PB.App.toast(msg);
  }

  function open(id) {
    var w = Store.get('wish', id);
    if (!w || w.deleted) return;
    var t = typeOf(w);
    var html = ''
      + '<div class="evhead"><h2 class="wh"><i class="wicon w-' + t + '"></i>' + TYPES[t] + '</h2>'
      + '<button type="button" class="go small" id="w-edit">直す</button></div>'
      + '<div class="wtitle">' + U.esc(w.title || '（題名なし）') + '</div>'
      + '<div class="wby">' + (w.owner ? '<span class="tag who" style="--c:' + whoColor(w) + '">' + U.esc(w.owner) + '</span>' : '')
        + (w.createdAt ? '<span>' + U.short(U.ymd(new Date(w.createdAt))) + 'に足した</span>' : '') + '</div>'
      + '<div class="card wplan" id="w-plan">' + planHtml(w) + '</div>'
      + infoHtml(w)
      + '<div class="secttl">書き足したこと</div>'
      + '<div id="w-notes">' + notesHtml(id) + '</div>'
      + '<div class="f wadd"><textarea id="w-note" placeholder="営業時間・予約のこと・行き方・気になったことなど"></textarea></div>'
      + '<button type="button" class="mini wide wfull" id="w-addnote">書き足す</button>'
      + '<div class="acts">'
        + '<button type="button" id="w-done">' + (w.done ? 'もう一度行きたい' : '行った') + '</button>'
        + '<button type="button" class="go" id="w-close">閉じる</button>'
      + '</div>';

    PB.App.modal(html, function (root) {
      var $ = function (q) { return root.querySelector(q); };
      function cur() { return Store.get('wish', id); }
      function repaintPlan() { $('#w-plan').innerHTML = planHtml(cur()); }
      function putPlan(date, time, msg) {
        var rec = copy(cur());
        rec.date = date || '';
        rec.time = rec.date ? (time || '') : '';
        Store.put('wish', rec);
        repaintPlan();
        changed(msg);
      }

      // 行く日・何時ごろは、その場で保存する（窓を開き直さない）
      root.addEventListener('change', function (ev) {
        if (ev.target.id === 'w-date') {
          var v = ev.target.value;
          putPlan(v, cur().time, v ? U.label(v) + 'に行くことにしました' : '行く日を未定に戻しました');
        } else if (ev.target.id === 'w-time') {
          putPlan(cur().date, ev.target.value, '時刻を保存しました');
        }
      });
      root.addEventListener('click', function (ev) {
        if (ev.target.closest('#w-undate')) { putPlan('', '', '行く日を未定に戻しました'); return; }
        var ne = ev.target.closest('[data-note]');
        if (ne) editNote(ne.dataset.note);
      });

      function editNote(nid) {
        var n = Store.get('wnote', nid);
        if (!n) return;
        var v = prompt('書き足したことを直す（空にすると消します）', n.text || '');
        if (v === null) return;
        v = v.trim();
        if (!v) {
          if (!confirm('この書き足しを消しますか？')) return;
          Store.remove('wnote', nid);
          $('#w-notes').innerHTML = notesHtml(id);
          changed('消しました');
          return;
        }
        var rec = copy(n); rec.text = v;
        Store.put('wnote', rec);
        $('#w-notes').innerHTML = notesHtml(id);
        changed('直しました');
      }

      $('#w-addnote').onclick = function () {
        var ta = $('#w-note');
        var v = ta.value.trim();
        if (!v) { ta.focus(); PB.App.toast('書き足すことを入れてください'); return; }
        Store.put('wnote', { wishId: id, text: v, owner: Who.me(), createdAt: Date.now() });
        ta.value = '';
        $('#w-notes').innerHTML = notesHtml(id);
        changed('書き足しました');
      };

      $('#w-done').onclick = function () {
        var td = today();
        var rec = copy(cur());
        if (!rec.done) {
          rec.done = true;
          rec.doneOn = (rec.date && rec.date <= td) ? rec.date : td;
        } else {
          rec.done = false;
          rec.doneOn = '';
          if (rec.date && rec.date < td) { rec.date = ''; rec.time = ''; }    // 過ぎた日のままにしない
        }
        Store.put('wish', rec);
        changed(rec.done ? '行ったことにしました' : 'もう一度やりたいことに戻しました');
        open(id);
      };
      $('#w-edit').onclick = function () { edit(id); };
      $('#w-close').onclick = PB.App.closeModal;
    });
  }

  /* ---------- 足す・直す窓（題名だけで保存できる） ---------- */
  /** preset＝新しく足すときの初めの値（{date} など） */
  function edit(id, preset) {
    var w = id ? Store.get('wish', id) : null;
    var isNew = !w;
    if (!w) {
      w = { title: '', type: (wfilter === 'go' ? 'go' : 'do'), area: '', place: '', url: '', cost: '', memo: '',
            date: '', time: '', done: false, doneOn: '' };
      if (preset) Object.keys(preset).forEach(function (k) { w[k] = preset[k]; });
    }
    var type = typeOf(w);
    var openMore = !isNew || !!w.date;

    var html = ''
      + '<div class="evhead"><h2>' + (isNew ? 'やりたいことを足す' : 'やりたいことを直す') + '</h2>'
      + '<button type="button" class="go small" id="w-save">保存</button></div>'
      + '<input type="text" class="bigtitle" id="w-title" value="' + U.esc(w.title) + '" placeholder="例）水族館に行く・あのカフェのパンケーキ" enterkeyhint="done" autocomplete="off">'
      + '<div class="seg" id="w-type">'
        + ['do', 'go'].map(function (k) {
            return '<button type="button" data-v="' + k + '"' + (type === k ? ' class="on"' : '') + '><i class="wicon w-' + k + '"></i>' + TYPES[k] + '</button>';
          }).join('')
      + '</div>'
      + '<button type="button" class="summary" id="w-toggle" aria-expanded="' + openMore + '">'
        + '<span>場所・URL・行く日など</span><span class="chev">詳しく</span></button>'
      + '<div id="w-more"' + (openMore ? '' : ' hidden') + '>'
        + '<div class="f f2"><div><label>エリア</label><input type="text" id="w-area" value="' + U.esc(w.area) + '" placeholder="例）栄・京都"></div>'
          + '<div><label>費用のめやす</label><input type="text" id="w-cost" value="' + U.esc(w.cost) + '" placeholder="例）1人3000円"></div></div>'
        + '<div class="f"><label>場所（店の名前や住所。地図で開けます）</label><input type="text" id="w-place" value="' + U.esc(w.place) + '"></div>'
        + '<div class="f"><label>参考のURL</label><input type="url" id="w-url" value="' + U.esc(w.url) + '" placeholder="https://" autocapitalize="off" autocorrect="off" spellcheck="false"></div>'
        + (w.done ? '' : '<div class="f f2"><div><label>行く日</label><input type="date" id="w-date" value="' + (w.date || '') + '"></div>'
          + '<div><label>何時ごろ</label><input type="time" id="w-time" value="' + (w.time || '') + '"></div></div>')
        + '<div class="f"><label>メモ</label><textarea id="w-memo" placeholder="なぜ行きたいか、気になっていることなど">' + U.esc(w.memo) + '</textarea></div>'
        + '<div class="hint">あとから分かったことは、開いて「書き足す」で何件でも足せます（2人とも書けます）</div>'
      + '</div>'
      + '<div class="acts">'
        + (isNew ? '' : '<button type="button" class="del" id="w-del">消す</button>')
        + '<button type="button" id="w-cancel">やめる</button>'
      + '</div>';

    PB.App.modal(html, function (root) {
      var $ = function (q) { return root.querySelector(q); };
      root.querySelectorAll('#w-type button').forEach(function (b) {
        b.onclick = function () {
          type = b.dataset.v;
          root.querySelectorAll('#w-type button').forEach(function (x) { x.classList.toggle('on', x === b); });
        };
      });
      $('#w-toggle').onclick = function () {
        var more = $('#w-more');
        more.hidden = !more.hidden;
        this.setAttribute('aria-expanded', String(!more.hidden));
      };
      $('#w-cancel').onclick = function () { if (isNew) PB.App.closeModal(); else open(id); };
      $('#w-title').onkeydown = function (ev) {
        if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); save(); }   // 変換中の Enter は無視
      };

      var del = $('#w-del');
      if (del) del.onclick = function () {
        var ns = notesOf(id);
        if (!confirm('「' + (w.title || '題名なし') + '」を消しますか？' + (ns.length ? '\n書き足したこと（' + ns.length + '件）も一緒に消えます' : ''))) return;
        ns.forEach(function (n) { Store.remove('wnote', n.id); });
        Store.remove('wish', id);
        PB.App.closeModal();
        changed('消しました');
      };

      function val(q) { var e = $(q); return e ? e.value.trim() : ''; }
      function save() {
        var title = val('#w-title');
        if (!title) { $('#w-title').focus(); PB.App.toast('題名を入れてください'); return; }
        var rec = isNew ? {} : copy(w);
        rec.title = title;
        rec.type = type;
        rec.area = val('#w-area');
        rec.cost = val('#w-cost');
        rec.place = val('#w-place');
        rec.url = cleanUrl(val('#w-url'));
        rec.memo = $('#w-memo').value.replace(/\s+$/, '');
        if (!w.done) { rec.date = val('#w-date'); rec.time = rec.date ? val('#w-time') : ''; }
        rec.done = !!w.done;
        rec.doneOn = w.doneOn || '';
        rec.owner = w.owner || Who.me();
        rec.createdAt = w.createdAt || Date.now();
        var saved = Store.put('wish', rec);
        if (isNew) { PB.App.closeModal(); changed('足しました'); }
        else { changed('保存しました'); open(saved.id); }
      }
      $('#w-save').onclick = save;

      // ★新しく足すときは、すぐ題名を打てるようにする（iPhone で鍵盤が出るよう、待たずに当てる）
      if (isNew) $('#w-title').focus();
    });
  }

  /* ---------- 遊ぶ日にやることを選ぶ ---------- */
  function pick(dateStr) {
    var date = dateStr || nextHoliday();
    var checked = {};
    function candidates() { return Store.list('wish').filter(function (w) { return !w.done; }); }
    function reset() {
      checked = {};
      candidates().forEach(function (w) { if (w.date === date) checked[w.id] = true; });
    }
    reset();

    function item(w, sub) {
      var t = typeOf(w);
      return '<label class="wpick"><input type="checkbox" value="' + w.id + '"' + (checked[w.id] ? ' checked' : '') + '>'
        + '<i class="wicon w-' + t + '"></i>'
        + '<span class="pb"><span class="pt">' + U.esc(w.title || '（題名なし）') + '</span>'
        + (sub ? '<span class="ps">' + U.esc(sub) + '</span>' : '') + '</span></label>';
    }
    function sub(w, withDate) {
      return [withDate && w.date ? U.short(w.date) + 'に決めている' : '', w.time ? w.time + 'ごろ' : '', w.area, w.cost]
        .filter(Boolean).join('　');
    }
    function listHtml() {
      var c = candidates();
      if (!c.length) {
        return '<div class="card"><div class="empty">選べるものがありません。<br>下の「新しく足す」から足してください</div></div>';
      }
      var here = c.filter(function (w) { return w.date === date; }).sort(byPlan);
      var free = c.filter(function (w) { return !w.date; }).sort(byNew);
      var other = c.filter(function (w) { return w.date && w.date !== date; })
        .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : byPlan(a, b); });
      var h = '';
      [['この日にやること', here, false], ['まだ決めていないもの', free, false], ['ほかの日に決めているもの', other, true]].forEach(function (g) {
        if (!g[1].length) return;
        h += '<div class="secttl">' + g[0] + '</div><div class="card">';
        g[1].forEach(function (w) { h += item(w, sub(w, g[2])); });
        h += '</div>';
      });
      return h;
    }

    var html = ''
      + '<div class="evhead"><h2>遊ぶ日にやること</h2><button type="button" class="go small" id="p-save">決める</button></div>'
      + '<div class="f"><label for="p-date">遊ぶ日</label><input type="date" id="p-date" value="' + date + '"></div>'
      + '<div class="hint">印を付けたものを、この日にやることにします。カレンダーのこの日に出ます</div>'
      + '<div id="p-list">' + listHtml() + '</div>'
      + '<div class="acts"><button type="button" id="p-new">新しく足す</button><button type="button" id="p-cancel">やめる</button></div>';

    PB.App.modal(html, function (root) {
      var $ = function (q) { return root.querySelector(q); };
      $('#p-date').onchange = function () {
        if (!this.value) { this.value = date; return; }
        date = this.value; reset();
        $('#p-list').innerHTML = listHtml();
      };
      $('#p-list').addEventListener('change', function (ev) {
        if (ev.target.type === 'checkbox') checked[ev.target.value] = ev.target.checked;
      });
      $('#p-cancel').onclick = PB.App.closeModal;
      $('#p-new').onclick = function () { edit(null, { date: date }); };
      $('#p-save').onclick = function () {
        var n = 0;
        candidates().forEach(function (w) {
          var want = checked[w.id] ? date : (w.date === date ? '' : (w.date || ''));
          if ((w.date || '') === want) return;
          var rec = copy(w);
          rec.date = want;
          if (!want) rec.time = '';
          Store.put('wish', rec);
          n++;
        });
        PB.App.closeModal();
        changed(n ? U.label(date) + 'にやることを決めました' : '変えたところはありません');
      };
    });
  }

  /* ---------- カレンダーから呼ぶ口 ---------- */
  /** その日の欄の下に出す「この日にやること」 */
  function dayHtml(ds) {
    var ws = on(ds);
    if (!ws.length) {
      if (ds < today()) return '';
      return '<button type="button" class="wpickbtn" data-wpick="' + ds + '"><i class="wicon w-do"></i>この日にやることを選ぶ</button>';
    }
    var h = '<div class="secttl">この日にやること（' + ws.length + '件）</div>';
    ws.forEach(function (w) { h += rowHtml(w); });
    if (ds >= today()) h += '<button type="button" class="wpickbtn" data-wpick="' + ds + '">＋ やることを足す・外す</button>';
    return h;
  }

  /** 行く日がその間にあって、まだ行っていないもの（「これから」に出す） */
  function between(from, to) {
    return Store.list('wish').filter(function (w) {
      return !w.done && w.date && w.date >= from && w.date <= to;
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : byPlan(a, b); });
  }

  /** 押したものが「やりたいこと」の行か、選ぶ押しどころなら開いて true を返す */
  function click(ev) {
    var p = ev.target.closest('[data-wpick]');
    if (p) { pick(p.dataset.wpick); return true; }
    var b = ev.target.closest('[data-wish]');
    if (b) { open(b.dataset.wish); return true; }
    return false;
  }

  PB.Wish = {
    /** ★カレンダー（PB.Cal.init）より先に呼ぶ。ここでは描かない（Who がまだ使えないため） */
    init: function (store) {
      Store = store; U = PB.U; Who = PB.Who;
      var s = document.getElementById('wishSearch');
      if (s) s.oninput = function () { wquery = this.value.trim(); render(); };
      var f = document.getElementById('wishFilters');
      if (f) f.onclick = function (ev) {
        var b = ev.target.closest('.chip'); if (!b) return;
        wfilter = b.dataset.w;
        this.querySelectorAll('.chip').forEach(function (x) { x.classList.toggle('on', x === b); });
        render();
      };
      var plan = document.getElementById('wishPlan');
      if (plan) plan.onclick = function () { pick(null); };
      var body = document.getElementById('wishBody');
      if (body) body.onclick = click;
    },
    render: render,
    add: function () { edit(null); },
    open: open,
    pick: pick,
    count: function (ds) { return on(ds).length; },
    dayHtml: dayHtml,
    between: between,
    rowHtml: function (w) { return rowHtml(w); },
    click: click
  };
})(window);

/* Diem 全体の組み立て（画面の切り替え・設定・別窓・知らせ） */
(function (global) {
  'use strict';
  var PB = global.PB = global.PB || {};
  var Store = PB.Store, Sync = PB.Sync, U;
  var view = 'cal';
  var pushTimer = null;

  /* ---------- 別窓 ---------- */
  var modalWrap = null, modalEl = null;
  function modal(html, after) {
    modalEl.innerHTML = html;
    modalWrap.hidden = false;
    document.body.style.overflow = 'hidden';
    if (after) after(modalEl);
    modalEl.scrollTop = 0;
  }
  function closeModal() {
    modalWrap.hidden = true;
    modalEl.innerHTML = '';
    document.body.style.overflow = '';
  }

  /* ---------- 知らせ ---------- */
  var toastTimer = null;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 1900);
  }

  /** いま効いているつなぎ先（設定で入れた値が優先。無ければ config.js の値） */
  function effectiveUrl() {
    return (Store.meta().syncUrl || (global.APP && APP.syncUrl) || '').trim();
  }

  var started = false;
  function ensureStarted() {
    if (started || !Sync.enabled()) return;
    started = true;
    Sync.start();
  }

  /* ---------- 同期の帯 ---------- */
  function paintSync() {
    var el = document.getElementById('syncBar');
    var s = Sync.state();
    var text = { off: '端末の中だけ', busy: '同期中…', pending: '未送信 ' + s.pending + '件', error: '送れません', ok: '同期ずみ' }[s.kind];
    if (s.kind === 'ok' && s.at) {
      var d = new Date(s.at);
      text = '同期ずみ ' + U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
    }
    el.className = 'syncbar ' + s.kind;
    el.textContent = text;
    el.title = s.kind === 'error' ? (Sync.lastError || '') : '';
  }

  /** 何か直したら、すこし待ってから送る */
  function refreshSync() {
    paintSync();
    if (!Sync.enabled()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { Sync.run(false); }, 1200);
  }

  /* ---------- 画面切り替え ---------- */
  var lastView = 'cal';   // 設定を閉じたときに戻る先
  function show(v) {
    if (view !== 'set') lastView = view;
    view = v;
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('on', b.dataset.view === v); });
    document.getElementById('setBtn').classList.toggle('on', v === 'set');
    document.querySelectorAll('.view').forEach(function (s) { s.classList.toggle('on', s.id === 'view-' + v); });
    document.getElementById('fab').hidden = (v === 'set');
    if (v === 'exp') PB.Exp.render();
    if (v === 'set') renderSettings();
    if (v === 'cal') PB.Cal.render();
    if (v === 'feed') PB.Cal.renderFeed();
    global.scrollTo(0, 0);
  }

  /* ---------- 設定の画面 ---------- */
  function renderSettings() {
    var m = Store.meta();
    var priv = Store.privateCount();
    var h = '';

    h += '<div class="secttl">名前と色</div><div class="card">'
      + row('自分の名前', m.me || '（未設定）', 'name-me')
      + row('相手の名前', m.partner || '（未設定）', 'name-you')
      + '<div class="setrow"><div><div class="k">色</div><div class="d">カレンダーの帯の色</div></div>'
      + '<div style="display:flex;gap:8px">'
      + '<span class="swatch" style="background:' + PB.Who.color(m.me || '自分') + '"></span>'
      + '<span class="swatch" style="background:' + PB.Who.color(m.partner || '相手') + '"></span>'
      + '</div></div>'
      + '</div>';

    h += '<div class="secttl">共有</div><div class="card">'
      + '<div class="setrow"><div><div class="k">つなぎ先</div><div class="d">'
      + (effectiveUrl() ? (m.syncUrl ? '設定ずみ' : 'アプリに入っているものを使っています') : '未設定（いまは端末の中だけ）')
      + '</div></div>'
      + '<button type="button" class="mini" id="s-url">直す</button></div>'
      + '<div class="setrow"><div><div class="k">合言葉（PIN）</div><div class="d">' + (m.pin ? '設定ずみ' : '未設定') + '</div></div>'
      + '<button type="button" class="mini" id="s-pin">直す</button></div>'
      + '<div class="setrow"><div><div class="k">送っていない記録</div><div class="d">電波がない間の入力はここに溜まります</div></div>'
      + '<div style="display:flex;gap:8px;align-items:center"><b style="white-space:nowrap">' + m.outbox.length + '件</b>'
      + '<button type="button" class="mini" id="s-sync">今すぐ同期</button></div></div>'
      + (Sync.lastError ? '<div class="warnbox">前回うまくいきませんでした：' + U.esc(Sync.lastError) + '</div>' : '')
      + '</div>';

    var T = PB.Tasks;
    // ★この見出しは、合図を受けた端末にだけ出す（一緒に使う相手の画面には出さない）
    if (m.taskShow || T.enabled()) {
    h += '<div class="secttl">Task Board のタスク</div><div class="card">'
      + '<div class="setrow"><div><div class="k">取り込み</div><div class="d">'
      + (T.enabled() ? '入（期限のあるタスクをカレンダーに出します）' : '切（Task Board の受け口を入れると始まります）')
      + '</div></div><button type="button" class="mini" id="t-url">' + (T.enabled() ? '直す' : '入れる') + '</button></div>'
      + (T.enabled()
          ? '<div class="setrow"><div><div class="k">出ているタスク</div>'
            + '<div class="d"><b>個人 ' + T.count('personal') + '件' + (T.wantWork() ? '・会社 ' + T.count('work') + '件' : '') + '</b>'
            + '（期限があって、まだ終わっていないものだけ）</div></div>'
            + '<button type="button" class="mini" id="t-now">今すぐ読む</button></div>'
            + '<div class="setrow"><div><div class="k">会社のタスクも出す</div>'
            + '<div class="d">入にすると、会社の側の期限つきタスクも出します（色を変えて見分けます）</div></div>'
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

    h += '<div class="secttl">自分だけの予定</div><div class="card">'
      + '<div class="note">「自分だけ」の予定は <b>' + priv + '件</b>。相手には見えず、サーバーにも送られません。'
      + 'その分、この端末のデータが消えると戻せません。ときどき下の「控えを書き出す」を押してください。</div>'
      + '</div>';

    h += '<div class="secttl">控え</div><div class="card">'
      + '<div class="setrow"><div><div class="k">控えを書き出す</div><div class="d">全部の予定と立替金を1つの文字にします</div></div>'
      + '<button type="button" class="mini" id="s-out">書き出す</button></div>'
      + '<div class="setrow"><div><div class="k">控えから戻す</div><div class="d">書き出した文字を貼って戻します</div></div>'
      + '<button type="button" class="mini" id="s-in">戻す</button></div>'
      + '</div>';

    h += '<div class="secttl">その他</div><div class="card">'
      + '<div class="setrow" id="s-ver"><div><div class="k">版</div><div class="d">' + U.esc(APP.version) + '</div></div></div>'
      + '<div class="setrow"><div><div class="k" style="color:var(--danger)">この端末のデータを全部消す</div>'
      + '<div class="d">サーバーにある共有分は消えません</div></div>'
      + '<button type="button" class="mini" id="s-wipe">消す</button></div>'
      + '</div>';

    document.getElementById('setBody').innerHTML = h;
    wireSettings();

    function row(k, v, id) {
      return '<div class="setrow"><div><div class="k">' + k + '</div><div class="d">' + U.esc(v) + '</div></div>'
        + '<button type="button" class="mini" data-edit="' + id + '">直す</button></div>';
    }
  }

  function wireSettings() {
    var body = document.getElementById('setBody');
    var m = Store.meta();

    body.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = function () {
        var isMe = b.dataset.edit === 'name-me';
        var now = isMe ? m.me : m.partner;
        var v = prompt(isMe ? 'あなたの名前' : '相手の名前', now || '');
        if (v === null) return;
        v = v.trim(); if (!v) return;
        if (isMe) m.me = v; else m.partner = v;
        Store.saveMeta(); renderSettings(); PB.Cal.render();
      };
    });

    body.querySelector('#s-url').onclick = function () {
      var v = prompt('Apps Script のウェブアプリURL\n（空にすると、アプリに入っているものに戻ります。'
        + '共有をやめるときは合言葉を空にしてください）', effectiveUrl());
      if (v === null) return;
      m.syncUrl = v.trim(); Store.saveMeta();
      if (effectiveUrl() && m.pin) tryConnect();
      else { renderSettings(); paintSync(); }
    };
    body.querySelector('#s-pin').onclick = function () {
      var v = prompt('合言葉（PIN）', m.pin || '');
      if (v === null) return;
      m.pin = v.trim(); Store.saveMeta();
      if (effectiveUrl() && m.pin) tryConnect();
      else { renderSettings(); paintSync(); }
    };
    body.querySelector('#s-sync').onclick = function () {
      if (!Sync.enabled()) { alert('先に、つなぎ先と合言葉を入れてください'); return; }
      toast('同期しています…');
      Sync.run(true).then(function () {
        toast('同期しました'); renderSettings(); PB.Cal.render(); PB.Exp.render();
      }).catch(function (e) { alert('うまくいきませんでした：\n' + e.message); renderSettings(); });
    };

    var T = PB.Tasks;
    var tUrl = body.querySelector('#t-url');
    if (tUrl) tUrl.onclick = function () {
      var u = prompt('Task Board の受け口のURL（空にすると取り込みをやめます）', m.taskUrl || '');
      if (u === null) return;
      u = u.trim();
      if (!u) { m.taskUrl = ''; m.taskPin = ''; Store.saveMeta(); T.clear(); renderSettings(); PB.Cal.render(); return; }
      var pin = prompt('Task Board の合言葉', m.taskPin || '');
      if (pin === null) return;
      toast('つないでいます…');
      T.test(u, pin).then(function () {
        m.taskUrl = u; m.taskPin = pin.trim(); Store.saveMeta();
        return T.run(true);
      }).then(function () {
        toast('タスクを読み込みました'); T.start(); renderSettings(); PB.Cal.render();
      }).catch(function (e) { alert('つながりませんでした：\n' + e.message); renderSettings(); });
    };
    var tNow = body.querySelector('#t-now');
    if (tNow) tNow.onclick = function () {
      toast('読んでいます…');
      T.run(true).then(function () { toast('読み込みました'); renderSettings(); PB.Cal.render(); })
        .catch(function (e) { alert('うまくいきませんでした：\n' + e.message); renderSettings(); });
    };
    var tWork = body.querySelector('#t-work');
    if (tWork) tWork.onclick = function () {
      m.taskWork = !T.wantWork(); Store.saveMeta();
      toast(m.taskWork ? '会社のタスクも読みます…' : '会社のタスクを出さないようにしました');
      T.run(false).then(function () { renderSettings(); PB.Cal.render(); });
    };
    var tOff = body.querySelector('#t-off');
    if (tOff) tOff.onclick = function () {
      if (!confirm('タスクの取り込みをやめますか？\n（Task Board 側のタスクは消えません）')) return;
      m.taskUrl = ''; m.taskPin = ''; m.taskShow = false; Store.saveMeta(); T.clear();
      renderSettings(); PB.Cal.render(); toast('やめました。見出しも隠しました');
    };

    body.querySelector('#s-out').onclick = function () {
      var text = Store.exportAll();
      modal('<h2>控えを書き出す</h2>'
        + '<div class="hint">下の文字を全部コピーして、メモやメールに残してください</div>'
        + '<div class="f"><textarea id="o-text" style="min-height:200px;font-size:11px">' + U.esc(text) + '</textarea></div>'
        + '<div class="acts"><button type="button" id="o-copy">コピー</button>'
        + '<button type="button" class="go" id="o-close">閉じる</button></div>', function (root) {
          root.querySelector('#o-copy').onclick = function () {
            var ta = root.querySelector('#o-text');
            ta.select(); ta.setSelectionRange(0, 999999);
            try { document.execCommand('copy'); toast('コピーしました'); }
            catch (e) { toast('長押しでコピーしてください'); }
          };
          root.querySelector('#o-close').onclick = closeModal;
        });
    };

    body.querySelector('#s-in').onclick = function () {
      modal('<h2>控えから戻す</h2>'
        + '<div class="hint">書き出した文字を貼り付けてください。いまのデータと合わせます（新しい方を残します）</div>'
        + '<div class="f"><textarea id="i-text" style="min-height:200px;font-size:11px" placeholder="ここに貼り付け"></textarea></div>'
        + '<div class="acts"><button type="button" id="i-cancel">やめる</button>'
        + '<button type="button" class="go" id="i-go">戻す</button></div>', function (root) {
          root.querySelector('#i-cancel').onclick = closeModal;
          root.querySelector('#i-go').onclick = function () {
            try {
              Store.importAll(root.querySelector('#i-text').value);
              closeModal(); renderSettings(); PB.Cal.render(); PB.Exp.render();
              toast('戻しました');
            } catch (e) { alert('読めませんでした：\n' + e.message); }
          };
        });
    };

    // ★「版」の行を5回続けて押すと、Task Board の設定を出す／隠す（自分の端末だけ）。
    //   iPhone のホーム画面のアプリは Safari と保存場所が別なので、?task=1 のリンクが届かない。
    //   アプリの中で合図を送れるように、ここに置いた。一緒に使う相手が偶然見つけないよう、5回にしてある
    var ver = body.querySelector('#s-ver'), taps = 0, tapTimer = null;
    if (ver) ver.onclick = function () {
      taps++;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(function () { taps = 0; }, 2500);
      if (taps < 5) return;
      taps = 0;
      m.taskShow = !(m.taskShow || PB.Tasks.enabled());
      if (!m.taskShow) { m.taskUrl = ''; m.taskPin = ''; PB.Tasks.clear(); }
      Store.saveMeta();
      renderSettings(); PB.Cal.render();
      toast(m.taskShow ? 'Task Board の設定を出しました' : 'Task Board の設定を隠しました');
    };

    body.querySelector('#s-wipe').onclick = function () {
      if (!confirm('この端末のデータを全部消します。\n「自分だけ」の予定は戻せません。よろしいですか？')) return;
      if (!confirm('本当に消しますか？')) return;
      Store.wipe(true);
      renderSettings(); PB.Cal.render(); PB.Exp.render(); paintSync();
      toast('消しました');
    };
  }

  function tryConnect() {
    var m = Store.meta();
    toast('つないでいます…');
    Sync.test(effectiveUrl(), m.pin).then(function () {
      m.since = 0; Store.saveMeta();     // つなぎ直したら最初から取り込む
      return Sync.run(true);
    }).then(function () {
      ensureStarted();
      toast('つながりました'); renderSettings(); paintSync(); PB.Cal.render(); PB.Exp.render();
    }).catch(function (e) {
      alert('つながりませんでした：\n' + e.message); renderSettings(); paintSync();
    });
  }

  /* ---------- はじめの設定 ---------- */
  function firstRun() {
    var askPin = !!effectiveUrl() && !Store.meta().pin;
    modal('<h2>はじめに</h2>'
      + '<div class="hint">予定を「誰の予定か」で色分けします。あとから設定で直せます</div>'
      + '<div class="f"><label>あなたの名前</label><input type="text" id="n-me" placeholder="例）こうだい"></div>'
      + '<div class="f"><label>一緒に使う人の名前</label><input type="text" id="n-you" placeholder="例）あいて"></div>'
      + (askPin
          ? '<div class="f"><label>合言葉（PIN）</label><input type="text" id="n-pin" placeholder="2人で決めたもの" autocapitalize="off" autocorrect="off" spellcheck="false"></div>'
            + '<div class="hint">入れると相手と予定を分け合えます。空のままでも、この端末だけで全部使えます</div>'
          : '')
      + '<div class="acts"><button type="button" class="go" id="n-go">はじめる</button></div>', function (root) {
        root.querySelector('#n-go').onclick = function () {
          var me = root.querySelector('#n-me').value.trim() || '自分';
          var you = root.querySelector('#n-you').value.trim() || '相手';
          var m = Store.meta(); m.me = me; m.partner = you;
          var pinEl = root.querySelector('#n-pin');
          var pin = pinEl ? pinEl.value.trim() : '';
          if (pin) m.pin = pin;
          Store.saveMeta();
          closeModal(); PB.Cal.render();
          if (pin) tryConnect();
        };
      });
  }

  /* ---------- 立ち上げ ---------- */
  function boot() {
    modalWrap = document.getElementById('modalWrap');
    modalEl = document.getElementById('modal');
    modalWrap.addEventListener('click', function (e) { if (e.target === modalWrap) closeModal(); });

    Store.init();
    U = PB.U;                      // calendar.js が先に読まれている
    Sync.setStore(Store);
    Sync.onChange = paintSync;
    Sync.onData = function () {
      PB.Cal.render();
      if (view === 'exp') PB.Exp.render();
      if (view === 'set') renderSettings();
    };

    PB.App = { modal: modal, closeModal: closeModal, toast: toast, refreshSync: refreshSync };

    // ★合図つきのリンク（…/?task=1）で開いた端末にだけ、タスクの設定を出す。
    //   相手に渡すふつうのURLでは、見出しごと出ない。?task=0 で隠せる
    try {
      var q = new URLSearchParams(location.search);
      if (q.has('task')) {
        Store.meta().taskShow = (q.get('task') !== '0');
        Store.saveMeta();
        q.delete('task');
        var rest = q.toString();
        history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
      }
    } catch (e) {}

    PB.Tasks.init(Store);
    PB.Tasks.onData = function () {
      PB.Cal.render();
      if (view === 'set') renderSettings();
    };

    PB.Cal.init(Store);
    PB.Exp.init(Store);

    document.getElementById('tabs').onclick = function (e) {
      var b = e.target.closest('.tab'); if (!b) return; show(b.dataset.view);
    };
    document.getElementById('setBtn').onclick = function () {
      show(view === 'set' ? lastView : 'set');
    };
    document.getElementById('fab').onclick = function () {
      if (view === 'cal' || view === 'feed') PB.Cal.add();
      else if (view === 'exp') PB.Exp.add();
    };

    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }

    paintSync();
    ensureStarted();
    if (PB.Tasks.enabled()) PB.Tasks.start();
    if (!Store.meta().me) firstRun();
  }

  // PB.App は Cal/Exp の init より前に要るので、先に器を置く
  PB.App = { modal: function () {}, closeModal: function () {}, toast: function () {}, refreshSync: function () {} };
  document.addEventListener('DOMContentLoaded', boot);
})(window);

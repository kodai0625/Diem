/* Diem  自分だけの予定を、自分の端末どうしで同じにする（★私用だけ。配布用には入れない）

   2026-11-24（ko-dai さん「スマホとiPadで予定が共有されるようにできますか？」→「自分だけの予定も」「私用だけ」）
   ・2人の予定・立替金・やりたいことは、前から同じ合言葉（PIN）を入れた端末どうしで同じになる。
     「自分だけ」の予定だけは端末の外へ出さない決まりだったので、iPhone で入れたものが iPad に出なかった
   ・自分の合言葉を決めると、自分だけの予定を**暗号にして**2人のシートに載せ、同じ合言葉を入れた自分の端末どうしで同じにする
       鍵：合言葉から作る（PBKDF2・SHA-256・31万回。どの端末でも同じ鍵になるよう、塩は決まった文字）
       暗号：1件ずつ AES-GCM（256ビット）。予定の id も一緒に封じる（他の予定と入れ替えられないように）
       種類は 'mine'。相手のアプリ（配布用）は知らない種類なので、受け取っても捨てる。仮に中を見ても暗号で読めない
   ・鍵は、この端末の中だけに持つ（localStorage の diem.minekey。合言葉そのものは持たない）。控えには入れない
   ・合言葉は2人の合言葉（PIN）と同じものにはできない（相手も知っているため）
   ・★合言葉を忘れると、シートにある分は読めない（端末の中の分は残る）。合言葉を変えたら、他の自分の端末にも入れ直す
   ・送る・受け取るの流れは sync.js（sealOps・openRows）、送信箱に積むかどうかは store.js（isLocalOnly）にある */
(function (global) {
  'use strict';
  var PB = global.PB = global.PB || {};

  var KEY = 'diem.minekey';
  var SALT = 'Diem/mine/v1';
  var ROUNDS = 310000;
  var MIN_LEN = 6;

  var subtle = global.crypto && global.crypto.subtle;   // https の画面でだけ使える
  var saved = read();        // { v:1, k:鍵（base64）, kid:鍵を見分ける印 } または null
  var keyP = null;           // 取り込んだ鍵（Promise）

  function read() {
    try {
      var o = JSON.parse(localStorage.getItem(KEY) || 'null');
      return (o && o.k && o.kid) ? o : null;
    } catch (e) { return null; }
  }
  function write(o) {
    try {
      if (o) localStorage.setItem(KEY, JSON.stringify(o)); else localStorage.removeItem(KEY);
      return true;
    } catch (e) { return false; }
  }

  function b64(buf) {
    var s = '', a = new Uint8Array(buf);
    for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return btoa(s);
  }
  function unb64(str) {
    var s = atob(str), a = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  }
  function utf8(str) { return new TextEncoder().encode(str); }

  function on() { return !!(subtle && saved); }

  function key() {
    if (!keyP) keyP = subtle.importKey('raw', unb64(saved.k), 'AES-GCM', false, ['encrypt', 'decrypt']);
    return keyP;
  }

  /** 合言葉から鍵を作る。kid は鍵の指紋の頭（鍵そのものは分からない）。自分の鍵で封じた行かどうかを見分けるのに使う */
  function derive(pass) {
    return subtle.importKey('raw', utf8(pass), 'PBKDF2', false, ['deriveBits']).then(function (base) {
      return subtle.deriveBits({ name: 'PBKDF2', salt: utf8(SALT), iterations: ROUNDS, hash: 'SHA-256' }, base, 256);
    }).then(function (bits) {
      return subtle.digest('SHA-256', bits).then(function (h) {
        var kid = Array.prototype.map.call(new Uint8Array(h).slice(0, 6), function (x) {
          return (x < 16 ? '0' : '') + x.toString(16);
        }).join('');
        return { v: 1, k: b64(bits), kid: kid };
      });
    });
  }

  /** 1件を封じる。受け口に要る3つ（更新時刻・更新した人・消した印）だけは外に出す */
  function seal(id, rec) {
    if (!on()) return Promise.reject(new Error('no key'));
    var iv = global.crypto.getRandomValues(new Uint8Array(12));
    var kid = saved.kid;
    return key().then(function (k) {
      return subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: utf8(String(id)) }, k, utf8(JSON.stringify(rec)));
    }).then(function (ct) {
      return { enc: 1, kid: kid, iv: b64(iv), ct: b64(ct),
               updatedAt: rec.updatedAt, updatedBy: rec.updatedBy || '', deleted: rec.deleted === true };
    });
  }

  /** 受け取った1行を開く。自分の鍵で封じたものでなければ null */
  function open(id, json) {
    if (!on()) return Promise.resolve(null);
    var o;
    try { o = JSON.parse(json); } catch (e) { return Promise.resolve(null); }
    if (!o || o.enc !== 1 || o.kid !== saved.kid) return Promise.resolve(null);
    return key().then(function (k) {
      return subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv), additionalData: utf8(String(id)) }, k, unb64(o.ct));
    }).then(function (pt) {
      var rec = JSON.parse(new TextDecoder().decode(pt));
      rec.scope = 'private';
      return rec;
    });
  }

  /** 合言葉を決める・変える。自分だけの予定を全部送信箱に積み、他の端末の分も受け取れるよう最初から取り込み直す */
  function use(o) {
    var Store = PB.Store;
    saved = o; keyP = null;
    if (!write(o)) throw new Error('この端末に保存できませんでした');
    Store.list('event').forEach(function (e) { if (e.scope === 'private') Store.queue('event', e.id); });
    var m = Store.meta();
    m.since = 0;               // 合言葉を入れる前に受け取って捨てた分（他の端末の自分だけの予定）も受け取るため
    Store.saveMeta();
  }

  function stop() {
    saved = null; keyP = null;
    write(null);
    PB.Store.dropLocalFromOutbox();
  }

  function norm(v) {
    v = String(v || '');
    if (v.normalize) v = v.normalize('NFKC');   // 全角と半角の違いで、端末ごとに別の鍵にならないように
    return v.trim();
  }

  /* ---------- 設定の画面 ---------- */
  function settingsHtml(count) {
    var esc = PB.U.esc;
    var n = '<b>' + esc(String(count)) + '件</b>';
    if (!subtle) {
      return '<div class="note">「自分だけ」の予定は ' + n + '。相手には見えず、この端末の中だけです。'
        + '（この開き方では暗号が使えないので、自分の端末どうしで同じにする機能は使えません）</div>';
    }
    var h = on()
      ? '<div class="note">「自分だけ」の予定は ' + n + '。相手には見えません。<b>自分の合言葉で暗号にして</b>サーバーに送り、'
        + '同じ合言葉を入れた自分の端末（iPhone・iPad など）と同じにしています。</div>'
      : '<div class="note">「自分だけ」の予定は ' + n + '。相手には見えず、今はこの端末の中だけです。'
        + '<b>自分の合言葉</b>を決めると、同じ合言葉を入れた自分の端末（iPhone・iPad など）どうしで同じになります。'
        + '暗号にして送るので、相手のアプリでは読めません。</div>';
    h += '<div class="setrow"><div><div class="k">自分の合言葉</div><div class="d">'
      + (on() ? '設定済み（この端末）' : '未設定') + '</div></div>'
      + '<div style="display:flex;gap:8px">'
      + (on() ? '<button type="button" class="mini" id="m-off">やめる</button>' : '')
      + '<button type="button" class="mini" id="m-set">' + (on() ? '変える' : '決める') + '</button></div></div>';
    if (!on()) {
      h += '<div class="note">今は端末の中だけなので、この端末のデータが消えると戻せません。時々下の「控えを書き出す」を押してください。</div>';
    }
    return h;
  }

  function bindSettings(body, api) {
    var set = body.querySelector('#m-set'), off = body.querySelector('#m-off');
    if (set) set.onclick = function () { ask(api); };
    if (off) off.onclick = function () {
      if (!confirm('この端末では、自分だけの予定を同じにするのをやめます。\n'
        + 'この端末の中の分も、サーバーにある分も消えません。よろしいですか？')) return;
      stop();
      api.rerender();
      PB.App.toast('やめました（この端末の中だけに戻りました）');
    };
  }

  function ask(api) {
    var changing = on();
    PB.App.modal('<h2>自分の合言葉</h2>'
      + '<div class="hint">iPhone・iPad など、<b>自分の端末全部に同じ合言葉</b>を入れてください。'
      + '2人の合言葉（PIN）とは別のものにします。<br>'
      + '忘れると、サーバーにある自分だけの予定は読めなくなります（端末の中の分は残ります）。'
      + (changing ? '<br><b>変えたときは、他の自分の端末にも新しい合言葉を入れ直してください。</b>' : '') + '</div>'
      + '<div class="f"><input type="text" id="m-pass" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"'
      + ' placeholder="' + MIN_LEN + '文字以上" aria-label="自分の合言葉"></div>'
      + '<div class="acts"><button type="button" id="m-cancel">やめる</button>'
      + '<button type="button" class="go" id="m-go">' + (changing ? '変える' : '決める') + '</button></div>', function (root) {
        var input = root.querySelector('#m-pass'), go = root.querySelector('#m-go');
        root.querySelector('#m-cancel').onclick = PB.App.closeModal;
        go.onclick = function () {
          var pass = norm(input.value);
          if (pass.length < MIN_LEN) { alert('合言葉は' + MIN_LEN + '文字以上にしてください'); return; }
          if (pass === norm(PB.Store.meta().pin)) { alert('2人の合言葉（PIN）と同じものは使えません（相手も知っているため）'); return; }
          go.disabled = true; go.textContent = '鍵を作っています…';
          derive(pass).then(function (o) {
            use(o);
          }).then(function () {
            PB.App.closeModal();
            api.rerender();
            if (!api.connected()) { PB.App.toast('決めました。共有につなぐと送ります'); return; }
            PB.App.toast('自分だけの予定を送っています…');
            PB.Sync.run(true).then(function (res) {
              api.rerender();
              PB.App.toast(res && res.skipped ? '決めました。この後の同期で送ります' : '自分の端末どうしで同じにしました');
            }).catch(function (e) {
              api.rerender();
              alert('合言葉は決めました。送るのはうまくいきませんでした（次の同期でもう一度送ります）：\n' + (e && e.message || e));
            });
          }, function (e) {
            alert('うまくいきませんでした：\n' + (e && e.message || e));
            go.disabled = false; go.textContent = changing ? '変える' : '決める';
          });
        };
        setTimeout(function () { input.focus(); }, 50);
      });
  }

  PB.Mine = {
    on: on,
    seal: seal,
    open: open,
    settingsHtml: settingsHtml,
    bindSettings: bindSettings
  };
})(window);

/* Diem  私用だけの操作（★配布用には入れない。見た目は css/shiyou.css）

   2026-10-11（ko-dai さんの指示）
   ・絞り込みの札（全部／2人の予定／自分だけ）を画面から外す
   ・代わりに、上の「カレンダー」のタブを**2回続けて押す**と、全部 → 2人の予定 → 自分だけ → 全部 … と切り替わる
   ・いま何を出しているかは、タブの字の右の小さな点で分かる（点なし＝全部、青＝2人の予定、緑＝自分だけ）。
     切り替えたときは、下に言葉でも出す

   ★共通のファイル（index.html の札・calendar.js）は1文字も変えていない。
     札は css で隠しているだけで、切り替えそのものは「隠れている札を押す」ことで、もとの処理に任せている。
     こうしておくと、配布用は組み立て直しても中身が変わらない（配布用は今までどおり札で切り替える） */
(function (global) {
  'use strict';
  var PB = global.PB = global.PB || {};

  var ORDER = ['all', 'shared', 'private'];
  var NAMES = { all: '全部', shared: '2人の予定', private: '自分だけ' };
  var WORDS = { all: '全部を表示', shared: '2人の予定を表示', private: '自分だけを表示' };   // 1行に収まる長さで
  var GAP = 400;   // 2回目を「続けて押した」とみなす間（ミリ秒）

  /** いまの絞り込み。隠れている札のうち、選ばれているものから読む */
  function current(chips) {
    var on = chips.querySelector('.chip.on');
    return (on && on.dataset.filter) || 'all';
  }

  function paint(tab, chips) {
    var f = current(chips);
    tab.dataset.filter = f;
    tab.setAttribute('aria-label', 'カレンダー' + (f === 'all' ? '' : '（' + NAMES[f] + 'を表示中）'));
  }

  function boot() {
    var tab = document.querySelector('.tab[data-view="cal"]');
    var chips = document.getElementById('filters');
    if (!tab || !chips) return;

    // 字の右に点を足す。左にも同じ幅の見えない点を置いて、字が真ん中からずれないようにする
    tab.insertAdjacentHTML('afterbegin', '<i class="fpad"></i>');
    tab.insertAdjacentHTML('beforeend', '<i class="fdot"></i>');
    paint(tab, chips);

    var last = 0;
    // ★タブそのものに付ける。画面を切り替える処理（#tabs に付いている）より先に動くので、
    //   「押す前からカレンダーを開いていたか」をここで見分けられる
    tab.addEventListener('click', function () {
      var now = Date.now();
      // ほかの画面から移ってきた1回目は数えない（画面を替えるつもりの連打で、絞り込みが変わらないように）
      if (!tab.classList.contains('on')) { last = 0; return; }
      if (now - last > GAP) { last = now; return; }
      last = 0;
      var next = ORDER[(ORDER.indexOf(current(chips)) + 1) % ORDER.length];
      var chip = chips.querySelector('.chip[data-filter="' + next + '"]');
      if (!chip) return;
      chip.click();              // 切り替えは、もとの札の処理に任せる
      paint(tab, chips);
      if (PB.App && PB.App.toast) PB.App.toast(WORDS[next]);
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})(window);

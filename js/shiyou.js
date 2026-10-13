/* Diem  私用だけの操作（★配布用には入れない。見た目は css/shiyou.css）

   2026-10-11（ko-dai さんの指示）
   ・絞り込みの札（全部／2人の予定／自分だけ）を画面から外す
   ・代わりに、上の「カレンダー」のタブを**2回続けて押す**と、全部 → 2人の予定 → 自分だけ → 全部 … と切り替わる
   ・いま何を出しているかは、タブの字の右の小さな点で分かる（点なし＝全部、青と銅の半分ずつ＝2人の予定、緑＝自分だけ）。
     切り替えたときは、下に言葉でも出す

   2026-10-11（同じ日の追加。ko-dai さんの指示）
   ・「これから」のタブも**2回続けて押す**と、自分だけの予定にしぼれる（もう一度2回押すと全部に戻る）。
     しぼっているあいだは「もうすぐ」の欄・相手からの新着・2人の予定を出さない。検索も自分だけの予定から探す
   ・カレンダーの絞り込みとは別々に持つ（片方を切り替えても、もう片方は変わらない）
   ・アプリを開き直すと、どちらも「全部」に戻る

   ★カレンダーの方は、共通のファイル（index.html の札・calendar.js）を変えていない。
     札は css で隠しているだけで、切り替えそのものは「隠れている札を押す」ことで、もとの処理に任せている。
   ★「これから」の方は、しぼる処理を calendar.js に持たせた（PB.Cal.feedMine）。
     配布用にも同じ処理は入るが、呼ぶ操作がここにしか無いので、配布用の動きは変わらない */
(function (global) {
  'use strict';
  var PB = global.PB = global.PB || {};

  var ORDER = ['all', 'shared', 'private'];
  var NAMES = { all: '全部', shared: '2人の予定', private: '自分だけ' };
  var WORDS = { all: '全部を表示', shared: '2人の予定を表示', private: '自分だけを表示' };   // 1行に収まる長さで
  var GAP = 400;   // 2回目を「続けて押した」とみなす間（ミリ秒）

  function toast(words) { if (PB.App && PB.App.toast) PB.App.toast(words); }

  /** 字の右に点を足す。左にも同じ幅の見えない点を置いて、字が真ん中からずれないようにする */
  function addDot(tab) {
    tab.insertAdjacentHTML('afterbegin', '<i class="fpad"></i>');
    tab.insertAdjacentHTML('beforeend', '<i class="fdot"></i>');
  }

  /** そのタブを開いたまま2回続けて押したときだけ fn を呼ぶ */
  function onTwice(tab, fn) {
    var last = 0;
    // ★タブそのものに付ける。画面を切り替える処理（#tabs に付いている）より先に動くので、
    //   「押す前からその画面を開いていたか」をここで見分けられる
    tab.addEventListener('click', function () {
      var now = Date.now();
      // ほかの画面から移ってきた1回目は数えない（画面を替えるつもりの連打で、絞り込みが変わらないように）
      if (!tab.classList.contains('on')) { last = 0; return; }
      if (now - last > GAP) { last = now; return; }
      last = 0;
      fn();
    });
  }

  function paint(tab, name, f) {
    tab.dataset.filter = f;
    tab.setAttribute('aria-label', name + (f === 'all' ? '' : '（' + NAMES[f] + 'を表示中）'));
  }

  /* ---------- カレンダー：全部 → 2人の予定 → 自分だけ ---------- */
  /** いまの絞り込み。隠れている札のうち、選ばれているものから読む */
  function current(chips) {
    var on = chips.querySelector('.chip.on');
    return (on && on.dataset.filter) || 'all';
  }

  function bootCal() {
    var tab = document.querySelector('.tab[data-view="cal"]');
    var chips = document.getElementById('filters');
    if (!tab || !chips) return;
    addDot(tab);
    paint(tab, 'カレンダー', current(chips));
    onTwice(tab, function () {
      var next = ORDER[(ORDER.indexOf(current(chips)) + 1) % ORDER.length];
      var chip = chips.querySelector('.chip[data-filter="' + next + '"]');
      if (!chip) return;
      chip.click();              // 切り替えは、もとの札の処理に任せる
      paint(tab, 'カレンダー', current(chips));
      toast(WORDS[next]);
    });
  }

  /* ---------- これから：全部 ⇄ 自分だけ ---------- */
  function bootFeed() {
    var tab = document.querySelector('.tab[data-view="feed"]');
    if (!tab || !PB.Cal || !PB.Cal.feedMine) return;
    addDot(tab);
    paint(tab, 'これから', 'all');
    onTwice(tab, function () {
      var f = PB.Cal.feedMine(!PB.Cal.feedMine()) ? 'private' : 'all';
      paint(tab, 'これから', f);
      toast(WORDS[f]);
    });
  }

  document.addEventListener('DOMContentLoaded', function () { bootCal(); bootFeed(); });
})(window);

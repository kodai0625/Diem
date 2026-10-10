/* Diem 祝日（日本の国民の祝日）

   2026-10-11（ko-dai さん「祝日を表示させてください」）
   ・ネットから取らず、この中で計算する（電波が無くても出る。年が変わっても直さなくてよい）
   ・決まりは「国民の祝日に関する法律」のいまの形：
       日付が決まっている祝日／月曜に動く祝日（成人の日・海の日・敬老の日・スポーツの日）／
       春分の日・秋分の日（計算で出す。1980〜2099年に合う式）／
       振替休日（祝日が日曜なら、そのあと最初の「祝日でない日」）／
       国民の休日（前の日と次の日が祝日にはさまれた平日。例：2026年9月22日）
   ・2019〜2021年の特別な動き（即位、五輪で動いた海の日など）も入れてある。
     ★それより前（2015年以前）は、いまの決まりで出すので合わない年がある。使うのは今年と先の年なので、それでよしとした
   ・月の表は幅が狭いので、長い名前は短くして出す（short）。日の一覧には正式な名前を出す（name） */
(function (global) {
  'use strict';
  var PB = global.PB = global.PB || {};

  var cache = {};     // 年 → { 'MM-DD': 名前 }
  var SHORT = {       // 月の表で使う短い名前（5文字まで）
    '建国記念の日': '建国記念', '勤労感謝の日': '勤労感謝', 'スポーツの日': 'スポーツ',
    '天皇の即位の日': '即位の日', '即位礼正殿の儀': '即位礼'
  };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function key(d) { return pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function add(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }

  /** その月の n 回目の月曜の日（m は 1〜12） */
  function nthMonday(y, m, n) {
    var first = new Date(y, m - 1, 1).getDay();        // 0＝日曜
    return 1 + ((8 - first) % 7) + (n - 1) * 7;
  }
  function shunbun(y) { return Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4)); }
  function shubun(y) { return Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4)); }

  function build(y) {
    var h = {};
    function put(m, d, name) { h[pad(m) + '-' + pad(d)] = name; }

    put(1, 1, '元日');
    put(1, nthMonday(y, 1, 2), '成人の日');
    put(2, 11, '建国記念の日');
    if (y >= 2020) put(2, 23, '天皇誕生日');
    put(3, shunbun(y), '春分の日');
    put(4, 29, '昭和の日');
    put(5, 3, '憲法記念日');
    put(5, 4, 'みどりの日');
    put(5, 5, 'こどもの日');
    put(7, nthMonday(y, 7, 3), '海の日');
    if (y >= 2016) put(8, 11, '山の日');
    put(9, nthMonday(y, 9, 3), '敬老の日');
    put(9, shubun(y), '秋分の日');
    put(10, nthMonday(y, 10, 2), y >= 2020 ? 'スポーツの日' : '体育の日');
    put(11, 3, '文化の日');
    put(11, 23, '勤労感謝の日');
    if (y <= 2018) put(12, 23, '天皇誕生日');

    // その年だけの特別な動き
    if (y === 2019) { put(5, 1, '天皇の即位の日'); put(10, 22, '即位礼正殿の儀'); }
    if (y === 2020 || y === 2021) {
      delete h[pad(7) + '-' + pad(nthMonday(y, 7, 3))];
      delete h[pad(10) + '-' + pad(nthMonday(y, 10, 2))];
      delete h['08-11'];
      if (y === 2020) { put(7, 23, '海の日'); put(7, 24, 'スポーツの日'); put(8, 10, '山の日'); }
      else { put(7, 22, '海の日'); put(7, 23, 'スポーツの日'); put(8, 8, '山の日'); }
    }

    var base = Object.keys(h).sort();
    var isBase = {};
    base.forEach(function (md) { isBase[md] = true; });
    function dateOf(md) { return new Date(y, +md.slice(0, 2) - 1, +md.slice(3)); }

    // 国民の休日：祝日と祝日にはさまれた平日
    base.forEach(function (md) {
      var d1 = add(dateOf(md), 1), d2 = add(dateOf(md), 2);
      if (isBase[key(d2)] && !isBase[key(d1)] && d1.getDay() !== 0 && d2.getFullYear() === y) h[key(d1)] = '国民の休日';
    });
    // 振替休日：祝日が日曜なら、そのあと最初の「祝日でない日」
    base.forEach(function (md) {
      var d = dateOf(md);
      if (d.getDay() !== 0) return;
      var n = add(d, 1);
      while (h[key(n)]) n = add(n, 1);
      if (n.getFullYear() === y) h[key(n)] = '振替休日';
    });
    return h;
  }

  PB.Holidays = {
    /** その日の祝日の名前（祝日でなければ空）。日付は 'YYYY-MM-DD' */
    name: function (dateStr) {
      var y = +String(dateStr).slice(0, 4);
      if (!y) return '';
      if (!cache[y]) cache[y] = build(y);
      return cache[y][String(dateStr).slice(5)] || '';
    },
    /** 月の表に出す短い名前 */
    short: function (dateStr) {
      var n = PB.Holidays.name(dateStr);
      return SHORT[n] || n;
    }
  };
})(window);

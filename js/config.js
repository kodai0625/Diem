/* Pair Board 設定
   syncUrl … Apps Script のウェブアプリURL。空なら同期しない（端末の中だけで動く）。
   設定画面から入れた値の方が優先されます（ここは初期値）。

   合言葉（PIN）は**ここには書きません**。人ごとに設定画面で入れます。
   URLだけ知られても、合言葉がなければ中身は読めません
   （10分に10回まちがえると、そのURLは10分止まります）。 */
var APP = {
  name: 'Diem',        // 画面に出る名前（2026-09-30 に Pair Board から変えた）
  version: 'ea796c02',
  syncUrl: 'https://script.google.com/macros/s/AKfycbxlH0eesofQYkx-Ml1MJQqZ7xOWZlqAN2aZTxP9iuzXcITal1aqNbX8-P0ixR22tciYAg/exec',
  autoSyncSec: 60     // 何秒ごとに自動で同期するか
};

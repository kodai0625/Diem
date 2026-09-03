/* Pair Board 設定
   syncUrl … Apps Script のウェブアプリURL。空なら同期しない（端末の中だけで動く）。
   ここを空のままでもアプリは全部動きます。共有を始めるときにURLを入れます。
   設定画面から入れた値の方が優先されます（ここは初期値）。 */
var APP = {
  name: 'Pair Board',
  version: 'de26d44e',
  syncUrl: '',        // 例: https://script.google.com/macros/s/xxxxx/exec
  autoSyncSec: 60     // 何秒ごとに自動で同期するか
};

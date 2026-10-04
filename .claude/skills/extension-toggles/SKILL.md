---
name: extension-toggles
description: Extension Toggles (拡張機能の有効/無効切り替えと開発中の拡張の再読み込みを行う Chrome 拡張) を改修・デバッグするときに使う。chrome.management の挙動、再読み込みの仕組みと限界、却下した案、テスト手順を記録している。
---

# Extension Toggles 開発メモ

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `popup.js` / `popup.html` / `popup.css` | 本体。service worker は持たない |
| `icons/icon.svg` | アイコンの原本。PNG はここから書き出す |
| `docs/popup.png` | README 用のスクリーンショット(ダミーの拡張で撮る) |

ストレージは使っていない。状態はすべて `chrome.management` が持っている。

## 中心にある設計判断

### 再読み込み = `setEnabled(false)` → `setEnabled(true)`

ほかの拡張を再読み込みする公開 API はない。`chrome://extensions` の更新ボタンは
`chrome.developerPrivate` を使っていて、これは `chrome://extensions` ページ専用で普通の拡張からは呼べない。
`chrome.runtime.reload()` も自分自身にしか効かない。

そこで無効→有効を続けて呼んでいる。2026-10-04 に Brave Nightly で実際に確かめた結果:

| 対象 | 無効→有効の後 |
| --- | --- |
| service worker の JS | ディスクから読み直される |
| content script の JS | ディスクから読み直される(新しく開いたページで確認) |
| `manifest.json` | **読み直されない**(`getAll()` の `version` も、`matches` などの定義も古いまま) |

ブラウザが無効化した拡張の解析済み manifest を保持していて、有効化のときにそれを使い回すためと思われる。
JS のファイルは起動のたびにディスクから読むので変更が入る。
ポップアップには「manifest.json の変更は反映されません」と毎回表示している。

無効になっている拡張の再読み込みボタンは押せなくしている。有効にした時点で同じ効果があるため。

### manifest の変更まで反映する案(未実装)

開発中の拡張の側に `chrome.runtime.onMessageExternal` を受けて自分で `chrome.runtime.reload()` を呼ぶ処理を入れ、
ポップアップから `chrome.runtime.sendMessage(id, ...)` で頼む、という方式なら manifest も読み直せるはず(未検証)。
開発中の拡張ごとに手を入れる必要があるので、必要になるまで入れないことにした。

### 一覧の並びと分け方

- `installType === "development"` を「開発中」として上にまとめる。`--load-extension` で読み込んだものも `development` になる。
- 並びは名前順のみ。有効なものを上に寄せる案は、トグルを押した瞬間に行が移動して押し間違えるので採らなかった。
- `type === "extension"` だけを出す。`getAll()` にはテーマやアプリも入ってくる。
- 自分自身は出さない。自分を無効にするとポップアップごと消え、戻す手段がなくなる。
- `mayDisable === false`(ポリシーで強制インストール)はトグルを `disabled` にする。

### アイコン画像

`ext.icons[].url` は `chrome://extension-icon/<id>/<size>/<match>` の形で、`management` 権限があれば
拡張のページから `<img>` でそのまま読める。無効な拡張も同じ URL で読めるので、薄く見せるのは CSS の `opacity` で行う。
アイコンを持たない拡張は `icons` が無いので、`<img>` を `visibility: hidden` にして列をそろえる。

### 変更の追従

`management.onEnabled / onDisabled / onInstalled / onUninstalled` で描き直す。再読み込みでは
`onDisabled` と `onEnabled` が続けて来るので、50ms の `setTimeout` でまとめて1回にしている。
自分のトグル操作の結果も、このイベント経由で描き直される(トグル側で行を直接書き換えていない)。

## アイコン

lucide の toggle-right と同じ形(角丸のスイッチ + つまみ)。最初はスイッチを上下に2つ並べた案にしたが、
16px だと上下の枠がくっつき、つまみも潰れたので1つにした。

## テスト手順(Playwright + Brave Nightly)

使い捨てのスクリプトは scratchpad に置く(このリポジトリには置かない)。手順:

1. 一時ディレクトリにダミー拡張を2つ作る(片方は `icons` 付き、両方とも service worker と
   `http://localhost/*` 向けの content script を持つ)。名前は `Sample Alpha` のような架空のものにする
   (スクリーンショットを README に使うため、実在の拡張名を入れない)。
2. このリポジトリとダミー2つを `--load-extension=a,b,c` と `--disable-extensions-except=a,b,c` でまとめて読み込む。
3. 各拡張の ID は、`chrome://extensions/` を開いたページで
   `chrome.developerPrivate.getExtensionsInfo()` を evaluate して名前から引く。
   この拡張は service worker を持たないので、`context.serviceWorkers()` からは取れない。
4. `chrome-extension://<id>/popup.html` を普通のタブで開いて操作する。確認する点:
   - 自分自身が出ず、ダミー2つが「開発中」に出る / アイコンの `naturalWidth > 0`
   - トグル(`.slider` をクリック)で `getAll()` の `enabled` が変わり、行が `.off` になる / 無効な行の再読み込みボタンは disabled
   - ダミーの `cs.js` を書き換えて再読み込みボタン → 新しく開いた localhost のページに新しい値が出る
   - 検索で絞れる / 該当なしの表示
5. ストアからインストールした拡張(「インストール済み」セクション)は、この方法では用意できないので手動で確認する。

README のスクリーンショットは、マウスを (0,0) に逃がしてから `body` を撮る(ホバーの背景が写り込むため)。

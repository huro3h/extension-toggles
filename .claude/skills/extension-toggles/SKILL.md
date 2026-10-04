---
name: extension-toggles
description: Extension Toggles (拡張機能の有効/無効切り替えと開発中の拡張の再読み込みを行う Chrome 拡張) を改修・デバッグするときに使う。chrome.management の挙動、再読み込みの仕組みと限界、却下した案、テスト手順を記録している。
---

# Extension Toggles 開発メモ

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `popup.js` / `popup.html` / `popup.css` | 一覧・トグル・検索 |
| `background.js` | 再読み込み(無効→有効)だけを受け持つ service worker |
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

### 再読み込みは service worker で行う(ポップアップで行わない)

1.0.0 ではポップアップの中で `setEnabled(false)` → `setEnabled(true)` を呼んでいた。
対象の拡張がツールバーに固定されていると、無効にした瞬間にアイコンが消えてツールバーの並びが変わり、
ポップアップが閉じることがある。そこで処理が止まると**対象が無効のまま残る**。
普段使いの Chrome で Smart Reload(ツールバーに固定済み)を試したとき、1回目は反映されず、2回目は反映された。
ポップアップが閉じたせいかは確かめられていない(ツールバーのポップアップは自動操作できない)が、
起こりうると対象が無効のまま残るので、先に塞いだ。

いまはポップアップから `chrome.runtime.sendMessage({ type: "reload", id })` を送り、`background.js` が
無効→有効を最後まで実行して結果を返す。ポップアップが閉じていたら返事は誰にも届かないが、再読み込みは完了する。

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

### 拡張が多いとき

ポップアップの高さの上限は 600px。普段使いの Chrome には拡張が30個以上あり、すぐに超える。
1.0.0 ではメッセージ(`#status`)を一覧の最後に置いていたので、スクロールしないと見えなかった。
いまは検索欄を `position: sticky; top: 0`、メッセージを `position: sticky; bottom: 0` で貼り付けている。
各セクションの一覧に `max-height` を付けて個別にスクロールさせる案は、スクロールが入れ子になるのでやめた。

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
   (`context.serviceWorkers()` からも取れるが、名前で引けるこちらの方が確実)
4. `chrome-extension://<id>/popup.html` を普通のタブで開いて操作する。確認する点:
   - 自分自身が出ず、ダミー2つが「開発中」に出る / アイコンの `naturalWidth > 0`
   - トグル(`.slider` をクリック)で `getAll()` の `enabled` が変わり、行が `.off` になる / 無効な行の再読み込みボタンは disabled
   - ダミーの `cs.js` を書き換えて再読み込みボタン → 新しく開いた localhost のページに新しい値が出る
   - 検索で絞れる / 該当なしの表示
   - ダミーを30個ほど足してビューポートを 320×600 にし、一覧がスクロールする状態でもメッセージと検索欄が画面内にある
   - 別タブで `popup.html` を開いて `sendMessage({ type: "reload", id })` を送った直後にそのタブを閉じても、対象が有効のまま
     (ポップアップが途中で閉じる場合の代わり。本物のツールバーのポップアップは自動操作できない)
5. Chrome の本体(retail)は `--load-extension` を無視するが、Puppeteer の `browser.installExtension(path)`
   (`pipe: true, enableExtensions: true`)なら読み込める。Chrome 154 で無効→有効の挙動が Brave と同じことをこれで確かめた。
6. ストアからインストールした拡張(「インストール済み」セクション)は、この方法では用意できないので手動で確認する。

README のスクリーンショットは、マウスを (0,0) に逃がしてから `body` を撮る(ホバーの背景が写り込むため)。

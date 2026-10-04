// 再読み込み(無効→有効)はポップアップではなくここで行う。
// 対象の拡張がツールバーに固定されていると、無効にした瞬間にアイコンが消えて
// ポップアップが閉じることがある。ポップアップ側で処理していると、そこで止まって
// 対象が無効のまま残ってしまう。service worker ならポップアップが閉じても最後まで走る。
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "reload") return false;

  (async () => {
    try {
      await chrome.management.setEnabled(message.id, false);
      await chrome.management.setEnabled(message.id, true);
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }
  })();
  return true;
});

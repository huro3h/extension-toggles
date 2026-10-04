const el = {
  search: document.getElementById("search"),
  devSection: document.getElementById("devSection"),
  devList: document.getElementById("devList"),
  otherSection: document.getElementById("otherSection"),
  otherList: document.getElementById("otherList"),
  empty: document.getElementById("empty"),
  status: document.getElementById("status"),
  rowTemplate: document.getElementById("rowTemplate"),
};

const SELF_ID = chrome.runtime.id;

let statusTimer = null;

function flash(message, { error = false, ms = 2500 } = {}) {
  el.status.textContent = message;
  el.status.classList.toggle("error", error);
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    el.status.textContent = "";
  }, ms);
}

// 一覧に出すのは拡張機能だけ。テーマ・アプリと、自分自身(自分は無効にできない)は除く。
async function listExtensions() {
  const all = await chrome.management.getAll();
  return all
    .filter((ext) => ext.type === "extension" && ext.id !== SELF_ID)
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

// 16px 以上で一番小さいアイコン。アイコンを持たない拡張は undefined。
function iconUrlOf(ext) {
  const icons = [...(ext.icons ?? [])].sort((a, b) => a.size - b.size);
  return (icons.find((icon) => icon.size >= 16) ?? icons.at(-1))?.url;
}

function buildRow(ext) {
  const row = el.rowTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.id = ext.id;
  row.classList.toggle("off", !ext.enabled);

  const icon = row.querySelector(".icon");
  const iconUrl = iconUrlOf(ext);
  if (iconUrl) icon.src = iconUrl;
  else icon.style.visibility = "hidden";

  row.querySelector(".name").textContent = ext.name;
  row.querySelector(".version").textContent = ext.version;
  row.title = ext.description ? `${ext.name}\n${ext.description}` : ext.name;

  const toggle = row.querySelector(".toggle");
  toggle.checked = ext.enabled;
  toggle.setAttribute("aria-label", `${ext.name} を有効にする`);
  if (!ext.mayDisable) {
    toggle.disabled = true;
    row.querySelector(".switch").title = "管理者のポリシーにより変更できません";
  }
  toggle.addEventListener("change", () => setEnabled(ext, toggle.checked));

  if (ext.installType === "development") {
    const reload = row.querySelector(".reload");
    reload.classList.remove("hidden");
    // 無効な拡張は有効にした時点でディスクから読まれるので、再読み込みは不要。
    reload.disabled = !ext.enabled;
    reload.addEventListener("click", () => reloadExtension(ext));
  }

  return row;
}

async function render() {
  const query = el.search.value.trim().toLowerCase();
  const extensions = (await listExtensions()).filter((ext) =>
    ext.name.toLowerCase().includes(query)
  );

  const dev = extensions.filter((ext) => ext.installType === "development");
  const other = extensions.filter((ext) => ext.installType !== "development");

  el.devList.replaceChildren(...dev.map(buildRow));
  el.otherList.replaceChildren(...other.map(buildRow));
  el.devSection.classList.toggle("hidden", dev.length === 0);
  el.otherSection.classList.toggle("hidden", other.length === 0);

  el.empty.textContent = query
    ? "一致する拡張機能はありません"
    : "ほかに拡張機能がインストールされていません";
  el.empty.classList.toggle("hidden", extensions.length > 0);
}

async function setEnabled(ext, enabled) {
  try {
    await chrome.management.setEnabled(ext.id, enabled);
  } catch (error) {
    flash(`${ext.name}: ${error.message}`, { error: true, ms: 5000 });
    await render();
  }
}

// 無効→有効で、service worker・content script などのファイルはディスクから読み直される。
// manifest.json だけは読み直されない(chrome://extensions の更新ボタンが必要)。
// 処理は background.js に任せる(途中でポップアップが閉じても無効のまま残らないように)。
async function reloadExtension(ext) {
  const result = await chrome.runtime.sendMessage({ type: "reload", id: ext.id });
  if (result?.ok) {
    flash(`${ext.name} を再読み込みしました(manifest.json の変更は反映されません)`);
  } else {
    flash(`${ext.name}: ${result?.error ?? "再読み込みに失敗しました"}`, { error: true, ms: 5000 });
    await render();
  }
}

// 他の場所(chrome://extensions など)での変更や、自分の操作の結果を一覧に反映する。
// 再読み込みでは無効→有効の2回イベントが来るので、まとめて1回描き直す。
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(() => {
    renderQueued = false;
    render();
  }, 50);
}

for (const event of [
  chrome.management.onEnabled,
  chrome.management.onDisabled,
  chrome.management.onInstalled,
  chrome.management.onUninstalled,
]) {
  event.addListener(scheduleRender);
}

el.search.addEventListener("input", render);

render();

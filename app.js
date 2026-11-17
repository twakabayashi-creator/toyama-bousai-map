// とやま防災めぐり（GPS版）
// 防災ポイントの内容は spots.csv（Excelで編集できます）にあります。

const HZ = ["洪水", "崖崩れ等", "高潮", "地震", "津波", "大規模な火事", "内水氾濫", "火山"];
const LABEL = { 1: "洪水", 2: "崖崩れ・土石流", 8: "地震", 16: "津波" };
const RANKS = [[0, "防災ビギナー"], [500, "防災サポーター"], [1000, "防災リーダー"], [1600, "防災エキスパート"], [2200, "とやま防災マスター"]];
const CHECKIN_RADIUS_M = 300; // 現地チェックインできる距離（メートル）

// ---------- spots.csv を読み込む ----------
let SPOTS = [], CSV_ERRORS = [];

// Excelの「CSV UTF-8」でも、ふつうの「CSV（Shift_JIS）」でも読めるようにする
function decodeCsv(buf) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, ""); }
  catch (e) { return new TextDecoder("shift_jis").decode(buf); }
}
// CSVを表（行の配列）に分ける。「"」で囲まれたカンマや改行にも対応
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const MISSION_WORD = s => /洪水|浸水|大雨/.test(s) ? 1 : /崖|土砂|土石|地すべり|地滑り/.test(s) ? 2 : /津波/.test(s) ? 16 : /地震/.test(s) ? 8 : 0;

function buildSpots(rows) {
  const head = (rows.shift() || []).map(h => h.trim());
  const col = name => head.indexOf(name);
  const need = ["名前", "緯度", "経度", "問題", "正解"];
  const missing = need.filter(n => col(n) < 0);
  if (missing.length) { CSV_ERRORS.push(`1行目（見出し）に「${missing.join("」「")}」の列が見つかりません。`); return []; }
  const get = (r, name) => col(name) < 0 ? "" : (r[col(name)] || "").trim();
  const out = [], used = new Set();
  rows.forEach((r, i) => {
    const line = i + 2;
    if (r.every(c => !c.trim())) return; // 空の行は飛ばす
    const name = get(r, "名前"), lat = parseFloat(get(r, "緯度")), lng = parseFloat(get(r, "経度"));
    const wrong = ["不正解1", "不正解2", "不正解3"].map(n => get(r, n)).filter(Boolean);
    const errs = [];
    if (!name) errs.push("名前が空です");
    if (lat > 122 && lat < 154 && lng > 20 && lng < 46) errs.push("緯度と経度が逆になっています（緯度は36.○○、経度は137.○○）");
    else {
      if (!(lat > 20 && lat < 46)) errs.push("緯度が正しくありません（例：36.70）");
      if (!(lng > 122 && lng < 154)) errs.push("経度が正しくありません（例：137.21）");
    }
    if (!get(r, "問題")) errs.push("問題が空です");
    if (!get(r, "正解")) errs.push("正解が空です");
    if (!wrong.length) errs.push("不正解が1つもありません");
    if (errs.length) { CSV_ERRORS.push(`${line}行目（${name || "名前なし"}）：${errs.join("、")}`); return; }
    let id = parseInt(get(r, "番号"), 10);
    if (!(id > 0) || used.has(id)) id = 1000 + line;
    used.add(id);
    const c = [get(r, "正解"), ...wrong];
    for (let k = c.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [c[k], c[j]] = [c[j], c[k]]; }
    // 画面に出す文字は安全な形に変換しておく
    out.push({
      id, no: out.length + 1, name: esc(name), title: name, place: esc(get(r, "場所")), lat, lng, hzName: esc(get(r, "災害の種類") || "防災"),
      mission: MISSION_WORD(get(r, "ミッション")),
      learn: ["説明1", "説明2", "説明3"].map(n => esc(get(r, n))).filter(Boolean),
      pose: /^[a-z\-]+$/.test(get(r, "キャラクター")) ? get(r, "キャラクター") : "",
      q: esc(get(r, "問題")), a: c.indexOf(get(r, "正解")), c: c.map(esc), why: esc(get(r, "解説"))
    });
  });
  return out;
}
// ---------- 案内役のクマ ----------
// pose：images/poses/ の画像名（拡張子なし）、text：セリフ、cls：吹き出しにつける追加の見た目
const POSE = name => `images/poses/${name}.png`;
const guide = (pose, text, cls = "") => `<div class="guide ${cls}"><img src="${POSE(pose)}" alt="" width="72" height="80"><div class="say">${text}</div></div>`;
let toastTimer = null;
function toast(pose, text) {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.innerHTML = guide(pose, text);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 4000);
  el.onclick = () => el.classList.remove("show");
}
// 称号が上がったら力こぶのクマでお知らせ
function checkRankUp() {
  const idx = RANKS.filter(r => total() >= r[0]).length - 1;
  if (state.rankIdx === undefined) { state.rankIdx = idx; save(); return; }
  if (idx > state.rankIdx) { state.rankIdx = idx; save(); toast("power", `称号アップ！<b>「${RANKS[idx][1]}」</b>になったよ！`); }
  else if (idx < state.rankIdx) { state.rankIdx = idx; save(); }
}

const esc = s => String(s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

// ---------- 保存（この端末の中だけ） ----------
let state = { done: {}, tries: {}, mission: {}, here: {}, sp: {}, coupon: {}, seen: {} };
try { const s = JSON.parse(localStorage.getItem("toyama-bousai-gps") || "null"); if (s && s.done) state = { ...state, ...s }; } catch (e) {}
const save = () => { try { localStorage.setItem("toyama-bousai-gps", JSON.stringify(state)); } catch (e) {} };

const $ = id => document.getElementById(id);
const km = (a, b, c, d) => { const t = Math.PI / 180, x = (d - b) * t * Math.cos((a + c) / 2 * t), y = (c - a) * t; return Math.sqrt(x * x + y * y) * 6371; };
const fmt = k => k < 1 ? `${Math.round(k * 1000)}m` : `${k.toFixed(1)}km`;

// ---------- 地図 ----------
const map = L.map("map", { minZoom: 8, maxZoom: 18, zoomSnap: .5, maxBounds: [[35.9, 136.3], [37.4, 138.2]] });
map.attributionControl.setPrefix(false);
map.fitBounds([[36.5, 136.85], [36.98, 137.7]]);
L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png",
  { maxZoom: 18, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a> | <a href="https://disaportal.gsi.go.jp/" target="_blank">ハザードマップポータル</a> | 富山データ連携基盤' }).addTo(map);

const D = "https://disaportaldata.gsi.go.jp/raster/";
const hz = (paths, opacity) => L.layerGroup(paths.map(p => L.tileLayer(D + p + "/{z}/{x}/{y}.png", { opacity, maxNativeZoom: 17, maxZoom: 18 })));
const layers = {
  flood: hz(["01_flood_l2_shinsuishin_kuni_data", "01_flood_l2_shinsuishin_pref_data/16"], .75),
  tsunami: hz(["04_tsunami_newlegend_pref_data/16"], .85),
  dosha: hz(["05_dosekiryukeikaikuiki_data/16", "05_kyukeishakeikaikuiki_data/16", "05_jisuberikeikaikuiki_data/16"], .75),
  volcano: L.layerGroup(),
  shelter: L.layerGroup()
};
Object.values(layers).forEach(l => l.addTo(map));
["flood", "tsunami", "dosha", "volcano", "shelter"].forEach(k =>
  $("ly-" + k).addEventListener("change", e => { e.target.checked ? layers[k].addTo(map) : map.removeLayer(layers[k]); if (k === "shelter") updateShelterVis(); }));

fetch("data/volcano.json").then(r => r.json()).then(g => {
  L.geoJSON(g, {
    style: f => {
      const n = f.properties.name;
      return n === "想定火口" ? { color: "#7b3fa0", weight: 2, fillColor: "#7b3fa0", fillOpacity: .6 }
        : n.startsWith("噴石") ? { color: "#7b3fa0", weight: 1.5, fillColor: "#9b59b6", fillOpacity: .35, dashArray: "4 3" }
        : { color: "#7b3fa0", weight: 1, fillColor: "#c39bd3", fillOpacity: .3 };
    },
    onEachFeature: (f, l) => l.bindPopup(`<b>弥陀ヶ原火山</b><br>${f.properties.name}の想定範囲`)
  }).addTo(layers.volcano);
}).catch(() => {});

// ---------- 避難場所 ----------
let SHELTERS = [];
const canvas = L.canvas({ padding: .5 }), shelterLayer = L.layerGroup();
const badges = m => HZ.map((h, i) => m & (1 << i) ? `<span class="hz">${h}</span>` : "").join("");
fetch("data/shelters.json").then(r => r.json()).then(rows => {
  // 名前は画面に出す前に安全な形に変換しておく（データに記号が混ざっていても画面が壊れないように）
  SHELTERS = rows.map(([name, city, lat, lng, m]) => ({ name: esc(name), city: esc(city), lat: +lat, lng: +lng, m: m | 0 }));
  SHELTERS.forEach(s => {
    s.marker = L.circleMarker([s.lat, s.lng], { renderer: canvas, radius: 5, color: "#fff", weight: 1.5, fillColor: "#1f8a5b", fillOpacity: 1 });
    s.marker.on("click", () => shelterClick(s));
    s.marker.addTo(shelterLayer);
  });
  updateShelterVis();
}).catch(() => {});
function updateShelterVis() {
  const on = $("ly-shelter").checked && (map.getZoom() >= 11 || mission);
  if (on && !layers.shelter.hasLayer(shelterLayer)) layers.shelter.addLayer(shelterLayer);
  if (!on && layers.shelter.hasLayer(shelterLayer)) layers.shelter.removeLayer(shelterLayer);
}
map.on("zoomend", updateShelterVis);

// ---------- ミッション：近くの避難場所をさがす ----------
let mission = null;
function startMission(s) {
  mission = s;
  $("ly-shelter").checked = true; layers.shelter.addTo(map); updateShelterVis();
  map.flyTo([s.lat, s.lng], 15, { duration: .8 });
  $("bannertext").textContent = `ミッション：「${LABEL[s.mission]}」のときに使える、近くの避難場所（緑の点）をタップしよう`;
  $("banner").hidden = false;
  $("map").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function endMission() { mission = null; $("banner").hidden = true; updateShelterVis(); }
$("bannerclose").onclick = endMission;

function shelterClick(sh) {
  let html = `<b>${sh.name}</b><br><span style="color:#5b7179">${sh.city}</span><br>${badges(sh.m)}`;
  if (me) html += `<div>いまいる場所から 約${fmt(km(me.lat, me.lng, sh.lat, sh.lng))}</div>`;
  if (mission) {
    const s = mission, bit = s.mission, label = LABEL[bit];
    const d = km(s.lat, s.lng, sh.lat, sh.lng);
    const ok = SHELTERS.filter(x => x.m & bit).map(x => ({ x, d: km(s.lat, s.lng, x.lat, x.lng) })).sort((a, b) => a.d - b.d);
    const rank = ok.findIndex(o => o.x === sh);
    if (!(sh.m & bit)) {
      html += `<div class="verdict ng popguide"><img src="${POSE("surprise")}" alt="">ここは「${label}」のときには使えない避難場所だよ！避難場所は、災害の種類ごとに決められています。</div>`;
    } else if (rank > -1 && (rank < 5 || d <= ok[0].d + 1)) {
      html += `<div class="verdict ok popguide"><img src="${POSE("banzai")}" alt="">ミッション成功！ ${label}のときに使える避難場所です（${s.name}から約${fmt(d)}）。+50pt</div>`;
      if (!state.mission[s.id]) { state.mission[s.id] = true; save(); }
      endMission(); openSpot(s.id, true);
    } else {
      html += `<div class="verdict mid popguide"><img src="${POSE("question")}" alt="">${label}のときに使えます。でも、もっと近い避難場所があるよ（約${fmt(d)}）。</div>`;
    }
  }
  L.popup({ maxWidth: 260 }).setLatLng([sh.lat, sh.lng]).setContent(html).openOn(map);
}

// ---------- GPS（現在地） ----------
let me = null, meMarker = null, meCircle = null, watchId = null, firstFix = true;

// 自分の位置のマーク：キャラクター画像が読み込めたらそれを、だめなら青い点を使う
let charImg = null;
if (typeof MY_CHARACTER_IMAGE !== "undefined" && MY_CHARACTER_IMAGE) {
  const im = new Image();
  im.onload = () => { charImg = im; if (meMarker) meMarker.setIcon(meIcon()); };
  im.src = MY_CHARACTER_IMAGE;
}
function meIcon() {
  if (!charImg) return L.divIcon({ className: "", html: '<div class="me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
  const h = (typeof MY_CHARACTER_HEIGHT !== "undefined" && MY_CHARACTER_HEIGHT) || 64;
  const w = Math.round(h * charImg.naturalWidth / charImg.naturalHeight);
  // 足元（画像の下のまん中）が現在地になるように置く
  return L.icon({ iconUrl: charImg.src, iconSize: [w, h], iconAnchor: [w / 2, h], className: "mechar" });
}
$("gpsbtn").onclick = () => {
  if (watchId !== null) { stopGps(); return; }
  if (!("geolocation" in navigator)) { $("gpsmsg").textContent = "この端末では現在地が使えません。"; return; }
  $("gpsmsg").textContent = "現在地をさがしています…（位置情報の許可を求められたら「許可」を押してください）";
  watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
  $("gpsbtn").textContent = "📍 現在地をオフにする";
};
function stopGps() {
  navigator.geolocation.clearWatch(watchId); watchId = null; me = null; firstFix = true;
  if (meMarker) { map.removeLayer(meMarker); map.removeLayer(meCircle); meMarker = meCircle = null; }
  $("gpsbtn").textContent = "📍 現在地をオンにする"; $("nearbtn").hidden = true;
  $("gpsmsg").textContent = "現在地をオフにしました。";
  rerender();
}
function onPos(p) {
  me = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
  if (!meMarker) {
    meCircle = L.circle([me.lat, me.lng], { radius: me.acc, color: "#1a73e8", weight: 1, fillOpacity: .1 }).addTo(map);
    meMarker = L.marker([me.lat, me.lng], { icon: meIcon(), zIndexOffset: 2000, title: "いまいる場所" }).addTo(map);
  } else { meMarker.setLatLng([me.lat, me.lng]); meCircle.setLatLng([me.lat, me.lng]).setRadius(me.acc); }
  if (firstFix) { toast("plug-on", "現在地オン！近くの防災ポイントをさがしてみよう。"); }
  if (firstFix) { firstFix = false; map.flyTo([me.lat, me.lng], Math.max(map.getZoom(), 14), { duration: .8 }); }
  $("nearbtn").hidden = false;
  const n = nearestSpot();
  $("gpsmsg").textContent = `現在地オン（誤差 約${Math.round(me.acc)}m）。いちばん近いポイント：${n.s.name}（${fmt(n.d)}）`;
  rerender();
}
function onPosErr(e) {
  const msg = e.code === 1 ? "位置情報が許可されていません。スマホの設定で、ブラウザに位置情報の利用を許可してください。"
    : "現在地がわかりませんでした。空が見える場所でもう一度ためしてください。";
  $("gpsmsg").textContent = msg;
  if (e.code === 1) stopGps(), ($("gpsmsg").textContent = msg);
}
function nearestSpot() {
  return SPOTS.map(s => ({ s, d: km(me.lat, me.lng, s.lat, s.lng) })).sort((a, b) => a.d - b.d)[0];
}
// チェックインできるか：ポイントから半径以内、かつ位置の誤差が大きすぎない
function canCheckIn(s) {
  if (!me) return false;
  const d = km(me.lat, me.lng, s.lat, s.lng) * 1000;
  return d <= CHECKIN_RADIUS_M + Math.min(me.acc, 100) && me.acc <= 200;
}

// ---------- 近くの避難場所 ----------
function showNearby(bit) {
  if (!me) return;
  endMission(); current = null; currentSponsor = null; refresh(0);
  map.flyTo([me.lat, me.lng], 15, { duration: .6 });
  const list = SHELTERS.filter(s => !bit || (s.m & bit)).map(s => ({ s, d: km(me.lat, me.lng, s.lat, s.lng) })).sort((a, b) => a.d - b.d).slice(0, 5);
  const tabs = [[0, "すべて"], [1, "洪水"], [16, "津波"], [8, "地震"], [2, "崖崩れ"]];
  $("panel").innerHTML = `<span class="tag">いまいる場所から</span><h2>近くの避難場所</h2>
    ${guide("run", "いざというとき、どこへ逃げるか確かめておこう！")}
    <div class="btnrow">${tabs.map(([b, t]) => `<button class="btn ${b === bit ? "green" : "ghost"}" data-b="${b}">${t}</button>`).join("")}</div>
    <div class="box">${list.length ? list.map((o, i) => `<div><b>${i + 1}. ${o.s.name}</b>（約${fmt(o.d)}）<br>${badges(o.s.m)} <button class="btn ghost" style="padding:2px 10px;font-size:12px" data-i="${i}">地図で見る</button></div>`).join("") : "見つかりませんでした。"}</div>
    <p class="note">距離はまっすぐ測った距離です。実際に歩く道のりは、もっと長くなります。避難場所は災害の種類ごとに違うので、家族で確かめておきましょう。</p>
    <div class="btnrow"><button class="btn ghost" id="back">スタンプ帳へ</button></div>`;
  $("panel").querySelectorAll("[data-b]").forEach(b => b.onclick = () => showNearby(+b.dataset.b));
  $("panel").querySelectorAll("[data-i]").forEach(b => b.onclick = () => { const s = list[+b.dataset.i].s; map.flyTo([s.lat, s.lng], 16); shelterClick(s); $("map").scrollIntoView({ behavior: "smooth", block: "nearest" }); });
  $("back").onclick = home;
  $("ly-shelter").checked = true; layers.shelter.addTo(map); updateShelterVis();
}
$("nearbtn").onclick = () => showNearby(0);

// ---------- 防災ポイントのピン ----------
const pinIcon = (s, sel) => L.divIcon({ className: "", iconSize: [30, 30], iconAnchor: [15, 15],
  html: `<div class="pin ${state.done[s.id] ? "done" : ""} ${state.here[s.id] ? "here" : ""} ${sel ? "sel" : ""}">${s.no}</div>` });
function createPins() {
  createSponsorPins();
  SPOTS.forEach(s => {
    s.marker = L.marker([s.lat, s.lng], { icon: pinIcon(s, false), title: s.title, zIndexOffset: 1000 }).addTo(map);
    s.marker.on("click", () => openSpot(s.id));
  });
}

// ---------- 画面 ----------
const total = () => Object.values(state.done).reduce((a, b) => a + b, 0) + Object.keys(state.mission).length * 50 + Object.keys(state.here).length * 100 + Object.keys(state.sp).length * 50 + (state.homeCheck ? 50 : 0);
const rankOf = p => RANKS.filter(r => p >= r[0]).pop()[1];
let current = null;
function rerender() { if (currentSponsor) openSponsor(currentSponsor, true); else if (current) openSpot(current, true); else refresh(0); }

function refresh(sel) {
  checkRankUp();
  const p = total(), n = Object.keys(state.done).length;
  $("pt").textContent = p;
  $("st").textContent = `${n} / ${SPOTS.length}`;
  $("ci").textContent = `${Object.keys(state.here).length} / ${SPOTS.length}`;
  $("rk").textContent = rankOf(p);
  $("barfill").style.width = (n / SPOTS.length * 100) + "%";
  SPOTS.forEach(s => s.marker.setIcon(pinIcon(s, s.id === sel)));
  renderSponsorList(sel);
  $("list").innerHTML = SPOTS.map(s => {
    const pts = (state.done[s.id] || 0) + (state.mission[s.id] ? 50 : 0) + (state.here[s.id] ? 100 : 0);
    const dist = me ? fmt(km(me.lat, me.lng, s.lat, s.lng)) : s.hzName;
    return `<li class="${state.done[s.id] ? "done" : ""} ${state.here[s.id] ? "here" : ""}"><button data-id="${s.id}"><span class="n">${s.no}</span><span>${s.name}</span><span class="p">${pts ? pts + "pt・" : ""}${dist}</span></button></li>`;
  }).join("");
  document.querySelectorAll("#list button").forEach(b => b.onclick = () => { openSpot(+b.dataset.id); $("map").scrollIntoView({ behavior: "smooth", block: "start" }); });
}

function home() {
  current = null; currentSponsor = null; refresh(0);
  const p = total(), next = RANKS.find(r => r[0] > p);
  $("panel").innerHTML = `${csvWarning()}${guide("peek", "いっしょに防災ポイントをめぐろう！")}
    <div class="box home-cta"><b class="t">🏠 わが家</b><span>${state.home ? "わが家の浸水の深さや、近くの避難場所を確かめよう。" : "自宅を登録すると、わが家の危険と近くの避難場所がわかります（+50pt）。"}</span><div><button class="btn green" id="homebtn2">${state.home ? "わが家のハザードチェック" : "自宅を登録する"}</button></div></div><div class="intro"><span class="tag">あそびかた</span>
    <ol><li>地図の番号をタップして、防災ポイントを開こう</li><li>説明を読んでクイズに答えると、スタンプがもらえるよ</li><li>ミッションで、近くの避難場所を地図からさがそう</li><li>実際にその場所へ行って「現地チェックイン」すると、金のスタンプと +100pt！</li></ol></div>
    <div><span class="tag">いまの称号</span><p class="rank">${rankOf(p)}</p><p class="note">${next ? `あと ${next[0] - p}pt で「${next[1]}」` : "すべての称号を手に入れました！"}</p></div>
    <div><span class="tag">スタンプ帳（金色＝現地、緑の丸＝ミッション）</span><div class="stamps">${SPOTS.map(s => `<button class="stamp ${state.done[s.id] ? "got" : ""} ${state.here[s.id] ? "here" : ""}" data-id="${s.id}" aria-label="${s.name}">${state.done[s.id] || state.here[s.id] ? s.name.replace(/・.*|の.*/, "") : s.no}${state.mission[s.id] ? '<i class="m"></i>' : ""}</button>`).join("")}</div></div>
    ${Object.keys(state.done).length || Object.keys(state.here).length ? `<div class="btnrow"><button class="btn ghost" id="reset">はじめからやり直す</button></div>` : ""}`;
  $("panel").querySelectorAll(".stamp").forEach(b => b.onclick = () => openSpot(+b.dataset.id));
  $("homebtn2").onclick = () => openHome();
  const r = $("reset");
  if (r) r.onclick = () => {
    r.outerHTML = `<span class="note">スタンプとポイントを全部消します。</span><button class="btn" id="reset2">消す</button><button class="btn ghost" id="cancel">やめる</button>`;
    $("reset2").onclick = () => { state = { done: {}, tries: {}, mission: {}, here: {}, sp: {}, coupon: {}, seen: {}, home: state.home }; save(); home(); };
    $("cancel").onclick = home;
  };
}

function checkinBox(s) {
  if (state.here[s.id]) return `<div class="box checkin clear"><b class="t">現地チェックイン済み +100pt</b><span>実際に来て、自分の目で確かめました。まわりの地形や、避難場所までの道も見ておこう。</span></div>`;
  if (!me) return `<div class="box checkin"><b class="t">現地チェックイン +100pt</b>${guide("sleep", "現在地がオフだと眠っちゃう…。この場所に実際に行くと、金のスタンプがもらえるよ。", "small")}<div><button class="btn gold" id="gpson">📍 現在地をオンにする</button></div></div>`;
  const d = km(me.lat, me.lng, s.lat, s.lng);
  if (canCheckIn(s)) return `<div class="box checkin">${guide("surprise", "着いたよ！チェックインしよう！", "small")}<div><button class="btn gold" id="doci">現地チェックインする</button></div></div>`;
  return `<div class="box checkin"><b class="t">現地チェックイン +100pt</b><span>ここから約${fmt(d)}。ポイントから${CHECKIN_RADIUS_M}m以内に近づくとチェックインできます。</span><span class="note">移動するときは、まわりの安全に気をつけて。歩きスマホはやめよう。</span></div>`;
}

function openSpot(id, keepView) {
  const s = SPOTS.find(x => x.id === id);
  currentSponsor = null;
  if (mission && mission.id !== id) endMission();
  current = id; refresh(id);
  if (!keepView) map.flyTo([s.lat, s.lng], Math.max(map.getZoom(), 13), { duration: .6 });
  $("panel").innerHTML = `<span class="tag">ポイント ${s.no}・${s.hzName}</span>
    <h2>${s.name}</h2><p class="place">${s.place}</p>
    <div id="cibox">${checkinBox(s)}</div>
    <div class="learn">${s.pose ? `<img class="learnpose" src="${POSE(s.pose)}" alt="">` : ""}${s.learn.map(t => `<p>${t}</p>`).join("")}</div>
    ${guide("question", `Q. ${s.q}`, "q")}
    <div class="choices">${s.c.map((c, i) => `<button data-i="${i}">${c}</button>`).join("")}</div>
    <div id="res"></div><div id="mis"></div>
    <div class="btnrow"><button class="btn ghost" id="back">スタンプ帳へ</button></div>`;
  $("back").onclick = () => { endMission(); home(); };
  const g = $("gpson"); if (g) g.onclick = () => $("gpsbtn").click();
  const ci = $("doci"); if (ci) ci.onclick = () => { state.here[s.id] = Date.now(); save(); openSpot(s.id, true); };
  const btns = [...$("panel").querySelectorAll(".choices button")];
  if (state.done[id]) { showAnswer(s, btns, true); return; }
  btns.forEach(b => b.onclick = () => {
    const i = +b.dataset.i;
    if (i === s.a) {
      const gain = (state.tries[id] || 0) === 0 ? 100 : 50;
      state.done[id] = gain; save(); refresh(id);
      showAnswer(s, btns, false, gain);
    } else {
      state.tries[id] = (state.tries[id] || 0) + 1; save();
      b.classList.add("wrong"); b.disabled = true;
      $("res").innerHTML = guide("sad", "ざんねん…。もう一度考えてみよう。（次に正解すると50pt）", "ng");
    }
  });
}
function showAnswer(s, btns, already, gain) {
  btns.forEach((b, i) => { b.disabled = true; if (i === s.a) b.classList.add("right"); });
  $("res").innerHTML = guide(already ? "stand" : "banzai",
    `<b>${already ? `スタンプ獲得ずみ（${state.done[s.id]}pt）` : `正解！ +${gain}pt スタンプをゲット！`}</b><br>${s.why}`, "ok");
  if (s.mission) {
    const label = LABEL[s.mission];
    if (state.mission[s.id]) {
      $("mis").innerHTML = `<div class="box mission clear"><b class="t">ミッション達成ずみ +50pt</b><span>「${label}」のときに使える避難場所を見つけました。避難場所は災害の種類ごとに違うので、家の近くでも確かめておこう。</span></div>`;
    } else {
      $("mis").innerHTML = `<div class="box mission"><b class="t">ボーナスミッション +50pt</b><span>「${label}」のときに使える、${s.name}の近くの避難場所を地図でさがそう。</span><div><button class="btn green" id="go">ミッションに挑戦</button></div></div>`;
      $("go").onclick = () => startMission(s);
    }
  }
  const nextSpot = SPOTS.find(x => !state.done[x.id]);
  if (nextSpot) { const b = document.createElement("button"); b.className = "btn"; b.textContent = `次のポイント：${nextSpot.title}`; b.onclick = () => openSpot(nextSpot.id); $("panel").querySelector(".btnrow").prepend(b); }
}

// CSVに入力ミスがあったときのお知らせ
function csvWarning() {
  const box = (file, errs) => errs.length ? `<div class="result ng" style="font-weight:500"><b>${file} に読み込めない行がありました</b><br>${errs.map(esc).join("<br>")}<br>この行は地図に表示していません。CSVを直して、もう一度アップロードしてください。</div>` : "";
  return box("spots.csv", CSV_ERRORS) + box("sponsors.csv", SPONSOR_ERRORS);
}

// ---------- 起動 ----------
const loadCsv = file => fetch(file, { cache: "no-cache" })
  .then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
  .then(buf => parseCsv(decodeCsv(buf)));
// すべてのファイル（sponsors.js・homecheck.js）を読み終えてから始める
const ready = document.readyState === "loading" ? new Promise(r => document.addEventListener("DOMContentLoaded", r)) : Promise.resolve();
Promise.all([
  ready,
  loadCsv("spots.csv").then(rows => { SPOTS = buildSpots(rows); })
    .catch(() => { CSV_ERRORS.push("spots.csv が読み込めませんでした。ファイル名が spots.csv になっているか確認してください。"); }),
  loadCsv("sponsors.csv").then(rows => { SPONSORS = buildSponsors(rows); })
    .catch(() => { /* sponsors.csv が無いときは協賛スポットなしで動かす */ })
]).then(() => { createPins(); drawHome(); home(); track("open", 0); });

// ---------- オフラインでも開けるようにする ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

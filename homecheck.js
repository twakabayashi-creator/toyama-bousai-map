// =============================================================
//  わが家（自宅の登録と、わが家のハザードチェック）
//  自宅の場所はこの端末の中（ローカルストレージ）にだけ保存し、送信しません。
//  住所で探すときだけ、入力した住所を国土地理院の住所検索に送ります。
// =============================================================

// ---------- ハザードマップの色 → 意味（国土地理院 ハザードマップポータルの凡例） ----------
const FLOOD_LEGEND = [
  ["#F7F5A9", "0.5m未満", 1], ["#FFD8C0", "0.5〜3m", 2], ["#FFB7B7", "3〜5m", 3],
  ["#FF9191", "5〜10m", 4], ["#F285C9", "10〜20m", 5], ["#DC7ADC", "20m以上", 6]
];
const TSUNAMI_LEGEND = [
  ["#FFFFB3", "0.3m未満", 1], ["#F7F5A9", "0.3〜0.5m", 2], ["#F8E1A6", "0.5〜1m", 3], ["#FFD8C0", "1〜3m", 4],
  ["#FFB7B7", "3〜5m", 5], ["#FF9191", "5〜10m", 6], ["#F285C9", "10〜20m", 7], ["#DC7ADC", "20m以上", 8]
];
const DOSHA_LAYERS = [
  ["05_dosekiryukeikaikuiki_data/16", "土石流"],
  ["05_kyukeishakeikaikuiki_data/16", "急傾斜地の崩壊（がけ崩れ）"],
  ["05_jisuberikeikaikuiki_data/16", "地すべり"]
];
const HEX = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// 地図画像（タイル）の、その地点の1ピクセルの色を読む
function samplePixel(path, lat, lng, z = 16) {
  const n = 2 ** z, x = (lng + 180) / 360 * n;
  const r = lat * Math.PI / 180, y = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
  const tx = Math.floor(x), ty = Math.floor(y), px = Math.floor((x - tx) * 256), py = Math.floor((y - ty) * 256);
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas"); c.width = c.height = 256;
        const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
        resolve(Array.from(ctx.getImageData(px, py, 1, 1).data));
      } catch (e) { resolve(null); }
    };
    img.onerror = () => resolve([0, 0, 0, 0]); // 画像がない＝その範囲に想定なし
    img.src = `https://disaportaldata.gsi.go.jp/raster/${path}/${z}/${tx}/${ty}.png`;
  });
}
// 色をいちばん近い凡例に当てはめる
function matchLegend(px, legend) {
  if (!px || px[3] < 128) return null;
  let best = null, bd = Infinity;
  legend.forEach(l => { const c = HEX(l[0]); const d = (c[0] - px[0]) ** 2 + (c[1] - px[1]) ** 2 + (c[2] - px[2]) ** 2; if (d < bd) { bd = d; best = l; } });
  return bd < 900 ? best : null;
}
async function checkHazards(lat, lng) {
  const [fk, fp, ts, ...ds] = await Promise.all([
    samplePixel("01_flood_l2_shinsuishin_kuni_data", lat, lng),
    samplePixel("01_flood_l2_shinsuishin_pref_data/16", lat, lng),
    samplePixel("04_tsunami_newlegend_pref_data/16", lat, lng),
    ...DOSHA_LAYERS.map(([p]) => samplePixel(p, lat, lng))
  ]);
  if ([fk, fp, ts, ...ds].some(v => v === null)) return null; // 読み取りに失敗
  const f1 = matchLegend(fk, FLOOD_LEGEND), f2 = matchLegend(fp, FLOOD_LEGEND);
  const flood = !f1 ? f2 : !f2 ? f1 : (f1[2] >= f2[2] ? f1 : f2);
  const tsunami = matchLegend(ts, TSUNAMI_LEGEND);
  // 土砂災害：赤っぽい＝特別警戒区域、黄色〜オレンジ＝警戒区域
  const dosha = ds.map((px, i) => {
    if (!px || px[3] < 128) return null;
    const special = px[1] < 90 && px[0] > 140;
    return { kind: DOSHA_LAYERS[i][1], level: special ? "土砂災害特別警戒区域（レッドゾーン）" : "土砂災害警戒区域（イエローゾーン）", special };
  }).filter(Boolean);
  return { flood, tsunami, dosha };
}

// ---------- 自宅のピン ----------
let homeMarker = null, pickingHome = false;
function drawHome() {
  if (homeMarker) { map.removeLayer(homeMarker); homeMarker = null; }
  if (!state.home) return;
  homeMarker = L.marker([state.home.lat, state.home.lng], {
    icon: L.divIcon({ className: "", iconSize: [36, 36], iconAnchor: [18, 34], html: '<div class="homepin"><span>家</span></div>' }),
    title: "わが家", zIndexOffset: 1500
  }).addTo(map);
  homeMarker.on("click", () => openHome());
}

// ---------- 自宅の登録 ----------
function setHome(lat, lng, label) {
  state.home = { lat: +lat.toFixed(6), lng: +lng.toFixed(6), label: label || "" };
  save(); drawHome(); stopPicking();
  map.flyTo([lat, lng], 16, { duration: .6 });
  openHome();
}
function stopPicking() {
  pickingHome = false; $("map").classList.remove("picking");
  if (!mission) $("banner").hidden = true;
}
map.on("click", e => {
  if (!pickingHome) return;
  const { lat, lng } = e.latlng;
  setHome(lat, lng, "地図で選んだ場所");
});

function openHomeRegister() {
  current = null; currentSponsor = null; if (mission) endMission(); refresh(0);
  $("panel").innerHTML = `<span class="tag">わが家</span><h2>自宅を登録する</h2>
    ${guide("sit", "自宅を登録すると、わが家の危険と、近くの避難場所がわかるよ。")}
    <div class="box">
      <b class="t">① 住所で探す</b>
      <form id="addrform" class="addrrow"><input id="addr" type="text" placeholder="例：富山市新桜町7-38" autocomplete="street-address"><button class="btn">探す</button></form>
      <div id="addrres"></div>
      <span class="note">住所を探すときだけ、入力した住所を国土地理院の住所検索に送ります。</span>
    </div>
    <div class="box"><b class="t">② 地図をタップして決める</b><div><button class="btn ghost" id="pickmap">地図で選ぶ</button></div></div>
    <div class="box"><b class="t">③ 今いる場所を自宅にする</b><div><button class="btn ghost" id="usehere">${me ? "今いる場所を自宅にする" : "📍 現在地をオンにする"}</button></div></div>
    <p class="note">自宅の場所はこのスマホの中だけに保存し、どこにも送信しません。</p>
    <div class="btnrow">${state.home ? '<button class="btn ghost" id="tohome">わが家にもどる</button>' : ""}<button class="btn ghost" id="back">スタンプ帳へ</button></div>`;
  $("back").onclick = () => { stopPicking(); home(); };
  if ($("tohome")) $("tohome").onclick = () => { stopPicking(); openHome(); };
  $("addrform").onsubmit = e => { e.preventDefault(); searchAddress($("addr").value.trim()); };
  $("pickmap").onclick = () => {
    pickingHome = true; $("map").classList.add("picking");
    $("bannertext").textContent = "地図をタップして、自宅の場所を決めてね（拡大すると正確に選べます）";
    $("banner").hidden = false; $("bannerclose").onclick = () => { stopPicking(); endMission(); };
    $("map").scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  $("usehere").onclick = () => { if (me) setHome(me.lat, me.lng, "現在地で登録した場所"); else $("gpsbtn").click(); };
}

async function searchAddress(q) {
  const box = $("addrres");
  if (!q) { box.innerHTML = '<p class="note">住所を入力してください。</p>'; return; }
  box.innerHTML = '<p class="note">さがしています…</p>';
  try {
    const query = /富山/.test(q) ? q : "富山県" + q;
    const r = await fetch("https://msearch.gsi.go.jp/address-search/AddressSearch?q=" + encodeURIComponent(query));
    const list = (await r.json()).filter(x => x.geometry && x.geometry.coordinates).slice(0, 6);
    if (!list.length) { box.innerHTML = '<p class="note">見つかりませんでした。市町村名から入れるか、番地を省いてためしてください。</p>'; return; }
    box.innerHTML = `<p class="note">いちばん近いものを選んでください。</p><div class="cands">${list.map((x, i) => `<button class="btn ghost" data-i="${i}">${esc(x.properties.title)}</button>`).join("")}</div>`;
    box.querySelectorAll("[data-i]").forEach(b => b.onclick = () => {
      const x = list[+b.dataset.i], [lng, lat] = x.geometry.coordinates;
      setHome(lat, lng, x.properties.title);
    });
  } catch (e) {
    box.innerHTML = '<p class="note">住所の検索につながりませんでした。電波のよい場所でためすか、「地図をタップして決める」を使ってください。</p>';
  }
}

// 地図の下の「🏠 わが家」ボタン
$("homebtn").onclick = () => { openHome(); $("panel").scrollIntoView({ behavior: "smooth", block: "start" }); };

// ---------- わが家のハザードチェック ----------
async function openHome() {
  if (!state.home) { openHomeRegister(); return; }
  current = null; currentSponsor = null; if (mission) endMission(); refresh(0);
  const h = state.home;
  $("panel").innerHTML = `<span class="tag">わが家</span><h2>わが家のハザードチェック</h2>
    <p class="place">${esc(h.label || "登録した場所")}</p>
    <div id="hzres">${guide("question", "わが家の場所を調べているよ…")}</div>
    <div id="hshel"></div>
    <div class="btnrow"><button class="btn ghost" id="hmap">地図でわが家を見る</button><button class="btn ghost" id="hedit">自宅を登録しなおす</button><button class="btn ghost" id="hdel">登録を消す</button></div>
    <div class="btnrow"><button class="btn ghost" id="back">スタンプ帳へ</button></div>`;
  $("back").onclick = home;
  $("hmap").onclick = () => { map.flyTo([h.lat, h.lng], 16); $("map").scrollIntoView({ behavior: "smooth", block: "nearest" }); };
  $("hedit").onclick = openHomeRegister;
  $("hdel").onclick = () => {
    $("hdel").outerHTML = `<span class="note">自宅の登録を消します。</span><button class="btn" id="hdel2">消す</button>`;
    $("hdel2").onclick = () => { delete state.home; save(); drawHome(); home(); };
  };
  // 近くの避難場所（災害の種類ごとに、いちばん近いところ）
  const kinds = [[1, "洪水"], [16, "津波"], [8, "地震"], [2, "崖崩れ"]];
  const near = kinds.map(([bit, name]) => {
    const o = SHELTERS.filter(s => s.m & bit).map(s => ({ s, d: km(h.lat, h.lng, s.lat, s.lng) })).sort((a, b) => a.d - b.d)[0];
    return o && o.d <= 10 ? { name, ...o } : null; // 10km以上離れていれば出さない（山の中の津波など）
  }).filter(Boolean);
  $("hshel").innerHTML = near.length ? `<div class="box"><b class="t">わが家からいちばん近い避難場所</b>
    ${near.map((o, i) => `<div class="hrow"><span class="hk">${o.name}のとき</span><span><b>${o.s.name}</b>（約${fmt(o.d)}）</span><button class="btn ghost mini" data-n="${i}">地図で見る</button></div>`).join("")}
    <span class="note">距離はまっすぐ測った距離です。実際の道のりは長くなります。家族で、どこへ逃げるか話し合っておこう。</span></div>` : "";
  $("hshel").querySelectorAll("[data-n]").forEach(b => b.onclick = () => { const s = near[+b.dataset.n].s; map.flyTo([s.lat, s.lng], 16); shelterClick(s); $("map").scrollIntoView({ behavior: "smooth", block: "nearest" }); });

  const r = await checkHazards(h.lat, h.lng);
  if (!$("hzres")) return; // 別の画面に移った
  if (!r) { $("hzres").innerHTML = guide("sad", "ハザードマップを読み込めなかったよ。電波のよい場所で、もう一度開いてみてね。"); return; }
  const rows = [
    ["洪水（川があふれたとき）", r.flood ? `浸水 <b>${r.flood[1]}</b>` : "想定なし", r.flood ? r.flood[2] : 0],
    ["津波", r.tsunami ? `浸水 <b>${r.tsunami[1]}</b>` : "想定なし", r.tsunami ? r.tsunami[2] : 0],
    ["土砂災害", r.dosha.length ? r.dosha.map(d => `<b>${d.level}</b>（${d.kind}）`).join("<br>") : "区域外", r.dosha.length ? (r.dosha.some(d => d.special) ? 9 : 5) : 0]
  ];
  const risky = rows.some(x => x[2] > 0);
  const deep = (r.flood && r.flood[2] >= 2) || (r.tsunami && r.tsunami[2] >= 4) || r.dosha.some(d => d.special);
  const say = !risky ? "このハザードマップでは、大きな危険は想定されていないよ。でも「想定なし」は「安全」という意味じゃないよ！"
    : deep ? "わが家は危険な場所にあるかもしれないよ！早めの避難を家族で決めておこう。"
    : "わが家にも危険が想定されているよ。いざというときの動き方を確かめておこう。";
  $("hzres").innerHTML = `${guide(!risky ? "stand" : "surprise", say)}
    <div class="hztable">${rows.map(([k, v, lv]) => `<div class="hrow ${lv ? "warn" : ""}"><span class="hk">${k}</span><span>${v}</span></div>`).join("")}</div>
    <div class="nosafe"><b>「想定なし」「区域外」は、安全という意味ではありません。</b>用水路や下水があふれる浸水（内水氾濫）や、想定をこえる大雨・地震は、ここに出ていなくても起こります。市町村から避難の情報が出たら、それに従ってください。</div>
    ${r.flood && r.flood[2] >= 2 ? '<p class="note">浸水0.5mは大人のひざ、3mは2階の床くらいの深さです。家の2階以上に逃げても助からない深さのときは、早めに避難場所へ。</p>' : ""}
    <p class="note">国土地理院ハザードマップポータルの「想定最大規模」の想定を、登録した地点で読み取った結果です。家屋が流される区域などは含みません。くわしくは市町村のハザードマップで確かめてください。</p>`;
  if (!state.homeCheck) { state.homeCheck = true; save(); refresh(0); toast("banzai", "わが家チェック達成！ +50pt"); }
}

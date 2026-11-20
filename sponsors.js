// =============================================================
//  協賛スポット（PR）
//  内容は sponsors.csv（Excelで編集できます）にあります。
// =============================================================

let SPONSORS = [], SPONSOR_ERRORS = [], currentSponsor = null;

// ---------- 効果測定（回数だけを送る。個人や位置情報は送らない） ----------
// t: open=アプリを開いた / view=協賛スポットを見た / checkin=来店チェックイン
//    coupon=クーポン使用 / link=ウェブサイトを開いた
function track(t, sponsorId) {
  if (!ANALYTICS_ENDPOINT) return;
  const today = new Date().toISOString().slice(0, 10);
  // 「見た」「開いた」は、同じ端末では1日1回だけ数える
  if (t === "view" || t === "open") {
    const key = `${t}:${sponsorId}`;
    if (state.seen[key] === today) return;
    state.seen[key] = today; save();
  }
  const body = JSON.stringify({ t, s: sponsorId });
  try {
    if (navigator.sendBeacon) navigator.sendBeacon(ANALYTICS_ENDPOINT, new Blob([body], { type: "text/plain" }));
    else fetch(ANALYTICS_ENDPOINT, { method: "POST", body, keepalive: true, headers: { "content-type": "text/plain" } }).catch(() => {});
  } catch (e) {}
}

// ---------- sponsors.csv を読む ----------
function parseDate(s) {
  const m = String(s || "").trim().match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
function buildSponsors(rows) {
  const head = (rows.shift() || []).map(h => h.trim());
  const col = n => head.indexOf(n);
  const missing = ["店舗名", "緯度", "経度"].filter(n => col(n) < 0);
  if (missing.length) { SPONSOR_ERRORS.push(`1行目（見出し）に「${missing.join("」「")}」の列が見つかりません。`); return []; }
  const get = (r, n) => col(n) < 0 ? "" : (r[col(n)] || "").trim();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const out = [], used = new Set();
  rows.forEach((r, i) => {
    const line = i + 2;
    if (r.every(c => !c.trim())) return;
    const name = get(r, "店舗名"), lat = parseFloat(get(r, "緯度")), lng = parseFloat(get(r, "経度"));
    const errs = [];
    if (!name) errs.push("店舗名が空です");
    if (lat > 122 && lat < 154 && lng > 20 && lng < 46) errs.push("緯度と経度が逆になっています（緯度は36.○○、経度は137.○○）");
    else {
      if (!(lat > 20 && lat < 46)) errs.push("緯度が正しくありません（例：36.70）");
      if (!(lng > 122 && lng < 154)) errs.push("経度が正しくありません（例：137.21）");
    }
    const from = get(r, "掲載開始日"), to = get(r, "掲載終了日");
    const fromD = parseDate(from), toD = parseDate(to);
    if (from && !fromD) errs.push("掲載開始日の書き方が正しくありません（例：2026/12/1）");
    if (to && !toD) errs.push("掲載終了日の書き方が正しくありません（例：2027/3/31）");
    let id = parseInt(get(r, "番号"), 10);
    if (!(id > 0)) errs.push("番号が空です（効果測定に使うので、1, 2, 3… の数字を入れてください）");
    else if (used.has(id)) errs.push(`番号 ${id} がほかの行と重なっています`);
    if (errs.length) { SPONSOR_ERRORS.push(`${line}行目（${name || "店舗名なし"}）：${errs.join("、")}`); return; }
    used.add(id);
    // 掲載期間の外なら表示しない（エラーではない）
    if (fromD && today < fromD) return;
    if (toD && today > toD) return;
    const url = get(r, "ウェブサイト"), img = get(r, "画像");
    out.push({
      id, title: name, name: esc(name), company: esc(get(r, "企業名")), lat, lng,
      text: esc(get(r, "紹介文")), img: /^(https?:\/\/|[\w\-./]+$)/.test(img) ? img : "",
      url: /^https?:\/\//.test(url) ? url : "",
      address: esc(get(r, "住所")), tel: esc(get(r, "電話")), hours: esc(get(r, "営業時間")),
      coupon: esc(get(r, "クーポン内容")), terms: esc(get(r, "クーポン条件"))
    });
  });
  return out;
}

// ---------- 地図のピン ----------
const sponsorLayer = L.layerGroup().addTo(map);
$("ly-sponsor").addEventListener("change", e => { e.target.checked ? sponsorLayer.addTo(map) : map.removeLayer(sponsorLayer); });
const sponsorIcon = (p, sel) => L.divIcon({ className: "", iconSize: [34, 34], iconAnchor: [17, 17],
  html: `<div class="sppin ${state.sp[p.id] ? "done" : ""} ${sel ? "sel" : ""}"><span>PR</span></div>` });
function createSponsorPins() {
  $("sponsorlist").hidden = !SPONSORS.length;
  $("ly-sponsor-label").hidden = !SPONSORS.length;
  SPONSORS.forEach(p => {
    p.marker = L.marker([p.lat, p.lng], { icon: sponsorIcon(p, false), title: "PR：" + p.title, zIndexOffset: 500 }).addTo(sponsorLayer);
    p.marker.on("click", () => openSponsor(p.id));
  });
}
// 「（サンプル）」で始まる名前は、そこで改行して表示する
const sampleBreak = t => t.replace(/^([（(]サンプル[）)])\s*/, '<span class="sample">$1</span>');
function renderSponsorList(sel) {
  if (!SPONSORS.length) return;
  SPONSORS.forEach(p => p.marker.setIcon(sponsorIcon(p, currentSponsor === p.id)));
  $("splist").innerHTML = SPONSORS.map(p => {
    const dist = me ? fmt(km(me.lat, me.lng, p.lat, p.lng)) : "";
    const st = state.coupon[p.id] ? "クーポン使用済み" : state.sp[p.id] ? "来店済み" : p.coupon ? "クーポンあり" : "";
    return `<li><button data-sp="${p.id}"><span class="spn">PR</span><span class="spname">${sampleBreak(p.name)}${p.company ? `<small>${sampleBreak(p.company)}</small>` : ""}${st || dist ? `<small class="spst">${[st, dist].filter(Boolean).join("・")}</small>` : ""}</span></button></li>`;
  }).join("");
  $("splist").querySelectorAll("button").forEach(b => b.onclick = () => { openSponsor(+b.dataset.sp); $("map").scrollIntoView({ behavior: "smooth", block: "start" }); });
}

// ---------- 協賛スポットの画面 ----------
function canCheckInSponsor(p) {
  if (!me) return false;
  const d = km(me.lat, me.lng, p.lat, p.lng) * 1000;
  return d <= SPONSOR_RADIUS_M + Math.min(me.acc, 100) && me.acc <= 200 && !moving();
}
const fmtTime = ts => { const d = new Date(ts); return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`; };

// クーポンの残り時間（ミリ秒）。チェックインした時刻から COUPON_VALID_MIN 分
function couponLeft(p) {
  const t = (state.cpt && state.cpt[p.id]) || 0;
  return t + COUPON_VALID_MIN * 60000 - Date.now();
}
// クーポンの時計を1秒ごとに動かす。有効時間が過ぎたら画面を切りかえる
let couponTimer = null;
function startCouponClock(p) {
  clearInterval(couponTimer);
  const tick = () => {
    const clock = $("cpclock");
    if (!clock || currentSponsor !== p.id) { clearInterval(couponTimer); return; }
    const now = new Date(), left = couponLeft(p);
    if (left <= 0) { clearInterval(couponTimer); openSponsor(p.id, true); return; }
    const z = n => String(n).padStart(2, "0");
    $("cpdate").textContent = `${now.getMonth() + 1}月${now.getDate()}日`;
    clock.textContent = `${z(now.getHours())}:${z(now.getMinutes())}:${z(now.getSeconds())}`;
    $("cpleft").textContent = `${Math.floor(left / 60000)}分${z(Math.floor(left / 1000) % 60)}秒`;
  };
  if ($("cpclock")) { tick(); couponTimer = setInterval(tick, 1000); }
}

function couponBox(p) {
  if (!p.coupon) {
    if (state.sp[p.id]) return `<div class="box checkin clear"><b class="t">来店チェックイン済み +50pt</b></div>`;
    if (canCheckInSponsor(p)) return `<div class="box checkin"><b class="t">お店に着きました！</b><div><button class="btn gold" id="spci">来店チェックインする（+50pt）</button></div></div>`;
    return "";
  }
  if (state.coupon[p.id]) return `<div class="coupon used"><b>クーポン使用済み</b><span>${p.coupon}</span><span class="note">${fmtTime(state.coupon[p.id])} に使用しました</span></div>`;
  if (state.sp[p.id] && couponLeft(p) > 0) return `<div class="coupon live">
      <span class="ctag">クーポン</span>
      <b class="cbig">${p.coupon}</b>
      <span class="note">${esc(COUPON_RULE)}${p.terms ? `<br>${p.terms}` : ""}</span>
      <div class="cclock"><span id="cpdate"></span><b id="cpclock"></b></div>
      <div class="cstripe" aria-hidden="true"></div>
      <span>この画面をお店の人に見せてください。<br><small>時計が動いていない画面（スクリーンショット）は使えません。</small></span>
      <span class="cleft">有効時間 のこり <b id="cpleft"></b></span>
      <div id="usebox"><button class="btn ghost" id="use1">【お店の人が押す】使用済みにする</button></div>
    </div>`;
  if (state.sp[p.id]) {
    // 有効時間が過ぎた：お店の近くにいれば、もう一度チェックインして表示できる
    if (canCheckInSponsor(p)) return `<div class="box checkin"><b class="t">クーポンの有効時間（${COUPON_VALID_MIN}分）が過ぎました</b><span>お店にいるときは、もう一度チェックインするとクーポンを表示できます。</span><div><button class="btn gold" id="spci">もう一度チェックインしてクーポンを表示</button></div></div>`;
    return `<div class="box checkin"><b class="t">クーポン：${p.coupon}</b><span>クーポンの有効時間（${COUPON_VALID_MIN}分）が過ぎました。お店で、もう一度来店チェックインすると表示できます。</span>${me ? "" : '<div><button class="btn gold" id="gpson2">📍 現在地をオンにする</button></div>'}</div>`;
  }
  if (!me) return `<div class="box checkin"><b class="t">クーポン：${p.coupon}</b><span>お店から${SPONSOR_RADIUS_M}m以内で「来店チェックイン」すると、クーポンが使えます（+50pt）。</span><div><button class="btn gold" id="gpson2">📍 現在地をオンにする</button></div></div>`;
  if (canCheckInSponsor(p)) return `<div class="box checkin"><b class="t">お店に着きました！</b><span>チェックインすると、クーポン「${p.coupon}」が表示されます。</span><div><button class="btn gold" id="spci">来店チェックインしてクーポンを表示（+50pt）</button></div></div>`;
  return `<div class="box checkin"><b class="t">クーポン：${p.coupon}</b><span>ここから約${fmt(km(me.lat, me.lng, p.lat, p.lng))}。お店から${SPONSOR_RADIUS_M}m以内に近づくと、来店チェックインできます。</span></div>`;
}

function openSponsor(id, keepView) {
  const p = SPONSORS.find(x => x.id === id);
  if (!p) return;
  if (typeof mission !== "undefined" && mission) endMission();
  current = null; currentSponsor = id; refresh(0);
  if (!keepView) { map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 15), { duration: .6 }); track("view", id); }
  const info = [p.address && `住所：${p.address}`, p.hours && `営業時間：${p.hours}`, p.tel && `電話：${p.tel}`].filter(Boolean);
  $("panel").innerHTML = `<span class="prtag">PR・協賛スポット</span>
    <h2>${sampleBreak(p.name)}</h2>${p.company ? `<p class="place">${sampleBreak(p.company)}</p>` : ""}
    ${p.img ? `<img class="spimg" src="${esc(p.img)}" alt="${p.name}">` : ""}
    ${p.text ? `<div class="learn"><p>${p.text}</p></div>` : ""}
    <div id="cpbox">${me && !state.coupon[p.id] ? movingNote(p.lat, p.lng, SPONSOR_RADIUS_M) : ""}${couponBox(p)}</div>
    ${info.length ? `<div class="spinfo">${info.map(t => `<span>${t}</span>`).join("")}</div>` : ""}
    ${p.url ? `<div><a class="btn ghost" id="splink" href="${esc(p.url)}" target="_blank" rel="noopener sponsored">ウェブサイトを見る</a></div>` : ""}
    <p class="note">このスポットは、アプリを応援してくれている協賛企業の紹介（広告）です。避難場所ではありません。</p>
    <div class="btnrow"><button class="btn ghost" id="back">スタンプ帳へ</button></div>`;
  $("back").onclick = home;
  const g = $("gpson2"); if (g) g.onclick = () => $("gpsbtn").click();
  const l = $("splink"); if (l) l.onclick = () => track("link", id);
  const ci = $("spci"); if (ci) ci.onclick = () => {
    state.cpt = state.cpt || {};
    if (!state.sp[id]) { state.sp[id] = Date.now(); track("checkin", id); }
    state.cpt[id] = Date.now(); save(); openSponsor(id, true);
  };
  startCouponClock(p);
  const u = $("use1"); if (u) u.onclick = () => {
    $("usebox").innerHTML = `<span class="note">一度使用済みにすると、元に戻せません。</span><div class="btnrow"><button class="btn" id="use2">使用済みにする</button><button class="btn ghost" id="use0">やめる</button></div>`;
    $("use2").onclick = () => { state.coupon[id] = Date.now(); save(); track("coupon", id); openSponsor(id, true); };
    $("use0").onclick = () => openSponsor(id, true);
  };
}

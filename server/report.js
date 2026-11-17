// 協賛レポート画面の動き（report.html から読み込みます）
const $ = id => document.getElementById(id);
const now = new Date(Date.now() + 9 * 3600e3);
$("from").value = now.toISOString().slice(0, 8) + "01";
$("to").value = now.toISOString().slice(0, 10);
try { $("pw").value = sessionStorage.getItem("pw") || ""; } catch (e) {}
try { $("issuer").value = localStorage.getItem("report-issuer") || ""; } catch (e) {}
$("issuer").addEventListener("input", () => { try { localStorage.setItem("report-issuer", $("issuer").value); } catch (e) {} });

// ---------- sponsors.csv から店舗名・企業名を読む ----------
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
async function sponsorInfo() {
  try {
    const buf = await (await fetch("/sponsors.csv", { cache: "no-cache" })).arrayBuffer();
    let text; try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, ""); } catch (e) { text = new TextDecoder("shift_jis").decode(buf); }
    const rows = parseCsv(text), h = rows.shift().map(x => x.trim());
    const info = {};
    rows.forEach(r => {
      const id = parseInt(r[h.indexOf("番号")], 10);
      if (id > 0) info[id] = { shop: (r[h.indexOf("店舗名")] || "").trim(), company: (r[h.indexOf("企業名")] || "").trim() };
    });
    return info;
  } catch (e) { return {}; }
}

const COLS = [["view", "見た"], ["checkin", "来店チェックイン"], ["coupon", "クーポン使用"], ["link", "サイトを開いた"]];
const escH = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const csvCell = v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v;
const label = (info, id) => info[id] ? [info[id].shop, info[id].company].filter(Boolean).join("／") : "（sponsors.csv にない番号）";
function download(text, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv" }));
  a.download = name; a.click();
}

let last = null; // { rows, info, from, to }

// ---------- 一覧 ----------
$("f").onsubmit = async e => {
  e.preventDefault();
  const pw = $("pw").value;
  try { sessionStorage.setItem("pw", pw); } catch (e) {}
  $("msg").textContent = "読み込み中…";
  const from = $("from").value, to = $("to").value;
  const r = await fetch(`/api/report?from=${from}&to=${to}`, { headers: { authorization: "Bearer " + pw } });
  if (r.status === 401) { $("msg").textContent = "パスワードが違います。"; return; }
  if (r.status === 429) { $("msg").textContent = "パスワードを続けてまちがえたため、15分ほど受け付けません。"; return; }
  if (!r.ok) { $("msg").textContent = "読み込めませんでした。サーバーが動いているか確認してください。"; return; }
  const { rows } = await r.json();
  const info = await sponsorInfo();
  last = { rows, info, from, to };
  const by = {};
  let opens = 0;
  rows.forEach(x => { if (x.sponsor === 0) { opens += x.open || 0; return; } const o = by[x.sponsor] ??= {}; COLS.forEach(([k]) => o[k] = (o[k] || 0) + (x[k] || 0)); });
  const ids = Object.keys(by).map(Number).sort((a, b) => a - b);
  const sum = k => ids.reduce((a, id) => a + (by[id][k] || 0), 0);
  $("kpi").innerHTML = `<div class="chip"><span>アプリを開いた</span><b>${opens}</b></div>` + COLS.map(([k, t]) => `<div class="chip"><span>${t}（合計）</span><b>${sum(k)}</b></div>`).join("");
  $("t").innerHTML = `<thead><tr><th>協賛スポット</th>${COLS.map(([, t]) => `<th>${t}</th>`).join("")}</tr></thead>
    <tbody>${ids.map(id => `<tr><td>${id}. ${escH(label(info, id))}</td>${COLS.map(([k]) => `<td>${by[id][k] || 0}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="5">この期間のデータはありません。</td></tr>`}</tbody>
    ${ids.length ? `<tfoot><tr><td>合計</td>${COLS.map(([k]) => `<td>${sum(k)}</td>`).join("")}</tr></tfoot>` : ""}`;
  $("msg").textContent = `${from} 〜 ${to} の集計です。`;
  $("dl").hidden = false;

  // 企業ごと（企業名が空なら店舗名）にまとめる
  const comps = {};
  ids.forEach(id => {
    const name = (info[id] && (info[id].company || info[id].shop)) || `番号${id}`;
    (comps[name] ??= new Set()).add(id);
  });
  const names = Object.keys(comps);
  $("compsec").hidden = !names.length;
  $("complist").innerHTML = names.map((n, i) => `<li><span><b>${escH(n)}</b>（${comps[n].size}店舗）</span><button class="btn ghost" data-c="${i}">報告書を作る</button></li>`).join("");
  $("complist").querySelectorAll("[data-c]").forEach(b => b.onclick = () => { const n = names[+b.dataset.c]; showReport(n, [...comps[n]]); });
};
$("dl").onclick = () => {
  if (!last) return;
  const { rows, info, from, to } = last;
  download([["日付", "番号", "協賛スポット", ...COLS.map(c => c[1])].join(",")]
    .concat(rows.filter(x => x.sponsor !== 0).map(x => [x.date, x.sponsor, csvCell(label(info, x.sponsor)), ...COLS.map(([k]) => x[k] || 0)].join(","))).join("\r\n"),
    `協賛レポート_${from}_${to}.csv`);
};

// ---------- 企業ごとの報告書 ----------
const pct = (a, b) => b ? `${(a / b * 100).toFixed(1)}%` : "—";
const jpDate = s => { const [y, m, d] = s.split("-").map(Number); return `${y}年${m}月${d}日`; };
function dayList(from, to) {
  const out = [], d = new Date(from + "T00:00:00Z"), end = new Date(to + "T00:00:00Z");
  for (let i = 0; d <= end && i < 400; i++) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}
// 日ごとの「見た」と「来店チェックイン」の棒グラフ（SVG）
function dailyChart(days, daily) {
  const W = 760, H = 230, L = 40, R = 10, T = 12, B = 34, pw = W - L - R, ph = H - T - B;
  const max = Math.max(1, ...days.map(d => (daily[d] || {}).view || 0), ...days.map(d => (daily[d] || {}).checkin || 0));
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000, 2000, 5000].find(s => max / s <= 5) || 10000;
  const top = Math.ceil(max / step) * step;
  const y = v => T + ph - v / top * ph;
  const gw = pw / days.length, bw = Math.max(1, Math.min(14, gw * 0.38));
  const every = Math.ceil(days.length / 10);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="日ごとの見た回数と来店チェックイン数">`;
  for (let v = 0; v <= top; v += step) s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#e3e9eb"/><text x="${L - 6}" y="${y(v) + 4}" font-size="11" text-anchor="end" fill="#5b7179">${v}</text>`;
  days.forEach((d, i) => {
    const c = daily[d] || {}, x = L + gw * i + gw / 2;
    s += `<rect x="${x - bw - 1}" y="${y(c.view || 0)}" width="${bw}" height="${T + ph - y(c.view || 0)}" fill="#9fb0e8"><title>${d} 見た ${c.view || 0}</title></rect>`;
    s += `<rect x="${x + 1}" y="${y(c.checkin || 0)}" width="${bw}" height="${T + ph - y(c.checkin || 0)}" fill="#2b3a8f"><title>${d} 来店 ${c.checkin || 0}</title></rect>`;
    if (i % every === 0) { const [, m, dd] = d.split("-").map(Number); s += `<text x="${x}" y="${H - 12}" font-size="11" text-anchor="middle" fill="#5b7179">${m}/${dd}</text>`; }
  });
  return s + `<line x1="${L}" x2="${W - R}" y1="${T + ph}" y2="${T + ph}" stroke="#9aa9ad"/></svg>`;
}

let repCsv = "", repName = "";
function showReport(company, ids) {
  const { rows, info, from, to } = last;
  const mine = rows.filter(x => ids.includes(x.sponsor));
  const tot = {}, perShop = {}, daily = {};
  mine.forEach(x => {
    COLS.forEach(([k]) => {
      tot[k] = (tot[k] || 0) + (x[k] || 0);
      (perShop[x.sponsor] ??= {})[k] = (perShop[x.sponsor][k] || 0) + (x[k] || 0);
      (daily[x.date] ??= {})[k] = (daily[x.date][k] || 0) + (x[k] || 0);
    });
  });
  const days = dayList(from, to);
  const issuer = $("issuer").value.trim();
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const v = k => tot[k] || 0;
  $("rep").innerHTML = `
    <header class="rhead">
      <div><p class="rtitle">協賛効果レポート</p><h1>${escH(company)} 様</h1></div>
      <div class="rmeta">対象期間：${jpDate(from)} 〜 ${jpDate(to)}（${days.length}日間）<br>発行日：${jpDate(today)}${issuer ? `<br>発行：${escH(issuer)}` : ""}</div>
    </header>
    <p class="lead">防災学習アプリ「とやま防災めぐり」での、貴社協賛スポットの利用状況をご報告します。期間中、<b>${v("view")}回</b>ご覧いただき、<b>${v("checkin")}回</b>の来店チェックインがありました。</p>
    <div class="tiles">${COLS.map(([k, t]) => `<div class="tile"><span>${t}</span><b>${v(k)}</b><small>回</small></div>`).join("")}</div>
    <div class="rates">
      <div class="rate"><span>来店率</span><b>${pct(v("checkin"), v("view"))}</b><small>来店チェックイン ÷ 見た</small></div>
      <div class="rate"><span>クーポン利用率</span><b>${pct(v("coupon"), v("checkin"))}</b><small>クーポン使用 ÷ 来店チェックイン</small></div>
      <div class="rate"><span>サイト訪問率</span><b>${pct(v("link"), v("view"))}</b><small>サイトを開いた ÷ 見た</small></div>
    </div>
    <h2>日ごとの推移</h2>
    <div class="chart">${dailyChart(days, daily)}</div>
    <div class="legend"><span><i style="background:#9fb0e8"></i>見た</span><span><i style="background:#2b3a8f"></i>来店チェックイン</span></div>
    ${ids.length > 1 ? `<h2>店舗ごとの内訳</h2>
    <div class="tbl"><table><thead><tr><th>店舗</th>${COLS.map(([, t]) => `<th>${t}</th>`).join("")}</tr></thead>
    <tbody>${ids.map(id => `<tr><td>${escH((info[id] && info[id].shop) || `番号${id}`)}</td>${COLS.map(([k]) => `<td>${(perShop[id] || {})[k] || 0}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : ""}
    <h2>数え方について</h2>
    <ul class="notes">
      <li>「見た」は、アプリで店舗の紹介画面が開かれた回数です。同じ端末からは1日1回まで数えています。</li>
      <li>「来店チェックイン」は、店舗から300m以内で利用者がチェックインした回数です。</li>
      <li>「クーポン使用」は、店舗のスタッフが「使用済み」にした回数です。</li>
      <li>回数は利用者の端末からの記録をもとにした<b>目安</b>です。個人を特定できる情報は集めていません。</li>
    </ul>
    <footer class="rfoot"><span>とやま防災めぐり 協賛効果レポート</span><span>${escH(company)} 様</span></footer>`;
  repName = company;
  repCsv = [["日付", ...ids.map(id => (info[id] && info[id].shop) || `番号${id}`).flatMap(s => COLS.map(([, t]) => `${s} ${t}`))].map(csvCell).join(",")]
    .concat(days.map(d => [d, ...ids.flatMap(id => { const x = mine.find(r => r.date === d && r.sponsor === id) || {}; return COLS.map(([k]) => x[k] || 0); })].join(","))).join("\r\n");
  $("main").hidden = true; $("repwrap").hidden = false; window.scrollTo(0, 0);
}
$("back").onclick = () => { $("repwrap").hidden = true; $("main").hidden = false; };
$("print").onclick = () => window.print();
$("repcsv").onclick = () => download(repCsv, `協賛効果レポート_${repName}_${last.from}_${last.to}.csv`);

// 協賛レポート画面の動き（report.html から読み込みます）
const $ = id => document.getElementById(id);
const now = new Date(Date.now() + 9 * 3600e3);
$("from").value = now.toISOString().slice(0, 8) + "01";
$("to").value = now.toISOString().slice(0, 10);
try { $("pw").value = sessionStorage.getItem("pw") || ""; } catch (e) {}

// sponsors.csv から店舗名を読む（見出しの「番号」「店舗名」「企業名」を使う）
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
async function sponsorNames() {
  try {
    const buf = await (await fetch("/sponsors.csv", { cache: "no-cache" })).arrayBuffer();
    let text; try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, ""); } catch (e) { text = new TextDecoder("shift_jis").decode(buf); }
    const rows = parseCsv(text), h = rows.shift().map(x => x.trim());
    const names = {};
    rows.forEach(r => { const id = parseInt(r[h.indexOf("番号")], 10); if (id > 0) names[id] = [r[h.indexOf("店舗名")], r[h.indexOf("企業名")]].filter(Boolean).join("／"); });
    return names;
  } catch (e) { return {}; }
}

const COLS = [["view", "見た"], ["checkin", "来店チェックイン"], ["coupon", "クーポン使用"], ["link", "サイトを開いた"]];
let lastCsv = "";
const escH = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

$("f").onsubmit = async e => {
  e.preventDefault();
  const pw = $("pw").value;
  try { sessionStorage.setItem("pw", pw); } catch (e) {}
  $("msg").textContent = "読み込み中…";
  const r = await fetch(`/api/report?from=${$("from").value}&to=${$("to").value}`, { headers: { authorization: "Bearer " + pw } });
  if (r.status === 401) { $("msg").textContent = "パスワードが違います。"; return; }
  if (!r.ok) { $("msg").textContent = "読み込めませんでした。サーバーが動いているか確認してください。"; return; }
  const { rows } = await r.json();
  const names = await sponsorNames();
  const by = {};
  let opens = 0;
  rows.forEach(x => { if (x.sponsor === 0) { opens += x.open || 0; return; } const o = by[x.sponsor] ??= {}; COLS.forEach(([k]) => o[k] = (o[k] || 0) + (x[k] || 0)); });
  const ids = Object.keys(by).map(Number).sort((a, b) => a - b);
  const sum = k => ids.reduce((a, id) => a + (by[id][k] || 0), 0);
  $("kpi").innerHTML = `<div class="chip"><span>アプリを開いた</span><b>${opens}</b></div>` + COLS.map(([k, t]) => `<div class="chip"><span>${t}（合計）</span><b>${sum(k)}</b></div>`).join("");
  $("t").innerHTML = `<thead><tr><th>協賛スポット</th>${COLS.map(([, t]) => `<th>${t}</th>`).join("")}</tr></thead>
    <tbody>${ids.map(id => `<tr><td>${id}. ${escH(names[id] || "（sponsors.csv にない番号）")}</td>${COLS.map(([k]) => `<td>${by[id][k] || 0}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="5">この期間のデータはありません。</td></tr>`}</tbody>
    ${ids.length ? `<tfoot><tr><td>合計</td>${COLS.map(([k]) => `<td>${sum(k)}</td>`).join("")}</tr></tfoot>` : ""}`;
  $("msg").textContent = `${$("from").value} 〜 ${$("to").value} の集計です。`;
  const q = v => /[",\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : v;
  lastCsv = "﻿" + [["日付", "番号", "協賛スポット", ...COLS.map(c => c[1])].join(",")]
    .concat(rows.filter(x => x.sponsor !== 0).map(x => [x.date, x.sponsor, q(names[x.sponsor] || ""), ...COLS.map(([k]) => x[k] || 0)].join(","))).join("\r\n");
  $("dl").hidden = false;
};
$("dl").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lastCsv], { type: "text/csv" }));
  a.download = `協賛レポート_${$("from").value}_${$("to").value}.csv`;
  a.click();
};

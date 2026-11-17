// =============================================================
//  とやま防災めぐり 集計サーバー（サンプル）
//  Node.js 18 以上で動きます。追加のインストールは不要です。
//
//  起動： REPORT_PASSWORD=好きなパスワード node server/server.js
//
//  できること
//   - アプリ本体（このリポジトリのファイル）を公開する
//   - POST /api/event  … アプリから送られる「回数」を受け取って数える
//   - GET  /api/report … 集計結果を返す（パスワードが必要）
//   - GET  /report     … 集計を見る画面
//
//  設定（環境変数）
//   PORT             … 待ち受けるポート（初期値 8080）
//   REPORT_PASSWORD  … レポートを見るためのパスワード（必須。12文字以上を推奨）
//   DATA_FILE        … 集計を保存するファイル（初期値 server/data/counts.json）
//   ALLOWED_ORIGIN   … アプリを別のドメインに置くときの、そのURL（例 https://example.jp）
//   TRUST_PROXY      … Nginx などをこのサーバーの前に置き、そこで送信元を付け直している場合だけ 1
//                      （1 にしないかぎり、送信元の自己申告 X-Forwarded-For は信用しない）
//   HSTS             … HTTPS で公開している場合に 1（ブラウザに「常に HTTPS で開く」よう伝える）
// =============================================================
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = +process.env.PORT || 8080;
const PASSWORD = process.env.REPORT_PASSWORD || "";
const ROOT = path.resolve(__dirname, "..");
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data", "counts.json");
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "";
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const HSTS = process.env.HSTS === "1";
const TYPES = new Set(["open", "view", "checkin", "coupon", "link"]);

if (!PASSWORD) { console.error("REPORT_PASSWORD を設定してください。例：REPORT_PASSWORD=xxxx node server/server.js"); process.exit(1); }
if (PASSWORD.length < 12) console.warn("【注意】REPORT_PASSWORD は12文字以上にすることをおすすめします。");

// ---------- 協賛店の番号（sponsors.csv にある番号だけを受け付ける） ----------
let sponsorIds = new Set();
function loadSponsors() {
  try {
    const buf = fs.readFileSync(path.join(ROOT, "sponsors.csv"));
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, ""); }
    catch (e) { text = new TextDecoder("shift_jis").decode(buf); }
    const rows = text.split(/\r?\n/).map(l => l.split(","));
    const col = (rows.shift() || []).map(h => h.trim().replace(/^"|"$/g, "")).indexOf("番号");
    const ids = new Set();
    if (col >= 0) rows.forEach(r => { const n = parseInt((r[col] || "").replace(/"/g, ""), 10); if (n > 0) ids.add(n); });
    sponsorIds = ids;
  } catch (e) { console.warn("sponsors.csv を読めませんでした：", e.message); }
}
loadSponsors();
setInterval(loadSponsors, 5 * 60e3); // 5分ごとに読み直す（CSVを更新したとき用）

// ---------- 集計データ { "2026-11-16": { "1": { view: 3, checkin: 1 } } } ----------
let counts = {};
try { counts = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch (e) {}
let dirty = false;
function saveSoon() {
  if (dirty) return; dirty = true;
  setTimeout(() => {
    dirty = false;
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      const tmp = DATA_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(counts));
      fs.renameSync(tmp, DATA_FILE);
    } catch (e) { console.error("集計の保存に失敗しました：", e.message); }
  }, 2000);
}
function jstDate() { return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); }

// ---------- 送信元（IPアドレス） ----------
function clientIp(req) {
  if (TRUST_PROXY && req.headers["x-forwarded-for"]) return String(req.headers["x-forwarded-for"]).split(",")[0].trim();
  return req.socket.remoteAddress || "";
}

// 同じ送信元からの大量送信を防ぐ（1分に60回まで）
const hits = new Map();
setInterval(() => hits.clear(), 60e3);
function tooMany(req) {
  const ip = clientIp(req);
  const n = (hits.get(ip) || 0) + 1; hits.set(ip, n);
  return n > 60;
}

// レポートのパスワード：同じ送信元で5回まちがえたら15分受け付けない
const fails = new Map(); // ip → { n, until }
function locked(ip) { const f = fails.get(ip); return f && f.until > Date.now(); }
function failed(ip) {
  const f = fails.get(ip) || { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= 5) { f.until = Date.now() + 15 * 60e3; f.n = 0; console.warn(`レポートのパスワード誤り5回：${ip} を15分止めました`); }
  fails.set(ip, f);
}
setInterval(() => { const now = Date.now(); for (const [k, f] of fails) if (f.until < now && f.n === 0) fails.delete(k); }, 60e3);
function okPassword(req) {
  const h = String(req.headers.authorization || "");
  const given = crypto.createHash("sha256").update(h.replace(/^Bearer /, "")).digest();
  const want = crypto.createHash("sha256").update(PASSWORD).digest();
  return crypto.timingSafeEqual(given, want);
}

// ---------- 返事のしかた ----------
// アプリが読み込んでよい外部の場所（それ以外は読み込ませない）
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://msearch.gsi.go.jp",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'"
].join("; ");
function baseHeaders(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(self), camera=(), microphone=()");
  res.setHeader("Content-Security-Policy", CSP);
  if (HSTS) res.setHeader("Strict-Transport-Security", "max-age=31536000");
  if (ALLOWED_ORIGIN && req.headers.origin === ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    res.setHeader("Vary", "Origin");
  }
}
function send(res, code, body, type = "application/json; charset=utf-8") {
  if (res.headersSent) return;
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" }); res.end(body);
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".csv": "text/csv; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp", ".webmanifest": "application/manifest+json", ".md": "text/plain; charset=utf-8" };

function handle(req, res) {
  baseHeaders(req, res);
  let url;
  try { url = new URL(req.url, "http://x"); } catch (e) { return send(res, 400, "Bad request", "text/plain"); }
  if (req.method === "OPTIONS") return send(res, 204, "");

  // ---- 回数を受け取る ----
  if (url.pathname === "/api/event" && req.method === "POST") {
    if (tooMany(req)) return send(res, 429, '{"ok":false}');
    let body = "";
    req.on("data", c => { body += c; if (body.length > 200) { send(res, 413, '{"ok":false}'); req.destroy(); } });
    req.on("end", () => {
      try {
        const { t, s } = JSON.parse(body);
        if (!TYPES.has(t) || !Number.isInteger(s)) return send(res, 400, '{"ok":false}');
        // 「アプリを開いた」は番号0だけ、それ以外は sponsors.csv にある番号だけ
        if (t === "open" ? s !== 0 : !sponsorIds.has(s)) return send(res, 400, '{"ok":false}');
        const d = jstDate(), sid = String(s);
        counts[d] ??= {}; counts[d][sid] ??= {};
        counts[d][sid][t] = (counts[d][sid][t] || 0) + 1;
        saveSoon();
        send(res, 200, '{"ok":true}');
      } catch (e) { send(res, 400, '{"ok":false}'); }
    });
    req.on("error", () => {});
    return;
  }

  // ---- 集計結果（パスワードが必要） ----
  if (url.pathname === "/api/report" && req.method === "GET") {
    const ip = clientIp(req);
    if (locked(ip)) return send(res, 429, '{"error":"パスワードを続けてまちがえたため、15分ほど受け付けません"}');
    if (!okPassword(req)) { failed(ip); return send(res, 401, '{"error":"パスワードが違います"}'); }
    fails.delete(ip);
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const from = re.test(url.searchParams.get("from") || "") ? url.searchParams.get("from") : "0000-00-00";
    const to = re.test(url.searchParams.get("to") || "") ? url.searchParams.get("to") : "9999-99-99";
    const rows = [];
    for (const [d, bySponsor] of Object.entries(counts)) {
      if (d < from || d > to) continue;
      for (const [sid, c] of Object.entries(bySponsor)) rows.push({ date: d, sponsor: +sid, ...c });
    }
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.sponsor - b.sponsor);
    return send(res, 200, JSON.stringify({ rows }));
  }

  // ---- レポート画面 ----
  if (url.pathname === "/report" || url.pathname === "/report.js") {
    const f = url.pathname === "/report" ? "report.html" : "report.js";
    res.setHeader("X-Robots-Tag", "noindex");
    return fs.readFile(path.join(__dirname, f), (e, d) => e ? send(res, 404, "") : send(res, 200, d, MIME[path.extname(f)]));
  }

  // ---- アプリ本体のファイル ----
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "");
  let p;
  try { p = decodeURIComponent(url.pathname); } catch (e) { return send(res, 400, "Bad request", "text/plain"); }
  if (p.includes("\0")) return send(res, 400, "Bad request", "text/plain");
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(ROOT, p);
  // server/ や .git など、公開しないフォルダーは見せない
  const rel = path.relative(ROOT, file);
  if (rel.startsWith("..") || path.isAbsolute(rel) || /^(server|\.git)([\\/]|$)/.test(rel) || rel.split(/[\\/]/).some(x => x.startsWith("."))) return send(res, 404, "Not found", "text/plain");
  fs.readFile(file, (e, d) => {
    if (e) return send(res, 404, "Not found", "text/plain");
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(req.method === "HEAD" ? undefined : d);
  });
}

const server = http.createServer((req, res) => {
  // 予想外のエラーが起きても、サーバー全体は止めない
  try { handle(req, res); } catch (e) { console.error("リクエストの処理でエラー：", e.message); send(res, 500, "Server error", "text/plain"); }
});
server.headersTimeout = 15e3; server.requestTimeout = 30e3;
process.on("uncaughtException", e => console.error("予想外のエラー：", e.message));
server.listen(PORT, () => console.log(`集計サーバーを起動しました： http://localhost:${PORT}/  （レポート： /report）`));

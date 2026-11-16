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
//   REPORT_PASSWORD  … レポートを見るためのパスワード（必須）
//   DATA_FILE        … 集計を保存するファイル（初期値 server/data/counts.json）
//   ALLOWED_ORIGIN   … アプリを別のドメインに置くときの、そのURL（例 https://example.jp）
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
const TYPES = new Set(["open", "view", "checkin", "coupon", "link"]);

if (!PASSWORD) { console.error("REPORT_PASSWORD を設定してください。例：REPORT_PASSWORD=xxxx node server/server.js"); process.exit(1); }

// ---------- 集計データ { "2026-11-16": { "1": { view: 3, checkin: 1 } } } ----------
let counts = {};
try { counts = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch (e) {}
let dirty = false;
function saveSoon() {
  if (dirty) return; dirty = true;
  setTimeout(() => {
    dirty = false;
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(counts));
    fs.renameSync(tmp, DATA_FILE);
  }, 2000);
}
function jstDate() { return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); }

// 同じ通信元からの大量送信を防ぐ（1分に60回まで）
const hits = new Map();
setInterval(() => hits.clear(), 60e3);
function tooMany(req) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const n = (hits.get(ip) || 0) + 1; hits.set(ip, n);
  return n > 60;
}

function cors(req, res) {
  if (ALLOWED_ORIGIN && req.headers.origin === ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  }
}
function send(res, code, body, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" }); res.end(body);
}
function okPassword(req) {
  const h = req.headers.authorization || "";
  const given = Buffer.from(h.replace(/^Bearer /, ""));
  const want = Buffer.from(PASSWORD);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".csv": "text/csv; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".webmanifest": "application/manifest+json", ".md": "text/plain; charset=utf-8" };

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  cors(req, res);
  if (req.method === "OPTIONS") return send(res, 204, "");

  // ---- 回数を受け取る ----
  if (url.pathname === "/api/event" && req.method === "POST") {
    if (tooMany(req)) return send(res, 429, '{"ok":false}');
    let body = "";
    req.on("data", c => { body += c; if (body.length > 200) req.destroy(); });
    req.on("end", () => {
      try {
        const { t, s } = JSON.parse(body);
        const sid = Number.isInteger(s) && s >= 0 && s < 100000 ? String(s) : null;
        if (!TYPES.has(t) || sid === null) return send(res, 400, '{"ok":false}');
        const d = jstDate();
        counts[d] ??= {}; counts[d][sid] ??= {};
        counts[d][sid][t] = (counts[d][sid][t] || 0) + 1;
        saveSoon();
        send(res, 200, '{"ok":true}');
      } catch (e) { send(res, 400, '{"ok":false}'); }
    });
    return;
  }

  // ---- 集計結果（パスワードが必要） ----
  if (url.pathname === "/api/report" && req.method === "GET") {
    if (!okPassword(req)) return send(res, 401, '{"error":"パスワードが違います"}');
    const from = url.searchParams.get("from") || "0000-00-00", to = url.searchParams.get("to") || "9999-99-99";
    const rows = [];
    for (const [d, bySponsor] of Object.entries(counts)) {
      if (d < from || d > to) continue;
      for (const [sid, c] of Object.entries(bySponsor)) rows.push({ date: d, sponsor: +sid, ...c });
    }
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.sponsor - b.sponsor);
    return send(res, 200, JSON.stringify({ rows }));
  }

  // ---- レポート画面 ----
  if (url.pathname === "/report") return fs.readFile(path.join(__dirname, "report.html"), (e, d) => e ? send(res, 404, "") : send(res, 200, d, MIME[".html"]));

  // ---- アプリ本体のファイル ----
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "");
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(ROOT, p);
  // server/ や .git など、公開しないフォルダーは見せない
  const rel = path.relative(ROOT, file);
  if (rel.startsWith("..") || /^(server|\.git)([\\/]|$)/.test(rel) || path.basename(file).startsWith(".")) return send(res, 404, "Not found", "text/plain");
  fs.readFile(file, (e, d) => {
    if (e) return send(res, 404, "Not found", "text/plain");
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(req.method === "HEAD" ? undefined : d);
  });
}).listen(PORT, () => console.log(`集計サーバーを起動しました： http://localhost:${PORT}/  （レポート： /report）`));

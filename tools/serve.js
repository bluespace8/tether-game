// Tiny static server for phone testing. Serves ../www on port 8080 (all interfaces). No packages.
// ELECTRON_RUN_AS_NODE=1 "E:\Evan\Programs\VSCode\Code.exe" tools\serve.js [port]
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "www");
const port = Number(process.argv[2]) || 8080;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };

http.createServer(function (req, res) {
  let p;
  try { p = decodeURIComponent(req.url.split("?")[0]); }
  catch (e) { res.writeHead(400); return res.end("bad request"); }
  if (p.endsWith("/")) p += "index.html";
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  });
}).listen(port, "0.0.0.0", function () { console.log("Tether on http://localhost:" + port); });

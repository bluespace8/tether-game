// Tiny static server for phone testing. Serves ../www on port 8080. No packages.
// Listens on 127.0.0.1 only; pass --lan to listen on all interfaces (0.0.0.0) for Wi-Fi phone testing.
// ELECTRON_RUN_AS_NODE=1 "E:\Evan\Programs\VSCode\Code.exe" tools\serve.js [port] [--lan]
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "www");
const args = process.argv.slice(2);
const lan = args.indexOf("--lan") >= 0;
const host = lan ? "0.0.0.0" : "127.0.0.1";
const port = Number(args.filter(function (a) { return a !== "--lan"; })[0]) || 8080;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };

http.createServer(function (req, res) {
  let p;
  try { p = decodeURIComponent(req.url.split("?")[0]); }
  catch (e) { res.writeHead(400); return res.end("bad request"); }
  if (p.indexOf("\0") >= 0) { res.writeHead(400); return res.end("bad request"); }
  if (p.endsWith("/")) p += "index.html";
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end("forbidden"); }
  try {
    fs.readFile(file, function (err, data) {
      if (err) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(data);
    });
  } catch (e) {
    res.writeHead(500);
    res.end("server error");
  }
}).listen(port, host, function () { console.log("Tether on http://" + (lan ? "<pc-ip>" : "127.0.0.1") + ":" + port + (lan ? " (all interfaces)" : "")); });

"use strict";
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const code = ["core.js", "adapter.js", "calendar.js", "main.js"].map(name => fs.readFileSync(path.join(root, "src", name), "utf8")).join("\n\n");
const dist = path.join(root, "dist");
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, "main.js"), code);
fs.copyFileSync(path.join(root, "manifest.json"), path.join(dist, "manifest.json"));
const preview = path.join(root, "plugin", "preview.png");
if (fs.existsSync(preview)) fs.copyFileSync(preview, path.join(dist, "preview.png"));
console.log("Built " + dist);


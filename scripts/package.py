from pathlib import Path
import argparse
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, default=root / "release")
output = parser.parse_args().output.resolve()
output.mkdir(parents=True, exist_ok=True)
version = json.loads((root / "manifest.json").read_text(encoding="utf-8"))["version"]
plugin = output / f"daily-recommend-history-30-{version}.plugin"
payload = ["manifest.json", "main.js"]
if (root / "dist" / "preview.png").is_file():
    payload.append("preview.png")
with zipfile.ZipFile(plugin, "w", zipfile.ZIP_DEFLATED) as archive:
    for name in payload:
        archive.write(root / "dist" / name, name)
    archive.write(root / "LICENSE", "LICENSE")
source = output / f"daily-recommend-history-30-{version}-source.zip"
with zipfile.ZipFile(source, "w", zipfile.ZIP_DEFLATED) as archive:
    for directory in ("src", "tests", "scripts"):
        for file in (root / directory).rglob("*"):
            if file.is_file():
                archive.write(file, file.relative_to(root).as_posix())
    for name in ("manifest.json", "package.json", "README.md", "LICENSE"):
        archive.write(root / name, name)
    if "preview.png" in payload:
        archive.write(root / "plugin" / "preview.png", "plugin/preview.png")
(output / "安装说明.txt").write_text((root / "README.md").read_text(encoding="utf-8"), encoding="utf-8-sig")
with zipfile.ZipFile(plugin) as archive:
    assert set(archive.namelist()) == set(payload) | {"LICENSE"}
    assert archive.testzip() is None
    assert json.loads(archive.read("manifest.json"))["slug"] == "daily-recommend-history-30"
    assert archive.read("main.js") == (root / "dist" / "main.js").read_bytes()
hashes = "\n".join(f"{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}" for file in (plugin, source))
(output / "SHA256SUMS.txt").write_text(hashes + "\n", encoding="utf-8")
print(json.dumps({"plugin": str(plugin), "source": str(source), "plugin_bytes": plugin.stat().st_size}, ensure_ascii=False))


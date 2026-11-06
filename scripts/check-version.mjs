import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [pkg, lock, tauri, cargo, cargoLock] = await Promise.all([
  read("package.json").then(JSON.parse),
  read("package-lock.json").then(JSON.parse),
  read("src-tauri/tauri.conf.json").then(JSON.parse),
  read("src-tauri/Cargo.toml"),
  read("src-tauri/Cargo.lock"),
]);
const versions = {
  "package-lock.json": lock.version,
  "package-lock.json root package": lock.packages[""].version,
  "tauri.conf.json": tauri.version,
  "Cargo.toml": cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1],
  "Cargo.lock": cargoLock.match(
    /\[\[package\]\]\s+name = "edge-switch"\s+version = "([^"]+)"/,
  )?.[1],
};
for (const [source, version] of Object.entries(versions)) {
  assert.equal(version, pkg.version, `${source} must match package.json`);
}
console.log(`All desktop version metadata matches ${pkg.version}`);

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
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
assert.match(
  pkg.version,
  /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/,
  "Use a release SemVer, for example 2.0.0-alpha.7",
);
const releaseTag = `v${pkg.version}`;
if (process.argv.includes("--release")) {
  const remotes = execFileSync("git", ["remote"], { encoding: "utf8" })
    .trim()
    .split(/\s+/);
  if (remotes.includes("origin")) {
    const references = execFileSync(
      "git",
      [
        "ls-remote",
        "--tags",
        "origin",
        `refs/tags/${releaseTag}`,
        `refs/tags/${releaseTag}^{}`,
      ],
      { encoding: "utf8", timeout: 30000 },
    )
      .trim()
      .split("\n")
      .filter(Boolean);
    if (references.length) {
      const head = execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim();
      const remoteCommit = (
        references.find((line) => line.endsWith("^{}")) || references[0]
      ).split(/\s+/)[0];
      assert.equal(
        remoteCommit,
        head,
        `Published version ${releaseTag} is already assigned to another commit`,
      );
    }
  }
  const tags = execFileSync("git", ["tag", "--list", releaseTag], {
    encoding: "utf8",
  }).trim();
  if (tags) {
    const taggedCommit = execFileSync(
      "git",
      ["rev-list", "-n", "1", releaseTag],
      { encoding: "utf8" },
    ).trim();
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    assert.equal(
      taggedCommit,
      head,
      `Version ${releaseTag} already belongs to a different commit; update the version before packaging`,
    );
  }
  const dirty = execFileSync("git", ["diff", "--name-only", "HEAD"], {
    encoding: "utf8",
  }).trim();
  assert.equal(
    dirty,
    "",
    "Commit the validated source before release packaging so the source ZIP matches the executable",
  );
  console.log(
    `Release package: ${releaseTag} (${pkg.version.includes("-") ? "prerelease" : "stable"})`,
  );
}
console.log(`All desktop version metadata matches ${pkg.version}`);

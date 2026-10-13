import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const phase = process.argv[2];
if (!["before-build", "after-build", "after-verification"].includes(phase)) {
  throw new Error("QWS-113: Supply a supported build-source evidence phase.");
}
const git = (...args) => execFileSync("git", args, {
  encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
});
const source = git("rev-parse", "HEAD").trim();
const status = git("status", "--porcelain=v1", "--untracked-files=all");
const directory = path.resolve(".scratch/windows-release-smoke/source");
await mkdir(directory, { recursive: true });
await writeFile(path.join(directory, `${phase}.json`), JSON.stringify({
  phase, source, status, untracked: git("ls-files", "--others", "--exclude-standard"),
}, null, 2));
await writeFile(path.join(directory, `${phase}.diff`), git("diff", "--no-ext-diff", "--binary", "HEAD"));
console.log(JSON.stringify({ phase, source, status }));
if (phase === "before-build" && status.trim()) {
  throw new Error("QWS-114: Build checkout is dirty; inspect source/before-build.json.");
}

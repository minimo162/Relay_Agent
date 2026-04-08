#!/usr/bin/env node
/**
 * Downloads official Node.js standalone builds into src-tauri/binaries/ for Tauri externalBin.
 * Names match Tauri: relay-node-{target-triple}(.exe on Windows).
 *
 * Env:
 *   TAURI_ENV_TARGET_TRIPLE — set by `tauri build` / `tauri bundle` (preferred)
 *   Otherwise uses `rustc -vV` host triple.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const NODE_VERSION = "v20.18.2";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BIN_DIR = join(ROOT, "src-tauri", "binaries");

function hostTripleFromRustc() {
  const r = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error("fetch-bundled-node: rustc -vV failed; install Rust or set TAURI_ENV_TARGET_TRIPLE");
    process.exit(1);
  }
  const m = r.stdout.match(/host: (\S+)/);
  if (!m) {
    console.error("fetch-bundled-node: could not parse host from rustc -vV");
    process.exit(1);
  }
  return m[1];
}

function tripleToNodeArtifact(triple) {
  const table = {
    "x86_64-unknown-linux-gnu": { platform: "linux", arch: "x64", ext: "tar.xz" },
    "aarch64-unknown-linux-gnu": { platform: "linux", arch: "arm64", ext: "tar.xz" },
    "x86_64-apple-darwin": { platform: "darwin", arch: "x64", ext: "tar.gz" },
    "aarch64-apple-darwin": { platform: "darwin", arch: "arm64", ext: "tar.gz" },
    "x86_64-pc-windows-msvc": { platform: "win", arch: "x64", ext: "zip" },
    "aarch64-pc-windows-msvc": { platform: "win", arch: "arm64", ext: "zip" },
  };
  const a = table[triple];
  if (!a) {
    console.error(
      `fetch-bundled-node: unsupported triple ${triple}. Extend scripts/fetch-bundled-node.mjs.`,
    );
    process.exit(1);
  }
  const base = `node-${NODE_VERSION}-${a.platform}-${a.arch}`;
  const filename = `${base}.${a.ext}`;
  const url = `https://nodejs.org/dist/${NODE_VERSION}/${filename}`;
  return { url, ext: a.ext, base, triple };
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  }
  const body = Readable.fromWeb(res.body);
  await pipeline(body, createWriteStream(dest));
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed with ${r.status}`);
  }
}

async function main() {
  const triple =
    process.env.TAURI_ENV_TARGET_TRIPLE?.trim() || hostTripleFromRustc();
  const { url, ext, base, triple: targetTriple } = tripleToNodeArtifact(triple);

  mkdirSync(BIN_DIR, { recursive: true });

  const destName =
    targetTriple === "x86_64-pc-windows-msvc" ||
    targetTriple === "aarch64-pc-windows-msvc"
      ? `relay-node-${targetTriple}.exe`
      : `relay-node-${targetTriple}`;
  const outPath = join(BIN_DIR, destName);

  if (existsSync(outPath)) {
    console.log(`fetch-bundled-node: exists, skipping: ${outPath}`);
    return;
  }

  const work = mkdtempSync(join(tmpdir(), "relay-node-"));
  const archivePath = join(work, `download.${ext}`);

  try {
    console.log(`fetch-bundled-node: downloading ${url}`);
    await download(url, archivePath);
    const extractDir = join(work, "extract");
    mkdirSync(extractDir, { recursive: true });
    run("tar", ["-xf", archivePath, "-C", extractDir]);

    const nodeDir = join(extractDir, base);
    const srcNode =
      targetTriple === "x86_64-pc-windows-msvc" ||
      targetTriple === "aarch64-pc-windows-msvc"
        ? join(nodeDir, "node.exe")
        : join(nodeDir, "bin", "node");

    if (!existsSync(srcNode)) {
      throw new Error(`expected node binary at ${srcNode}`);
    }
    copyFileSync(srcNode, outPath);
    if (
      targetTriple !== "x86_64-pc-windows-msvc" &&
      targetTriple !== "aarch64-pc-windows-msvc"
    ) {
      chmodSync(outPath, 0o755);
    }
    console.log(`fetch-bundled-node: wrote ${outPath}`);
  } finally {
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

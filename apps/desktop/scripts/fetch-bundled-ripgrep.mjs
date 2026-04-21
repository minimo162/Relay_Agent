#!/usr/bin/env node
/**
 * Downloads official ripgrep builds into src-tauri/binaries/ for Tauri externalBin.
 * Names match Tauri: relay-rg-{target-triple}(.exe on Windows).
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

const RIPGREP_VERSION = "15.1.0";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BIN_DIR = join(ROOT, "src-tauri", "binaries");

function hostTripleFromRustc() {
  const r = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error("fetch-bundled-ripgrep: rustc -vV failed; install Rust or set TAURI_ENV_TARGET_TRIPLE");
    process.exit(1);
  }
  const m = r.stdout.match(/host: (\S+)/);
  if (!m) {
    console.error("fetch-bundled-ripgrep: could not parse host from rustc -vV");
    process.exit(1);
  }
  return m[1];
}

function tripleToRipgrepArtifact(triple) {
  const table = {
    "x86_64-unknown-linux-gnu": { platform: "x86_64-unknown-linux-musl", ext: "tar.gz" },
    "aarch64-unknown-linux-gnu": { platform: "aarch64-unknown-linux-gnu", ext: "tar.gz" },
    "x86_64-apple-darwin": { platform: "x86_64-apple-darwin", ext: "tar.gz" },
    "aarch64-apple-darwin": { platform: "aarch64-apple-darwin", ext: "tar.gz" },
    "x86_64-pc-windows-msvc": { platform: "x86_64-pc-windows-msvc", ext: "zip" },
    "aarch64-pc-windows-msvc": { platform: "aarch64-pc-windows-msvc", ext: "zip" },
    "i686-pc-windows-msvc": { platform: "i686-pc-windows-msvc", ext: "zip" },
  };
  const a = table[triple];
  if (!a) {
    console.error(
      `fetch-bundled-ripgrep: unsupported triple ${triple}. Extend scripts/fetch-bundled-ripgrep.mjs.`,
    );
    process.exit(1);
  }
  const base = `ripgrep-${RIPGREP_VERSION}-${a.platform}`;
  const filename = `${base}.${a.ext}`;
  const url = `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/${filename}`;
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
  const { url, ext, base, triple: targetTriple } = tripleToRipgrepArtifact(triple);

  mkdirSync(BIN_DIR, { recursive: true });

  const isWindows = targetTriple.endsWith("-pc-windows-msvc");
  const outPath = join(BIN_DIR, `relay-rg-${targetTriple}${isWindows ? ".exe" : ""}`);

  if (existsSync(outPath)) {
    console.log(`fetch-bundled-ripgrep: exists, skipping: ${outPath}`);
    return;
  }

  const work = mkdtempSync(join(tmpdir(), "relay-rg-"));
  const archivePath = join(work, `download.${ext}`);

  try {
    console.log(`fetch-bundled-ripgrep: downloading ${url}`);
    await download(url, archivePath);
    const extractDir = join(work, "extract");
    mkdirSync(extractDir, { recursive: true });
    run("tar", ["-xf", archivePath, "-C", extractDir]);

    const srcRg = join(extractDir, base, isWindows ? "rg.exe" : "rg");
    if (!existsSync(srcRg)) {
      throw new Error(`expected ripgrep binary at ${srcRg}`);
    }
    copyFileSync(srcRg, outPath);
    if (!isWindows) {
      chmodSync(outPath, 0o755);
    }
    console.log(`fetch-bundled-ripgrep: wrote ${outPath}`);
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

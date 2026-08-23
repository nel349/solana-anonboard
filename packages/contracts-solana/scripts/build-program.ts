#!/usr/bin/env bun
// Compiles the anonboard post program to build/anonboard.so using the vendored
// cargo-build-sbf from @effectstream/solana-node (no global Solana CLI needed).
import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
// The default export is the bin-wrapper that downloads the Agave toolchain (which
// contains cargo-build-sbf). Used to break the fresh-clone bootstrap deadlock below.
import solanaNodeBin from "@effectstream/solana-node";

const PKG_DIR = import.meta.dirname!;
const ROOT = path.resolve(PKG_DIR, "..");
const PROGRAM_MANIFEST = path.join(ROOT, "programs", "anonboard", "Cargo.toml");
const BUILD_DIR = path.join(ROOT, "build");
const OUT_SO = path.join(BUILD_DIR, "anonboard.so");

// cargo-build-sbf ships in the same vendor/bin as solana-test-validator. Derive its path
// from the RESOLVED @effectstream/solana-node module (solanaNodeBin.path() points at that
// validator) rather than guessing package-local node_modules — the package is hoisted to
// the repo-root node_modules under bun workspaces, so a package-local guess misses both the
// module and the just-downloaded binary.
const VENDORED_SBF = path.join(
  path.dirname(solanaNodeBin.path()),
  "cargo-build-sbf",
);

function resolveCargoBuildSbf(): string {
  return fs.existsSync(VENDORED_SBF) ? VENDORED_SBF : "cargo-build-sbf";
}

// Fresh-clone bootstrap. The vendored toolchain (which contains cargo-build-sbf) is
// downloaded lazily by the validator's run() — but the validator refuses to start
// without this .so, and this build needs cargo-build-sbf: a circular deadlock that
// stops a fresh clone. Trigger the same download here so the build is self-sufficient.
// No-op once the toolchain is present, or when a global cargo-build-sbf is on PATH.
async function ensureCargoBuildSbf(): Promise<void> {
  if (fs.existsSync(VENDORED_SBF)) return;
  const hasGlobal =
    spawnSync("cargo-build-sbf", ["--version"], { stdio: "ignore" }).status === 0;
  if (hasGlobal) return;
  console.log(
    "[contracts-solana] first build: downloading the vendored Solana toolchain…",
  );
  await solanaNodeBin.download();
}

async function main() {
  if (!fs.existsSync(PROGRAM_MANIFEST)) {
    console.error(
      `[contracts-solana] Missing program manifest at ${PROGRAM_MANIFEST}`,
    );
    process.exit(1);
  }

  fs.mkdirSync(BUILD_DIR, { recursive: true });
  await ensureCargoBuildSbf();

  const bin = resolveCargoBuildSbf();
  // v1.52 is the first platform-tools whose cargo (1.85+) supports edition2024
  // deps; the vendored default (Agave 3.0.14's v1.51) is one short.
  const toolsVersion = process.env.SOLANA_PLATFORM_TOOLS_VERSION ?? "v1.52";
  const args = [
    "--manifest-path",
    PROGRAM_MANIFEST,
    "--sbf-out-dir",
    BUILD_DIR,
    "--tools-version",
    toolsVersion,
  ];
  if (process.env.SKIP_FORCE_TOOLS_INSTALL !== "1") {
    args.push("--force-tools-install");
  }
  console.log(`[contracts-solana] $ ${bin} ${args.join(" ")}`);

  const result = spawnSync(bin, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      CARGO_TERM_COLOR: "always",
    },
  });

  if (result.error != null || result.status == null) {
    // status undefined (not a number) = spawn failed, almost always the vendored
    // toolchain isn't downloaded yet (populated by chain:start, which runs after this).
    console.error(
      `[contracts-solana] could not execute ${bin}\n` +
        `  ${result.error ?? "spawn failed"}\n` +
        `\nbuild/anonboard.so is normally present from a prior build, so the usual\n` +
        `path reuses it (SKIP_SOLANA_BUILD=1, the default via start.dev.ts).\n` +
        `To genuinely rebuild, start the validator once so\n` +
        `@effectstream/solana-node downloads its vendored cargo-build-sbf, or put\n` +
        `one on PATH.`,
    );
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(
      `[contracts-solana] cargo-build-sbf exited with status ${result.status}`,
    );
    process.exit(result.status);
  }

  const built = path.join(BUILD_DIR, "anonboard.so");
  if (!fs.existsSync(built)) {
    console.error(
      `[contracts-solana] Expected output not found at ${built}. Run with --debug for cargo output.`,
    );
    process.exit(1);
  }

  console.log(`[contracts-solana] Built ${path.relative(ROOT, OUT_SO)}`);
}

main().catch((e: unknown) => {
  console.error(`[contracts-solana] build failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

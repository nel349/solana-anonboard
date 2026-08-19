// Scoped project typecheck.
//
// The @effectstream packages are distributed as raw .ts (no .d.ts), so tsc
// compiles their source when we import it and reports THEIR internal type
// errors. Those belong to the dependency, not to us, and can't be fixed from
// here. This runs the full tsc program (so our usage IS checked against the
// dependency's real types) but fails only on errors in our own files — making
// `typecheck` a meaningful gate for project code.
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname!, "..");
const tsc = path.join(root, "node_modules", ".bin", "tsc");

const r = spawnSync(tsc, ["--noEmit", "--pretty", "false"], { cwd: root, encoding: "utf8" });
if (r.error) {
  console.error("Failed to run tsc:", r.error.message);
  process.exit(2);
}

const errors = `${r.stdout ?? ""}${r.stderr ?? ""}`
  .split("\n")
  .filter((line) => /: error TS\d+/.test(line));
const ours = errors.filter((line) => !line.startsWith("node_modules/"));
const vendored = errors.length - ours.length;

if (ours.length > 0) {
  console.error(ours.join("\n"));
  console.error(`\n✗ ${ours.length} type error(s) in project code.`);
  process.exit(1);
}

console.log(
  "✓ Project code is type-clean." +
    (vendored > 0
      ? ` (${vendored} vendored @effectstream .ts errors ignored — the dependency ships untyped raw TS.)`
      : ""),
);

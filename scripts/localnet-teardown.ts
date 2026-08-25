// Tear down anonboard's local Midnight chain — mn's Docker localnet — so every
// `bun run dev` starts from a fresh chain + fresh deploy. Shared by the dev wrapper's
// Ctrl-C (scripts/dev.ts) and `bun run dev:stop` (scripts/dev-stop.ts) so both stop
// paths behave identically.
//
// `mn localnet down` stops the node/indexer/proof containers, drops their volumes, and
// clears mn's undeployed dust caches; `midnight-contract:clean` drops anonboard's own
// undeployed deploy record (contract-anonboard.undeployed.json) + its contract level-db,
// so the next boot redeploys against the fresh chain instead of reusing a stale address.
// Both are undeployed-scoped — they never touch a preview/preprod deploy record — so
// this is safe to run on any local stop.

import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname!, "..");
const MN = path.resolve(root, "node_modules/.bin/mn");

// We only manage the localnet on a local (`undeployed`) run we brought up ourselves.
// Hosted runs have no anonboard-managed localnet; MIDNIGHT_LOCALNET=attach means one is
// managed elsewhere (CI) and must not be torn down.
export function shouldTearDownLocalnet(): boolean {
  const net = process.env.MIDNIGHT_NETWORK_ID || "undeployed";
  if (net !== "undeployed") return false;
  if ((process.env.MIDNIGHT_LOCALNET ?? "auto").toLowerCase() === "attach") return false;
  return true;
}

export function tearDownLocalnet(): void {
  console.log("[localnet] tearing down the Docker localnet (`mn localnet down`)…");
  spawnSync(MN, ["localnet", "down"], { stdio: "inherit", timeout: 120_000 });
  spawnSync(
    "bun",
    ["run", "--filter", "@solana-anonboard/contracts-midnight", "midnight-contract:clean"],
    { cwd: root, stdio: "inherit", timeout: 60_000 },
  );
}

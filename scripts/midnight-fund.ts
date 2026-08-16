// ATTACH-mode fund step: make sure the anonboard deploy wallet has NIGHT + dust
// on whatever Midnight localnet we attached to. In SELF-HOST mode the committed
// dev-spec genesis funds it automatically; when attaching to a localnet someone
// else started, its genesis may fund a different wallet, so we top up here.
//
// Reuses `mn` (midnight-wallet-cli, a devDependency) rather than reimplementing
// Midnight wallet ops — the same way Solana self-funds via airdrop-batcher.
//
// Idempotent + best-effort: airdrop on `undeployed` tops up from genesis (a
// no-op cost if already funded), so re-runs are safe. If `mn` is missing we
// fail fast with guidance instead of letting the deploy hang on empty funds.
//
// NOTE: attach + this fund path still needs one live verification pass against a
// healthy localnet (see docs/internal/LOCALNET-DESIGN.md).

import { spawnSync } from "node:child_process";
import path from "node:path";

const MN = path.resolve(import.meta.dirname!, "..", "node_modules/.bin/mn");
const AIRDROP_NIGHT = process.env.MIDNIGHT_FUND_AMOUNT ?? "10000";

function mn(args: string[]): { ok: boolean; out: string } {
  const r = spawnSync(MN, [...args, "--network", "undeployed"], {
    encoding: "utf8",
    timeout: 180_000,
  });
  return { ok: r.status === 0, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function main(): void {
  console.log("[midnight-fund] attach mode — ensuring the deploy wallet is funded…");

  const probe = spawnSync(MN, ["--version"], { encoding: "utf8" });
  if (probe.status !== 0) {
    console.error(
      "[midnight-fund] `mn` (midnight-wallet-cli) not found. Install the devDependency, " +
        "or run in SELF-HOST mode (free the Midnight ports, then `bun run dev`).",
    );
    process.exit(1);
  }

  // The deploy wallet is the undeployed genesis wallet (seed 0000…0001).
  const addr = mn(["genesis-address", "--json"]);
  const address = (() => {
    try {
      const j = JSON.parse(addr.out);
      return j.shieldedAddress ?? j.address ?? "";
    } catch {
      return "";
    }
  })();
  if (!address) {
    console.error("[midnight-fund] couldn't derive the genesis address:\n" + addr.out);
    process.exit(1);
  }

  const drop = mn(["airdrop", AIRDROP_NIGHT, "--wallet", address, "--shielded"]);
  console.log(
    drop.ok
      ? `[midnight-fund] airdropped ${AIRDROP_NIGHT} NIGHT to ${address.slice(0, 18)}…`
      : `[midnight-fund] airdrop reported an issue (continuing; may already be funded):\n${drop.out}`,
  );

  console.log("[midnight-fund] done — proceeding to deploy.");
  process.exit(0);
}

main();

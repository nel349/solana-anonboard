// Best-effort fund step — for the `undeployed` localnet only (mn's Docker localnet).
//
// On a standard `undeployed` localnet the anonboard deploy wallet *is* the
// genesis wallet, so it's already funded and this is a no-op (verified: deploy
// succeeds against the localnet with no funding). For a non-standard chain we
// attempt an idempotent top-up via `mn` (midnight-wallet-cli), but we NEVER block
// boot — if the wallet is truly unfunded the deploy surfaces that itself with a
// clear message.
//
// On a HOSTED net (preview/preprod) this does not apply: the deploy wallet is
// funded via the faucet, and `mn airdrop` only works against a local genesis
// chain — with no local node running, it would retry `ws://localhost:9944` for
// the full 3-min timeout and block the deploy (and the sync node) for nothing.
// So we skip it there.
//
// (Solana self-funds the same way via the airdrop-batcher step.)

import { spawnSync } from "node:child_process";
import path from "node:path";

const MN = path.resolve(import.meta.dirname!, "..", "node_modules/.bin/mn");
const AMOUNT = process.env.MIDNIGHT_FUND_AMOUNT ?? "10000";

function mn(args: string[]): { ok: boolean; stdout: string } {
  const r = spawnSync(MN, [...args, "--network", "undeployed"], {
    encoding: "utf8",
    timeout: 180_000,
  });
  return { ok: r.status === 0, stdout: r.stdout ?? "" };
}

// mn prints polkadot version warnings on stderr; the JSON is on stdout, but be
// defensive and extract the object substring.
function jsonFrom(s: string): any {
  const i = s.indexOf("{");
  const j = s.lastIndexOf("}");
  if (i < 0 || j < 0) return null;
  try {
    return JSON.parse(s.slice(i, j + 1));
  } catch {
    return null;
  }
}

function main(): void {
  // Hosted nets are faucet-funded and have no local genesis chain for `mn airdrop` to
  // reach — running it would hang on ws://localhost:9944 for the 3-min timeout and block
  // the deploy/sync. Only the undeployed localnet uses this step.
  const network = process.env.MIDNIGHT_NETWORK_ID ?? "undeployed";
  if (network !== "undeployed") {
    console.log(
      `[midnight-fund] ${network} is a hosted net — deploy wallet is faucet-funded; skipping the local-genesis top-up.`,
    );
    process.exit(0);
  }

  console.log("[midnight-fund] ensuring the deploy wallet has funds (best-effort)…");

  if (spawnSync(MN, ["--version"], { encoding: "utf8" }).status !== 0) {
    console.log("[midnight-fund] `mn` not available — skipping top-up. Deploy will report if funds are missing.");
    process.exit(0);
  }

  const addr = jsonFrom(mn(["genesis-address", "--json"]).stdout)?.address ?? "";
  if (!addr) {
    console.log("[midnight-fund] couldn't read the genesis address — skipping top-up (the deploy wallet is the genesis wallet on a standard undeployed localnet and should already be funded).");
    process.exit(0);
  }

  const drop = mn(["airdrop", AMOUNT, "--wallet", addr]);
  console.log(
    drop.ok
      ? `[midnight-fund] topped up ${AMOUNT} NIGHT to ${addr.slice(0, 18)}…`
      : "[midnight-fund] top-up not applied (wallet likely already funded) — continuing.",
  );
  process.exit(0);
}

main();

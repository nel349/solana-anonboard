import { assert } from "../helpers.ts";
import { toHex } from "@midnight-ntwrk/midnight-js-utils";
import { deriveMemberPublicKey } from "../../contracts-midnight/contract-anonboard/src/_index.ts";
import { freshMemberSecret } from "./anonboard.ts";

// Exercises the REAL operator daemon (packages/operator/operator.dev.ts) over HTTP
// against the live localnet — the roster-write path the browser/Lace join uses,
// which no other test touches (the STM join test drives its own admin provider).
//
// Regression target: a roster write proves a dust spend against the dust commitment
// tree. On a ~6s-block chain the operator's dust drifts behind the tip between one
// write and the next; without a strict dust-to-tip sync before proving, the node
// rejects the tx as InvalidDustSpendProof (error 170), and the SDK's revert then
// destroys the dust UTXO so the *following* write fails with InsufficientFunds.
// See operator.dev.ts (syncAndWaitForFunds before add_to_roster) + dust-revert-patch.ts.

const OPERATOR_URL = "http://localhost:3335";
const WARMUP_TIMEOUT_MS = 180_000; // cold wallet sync on a funded genesis wallet
const BLOCK_MS = 6_000;
const DRIFT_MS = 2 * BLOCK_MS + 3_000; // let dust fall ≥2 blocks behind the tip

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function freshMemberPkHex(): string {
  return toHex(deriveMemberPublicKey(freshMemberSecret()));
}

type RegisterResult = { ok: boolean; status: number; added?: boolean; error?: string };

async function register(memberPkHex: string): Promise<RegisterResult> {
  const res = await fetch(`${OPERATOR_URL}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ memberPkHex }),
  });
  const body = (await res.json().catch(() => ({}))) as { added?: boolean; error?: string };
  return { ok: res.ok, status: res.status, added: body.added, error: body.error };
}

async function waitForOperatorReady(): Promise<void> {
  const deadline = Date.now() + WARMUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${OPERATOR_URL}/health`);
      if (res.ok) {
        const body = (await res.json()) as { ready?: boolean };
        if (body.ready) return;
      }
    } catch {
      // operator not up yet
    }
    await delay(1000);
  }
  throw new Error(`operator not ready within ${WARMUP_TIMEOUT_MS}ms`);
}

export async function operatorRegisterTest(): Promise<void> {
  console.log("  [info] waiting for the operator wallet to warm up (dust sync)…");
  await waitForOperatorReady();

  const pk1 = freshMemberPkHex();

  // 1. First roster write lands on-chain. add_to_roster's callTx resolves only
  //    after the tx is accepted, so { added: true } is proof it confirmed.
  await assert("operator registers a fresh member (add_to_roster succeeds)", async () => {
    const r = await register(pk1);
    if (!r.ok || r.added !== true) console.error(`    register pk1 → ${r.status} ${JSON.stringify(r)}`);
    return r.ok && r.added === true;
  });

  // 2. Re-registering the SAME pk returns added:false — the operator re-reads the
  //    roster from chain and finds pk1. This asserts the on-chain roster actually
  //    contains pk1 (not just that the earlier HTTP call returned 200).
  await assert("re-registering the same member is idempotent (proves pk1 is on-chain)", async () => {
    const r = await register(pk1);
    if (!r.ok || r.added !== false) console.error(`    re-register pk1 → ${r.status} ${JSON.stringify(r)}`);
    return r.ok && r.added === false;
  });

  // 3. Let the dust drift ≥2 blocks behind the tip, then write again. This is the
  //    regression: pre-fix, the stale dust spend proof is rejected (error 170) and
  //    the second write here 500s with InsufficientFunds. With the strict-sync +
  //    revert patch it must succeed.
  console.log(`  [info] letting operator dust drift ~${Math.round(DRIFT_MS / 1000)}s behind the tip…`);
  await delay(DRIFT_MS);

  const pk2 = freshMemberPkHex();
  await assert("operator registers a second member AFTER dust drift (no error 170 / InsufficientFunds)", async () => {
    const r = await register(pk2);
    if (!r.ok || r.added !== true) console.error(`    register pk2 (post-drift) → ${r.status} ${JSON.stringify(r)}`);
    return r.ok && r.added === true;
  });

  // 4. pk2 also landed on-chain — idempotency confirms the post-drift write was real.
  await assert("the post-drift member is on the roster too (idempotent re-register)", async () => {
    const r = await register(pk2);
    if (!r.ok || r.added !== false) console.error(`    re-register pk2 → ${r.status} ${JSON.stringify(r)}`);
    return r.ok && r.added === false;
  });
}

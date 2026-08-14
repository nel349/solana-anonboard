// Operator service — the "Party B" of the anonboard flow.
//
// Holds the owner + fee-payer Midnight wallet and exposes exactly two writes the
// browser cannot do itself:
//   POST /register { memberPkHex }  -> owner add_to_roster(memberPk)
//   POST /submit   { unboundHex }   -> pay + submit a browser-proven join tx
//
// The browser proves the join locally (secret never leaves it) and hands over
// only the unbound tx bytes; this service pays and submits without ever seeing
// the membership secret. That is the operator-blind property, lifted straight
// from scripts/blind-join.ts. Read routes live on the sync node; these WRITES
// live here so the node stays read-only / replay-deterministic.
//
// Dev-only: single funded wallet, permissive localhost CORS, no auth. A real
// deployment would gate /register behind an invite and rate-limit both.
import { fromHex } from "@midnight-ntwrk/midnight-js-utils";
import {
  buildWalletAndWaitForFunds,
  configureMidnightNodeProviders,
} from "@effectstream/midnight-contracts";
import { midnightNetworkConfig } from "@effectstream/midnight-contracts/midnight-env";
import { readMidnightContract } from "@effectstream/midnight-contracts/read-contract";
import { findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { Transaction as LedgerTx } from "@midnight-ntwrk/ledger-v8";
import path from "node:path";
import {
  Anonboard,
  createAnonboardPrivateState,
  witnesses,
} from "../contracts-midnight/contract-anonboard/src/_index.ts";
import { OWNER_SECRET_KEY } from "../contracts-midnight/owner-key.ts";

const PORT = Number(process.env.OPERATOR_PORT ?? "3335");
const log = (m: string) => console.log(`[operator] ${m}`);

// Serialize every wallet operation. add_to_roster and balance+submit both spend
// the wallet's dust/coins; running them concurrently races the coin selection.
let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(work: () => Promise<T>): Promise<T> {
  const run = chain.then(work, work);
  chain = run.catch(() => {});
  return run;
}

type Ready = {
  contractAddress: string;
  wallet: Awaited<ReturnType<typeof buildWalletAndWaitForFunds>>;
  owner: { callTx: { add_to_roster(pk: Uint8Array): Promise<unknown> } };
  publicDataProvider: {
    queryContractState(addr: string): Promise<{ data: unknown } | null>;
  };
};
let ready: Ready | null = null;

async function warmup(): Promise<void> {
  setNetworkId(midnightNetworkConfig.id);
  const info = readMidnightContract("contract-anonboard", {
    networkId: midnightNetworkConfig.id,
  });
  if (!info.contractAddress) throw new Error("contract not deployed");

  const urls = {
    indexer: midnightNetworkConfig.indexer,
    indexerWS: midnightNetworkConfig.indexerWS,
    node: midnightNetworkConfig.node,
    proofServer: midnightNetworkConfig.proofServer,
  };
  log("building the operator wallet (owner + fee-payer)…");
  const wallet = await buildWalletAndWaitForFunds(
    urls as never,
    midnightNetworkConfig.walletSeed!,
    midnightNetworkConfig.id,
  );
  const zkConfigPath = path.resolve(
    import.meta.dirname!,
    "..",
    "contracts-midnight/contract-anonboard/src/managed",
  );
  const compiled = CompiledContract.make(
    "contract-anonboard",
    Anonboard.Contract as never,
  ).pipe(
    CompiledContract.withWitnesses(witnesses as never),
    CompiledContract.withCompiledFileAssets(zkConfigPath),
  );
  const providers = configureMidnightNodeProviders(
    wallet.wallet,
    wallet.zswapSecretKeys,
    wallet.walletZswapSecretKeys,
    wallet.dustSecretKey,
    wallet.walletDustSecretKey,
    urls as never,
    "operator-admin-state",
    zkConfigPath,
    wallet.unshieldedKeystore,
  );
  const owner = (await findDeployedContract(providers as never, {
    contractAddress: info.contractAddress,
    compiledContract: compiled as never,
    privateStateId: "operatorAdminState",
    initialPrivateState: createAnonboardPrivateState(OWNER_SECRET_KEY),
  } as never)) as never as Ready["owner"];

  ready = {
    contractAddress: info.contractAddress,
    wallet,
    owner,
    publicDataProvider: providers.publicDataProvider as never,
  };
  log(`ready. contract ${info.contractAddress.slice(0, 10)}… on :${PORT}`);
}

function isMemberOnRoster(r: Ready, memberPk: Uint8Array): Promise<boolean> {
  return r.publicDataProvider
    .queryContractState(r.contractAddress)
    .then((s) => {
      if (!s) return false;
      const ledger = Anonboard.ledger(s.data as never);
      return (ledger as { roster: { member(pk: Uint8Array): boolean } }).roster.member(memberPk);
    });
}

async function register(memberPkHex: string): Promise<{ added: boolean }> {
  if (!/^[0-9a-fA-F]{64}$/.test(memberPkHex)) {
    throw new Error("memberPkHex must be 32 bytes of hex (64 chars)");
  }
  const r = ready!;
  const memberPk = fromHex(memberPkHex);
  return serialize(async () => {
    if (await isMemberOnRoster(r, memberPk)) return { added: false };
    log(`add_to_roster(${memberPkHex.slice(0, 12)}…)`);
    await r.owner.callTx.add_to_roster(memberPk);
    return { added: true };
  });
}

async function submit(unboundHex: string): Promise<{ txid: string }> {
  if (!/^[0-9a-fA-F]+$/.test(unboundHex) || unboundHex.length < 2) {
    throw new Error("unboundHex must be a non-empty hex string");
  }
  const r = ready!;
  return serialize(async () => {
    const tx = LedgerTx.deserialize("signature", "proof", "pre-binding", fromHex(unboundHex));
    const recipe = await r.wallet.wallet.balanceUnboundTransaction(
      tx as never,
      {
        shieldedSecretKeys: r.wallet.walletZswapSecretKeys,
        dustSecretKey: r.wallet.walletDustSecretKey,
      } as never,
      { ttl: new Date(Date.now() + 5 * 60 * 1000) } as never,
    );
    const finalized = await r.wallet.wallet.finalizeRecipe(recipe as never);
    const txid = String(await r.wallet.wallet.submitTransaction(finalized as never));
    log(`submitted join ${txid.slice(0, 16)}…`);
    return { txid };
  });
}

// ── HTTP (Bun.serve) ────────────────────────────────────────────────────────
function cors(origin: string | null): Record<string, string> {
  // Dev-only: reflect any localhost origin so the Vite dev server works on any port.
  const allow = origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) ? origin : "*";
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    "content-type": "application/json",
  };
}
function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), { status, headers: cors(origin) });
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const origin = req.headers.get("origin");
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (url.pathname === "/health") {
      return json({ ok: true, ready: ready !== null }, ready ? 200 : 503, origin);
    }
    if (!ready) return json({ ok: false, error: "operator warming up" }, 503, origin);
    try {
      if (req.method === "POST" && url.pathname === "/register") {
        const { memberPkHex } = (await req.json()) as { memberPkHex?: string };
        if (!memberPkHex) return json({ ok: false, error: "memberPkHex required" }, 400, origin);
        return json({ ok: true, ...(await register(memberPkHex)) }, 200, origin);
      }
      if (req.method === "POST" && url.pathname === "/submit") {
        const { unboundHex } = (await req.json()) as { unboundHex?: string };
        if (!unboundHex) return json({ ok: false, error: "unboundHex required" }, 400, origin);
        return json({ ok: true, ...(await submit(unboundHex)) }, 200, origin);
      }
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500, origin);
    }
    return json({ ok: false, error: "not found" }, 404, origin);
  },
});
log(`listening on http://localhost:${PORT} (warming up…)`);
warmup().catch((e) => {
  console.error("[operator] warmup failed:", e);
  process.exit(1);
});

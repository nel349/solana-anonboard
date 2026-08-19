// Operator ("Party B"): registers members on the Midnight roster (owner-only
// add_to_roster) — it never sees a member's secret. Dev-only: single funded
// wallet, permissive CORS, no auth.
import { fromHex } from "@midnight-ntwrk/midnight-js-utils";
import { configureMidnightNodeProviders } from "@effectstream/midnight-contracts";
import {
  buildWalletFacade,
  syncAndWaitForFunds,
} from "@effectstream/midnight-contracts/wallet-info";
import { midnightNetworkConfig } from "@effectstream/midnight-contracts/midnight-env";
import { readMidnightContract } from "@effectstream/midnight-contracts/read-contract";
import { findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  Anonboard,
  createAnonboardPrivateState,
  witnesses,
} from "../contracts-midnight/contract-anonboard/src/_index.ts";
import { OWNER_SECRET_KEY, assertLocalOwnerKey } from "../contracts-midnight/owner-key.ts";

// Fail fast: never run the operator with the committed dev owner key off localnet.
assertLocalOwnerKey(midnightNetworkConfig.id);

const PORT = Number(process.env.OPERATOR_PORT ?? "3335");
const log = (m: string) => console.log(`[operator] ${m}`);

// The linked midnight-wallet-cli binary (bun link). Used to pre-sync dust fast.
const MN_BIN = path.resolve(import.meta.dirname!, "../../node_modules/.bin/mn");

// Run `mn` and capture stdout, with a hard timeout. Rejects on non-zero exit,
// spawn error (e.g. mn not linked), or timeout — all handled by the caller as
// "fall back to the SDK cold sync". `extraEnv` passes secrets (the seed) via the
// child's environment instead of argv, so `ps` can't expose them.
function runMn(args: string[], timeoutMs: number, extraEnv?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(MN_BIN, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`mn timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`mn exited ${code}: ${stderr.trim().slice(-200)}`));
    });
  });
}

// Pre-sync dust via mn's fast indexer-direct reader and return a facade-restorable
// dust snapshot (dustSerializedState). ~15s cold / instant warm on a hosted net,
// vs the SDK dust wallet's ~80s cold scan. Best-effort — throws on any failure.
async function primeDustSnapshotViaMn(network: string, seed: string): Promise<string> {
  const t0 = Date.now();
  log("priming dust via mn (fast indexer-direct sync)…");
  // Seed goes via MN_SEED in the child env (not argv) so it never appears in `ps`.
  const raw = await runMn(["dust", "export", "--network", network, "--json"], 150_000, { MN_SEED: seed });
  // mn writes JSON to stdout; be defensive about any stray prefix/suffix.
  const i = raw.indexOf("{");
  const j = raw.lastIndexOf("}");
  if (i < 0 || j < 0) throw new Error("mn dust export produced no JSON");
  const parsed = JSON.parse(raw.slice(i, j + 1)) as { snapshot?: string; offset?: number; dustBalance?: string };
  if (!parsed.snapshot) throw new Error("mn dust export returned no snapshot");
  log(`dust primed via mn: offset=${parsed.offset} balance=${parsed.dustBalance} (${Math.round((Date.now() - t0) / 1000)}s)`);
  return parsed.snapshot;
}

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
  wallet: Awaited<ReturnType<typeof buildWalletFacade>>;
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
  // Pre-sync dust via mn (fast indexer-direct reader) and restore the facade from its
  // snapshot — skips the SDK dust wallet's slow cold scan, the warm-up long pole. This
  // applies on every network including the local one: the SDK's dust sync is the
  // bottleneck there too (mn reads it in a few seconds). Best-effort: any failure falls
  // through to the SDK's own dust sync below, so warm-up never breaks.
  let dustSnapshot: string | null = null;
  try {
    dustSnapshot = await primeDustSnapshotViaMn(midnightNetworkConfig.id, midnightNetworkConfig.walletSeed!);
  } catch (e) {
    log(`mn dust export unavailable (${e instanceof Error ? e.message : String(e)}); cold-syncing dust via SDK`);
  }

  log("building the operator wallet (owner + fee-payer)…");
  const wallet = await buildWalletFacade(
    urls as never,
    midnightNetworkConfig.walletSeed!,
    midnightNetworkConfig.id,
    "all" as never,
    dustSnapshot,
  );
  try {
    // The operator only spends dust (roster fees), so wait for dust + unshielded and skip
    // WAITING on the shielded scan (the hosted-net long pole for readiness). skipShielded
    // only drops shielded from the wait filter — the shielded sub-wallet still syncs in the
    // background — so the operator is ready as soon as dust is synced. Throws on timeout.
    log("syncing wallet — dust + unshielded (not waiting on the shielded scan)…");
    await syncAndWaitForFunds(wallet.wallet as never, { skipShielded: true });
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
  } catch (e) {
    // Stop the wallet's sync subscriptions before warmupWithRetry builds a fresh facade,
    // else each retry leaks an actively-syncing wallet (more indexer load + memory).
    try {
      await (wallet.wallet as { stop?: () => Promise<void> }).stop?.();
    } catch {
      /* best effort */
    }
    throw e;
  }
}

function isMemberOnRoster(r: Ready, memberPk: Uint8Array): Promise<boolean> {
  return r.publicDataProvider
    .queryContractState(r.contractAddress)
    .then((s) => {
      if (!s) return false;
      const ledger = Anonboard.ledger(s.data as never);
      // roster is a Merkle tree — membership = a path exists for the leaf.
      return (
        ledger as {
          roster: { findPathForLeaf(pk: Uint8Array): unknown };
        }
      ).roster.findPathForLeaf(memberPk) !== undefined;
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
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500, origin);
    }
    return json({ ok: false, error: "not found" }, 404, origin);
  },
});
// A transient indexer error during warm-up (a rate-limit blip, a cold-sync hiccup)
// must not kill the operator — it stays up serving 503 and keeps retrying with
// backoff until the wallet builds and the contract is found.
async function warmupWithRetry(): Promise<void> {
  const baseDelayMs = 5000;
  const maxDelayMs = 60000;
  for (let attempt = 1; ; attempt++) {
    try {
      await warmup();
      return;
    } catch (e) {
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      log(
        `warmup attempt ${attempt} failed: ${e instanceof Error ? e.message : String(e)}; ` +
          `retrying in ${Math.round(delay / 1000)}s`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// The wallet SDK (get-wallet-info.ts) installs its OWN unhandledRejection handler that
// process.exit(1)s on any non-'close' rejection — which would kill the operator on a
// transient background indexer/WS error. Replace it (this runs after that import loaded
// it): log and stay up. warmup already retries, and the wallet keeps syncing in the
// background, so a transient rejection shouldn't take the whole operator down.
process.removeAllListeners("unhandledRejection");
process.on("unhandledRejection", (reason) => {
  log(`unhandled rejection (ignored, staying up): ${reason instanceof Error ? reason.message : String(reason)}`);
});

log(`listening on http://localhost:${PORT} (warming up…)`);
void warmupWithRetry();

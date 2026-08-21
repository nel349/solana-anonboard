// Provision the devnet Solana side (single key). One managed keypair funds itself from
// the faucet (topping up from the solana CLI's default key when the faucet is dry),
// deploys the post program immutably (`--final`) at SOLANA_DEVNET_PROGRAM_ID, and serves as
// the batcher / sponsor fee-payer. Only the one-time deploy needs the `solana` CLI — on-chain
// deployment uses the upgradeable loader and has no clean npm API; funding + everything else
// is web3.js. Idempotent: a cloner who picks devnet reuses the shared immutable program with
// no CLI and no keypair.
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SOLANA_DEVNET_PROGRAM_ID } from "../packages/contracts-solana/devnet.ts";

export const DEVNET_RPC = "https://api.devnet.solana.com";
const root = path.resolve(import.meta.dirname!, "..");
export const DEVNET_BATCHER_KEYPAIR = path.join(
  root,
  "packages/batcher/keypair/batcher-wallet.devnet.json",
);
const PROGRAM_KEYPAIR = path.join(root, "packages/contracts-solana/keypair/anonboard-program.devnet.json");
const PROGRAM_SO = path.join(root, "packages/contracts-solana/build/anonboard.so");

function loadKeypair(file: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, "utf8"))));
}

function hasSolanaCli(): boolean {
  try {
    execFileSync("solana", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function loadOrCreateKeypair(file: string): Keypair {
  if (existsSync(file)) return loadKeypair(file);
  mkdirSync(path.dirname(file), { recursive: true });
  const kp = Keypair.generate();
  writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

// Airdrop in 1-SOL chunks until >= 2 SOL (the public devnet faucet caps/rate-limits
// larger single requests). Best-effort — a failed attempt is logged and retried.
async function ensureFunded(conn: Connection, kp: Keypair, log: (m: string) => void): Promise<number> {
  let sol = (await conn.getBalance(kp.publicKey)) / LAMPORTS_PER_SOL;
  for (let i = 0; i < 4 && sol < 2; i++) {
    log(`[devnet] balance ${sol.toFixed(2)} SOL — requesting 1 SOL airdrop (attempt ${i + 1})…`);
    try {
      const sig = await conn.requestAirdrop(kp.publicKey, LAMPORTS_PER_SOL);
      await conn.confirmTransaction(sig, "confirmed");
    } catch (e) {
      log(`[devnet] airdrop attempt failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    sol = (await conn.getBalance(kp.publicKey)) / LAMPORTS_PER_SOL;
  }
  return sol;
}

// Move 2 SOL from the solana CLI's default keypair (~/.config/solana/id.json) to the
// fee-payer, when it has spare devnet SOL. Devnet-only test tokens between the operator's
// own keys — used only because the public faucet is frequently rate-limited/dry.
async function topUpFromDefaultKey(
  conn: Connection,
  payer: Keypair,
  current: number,
  log: (m: string) => void,
): Promise<number> {
  const file = path.join(os.homedir(), ".config/solana/id.json");
  if (!existsSync(file)) return current;
  const funder = loadKeypair(file);
  if (funder.publicKey.equals(payer.publicKey)) return current;
  const funderSol = (await conn.getBalance(funder.publicKey)) / LAMPORTS_PER_SOL;
  if (funderSol < 2.5) return current;
  log(`[devnet] faucet dry — topping up 2 SOL from the CLI default key (${funderSol.toFixed(2)} SOL)…`);
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: funder.publicKey,
      toPubkey: payer.publicKey,
      lamports: 2 * LAMPORTS_PER_SOL,
    }),
  );
  await sendAndConfirmTransaction(conn, tx, [funder], { commitment: "confirmed" });
  return (await conn.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL;
}

export type DevnetProvision = { feePayer: string; deploySlot: number };

export async function provisionDevnet(log: (m: string) => void = console.error): Promise<DevnetProvision> {
  const conn = new Connection(DEVNET_RPC, "confirmed");
  const payer = loadOrCreateKeypair(DEVNET_BATCHER_KEYPAIR);
  const feePayer = payer.publicKey.toBase58();
  log(`[devnet] fee-payer/deployer ${feePayer}`);

  let sol = await ensureFunded(conn, payer, log);
  // Faucet-dry fallback: top up from the CLI's default keypair if it has spare devnet SOL.
  if (sol < 0.5) {
    sol = await topUpFromDefaultKey(conn, payer, sol, log);
  }
  if (sol < 0.5) {
    throw new Error(
      `Only ${sol.toFixed(2)} SOL on ${feePayer} and the faucet is rate-limited. ` +
        `Fund it at https://faucet.solana.com (paste the address), then re-run.`,
    );
  }
  log(`[devnet] fee-payer balance ${sol.toFixed(3)} SOL`);

  const deploySlot = await conn.getSlot("confirmed");
  const acct = await conn.getAccountInfo(new PublicKey(SOLANA_DEVNET_PROGRAM_ID));
  if (acct?.executable) {
    // Cloners land here: reuse the shared immutable program — no CLI, no deploy.
    log(`[devnet] program already deployed at ${SOLANA_DEVNET_PROGRAM_ID} (shared, immutable)`);
  } else {
    // First-time deploy only. On-chain program deployment requires the upgradeable
    // loader (the old npm BpfLoader is dead on-chain), so this one step needs the
    // `solana` CLI. `--final` makes it immutable, so it's a genuine one-time action.
    if (!hasSolanaCli()) {
      throw new Error(
        `The devnet program isn't deployed yet and the one-time deploy needs the solana CLI ` +
          `(https://docs.solanalabs.com/cli/install). Install it and re-run, or have the ` +
          `maintainer deploy once — after that everyone reuses it with no CLI.`,
      );
    }
    log(`[devnet] deploying program --final (immutable) at ${SOLANA_DEVNET_PROGRAM_ID} (one-time)…`);
    execFileSync(
      "solana",
      [
        "program", "deploy", PROGRAM_SO,
        "--program-id", PROGRAM_KEYPAIR,
        "--keypair", DEVNET_BATCHER_KEYPAIR,
        "--final", "--url", DEVNET_RPC,
      ],
      { stdio: "inherit" },
    );
    log(`[devnet] deployed.`);
  }
  return { feePayer, deploySlot };
}

if (import.meta.main) {
  provisionDevnet()
    .then((r) => console.log(JSON.stringify(r)))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

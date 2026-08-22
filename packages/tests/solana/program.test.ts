// Integration test for the on-chain anonboard program (programs/anonboard/src/lib.rs), run
// against a throwaway local validator that loads the compiled .so. This is the automated,
// committed version of the adversarial checks: it asserts the REAL program's behaviour, not a
// re-implementation — PDA creation + fields, gasless posting, monotonic index, Close refunding
// the sponsor (never the author), non-author close rejection, griefing resistance, signer
// enforcement, and body sanitization.
//
// Skips cleanly if the .so isn't built or solana-test-validator isn't installed (so it never
// breaks an environment without the Solana toolchain). Build it first with: bun run build:solana
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Connection, Keypair, SystemProgram, Transaction, TransactionInstruction,
  sendAndConfirmTransaction, LAMPORTS_PER_SOL, PublicKey,
} from "@solana/web3.js";
import {
  createPostInstruction, createCloseInstruction, nextPostIndex,
  counterPda, postPda, decodePostAccount, POST_PROGRAM_ID, DISCRIMINANT_POST,
} from "@solana-anonboard/contracts-solana";

const SO = path.resolve(import.meta.dirname!, "../../contracts-solana/build/anonboard.so");
const HAVE_VALIDATOR =
  spawnSync("solana-test-validator", ["--version"], { stdio: "ignore" }).status === 0;
const CAN_RUN = existsSync(SO) && HAVE_VALIDATOR;
const RPC = "http://127.0.0.1:8990";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let validator: ChildProcess | undefined;
let conn: Connection;
let payer: Keypair; // the sponsor (funds fees + rent)

beforeAll(async () => {
  if (!CAN_RUN) {
    console.warn(`[program.test] SKIPPED — ${existsSync(SO) ? "solana-test-validator not found" : "build/anonboard.so missing (run bun run build:solana)"}`);
    return;
  }
  const ledger = mkdtempSync(path.join(os.tmpdir(), "anonboard-prog-"));
  validator = spawn(
    "solana-test-validator",
    ["--reset", "--quiet", "--ledger", ledger, "--rpc-port", "8990", "--faucet-port", "9990",
     "--bind-address", "127.0.0.1", "--bpf-program", POST_PROGRAM_ID, SO],
    { stdio: "ignore" },
  );
  conn = new Connection(RPC, "confirmed");
  for (let i = 0; i < 60; i++) {
    try { await conn.getVersion(); break; } catch { await sleep(500); }
  }
  payer = Keypair.generate();
  await conn.confirmTransaction(await conn.requestAirdrop(payer.publicKey, 10 * LAMPORTS_PER_SOL), "confirmed");
}, 90_000);

afterAll(() => { validator?.kill("SIGKILL"); });

describe.skipIf(!CAN_RUN)("anonboard program (local validator)", () => {
  it("Post creates the PDA with correct fields, gasless, and bumps the counter", async () => {
    const author = Keypair.generate();
    await sendAndConfirmTransaction(conn, new Transaction().add(
      createPostInstruction(author.publicKey, payer.publicKey, 0, "first ✅|pipe")), [payer, author]);
    const acct = await conn.getAccountInfo(postPda(author.publicKey, 0));
    const post = decodePostAccount(acct!.data);
    expect(post).toEqual({
      author: author.publicKey.toBase58(), payer: payer.publicKey.toBase58(),
      slot: post!.slot, index: 0, body: "first ✅|pipe",
    });
    expect(await conn.getBalance(author.publicKey)).toBe(0); // gasless
    expect(await nextPostIndex(conn, author.publicKey)).toBe(1);
  });

  it("a second post gets the next monotonic index", async () => {
    const author = Keypair.generate();
    for (const [i, body] of [[0, "a"], [1, "b"]] as const) {
      const idx = await nextPostIndex(conn, author.publicKey);
      expect(idx).toBe(i);
      await sendAndConfirmTransaction(conn, new Transaction().add(
        createPostInstruction(author.publicKey, payer.publicKey, idx, body)), [payer, author]);
    }
    expect(decodePostAccount((await conn.getAccountInfo(postPda(author.publicKey, 1)))!.data)!.body).toBe("b");
  });

  it("Close deletes the post and refunds rent to the SPONSOR (not the author)", async () => {
    const author = Keypair.generate();
    await sendAndConfirmTransaction(conn, new Transaction().add(
      createPostInstruction(author.publicKey, payer.publicKey, 0, "delete me")), [payer, author]);
    const before = await conn.getBalance(payer.publicKey);
    await sendAndConfirmTransaction(conn, new Transaction().add(
      createCloseInstruction(author.publicKey, 0, payer.publicKey)), [payer, author]);
    expect(await conn.getAccountInfo(postPda(author.publicKey, 0))).toBeNull(); // gone
    expect(await conn.getBalance(payer.publicKey)).toBeGreaterThan(before); // rent back to sponsor
    expect(await conn.getBalance(author.publicKey)).toBe(0); // author gained nothing
  });

  it("Close by a non-author is rejected", async () => {
    const author = Keypair.generate();
    const attacker = Keypair.generate();
    await sendAndConfirmTransaction(conn, new Transaction().add(
      createPostInstruction(author.publicKey, payer.publicKey, 0, "mine")), [payer, author]);
    // attacker signs the close of author's post, refunding to itself
    const ix = createCloseInstruction(attacker.publicKey, 0, attacker.publicKey);
    // point the post account at AUTHOR's post (attacker can't derive it as its own since seeds differ),
    // so use author's post PDA explicitly:
    ix.keys[1] = { pubkey: postPda(author.publicKey, 0), isSigner: false, isWritable: true };
    await expect(
      sendAndConfirmTransaction(conn, new Transaction().add(ix), [payer, attacker]),
    ).rejects.toThrow();
    expect(await conn.getAccountInfo(postPda(author.publicKey, 0))).not.toBeNull(); // survived
  });

  it("resists griefing: a pre-funded (rent-exempt) PDA does not block the post", async () => {
    const author = Keypair.generate();
    const grief = LAMPORTS_PER_SOL / 100;
    await sendAndConfirmTransaction(conn, new Transaction()
      .add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: counterPda(author.publicKey), lamports: grief }))
      .add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: postPda(author.publicKey, 0), lamports: grief })), [payer]);
    await sendAndConfirmTransaction(conn, new Transaction().add(
      createPostInstruction(author.publicKey, payer.publicKey, 0, "posted despite grief")), [payer, author]);
    expect(decodePostAccount((await conn.getAccountInfo(postPda(author.publicKey, 0)))!.data)!.body).toBe("posted despite grief");
  });

  it("stores a multi-line body verbatim (accounts need no log-injection guard)", async () => {
    const author = Keypair.generate();
    const body = "line one\nline two\twith tab";
    await sendAndConfirmTransaction(conn, new Transaction().add(
      createPostInstruction(author.publicKey, payer.publicKey, 0, body)), [payer, author]);
    expect(decodePostAccount((await conn.getAccountInfo(postPda(author.publicKey, 0)))!.data)!.body).toBe(body);
  });

  it("rejects a post where the author did not sign", async () => {
    const author = Keypair.generate();
    // Craft the Post ix with the author marked non-signer, and sign only with the payer.
    const good = createPostInstruction(author.publicKey, payer.publicKey, 0, "nope");
    const ix = new TransactionInstruction({
      programId: good.programId,
      keys: good.keys.map((k, i) => (i === 0 ? { ...k, isSigner: false } : k)),
      data: good.data,
    });
    expect(ix.data[0]).toBe(DISCRIMINANT_POST);
    await expect(
      sendAndConfirmTransaction(conn, new Transaction().add(ix), [payer]),
    ).rejects.toThrow();
  });
});

// Local-dev launcher for solana-test-validator (vendored via @effectstream/solana-node).
// Delegates to run() rather than direct-spawning — direct spawn skips run()'s SHA-256 verify.
// Known limit: run() has no --limit-ledger-size, so ~45min in the validator prunes blocks
// the sync still needs and wedges. Durable fix is a passthrough upstream.
import { run } from "@effectstream/solana-node";
import fs from "node:fs";
import path from "node:path";
import { COUNTER_PROGRAM_ID } from "@solana-anonboard/contracts-solana/program-id";

const RPC_PORT = Number(process.env.SOLANA_RPC_PORT ?? "8899");
const FAUCET_PORT = Number(process.env.SOLANA_FAUCET_PORT ?? "9900");
const RESET = (process.env.SOLANA_RESET ?? "true") !== "false";

const TEMPLATE_ROOT = path.resolve(import.meta.dirname!, "../..");
const PROGRAM_SO = path.join(
  TEMPLATE_ROOT,
  "packages/contracts-solana/build/counter.so",
);

async function main() {
  if (!fs.existsSync(PROGRAM_SO)) {
    console.error(
      `[chain:start] Missing ${path.relative(TEMPLATE_ROOT, PROGRAM_SO)}.\n` +
        `Run \`bun run --filter @solana-anonboard/contracts-solana build\` first.`,
    );
    process.exit(1);
  }

  console.log(
    `[chain:start] solana-test-validator\n  rpc:     http://localhost:${RPC_PORT}\n  faucet:  ${FAUCET_PORT}\n  program: ${COUNTER_PROGRAM_ID}`,
  );

  const { child } = await run({
    rpcPort: RPC_PORT,
    faucetPort: FAUCET_PORT,
    reset: RESET,
    verbose: true,
    bpfPrograms: [{ address: COUNTER_PROGRAM_ID, soPath: PROGRAM_SO }],
  });

  child.on("close", (code) => {
    if (code !== 0) process.exit(code ?? 1);
  });
}

main().catch((err) => {
  console.error("[chain:start] failed:", err);
  process.exit(1);
});

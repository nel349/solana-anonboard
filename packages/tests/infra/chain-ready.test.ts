import { assert } from "../helpers.ts";
import { POST_PROGRAM_ID } from "@solana-anonboard/contracts-solana";

const RPC_URL = "http://localhost:8899";

async function rpc(method: string, params: unknown[] = []) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await res.json()).result;
}

export async function chainReadyTest() {
  await assert("Solana validator responds to getHealth", async () => {
    const result = await rpc("getHealth");
    return result === "ok";
  });

  await assert("Counter program is loaded at POST_PROGRAM_ID", async () => {
    const result = await rpc("getAccountInfo", [
      POST_PROGRAM_ID,
      { encoding: "base64" },
    ]);
    return result?.value != null && result.value.executable === true;
  });

  await assert("Batcher wallet received the airdrop", async () => {
    // Batcher keypair address; see packages/batcher/keypair/batcher-wallet.json.
    const BALANCE_ADDR = "3oFfnPdVbZZRapZTLgZ1ZDCmdf4YjGMpzDgukoWYpXqW";
    // Use 'processed': finalized lags ~30 slots on a fresh validator, so airdrops aren't final yet.
    const result = await rpc("getBalance", [
      BALANCE_ADDR,
      { commitment: "processed" },
    ]);
    const lamports: number = result?.value ?? 0;
    return lamports > 0;
  });
}

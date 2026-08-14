import { assert } from "../helpers.ts";
import { COUNTER_PROGRAM_ID } from "@solana-anonboard/contracts-solana";

const RPC_URL = "http://localhost:8899";

// Local "deploy" = --bpf-program on the validator (chain-start.ts), not
// `solana program deploy`; either way the program must exist at COUNTER_PROGRAM_ID.
export async function deployTest() {
  await assert("Counter program is owned by BPF loader and executable", async () => {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [
          COUNTER_PROGRAM_ID,
          { encoding: "base64", commitment: "processed" },
        ],
      }),
    });
    const json = await res.json();
    const acct = json?.result?.value;
    // Program accounts are owned by the BPF loader and marked executable.
    return (
      acct?.executable === true &&
      typeof acct?.owner === "string" &&
      acct.owner.startsWith("BPFLoader")
    );
  });
}

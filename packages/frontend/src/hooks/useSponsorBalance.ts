// Sponsor SOL balance, polled every 5s.
import { useEffect, useState } from "react";
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { RPC, SPONSOR } from "../config.ts";

export function useSponsorBalance(): number | null {
  const [sponsorSol, setSponsorSol] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const conn = new Connection(RPC, "confirmed");
    const tick = async () => {
      try {
        const lamports = await conn.getBalance(SPONSOR, "confirmed");
        if (alive) setSponsorSol(lamports / LAMPORTS_PER_SOL);
      } catch (e) {
        console.error("[anonboard] sponsor balance read failed:", e);
      }
    };
    tick();
    const h = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, []);
  return sponsorSol;
}

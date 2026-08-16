// Phase C (the browser UI) isn't covered headless; the batcher round-trip
// exercises the same post path via a raw keypair.
import {
  anyError,
  printSummary,
} from "./helpers.ts";
import pg from "pg";
import path from "path";

const ORCHESTRATOR_PORT = 4747;
const API_PORT = parseInt(process.env.EFFECTSTREAM_API_PORT || "9999", 10);
const DB_PORT = parseInt(process.env.DB_PORT || "5432", 10);

const CLI_PATH = path.resolve(
  import.meta.dirname!,
  "../../node_modules/@effectstream/orchestrator/src/cli.ts",
);
const LAUNCHER_PATH = path.resolve(import.meta.dirname!, "./start.test.ts");

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

let orchestratorProc: ReturnType<typeof Bun.spawn> | null = null;

async function startInfrastructure(): Promise<void> {
  console.log("Starting test infrastructure...");
  orchestratorProc = Bun.spawn(["bun", CLI_PATH, "start", LAUNCHER_PATH], {
    cwd: path.resolve(import.meta.dirname!, "../.."),
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env },
  });
}

async function stopInfrastructure(): Promise<void> {
  console.log("\nStopping infrastructure...");
  try {
    await fetch(`http://localhost:${ORCHESTRATOR_PORT}/shutdown`, {
      method: "POST",
    });
  } catch {
  }
  await delay(2000);
  orchestratorProc?.kill();
}

async function waitForOrchestrator(): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 120_000) {
    try {
      const res = await fetch(`http://localhost:${ORCHESTRATOR_PORT}/health`);
      if (res.ok) return;
    } catch {
    }
    await delay(500);
  }
  throw new Error("Orchestrator did not start within 120s");
}

async function waitForProcess(
  name: string,
  opts: { waitForExit?: boolean; timeoutMs?: number } = {},
): Promise<void> {
  const { waitForExit = false, timeoutMs = 300_000 } = opts;
  console.log(`Waiting for process "${name}"...`);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${ORCHESTRATOR_PORT}/processes`);
      if (res.ok) {
        const data = (await res.json()) as any;
        const proc = data.processes?.find((p: any) => p.name === name);
        if (proc) {
          if (waitForExit && proc.status === "done") return;
          if (!waitForExit && (proc.status === "running" || proc.status === "done")) return;
        }
      }
    } catch {
    }
    await delay(500);
  }
  throw new Error(
    `Process "${name}" did not ${waitForExit ? "complete" : "start"} within ${timeoutMs / 1000}s`,
  );
}

async function waitForHealth(timeoutMs = 120_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${API_PORT}/health`);
      if (res.ok) {
        const data = await res.json();
        if (data.status === "ok") return;
      }
    } catch {
    }
    await delay(500);
  }
  throw new Error("Sync node health check failed");
}

// Process 'running' != HTTP port bound; poll :3334 so Phase B doesn't race the batcher.
async function waitForBatcher(timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch("http://localhost:3334/documentation");
      return; // any HTTP response means the port is bound
    } catch {
    }
    await delay(500);
  }
  throw new Error("Batcher HTTP server did not bind :3334 in time");
}

async function test() {
  let db: pg.Client | null = null;
  let infraError = false;
  try {
    await startInfrastructure();
    await waitForOrchestrator();

    console.log("\n--- Phase A: Infrastructure Tests ---\n");
    await waitForProcess("build-anonboard", { waitForExit: true, timeoutMs: 600_000 });
    await waitForProcess("solana-validator-wait", {
      waitForExit: true,
      timeoutMs: 300_000,
    });
    await waitForProcess("airdrop-batcher", { waitForExit: true, timeoutMs: 120_000 });

    const { chainReadyTest } = await import("./infra/chain-ready.test.ts");
    await chainReadyTest();

    const { deployTest } = await import("./infra/deploy.test.ts");
    await deployTest();

    // The sync node reads the deployed Midnight contract address at import time,
    // so the Compact deploy must finish before sync (and Phase B) can run.
    await waitForProcess("midnight-contract", {
      waitForExit: true,
      timeoutMs: 600_000,
    });

    await waitForProcess("batcher");
    await waitForProcess("sync");
    await waitForHealth();
    await waitForBatcher();

    console.log("\n--- Phase B: STM / DB / API Tests ---\n");
    db = new pg.Client({
      host: "localhost",
      user: "postgres",
      password: "postgres",
      database: "postgres",
      port: DB_PORT,
    });
    await db.connect();
    db.on("error", (err: Error) => console.error("DB error:", err));

    const { postTest } = await import("./stm/post.test.ts");
    const { acceptedAuthor, joinedBadge } = await postTest(db);

    const { apiTest } = await import("./stm/api.test.ts");
    await apiTest(acceptedAuthor, joinedBadge);

    printSummary();
  } catch (e) {
    // Track boot failures explicitly so infra that never came up can't exit 0.
    infraError = true;
    printSummary();
    console.error(e);
  } finally {
    if (db) await db.end();
    await stopInfrastructure();
    if (anyError() || infraError) process.exit(1);
    process.exit(0);
  }
}

test();

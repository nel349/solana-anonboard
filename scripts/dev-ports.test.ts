import { describe, test, expect } from "bun:test";
import { APP_PORTS, LOCALNET_PORTS, DEV_PORTS, isProtectedCommand } from "./dev-ports.ts";

describe("port partition", () => {
  test("APP_PORTS and LOCALNET_PORTS partition DEV_PORTS with no overlap", () => {
    expect([...DEV_PORTS].sort()).toEqual([...APP_PORTS, ...LOCALNET_PORTS].sort());
    const overlap = APP_PORTS.filter((p) => LOCALNET_PORTS.includes(p));
    expect(overlap).toEqual([]);
  });

  test("the shared Midnight localnet ports live in LOCALNET_PORTS, never APP_PORTS", () => {
    for (const p of [9944, 8088, 6300, 30333]) {
      expect(LOCALNET_PORTS).toContain(p);
      expect(APP_PORTS).not.toContain(p);
    }
  });
});

describe("isProtectedCommand (regression: never SIGKILL Docker's backend on a shared localnet port)", () => {
  test("protects Docker / VM networking processes", () => {
    // lsof reports the truncated process name that holds an attached Docker localnet's
    // published host port; SIGKILLing it would take down Docker Desktop and every container.
    for (const cmd of ["com.docker.backend", "com.docke", "Docker", "dockerd", "docker-proxy", "vpnkit", "qemu-system-aarch64", "colima", "lima"]) {
      expect(isProtectedCommand(cmd)).toBe(true);
    }
  });

  test("does not protect anonboard's own native processes (they must still be reaped)", () => {
    for (const cmd of ["npm-midnight-node", "npm-midnight-indexer", "solana-test-validator", "bun", "node", "lsof"]) {
      expect(isProtectedCommand(cmd)).toBe(false);
    }
  });
});

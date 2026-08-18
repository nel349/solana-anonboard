import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  readRegistry,
  getDeployment,
  recordDeployment,
} from "./deployments.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "anonboard-registry-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const ISO = "2026-08-18T00:00:00.000Z";

describe("deployments registry", () => {
  test("empty when nothing is recorded", () => {
    expect(readRegistry(dir)).toEqual({});
    expect(getDeployment("preview", dir)).toBeNull();
  });

  test("record then read back a deployment", () => {
    recordDeployment("preview", { contractAddress: "abc123", deployBlock: 42 }, ISO, dir);
    expect(getDeployment("preview", dir)).toEqual({
      contractAddress: "abc123",
      deployBlock: 42,
      deployedAt: ISO,
    });
  });

  test("upsert overwrites the same network, leaves others intact", () => {
    recordDeployment("preview", { contractAddress: "old", deployBlock: 1 }, ISO, dir);
    recordDeployment("preprod", { contractAddress: "pp", deployBlock: 9 }, ISO, dir);
    recordDeployment("preview", { contractAddress: "new", deployBlock: 2 }, ISO, dir);
    expect(getDeployment("preview", dir)?.contractAddress).toBe("new");
    expect(getDeployment("preprod", dir)?.contractAddress).toBe("pp");
    expect(Object.keys(readRegistry(dir)).sort()).toEqual(["preprod", "preview"]);
  });

  test("falls back to the per-network file when not in the index (legacy deploy)", () => {
    writeFileSync(
      path.join(dir, "contract-anonboard.preview.json"),
      JSON.stringify({ contractAddress: "legacy", deployBlock: 466845 }),
    );
    expect(getDeployment("preview", dir)).toEqual({
      contractAddress: "legacy",
      deployBlock: 466845,
    });
  });

  test("index entry wins over the per-network file", () => {
    writeFileSync(
      path.join(dir, "contract-anonboard.preview.json"),
      JSON.stringify({ contractAddress: "legacy", deployBlock: 1 }),
    );
    recordDeployment("preview", { contractAddress: "indexed", deployBlock: 2 }, ISO, dir);
    expect(getDeployment("preview", dir)?.contractAddress).toBe("indexed");
  });

  test("a per-network file missing deployBlock defaults to 0", () => {
    writeFileSync(
      path.join(dir, "contract-anonboard.preview.json"),
      JSON.stringify({ contractAddress: "noblock" }),
    );
    expect(getDeployment("preview", dir)).toEqual({
      contractAddress: "noblock",
      deployBlock: 0,
    });
  });

  test("corrupt index file is treated as empty, not a crash", () => {
    writeFileSync(path.join(dir, "deployments.json"), "{ not json");
    expect(readRegistry(dir)).toEqual({});
    expect(getDeployment("preview", dir)).toBeNull();
  });
});

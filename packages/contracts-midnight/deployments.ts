// A consolidated index (deployments.json) of deployed contracts, keyed by network.
// The per-network contract-anonboard.<network>.json is still authoritative for
// readMidnightContract; getDeployment() falls back to it so pre-index deploys are
// recognized. The dir param (default: this module's own) lets tests use a scratch dir.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

export type Deployment = {
  contractAddress: string;
  deployBlock: number;
  /** ISO-8601 time the deployment was recorded; absent for legacy per-network files. */
  deployedAt?: string;
};

const DEFAULT_DIR = import.meta.dirname!;
const registryPath = (dir: string) => path.resolve(dir, "deployments.json");
const perNetworkPath = (dir: string, network: string) =>
  path.resolve(dir, `contract-anonboard.${network}.json`);

function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** The whole index, keyed by network. Empty object if the index doesn't exist yet. */
export function readRegistry(dir: string = DEFAULT_DIR): Record<string, Deployment> {
  return readJson<Record<string, Deployment>>(registryPath(dir)) ?? {};
}

/** Recorded deployment for a network, or null (index first, then per-network file). */
export function getDeployment(network: string, dir: string = DEFAULT_DIR): Deployment | null {
  const indexed = readRegistry(dir)[network];
  if (indexed?.contractAddress) return indexed;

  const perNetwork = readJson<{ contractAddress?: string; deployBlock?: number }>(
    perNetworkPath(dir, network),
  );
  if (perNetwork?.contractAddress) {
    return {
      contractAddress: perNetwork.contractAddress,
      deployBlock: typeof perNetwork.deployBlock === "number" ? perNetwork.deployBlock : 0,
    };
  }
  return null;
}

/** Upsert a network's deployment into the consolidated index. */
export function recordDeployment(
  network: string,
  entry: { contractAddress: string; deployBlock: number },
  deployedAt: string,
  dir: string = DEFAULT_DIR,
): void {
  const registry = readRegistry(dir);
  registry[network] = { ...entry, deployedAt };
  writeFileSync(registryPath(dir), JSON.stringify(registry, null, 2) + "\n");
}

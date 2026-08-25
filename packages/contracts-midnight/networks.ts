// Single source of truth for Midnight per-network endpoints.
//
// Change a URL here and it flows everywhere: the frontend imports this directly, and
// start.dev.ts exports these as the MIDNIGHT_* env overrides the vendored SDK reads,
// so the sync node, deploy, and operator pick them up too. Nothing else hardcodes a
// Midnight endpoint.
//
// Versions follow the Midnight support matrix (https://docs.midnight.network/relnotes/
// support-matrix): node 1.0.x, indexer 4.3.x, proof server 8.1.0, midnight-js 4.1.1 —
// the generation this repo targets, and the one preview/preprod run. The indexer API
// is v4 on every network (https://docs.midnight.network/relnotes/network); the local
// indexer serves v4 as well.
//
// The local `undeployed` node/indexer/proof are mn's Docker localnet (`mn localnet up`);
// `bun run dev` brings them up on 9944/8088/6300.
// The proof server is always local (localhost:6300): on undeployed it's the localnet's
// proof-server container; on a hosted net it's a local proof server that proves on your
// machine, then submits to the hosted node.

export type MidnightNetwork = {
  id: string;
  indexer: string; // GraphQL over HTTP
  indexerWS: string; // GraphQL over WebSocket
  node: string; // node RPC
  proofServer: string; // always local
};

const LOCAL_PROOF_SERVER = "http://127.0.0.1:6300";
const INDEXER_API = "v4"; // per the network release notes; bump in one place if it changes

// A hosted TestNet (preview / preprod): indexer + node are Midnight-hosted, proof local.
function hosted(id: string): MidnightNetwork {
  return {
    id,
    indexer: `https://indexer.${id}.midnight.network/api/${INDEXER_API}/graphql`,
    indexerWS: `wss://indexer.${id}.midnight.network/api/${INDEXER_API}/graphql/ws`,
    node: `https://rpc.${id}.midnight.network`,
    proofServer: LOCAL_PROOF_SERVER,
  };
}

export const MIDNIGHT_NETWORKS: Record<string, MidnightNetwork> = {
  // The local dev chain (`bun run dev`). Everything local.
  undeployed: {
    id: "undeployed",
    indexer: `http://127.0.0.1:8088/api/${INDEXER_API}/graphql`,
    indexerWS: `ws://127.0.0.1:8088/api/${INDEXER_API}/graphql/ws`,
    node: "http://127.0.0.1:9944",
    proofServer: LOCAL_PROOF_SERVER,
  },
  preview: hosted("preview"),
  preprod: hosted("preprod"),
};

export const DEFAULT_NETWORK_ID = "undeployed";

export function midnightNetwork(id: string = DEFAULT_NETWORK_ID): MidnightNetwork {
  const net = MIDNIGHT_NETWORKS[id];
  if (!net) {
    throw new Error(
      `Unknown Midnight network "${id}". Known: ${Object.keys(MIDNIGHT_NETWORKS).join(", ")}.`,
    );
  }
  return net;
}

// The fixed ports anonboard's dev stack binds. One list, shared by the dev wrapper
// (scripts/dev.ts) and the teardown (scripts/dev-stop.ts), so "stop" is always complete.
export const DEV_PORTS = [
  9944, 8088, 6300, // Midnight node / indexer / proof server
  8079, // Midnight indexer rate-limiting proxy (hosted nets)
  8899, 9900, // Solana validator
  8898, // Solana devnet post reader (health)
  5432, // PGLite
  9999, // sync node API
  3334, 3335, // batcher / operator
  5173, // frontend
  4747, // orchestrator API
  30333, // Midnight p2p
];

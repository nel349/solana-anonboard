// Pure decision for ensure-deployed.ts: reuse the recorded deploy artifact, or (re)deploy.
// Kept side-effect-free (no I/O, no SDK imports) so it is unit-tested directly.
export type DeployDecision = "reuse" | "deploy";

// `contractOnChain` is null when it wasn't checked (hosted net) or the check failed. On
// localnet an unconfirmed contract is treated as stale (re-deploy) so the stack can never
// hang forever on a contract that isn't on the current chain (findDeployedContract's
// watchForDeployTxData has no timeout). Hosted nets never reset, so their artifact is
// trusted without a probe — a slow indexer must not trigger an address-changing re-deploy.
export function deployDecision(opts: {
  redeployForced: boolean;
  artifactExists: boolean;
  contractAddress: string | null;
  isLocalnet: boolean;
  contractOnChain: boolean | null;
}): DeployDecision {
  if (opts.redeployForced) return "deploy";
  if (!opts.artifactExists || !opts.contractAddress) return "deploy";
  if (!opts.isLocalnet) return "reuse";
  return opts.contractOnChain === true ? "reuse" : "deploy";
}

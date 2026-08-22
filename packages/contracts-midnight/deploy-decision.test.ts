import { describe, test, expect } from "bun:test";
import { deployDecision } from "./deploy-decision.ts";

const base = {
  redeployForced: false,
  artifactExists: true,
  contractAddress: "abc",
  isLocalnet: true,
  contractOnChain: true as boolean | null,
};

describe("deployDecision", () => {
  test("ANONBOARD_REDEPLOY forces a fresh deploy", () => {
    expect(deployDecision({ ...base, redeployForced: true })).toBe("deploy");
  });

  test("deploys when no artifact exists", () => {
    expect(deployDecision({ ...base, artifactExists: false, contractAddress: null })).toBe("deploy");
  });

  test("deploys when the artifact has no contractAddress", () => {
    expect(deployDecision({ ...base, contractAddress: null })).toBe("deploy");
  });

  test("hosted net reuses the artifact without an on-chain probe", () => {
    expect(deployDecision({ ...base, isLocalnet: false, contractOnChain: null })).toBe("reuse");
  });

  test("localnet reuses when the contract is confirmed on-chain", () => {
    expect(deployDecision({ ...base, isLocalnet: true, contractOnChain: true })).toBe("reuse");
  });

  // The operator-hang fix: a stale artifact (contract gone after a localnet reset) must
  // trigger a re-deploy, not a blind reuse that makes findDeployedContract hang forever.
  test("localnet re-deploys a stale artifact whose contract is not on-chain", () => {
    expect(deployDecision({ ...base, isLocalnet: true, contractOnChain: false })).toBe("deploy");
  });

  test("localnet re-deploys when the on-chain check could not confirm (null)", () => {
    expect(deployDecision({ ...base, isLocalnet: true, contractOnChain: null })).toBe("deploy");
  });
});

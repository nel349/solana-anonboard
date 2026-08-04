import { deployMidnightContract } from "@effectstream/midnight-contracts/deploy";
import type { DeployConfig } from "@effectstream/midnight-contracts/types";
import { midnightNetworkConfig } from "@effectstream/midnight-contracts/midnight-env";
import {
  Anonboard,
  createAnonboardPrivateState,
  witnesses,
} from "./contract-anonboard/src/_index.ts";

// Dev-only fixed owner key so the roster admin is reproducible across boots.
// A real deployment would generate this and keep it off the machine.
export const OWNER_SECRET_KEY = new Uint8Array(32);
OWNER_SECRET_KEY[31] = 0x01;

const config: DeployConfig = {
  contractName: "contract-anonboard",
  contractFileName: "contract-anonboard.json",
  contractClass: Anonboard.Contract,
  witnesses,
  privateStateId: "anonboardPrivateState",
  initialPrivateState: createAnonboardPrivateState(OWNER_SECRET_KEY),
  privateStateStoreName: "anonboard-private-state",
};

deployMidnightContract(config, midnightNetworkConfig)
  .then(() => {
    console.log("Deployment successful");
    process.exit(0);
  })
  .catch((e: unknown) => {
    console.error("Unhandled error:", e);
    process.exit(1);
  });

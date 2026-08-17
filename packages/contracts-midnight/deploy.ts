import { deployMidnightContract } from "@effectstream/midnight-contracts/deploy";
import type { DeployConfig } from "@effectstream/midnight-contracts/types";
import { midnightNetworkConfig } from "@effectstream/midnight-contracts/midnight-env";
import {
  Anonboard,
  createAnonboardPrivateState,
  witnesses,
} from "./contract-anonboard/src/_index.ts";

import { OWNER_SECRET_KEY, assertLocalOwnerKey } from "./owner-key.ts";

// Never deploy with the committed dev owner key on anything but the local chain.
assertLocalOwnerKey(midnightNetworkConfig.id);

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

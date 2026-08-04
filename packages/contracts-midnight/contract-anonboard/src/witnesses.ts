// The secret key never leaves this process. Compact resolves the
// `private$secret_key` witness locally at proving time; it is never an
// argument to the circuit and never appears in the transaction.

export type AnonboardPrivateState = {
  secretKey: Uint8Array;
};

export const createAnonboardPrivateState = (
  secretKey: Uint8Array,
): AnonboardPrivateState => ({ secretKey });

export const witnesses = {
  ["private$secret_key"]: (
    context: { privateState: AnonboardPrivateState },
  ): [AnonboardPrivateState, Uint8Array] => [
    context.privateState,
    context.privateState.secretKey,
  ],
};

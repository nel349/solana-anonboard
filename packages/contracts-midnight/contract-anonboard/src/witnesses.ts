// Secret key stays local — never a circuit argument, never in the transaction.

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

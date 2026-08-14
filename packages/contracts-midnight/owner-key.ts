// Dev-only fixed owner key; a real deployment would generate one and keep it off the machine.
export const OWNER_SECRET_KEY = new Uint8Array(32);
OWNER_SECRET_KEY[31] = 0x01;

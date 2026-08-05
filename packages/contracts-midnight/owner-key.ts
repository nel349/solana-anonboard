// Dev-only fixed owner key so the roster admin is reproducible across boots
// and importable without triggering a deploy. A real deployment would generate
// this and keep it off the machine.
export const OWNER_SECRET_KEY = new Uint8Array(32);
OWNER_SECRET_KEY[31] = 0x01;

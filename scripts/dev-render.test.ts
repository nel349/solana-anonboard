import { describe, test, expect } from "bun:test";
import { deployStep, clampWidth, stripAnsi } from "./dev-render.ts";

describe("deployStep", () => {
  test("maps the deploy process's latest line to a short step", () => {
    expect(deployStep("[midnight-contract] Building wallet using modular SDK")).toBe("building wallet");
    expect(deployStep("[midnight-contract] Wallet sync progress (61s): shielded=false, unshielded=true, dust=false")).toBe(
      "syncing wallet — dust syncing (61s)",
    );
    expect(deployStep("[midnight-contract] Wallet sync progress (230s): shielded=true, unshielded=true, dust=true")).toBe(
      "syncing wallet — dust ✓ (230s)",
    );
    expect(deployStep("[midnight-contract] Deployment successful (deploy block 466845)")).toBe("deployed");
  });

  test("uses the LAST deploy line and ignores other processes", () => {
    const log = [
      "[midnight-contract] Building wallet using modular SDK",
      "[solana-validator] Processed Slot: 42",
      "[midnight-contract] Wallet sync progress (10s): shielded=false, unshielded=true, dust=false",
    ].join("\n");
    expect(deployStep(log)).toBe("syncing wallet — dust syncing (10s)");
  });

  test("no deploy activity → empty (row shows plain 'wait', not a stale step)", () => {
    expect(deployStep("[solana-validator] booting")).toBe("");
    expect(deployStep("")).toBe("");
  });
});

describe("clampWidth", () => {
  test("truncates a line to fit the terminal width (visible chars)", () => {
    expect(stripAnsi(clampWidth("abcdefghij", 6))).toBe("abcde"); // cols-1 visible chars
  });

  test("never exceeds cols-1 VISIBLE chars (so it can't wrap)", () => {
    expect(stripAnsi(clampWidth("x".repeat(200), 40)).length).toBeLessThanOrEqual(39);
  });

  test("counts visible chars only, preserving ANSI escapes", () => {
    // 5 visible chars wrapped in color codes; width 10 keeps them all.
    const line = "\x1b[32mhello\x1b[0m";
    expect(clampWidth(line, 10)).toBe(line);
  });

  test("cols=0 (unknown width) is a no-op", () => {
    expect(clampWidth("anything", 0)).toBe("anything");
  });
});

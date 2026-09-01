// Pure render helpers for the dev wrapper, extracted so they're unit-testable without
// spawning the orchestrator that scripts/dev.ts starts on import.

export const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

// Map a single deploy log line to a short phase label, or null if it isn't a
// recognized phase. Separate from deployStep so it can skip unrecognized lines.
function classifyDeployLine(line: string): string | null {
  if (/Deployment successful/.test(line)) return "deployed";
  const sync = line.match(/Wallet sync progress \((\d+)s\):.*dust=(\w+)/);
  if (sync) return `syncing wallet — dust ${sync[2] === "true" ? "✓" : "syncing"} (${sync[1]}s)`;
  // Order matters: the "wallet ready" line also contains "dust primed via mn".
  if (/deploy wallet ready/.test(line)) return "wallet ready";
  if (/dust primed via mn/.test(line)) return "dust primed (mn)";
  if (/priming dust via mn/.test(line)) return "priming dust (mn)";
  if (/Waiting to receive tokens/.test(line)) return "waiting for dust";
  if (/Building wallet/i.test(line)) return "building wallet";
  if (/Deploying contract|Balanc|prov|submit/i.test(line)) return "submitting deploy tx";
  return null;
}

// The deploy process's current step, as a short label for the checklist. The
// deploy subprocess interleaves SDK object dumps (bare `{` / `}` lines, key:value
// fragments) into its output, so we scan newest→oldest for the last RECOGNIZED
// phase and never surface an unrecognized line — otherwise a stray `}` leaks into
// the checklist in place of the phase.
export function deployStep(logTail: string): string {
  const deployLines = stripAnsi(logTail)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("[midnight-contract]"))
    .map((l) => l.replace(/^\[midnight-contract\]\s*/, ""));
  if (deployLines.length === 0) return "";
  for (let i = deployLines.length - 1; i >= 0; i--) {
    const phase = classifyDeployLine(deployLines[i]);
    if (phase) return phase;
  }
  return "working…";
}

// Clamp a line to the terminal width (ANSI-aware) so it never wraps — a wrapped line
// occupies more rows than the in-place redraw assumes, which duplicates the checklist.
export function clampWidth(line: string, cols: number, reset = "\x1b[0m"): string {
  if (!cols) return line;
  const max = cols - 1;
  let visible = 0;
  let out = "";
  let i = 0;
  while (i < line.length) {
    const esc = line.slice(i).match(/^\x1b\[[0-9;]*m/);
    if (esc) {
      out += esc[0];
      i += esc[0].length;
      continue;
    }
    if (visible >= max) {
      out += reset;
      break;
    }
    out += line[i];
    visible += 1;
    i += 1;
  }
  return out;
}

// The "Solana" checklist row changes shape by network. On a LOCAL run it tracks the
// validator; on DEVNET there is no local validator, so it tracks the standalone post
// reader instead. The switch must be the network CHOICE — not "is the reader running":
// since the account-storage refactor the reader runs on local too, and keying on it
// made local runs show devnet labels and probe the wrong port.
export type SolanaRowView = { label: string; right: string; note?: string; probePort: number };
export function solanaRowView(
  devnet: boolean,
  readerPort: number,
  base: { label: string; port: number; link?: string; note?: string },
): SolanaRowView {
  if (!devnet) {
    return { label: base.label, right: base.link ?? `:${base.port}`, note: base.note, probePort: base.port };
  }
  return {
    label: "Solana devnet",
    right: `:${readerPort}`,
    note: "devnet post reader; posts persist across restarts",
    probePort: readerPort,
  };
}

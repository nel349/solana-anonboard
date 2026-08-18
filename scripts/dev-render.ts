// Pure render helpers for the dev wrapper, extracted so they're unit-testable without
// spawning the orchestrator that scripts/dev.ts starts on import.

export const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

// The deploy process's current step, mapped from its latest log line to a short label,
// so the checklist shows "syncing wallet …" instead of a flat "working…".
export function deployStep(logTail: string): string {
  const deployLines = stripAnsi(logTail)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("[midnight-contract]"));
  const last = (deployLines[deployLines.length - 1] ?? "").replace(/^\[midnight-contract\]\s*/, "");
  if (!last) return "";
  if (/Deployment successful/.test(last)) return "deployed";
  const sync = last.match(/Wallet sync progress \((\d+)s\):.*dust=(\w+)/);
  if (sync) return `syncing wallet — dust ${sync[2] === "true" ? "✓" : "syncing"} (${sync[1]}s)`;
  if (/Waiting to receive tokens/.test(last)) return "waiting for dust";
  if (/Building wallet/i.test(last)) return "building wallet";
  if (/Balanc|prov|submit/i.test(last)) return "submitting deploy tx";
  return last.length > 40 ? last.slice(0, 40) + "…" : last;
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

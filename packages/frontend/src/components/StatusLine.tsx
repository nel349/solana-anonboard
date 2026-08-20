// The shared status line. Renders nothing when empty; errors get an assertive ARIA role.
import type { Status } from "../useAppStatus.ts";

export function StatusLine({ status }: { status: Status }) {
  if (!status.msg) return null;
  return (
    <p className={`status ${status.kind}`} role={status.kind === "err" ? "alert" : "status"}>
      {status.msg}
    </p>
  );
}

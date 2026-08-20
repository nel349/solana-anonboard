// The single status line shared by the connect / join / post flows. One message at a
// time, with a kind that drives its styling and ARIA role.
import { useState, type Dispatch, type SetStateAction } from "react";

export type StatusKind = "info" | "ok" | "err";
export type Status = { msg: string; kind: StatusKind };
export type SetStatus = Dispatch<SetStateAction<Status>>;

export function useAppStatus(): { status: Status; setStatus: SetStatus } {
  const [status, setStatus] = useState<Status>({ msg: "", kind: "info" });
  return { status, setStatus };
}

// One status line, shared across the connect/join/post flows.
import { useState, type Dispatch, type SetStateAction } from "react";

export type StatusKind = "info" | "ok" | "err";
export type Status = { msg: string; kind: StatusKind };
export type SetStatus = Dispatch<SetStateAction<Status>>;

export function useAppStatus(): { status: Status; setStatus: SetStatus } {
  const [status, setStatus] = useState<Status>({ msg: "", kind: "info" });
  return { status, setStatus };
}

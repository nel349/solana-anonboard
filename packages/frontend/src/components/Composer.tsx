// The post composer: a bounded textarea with a live character count and a Post button.
import { MAX_BODY } from "../config.ts";

export function Composer({
  draft,
  onDraft,
  onPost,
  busy,
}: {
  draft: string;
  onDraft: (v: string) => void;
  onPost: () => void;
  busy: boolean;
}) {
  return (
    <div className="compose">
      <textarea
        value={draft}
        maxLength={MAX_BODY}
        placeholder="Say something…"
        aria-label="Post body"
        onChange={(e) => onDraft(e.target.value)}
        disabled={busy}
      />
      <div className="row">
        <span className="count">
          {draft.length}/{MAX_BODY}
        </span>
        <button onClick={onPost} disabled={busy || !draft.trim()}>
          {busy ? "Posting…" : "Post"}
        </button>
      </div>
    </div>
  );
}

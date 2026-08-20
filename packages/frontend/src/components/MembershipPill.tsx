// Membership status pill. `member` is the optimistic-or-confirmed flag; `isMember` is
// the sync node's on-chain truth (null while first loading), which distinguishes a
// confirmed member from one still syncing.
export function MembershipPill({ member, isMember }: { member: boolean; isMember: boolean | null }) {
  if (member) {
    return isMember === true ? (
      <span className="pill ok">
        <span className="d" />
        member
      </span>
    ) : (
      <span className="pill ok">
        <span className="d" />
        member · syncing…
      </span>
    );
  }
  if (isMember === null) {
    return (
      <span className="pill">
        <span className="d" />
        checking
      </span>
    );
  }
  return (
    <span className="pill warn">
      <span className="d" />
      not a member
    </span>
  );
}

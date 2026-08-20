// The console's header row: the user's anonymous badge and their membership status.
import { MembershipPill } from "./MembershipPill.tsx";

export function BadgeHeader({
  badgePk,
  member,
  isMember,
}: {
  badgePk: string;
  member: boolean;
  isMember: boolean | null;
}) {
  return (
    <div className="who">
      <div>
        <span className="label">Your anonymous badge</span>
        <code>{badgePk}</code>
      </div>
      <MembershipPill member={member} isMember={isMember} />
    </div>
  );
}

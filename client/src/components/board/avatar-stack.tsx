import type { Expert } from "@shared/schema";
import { Monogram } from "@/components/design";
import { roleColor } from "@/lib/board";
import { cn } from "@/lib/utils";

export function AvatarStack({
  experts,
  max = 5,
  onClick,
  size = 26,
}: {
  experts: Expert[];
  max?: number;
  onClick?: () => void;
  size?: number;
}) {
  const shown = experts.slice(0, max);
  const overflow = experts.length - shown.length;
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex items-center",
        onClick && "rounded-full p-0.5 transition-colors hover:bg-slatewash",
      )}
      aria-label={onClick ? "Manage the board" : `${experts.length} directors`}
    >
      {shown.map((expert, index) => (
        <span
          key={expert.id}
          className="rounded-full ring-2 ring-paper"
          style={{ marginLeft: index === 0 ? 0 : -7 }}
          title={expert.role}
        >
          <Monogram name={expert.role} color={expert.avatarUrl?.startsWith("#") ? expert.avatarUrl : roleColor(expert.role, expert.id)} size={size} />
        </span>
      ))}
      {overflow > 0 && (
        <span
          className="flex items-center justify-center rounded-full bg-slatewash text-[9px] font-medium text-muted-ink ring-2 ring-paper"
          style={{ width: size, height: size, marginLeft: -7 }}
        >
          +{overflow}
        </span>
      )}
    </Wrapper>
  );
}

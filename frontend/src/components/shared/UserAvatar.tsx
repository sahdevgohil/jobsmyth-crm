export function UserAvatar({ first, last, size = 32 }: { first: string; last: string; size?: number }): React.ReactElement {
  const initials = `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground"
    >
      {initials}
    </span>
  );
}

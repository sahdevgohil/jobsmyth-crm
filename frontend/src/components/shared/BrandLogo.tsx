/**
 * Official Legacy Construction Group LLC logo. Assets live in /public/brand (cropped from the supplied
 * artwork, never redrawn). Only the height is set, so the aspect ratio is always preserved.
 */
export function BrandLogo({
  variant = 'full',
  height,
  className,
}: {
  variant?: 'full' | 'mark';
  height: number;
  className?: string;
}): React.ReactElement {
  const src = variant === 'mark' ? '/brand/logo-mark-160.png' : '/brand/logo-full-520.png';
  return (
    <img
      src={src}
      alt="Legacy Construction Group LLC"
      style={{ height, width: 'auto' }}
      className={className}
      draggable={false}
    />
  );
}

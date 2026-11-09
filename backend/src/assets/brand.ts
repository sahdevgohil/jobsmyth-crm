import { BRAND_LOGO_DATA_URI } from './brand-logo.js';

/** Official logo for printable documents. Width is fixed, height is automatic: the aspect ratio is never changed. */
export function brandLogoImg(widthPx = 150): string {
  return `<img class="brand-logo" src="${BRAND_LOGO_DATA_URI}" alt="Legacy Construction Group LLC" width="${widthPx}" style="width:${widthPx}px;height:auto">`;
}


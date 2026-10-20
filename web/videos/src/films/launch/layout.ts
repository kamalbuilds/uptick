/**
 * Where things sit, in design px of the page (the product's own CSS px) and in screen px (1920x1080).
 * Numbers marked "measured" come from `bun scripts/stills.ts out/review/debug <frames> --composition Launch --debug`.
 * Re-measure after any change upstream of a target.
 */
export const HOME_WIDTH = 1160; // two columns as on the site: 340 + 64 gap + 756
export const HOME_ZOOM = 1.5; // 1160 design px -> 1740 screen px
export const DETAIL_WIDTH = 930;
export const DETAIL_ZOOM = 1.85; // 930 design px -> 1720 screen px

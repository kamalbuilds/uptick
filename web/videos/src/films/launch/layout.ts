/**
 * Where things sit, in design px of the page (the product's own CSS px) and in screen px (1920x1080).
 * Numbers marked "measured" come from `bun scripts/stills.ts out/review/debug <frames> --composition Launch --debug`.
 * Re-measure after any change upstream of a target.
 */
export const HOME_WIDTH = 980; // two columns: 300 + 48 gap + 632
export const HOME_ZOOM = 1.8; // 980 design px -> 1764 screen px (78 px margins); labels are 13 x 1.8 = 23.4 px
export const DETAIL_WIDTH = 930;
export const DETAIL_ZOOM = 1.85; // 930 design px -> 1720 screen px

/** Home camera. OVERVIEW frames both columns for the heading; LIST frames the right column alone once the heading has left, at a bigger zoom
 *  (labels 13 x 2.1 = 27 px), first at the top of the list and then at its bottom. measured: page height 838 design px, a 45 px margin top and bottom. */
export const HOME_CAMERA = { overview: { x: 490, y: 275, zoom: 1.8 }, list: { x: 664, top: 236, bottom: 602, zoom: 2.1 } };
/** The row the film zooms into, centre in design px. measured */
export const ROW_TARGET = { x: 664, y: 120.5, zoom: 2.7 };
/** Ticker traveler, screen px. measured */
export const TRAVEL_FROM = { x: 165, y: 531, size: 15 * 2.7 };
export const TRAVEL_TO = { x: 168, y: 356 };

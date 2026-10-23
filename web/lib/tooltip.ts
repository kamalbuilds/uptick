export const TOOLTIP_WIDTH = 280;
export const TOOLTIP_GUTTER = 12;

/** How far to move a tooltip from the left edge of its word so the whole box sits inside the viewport: 0 where it fits, negative near the right edge, positive when the word
 *  starts left of the gutter. The box is `width` wide, or the viewport less both gutters on a narrow screen. */
export function tooltipShift(anchorLeft: number, viewportWidth: number, width = TOOLTIP_WIDTH, gutter = TOOLTIP_GUTTER): number {
  const box = Math.min(width, viewportWidth - 2 * gutter);
  const left = Math.min(Math.max(anchorLeft, gutter), viewportWidth - gutter - box);
  return left - anchorLeft;
}

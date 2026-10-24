/** Symbols that ship a logomark in public/tokens/<SYMBOL>.png. Every other symbol is drawn as a ticker monogram on the same tile. */
export const MARKS: ReadonlySet<string> = new Set(["AAPL", "AMD", "AMZN", "CRCL", "GOOGL", "META", "MU", "NVDA", "PLTR", "TSLA", "USDG"]);

/** The monogram text for a tile: the whole ticker on tiles of 36px and up, its first two letters on small tiles. */
export function monogram(symbol: string, size: number): string {
  return size < 36 ? symbol.slice(0, 2) : symbol;
}

/** Monogram type size as a fraction of the tile, tuned so the widest text still leaves a margin: 2 letters 0.44, 3 letters 0.31, 4 or more 0.25. */
export function monogramScale(text: string): number {
  return text.length <= 2 ? 0.44 : text.length === 3 ? 0.31 : 0.25;
}

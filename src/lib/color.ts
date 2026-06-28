/** #rrggbb -> rgba() with the given alpha. Tiny, dataset-free util so client
 *  components can import it without pulling in any data module. */
export function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substr(0, 2), 16);
  const g = parseInt(h.substr(2, 2), 16);
  const b = parseInt(h.substr(4, 2), 16);
  return `rgba(${r},${g},${b},${a})`;
}

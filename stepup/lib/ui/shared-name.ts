export interface SharedNameSnapshot {
  text: string;
  left: number; top: number; width: number; height: number;
  font: string; color: string; fontSize: string;
}
export const SHARED_NAME_EVENT = "tf-shared-name";
export function captureSharedName(element: Element | null): SharedNameSnapshot | null {
  if (!(element instanceof HTMLElement) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  const box = element.getBoundingClientRect(), text = element.textContent?.trim();
  if (!text || !box.width || !box.height) return null;
  const style = getComputedStyle(element);
  return { text, left: box.left, top: box.top, width: box.width, height: box.height, font: style.font, color: style.color, fontSize: style.fontSize };
}
export function startSharedName(snapshot: SharedNameSnapshot | null, destination: string) {
  if (snapshot) window.dispatchEvent(new CustomEvent(SHARED_NAME_EVENT, { detail: { snapshot, destination } }));
}

// Reemplazo mínimo de `react` para cargar (sin ejecutarlos) los módulos del original que declaran hooks: las pruebas de reglas y servicios nunca llaman a un hook.
const unavailable = (name: string): never => {
  throw new Error(`${name} no está disponible fuera de React`);
};
export function useState<S = any>(_initial?: S | (() => S)): [S, (value: S | ((previous: S) => S)) => void] {
  return unavailable("useState");
}
export function useEffect(_effect: () => any, _deps?: readonly unknown[]): void {
  unavailable("useEffect");
}
export function useCallback<T extends (...args: any[]) => any>(_callback: T, _deps: readonly unknown[]): T {
  return unavailable("useCallback");
}
export function useMemo<T>(_factory: () => T, _deps: readonly unknown[]): T {
  return unavailable("useMemo");
}
export function useRef<T = any>(_initial?: T): { current: T } {
  return unavailable("useRef");
}
export function useReducer<S = any, A = any>(_reducer: (state: S, action: A) => S, _initial: S): [S, (action?: A) => void] {
  return unavailable("useReducer");
}
export type ReactNode = unknown;
export default {};

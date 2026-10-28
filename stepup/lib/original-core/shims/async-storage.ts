// Reemplazo en memoria de `@react-native-async-storage/async-storage` para ejecutar las pruebas del original (almacenes y servicios) sin dispositivo.
const memory = new Map<string, string>();
const AsyncStorage = {
  async getItem(key: string): Promise<string | null> {
    return memory.has(key) ? (memory.get(key) as string) : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    memory.set(key, value);
  },
  async removeItem(key: string): Promise<void> {
    memory.delete(key);
  },
  async multiGet(keys: readonly string[]): Promise<[string, string | null][]> {
    return keys.map((key) => [key, memory.has(key) ? (memory.get(key) as string) : null]);
  },
  async multiSet(pairs: readonly (readonly [string, string])[]): Promise<void> {
    pairs.forEach(([key, value]) => memory.set(key, value));
  },
  async multiRemove(keys: readonly string[]): Promise<void> {
    keys.forEach((key) => memory.delete(key));
  },
  async getAllKeys(): Promise<string[]> {
    return [...memory.keys()];
  },
  async clear(): Promise<void> {
    memory.clear();
  },
};
export default AsyncStorage;

// Mock for @react-native-async-storage/async-storage used in jest tests.
// The real module is backed by a native TurboModule, which is unavailable under jest.
// This in-memory shim implements the small subset of the API the app uses.
let store = new Map();

const AsyncStorage = {
  getItem: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
  setItem: jest.fn(async (key, value) => {
    store.set(key, String(value));
  }),
  removeItem: jest.fn(async (key) => {
    store.delete(key);
  }),
  clear: jest.fn(async () => {
    store = new Map();
  }),
  getAllKeys: jest.fn(async () => Array.from(store.keys())),
  multiGet: jest.fn(async (keys) =>
    keys.map((k) => [k, store.has(k) ? store.get(k) : null]),
  ),
  multiSet: jest.fn(async (pairs) => {
    for (const [k, v] of pairs) store.set(k, String(v));
  }),
  multiRemove: jest.fn(async (keys) => {
    for (const k of keys) store.delete(k);
  }),
};

module.exports = AsyncStorage;
module.exports.default = AsyncStorage;

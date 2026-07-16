// Mock for @shopify/react-native-skia used in jest tests.
// The real module registers a native TurboModule, which is unavailable under jest.
module.exports = {
  Canvas: () => null,
  Group: ({ children }) => children,
  Image: () => null,
  Path: () => null,
  Skia: {
    Path: { Make: () => ({ moveTo: () => undefined, lineTo: () => undefined, close: () => undefined }) },
    Color: () => undefined,
  },
  useComputedValue: () => ({ current: undefined }),
  useValue: () => ({ current: undefined }),
  matchFont: () => undefined,
};

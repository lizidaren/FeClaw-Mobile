// Mock for react-native-gesture-handler used in jest tests.
// The real module registers a native TurboModule, which is unavailable under jest.
const passthrough = () => ({ children }) => children;
module.exports = {
  GestureDetector: passthrough(),
  Gesture: {
    Pan: () => ({ onUpdate: () => ({ onEnd: () => undefined }) }),
    Tap: () => ({ onEnd: () => undefined }),
  },
  GestureHandlerRootView: passthrough(),
  PanGestureHandler: passthrough(),
  TapGestureHandler: passthrough(),
  State: { BEGAN: 'BEGAN', ACTIVE: 'ACTIVE', END: 'END' },
  Directions: { RIGHT: 1, LEFT: 2, UP: 4, DOWN: 8 },
};

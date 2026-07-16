// Mock for react-native-image-picker used in jest tests.
// The real module ships as TypeScript and would otherwise fail to parse.
module.exports = {
  launchCamera: jest.fn(async () => ({ didCancel: true })),
  launchImageLibrary: jest.fn(async () => ({ didCancel: true })),
};

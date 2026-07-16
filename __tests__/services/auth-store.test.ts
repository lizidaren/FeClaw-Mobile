jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));

import { authStore } from '../../src/services/auth-store';

describe('authStore', () => {
  it('has isInitialized and isLoggedIn getters', () => {
    expect(typeof authStore.isInitialized).toBe('function');
    expect(typeof authStore.isLoggedIn).toBe('function');
    expect(typeof authStore.getToken).toBe('function');
    expect(typeof authStore.logout).toBe('function');
  });

  it('hydrate sets initialized', async () => {
    await authStore.hydrate();
    expect(authStore.isInitialized()).toBe(true);
  });

  it('logout clears token', async () => {
    await authStore.logout();
    expect(authStore.isLoggedIn()).toBe(false);
    expect(authStore.getToken()).toBeNull();
  });
});

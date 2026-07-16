import { zentrimStore } from '../../src/services/zentrim-store';

describe('zentrimStore', () => {
  beforeEach(() => {
    zentrimStore.reset();
  });

  it('starts with empty state', () => {
    const state = zentrimStore.getState();
    expect(state.entries).toEqual([]);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('fetchEntries loads entries', async () => {
    const mockEntries = [
      { id: '1', title: '笔记一', created_at: '2026-07-16T10:00:00Z', status: 'active' },
    ];
    const apiModule = require('../../src/services/api-client');
    // getEntries returns { items: [...] }
    jest.spyOn(apiModule.api, 'getEntries').mockResolvedValueOnce({ items: mockEntries, total: 1, page: 1, page_size: 20 });

    await zentrimStore.fetchEntries();

    const state = zentrimStore.getState();
    expect(state.entries).toEqual(mockEntries);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('fetchEntries sets error on failure', async () => {
    const apiModule = require('../../src/services/api-client');
    jest.spyOn(apiModule.api, 'getEntries').mockRejectedValueOnce(new Error('Network down'));

    await zentrimStore.fetchEntries();

    const state = zentrimStore.getState();
    expect(state.error).toBe('Network down');
    expect(state.loading).toBe(false);
  });

  it('reset clears all state', () => {
    // Directly set internal state via a fetchEntries call
    zentrimStore.reset();
    expect(zentrimStore.getState()).toEqual({ entries: [], loading: false, error: null });
  });
});

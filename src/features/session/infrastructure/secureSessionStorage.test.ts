import * as SecureStore from 'expo-secure-store';
import {
  deleteSessionToken,
  deleteSessionTokens,
  readSessionToken,
  readSessionTokens,
  saveSessionToken,
  saveSessionTokens,
} from './secureSessionStorage';

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}), { virtual: true });

const mockedSecureStore = jest.mocked(SecureStore);

beforeEach(() => jest.clearAllMocks());

test('session token lifecycle uses SecureStore and no raw error detail escapes', async () => {
  mockedSecureStore.setItemAsync.mockResolvedValue(undefined);
  mockedSecureStore.getItemAsync.mockResolvedValue('synthetic-session-token');
  mockedSecureStore.deleteItemAsync.mockResolvedValue(undefined);

  await saveSessionToken('synthetic-session-token');
  await expect(readSessionToken()).resolves.toBe('synthetic-session-token');
  await deleteSessionToken();

  expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
    'campusops.session.access-token',
    'synthetic-session-token',
  );
  expect(mockedSecureStore.getItemAsync).toHaveBeenCalledWith('campusops.session.access-token');
  expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('campusops.session.access-token');
  expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('campusops.session.refresh-token');

  mockedSecureStore.setItemAsync.mockRejectedValueOnce(new Error('synthetic-session-token leaked'));
  await expect(saveSessionToken('synthetic-session-token')).rejects.toThrow(
    'Unable to save the session securely.',
  );
});

test('stores and clears the access and refresh tokens as one session', async () => {
  const tokens = { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh' };
  mockedSecureStore.setItemAsync.mockResolvedValue(undefined);
  mockedSecureStore.getItemAsync
    .mockResolvedValueOnce(tokens.accessToken)
    .mockResolvedValueOnce(tokens.refreshToken);
  mockedSecureStore.deleteItemAsync.mockResolvedValue(undefined);

  await saveSessionTokens(tokens);
  await expect(readSessionTokens()).resolves.toEqual(tokens);
  await deleteSessionTokens();

  expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith('campusops.session.access-token', tokens.accessToken);
  expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith('campusops.session.refresh-token', tokens.refreshToken);
  expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('campusops.session.access-token');
  expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('campusops.session.refresh-token');
});

test('a partial pair is not considered an authenticated session', async () => {
  mockedSecureStore.getItemAsync
    .mockResolvedValueOnce('synthetic-access')
    .mockResolvedValueOnce(null);

  await expect(readSessionTokens()).resolves.toBeNull();
});

test('deleting the session makes both persisted token reads return null', async () => {
  const stored = new Map<string, string>();
  mockedSecureStore.setItemAsync.mockImplementation(async (key, value) => {
    stored.set(key, value);
  });
  mockedSecureStore.getItemAsync.mockImplementation(async (key) => stored.get(key) ?? null);
  mockedSecureStore.deleteItemAsync.mockImplementation(async (key) => {
    stored.delete(key);
  });

  await saveSessionTokens({ accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh' });
  await deleteSessionTokens();

  await expect(readSessionTokens()).resolves.toBeNull();
  expect(stored.size).toBe(0);
});

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

test('session token pair is saved, read, and cleared together', async () => {
  const tokens = { accessToken: 'synthetic-access-token', refreshToken: 'synthetic-refresh-token' };
  mockedSecureStore.setItemAsync.mockResolvedValue(undefined);
  mockedSecureStore.getItemAsync
    .mockResolvedValueOnce(tokens.accessToken)
    .mockResolvedValueOnce(tokens.refreshToken);
  mockedSecureStore.deleteItemAsync.mockResolvedValue(undefined);

  await saveSessionTokens(tokens);
  await expect(readSessionTokens()).resolves.toEqual(tokens);
  await deleteSessionTokens();

  expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
    'campusops.session.access-token',
    tokens.accessToken,
  );
  expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
    'campusops.session.refresh-token',
    tokens.refreshToken,
  );
  expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('campusops.session.access-token');
  expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('campusops.session.refresh-token');
});

test('a partial token pair is treated as no persisted session', async () => {
  mockedSecureStore.getItemAsync
    .mockResolvedValueOnce('synthetic-access-token')
    .mockResolvedValueOnce(null);

  await expect(readSessionTokens()).resolves.toBeNull();
});

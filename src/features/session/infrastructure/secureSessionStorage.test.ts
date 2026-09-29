import * as SecureStore from 'expo-secure-store';
import { deleteSessionToken, readSessionToken, saveSessionToken } from './secureSessionStorage';

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

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

  mockedSecureStore.setItemAsync.mockRejectedValueOnce(new Error('synthetic-session-token leaked'));
  await expect(saveSessionToken('synthetic-session-token')).rejects.toThrow(
    'Unable to save the session securely.',
  );
});

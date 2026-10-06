import * as SecureStore from 'expo-secure-store';

const ACCESS_TOKEN_KEY = 'campusops.session.access-token';
const REFRESH_TOKEN_KEY = 'campusops.session.refresh-token';

export type SessionTokens = Readonly<{ accessToken: string; refreshToken: string }>;

export type SessionTokenStore = Readonly<{
  readSessionTokens(): Promise<SessionTokens | null>;
  saveSessionTokens(tokens: SessionTokens): Promise<void>;
  deleteSessionTokens(): Promise<void>;
}>;

/** Persists only the session token in the operating system's secure store. */
export async function saveSessionToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, token);
  } catch {
    throw new Error('Unable to save the session securely.');
  }
}

export async function readSessionToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  } catch {
    throw new Error('Unable to read the session securely.');
  }
}

export async function saveSessionTokens(tokens: SessionTokens): Promise<void> {
  try {
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken);
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken);
  } catch {
    await Promise.allSettled([
      SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    ]);
    throw new Error('Unable to save the session securely.');
  }
}

export async function readSessionTokens(): Promise<SessionTokens | null> {
  try {
    const [accessToken, refreshToken] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
    ]);
    if (!accessToken || !refreshToken) return null;
    return { accessToken, refreshToken };
  } catch {
    throw new Error('Unable to read the session securely.');
  }
}

export async function deleteSessionTokens(): Promise<void> {
  const results = await Promise.allSettled([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
  ]);
  if (results.some((result) => result.status === 'rejected')) {
    throw new Error('Unable to clear the session securely.');
  }
}

export async function deleteSessionToken(): Promise<void> {
  await deleteSessionTokens();
}

export const secureSessionTokenStore: SessionTokenStore = {
  readSessionTokens,
  saveSessionTokens,
  deleteSessionTokens,
};

import * as SecureStore from 'expo-secure-store';

const SESSION_TOKEN_KEY = 'campusops.session.access-token';

/** Persists only the session token in the operating system's secure store. */
export async function saveSessionToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
  } catch {
    throw new Error('Unable to save the session securely.');
  }
}

export async function readSessionToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(SESSION_TOKEN_KEY);
  } catch {
    throw new Error('Unable to read the session securely.');
  }
}

export async function deleteSessionToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
  } catch {
    throw new Error('Unable to clear the session securely.');
  }
}

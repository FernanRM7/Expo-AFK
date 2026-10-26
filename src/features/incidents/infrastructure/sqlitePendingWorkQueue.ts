import { openDatabaseAsync } from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

import type { PendingWorkEntry, PendingWorkQueue } from '../domain/pendingWorkQueue';
import { CURRENT_SCHEMA_VERSION, LocalStore } from '../../../persistence/localStore';

const DATABASE_NAME = 'campusops-offline.db';
export const CURRENT_QUEUE_SCHEMA_VERSION = CURRENT_SCHEMA_VERSION;

/** SQLite outbox backed by the versioned store and its legacy queue migration. */
export class SQLitePendingWorkQueue implements PendingWorkQueue {
  private readonly store: Promise<LocalStore>;

  constructor(
    database?: SQLiteDatabase,
    beforeVersionChange?: (from: number, to: number) => void,
  ) {
    if (database) {
      const store = new LocalStore(database);
      this.store = store.migrate(beforeVersionChange).then(() => store);
    } else {
      this.store = openDatabaseAsync(DATABASE_NAME).then(async (opened) => {
        const store = new LocalStore(opened);
        await store.migrate(beforeVersionChange);
        return store;
      });
    }
  }

  async enqueue(entry: PendingWorkEntry): Promise<void> {
    await (await this.store).enqueue(entry);
  }

  async list(): Promise<readonly PendingWorkEntry[]> {
    return (await this.store).list();
  }

  async update(entry: PendingWorkEntry): Promise<void> {
    await (await this.store).update(entry);
  }

  async remove(operationId: string): Promise<void> {
    await (await this.store).remove(operationId);
  }
}

let defaultQueue: Promise<PendingWorkQueue> | undefined;

export function getSQLitePendingWorkQueue(): Promise<PendingWorkQueue> {
  defaultQueue ??= Promise.resolve(new SQLitePendingWorkQueue());
  return defaultQueue;
}

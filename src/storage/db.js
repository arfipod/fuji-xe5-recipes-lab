// @ts-check

const DB_NAME = 'fuji-xe5-recipes-lab';
const DB_VERSION = 1;

export class LabStore {
  constructor() {
    this.dbPromise = null;
    this.memory = {
      recipes: new Map(),
      slotBackups: new Map(),
      fullBackups: new Map(),
      settings: new Map(),
      images: new Map(),
    };
  }

  async open() {
    if (this.dbPromise) return this.dbPromise;
    if (typeof indexedDB === 'undefined') {
      this.dbPromise = Promise.resolve(null);
      return null;
    }
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed.'));
      request.onupgradeneeded = () => {
        const db = request.result;
        createStore(db, 'recipes', 'id');
        createStore(db, 'slotBackups', 'slotId');
        createStore(db, 'fullBackups', 'cameraKey');
        createStore(db, 'settings', 'key');
        createStore(db, 'images', 'id');
      };
      request.onsuccess = () => resolve(request.result);
    });
    return this.dbPromise;
  }

  /** @param {any} recipe */
  async saveRecipe(recipe) {
    return this.put('recipes', recipe);
  }

  async listRecipes() {
    return this.getAll('recipes');
  }

  /** @param {string} id */
  async deleteRecipe(id) {
    return this.delete('recipes', id);
  }

  /** @param {any} backup */
  async saveSlotBackup(backup) {
    return this.put('slotBackups', backup);
  }

  async listSlotBackups() {
    return this.getAll('slotBackups');
  }

  /** @param {string} slotId */
  async getSlotBackup(slotId) {
    return this.get('slotBackups', slotId);
  }

  /** @param {any} backup */
  async saveFullBackup(backup) {
    return this.put('fullBackups', backup);
  }

  async listFullBackups() {
    return this.getAll('fullBackups');
  }

  /** @param {string} cameraKey */
  async getFullBackup(cameraKey) {
    return this.get('fullBackups', cameraKey);
  }

  /** @param {string} key @param {any} value */
  async setSetting(key, value) {
    return this.put('settings', { key, value });
  }

  /** @param {string} key @param {any} fallback */
  async getSetting(key, fallback = null) {
    const item = await this.get('settings', key);
    return item?.value ?? fallback;
  }

  /** @param {string} id @param {Blob} blob @param {Record<string, any>} [metadata] */
  async saveImage(id, blob, metadata = {}) {
    return this.put('images', { id, blob, metadata, savedAt: new Date().toISOString() });
  }

  /** @param {string} id */
  async getImage(id) {
    return this.get('images', id);
  }

  /** @param {'recipes'|'slotBackups'|'fullBackups'|'settings'|'images'} storeName @param {any} value */
  async put(storeName, value) {
    const db = await this.open();
    if (!db) {
      const key = value[idKeyFor(storeName)];
      this.memory[storeName].set(key, structuredClone(value));
      return value;
    }
    return transactionPromise(db, storeName, 'readwrite', (store) => store.put(value));
  }

  /** @param {'recipes'|'slotBackups'|'fullBackups'|'settings'|'images'} storeName @param {IDBValidKey} key */
  async get(storeName, key) {
    const db = await this.open();
    if (!db) return structuredClone(this.memory[storeName].get(key) ?? null);
    return requestPromise(db.transaction(storeName, 'readonly').objectStore(storeName).get(key));
  }

  /** @param {'recipes'|'slotBackups'|'fullBackups'|'settings'|'images'} storeName */
  async getAll(storeName) {
    const db = await this.open();
    if (!db) return [...this.memory[storeName].values()].map((value) => structuredClone(value));
    return requestPromise(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
  }

  /** @param {'recipes'|'slotBackups'|'fullBackups'|'settings'|'images'} storeName @param {IDBValidKey} key */
  async delete(storeName, key) {
    const db = await this.open();
    if (!db) return this.memory[storeName].delete(key);
    return transactionPromise(db, storeName, 'readwrite', (store) => store.delete(key));
  }
}

/** @param {IDBDatabase} db @param {string} name @param {string} keyPath */
function createStore(db, name, keyPath) {
  if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
}

/** @param {IDBRequest} request */
function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

/**
 * @param {IDBDatabase} db
 * @param {string} storeName
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => IDBRequest} operation
 */
function transactionPromise(db, storeName, mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error ?? request.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });
}

/** @param {string} storeName */
function idKeyFor(storeName) {
  return ({ recipes: 'id', slotBackups: 'slotId', fullBackups: 'cameraKey', settings: 'key', images: 'id' })[storeName];
}

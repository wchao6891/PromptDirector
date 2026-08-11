const DATABASE_NAME = "prompt-director-sync";
const DATABASE_VERSION = 1;
const STORE_NAME = "private-sync";
const DIRECTORY_KEY = "directory";
const CRYPTO_KEY = "crypto-key";

let databasePromise;

export async function saveSyncDirectoryHandle(handle) {
  if (!handle || handle.kind !== "directory") throw new Error("没有选择有效的同步文件夹");
  await putValue(DIRECTORY_KEY, handle);
}

export async function getSyncDirectoryHandle() {
  const value = await getValue(DIRECTORY_KEY);
  return value?.kind === "directory" ? value : null;
}

export async function saveSyncCryptoKey(key) {
  if (!key || key.type !== "secret" || key.extractable) {
    throw new Error("同步密钥必须是不可导出的浏览器密钥");
  }
  await putValue(CRYPTO_KEY, key);
}

export async function getSyncCryptoKey() {
  const value = await getValue(CRYPTO_KEY);
  return value?.type === "secret" ? value : null;
}

export async function clearSyncPrivateState() {
  const transaction = (await openDatabase()).transaction(STORE_NAME, "readwrite");
  const complete = transactionAsPromise(transaction);
  transaction.objectStore(STORE_NAME).clear();
  await complete;
}

async function putValue(key, value) {
  const transaction = (await openDatabase()).transaction(STORE_NAME, "readwrite");
  const complete = transactionAsPromise(transaction);
  transaction.objectStore(STORE_NAME).put(value, key);
  await complete;
}

async function getValue(key) {
  return requestAsPromise(
    (await openDatabase()).transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key)
  );
}

function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("无法打开本机同步配置"));
      request.onblocked = () => reject(new Error("同步配置正在被其他页面占用"));
    });
  }
  return databasePromise;
}

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法读取本机同步配置"));
  });
}

function transactionAsPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("本机同步配置保存已取消"));
    transaction.onerror = () => reject(transaction.error || new Error("无法保存本机同步配置"));
  });
}

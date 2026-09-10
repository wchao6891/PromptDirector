const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export const SYNC_VAULT_FORMAT = "prompt-director-vault";
export const SYNC_VAULT_VERSION = 1;
export const PBKDF2_ITERATIONS = 600_000;

export async function createVaultHeader(password) {
  validatePassword(password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveVaultKey(password, salt, PBKDF2_ITERATIONS);
  const verification = await encryptBytes(encoder.encode("PromptDirector vault check v1"), key);
  return {
    key,
    header: {
      format: SYNC_VAULT_FORMAT,
      version: SYNC_VAULT_VERSION,
      vaultId: `vault:${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
      kdf: {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: PBKDF2_ITERATIONS,
        salt: toBase64(salt)
      },
      cipher: { name: "AES-GCM", length: 256 },
      verification
    }
  };
}

export async function unlockVaultHeader(value, password) {
  const header = normalizeVaultHeader(value);
  validatePassword(password);
  const key = await deriveVaultKey(
    password,
    fromBase64(header.kdf.salt),
    header.kdf.iterations
  );
  try {
    const plain = await decryptBytes(header.verification, key);
    if (decoder.decode(plain) !== "PromptDirector vault check v1") throw new Error();
  } catch {
    throw new Error("同步库密码不正确，或同步库已损坏");
  }
  return { header, key };
}

export async function verifyVaultKey(value, key) {
  const header = normalizeVaultHeader(value);
  requireCryptoKey(key);
  try {
    const plain = await decryptBytes(header.verification, key);
    if (decoder.decode(plain) !== "PromptDirector vault check v1") throw new Error();
  } catch {
    throw new Error("本机缓存的同步密钥已经失效，请重新输入密码");
  }
  return header;
}

export async function encryptVaultValue(value, key) {
  requireCryptoKey(key);
  return encryptBytes(encoder.encode(JSON.stringify(value)), key);
}

export async function decryptVaultValue(value, key) {
  requireCryptoKey(key);
  try {
    const bytes = await decryptBytes(value, key);
    return JSON.parse(decoder.decode(bytes));
  } catch {
    throw new Error("无法解密同步数据：密码不正确或文件已损坏");
  }
}

export async function encryptVaultBlob(blob, key) {
  if (!(blob instanceof Blob)) throw new Error("待同步图片无效");
  requireCryptoKey(key);
  const encrypted = await encryptBytes(new Uint8Array(await blob.arrayBuffer()), key);
  return {
    ...encrypted,
    contentType: blob.type || "application/octet-stream",
    byteSize: blob.size
  };
}

export async function decryptVaultBlob(value, key) {
  requireCryptoKey(key);
  try {
    const bytes = await decryptBytes(value, key);
    return new Blob([bytes], { type: String(value?.contentType ?? "application/octet-stream") });
  } catch {
    throw new Error("无法解密同步图片：密码不正确或文件已损坏");
  }
}

export async function sha256Hex(value) {
  const bytes = value instanceof Blob
    ? new Uint8Array(await value.arrayBuffer())
    : value instanceof Uint8Array
      ? value
      : encoder.encode(String(value ?? ""));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function deriveVaultKey(password, salt, iterations) {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey({
    name: "PBKDF2",
    hash: "SHA-256",
    salt,
    iterations
  }, material, {
    name: "AES-GCM",
    length: 256
  }, false, ["encrypt", "decrypt"]);
}

async function encryptBytes(bytes, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherText = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  return {
    version: 1,
    iv: toBase64(iv),
    cipherText: toBase64(new Uint8Array(cipherText))
  };
}

async function decryptBytes(value, key) {
  if (value?.version !== 1) throw new Error("不支持的加密数据版本");
  const iv = fromBase64(value.iv);
  if (iv.byteLength !== 12) throw new Error("加密数据 IV 无效");
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    fromBase64(value.cipherText)
  ));
}

function normalizeVaultHeader(value) {
  if (value?.format !== SYNC_VAULT_FORMAT || value.version !== SYNC_VAULT_VERSION ||
      value.kdf?.name !== "PBKDF2" || value.kdf.hash !== "SHA-256" ||
      value.kdf.iterations !== PBKDF2_ITERATIONS ||
      value.cipher?.name !== "AES-GCM" || value.cipher.length !== 256 ||
      typeof value.kdf.salt !== "string" || !value.verification) {
    throw new Error("这不是受支持的 PromptDirector 加密同步库");
  }
  return structuredClone(value);
}

function validatePassword(value) {
  if (typeof value !== "string" || value.length < 8) {
    throw new Error("同步密码至少需要 8 个字符");
  }
}

function requireCryptoKey(value) {
  if (!value || value.type !== "secret" || value.algorithm?.name !== "AES-GCM") {
    throw new Error("同步库尚未解锁");
  }
}

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  if (typeof value !== "string" || !value) throw new Error("加密数据编码无效");
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

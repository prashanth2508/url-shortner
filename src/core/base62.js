/**
 * Base62 Bi-directional Encoder & Decoder
 *
 * In a distributed URL shortener, we convert a 64-bit auto-incrementing
 * or ticket-server allocated integer ID into a compact URL-safe slug.
 *
 * Base62 uses [0-9, a-z, A-Z] (62 alphanumeric characters, zero punctuation).
 * 62^7 = 3,521,614,606,208 (> 3.5 Trillion unique URLs with just 7 characters).
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BASE = BigInt(62);
const CHAR_MAP = new Map();

for (let i = 0; i < ALPHABET.length; i++) {
  CHAR_MAP.set(ALPHABET[i], BigInt(i));
}

/**
 * Encode a numeric ID (Number or BigInt) to a Base62 string.
 * @param {number|bigint} num
 * @param {number} minLength - Optional padding to guarantee uniform slug lengths
 * @returns {string}
 */
export function encodeBase62(num, minLength = 6) {
  let n = BigInt(num);
  if (n === 0n) {
    return ALPHABET[0].repeat(minLength || 1);
  }

  let result = '';
  while (n > 0n) {
    const remainder = Number(n % BASE);
    result = ALPHABET[remainder] + result;
    n = n / BASE;
  }

  // Optional left-padding for consistent short URL lengths
  if (minLength && result.length < minLength) {
    result = ALPHABET[0].repeat(minLength - result.length) + result;
  }

  return result;
}

/**
 * Decode a Base62 string back into its original BigInt ID.
 * @param {string} str
 * @returns {bigint}
 */
export function decodeBase62(str) {
  let result = 0n;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const val = CHAR_MAP.get(char);
    if (val === undefined) {
      throw new Error(`Invalid Base62 character: "${char}"`);
    }
    result = result * BASE + val;
  }
  return result;
}

/**
 * Validate whether a custom alias only contains valid Base62 / URL-safe characters.
 * @param {string} alias
 * @returns {boolean}
 */
export function isValidSlug(alias) {
  // Allow alphanumeric, hyphen and underscore, 3-30 chars
  return /^[a-zA-Z0-9_-]{3,30}$/.test(alias);
}

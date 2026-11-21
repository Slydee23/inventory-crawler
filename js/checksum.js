// Checksum used by Vampire Crawlers save files:
//   base64( SHA-1( UTF-8( Data serialized alone, 2-space indent, CRLF ) ) )
// See docs/SAVE_FORMAT.md.

import { stringify } from './json-lossless.js';

/** Text that the game hashes for a given `Data` node. */
export function checksumInput(dataNode) {
  return stringify(dataNode, { indent: '  ', newline: '\r\n' });
}

/**
 * @param {any} dataNode lossless `Data` node
 * @returns {Promise<string>} base64 SHA-1
 */
export async function computeChecksum(dataNode) {
  const bytes = new TextEncoder().encode(checksumInput(dataNode));
  const digest = await globalThis.crypto.subtle.digest('SHA-1', bytes);
  return bytesToBase64(new Uint8Array(digest));
}

function bytesToBase64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

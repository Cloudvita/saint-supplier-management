// @ts-check

/**
 * Engineering text files (STEP, STEP XML) are nominally ISO 8859-1 with
 * non-ASCII escaped, but real exporters also write raw UTF-8. Decode as
 * UTF-8 when the bytes are valid UTF-8, else as Latin-1, so neither kind is
 * mangled.
 *
 * @param {Uint8Array} data
 */
export function decodeText(data) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return new TextDecoder("latin1").decode(data);
  }
}

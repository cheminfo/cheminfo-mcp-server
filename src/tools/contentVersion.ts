/**
 * A short version of some content, which changes when it does: 12 hex of
 * its SHA-256, with the global Web Crypto, so the same code runs in a
 * browser.
 * @param text - The content.
 * @returns 12 hex digits.
 */
export async function contentVersion(text: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  );
  let hex = '';
  for (let index = 0; index < 6; index++) {
    hex += (digest[index] ?? 0).toString(16).padStart(2, '0');
  }
  return hex;
}

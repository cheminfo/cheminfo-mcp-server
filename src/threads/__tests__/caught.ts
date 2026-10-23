/**
 * Why a call was rejected, read without chaining on its promise.
 * @param promise - The call.
 * @returns The rejection, or `undefined` when it answered.
 */
export async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

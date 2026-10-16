/** Byte-bounded UTF-8 tail storage for browser subprocess diagnostics. */

function decodeUtf8Tail(buffer: Buffer): string {
  let start = 0;
  while (start < buffer.length && (buffer[start] & 0b1100_0000) === 0b1000_0000) {
    start += 1;
  }
  return buffer.subarray(start).toString("utf8");
}

export function decodeBoundedUtf8Tail(buffer: Buffer, maxBytes: number): string {
  if (maxBytes <= 0 || buffer.length === 0) {
    return "";
  }
  const tail = buffer.length > maxBytes ? buffer.subarray(buffer.length - maxBytes) : buffer;
  return decodeUtf8Tail(tail);
}

export function createBoundedUtf8Tail(maxBytes: number) {
  const storage = Buffer.allocUnsafe(Math.max(0, maxBytes));
  // Ring buffer: `start` is the offset of the oldest retained byte, valid
  // bytes run `totalBytes` forward from it (wrapping past the end of
  // `storage`). Appending a small chunk after the cap fills no longer
  // shifts the whole retained buffer -- only evicted/written bytes move, so
  // repeated small appends (e.g. noisy subprocess stderr) cost O(chunk
  // length) instead of O(maxBytes) each.
  let start = 0;
  let totalBytes = 0;

  return {
    append(chunk: Buffer | string) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (buffer.length === 0 || maxBytes <= 0) {
        return;
      }
      if (buffer.length >= maxBytes) {
        buffer.copy(storage, 0, buffer.length - maxBytes);
        start = 0;
        totalBytes = maxBytes;
        return;
      }

      const overflowBytes = Math.max(0, totalBytes + buffer.length - maxBytes);
      if (overflowBytes > 0) {
        start = (start + overflowBytes) % maxBytes;
        totalBytes -= overflowBytes;
      }
      const writePos = (start + totalBytes) % maxBytes;
      const firstPartLen = Math.min(buffer.length, maxBytes - writePos);
      buffer.copy(storage, writePos, 0, firstPartLen);
      if (firstPartLen < buffer.length) {
        buffer.copy(storage, 0, firstPartLen, buffer.length);
      }
      totalBytes += buffer.length;
    },
    text() {
      if (start + totalBytes <= maxBytes) {
        return decodeUtf8Tail(storage.subarray(start, start + totalBytes));
      }
      const wrapped = Buffer.concat([
        storage.subarray(start, maxBytes),
        storage.subarray(0, start + totalBytes - maxBytes),
      ]);
      return decodeUtf8Tail(wrapped);
    },
    clear() {
      start = 0;
      totalBytes = 0;
    },
  };
}

const decoder = new TextDecoder();
const MAX_FRAME = 2 * 1024 * 1024;

/** The AI server supplies Content-Length for every multipart JPEG. */
export class MjpegParser {
  private pending: Uint8Array = new Uint8Array();

  push(chunk: Uint8Array): Uint8Array[] {
    if (this.pending.length + chunk.length > MAX_FRAME * 2) throw new Error("Video frame too large");
    const joined = new Uint8Array(this.pending.length + chunk.length);
    joined.set(this.pending); joined.set(chunk, this.pending.length);
    this.pending = joined;
    const frames: Uint8Array[] = [];
    while (this.pending.length) {
      let end = -1;
      for (let i = 0; i + 3 < this.pending.length; i++) {
        if (this.pending[i] === 13 && this.pending[i + 1] === 10 && this.pending[i + 2] === 13 && this.pending[i + 3] === 10) { end = i; break; }
      }
      if (end < 0) {
        if (this.pending.length > 4096) throw new Error("Invalid video headers");
        break;
      }
      if (end > 4096) throw new Error("Invalid video headers");
      const header = decoder.decode(this.pending.subarray(0, end));
      const length = Number(header.match(/content-length:\s*(\d+)/i)?.[1]);
      if (!/content-type:\s*image\/jpeg/i.test(header) || !Number.isInteger(length) || length <= 0 || length > MAX_FRAME) throw new Error("Invalid video frame");
      const start = end + 4;
      if (this.pending.length < start + length) break;
      frames.push(this.pending.slice(start, start + length));
      this.pending = this.pending.slice(start + length);
    }
    return frames;
  }
}

export async function receiveMjpeg(response: Response, onFrame: (frame: Uint8Array) => void) {
  if (!response.headers.get("Content-Type")?.toLowerCase().startsWith("multipart/x-mixed-replace") || !response.body) throw new Error("Invalid video stream");
  const reader = response.body.getReader();
  const parser = new MjpegParser();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      const frames = parser.push(value);
      // Drop older frames if several arrive together; do not build a playback queue.
      if (frames.length) onFrame(frames[frames.length - 1]);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

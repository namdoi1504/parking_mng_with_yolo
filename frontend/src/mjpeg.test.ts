import { describe, expect, it } from "vitest";
import { MjpegParser } from "./mjpeg";

const encode = (text: string) => new TextEncoder().encode(text);
const packet = (jpeg: string) => encode(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n${jpeg}\r\n`);

describe("MJPEG transport", () => {
  it("reassembles headers and JPEG bytes split anywhere in network chunks", () => {
    const parser = new MjpegParser();
    const frames = [...packet("JPEG1")].flatMap((byte) => parser.push(new Uint8Array([byte])));
    expect(frames.map((f) => new TextDecoder().decode(f))).toEqual(["JPEG1"]);
  });
  it("extracts multiple frames and preserves an incomplete final frame", () => {
    const parser = new MjpegParser();
    const a = packet("FIRST"), b = packet("SECOND");
    const joined = new Uint8Array(a.length + b.length); joined.set(a); joined.set(b, a.length);
    expect(parser.push(joined.slice(0, -5)).map((f) => new TextDecoder().decode(f))).toEqual(["FIRST"]);
    expect(parser.push(joined.slice(-5)).map((f) => new TextDecoder().decode(f))).toEqual(["SECOND"]);
  });
  it("rejects malformed and oversized frames instead of buffering indefinitely", () => {
    expect(() => new MjpegParser().push(encode("--frame\r\nContent-Type: image/jpeg\r\n\r\n"))).toThrow();
    expect(() => new MjpegParser().push(encode("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: 99999999\r\n\r\n"))).toThrow();
  });
});

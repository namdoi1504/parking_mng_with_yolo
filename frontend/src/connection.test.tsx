import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectionBadge } from "./components";

describe("connection indicator", () => {
  it("uses the success state only when connected", () => {
    const html = renderToStaticMarkup(<ConnectionBadge state="connected" label="Đã kết nối" />);
    expect(html).toContain("connection-connected");
    expect(html).toContain('role="status"');
    expect(html).toContain("Đã kết nối");
  });
  it("uses warning styling when disconnected", () => {
    const html = renderToStaticMarkup(<ConnectionBadge state="disconnected" label="Mất kết nối" />);
    expect(html).toContain("connection-disconnected");
    expect(html).not.toContain("connection-connected");
  });
  it("does not show polling or demo data as a live connection", () => {
    for (const state of ["polling", "demo"] as const) {
      expect(renderToStaticMarkup(<ConnectionBadge state={state} label="Không trực tiếp" />)).not.toContain("connection-connected");
    }
  });
});

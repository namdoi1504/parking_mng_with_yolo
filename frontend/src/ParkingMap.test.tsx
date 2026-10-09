// @vitest-environment jsdom
import actualConfig from "../../AI/datasets/slots_config.json";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ParkingMap, mapGeometry } from "./ParkingMap";
import { demoMap } from "./demo";
import type { ParkingSlot } from "./types";
import * as routing from "./routing";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("parking map", () => {
  it("selects a slot using mouse and keyboard", () => {
    const select = vi.fn(); render(<ParkingMap slots={demoMap.slots} onSelect={select} />);
    const first = screen.getByRole("button", { name: "Ô A-01, Camera 1: Còn trống" });
    fireEvent.click(first); expect(select).toHaveBeenLastCalledWith(demoMap.slots[0]);
    fireEvent.keyDown(first, { key: "ArrowRight" }); expect(select).toHaveBeenLastCalledWith(demoMap.slots[1]);
    fireEvent.keyDown(first, { key: "Enter" }); expect(select).toHaveBeenLastCalledWith(demoMap.slots[0]);
  });
  it("filters without removing the spatial context and resets zoom", () => {
    render(<ParkingMap slots={demoMap.slots} onSelect={() => {}} />);
    fireEvent.change(screen.getByLabelText("Tìm ô trên bản đồ"), { target: { value: "A-01" } });
    expect(screen.getByText("1/40 ô phù hợp")).toBeTruthy();
    expect(document.querySelectorAll(".map-slot")).toHaveLength(40);
    expect(document.querySelectorAll(".map-slot.dimmed")).toHaveLength(39);
    fireEvent.click(screen.getByRole("button", { name: "Phóng to bản đồ" }));
    expect(screen.getByText("150%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Đưa bản đồ về kích thước ban đầu" }));
    expect(screen.getByText("100%")).toBeTruthy();
  });
  it("keeps counts clear when no filter matches", () => {
    render(<ParkingMap slots={demoMap.slots} onSelect={() => {}} />);
    fireEvent.change(screen.getByLabelText("Tìm ô trên bản đồ"), { target: { value: "missing" } });
    expect(screen.getByRole("status").textContent).toContain("Không có ô phù hợp");
  });
  it("falls back to selectable slots without coordinates", () => {
    render(<ParkingMap slots={[{ ...demoMap.slots[0], roi_coordinates: [] }]} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "A-01, Camera 1: Còn trống" })).toBeTruthy();
  });
  it("excludes invalid coordinates rather than drawing NaN", () => {
    expect(mapGeometry([{ ...demoMap.slots[0], roi_coordinates: [{ x: NaN, y: 1 }, { x: 0, y: 2 }, { x: 2, y: 3 }] }])).toBeNull();
  });
  it("supports all 470 real slot polygons without a fixed-size template", () => {
    const slots: ParkingSlot[] = actualConfig.map((s) => ({
      id: s.index + 1, camera_id: 1, slot_code: s.slot_code, status: "EMPTY", row: s.row, col: s.col,
      updated_at: new Date().toISOString(), roi_coordinates: s.points.map(([x, y]) => ({ x, y })),
    }));
    const geometry = mapGeometry(slots);
    expect(geometry?.valid).toHaveLength(470);
    expect(geometry?.viewBox).not.toMatch(/NaN|Infinity/);
    const routeCalculation = vi.spyOn(routing, "slotRoute");
    const { rerender } = render(<ParkingMap slots={slots} selectedId={470} onSelect={() => {}} />);
    expect(document.querySelector(".map-route-line")).not.toBeNull();
    const initialRoute = document.querySelector(".map-route-line")?.getAttribute("points");
    const initialCalculations = routeCalculation.mock.calls.length;
    // Polling replaces every object; another bay's state must not recalculate this route.
    const snapshot = slots.map((slot) => ({ ...slot, updated_at: "2026-10-08T12:00:00Z", status: slot.id === 1 ? "OCCUPIED" as const : slot.status,
      roi_coordinates: slot.roi_coordinates.map((point) => ({ ...point })) }));
    rerender(<ParkingMap slots={snapshot} selectedId={470} onSelect={() => {}} />);
    expect(document.querySelector(".map-route-line")?.getAttribute("points")).toBe(initialRoute);
    expect(routeCalculation).toHaveBeenCalledTimes(initialCalculations);
    fireEvent.click(screen.getByRole("checkbox", { name: /Đối chiếu ảnh gốc/ }));
    expect(document.querySelector("svg image")?.getAttribute("href")).toBe("/parking-site-reference.jpg");
    const changed = slots.map((s) => s.id === 470 ? { ...s, status: "OCCUPIED" as const } : s);
    rerender(<ParkingMap slots={changed} selectedId={470} onSelect={() => {}} />);
    expect(document.querySelector(".map-route-line")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("không trống");
    fireEvent.change(screen.getByLabelText("Hướng chỉ đường"), { target: { value: "exit" } });
    expect(document.querySelector(".map-route-line")).not.toBeNull();
  });
});

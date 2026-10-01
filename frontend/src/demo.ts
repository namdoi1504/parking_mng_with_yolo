import type { Camera, HourlyStat, ParkingMap, Permission, Role, User } from "./types";

const statuses = ["EMPTY", "OCCUPIED", "OCCUPIED", "RESERVED", "EMPTY", "UNKNOWN", "OCCUPIED", "OCCUPIED"] as const;
export const demoMap: ParkingMap = {
  summary: { total_slots: 40, empty_slots: 12, occupied_slots: 23, reserved_slots: 3, unknown_slots: 2, has_unknown_alert: true },
  slots: Array.from({ length: 40 }, (_, index) => {
    const col = index % 8;
    const row = Math.floor(index / 8);
    return {
      id: index + 1,
      camera_id: 1,
      slot_code: `A-${String(index + 1).padStart(2, "0")}`,
      status: statuses[index % statuses.length],
      col,
      row,
      roi_coordinates: [
        { x: 80 + col * 115, y: 80 + row * 115 },
        { x: 170 + col * 115, y: 80 + row * 115 },
        { x: 170 + col * 115, y: 180 + row * 115 },
        { x: 80 + col * 115, y: 180 + row * 115 }
      ],
      updated_at: new Date().toISOString()
    };
  })
};

export const demoCameras: Camera[] = [
  { id: 1, name: "CAM-01 (Khu A - Tầng hầm B1)", source_type: "VIDEO_FILE", source_url: "file://parking_car.mp4", status: "CONNECTED", created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
];

export const demoPermissions: Permission[] = [
  [1, "parking:view", "Xem bãi đỗ", "parking"], [2, "parking:manage", "Quản lý bãi đỗ", "parking"],
  [3, "camera:view", "Xem camera", "camera"], [4, "camera:manage", "Quản lý camera", "camera"],
  [5, "report:view", "Xem báo cáo", "report"], [6, "user:view", "Xem tài khoản", "user"],
  [7, "user:manage", "Quản lý tài khoản", "user"], [8, "role:manage", "Quản lý vai trò", "role"]
].map(([id, code, name, module]) => ({ id: id as number, code: code as string, name: name as string, module: module as string }));

export const demoRoles: Role[] = [
  { id: 1, name: "Administrator", description: "Toàn quyền cấu hình và quản trị hệ thống", created_at: new Date().toISOString(), permissions: demoPermissions },
  { id: 2, name: "Operator", description: "Giám sát trực tiếp và xử lý cảnh báo", created_at: new Date().toISOString(), permissions: demoPermissions.filter((p) => ["parking:view", "parking:manage", "camera:view"].includes(p.code)) },
  { id: 3, name: "Technician", description: "Quản lý nguồn camera và dữ liệu vị trí đỗ", created_at: new Date().toISOString(), permissions: demoPermissions.filter((p) => p.module === "camera" || p.code === "parking:manage") },
  { id: 4, name: "Security", description: "Theo dõi trạng thái bãi đỗ", created_at: new Date().toISOString(), permissions: demoPermissions.filter((p) => p.code === "parking:view") }
];

export const demoUsers: User[] = Array.from({ length: 18 }, (_, i) => ({
  id: i + 1, role_id: i < 3 ? 1 : i < 11 ? 2 : i < 15 ? 3 : 4,
  username: `user${i + 1}`, full_name: i === 0 ? "Nguyễn Văn Admin" : `Nhân viên ${i + 1}`,
  status: "ACTIVE", created_at: new Date().toISOString()
}));

export const demoHourly: HourlyStat[] = Array.from({ length: 24 }, (_, hour) => ({
  hour, occupied: Math.round(10 + 28 * Math.max(0, Math.sin((hour - 5) / 3))), available: 8,
  utilization: hour < 5 ? null : Math.min(98, Math.round(35 + 62 * Math.abs(Math.sin((hour - 5) / 3.4)))), samples: hour < 5 ? 0 : 4
}));

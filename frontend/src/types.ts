export type SlotStatus = "EMPTY" | "OCCUPIED" | "RESERVED" | "UNKNOWN";

export interface Point { x: number; y: number }
export interface ParkingSlot {
  id: number;
  camera_id: number;
  slot_code: string;
  roi_coordinates: Point[];
  status: SlotStatus | null;
  col: number;
  row: number;
  updated_at: string;
  observed_at?: string | null;
  observation_ready?: boolean;
  needs_reconciliation?: boolean;
  active_session_id?: number | null;
  reservation_expires_at?: string | null;
}

export interface ParkingSummary {
  total_slots: number;
  empty_slots: number;
  occupied_slots: number;
  reserved_slots: number;
  unknown_slots: number;
  has_unknown_alert: boolean;
  uninitialized_slots?: number;
  available_slots?: number;
}

export interface ParkingCustomer { customer_name: string; phone_number: string; license_plate: string }
export interface ParkingSession extends ParkingCustomer {
  id: number; parking_slot_id: number; is_active: boolean;
  created_by: number; created_at: string;
}
export interface SessionEvent {
  id: number; parking_session_id: number | null; parking_slot_id: number;
  source: string; old_status: SlotStatus | null; new_status: SlotStatus;
  confidence: number; event_time: string;
}

export interface ParkingMap { summary: ParkingSummary; slots: ParkingSlot[] }
export interface Camera {
  id: number;
  name: string;
  source_type: "RTSP" | "VIDEO_FILE";
  source_url: string;
  status: "CONNECTED" | "DISCONNECTED";
  created_at: string;
  updated_at: string;
}
export interface Permission { id: number; code: string; name: string; module: string; description?: string }
export interface Role { id: number; name: string; description?: string; created_at: string; permissions: Permission[] }
export interface User { id: number; role_id: number; username: string; full_name: string; status: "ACTIVE" | "INACTIVE"; created_at: string }
export interface Page<T> { data: T[]; meta: { page: number; page_size: number; total: number; total_pages: number } }
export interface HourlyStat { hour: number; occupied: number | null; available: number | null; utilization: number | null; samples: number; last_sample_at?: string | null }
export interface DailyStat { date: string; avg_utilization: number | null; samples: number; last_sample_at?: string | null }
export interface AuthClaims { sub: string; user_id: number; role: string; permissions: string[]; exp: number }

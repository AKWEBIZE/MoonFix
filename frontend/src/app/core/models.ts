export type Category = 'AC' | 'FRIDGE' | 'WASHING_MACHINE';
export type BookingStatus = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';

export interface PublicConfig {
  businessName: string;
  businessWhatsapp: string;
  workingDays: number[];
  bookingWindowDays: number;
  categories: Record<Category, string>;
  /** Google OAuth client id; null when Google sign-in is not set up. */
  googleClientId: string | null;
  /** whatsapp = real OTP via WhatsApp, dev = code shown on screen (local testing), off = not set up. */
  otpMode: 'whatsapp' | 'dev' | 'off';
}

// ---------- Customer accounts ----------
export interface Customer {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  picture: string;
  hasGoogle: boolean;
  needsPhone: boolean;
  /** Can log in with mobile number + password */
  hasPassword: boolean;
  /** Number proven with a WhatsApp code (then all bookings for the number are shown) */
  phoneVerified: boolean;
}

/** Website customer account, as shown in the admin panel. */
export interface AdminCustomer {
  id: number;
  name: string;
  phone: string | null;
  email: string;
  phoneVerified: boolean;
  hasPassword: boolean;
  hasGoogle: boolean;
  bookingCount: number;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface CustomerSession {
  token: string;
  customer: Customer;
}

export interface OtpStart {
  requestId: string;
  ref: string;
  phone: string;
  mode: 'whatsapp' | 'dev';
  expiresInSec: number;
  waLink: string;
  devCode?: string;
}

export interface CustomerOrder {
  ref: string;
  serviceId: number;
  serviceName: string;
  category: Category;
  price: number;
  date: string;
  slotStart: string;
  slotEnd: string;
  status: BookingStatus;
  technicianName: string | null;
  address: string;
  landmark: string;
  pincode: string;
  brand: string;
  issue: string;
  createdAt: string;
}

export interface ServiceItem {
  id: number;
  category: Category;
  categoryLabel?: string;
  name: string;
  description: string;
  price: number;
  durationMin: number;
  active?: boolean;
  sortOrder?: number;
}

export interface DateOption {
  date: string;
  open: boolean;
  reason: string | null;
}

export interface SlotOption {
  id: number;
  start: string;
  end: string;
  available: boolean;
  remaining: number;
  reason: string | null;
}

export interface BookingRequest {
  customerName: string;
  phone: string;
  address: string;
  landmark: string;
  pincode: string;
  serviceId: number;
  brand: string;
  issue: string;
  date: string;
  slotId: number;
  whatsappOptin: boolean;
  /** Hidden bot trap: always empty for real customers. */
  website?: string;
}

export interface PublicBooking {
  ref: string;
  customerName: string;
  serviceName: string;
  date: string;
  slotStart: string;
  slotEnd: string;
  status: BookingStatus;
  address: string;
  technicianName: string | null;
  price: number;
}

export interface Booking {
  id: number;
  ref: string;
  customerName: string;
  phone: string;
  address: string;
  landmark: string;
  pincode: string;
  serviceId: number;
  serviceName: string;
  category: Category;
  price: number;
  brand: string;
  issue: string;
  date: string;
  slotId: number;
  slotStart: string;
  slotEnd: string;
  technicianId: number | null;
  technicianName: string | null;
  technicianPhone: string | null;
  status: BookingStatus;
  adminNotes: string;
  whatsappOptin: boolean;
  reminderSentAt: string | null;
  feedbackSentAt: string | null;
  followupSentAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Technician {
  id: number;
  name: string;
  phone: string;
  skills: Category[];
  weeklyOff: number[];
  active: boolean;
}

export interface TimeSlot {
  id: number;
  start: string;
  end: string;
  active: boolean;
}

export interface Leave {
  id: number;
  technicianId: number;
  technicianName: string;
  date: string;
  slotId: number | null;
  slotStart: string | null;
  slotEnd: string | null;
  reason: string;
}

export interface BlockedDate {
  id: number;
  date: string;
  reason: string;
}

export interface WaMessage {
  id: number;
  bookingId: number | null;
  bookingRef: string | null;
  recipientType: 'customer' | 'technician' | 'admin';
  phone: string;
  kind: string;
  kindLabel: string;
  body: string;
  status: 'sent' | 'failed' | 'manual';
  provider: string;
  error: string | null;
  createdAt: string;
  link: string;
}

export interface SendResult {
  id: number;
  status: 'sent' | 'failed' | 'manual';
  error: string | null;
  link: string;
}

export interface GridCell {
  slotId: number;
  state: 'free' | 'leave' | 'booked' | 'weekly_off';
  leaveId: number | null;
  fullDay: boolean;
  booking: {
    id: number;
    ref: string;
    customer_name: string;
    service_name: string;
    status: string;
  } | null;
}

export interface AvailabilityGrid {
  date: string;
  blocked: BlockedDate | null;
  closedReason: string | null;
  slots: { id: number; start: string; end: string }[];
  technicians: {
    id: number;
    name: string;
    skills: Category[];
    weeklyOff: boolean;
    fullDayLeave: { id: number } | null;
    cells: GridCell[];
  }[];
  unassigned: {
    id: number;
    ref: string;
    slot_id: number;
    customer_name: string;
    service_name: string;
  }[];
}

export interface Dashboard {
  today: string;
  todayTotal: number;
  todayCompleted: number;
  pending: number;
  upcoming: number;
  failedMessages: number;
  manualMessages: number;
  activeTechnicians: number;
  todayBookings: Booking[];
  next7: { date: string; c: number }[];
  whatsappProvider: string;
}

export interface Settings {
  business_name: string;
  business_whatsapp: string;
  working_days: string;
  booking_window_days: string;
  min_lead_minutes: string;
  reminder_hours_before: string;
  feedback_delay_hours: string;
  followup_days: string;
  notify_admin_new_booking: string;
  notify_technician: string;
}

export const CATEGORY_LABELS: Record<Category, string> = {
  AC: 'Air Conditioner',
  FRIDGE: 'Refrigerator',
  WASHING_MACHINE: 'Washing Machine',
};

export const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export type MemberStatus = 'active' | 'inactive';
export type TrainerStatus = 'active' | 'inactive';
export type PaymentMode = 'cash' | 'upi' | 'card' | 'bank-transfer' | 'other';
export type DispatchChannel = 'whatsapp' | 'sms' | 'email' | 'manual';
export type DispatchStatus = 'queued' | 'sent' | 'failed';

export interface Member {
  id: number;
  name: string;
  phone: string;
  joinDate: string;
  planType: string;
  expiryDate: string;
  status: MemberStatus;
  assignedTrainerId?: number | null;
  freezeStart?: string | null;
  freezeEnd?: string | null;
  freezeReason?: string | null;
  freezeDaysTotal?: number;
}

export interface Trainer {
  id: number;
  name: string;
  phone: string;
  baseSalary: number;
  status: TrainerStatus;
}

export interface CreateTrainerInput {
  name: string;
  phone: string;
  baseSalary: number;
}

export interface CreateMemberInput {
  name: string;
  phone: string;
  joinDate: string;
  planType: string;
  expiryDate: string;
  assignedTrainerId?: number | null;
}

export interface Payment {
  id: number;
  memberId: number;
  memberName: string;
  amount: number;
  lateFee: number;
  paymentMode: PaymentMode;
  date: string;
  invoiceId: number | null;
  invoicePath: string | null;
  notes: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
}

export interface CreatePaymentInput {
  memberId: number;
  amount: number;
  paymentMode: PaymentMode;
  date?: string;
  notes?: string;
  lateFee?: number;
  applyLateFee?: boolean;
  generateInvoice?: boolean;
  gymName?: string;
  description?: string;
  splits?: Array<{ mode: PaymentMode; amount: number }>;
}

export interface AttendanceRow {
  id: number;
  memberId: number;
  memberName: string;
  phone: string;
  checkInTime: string;
  date: string;
  status: 'present' | 'absent';
  voidedAt?: string | null;
  voidReason?: string | null;
}

export interface TrainerAttendanceRow {
  id: number;
  name: string;
  phone: string;
  checkInTime: string;
}

export interface DashboardOverview {
  totalMembers: number;
  activeMembers: number;
  dailyRevenue: number;
  monthlyRevenue: number;
  expiringSoon: number;
  attendanceToday: number;
  overdueMembers: number;
  lateFeeExposure: number;
}

export interface TrendPoint {
  bucket?: string;
  label: string;
  value: number;
}

export interface DashboardTrends {
  revenueLast14Days: TrendPoint[];
  attendanceLast14Days: TrendPoint[];
  memberGrowthLast6Months: TrendPoint[];
  expiringBuckets: TrendPoint[];
  paymentModeBreakdownMonth: TrendPoint[];
}

export interface Invoice {
  id: number;
  memberId: number;
  memberName: string;
  filePath: string;
  createdAt: string;
  sentCount: number;
  lastSentAt: string | null;
  lastChannel: DispatchChannel | null;
}

export interface InvoiceDispatchLog {
  id: number;
  invoiceId: number;
  channel: DispatchChannel;
  destination: string | null;
  status: DispatchStatus;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface BackupFile {
  file: string;
  filePath: string;
  size: number;
  modifiedAt: string;
}

export interface BackupCreateResult {
  fileName: string;
  filePath: string;
  offsite: {
    filePath: string;
  } | null;
  retention: {
    removedCount: number;
    removedFiles: string[];
  };
}

export interface AuditLog {
  id: number;
  action: string;
  entity: string;
  entityId: number | null;
  details: string | null;
  createdAt: string;
}

export interface DuesEntry {
  id: number;
  name: string;
  phone: string;
  planType: string;
  expiryDate: string;
  status: MemberStatus;
  daysOverdue: number;
  lateFee: number;
}

export interface LateFeeSettings {
  enabled: boolean;
  graceDays: number;
  perDay: number;
  maxFee: number;
}

export interface DuesSummary {
  overdueCount: number;
  totalLateFeeExposure: number;
  lateFeeSettings: LateFeeSettings;
}

export interface SecurityStatus {
  pinSet: boolean;
  unlocked: boolean;
  lockTimeoutMinutes: number;
}

export interface NotificationSettings {
  enabled: boolean;
  expiryDaysBefore: number;
  channel: 'whatsapp' | 'sms';
  dispatchMode: 'desktop' | 'cloud';
}

export interface SyncSettings {
  enabled: boolean;
  cloudUrl: string;
  apiToken: string;
  hmacSecret: string;
  hasApiToken: boolean;
  hasHmacSecret: boolean;
  intervalMinutes: number;
  maskPhone: boolean;
  lastSuccessAt: string | null;
  incrementalCursor?: string | null;
  circuitBreaker: {
    threshold: number;
    cooldownMinutes: number;
    failureStreak: number;
    pausedUntil: string | null;
  };
}

export interface SyncRetrySettings {
  maxAttempts: number;
  baseDelaySeconds: number;
}

export interface AppSettings {
  lateFee: LateFeeSettings;
  backupKeepLast: number;
  backupOffsitePath: string;
  lockTimeoutMinutes: number;
  notifications: NotificationSettings;
  sync: SyncSettings;
  syncRetry: SyncRetrySettings;
  security: SecurityStatus;
}

declare global {
  interface Window {
    gymApi: {
      members: {
        list: () => Promise<Member[]>;
        create: (payload: CreateMemberInput) => Promise<{ id: number }>;
        updateStatus: (payload: { id: number; status: MemberStatus }) => Promise<{ updated: boolean }>;
        freeze: (payload: { id: number; startDate: string; endDate: string; reason?: string }) => Promise<{ updated: boolean; freezeDays: number; expiryDate: string }>;
        unfreeze: (payload: { id: number }) => Promise<{ updated: boolean }>;
      };
      payments: {
        list: () => Promise<Payment[]>;
        summary: () => Promise<{ dailyRevenue: number; monthlyRevenue: number; totalPayments: number; dailyLateFeeCollected: number; monthlyLateFeeCollected: number }>;
        create: (payload: CreatePaymentInput) => Promise<{ id: number; lateFee: number; invoiceId: number | null; invoicePath: string | null; invoiceError: string | null }>;
        void: (payload: { paymentId: number; reason: string }) => Promise<{ ok: boolean; paymentId: number; reversalPaymentId: number }>;
        zReport: (payload?: { date?: string }) => Promise<{ date: string; rows: Array<{ mode: PaymentMode; count: number; total: number }>; cashTotal: number; digitalTotal: number; grandTotal: number; count: number }>;
      };
      dues: {
        listOverdue: () => Promise<DuesEntry[]>;
        summary: () => Promise<DuesSummary>;
        calculateMember: (payload: { memberId: number }) => Promise<{ memberId: number; memberName: string; expiryDate: string; status: MemberStatus; daysOverdue: number; lateFee: number; lateFeeSettings: LateFeeSettings }>;
      };
      attendance: {
        checkIn: (payload: { memberId: number }) => Promise<{ id: number; date: string; checkInTime: string }>;
        today: () => Promise<{ date: string; total: number; rows: AttendanceRow[] }>;
        void: (payload: { attendanceId: number; reason: string }) => Promise<{ ok: boolean }>;
      };
      trainers: {
        list: () => Promise<Trainer[]>;
        create: (payload: CreateTrainerInput) => Promise<{ id: number; success: boolean }>;
        updateStatus: (payload: { id: number; status: TrainerStatus }) => Promise<{ ok: boolean }>;
        checkIn: (payload: { trainerId: number }) => Promise<{ ok: boolean }>;
        attendanceToday: () => Promise<TrainerAttendanceRow[]>;
      };
      dashboard: {
        overview: () => Promise<DashboardOverview>;
        trends: () => Promise<DashboardTrends>;
        expiringMembers: () => Promise<Member[]>;
      };
      invoices: {
        list: () => Promise<Invoice[]>;
        byPayment: (payload: { paymentId: number }) => Promise<{ paymentId: number; invoiceId: number | null; filePath: string | null; sentCount: number | null; lastSentAt: string | null; lastChannel: DispatchChannel | null }>;
        markSent: (payload: { invoiceId: number; channel?: DispatchChannel; status?: DispatchStatus; destination?: string; error?: string }) => Promise<{ ok: boolean }>;
        dispatchHistory: (payload: { invoiceId: number }) => Promise<InvoiceDispatchLog[]>;
      };
      backup: {
        create: () => Promise<BackupCreateResult>;
        list: () => Promise<BackupFile[]>;
        restore: (payload: { filePath: string }) => Promise<{ ok: boolean; message: string }>;
      };
      notifications: {
        status: () => Promise<{ settings: NotificationSettings; health: { lastSweepAt: string | null; staleToday: boolean; queue?: { pending: number; processing: number; failed: number } }; recent: Array<{ id: number; channel: string; recipient: string; message: string; status: string; error: string | null; context: string | null; createdAt: string }> }>;
        logs: (payload?: { limit?: number }) => Promise<Array<{ id: number; channel: string; recipient: string; message: string; status: string; error: string | null; context: string | null; createdAt: string }>>;
        runNow: () => Promise<{ sent: number; simulated: number; failed: number; skipped: number; processed?: number; runDate?: string; message?: string; queue?: { pending: number; processing?: number; failed: number } }>;
      };
      sync: {
        status: () => Promise<{ settings: SyncSettings; latest: { id: number; status: string; records: number; error: string | null; createdAt: string } | null; outbox: { pending: number; failed: number; completed: number } }>;
        logs: (payload?: { limit?: number }) => Promise<Array<{ id: number; status: string; records: number; error: string | null; createdAt: string }>>;
        outbox: (payload?: { limit?: number }) => Promise<Array<{ id: number; idempotencyKey: string; attempts: number; retryCount?: number; status: string; nextAttemptAt: string; nextRetryAt?: string | null; lastAttemptAt?: string | null; lastError: string | null; createdAt: string; updatedAt: string }>>;
        retryFailed: (payload?: { limit?: number }) => Promise<{ retried: number; outbox: { pending: number; failed: number; completed: number } }>;
        retryItem: (payload: { id: number }) => Promise<{ updated: boolean; outbox: { pending: number; failed: number; completed: number } }>;
        preview: () => Promise<{ generatedAt: string; members: unknown[]; paymentSummaries: unknown[]; dashboard: unknown }>;
        runNow: () => Promise<{ ok: boolean; skipped: boolean; reason?: string; error?: string; cooldownUntil?: string; records?: number; processed?: { attempted: number; succeeded: number; failed: number }; outbox?: { pending: number; failed: number; completed: number }; queuedNewSnapshot?: boolean }>;
      };
      security: {
        status: () => Promise<SecurityStatus>;
        setupPin: (payload: { pin: string }) => Promise<SecurityStatus>;
        verifyPin: (payload: { pin: string }) => Promise<{ ok: boolean; message?: string } & Partial<SecurityStatus>>;
        changePin: (payload: { currentPin: string; newPin: string }) => Promise<{ ok: boolean }>;
        lock: () => Promise<SecurityStatus>;
      };
      settings: {
        get: () => Promise<AppSettings>;
        update: (payload: {
          lateFee?: Partial<LateFeeSettings>;
          backupKeepLast?: number;
          backupOffsitePath?: string;
          lockTimeoutMinutes?: number;
          notifications?: Partial<NotificationSettings>;
          sync?: Omit<Partial<SyncSettings>, 'circuitBreaker'> & {
            clearApiToken?: boolean;
            clearHmacSecret?: boolean;
            circuitBreaker?: {
              threshold?: number;
              cooldownMinutes?: number;
            };
          };
          syncRetry?: Partial<SyncRetrySettings>;
        }) => Promise<AppSettings>;
      };
      audit: {
        recent: (payload?: { limit?: number }) => Promise<AuditLog[]>;
      };
      system: {
        openPath: (payload: { filePath: string }) => Promise<{ ok: boolean; error: string | null }>;
        clockHealth: () => Promise<{ ok: boolean; skipped: boolean; reason?: string; source: string | null; skewMs: number | null; maxSkewMs: number; localTimeIso: string; serverTimeIso: string | null; error: string | null }>;
        health: () => Promise<{ lastSyncSuccessAt: string | null; failedSyncCount: number; outbox: { pending: number; failed: number }; notifications: { pending: number; failed: number }; lastBackup: { status: string; details: string | null; error: string | null; createdAt: string } | null; encryption?: { mode: string; ok: boolean; error?: string; output?: string } }>;
      };
    };
  }
}

export {};

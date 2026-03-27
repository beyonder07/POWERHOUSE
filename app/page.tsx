'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
  AppSettings,
  AuditLog,
  BackupFile,
  CreateMemberInput,
  CreatePaymentInput,
  DashboardOverview,
  DashboardTrends,
  DispatchChannel,
  DuesEntry,
  DuesSummary,
  Invoice,
  InvoiceDispatchLog,
  Member,
  Payment,
  PaymentMode,
  SecurityStatus,
  TrendPoint,
  Trainer,
  CreateTrainerInput,
  TrainerAttendanceRow
} from '../types/electron';

type AppTab = 'analytics' | 'members' | 'payments' | 'dues' | 'attendance' | 'invoices' | 'backup' | 'settings' | 'audit' | 'trainers';

type SyncStatusData = {
  settings: {
    enabled: boolean;
    cloudUrl: string;
    hasApiToken: boolean;
    hasHmacSecret: boolean;
    intervalMinutes: number;
    maskPhone: boolean;
    lastSuccessAt: string | null;
    circuitBreaker: {
      threshold: number;
      cooldownMinutes: number;
      failureStreak: number;
      pausedUntil: string | null;
    };
  };
  latest: { id: number; status: string; records: number; error: string | null; createdAt: string } | null;
  outbox: { pending: number; failed: number; completed: number };
};

type SyncOutboxItem = {
  id: number;
  idempotencyKey: string;
  attempts: number;
  status: string;
  nextAttemptAt: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};
type ThemeMode = 'dark' | 'light';

const paymentModes: PaymentMode[] = ['cash', 'upi', 'card', 'bank-transfer', 'other'];
const dispatchChannels: DispatchChannel[] = ['whatsapp', 'sms', 'email', 'manual'];
const tablePageSize = 50;

const defaultMemberForm = (): CreateMemberInput => {
  const today = new Date().toISOString().slice(0, 10);
  return {
    name: '',
    phone: '',
    joinDate: today,
    planType: 'Monthly',
    expiryDate: today,
    assignedTrainerId: null
  };
};

const defaultPaymentForm = (): CreatePaymentInput => ({
  memberId: 0,
  amount: 0,
  paymentMode: 'cash',
  date: new Date().toISOString().slice(0, 10),
  notes: '',
  lateFee: 0,
  applyLateFee: true,
  generateInvoice: true,
  gymName: 'PowerHouse Gym',
  description: 'Membership Fee'
});

const defaultSecurityStatus: SecurityStatus = {
  pinSet: false,
  unlocked: true,
  lockTimeoutMinutes: 15
};

const defaultDashboardTrends: DashboardTrends = {
  revenueLast14Days: [],
  attendanceLast14Days: [],
  memberGrowthLast6Months: [],
  expiringBuckets: [],
  paymentModeBreakdownMonth: []
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(value);
}

function formatDateTime(value: string | null) {
  if (!value) {
    return '-';
  }

  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function safeJson(text: string | null) {
  if (!text) {
    return '-';
  }

  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return text;
  }
}

function ThemeGlyph({ theme }: { theme: ThemeMode }) {
  if (theme === 'dark') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 3.75V6m0 12v2.25M4.75 12H7m10 0h2.25M6.87 6.87l1.59 1.59m7.08 7.08 1.59 1.59m0-10.26-1.59 1.59m-7.08 7.08-1.59 1.59M12 8.25a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5Z"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M18.25 14.5A7.25 7.25 0 0 1 9.5 5.75a7.25 7.25 0 1 0 8.75 8.75Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function TrendSparkline({ points, color, areaColor }: { points: TrendPoint[]; color: string; areaColor: string }) {
  if (points.length === 0) {
    return <div className="chart-empty">No local trend data yet.</div>;
  }

  const width = 360;
  const height = 160;
  const padding = 18;
  const maxValue = Math.max(...points.map((point) => point.value), 1);
  const stepX = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;

  const coords = points.map((point, index) => {
    const x = padding + index * stepX;
    const y = height - padding - (point.value / maxValue) * (height - padding * 2);
    return { ...point, x, y };
  });

  const linePath = coords.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const areaPath = `${linePath} L ${coords[coords.length - 1].x} ${height - padding} L ${coords[0].x} ${height - padding} Z`;

  return (
    <div className="chart-shell">
      <svg viewBox={`0 0 ${width} ${height}`} className="trend-svg" role="img" aria-label="Trend chart">
        <defs>
          <linearGradient id={`area-${color.replace(/[^a-z0-9]/gi, '')}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={areaColor} />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>
        </defs>
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} className="chart-axis" />
        <path d={areaPath} fill={`url(#area-${color.replace(/[^a-z0-9]/gi, '')})`} />
        <path d={linePath} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {coords.map((point) => (
          <circle key={`${point.label}-${point.x}`} cx={point.x} cy={point.y} r="4" fill={color} />
        ))}
      </svg>
      <div className="chart-label-row">
        <span>{points[0]?.label}</span>
        <span>{points[Math.floor(points.length / 2)]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </div>
  );
}

function TrendBars({ points, tone }: { points: TrendPoint[]; tone: 'brand' | 'accent' }) {
  if (points.length === 0) {
    return <div className="chart-empty">No matching data available.</div>;
  }

  const maxValue = Math.max(...points.map((point) => point.value), 1);

  return (
    <div className="bar-list">
      {points.map((point) => (
        <div key={point.label} className="bar-row">
          <div className="bar-meta">
            <span>{point.label}</span>
            <strong>{point.value}</strong>
          </div>
          <div className="bar-track">
            <div
              className={`bar-fill ${tone}`}
              style={{ width: `${Math.max(8, (point.value / maxValue) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function TrendCard({
  title,
  subtitle,
  accent,
  points,
  type = 'line',
  valueFormat = (value: number) => String(value),
  actionLabel,
  onAction
}: {
  title: string;
  subtitle: string;
  accent: 'red' | 'blue';
  points: TrendPoint[];
  type?: 'line' | 'bars';
  valueFormat?: (value: number) => string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const palette =
    accent === 'red'
      ? { stroke: '#ef4444', fill: 'rgba(239, 68, 68, 0.22)', tone: 'brand' as const }
      : { stroke: '#3b82f6', fill: 'rgba(59, 130, 246, 0.22)', tone: 'accent' as const };

  const total = points.reduce((sum, point) => sum + point.value, 0);
  const peak = points.reduce((max, point) => Math.max(max, point.value), 0);

  return (
    <article className="trend-card">
      <div className="trend-card-head">
        <div>
          <p className="trend-kicker">{title}</p>
          <h3>{subtitle}</h3>
        </div>
        <div className="trend-summary">
          <span>Total</span>
          <strong>{valueFormat(total)}</strong>
          <small>Peak {valueFormat(peak)}</small>
        </div>
      </div>
      {type === 'line' ? (
        <TrendSparkline points={points} color={palette.stroke} areaColor={palette.fill} />
      ) : (
        <TrendBars points={points} tone={palette.tone} />
      )}
      {actionLabel && onAction ? (
        <div className="trend-card-actions">
          <button type="button" className="theme-btn trend-action-btn" onClick={onAction}>
            {actionLabel}
          </button>
        </div>
      ) : null}
    </article>
  );
}

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<AppTab>('members');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);

  const [members, setMembers] = useState<Member[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [todayAttendance, setTodayAttendance] = useState<{ date: string; total: number; rows: { id: number; memberId: number; memberName: string; phone: string; checkInTime: string; date: string; status: 'present' | 'absent'; voidedAt?: string | null; voidReason?: string | null; }[] }>({
    date: new Date().toISOString().slice(0, 10),
    total: 0,
    rows: []
  });
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [todayTrainerAttendance, setTodayTrainerAttendance] = useState<TrainerAttendanceRow[]>([]);
  const [trainerForm, setTrainerForm] = useState<CreateTrainerInput>({ name: '', phone: '', baseSalary: 0 });
  const [dashboard, setDashboard] = useState<DashboardOverview>({
    totalMembers: 0,
    activeMembers: 0,
    dailyRevenue: 0,
    monthlyRevenue: 0,
    expiringSoon: 0,
    attendanceToday: 0,
    overdueMembers: 0,
    lateFeeExposure: 0
  });
  const [dashboardTrends, setDashboardTrends] = useState<DashboardTrends>(defaultDashboardTrends);
  const [expiringMembers, setExpiringMembers] = useState<Member[]>([]);
  const [duesRows, setDuesRows] = useState<DuesEntry[]>([]);
  const [duesSummary, setDuesSummary] = useState<DuesSummary>({
    overdueCount: 0,
    totalLateFeeExposure: 0,
    lateFeeSettings: {
      enabled: true,
      graceDays: 3,
      perDay: 20,
      maxFee: 1000
    }
  });
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsForm, setSettingsForm] = useState({
    lateFeeEnabled: true,
    graceDays: 3,
    perDay: 20,
    maxFee: 1000,
    backupKeepLast: 14,
    backupOffsitePath: '',
    lockTimeoutMinutes: 15,
    notificationEnabled: true,
    notificationExpiryDaysBefore: 3,
    notificationChannel: 'whatsapp' as 'whatsapp' | 'sms',
    notificationDispatchMode: 'desktop' as 'desktop' | 'cloud',
    syncEnabled: false,
    syncCloudUrl: '',
    syncApiToken: '',
    syncHmacSecret: '',
    syncHasApiToken: false,
    syncHasHmacSecret: false,
    clearSyncApiToken: false,
    clearSyncHmacSecret: false,
    syncIntervalMinutes: 60,
    syncMaskPhone: true,
    syncRetryMaxAttempts: 5,
    syncRetryBaseDelaySeconds: 30,
    syncCircuitBreakerThreshold: 5,
    syncCircuitBreakerCooldownMinutes: 30
  });
  const [securityStatus, setSecurityStatus] = useState<SecurityStatus>(defaultSecurityStatus);
  const [unlockPin, setUnlockPin] = useState('');
  const [setupPin, setSetupPin] = useState('');
  const [setupPinConfirm, setSetupPinConfirm] = useState('');
  const [changeCurrentPin, setChangeCurrentPin] = useState('');
  const [changeNewPin, setChangeNewPin] = useState('');
  const [dispatchHistory, setDispatchHistory] = useState<InvoiceDispatchLog[]>([]);
  const [selectedInvoiceIdForHistory, setSelectedInvoiceIdForHistory] = useState<number | null>(null);
  const [notificationLogs, setNotificationLogs] = useState<Array<{ id: number; channel: string; recipient: string; status: string; createdAt: string; error: string | null }>>([]);
  const [notificationHealth, setNotificationHealth] = useState<{ lastSweepAt: string | null; staleToday: boolean; queue?: { pending: number; processing: number; failed: number } }>({
    lastSweepAt: null,
    staleToday: false
  });
  const [systemHealth, setSystemHealth] = useState<{ lastSyncSuccessAt: string | null; failedSyncCount: number; outbox: { pending: number; failed: number }; notifications: { pending: number; failed: number }; lastBackup: { status: string; details: string | null; error: string | null; createdAt: string } | null; encryption?: { mode: string; ok: boolean; error?: string; output?: string } } | null>(null);
  const [clockHealth, setClockHealth] = useState<{ ok: boolean; skipped: boolean; reason?: string; source: string | null; skewMs: number | null; maxSkewMs: number; localTimeIso: string; serverTimeIso: string | null; error: string | null } | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatusData | null>(null);
  const [syncOutbox, setSyncOutbox] = useState<SyncOutboxItem[]>([]);
  const [membersPage, setMembersPage] = useState(1);
  const [paymentsPage, setPaymentsPage] = useState(1);

  const [memberForm, setMemberForm] = useState<CreateMemberInput>(defaultMemberForm);
  const [paymentForm, setPaymentForm] = useState<CreatePaymentInput>(defaultPaymentForm);
  const [attendanceMemberId, setAttendanceMemberId] = useState<number>(0);

  const activeMembers = useMemo(() => members.filter((member) => member.status === 'active'), [members]);
  const analyticsInsights = useMemo(() => {
    const revenuePoints = dashboardTrends.revenueLast14Days;
    const attendancePoints = dashboardTrends.attendanceLast14Days;
    const growthPoints = dashboardTrends.memberGrowthLast6Months;
    const averageDailyRevenue =
      revenuePoints.length > 0 ? revenuePoints.reduce((sum, point) => sum + point.value, 0) / revenuePoints.length : 0;
    const averageDailyAttendance =
      attendancePoints.length > 0 ? attendancePoints.reduce((sum, point) => sum + point.value, 0) / attendancePoints.length : 0;
    const topPaymentMode = [...dashboardTrends.paymentModeBreakdownMonth].sort((left, right) => right.value - left.value)[0];
    const bestGrowthMonth = [...growthPoints].sort((left, right) => right.value - left.value)[0];

    return {
      averageDailyRevenue,
      averageDailyAttendance,
      topPaymentMode,
      bestGrowthMonth
    };
  }, [dashboardTrends]);
  const totalMembersPages = Math.max(1, Math.ceil(members.length / tablePageSize));
  const totalPaymentsPages = Math.max(1, Math.ceil(payments.length / tablePageSize));
  const pagedMembers = useMemo(() => {
    const start = (membersPage - 1) * tablePageSize;
    return members.slice(start, start + tablePageSize);
  }, [members, membersPage]);
  const pagedPayments = useMemo(() => {
    const start = (paymentsPage - 1) * tablePageSize;
    return payments.slice(start, start + tablePageSize);
  }, [payments, paymentsPage]);
  const isLocked = securityStatus.pinSet && !securityStatus.unlocked;
  const isBusy = Boolean(busyAction);

  useEffect(() => {
    if (activeMembers.length > 0 && paymentForm.memberId === 0) {
      setPaymentForm((prev) => ({ ...prev, memberId: activeMembers[0].id }));
    }

    if (activeMembers.length > 0 && attendanceMemberId === 0) {
      setAttendanceMemberId(activeMembers[0].id);
    }
  }, [activeMembers, paymentForm.memberId, attendanceMemberId]);

  useEffect(() => {
    if (membersPage > totalMembersPages) {
      setMembersPage(totalMembersPages);
    }
  }, [membersPage, totalMembersPages]);

  useEffect(() => {
    if (paymentsPage > totalPaymentsPages) {
      setPaymentsPage(totalPaymentsPages);
    }
  }, [paymentsPage, totalPaymentsPages]);

  useEffect(() => {
    const stored = window.localStorage.getItem('powerhouse-theme');
    if (stored === 'light' || stored === 'dark') {
      setTheme(stored);
      document.documentElement.setAttribute('data-theme', stored);
      return;
    }

    const preferredDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme: ThemeMode = preferredDark ? 'dark' : 'light';
    setTheme(initialTheme);
    document.documentElement.setAttribute('data-theme', initialTheme);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem('powerhouse-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const loadAll = async () => {
    setLoading(true);
    setError(null);

    try {
      const [
        membersResult,
        paymentsResult,
        invoicesResult,
        backupsResult,
        attendanceResult,
        dashboardResult,
        dashboardTrendsResult,
        expiringResult,
        auditResult,
        duesResult,
        duesSummaryResult,
        settingsResult,
        securityResult,
        notificationsResult,
        clockHealthResult,
        systemHealthResult,
        syncResult,
        syncOutboxResult,
        trainersResult,
        trainerAttendanceResult
      ] = await Promise.all([
        window.gymApi.members.list(),
        window.gymApi.payments.list(),
        window.gymApi.invoices.list(),
        window.gymApi.backup.list(),
        window.gymApi.attendance.today(),
        window.gymApi.dashboard.overview(),
        window.gymApi.dashboard.trends(),
        window.gymApi.dashboard.expiringMembers(),
        window.gymApi.audit.recent({ limit: 40 }),
        window.gymApi.dues.listOverdue(),
        window.gymApi.dues.summary(),
        window.gymApi.settings.get(),
        window.gymApi.security.status(),
        window.gymApi.notifications.status(),
        window.gymApi.system.clockHealth(),
        window.gymApi.system.health(),
        window.gymApi.sync.status(),
        window.gymApi.sync.outbox({ limit: 40 }),
        window.gymApi.trainers.list(),
        window.gymApi.trainers.attendanceToday()
      ]);

      setMembers(membersResult);
      setPayments(paymentsResult);
      setInvoices(invoicesResult);
      setBackups(backupsResult);
      setTodayAttendance(attendanceResult);
      setDashboard(dashboardResult);
      setDashboardTrends(dashboardTrendsResult);
      setExpiringMembers(expiringResult);
      setAuditLogs(auditResult);
      setDuesRows(duesResult);
      setDuesSummary(duesSummaryResult);
      setSettings(settingsResult);
      setSettingsForm({
        lateFeeEnabled: settingsResult.lateFee.enabled,
        graceDays: settingsResult.lateFee.graceDays,
        perDay: settingsResult.lateFee.perDay,
        maxFee: settingsResult.lateFee.maxFee,
        backupKeepLast: settingsResult.backupKeepLast,
        backupOffsitePath: settingsResult.backupOffsitePath,
        lockTimeoutMinutes: settingsResult.lockTimeoutMinutes,
        notificationEnabled: settingsResult.notifications.enabled,
        notificationExpiryDaysBefore: settingsResult.notifications.expiryDaysBefore,
        notificationChannel: settingsResult.notifications.channel,
        notificationDispatchMode: settingsResult.notifications.dispatchMode,
        syncEnabled: settingsResult.sync.enabled,
        syncCloudUrl: settingsResult.sync.cloudUrl,
        syncApiToken: '',
        syncHmacSecret: '',
        syncHasApiToken: settingsResult.sync.hasApiToken,
        syncHasHmacSecret: settingsResult.sync.hasHmacSecret,
        clearSyncApiToken: false,
        clearSyncHmacSecret: false,
        syncIntervalMinutes: settingsResult.sync.intervalMinutes,
        syncMaskPhone: settingsResult.sync.maskPhone,
        syncRetryMaxAttempts: settingsResult.syncRetry.maxAttempts,
        syncRetryBaseDelaySeconds: settingsResult.syncRetry.baseDelaySeconds,
        syncCircuitBreakerThreshold: settingsResult.sync.circuitBreaker.threshold,
        syncCircuitBreakerCooldownMinutes: settingsResult.sync.circuitBreaker.cooldownMinutes
      });
      setSecurityStatus(securityResult);
      setNotificationLogs(notificationsResult.recent);
      setNotificationHealth(notificationsResult.health);
      setClockHealth(clockHealthResult);
      setSystemHealth(systemHealthResult);
      setSyncStatus(syncResult);
      setSyncOutbox(syncOutboxResult);
      setTrainers(trainersResult);
      setTodayTrainerAttendance(trainerAttendanceResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load application data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    const run = async () => {
      if (!paymentForm.applyLateFee || !paymentForm.memberId) {
        return;
      }

      try {
        const late = await window.gymApi.dues.calculateMember({ memberId: paymentForm.memberId });
        setPaymentForm((prev) => ({ ...prev, lateFee: late.lateFee }));
      } catch {
        setPaymentForm((prev) => ({ ...prev, lateFee: 0 }));
      }
    };

    void run();
  }, [paymentForm.memberId, paymentForm.applyLateFee]);

  const refreshSecurityStatus = async () => {
    const next = await window.gymApi.security.status();
    setSecurityStatus(next);
  };

  const handleUnlock = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setStatus(null);

    try {
      const result = await window.gymApi.security.verifyPin({ pin: unlockPin });
      if (!result.ok) {
        setError(result.message || 'Invalid PIN');
        return;
      }

      setUnlockPin('');
      await refreshSecurityStatus();
      setStatus('Application unlocked.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to unlock application');
    }
  };

  const handleLock = async () => {
    setError(null);
    setStatus(null);

    try {
      const result = await window.gymApi.security.lock();
      setSecurityStatus(result);
      setStatus('Application locked.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to lock application');
    }
  };

  const handleSetupPin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setStatus(null);

    if (setupPin !== setupPinConfirm) {
      setError('PIN confirmation does not match');
      return;
    }

    try {
      const result = await window.gymApi.security.setupPin({ pin: setupPin });
      setSetupPin('');
      setSetupPinConfirm('');
      setSecurityStatus(result);
      setStatus('PIN configured successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to setup PIN');
    }
  };

  const handleChangePin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setStatus(null);

    try {
      await window.gymApi.security.changePin({
        currentPin: changeCurrentPin,
        newPin: changeNewPin
      });
      setChangeCurrentPin('');
      setChangeNewPin('');
      setStatus('PIN changed successfully.');
      await refreshSecurityStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to change PIN');
    }
  };

  const handleSaveSettings = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isBusy) {
      return;
    }
    setBusyAction('Saving settings...');
    setError(null);
    setStatus(null);

    try {
      const syncPayload: {
        enabled: boolean;
        cloudUrl: string;
        intervalMinutes: number;
        maskPhone: boolean;
        apiToken?: string;
        hmacSecret?: string;
        clearApiToken?: boolean;
        clearHmacSecret?: boolean;
        circuitBreaker: {
          threshold: number;
          cooldownMinutes: number;
        };
      } = {
        enabled: settingsForm.syncEnabled,
        cloudUrl: settingsForm.syncCloudUrl,
        intervalMinutes: settingsForm.syncIntervalMinutes,
        maskPhone: settingsForm.syncMaskPhone,
        clearApiToken: settingsForm.clearSyncApiToken,
        clearHmacSecret: settingsForm.clearSyncHmacSecret,
        circuitBreaker: {
          threshold: settingsForm.syncCircuitBreakerThreshold,
          cooldownMinutes: settingsForm.syncCircuitBreakerCooldownMinutes
        }
      };
      if (settingsForm.syncApiToken.trim()) {
        syncPayload.apiToken = settingsForm.syncApiToken.trim();
      }
      if (settingsForm.syncHmacSecret.trim()) {
        syncPayload.hmacSecret = settingsForm.syncHmacSecret.trim();
      }

      const updated = await window.gymApi.settings.update({
        lateFee: {
          enabled: settingsForm.lateFeeEnabled,
          graceDays: settingsForm.graceDays,
          perDay: settingsForm.perDay,
          maxFee: settingsForm.maxFee
        },
        backupKeepLast: settingsForm.backupKeepLast,
        backupOffsitePath: settingsForm.backupOffsitePath,
        lockTimeoutMinutes: settingsForm.lockTimeoutMinutes,
        notifications: {
          enabled: settingsForm.notificationEnabled,
          expiryDaysBefore: settingsForm.notificationExpiryDaysBefore,
          channel: settingsForm.notificationChannel,
          dispatchMode: settingsForm.notificationDispatchMode
        },
        sync: syncPayload,
        syncRetry: {
          maxAttempts: settingsForm.syncRetryMaxAttempts,
          baseDelaySeconds: settingsForm.syncRetryBaseDelaySeconds
        }
      });
      setSettings(updated);
      setSettingsForm({
        lateFeeEnabled: updated.lateFee.enabled,
        graceDays: updated.lateFee.graceDays,
        perDay: updated.lateFee.perDay,
        maxFee: updated.lateFee.maxFee,
        backupKeepLast: updated.backupKeepLast,
        backupOffsitePath: updated.backupOffsitePath,
        lockTimeoutMinutes: updated.lockTimeoutMinutes,
        notificationEnabled: updated.notifications.enabled,
        notificationExpiryDaysBefore: updated.notifications.expiryDaysBefore,
        notificationChannel: updated.notifications.channel,
        notificationDispatchMode: updated.notifications.dispatchMode,
        syncEnabled: updated.sync.enabled,
        syncCloudUrl: updated.sync.cloudUrl,
        syncApiToken: '',
        syncHmacSecret: '',
        syncHasApiToken: updated.sync.hasApiToken,
        syncHasHmacSecret: updated.sync.hasHmacSecret,
        clearSyncApiToken: false,
        clearSyncHmacSecret: false,
        syncIntervalMinutes: updated.sync.intervalMinutes,
        syncMaskPhone: updated.sync.maskPhone,
        syncRetryMaxAttempts: updated.syncRetry.maxAttempts,
        syncRetryBaseDelaySeconds: updated.syncRetry.baseDelaySeconds,
        syncCircuitBreakerThreshold: updated.sync.circuitBreaker.threshold,
        syncCircuitBreakerCooldownMinutes: updated.sync.circuitBreaker.cooldownMinutes
      });
      setSecurityStatus(updated.security);
      setStatus('Settings updated successfully.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update settings');
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreateMember = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isBusy) {
      return;
    }
    setBusyAction('Creating member...');
    setError(null);
    setStatus(null);

    try {
      await window.gymApi.members.create(memberForm);
      setMemberForm(defaultMemberForm());
      setStatus('Member created successfully.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create member');
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreateTrainer = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isBusy) {
      return;
    }
    setBusyAction('Creating trainer...');
    setError(null);
    setStatus(null);

    try {
      await window.gymApi.trainers.create(trainerForm);
      setTrainerForm({ name: '', phone: '', baseSalary: 0 });
      setStatus('Trainer created successfully.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create trainer');
    } finally {
      setBusyAction(null);
    }
  };

  const handleToggleTrainerStatus = async (trainer: Trainer) => {
    if (isBusy) {
      return;
    }
    setBusyAction('Updating trainer status...');
    setError(null);
    setStatus(null);

    try {
      const nextStatus = trainer.status === 'active' ? 'inactive' : 'active';
      await window.gymApi.trainers.updateStatus({ id: trainer.id, status: nextStatus });
      setStatus(`Trainer marked as ${nextStatus}.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update trainer status');
    } finally {
      setBusyAction(null);
    }
  };

  const handleToggleMemberStatus = async (member: Member) => {
    if (isBusy) {
      return;
    }
    setBusyAction('Updating member status...');
    setError(null);
    setStatus(null);

    try {
      const nextStatus = member.status === 'active' ? 'inactive' : 'active';
      await window.gymApi.members.updateStatus({ id: member.id, status: nextStatus });
      setStatus(`Member marked as ${nextStatus}.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update member status');
    } finally {
      setBusyAction(null);
    }
  };

  const handleFreezeMember = async (member: Member) => {
    if (isBusy) {
      return;
    }

    const startDate = window.prompt('Freeze start date (YYYY-MM-DD):', new Date().toISOString().slice(0, 10));
    if (!startDate) {
      return;
    }
    const endDate = window.prompt('Freeze end date (YYYY-MM-DD):', startDate);
    if (!endDate) {
      return;
    }
    const reason = window.prompt('Freeze reason (optional):', '') || '';

    setBusyAction('Applying membership freeze...');
    setError(null);
    setStatus(null);

    try {
      const result = await window.gymApi.members.freeze({
        id: member.id,
        startDate: startDate.trim(),
        endDate: endDate.trim(),
        reason: reason.trim() || undefined
      });
      if (result.updated) {
        setStatus(`Freeze applied (${result.freezeDays} day(s)). New expiry: ${result.expiryDate}`);
      } else {
        setStatus('No changes applied.');
      }
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to apply member freeze');
    } finally {
      setBusyAction(null);
    }
  };

  const handleUnfreezeMember = async (member: Member) => {
    if (isBusy) {
      return;
    }

    setBusyAction('Clearing membership freeze...');
    setError(null);
    setStatus(null);

    try {
      const result = await window.gymApi.members.unfreeze({ id: member.id });
      setStatus(result.updated ? 'Freeze cleared successfully.' : 'No freeze data was updated.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to clear member freeze');
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreatePayment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isBusy) {
      return;
    }
    setBusyAction('Recording payment...');
    setError(null);
    setStatus(null);

    try {
      const result = await window.gymApi.payments.create(paymentForm);
      if (result.invoicePath) {
        setStatus(`Payment recorded and invoice generated: ${result.invoicePath}`);
      } else if (result.invoiceError) {
        setStatus(`Payment recorded, but invoice generation failed: ${result.invoiceError}`);
      } else {
        setStatus('Payment recorded successfully.');
      }
      setPaymentForm((prev) => ({ ...defaultPaymentForm(), memberId: prev.memberId }));
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create payment');
    } finally {
      setBusyAction(null);
    }
  };

  const handleGenerateZReport = async () => {
    if (isBusy) {
      return;
    }

    const dateInput = window.prompt('Enter date for Z-report (YYYY-MM-DD). Leave blank for today:', '');
    const payload = dateInput && dateInput.trim() ? { date: dateInput.trim() } : undefined;

    setBusyAction('Generating Z-report...');
    setError(null);
    setStatus(null);

    try {
      const report = await window.gymApi.payments.zReport(payload);
      const rowsText = report.rows.map((row) => `${row.mode}: ${row.count} payments, ${formatCurrency(row.total)}`).join('\n');
      setStatus(`Z-Report ${report.date} | Cash: ${formatCurrency(report.cashTotal)} | Digital: ${formatCurrency(report.digitalTotal)} | Total: ${formatCurrency(report.grandTotal)}`);
      window.alert(`Z-Report (${report.date})\n\n${rowsText}\n\nCash: ${formatCurrency(report.cashTotal)}\nDigital: ${formatCurrency(report.digitalTotal)}\nGrand Total: ${formatCurrency(report.grandTotal)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate Z-report');
    } finally {
      setBusyAction(null);
    }
  };

  const handleVoidPayment = async (paymentId: number) => {
    if (isBusy) {
      return;
    }

    const reasonInput = window.prompt(`Void payment #${paymentId}. Enter reason:`, '');
    const reason = reasonInput ? reasonInput.trim() : '';
    if (!reason) {
      return;
    }

    setBusyAction('Voiding payment...');
    setError(null);
    setStatus(null);

    try {
      const result = await window.gymApi.payments.void({ paymentId, reason });
      setStatus(`Payment #${result.paymentId} voided. Reversal entry #${result.reversalPaymentId} created.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to void payment');
    } finally {
      setBusyAction(null);
    }
  };

  const handleCheckIn = async () => {
    if (!attendanceMemberId) {
      setError('Please select a member for attendance check-in');
      return;
    }
    if (isBusy) {
      return;
    }

    setBusyAction('Marking attendance...');
    setError(null);
    setStatus(null);

    try {
      await window.gymApi.attendance.checkIn({ memberId: attendanceMemberId });
      setStatus('Attendance marked successfully.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark attendance');
    } finally {
      setBusyAction(null);
    }
  };

  const handleTrainerCheckIn = async (trainerId: number) => {
    if (isBusy) {
      return;
    }
    setBusyAction('Marking trainer attendance...');
    setError(null);
    setStatus(null);

    try {
      await window.gymApi.trainers.checkIn({ trainerId });
      setStatus('Trainer attendance marked successfully.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark trainer attendance');
    } finally {
      setBusyAction(null);
    }
  };

  const handleVoidAttendance = async (attendanceId: number) => {
    if (isBusy) {
      return;
    }
    
    const reasonInput = window.prompt('Void this attendance entry. Enter reason (required):', '');
    const reason = reasonInput ? reasonInput.trim() : '';
    if (!reason) {
      return;
    }

    setBusyAction('Voiding attendance...');
    setError(null);
    setStatus(null);

    try {
      await window.gymApi.attendance.void({ attendanceId, reason });
      setStatus('Attendance voided successfully.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to void attendance');
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreateBackup = async () => {
    if (isBusy) {
      return;
    }
    setBusyAction('Creating backup...');
    setError(null);
    setStatus(null);

    try {
      const backup = await window.gymApi.backup.create();
      if (backup.offsite) {
        setStatus(`Backup created and copied offsite: ${backup.offsite.filePath}`);
      } else if (backup.retention.removedCount > 0) {
        setStatus(`Backup created. Retention removed ${backup.retention.removedCount} old backups.`);
      } else {
        setStatus(`Backup created: ${backup.fileName}`);
      }
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create backup');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRestoreBackup = async (filePath: string) => {
    const confirmed = window.confirm('Restoring a backup will restart the app. Continue?');
    if (!confirmed) {
      return;
    }
    if (isBusy) {
      return;
    }

    setBusyAction('Restoring backup...');
    setError(null);
    setStatus(null);

    try {
      await window.gymApi.backup.restore({ filePath });
      setStatus('Backup restore started. App will restart.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore backup');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRunNotificationsNow = async () => {
    if (isBusy) {
      return;
    }
    setBusyAction('Running notification sweep...');
    setError(null);
    setStatus(null);

    try {
      const result = await window.gymApi.notifications.runNow();
      setStatus(`Notification sweep: sent=${result.sent}, simulated=${result.simulated}, failed=${result.failed}, skipped=${result.skipped}`);
      const fresh = await window.gymApi.notifications.status();
      setNotificationLogs(fresh.recent);
      setNotificationHealth(fresh.health);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to run notifications now');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRunSyncNow = async () => {
    if (isBusy) {
      return;
    }
    setBusyAction('Running sync...');
    setError(null);
    setStatus(null);

    try {
      const result = await window.gymApi.sync.runNow();
      if (result.ok) {
        const attempted = result.processed?.attempted ?? 0;
        const succeeded = result.processed?.succeeded ?? 0;
        const failed = result.processed?.failed ?? 0;
        const queued = result.queuedNewSnapshot ? 'yes' : 'no';
        setStatus(`Sync completed. attempted=${attempted}, succeeded=${succeeded}, failed=${failed}, queuedNewSnapshot=${queued}`);
      } else if (result.skipped) {
        setStatus(`Sync skipped: ${result.reason}`);
      } else {
        setStatus(`Sync failed: ${result.error || result.reason || 'unknown error'}`);
      }
      const [freshStatus, freshOutbox] = await Promise.all([
        window.gymApi.sync.status(),
        window.gymApi.sync.outbox({ limit: 40 })
      ]);
      setSyncStatus(freshStatus);
      setSyncOutbox(freshOutbox);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to run sync now');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRetryFailedSyncOutbox = async () => {
    if (isBusy) {
      return;
    }
    setBusyAction('Re-queueing failed sync items...');
    setError(null);
    setStatus(null);

    try {
      const result = await window.gymApi.sync.retryFailed({ limit: 100 });
      setStatus(`Re-queued ${result.retried} failed sync item(s).`);
      const [freshStatus, freshOutbox] = await Promise.all([
        window.gymApi.sync.status(),
        window.gymApi.sync.outbox({ limit: 40 })
      ]);
      setSyncStatus(freshStatus);
      setSyncOutbox(freshOutbox);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to retry failed sync outbox');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRetrySingleSyncOutbox = async (id: number) => {
    if (isBusy) {
      return;
    }
    setBusyAction('Retrying outbox item...');
    setError(null);
    setStatus(null);

    try {
      const result = await window.gymApi.sync.retryItem({ id });
      if (!result.updated) {
        setStatus(`Outbox item #${id} is not eligible for retry.`);
      } else {
        setStatus(`Outbox item #${id} queued for retry.`);
      }
      const [freshStatus, freshOutbox] = await Promise.all([
        window.gymApi.sync.status(),
        window.gymApi.sync.outbox({ limit: 40 })
      ]);
      setSyncStatus(freshStatus);
      setSyncOutbox(freshOutbox);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to retry selected sync outbox item');
    } finally {
      setBusyAction(null);
    }
  };

  const openFilePath = async (filePath: string) => {
    setError(null);

    try {
      const result = await window.gymApi.system.openPath({ filePath });
      if (!result.ok) {
        setError(result.error || 'Unable to open path');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open path');
    }
  };

  const handleMarkInvoiceDispatch = async (invoiceId: number, channel: DispatchChannel) => {
    if (isBusy) {
      return;
    }
    setError(null);
    setStatus(null);

    const destinationInput = window.prompt(`Enter ${channel} destination (optional):`, '');
    const destination = destinationInput && destinationInput.trim() ? destinationInput.trim() : undefined;
    setBusyAction('Updating invoice dispatch...');

    try {
      await window.gymApi.invoices.markSent({
        invoiceId,
        channel,
        status: 'sent',
        destination
      });
      setStatus(`Invoice #${invoiceId} marked as sent via ${channel}.`);
      await loadAll();
      const history = await window.gymApi.invoices.dispatchHistory({ invoiceId });
      setSelectedInvoiceIdForHistory(invoiceId);
      setDispatchHistory(history);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to mark invoice dispatch');
    } finally {
      setBusyAction(null);
    }
  };

  const handleLoadDispatchHistory = async (invoiceId: number) => {
    setError(null);

    try {
      const history = await window.gymApi.invoices.dispatchHistory({ invoiceId });
      setSelectedInvoiceIdForHistory(invoiceId);
      setDispatchHistory(history);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dispatch history');
    }
  };

  if (loading) {
    return (
      <main className="shell">
        <h1>PowerHouse Gym Console</h1>
        <p>Loading your dashboard...</p>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="hero">
        <div className="brand">
          {logoLoadFailed ? (
            <div className="brand-fallback" aria-label="PowerHouse logo">
              <span>PH</span>
            </div>
          ) : (
            <img
              className="brand-logo"
              src="/powerhouse-logo.jpg"
              alt="PowerHouse Gym logo"
              onError={() => setLogoLoadFailed(true)}
            />
          )}
          <div className="brand-copy">
            <p className="brand-tag">POWERHOUSE OPERATIONS</p>
            <h1>PowerHouse Gym</h1>
            <p>Simple, fast, and reliable front-desk operations for your team.</p>
          </div>
        </div>
        <div className="hero-actions">
          <button className="theme-btn" onClick={toggleTheme}>
            <ThemeGlyph theme={theme} />
            <span>{theme === 'dark' ? 'Bright Mode' : 'Dark Mode'}</span>
          </button>
          <div className="security-chip">
            Security: {securityStatus.pinSet ? (securityStatus.unlocked ? 'Unlocked' : 'Locked') : 'PIN not set'}
          </div>
          {securityStatus.pinSet ? <button onClick={handleLock}>Lock App</button> : null}
        </div>
      </header>
      {clockHealth && !clockHealth.ok && !clockHealth.skipped ? (
        <p className="error">System clock drift detected ({Math.round((clockHealth.skewMs || 0) / 1000)}s). Fix OS time before sync/billing operations.</p>
      ) : null}

      <section className="stats-grid">
        <article><h2>Total Members</h2><strong>{dashboard.totalMembers}</strong></article>
        <article><h2>Active Members</h2><strong>{dashboard.activeMembers}</strong></article>
        <article><h2>Revenue Today</h2><strong>{formatCurrency(dashboard.dailyRevenue)}</strong></article>
        <article><h2>Revenue This Month</h2><strong>{formatCurrency(dashboard.monthlyRevenue)}</strong></article>
        <article><h2>Overdue Members</h2><strong>{dashboard.overdueMembers}</strong></article>
        <article><h2>Late Fee Exposure</h2><strong>{formatCurrency(dashboard.lateFeeExposure)}</strong></article>
      </section>

      <section className="trend-grid">
        <TrendCard
          title="Revenue trend"
          subtitle="Collections over the last 14 days"
          accent="red"
          points={dashboardTrends.revenueLast14Days}
          valueFormat={formatCurrency}
          actionLabel="Open payments"
          onAction={() => setActiveTab('payments')}
        />
        <TrendCard
          title="Attendance trend"
          subtitle="Present check-ins over the last 14 days"
          accent="blue"
          points={dashboardTrends.attendanceLast14Days}
          actionLabel="Open attendance"
          onAction={() => setActiveTab('attendance')}
        />
        <TrendCard
          title="Member growth"
          subtitle="New joins across the last 6 months"
          accent="blue"
          points={dashboardTrends.memberGrowthLast6Months}
          actionLabel="Open members"
          onAction={() => setActiveTab('members')}
        />
        <TrendCard
          title="Expiring soon"
          subtitle="Active memberships approaching expiry"
          accent="red"
          points={dashboardTrends.expiringBuckets}
          type="bars"
          actionLabel="Open dues"
          onAction={() => setActiveTab('dues')}
        />
        <TrendCard
          title="Payment mix"
          subtitle="How collections arrived this month"
          accent="red"
          points={dashboardTrends.paymentModeBreakdownMonth}
          type="bars"
          valueFormat={formatCurrency}
          actionLabel="Open analytics"
          onAction={() => setActiveTab('analytics')}
        />
      </section>

      <nav className="tabs">
        <button className={activeTab === 'analytics' ? 'tab active' : 'tab'} onClick={() => setActiveTab('analytics')}>Analytics</button>
        <button className={activeTab === 'members' ? 'tab active' : 'tab'} onClick={() => setActiveTab('members')}>Members</button>
        <button className={activeTab === 'payments' ? 'tab active' : 'tab'} onClick={() => setActiveTab('payments')}>Payments</button>
        <button className={activeTab === 'dues' ? 'tab active' : 'tab'} onClick={() => setActiveTab('dues')}>Dues</button>
        <button className={activeTab === 'attendance' ? 'tab active' : 'tab'} onClick={() => setActiveTab('attendance')}>Attendance</button>
        <button className={activeTab === 'trainers' ? 'tab active' : 'tab'} onClick={() => setActiveTab('trainers')}>Trainers</button>
        <button className={activeTab === 'invoices' ? 'tab active' : 'tab'} onClick={() => setActiveTab('invoices')}>Invoices</button>
        <button className={activeTab === 'backup' ? 'tab active' : 'tab'} onClick={() => setActiveTab('backup')}>Backup</button>
        <button className={activeTab === 'settings' ? 'tab active' : 'tab'} onClick={() => setActiveTab('settings')}>Settings</button>
        <button className={activeTab === 'audit' ? 'tab active' : 'tab'} onClick={() => setActiveTab('audit')}>Audit Log</button>
      </nav>

      {error && <p className="error">{error}</p>}
      {status && <p className="status-message">{status}</p>}

      {activeTab === 'analytics' && (
        <section className="analytics-layout">
          <article className="panel analytics-overview-panel">
            <div className="analytics-header">
              <div>
                <p className="trend-kicker">Owner intelligence</p>
                <h2>Trend center</h2>
                <p className="muted">Use these local-first charts to spot slowdowns early and move straight into the right operational screen.</p>
              </div>
              <div className="analytics-chip-grid">
                <div className="analytics-chip">
                  <span>Avg daily revenue</span>
                  <strong>{formatCurrency(analyticsInsights.averageDailyRevenue)}</strong>
                </div>
                <div className="analytics-chip">
                  <span>Avg daily attendance</span>
                  <strong>{analyticsInsights.averageDailyAttendance.toFixed(1)}</strong>
                </div>
                <div className="analytics-chip">
                  <span>Top payment mode</span>
                  <strong>{analyticsInsights.topPaymentMode?.label || 'No data'}</strong>
                </div>
                <div className="analytics-chip">
                  <span>Best growth month</span>
                  <strong>{analyticsInsights.bestGrowthMonth ? `${analyticsInsights.bestGrowthMonth.label} (${analyticsInsights.bestGrowthMonth.value})` : 'No data'}</strong>
                </div>
              </div>
            </div>
          </article>

          <section className="trend-grid analytics-trend-grid">
            <TrendCard
              title="Revenue trend"
              subtitle="Last 14 days"
              accent="red"
              points={dashboardTrends.revenueLast14Days}
              valueFormat={formatCurrency}
              actionLabel="Record payments"
              onAction={() => setActiveTab('payments')}
            />
            <TrendCard
              title="Attendance trend"
              subtitle="Last 14 days"
              accent="blue"
              points={dashboardTrends.attendanceLast14Days}
              actionLabel="Manage attendance"
              onAction={() => setActiveTab('attendance')}
            />
            <TrendCard
              title="Member growth"
              subtitle="Last 6 months"
              accent="blue"
              points={dashboardTrends.memberGrowthLast6Months}
              actionLabel="Open members"
              onAction={() => setActiveTab('members')}
            />
            <TrendCard
              title="Expiring memberships"
              subtitle="Upcoming renewal pressure"
              accent="red"
              points={dashboardTrends.expiringBuckets}
              type="bars"
              actionLabel="Review dues"
              onAction={() => setActiveTab('dues')}
            />
            <TrendCard
              title="Payment mix"
              subtitle="Current month collection channels"
              accent="red"
              points={dashboardTrends.paymentModeBreakdownMonth}
              type="bars"
              valueFormat={formatCurrency}
              actionLabel="Review payments"
              onAction={() => setActiveTab('payments')}
            />
          </section>

          <section className="panel-grid analytics-actions">
            <article className="panel">
              <h2>Recommended actions</h2>
              <div className="action-stack">
                <button type="button" onClick={() => setActiveTab('members')}>Add or update member records</button>
                <button type="button" onClick={() => setActiveTab('payments')}>Record dues and split payments</button>
                <button type="button" onClick={() => setActiveTab('attendance')}>Correct attendance history</button>
                <button type="button" onClick={() => setActiveTab('dues')}>Follow up on overdue accounts</button>
              </div>
            </article>

            <article className="panel">
              <h2>Owner notes</h2>
              <ul className="simple-list">
                <li>Revenue charts exclude voided payments so trend lines stay trustworthy.</li>
                <li>Attendance charts only count present, non-voided check-ins.</li>
                <li>Member growth is based on local join dates, not cloud sync timing.</li>
                <li>Payment mix uses split payments when available, so cash versus digital is more realistic.</li>
              </ul>
            </article>
          </section>
        </section>
      )}

      {activeTab === 'members' && (
        <section className="panel-grid">
          <article className="panel">
            <h2>Add Member</h2>
            <form className="form" onSubmit={handleCreateMember}>
              <label>Name<input required value={memberForm.name} onChange={(event) => setMemberForm((prev) => ({ ...prev, name: event.target.value }))} /></label>
              <label>Phone<input required value={memberForm.phone} onChange={(event) => setMemberForm((prev) => ({ ...prev, phone: event.target.value }))} /></label>
              <label>Join Date<input type="date" required value={memberForm.joinDate} onChange={(event) => setMemberForm((prev) => ({ ...prev, joinDate: event.target.value }))} /></label>
              <label>Plan Type<input required value={memberForm.planType} onChange={(event) => setMemberForm((prev) => ({ ...prev, planType: event.target.value }))} /></label>
              <label>Expiry Date<input type="date" required value={memberForm.expiryDate} onChange={(event) => setMemberForm((prev) => ({ ...prev, expiryDate: event.target.value }))} /></label>
              <label>
                Assigned Trainer
                <select value={memberForm.assignedTrainerId || ''} onChange={(event) => setMemberForm((prev) => ({ ...prev, assignedTrainerId: event.target.value ? Number(event.target.value) : null }))}>
                  <option value="">No Trainer</option>
                  {trainers.filter(t => t.status === 'active').map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>
              <button type="submit">Create Member</button>
            </form>
          </article>

          <article className="panel">
            <h2>Member List</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Plan</th>
                    <th>Expiry</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedMembers.map((member) => (
                    <tr key={member.id}>
                      <td>{member.name}</td>
                      <td>{member.phone}</td>
                      <td>{member.planType}</td>
                      <td>{member.expiryDate}</td>
                      <td>
                        <span className={member.status === 'active' ? 'badge active' : 'badge inactive'}>{member.status}</span>
                        {member.freezeStart && member.freezeEnd ? (
                          <p className="muted">Freeze: {member.freezeStart} to {member.freezeEnd}</p>
                        ) : null}
                      </td>
                      <td>
                        <div className="inline-actions">
                          <button onClick={() => handleToggleMemberStatus(member)}>Mark {member.status === 'active' ? 'Inactive' : 'Active'}</button>
                          {member.freezeStart && member.freezeEnd ? (
                            <button onClick={() => handleUnfreezeMember(member)}>Unfreeze</button>
                          ) : (
                            <button onClick={() => handleFreezeMember(member)}>Freeze</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pager">
              <button onClick={() => setMembersPage((prev) => Math.max(1, prev - 1))} disabled={membersPage <= 1}>Prev</button>
              <span>Page {membersPage} / {totalMembersPages}</span>
              <button onClick={() => setMembersPage((prev) => Math.min(totalMembersPages, prev + 1))} disabled={membersPage >= totalMembersPages}>Next</button>
            </div>
          </article>
        </section>
      )}

      {activeTab === 'payments' && (
        <section className="panel-grid">
          <article className="panel">
            <h2>Add Payment</h2>
            <form className="form" onSubmit={handleCreatePayment}>
              <label>
                Member
                <select value={paymentForm.memberId} onChange={(event) => setPaymentForm((prev) => ({ ...prev, memberId: Number(event.target.value) }))}>
                  {activeMembers.map((member) => (
                    <option key={member.id} value={member.id}>{member.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Amount
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  value={paymentForm.amount || ''}
                  onChange={(event) => setPaymentForm((prev) => ({ ...prev, amount: Number(event.target.value) }))}
                  required
                />
              </label>
              <label>
                Payment Mode
                <select value={paymentForm.paymentMode} onChange={(event) => setPaymentForm((prev) => ({ ...prev, paymentMode: event.target.value as PaymentMode }))}>
                  {paymentModes.map((mode) => (
                    <option key={mode} value={mode}>{mode}</option>
                  ))}
                </select>
              </label>
              <label>Date<input type="date" value={paymentForm.date} onChange={(event) => setPaymentForm((prev) => ({ ...prev, date: event.target.value }))} /></label>
              <label>Late Fee<input type="number" min="0" step="0.01" value={paymentForm.lateFee || 0} onChange={(event) => setPaymentForm((prev) => ({ ...prev, lateFee: Number(event.target.value || 0) }))} /></label>
              <label className="check-inline">
                <input
                  type="checkbox"
                  checked={Boolean(paymentForm.applyLateFee)}
                  onChange={(event) => setPaymentForm((prev) => ({ ...prev, applyLateFee: event.target.checked }))}
                />
                Auto-calculate late fee from overdue rule
              </label>
              <label>Notes<textarea value={paymentForm.notes} onChange={(event) => setPaymentForm((prev) => ({ ...prev, notes: event.target.value }))} /></label>
              <label className="check-inline">
                <input
                  type="checkbox"
                  checked={Boolean(paymentForm.generateInvoice)}
                  onChange={(event) => setPaymentForm((prev) => ({ ...prev, generateInvoice: event.target.checked }))}
                />
                Generate invoice PDF
              </label>
              <button type="submit">Record Payment</button>
            </form>
          </article>

          <article className="panel">
            <h2>Recent Payments</h2>
            <div className="inline-actions" style={{ marginBottom: 10 }}>
              <button onClick={handleGenerateZReport}>Generate Daily Z-Report</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Member</th>
                    <th>Mode</th>
                    <th>Total</th>
                    <th>Late Fee</th>
                    <th>Status</th>
                    <th>Invoice</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedPayments.map((payment) => (
                    <tr key={payment.id}>
                      <td>{payment.date}</td>
                      <td>{payment.memberName}</td>
                      <td>{payment.paymentMode}</td>
                      <td>{formatCurrency(payment.amount)}</td>
                      <td>{formatCurrency(payment.lateFee)}</td>
                      <td>{payment.voidedAt ? <span className="badge inactive">voided</span> : <span className="badge active">posted</span>}</td>
                      <td>
                        {payment.invoicePath ? (
                          <button onClick={() => openFilePath(payment.invoicePath!)}>Open PDF</button>
                        ) : (
                          <span className="muted">Not generated</span>
                        )}
                      </td>
                      <td>
                        {payment.voidedAt ? (
                          <span className="muted">Voided</span>
                        ) : (
                          <button onClick={() => handleVoidPayment(payment.id)}>Void</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pager">
              <button onClick={() => setPaymentsPage((prev) => Math.max(1, prev - 1))} disabled={paymentsPage <= 1}>Prev</button>
              <span>Page {paymentsPage} / {totalPaymentsPages}</span>
              <button onClick={() => setPaymentsPage((prev) => Math.min(totalPaymentsPages, prev + 1))} disabled={paymentsPage >= totalPaymentsPages}>Next</button>
            </div>
          </article>
        </section>
      )}

      {activeTab === 'attendance' && (
        <section className="panel-grid">
          <article className="panel">
            <h2>Mark Check-In</h2>
            <div className="form">
              <label>
                Member
                <select value={attendanceMemberId} onChange={(event) => setAttendanceMemberId(Number(event.target.value))}>
                  {activeMembers.map((member) => (
                    <option key={member.id} value={member.id}>{member.name}</option>
                  ))}
                </select>
              </label>
              <button onClick={handleCheckIn}>Check In</button>
            </div>

            <h3>Expiring Soon</h3>
            {expiringMembers.length === 0 ? <p className="muted">No active members expiring in next 7 days.</p> : (
              <ul className="simple-list">
                {expiringMembers.map((member) => (
                  <li key={member.id}>{member.name} ({member.expiryDate})</li>
                ))}
              </ul>
            )}
          </article>

          <article className="panel">
            <h2>Today Attendance ({todayAttendance.total})</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Phone</th>
                    <th>Check-In Time</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {todayAttendance.rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.memberName}</td>
                      <td>{row.phone}</td>
                      <td>{new Date(row.checkInTime).toLocaleTimeString()}</td>
                      <td>
                        {row.voidedAt ? (
                          <span className="badge inactive" title={row.voidReason || ''}>Voided</span>
                        ) : (
                          <span className="badge active">Present</span>
                        )}
                      </td>
                      <td>
                        {!row.voidedAt && (
                          <button className="theme-btn" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }} onClick={() => handleVoidAttendance(row.id)}>Void</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      )}

      {activeTab === 'dues' && (
        <section className="panel-grid">
          <article className="panel">
            <h2>Dues Summary</h2>
            <p>Overdue members: <strong>{duesSummary.overdueCount}</strong></p>
            <p>Late fee exposure: <strong>{formatCurrency(duesSummary.totalLateFeeExposure)}</strong></p>
            <p>Rule enabled: <strong>{duesSummary.lateFeeSettings.enabled ? 'Yes' : 'No'}</strong></p>
            <p>Grace days: <strong>{duesSummary.lateFeeSettings.graceDays}</strong></p>
            <p>Fee/day: <strong>{formatCurrency(duesSummary.lateFeeSettings.perDay)}</strong></p>
            <p>Max fee: <strong>{formatCurrency(duesSummary.lateFeeSettings.maxFee)}</strong></p>
          </article>

          <article className="panel">
            <h2>Overdue Members</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Plan</th>
                    <th>Expiry</th>
                    <th>Days Overdue</th>
                    <th>Late Fee</th>
                  </tr>
                </thead>
                <tbody>
                  {duesRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{row.phone}</td>
                      <td>{row.planType}</td>
                      <td>{row.expiryDate}</td>
                      <td>{row.daysOverdue}</td>
                      <td>{formatCurrency(row.lateFee)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      )}

      {activeTab === 'trainers' && (
        <section className="panel-grid">
          <article className="panel">
            <h2>Add Trainer</h2>
            <form className="form" onSubmit={handleCreateTrainer}>
              <label>Name<input required value={trainerForm.name} onChange={(event) => setTrainerForm((prev) => ({ ...prev, name: event.target.value }))} /></label>
              <label>Phone<input required value={trainerForm.phone} onChange={(event) => setTrainerForm((prev) => ({ ...prev, phone: event.target.value }))} /></label>
              <label>Base Salary (Month)<input type="number" min="0" required value={trainerForm.baseSalary || ''} onChange={(event) => setTrainerForm((prev) => ({ ...prev, baseSalary: Number(event.target.value) }))} /></label>
              <button type="submit">Create Trainer</button>
            </form>
            
            <hr style={{ margin: '20px 0', borderColor: 'var(--border)' }} />

            <h3>Trainers ({trainers.length})</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Salary</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {trainers.map((t) => (
                    <tr key={t.id}>
                      <td>{t.name}</td>
                      <td>{t.phone}</td>
                      <td>{formatCurrency(t.baseSalary)}</td>
                      <td><span className={t.status === 'active' ? 'badge active' : 'badge inactive'}>{t.status}</span></td>
                      <td>
                        <div className="inline-actions">
                          <button onClick={() => handleToggleTrainerStatus(t)}>Toggle</button>
                          <button className="theme-btn" onClick={() => handleTrainerCheckIn(t.id)} disabled={t.status !== 'active'}>Check-In</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="panel">
            <h2>Trainer Check-Ins Today ({todayTrainerAttendance.length})</h2>
            <p className="muted">Use this to track employee hours and audit pay.</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Arrival Time</th>
                  </tr>
                </thead>
                <tbody>
                  {todayTrainerAttendance.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{new Date(row.checkInTime).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      )}

      {activeTab === 'invoices' && (
        <section className="panel-grid">
          <article className="panel">
            <h2>Invoices</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Member</th>
                    <th>Created</th>
                    <th>Sent</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td>{invoice.id}</td>
                      <td>{invoice.memberName}</td>
                      <td>{new Date(invoice.createdAt).toLocaleString()}</td>
                      <td>{invoice.sentCount}</td>
                      <td>
                        <div className="inline-actions">
                          <button onClick={() => openFilePath(invoice.filePath)}>Open PDF</button>
                          {dispatchChannels.map((channel) => (
                            <button key={channel} onClick={() => handleMarkInvoiceDispatch(invoice.id, channel)}>
                              Mark {channel}
                            </button>
                          ))}
                          <button onClick={() => handleLoadDispatchHistory(invoice.id)}>History</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="panel">
            <h2>Dispatch History {selectedInvoiceIdForHistory ? `(Invoice #${selectedInvoiceIdForHistory})` : ''}</h2>
            {dispatchHistory.length === 0 ? (
              <p className="muted">No dispatch events selected.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Channel</th>
                      <th>Status</th>
                      <th>Destination</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dispatchHistory.map((item) => (
                      <tr key={item.id}>
                        <td>{new Date(item.createdAt).toLocaleString()}</td>
                        <td>{item.channel}</td>
                        <td>{item.status}</td>
                        <td>{item.destination || '-'}</td>
                        <td>{item.error || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        </section>
      )}

      {activeTab === 'backup' && (
        <section className="panel-grid">
          <article className="panel">
            <h2>Backup</h2>
            <p>Daily auto-backup is scheduled at 2:00 AM (local time). You can create manual backups anytime.</p>
            <button onClick={handleCreateBackup}>Create Manual Backup</button>
          </article>

          <article className="panel">
            <h2>Available Backups</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Modified</th>
                    <th>Size (KB)</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((backup) => (
                    <tr key={backup.filePath}>
                      <td>{backup.file}</td>
                      <td>{new Date(backup.modifiedAt).toLocaleString()}</td>
                      <td>{(backup.size / 1024).toFixed(1)}</td>
                      <td>
                        <button onClick={() => handleRestoreBackup(backup.filePath)}>Restore</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      )}

      {activeTab === 'settings' && settings && (
        <section className="panel-grid">
          <article className="panel">
            <h2>Operational Settings</h2>
            <form className="form" onSubmit={handleSaveSettings}>
              <label className="check-inline">
                <input
                  type="checkbox"
                  checked={settingsForm.lateFeeEnabled}
                  onChange={(event) => setSettingsForm((prev) => ({ ...prev, lateFeeEnabled: event.target.checked }))}
                />
                Enable late fee rules
              </label>
              <label>Grace Days<input type="number" min="0" value={settingsForm.graceDays} onChange={(event) => setSettingsForm((prev) => ({ ...prev, graceDays: Number(event.target.value || 0) }))} /></label>
              <label>Late Fee Per Day<input type="number" min="0" step="0.01" value={settingsForm.perDay} onChange={(event) => setSettingsForm((prev) => ({ ...prev, perDay: Number(event.target.value || 0) }))} /></label>
              <label>Late Fee Max<input type="number" min="0" step="0.01" value={settingsForm.maxFee} onChange={(event) => setSettingsForm((prev) => ({ ...prev, maxFee: Number(event.target.value || 0) }))} /></label>
              <label>Backups to Keep<input type="number" min="1" value={settingsForm.backupKeepLast} onChange={(event) => setSettingsForm((prev) => ({ ...prev, backupKeepLast: Number(event.target.value || 1) }))} /></label>
              <label>Backup Offsite Path<input value={settingsForm.backupOffsitePath} onChange={(event) => setSettingsForm((prev) => ({ ...prev, backupOffsitePath: event.target.value }))} placeholder="D:\\Backups\\Gym (or synced drive folder)" /></label>
              <label>Auto-lock Timeout (minutes)<input type="number" min="1" value={settingsForm.lockTimeoutMinutes} onChange={(event) => setSettingsForm((prev) => ({ ...prev, lockTimeoutMinutes: Number(event.target.value || 1) }))} /></label>
              <label className="check-inline">
                <input
                  type="checkbox"
                  checked={settingsForm.notificationEnabled}
                  onChange={(event) => setSettingsForm((prev) => ({ ...prev, notificationEnabled: event.target.checked }))}
                />
                Enable notifications
              </label>
              <label>Reminder Days Before Expiry<input type="number" min="1" value={settingsForm.notificationExpiryDaysBefore} onChange={(event) => setSettingsForm((prev) => ({ ...prev, notificationExpiryDaysBefore: Number(event.target.value || 1) }))} /></label>
              <label>
                Notification Channel
                <select value={settingsForm.notificationChannel} onChange={(event) => setSettingsForm((prev) => ({ ...prev, notificationChannel: event.target.value as 'whatsapp' | 'sms' }))}>
                  <option value="whatsapp">whatsapp</option>
                  <option value="sms">sms</option>
                </select>
              </label>
              <label>
                Notification Dispatch Mode
                <select value={settingsForm.notificationDispatchMode} onChange={(event) => setSettingsForm((prev) => ({ ...prev, notificationDispatchMode: event.target.value as 'desktop' | 'cloud' }))}>
                  <option value="desktop">desktop (local scheduler)</option>
                  <option value="cloud">cloud (recommended with sync)</option>
                </select>
              </label>
              <label className="check-inline">
                <input
                  type="checkbox"
                  checked={settingsForm.syncEnabled}
                  onChange={(event) => setSettingsForm((prev) => ({ ...prev, syncEnabled: event.target.checked }))}
                />
                Enable cloud sync
              </label>
              <label>Cloud API URL<input value={settingsForm.syncCloudUrl} onChange={(event) => setSettingsForm((prev) => ({ ...prev, syncCloudUrl: event.target.value }))} placeholder="https://your-cloud.example.com" /></label>
              <label>Sync API Token<input type="password" value={settingsForm.syncApiToken} onChange={(event) => setSettingsForm((prev) => ({ ...prev, syncApiToken: event.target.value }))} placeholder="Leave blank to keep existing token" /></label>
              <p className="muted">Saved API token: {settingsForm.syncHasApiToken ? 'configured' : 'not configured'}</p>
              <label className="check-inline">
                <input
                  type="checkbox"
                  checked={settingsForm.clearSyncApiToken}
                  onChange={(event) => setSettingsForm((prev) => ({ ...prev, clearSyncApiToken: event.target.checked }))}
                />
                Clear saved API token
              </label>
              <label>Sync HMAC Secret<input type="password" value={settingsForm.syncHmacSecret} onChange={(event) => setSettingsForm((prev) => ({ ...prev, syncHmacSecret: event.target.value }))} placeholder="Leave blank to keep existing secret" /></label>
              <p className="muted">Saved HMAC secret: {settingsForm.syncHasHmacSecret ? 'configured' : 'not configured'}</p>
              <label className="check-inline">
                <input
                  type="checkbox"
                  checked={settingsForm.clearSyncHmacSecret}
                  onChange={(event) => setSettingsForm((prev) => ({ ...prev, clearSyncHmacSecret: event.target.checked }))}
                />
                Clear saved HMAC secret
              </label>
              <label>Sync Interval (minutes)<input type="number" min="5" value={settingsForm.syncIntervalMinutes} onChange={(event) => setSettingsForm((prev) => ({ ...prev, syncIntervalMinutes: Number(event.target.value || 5) }))} /></label>
              <label>Sync Retry Max Attempts<input type="number" min="1" value={settingsForm.syncRetryMaxAttempts} onChange={(event) => setSettingsForm((prev) => ({ ...prev, syncRetryMaxAttempts: Number(event.target.value || 1) }))} /></label>
              <label>Sync Retry Base Delay (sec)<input type="number" min="5" value={settingsForm.syncRetryBaseDelaySeconds} onChange={(event) => setSettingsForm((prev) => ({ ...prev, syncRetryBaseDelaySeconds: Number(event.target.value || 5) }))} /></label>
              <label>Sync Circuit Breaker Threshold<input type="number" min="1" value={settingsForm.syncCircuitBreakerThreshold} onChange={(event) => setSettingsForm((prev) => ({ ...prev, syncCircuitBreakerThreshold: Number(event.target.value || 1) }))} /></label>
              <label>Sync Circuit Breaker Cooldown (minutes)<input type="number" min="1" value={settingsForm.syncCircuitBreakerCooldownMinutes} onChange={(event) => setSettingsForm((prev) => ({ ...prev, syncCircuitBreakerCooldownMinutes: Number(event.target.value || 1) }))} /></label>
              <label className="check-inline">
                <input
                  type="checkbox"
                  checked={settingsForm.syncMaskPhone}
                  onChange={(event) => setSettingsForm((prev) => ({ ...prev, syncMaskPhone: event.target.checked }))}
                />
                Mask phone in sync payload
              </label>
              <button type="submit">Save Settings</button>
            </form>
          </article>

          <article className="panel">
            <h2>Security PIN</h2>
            {!securityStatus.pinSet ? (
              <form className="form" onSubmit={handleSetupPin}>
                <label>PIN (4-8 digits)<input type="password" value={setupPin} onChange={(event) => setSetupPin(event.target.value)} /></label>
                <label>Confirm PIN<input type="password" value={setupPinConfirm} onChange={(event) => setSetupPinConfirm(event.target.value)} /></label>
                <button type="submit">Setup PIN</button>
              </form>
            ) : (
              <form className="form" onSubmit={handleChangePin}>
                <p>PIN is configured.</p>
                <label>Current PIN<input type="password" value={changeCurrentPin} onChange={(event) => setChangeCurrentPin(event.target.value)} /></label>
                <label>New PIN<input type="password" value={changeNewPin} onChange={(event) => setChangeNewPin(event.target.value)} /></label>
                <button type="submit">Change PIN</button>
              </form>
            )}
          </article>

          <article className="panel">
            <h2>Operations</h2>
            <div className="inline-actions">
              <button onClick={handleRunNotificationsNow}>Run Notifications Now</button>
              <button onClick={handleRunSyncNow}>Run Sync Now</button>
              <button onClick={handleRetryFailedSyncOutbox}>Retry Failed Outbox</button>
            </div>
            <p className="muted">Latest sync: {syncStatus?.latest ? `${syncStatus.latest.status} (${new Date(syncStatus.latest.createdAt).toLocaleString()})` : 'No sync yet'}</p>
            <p className="muted">Last sync success: {syncStatus?.settings.lastSuccessAt ? new Date(syncStatus.settings.lastSuccessAt).toLocaleString() : 'Never'}</p>
            <p className="muted">Outbox: pending={syncStatus?.outbox?.pending ?? 0}, failed={syncStatus?.outbox?.failed ?? 0}, completed={syncStatus?.outbox?.completed ?? 0}</p>
            <p className="muted">Sync auth configured: token={syncStatus?.settings.hasApiToken ? 'yes' : 'no'}, hmac={syncStatus?.settings.hasHmacSecret ? 'yes' : 'no'}</p>
            <p className="muted">Sync breaker: failureStreak={syncStatus?.settings.circuitBreaker.failureStreak ?? 0}, threshold={syncStatus?.settings.circuitBreaker.threshold ?? 0}, cooldown={syncStatus?.settings.circuitBreaker.cooldownMinutes ?? 0} min</p>
            <p className="muted">Sync pause until: {syncStatus?.settings.circuitBreaker.pausedUntil ? new Date(syncStatus.settings.circuitBreaker.pausedUntil).toLocaleString() : 'Not paused'}</p>
            <p className="muted">Notification dispatch mode: {settingsForm.notificationDispatchMode}</p>
            <p className="muted">Notifications last sweep: {notificationHealth.lastSweepAt ? new Date(notificationHealth.lastSweepAt).toLocaleString() : 'Never'}</p>
            <p className="muted">Notification queue: pending={notificationHealth.queue?.pending ?? 0}, processing={notificationHealth.queue?.processing ?? 0}, failed={notificationHealth.queue?.failed ?? 0}</p>
            {settingsForm.notificationDispatchMode === 'cloud' ? (
              <p className="muted">Cloud mode is active. Reminder dispatch is expected from cloud worker, not this desktop process.</p>
            ) : notificationHealth.staleToday ? (
              <p className="error">Notification sweep has not run today. Startup catch-up is enabled, but verify app uptime around business hours.</p>
            ) : null}
            <h3>System Health</h3>
            <p className="muted">Last sync success: {systemHealth?.lastSyncSuccessAt ? new Date(systemHealth.lastSyncSuccessAt).toLocaleString() : 'Never'}</p>
            <p className="muted">Failed sync count: {systemHealth?.failedSyncCount ?? 0}</p>
            <p className="muted">Outbox pressure: pending={systemHealth?.outbox.pending ?? 0}, failed={systemHealth?.outbox.failed ?? 0}</p>
            <p className="muted">Notification failures: {systemHealth?.notifications.failed ?? 0} (pending: {systemHealth?.notifications.pending ?? 0})</p>
            <p className="muted">Last backup: {systemHealth?.lastBackup ? `${systemHealth.lastBackup.status} at ${new Date(systemHealth.lastBackup.createdAt).toLocaleString()}` : 'No backup job log yet'}</p>
            <p className="muted">Data-at-rest encryption: {systemHealth?.encryption?.ok ? 'enabled' : `not confirmed (${systemHealth?.encryption?.mode || 'unknown'})`}</p>
            <h3>Sync Outbox</h3>
            {syncOutbox.length === 0 ? (
              <p className="muted">No queued sync items.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Status</th>
                      <th>Attempts</th>
                      <th>Next Attempt</th>
                      <th>Error</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncOutbox.map((row) => (
                      <tr key={row.id}>
                        <td>{row.id}</td>
                        <td>{row.status}</td>
                        <td>{row.attempts}</td>
                        <td>{formatDateTime(row.nextAttemptAt)}</td>
                        <td>{row.lastError || '-'}</td>
                        <td>
                          <button onClick={() => handleRetrySingleSyncOutbox(row.id)} disabled={row.status !== 'failed' && row.status !== 'pending'}>
                            Retry Item
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <h3>Recent Notification Logs</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Channel</th>
                    <th>Recipient</th>
                    <th>Status</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {notificationLogs.map((row) => (
                    <tr key={row.id}>
                      <td>{new Date(row.createdAt).toLocaleString()}</td>
                      <td>{row.channel}</td>
                      <td>{row.recipient}</td>
                      <td>{row.status}</td>
                      <td>{row.error || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      )}

      {activeTab === 'audit' && (
        <section className="panel">
          <h2>Recent Audit Logs</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td>{new Date(log.createdAt).toLocaleString()}</td>
                    <td>{log.action}</td>
                    <td>{log.entity}</td>
                    <td className="details-cell">{safeJson(log.details)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {isLocked && (
        <div className="lock-overlay">
          <div className="lock-card">
            <h2>Application Locked</h2>
            <p>Enter your PIN to continue.</p>
            <form className="form" onSubmit={handleUnlock}>
              <label>
                PIN
                <input type="password" value={unlockPin} onChange={(event) => setUnlockPin(event.target.value)} autoFocus />
              </label>
              <button type="submit">Unlock</button>
            </form>
          </div>
        </div>
      )}

      {isBusy ? (
        <div className="busy-overlay">
          <div className="busy-card">
            <h3>Processing</h3>
            <p>{busyAction}</p>
          </div>
        </div>
      ) : null}
    </main>
  );
}


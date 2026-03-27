const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_CHANNELS = new Set([
  'members:list',
  'members:create',
  'members:update-status',
  'members:freeze',
  'members:unfreeze',
  'payments:list',
  'payments:summary',
  'payments:create',
  'payments:void',
  'payments:z-report',
  'dues:list-overdue',
  'dues:summary',
  'dues:calculate-member',
  'attendance:check-in',
  'attendance:today',
  'attendance:void',
  'trainers:list',
  'trainers:create',
  'trainers:update-status',
  'trainers:attendance-check-in',
  'trainers:attendance-today',
  'dashboard:overview',
  'dashboard:trends',
  'dashboard:expiring-members',
  'invoices:list',
  'invoices:by-payment',
  'invoices:mark-sent',
  'invoices:dispatch-history',
  'backup:create',
  'backup:list',
  'backup:restore',
  'notifications:status',
  'notifications:logs',
  'notifications:run-now',
  'sync:status',
  'sync:logs',
  'sync:outbox',
  'sync:retry-failed',
  'sync:retry-item',
  'sync:preview',
  'sync:run-now',
  'security:status',
  'security:setup-pin',
  'security:verify-pin',
  'security:change-pin',
  'security:lock',
  'settings:get',
  'settings:update',
  'audit:recent',
  'system:open-path',
  'system:clock-health',
  'system:health'
]);

function safeInvoke(channel, payload) {
  if (!ALLOWED_CHANNELS.has(channel)) {
    throw new Error(`Blocked IPC channel: ${channel}`);
  }
  return ipcRenderer.invoke(channel, payload);
}

contextBridge.exposeInMainWorld('gymApi', {
  members: {
    list: () => safeInvoke('members:list'),
    create: (payload) => safeInvoke('members:create', payload),
    updateStatus: (payload) => safeInvoke('members:update-status', payload),
    freeze: (payload) => safeInvoke('members:freeze', payload),
    unfreeze: (payload) => safeInvoke('members:unfreeze', payload)
  },
  payments: {
    list: () => safeInvoke('payments:list'),
    summary: () => safeInvoke('payments:summary'),
    create: (payload) => safeInvoke('payments:create', payload),
    void: (payload) => safeInvoke('payments:void', payload),
    zReport: (payload) => safeInvoke('payments:z-report', payload)
  },
  dues: {
    listOverdue: () => safeInvoke('dues:list-overdue'),
    summary: () => safeInvoke('dues:summary'),
    calculateMember: (payload) => safeInvoke('dues:calculate-member', payload)
  },
  attendance: {
    checkIn: (payload) => safeInvoke('attendance:check-in', payload),
    today: () => safeInvoke('attendance:today'),
    void: (payload) => safeInvoke('attendance:void', payload)
  },
  trainers: {
    list: () => safeInvoke('trainers:list'),
    create: (payload) => safeInvoke('trainers:create', payload),
    updateStatus: (payload) => safeInvoke('trainers:update-status', payload),
    checkIn: (payload) => safeInvoke('trainers:attendance-check-in', payload),
    attendanceToday: () => safeInvoke('trainers:attendance-today')
  },
  dashboard: {
    overview: () => safeInvoke('dashboard:overview'),
    trends: () => safeInvoke('dashboard:trends'),
    expiringMembers: () => safeInvoke('dashboard:expiring-members')
  },
  invoices: {
    list: () => safeInvoke('invoices:list'),
    byPayment: (payload) => safeInvoke('invoices:by-payment', payload),
    markSent: (payload) => safeInvoke('invoices:mark-sent', payload),
    dispatchHistory: (payload) => safeInvoke('invoices:dispatch-history', payload)
  },
  backup: {
    create: () => safeInvoke('backup:create'),
    list: () => safeInvoke('backup:list'),
    restore: (payload) => safeInvoke('backup:restore', payload)
  },
  notifications: {
    status: () => safeInvoke('notifications:status'),
    logs: (payload) => safeInvoke('notifications:logs', payload),
    runNow: () => safeInvoke('notifications:run-now')
  },
  sync: {
    status: () => safeInvoke('sync:status'),
    logs: (payload) => safeInvoke('sync:logs', payload),
    outbox: (payload) => safeInvoke('sync:outbox', payload),
    retryFailed: (payload) => safeInvoke('sync:retry-failed', payload),
    retryItem: (payload) => safeInvoke('sync:retry-item', payload),
    preview: () => safeInvoke('sync:preview'),
    runNow: () => safeInvoke('sync:run-now')
  },
  security: {
    status: () => safeInvoke('security:status'),
    setupPin: (payload) => safeInvoke('security:setup-pin', payload),
    verifyPin: (payload) => safeInvoke('security:verify-pin', payload),
    changePin: (payload) => safeInvoke('security:change-pin', payload),
    lock: () => safeInvoke('security:lock')
  },
  settings: {
    get: () => safeInvoke('settings:get'),
    update: (payload) => safeInvoke('settings:update', payload)
  },
  audit: {
    recent: (payload) => safeInvoke('audit:recent', payload)
  },
  system: {
    openPath: (payload) => safeInvoke('system:open-path', payload),
    clockHealth: () => safeInvoke('system:clock-health'),
    health: () => safeInvoke('system:health')
  }
});

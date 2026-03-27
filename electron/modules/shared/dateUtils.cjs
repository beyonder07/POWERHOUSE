function nowIso() {
  return new Date().toISOString();
}

function todayDate() {
  return nowIso().slice(0, 10);
}

function monthKey() {
  return todayDate().slice(0, 7);
}

function toSafeFileTimeStamp() {
  return nowIso().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '_');
}

function isDateFormat(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

module.exports = {
  nowIso,
  todayDate,
  monthKey,
  toSafeFileTimeStamp,
  isDateFormat
};

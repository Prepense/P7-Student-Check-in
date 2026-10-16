export const DOMAIN = 'rmuti.ac.th';

export function navigationViews(mode, user) {
  if (mode === 'demo' || !user) return ['teacher', 'student'];
  return ['instructor', 'admin'].includes(user.role) ? ['teacher'] : ['student'];
}

export function qrTokenFromText(value, allowDemo = false) {
  let token = String(value ?? '').trim();
  if (/^https?:\/\//i.test(token)) {
    const link = new URL(token);
    if (link.username || link.password || link.searchParams.getAll('t').length !== 1) throw new Error('ไม่ใช่ QR เช็คชื่อ');
    if (link.searchParams.has('demo') && !allowDemo) throw new Error('QR ตัวอย่างใช้กับระบบจริงไม่ได้');
    token = link.searchParams.get('t') || '';
  }
  if (token.startsWith('demo-')) {
    if (!allowDemo) throw new Error('QR ตัวอย่างใช้กับระบบจริงไม่ได้');
    if (!/^demo-[A-Za-z0-9_-]+$/.test(token)) throw new Error('ไม่ใช่ QR เช็คชื่อ');
  } else if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token) || token.length > 8192) {
    throw new Error('ลิงก์หรือโทเคน QR ไม่ครบ กรุณาสแกนใหม่');
  }
  return token;
}

export function validateStudents(rows, domain = DOMAIN) {
  const ids = new Set();
  const emails = new Set();
  return rows.map((row) => {
    const student_id = String(row.student_id ?? '').trim();
    const student_name = String(row.student_name ?? '').trim();
    const student_email = String(row.student_email ?? '').trim().toLowerCase();
    const errors = [];
    const key = student_id.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    if (!/^[A-Za-z0-9-]+$/.test(student_id)) errors.push('รหัสนักศึกษาไม่ถูกต้อง');
    if (!student_name || student_name.includes('\uFFFD')) errors.push('ชื่อว่างหรืออักขระเสียหาย');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(student_email)) errors.push('อีเมลไม่ถูกต้อง');
    else if (domain && !student_email.endsWith(`@${domain.toLowerCase()}`)) errors.push(`ต้องใช้อีเมล @${domain}`);
    if (ids.has(key)) errors.push('รหัสนักศึกษาซ้ำ');
    if (student_email && emails.has(student_email)) errors.push('อีเมลซ้ำ');
    ids.add(key);
    emails.add(student_email);
    return { student_id, student_name, student_email, errors };
  });
}

export function sessionTimes(data) {
  const fields = ['checkin_open_time', 'start_time', 'late_cutoff_time', 'checkin_close_time'];
  const values = fields.map((field) => new Date(data[field]).getTime());
  if (values.some((value) => !Number.isFinite(value)) || values.some((value, i) => i && value < values[i - 1])) {
    throw new Error('ลำดับเวลาต้องเป็น เปิดรับ <= เริ่มเรียน <= เกณฑ์สาย <= ปิดรับ');
  }
  return Object.fromEntries(fields.map((field, i) => [field, new Date(values[i]).toISOString()]));
}

export function sessionMinuteOffsets(row) {
  const start = new Date(row.start_time).getTime();
  return { late_minutes: (new Date(row.late_cutoff_time).getTime() - start) / 60000,
    close_minutes: (new Date(row.checkin_close_time).getTime() - start) / 60000 };
}

export function sessionTimesFromMinutes(data, original = null) {
  const values = Object.fromEntries(['checkin_open_time', 'start_time'].map((name) => {
    const value = dateTimeFromParts(data, name);
    const old = original && new Date(original[name]);
    return [name, old && Date.parse(value) === old.setSeconds(0, 0) ? original[name] : value];
  }));
  const previous = original && sessionMinuteOffsets(original);
  for (const [field, input] of [['late_cutoff_time', 'late_minutes'], ['checkin_close_time', 'close_minutes']]) {
    const text = String(data[input] ?? '').trim();
    const minutes = Number(text);
    if (!/^\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(minutes) || minutes < 0) throw new Error('เกณฑ์สายและปิดรับต้องเป็นจำนวนนาทีตั้งแต่ 0 ขึ้นไป');
    const deadline = new Date(Date.parse(values.start_time) + Math.round(minutes * 60000));
    if (!Number.isFinite(deadline.getTime())) throw new Error('จำนวนนาทีมากเกินไป');
    values[field] = previous && values.start_time === original.start_time && minutes === previous[input]
      ? original[field] : deadline.toISOString();
  }
  return sessionTimes(values);
}

export function attendanceRows(enrollments, attendance) {
  const byId = new Map(attendance.map((row) => [row.student_id, row]));
  return orderedRoster(enrollments.filter((row) => row.status === 'ACTIVE')).map((row) => ({
    ...row, attendance_status: byId.get(row.student_id)?.attendance_status || 'PENDING',
    checkin_time: byId.get(row.student_id)?.checkin_time || null,
    leave_note: byId.get(row.student_id)?.leave_note || '',
    leave_approved_at: byId.get(row.student_id)?.leave_approved_at || null,
    source: byId.get(row.student_id)?.source || '',
    attendance_version: byId.get(row.student_id)?.attendance_version || null,
  }));
}

export function orderedRoster(rows) {
  return [...rows].sort((a, b) => String(b.roster_imported_at || '').localeCompare(String(a.roster_imported_at || '')) ||
    (a.roster_order ?? Number.MAX_SAFE_INTEGER) - (b.roster_order ?? Number.MAX_SAFE_INTEGER) ||
    String(a.student_id).localeCompare(String(b.student_id), 'en', { numeric: true }));
}

export const attendanceScore = (status) => ['ON_TIME', 'LEAVE_APPROVED'].includes(status) ? 1 : 0;

export function sessionDefaults(previous, now = Date.now()) {
  const anchor = new Date(now);
  if (previous) { const start = new Date(previous.start_time); anchor.setHours(start.getHours(), start.getMinutes(), 0, 0); }
  const start = previous ? anchor.getTime() : now;
  return { checkin_open_time: start + (previous ? Date.parse(previous.checkin_open_time) - Date.parse(previous.start_time) : -60000),
    start_time: start, late_cutoff_time: start + 15 * 60000, checkin_close_time: start + 30 * 60000 };
}

export function sessionStatus(row, now = Date.now()) {
  if (['OPEN', 'LATE'].includes(row.status) && now > Date.parse(row.checkin_close_time)) return 'CLOSED';
  return row.status;
}

export function scoreSummary(enrollments, sessions, attendance) {
  const rounds = [...sessions].sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time) || a.id.localeCompare(b.id));
  const scores = new Map();
  const notes = new Map();
  for (const row of attendance) {
    const key = JSON.stringify([row.session_id, row.student_id]);
    scores.set(key, Math.max(scores.get(key) || 0, attendanceScore(row.attendance_status)));
    if (row.attendance_status === 'LEAVE_APPROVED') notes.set(key, `LEAVE_APPROVED: ${row.leave_note || ''}`);
  }
  return {
    rounds,
    rows: orderedRoster(enrollments.filter((row) => row.status === 'ACTIVE')).map((row) => {
      const points = rounds.map((round) => scores.get(JSON.stringify([round.id, row.student_id])) || 0);
      return { ...row, points, notes: rounds.map((round) => notes.get(JSON.stringify([round.id, row.student_id])) || ''), total: points.reduce((sum, point) => sum + point, 0) };
    }),
  };
}

export function dateTimeFromParts(data, name) {
  const day = data[`${name}_date`], hour = data[`${name}_hour`], minute = data[`${name}_minute`];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '') || !/^(?:[01]\d|2[0-3])$/.test(hour || '') || !/^[0-5]\d$/.test(minute || '')) {
    throw new Error('วันที่หรือเวลาไม่ถูกต้อง');
  }
  const value = `${day}T${hour}:${minute}`;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getFullYear() !== Number(day.slice(0, 4)) ||
      date.getMonth() + 1 !== Number(day.slice(5, 7)) || date.getDate() !== Number(day.slice(8, 10))) throw new Error('วันที่หรือเวลาไม่ถูกต้อง');
  return value;
}

export function csvText(rows) {
  const cell = (value) => {
    let text = String(value ?? '');
    if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + rows.map((row) => row.map(cell).join(',')).join('\r\n');
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

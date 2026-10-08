export const DOMAIN = 'rmuti.ac.th';

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

export function attendanceRows(enrollments, attendance) {
  const byId = new Map(attendance.map((row) => [row.student_id, row]));
  return enrollments.filter((row) => row.status === 'ACTIVE').map((row) => ({
    ...row, attendance_status: 'PENDING', checkin_time: null, ...byId.get(row.student_id),
  }));
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

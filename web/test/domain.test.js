import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStudents, sessionTimes, attendanceRows, attendanceScore, scoreSummary, sessionStatus, dateTimeFromParts, csvText, qrTokenFromText, escapeHtml } from '../src/domain.js';
import { demoApi, demoCheckIn, seedDemo } from '../src/demo.js';

const student = { student_id: 'DEMO-001', student_name: 'Student Example', student_email: 'student.example@rmuti.ac.th' };
test('QR parsing preserves every case-sensitive token byte through links and paste', () => {
  const token = `eYj_-ABCdef.${'a_B-cDe'.repeat(6)}X`;
  const url = new URL('https://prepense.github.io/P7-Student-Check-in/'); url.searchParams.set('t', token);
  assert.equal(qrTokenFromText(url.href), token);
  assert.equal(qrTokenFromText(` ${token}\n`), token);
  for (const value of ['https://example.com/', 'javascript:alert(1)', `${url.href}&t=another`, token.replace('.', '\n.'), token.replace('-', '\u2013'), 'short.signature']) {
    assert.throws(() => qrTokenFromText(value));
  }
});
test('live QR parsing never accepts offline display or demo tokens', () => {
  for (const value of ['https://example.com/?display_test=1', 'demo-test', 'https://example.com/?demo=1&t=demo-test']) assert.throws(() => qrTokenFromText(value));
  assert.equal(qrTokenFromText('https://example.com/?demo=1&t=demo-test', true), 'demo-test');
});
test('university email is preserved, hyphenated student IDs are not altered', () => {
  const [row] = validateStudents([student]);
  assert.equal(row.student_id, student.student_id); assert.deepEqual(row.errors, []);
});
test('missing emails, wrong domain, damaged names and duplicate identities are rejected', () => {
  assert.ok(validateStudents([{ ...student, student_email: '' }])[0].errors.length);
  assert.ok(validateStudents([{ ...student, student_email: 'student@fake-rmuti.ac.th' }])[0].errors.length);
  assert.ok(validateStudents([{ ...student, student_name: '\uFFFD' }])[0].errors.length);
  assert.ok(validateStudents([student, student])[1].errors.length >= 2);
});
test('explicit unrestricted test policy accepts valid mixed domains but keeps roster validation', () => {
  const rows = ['test.user@hotmail.com', 'student@kku.ac.th', 'student@gmail.com'].map((email, i) => ({
    ...student, student_id: `TEST00${i + 1}`, student_email: email,
  }));
  assert.ok(validateStudents(rows, '').every((row) => row.errors.length === 0));
  assert.ok(validateStudents(rows).every((row) => row.errors.length > 0), 'Default remains university-only');
  for (const student_email of ['', 'not-an-email', 'name@@gmail.com', 'name gmail.com']) {
    assert.ok(validateStudents([{ ...student, student_email }], '')[0].errors.length);
  }
  assert.ok(validateStudents([rows[0], rows[0]], '')[1].errors.length >= 2);
  assert.ok(validateStudents([{ ...student, student_id: '../admin' }], '')[0].errors.length);
  assert.ok(validateStudents([{ ...student, student_name: '\uFFFD' }], '')[0].errors.length);
});
test('session windows enforce ordered valid dates', () => {
  const store = seedDemo(); assert.ok(sessionTimes(store.sessions[0]));
  assert.throws(() => sessionTimes({ ...store.sessions[0], checkin_close_time: 'invalid' }));
  assert.throws(() => sessionTimes({ ...store.sessions[0], late_cutoff_time: '2001-01-01' }));
});

test('demo import uses the same explicit email policy as its preview', () => {
  const original = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  try {
    const data = { section_id: 'demo-section', students: [{ ...student, student_email: 'demo@example.com' }] };
    assert.throws(() => demoApi('/api/import-enrollments', data, Date.now(), 'https://demo.invalid/'));
    assert.equal(demoApi('/api/import-enrollments', data, Date.now(), 'https://demo.invalid/', '').imported_count, 1);
  } finally { if (original === undefined) delete globalThis.localStorage; else globalThis.localStorage = original; }
});
test('attendance combines only enrolled active students; pending is not absent', () => {
  assert.equal(attendanceRows([{ ...student, status: 'ACTIVE' }], [])[0].attendance_status, 'PENDING');
  assert.equal(attendanceRows([{ ...student, status: 'INACTIVE' }], []).length, 0);
});
test('CSV quotes multiline values and prevents spreadsheet formula execution', () => {
  assert.equal(csvText([['=SUM(A1)', 'a"b', 'a\nb']]), '\uFEFF"\'=SUM(A1)","a""b","a\nb"');
  assert.equal(escapeHtml('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;');
});
test('demo enforces QR expiry, enrollment, session status and duplicate check-in', () => {
  const now = Date.now(); const store = seedDemo(now); store.sessions[0].status = 'OPEN';
  store.tokens.test = { session_id: 'demo-session', expires: now + 20000 };
  assert.throws(() => demoCheckIn(store, 'test', 'not-enrolled', now));
  assert.equal(demoCheckIn(store, 'test', 'DEMO001', now).result, 'CREATED');
  assert.equal(demoCheckIn(store, 'test', 'DEMO001', now).result, 'ALREADY_CHECKED_IN');
  assert.equal(store.attendance.length, 1);
  assert.throws(() => demoCheckIn(store, 'test', 'DEMO002', now + 20000));
  store.sessions[0].status = 'CLOSED'; assert.throws(() => demoCheckIn(store, 'test', 'DEMO002', now));
});
test('demo late attendance is assigned by session cutoff, not client choice', () => {
  const now = Date.now(); const store = seedDemo(now); store.sessions[0].status = 'OPEN';
  const late = now + 11 * 60000; store.tokens.test = { session_id: 'demo-session', expires: late + 20000 };
  assert.equal(demoCheckIn(store, 'test', 'DEMO001', late).attendance_status, 'LATE');
});

test('24-hour time fields preserve midnight, afternoon and overnight dates', () => {
  const parts = (day, hour, minute) => ({ start_time_date: day, start_time_hour: hour, start_time_minute: minute });
  assert.equal(dateTimeFromParts(parts('2026-10-08', '00', '00'), 'start_time'), '2026-10-08T00:00');
  assert.equal(dateTimeFromParts(parts('2026-10-08', '19', '05'), 'start_time'), '2026-10-08T19:05');
  for (const data of [parts('2026-02-30', '19', '05'), parts('2026-10-08', '24', '00'), parts('2026-10-08', '19', '60')]) {
    assert.throws(() => dateTimeFromParts(data, 'start_time'));
  }
});

test('latest Excel order wins, omitted students remain last and current names are not overwritten by old attendance', () => {
  const rows = [
    { ...student, student_id: 'STU-2', status: 'ACTIVE', roster_order: 0, roster_imported_at: '2026-10-08T01:00:00Z' },
    { ...student, student_id: 'STU-1', status: 'ACTIVE', roster_order: 1, roster_imported_at: '2026-10-08T01:00:00Z' },
    { ...student, student_id: 'STU-3', status: 'ACTIVE', roster_order: 0, roster_imported_at: '2026-10-07T01:00:00Z' },
  ];
  const merged = attendanceRows([...rows].reverse(), [{ student_id: 'STU-1', student_name: 'Old Name', attendance_status: 'ON_TIME' }]);
  assert.deepEqual(merged.map((row) => row.student_id), ['STU-2', 'STU-1', 'STU-3']);
  assert.equal(merged[1].student_name, student.student_name);
});

test('round and cumulative scores award only on-time attendance, once per round', () => {
  const enrollments = [{ ...student, status: 'ACTIVE' }, { ...student, student_id: 'NEW', status: 'ACTIVE' }, { ...student, student_id: 'INACTIVE', status: 'INACTIVE' }];
  const rounds = Array.from({ length: 10 }, (_, i) => ({ id: `round-${i}`, start_time: new Date(i * 60000).toISOString() }));
  const attendance = rounds.map((round, i) => ({ session_id: round.id, student_id: student.student_id, attendance_status: i < 5 ? 'ON_TIME' : 'LATE' }));
  attendance.push(attendance[0], { session_id: 'foreign', student_id: student.student_id, attendance_status: 'ON_TIME' });
  const summary = scoreSummary(enrollments, rounds.reverse(), attendance);
  assert.equal(summary.rows.length, 2);
  assert.equal(summary.rows[0].total, 5);
  assert.equal(summary.rows[1].total, 0);
  assert.deepEqual(summary.rows[0].points, [1, 1, 1, 1, 1, 0, 0, 0, 0, 0]);
  for (const status of ['LATE', 'PENDING', 'ABSENT', undefined]) assert.equal(attendanceScore(status), 0);
});

test('expired open rounds display closed without completing scheduled future rounds', () => {
  const now = Date.now(), checkin_close_time = new Date(now - 1).toISOString();
  assert.equal(sessionStatus({ status: 'OPEN', checkin_close_time }, now), 'CLOSED');
  assert.equal(sessionStatus({ status: 'SCHEDULED', checkin_close_time }, now), 'SCHEDULED');
});

test('demo archives reversibly, keeps history and refuses new QR or reopening outside the time window', () => {
  const original = globalThis.localStorage, values = new Map(), now = Date.now();
  globalThis.localStorage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  try {
    demoApi('/api/start-session', { session_id: 'demo-session' }, now, 'https://demo.invalid/');
    demoApi('/api/archive-section', { section_id: 'demo-section' }, now, 'https://demo.invalid/');
    assert.throws(() => demoApi('/api/issue-qr-token', { session_id: 'demo-session' }, now, 'https://demo.invalid/'));
    assert.equal(demoApi('/api/section-data?section_id=demo-section', {}, now, 'https://demo.invalid/').sessions.length, 1);
    demoApi('/api/restore-section', { section_id: 'demo-section' }, now, 'https://demo.invalid/');
    assert.equal(demoApi('/api/issue-qr-token', { session_id: 'demo-session' }, now, 'https://demo.invalid/').token.startsWith('demo-'), true);
    assert.throws(() => demoApi('/api/start-session', { session_id: 'demo-session' }, now + 120 * 60000, 'https://demo.invalid/'));
  } finally { if (original === undefined) delete globalThis.localStorage; else globalThis.localStorage = original; }
});

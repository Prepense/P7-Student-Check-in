import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationViews, validateStudents, sessionTimes, sessionDefaults, sessionMinuteOffsets, sessionTimesFromMinutes, attendanceRows, attendanceScore, scoreSummary, sessionStatus, dateTimeFromParts, csvText, qrTokenFromText, escapeHtml } from '../src/domain.js';
import { demoApi, demoCheckIn, seedDemo, DEMO_KEY } from '../src/demo.js';

const student = { student_id: 'DEMO-001', student_name: 'Student Example', student_email: 'student.example@rmuti.ac.th' };
test('live navigation shows both views before login and only the account role after login', () => {
  assert.deepEqual(navigationViews('live', null), ['teacher', 'student']);
  for (const role of ['instructor', 'admin']) assert.deepEqual(navigationViews('live', { role }), ['teacher']);
  for (const role of ['student', null, undefined, 'unknown']) assert.deepEqual(navigationViews('live', { role }), ['student']);
  assert.deepEqual(navigationViews('live', { role: null, email_verified: false }), ['student']);
  for (const user of [null, { role: 'student' }, { role: 'instructor' }]) assert.deepEqual(navigationViews('demo', user), ['teacher', 'student']);
});
test('minute thresholds follow the start, cross midnight and retain untouched legacy seconds', () => {
  const data = { checkin_open_time_date: '2026-10-12', checkin_open_time_hour: '23', checkin_open_time_minute: '30',
    start_time_date: '2026-10-12', start_time_hour: '23', start_time_minute: '50', late_minutes: '15', close_minutes: '30' };
  const times = sessionTimesFromMinutes(data);
  assert.deepEqual(sessionMinuteOffsets(times), { late_minutes: 15, close_minutes: 30 });
  assert.equal(new Date(times.late_cutoff_time).getDate(), 13);
  assert.equal(new Date(times.checkin_close_time).getHours(), 0);
  assert.equal(new Date(times.checkin_close_time).getMinutes(), 20);
  const original = { ...times, start_time: new Date(Date.parse(times.start_time) + 12345).toISOString(),
    checkin_open_time: new Date(Date.parse(times.checkin_open_time) + 54321).toISOString() };
  const offsets = sessionMinuteOffsets(original);
  assert.deepEqual(sessionTimesFromMinutes({ ...data, ...offsets }, original), original);
  const changed = sessionTimesFromMinutes({ ...data, ...offsets, start_time_minute: '55' }, original);
  assert.equal(Date.parse(changed.late_cutoff_time) - Date.parse(changed.start_time), Math.round(offsets.late_minutes * 60000));
  for (const bad of ['', '-1', 'NaN', 'Infinity', '1e5', '1,5']) assert.throws(() => sessionTimesFromMinutes({ ...data, late_minutes: bad }));
  assert.throws(() => sessionTimesFromMinutes({ ...data, late_minutes: '31' }), /ลำดับเวลา/);
  assert.throws(() => sessionTimesFromMinutes({ ...data, close_minutes: '9'.repeat(300) }), /มากเกินไป/);
  assert.deepEqual(sessionMinuteOffsets(sessionTimesFromMinutes({ ...data, late_minutes: '0', close_minutes: '0' })), { late_minutes: 0, close_minutes: 0 });
});
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
  const late = Date.parse(store.sessions[0].late_cutoff_time) + 1; store.tokens.test = { session_id: 'demo-session', expires: late + 20000 };
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

test('demo edits the same round without rewriting attendance, ignores identity/status injection, and rejects stale edits', () => {
  const original = globalThis.localStorage, values = new Map(), now = Date.now();
  globalThis.localStorage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  try {
    demoApi('/api/start-session', { session_id: 'demo-session' }, now, 'https://demo.invalid/');
    const issued = demoApi('/api/issue-qr-token', { session_id: 'demo-session' }, now, 'https://demo.invalid/');
    demoApi('/api/check-in', { token: issued.token, student_id: 'DEMO001' }, now, 'https://demo.invalid/');
    const before = JSON.parse(values.get(DEMO_KEY));
    const edit = { ...before.sessions[0], session_id: 'demo-session', expected_updated_at: before.sessions[0].updated_at, section_id: 'evil', status: 'CLOSED',
      late_cutoff_time: new Date(now + 20 * 60000).toISOString(), checkin_close_time: new Date(now + 90 * 60000).toISOString() };
    assert.equal(demoApi('/api/update-session', edit, now + 1, 'https://demo.invalid/').status, 'OPEN');
    const after = JSON.parse(values.get(DEMO_KEY));
    assert.equal(after.sessions.length, 1); assert.equal(after.sessions[0].id, 'demo-session'); assert.equal(after.sessions[0].section_id, 'demo-section');
    assert.deepEqual(after.attendance, before.attendance);
    assert.throws(() => demoApi('/api/update-session', edit, now + 2, 'https://demo.invalid/'));
    const fresh = { ...edit, expected_updated_at: after.sessions[0].updated_at };
    assert.throws(() => demoApi('/api/update-session', { ...fresh, late_cutoff_time: 'invalid' }, now + 3, 'https://demo.invalid/'));
    assert.throws(() => demoApi('/api/update-session', { ...fresh, checkin_open_time: new Date(now + 1).toISOString() }, now, 'https://demo.invalid/'));
    demoApi('/api/close-session', { session_id: 'demo-session' }, now + 4, 'https://demo.invalid/');
    assert.throws(() => demoApi('/api/update-session', fresh, now + 5, 'https://demo.invalid/'));
    fresh.expected_updated_at = JSON.parse(values.get(DEMO_KEY)).sessions[0].updated_at;
    assert.equal(demoApi('/api/update-session', fresh, now + 5, 'https://demo.invalid/').status, 'CLOSED');
    assert.deepEqual(JSON.parse(values.get(DEMO_KEY)).attendance, before.attendance);
  } finally { if (original === undefined) delete globalThis.localStorage; else globalThis.localStorage = original; }
});

test('approved leave scores once, preserves notes and separates QR time from manual credit', () => {
  const enrollments = [{ ...student, status: 'ACTIVE' }];
  const attendance = [{ student_id: student.student_id, session_id: 'round', attendance_status: 'LEAVE_APPROVED',
    leave_note: 'Medical leave, approved\nSecond line', source: 'INSTRUCTOR_LEAVE', checkin_time: null, attendance_version: 'version' }];
  const row = attendanceRows(enrollments, attendance)[0];
  assert.equal(row.leave_note, attendance[0].leave_note); assert.equal(row.checkin_time, null);
  assert.equal(row.attendance_version, 'version'); assert.equal(attendanceScore(row.attendance_status), 1);
  const summary = scoreSummary(enrollments, [{ id: 'round', start_time: new Date().toISOString() }], [...attendance, ...attendance]);
  assert.equal(summary.rows[0].total, 1); assert.deepEqual(summary.rows[0].notes, [`LEAVE_APPROVED: ${row.leave_note}`]);
  assert.ok(csvText([[row.leave_note]]).includes('Medical leave, approved\nSecond line'));
});

test('new rounds default to 15-minute on-time credit and 30-minute close, including previous-round templates', () => {
  const now = Date.now();
  for (const previous of [null, { start_time: new Date(now - 86400000).toISOString(), checkin_open_time: new Date(now - 86400000 - 300000).toISOString(), late_cutoff_time: new Date(now - 86400000 + 600000).toISOString() }]) {
    const defaults = sessionDefaults(previous, now);
    assert.equal(defaults.late_cutoff_time - defaults.start_time, 15 * 60000);
    assert.equal(defaults.checkin_close_time - defaults.start_time, 30 * 60000);
  }
  const store = seedDemo(now); store.sessions[0].status = 'OPEN';
  for (const [offset, score] of [[15 * 60000, 1], [15 * 60000 + 1, 0]]) {
    store.attendance = []; store.tokens.test = { session_id: 'demo-session', expires: now + offset + 20000 };
    assert.equal(attendanceScore(demoCheckIn(store, 'test', 'DEMO001', now + offset).attendance_status), score);
  }
});

test('demo permanent deletion is acknowledged, resumable and preserves other courses and shared accounts', () => {
  const original = globalThis.localStorage, values = new Map(), now = Date.now();
  globalThis.localStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const call = (path, body) => demoApi(path, body, now, 'https://demo.invalid/');
  try {
    const store = seedDemo(now);
    store.courses.push({ id: 'foreign', course_code: 'OTHER', active: true });
    store.sections.push({ id: 'foreign-section', course_id: 'foreign' });
    store.attendance.push({ section_id: 'foreign-section', student_id: 'DEMO001', attendance_status: 'ON_TIME' });
    store.students = [{ student_id: 'DEMO001' }]; store.users = [{ uid: 'shared' }];
    store.attendance_adjustments = [{ session_id: 'demo-session', section_id: 'demo-section', note: 'Approved leave' }];
    values.set(DEMO_KEY, JSON.stringify(store));
    const payload = { course_id: 'demo-course', confirmation: 'IOT101', backup_confirmed: true };
    assert.throws(() => call('/api/purge-course', payload));
    call('/api/archive-course', { course_id: 'demo-course' });
    payload.expected_version = JSON.parse(values.get(DEMO_KEY)).courses[0].course_version;
    assert.throws(() => call('/api/purge-course', { ...payload, backup_confirmed: false }));
    let result = call('/api/purge-course', payload); payload.purge_id = result.purge_id;
    assert.throws(() => call('/api/restore-course', { course_id: 'demo-course' }));
    for (let i = 0; i < 10 && !result.done; i++) result = call('/api/purge-course', payload);
    assert.equal(result.done, true); assert.deepEqual(call('/api/purge-course', payload), result);
    const after = JSON.parse(values.get(DEMO_KEY));
    assert.deepEqual(after.courses.map(row => row.id), ['foreign']);
    assert.equal(after.sections[0].id, 'foreign-section'); assert.equal(after.attendance[0].section_id, 'foreign-section');
    assert.equal(after.enrollments.length, 0); assert.equal(after.sessions.length, 0); assert.equal(after.attendance_adjustments.length, 0);
    assert.deepEqual(after.students, store.students); assert.deepEqual(after.users, store.users);
  } finally { if (original === undefined) delete globalThis.localStorage; else globalThis.localStorage = original; }
});

test('demo leave approval, note correction, revoke and course archive preserve original evidence', () => {
  const original = globalThis.localStorage, values = new Map(), now = Date.now();
  globalThis.localStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const call = (path, body) => demoApi(path, body, now, 'https://demo.invalid/');
  const state = () => JSON.parse(values.get(DEMO_KEY));
  const leave = (body = {}) => ({ session_id: 'demo-session', student_id: 'DEMO001', action: 'APPROVE', note: 'Approved reason',
    expected_version: state().attendance.find(row => row.student_id === 'DEMO001')?.attendance_version || null, ...body });
  try {
    call('/api/courses');
    assert.throws(() => call('/api/attendance-leave', leave({ note: '' })));
    call('/api/attendance-leave', leave());
    const stale = leave();
    call('/api/attendance-leave', leave({ note: 'Corrected note' }));
    assert.throws(() => call('/api/attendance-leave', stale));
    assert.equal(state().attendance[0].checkin_time, null);
    call('/api/attendance-leave', leave({ action: 'REVOKE' }));
    assert.equal(state().attendance.length, 0); assert.equal(state().attendance_adjustments.length, 3);
    call('/api/start-session', { session_id: 'demo-session' });
    const qr = call('/api/issue-qr-token', { session_id: 'demo-session' });
    call('/api/check-in', { student_id: 'DEMO001', token: qr.token });
    const before = state().attendance[0];
    call('/api/attendance-leave', leave());
    assert.equal(call('/api/check-in', { student_id: 'DEMO001', token: qr.token }).attendance_status, 'LEAVE_APPROVED');
    call('/api/attendance-leave', leave({ action: 'REVOKE' }));
    assert.equal(state().attendance[0].attendance_status, before.attendance_status);
    assert.equal(state().attendance[0].checkin_time, before.checkin_time);
    const records = JSON.stringify(state().attendance);
    call('/api/archive-course', { course_id: 'demo-course' });
    for (const [path, body] of [['/api/create-section', { course_id: 'demo-course' }], ['/api/attendance-leave', leave()],
      ['/api/issue-qr-token', { session_id: 'demo-session' }], ['/api/start-session', { session_id: 'demo-session' }]]) assert.throws(() => call(path, body));
    assert.throws(() => call('/api/check-in', { student_id: 'DEMO002', token: qr.token }));
    assert.equal(JSON.stringify(state().attendance), records);
    assert.equal(call('/api/section-data?section_id=demo-section').sessions.length, 1);
    call('/api/restore-course', { course_id: 'demo-course' });
    assert.equal(state().sections[0].active, true);
    assert.equal(call('/api/issue-qr-token', { session_id: 'demo-session' }).token.startsWith('demo-'), true);
  } finally { if (original === undefined) delete globalThis.localStorage; else globalThis.localStorage = original; }
});

import { DOMAIN, sessionTimes, validateStudents } from './domain.js';

export const DEMO_KEY = 'student-check-in-demo-v1';
const fail = (message) => { throw new Error(message); };
const id = () => crypto.randomUUID();

export function seedDemo(now = Date.now()) {
  const names = ['Anan Suksai', 'Kanda Chaiya', 'Narin Somjai', 'Pimchanok Srisuk', 'Thanawat Boonmee', 'Siriwan Jaidee', 'Warin Chaiyo', 'Patara Srisawat'];
  const session = {
    id: 'demo-session', section_id: 'demo-section', course_id: 'demo-course',
    course_code: 'IOT101', section_code: '01', session_date: new Date(now).toLocaleDateString('en-CA'),
    status: 'SCHEDULED', active: true,
    checkin_open_time: new Date(now - 60000).toISOString(),
    start_time: new Date(now).toISOString(),
    late_cutoff_time: new Date(now + 10 * 60000).toISOString(),
    checkin_close_time: new Date(now + 60 * 60000).toISOString(),
  };
  return {
    courses: [{ id: 'demo-course', course_code: 'IOT101', course_name: 'Internet of Things', academic_year: '2569', semester: '1', active: true }],
    sections: [{ id: 'demo-section', course_id: 'demo-course', course_code: 'IOT101', section_code: '01', room: 'IoT Lab', active: true }],
    sessions: [session], attendance: [], tokens: {},
    enrollments: names.map((name, i) => ({ id: `demo-enrollment-${i}`, section_id: 'demo-section', student_id: `DEMO${String(i + 1).padStart(3, '0')}`, student_name: name, student_email: `demo.student${i + 1}@rmuti.ac.th`, status: 'ACTIVE' })),
  };
}

export function demoCheckIn(store, token, studentId, now = Date.now()) {
  const payload = store.tokens[token];
  if (!payload) fail('QR ไม่ถูกต้อง กรุณาสแกนใหม่');
  if (payload.expires <= now) fail('QR หมดอายุ กรุณาสแกนใหม่');
  const session = store.sessions.find((row) => row.id === payload.session_id);
  if (!session || !['OPEN', 'LATE'].includes(session.status) || !session.active) fail('รอบเช็คชื่อปิดแล้ว');
  if (store.sections.find((row) => row.id === session.section_id)?.active === false) fail('ห้องเรียนถูกลบแล้ว');
  if (now < Date.parse(session.checkin_open_time) || now > Date.parse(session.checkin_close_time)) fail('อยู่นอกเวลาเช็คชื่อ');
  const student = store.enrollments.find((row) => row.section_id === session.section_id && row.student_id === studentId && row.status === 'ACTIVE');
  if (!student) fail('ไม่มีรายชื่อในกลุ่มเรียนนี้');
  const existing = store.attendance.find((row) => row.session_id === session.id && row.student_id === studentId);
  if (existing) return { result: 'ALREADY_CHECKED_IN', ...existing };
  const attendance = { ...student, id: id(), session_id: session.id, course_code: session.course_code, section_code: session.section_code, checkin_time: new Date(now).toISOString(), attendance_status: now <= Date.parse(session.late_cutoff_time) ? 'ON_TIME' : 'LATE' };
  store.attendance.push(attendance);
  return { result: 'CREATED', ...attendance };
}

export function demoApi(path, data = {}, now = Date.now(), base = location.href, emailDomain = DOMAIN) {
  const store = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null') || seedDemo(now);
  const save = () => localStorage.setItem(DEMO_KEY, JSON.stringify(store));
  const url = new URL(path, 'https://demo.invalid');
  const sectionId = url.searchParams.get('section_id');
  let result;
  switch (url.pathname) {
    case '/api/courses': result = { courses: store.courses }; break;
    case '/api/sections': result = { sections: store.sections.filter((row) => row.course_id === url.searchParams.get('course_id')) }; break;
    case '/api/section-data': result = { sessions: store.sessions.filter((row) => row.section_id === sectionId), enrollments: store.enrollments.filter((row) => row.section_id === sectionId) }; break;
    case '/api/attendance': result = { attendance: store.attendance.filter((row) => row.session_id === url.searchParams.get('session_id')) }; break;
    case '/api/create-course': {
      const course_id = id(); store.courses.push({ ...data, id: course_id, active: true }); result = { course_id }; break;
    }
    case '/api/create-section': {
      const section_id = id(); store.sections.push({ ...data, id: section_id, active: true }); result = { section_id }; break;
    }
    case '/api/archive-section':
    case '/api/restore-section': {
      const section = store.sections.find((row) => row.id === data.section_id);
      if (!section) fail('ไม่พบกลุ่มเรียน');
      section.active = url.pathname === '/api/restore-section';
      result = { section_id: section.id, active: section.active }; break;
    }
    case '/api/create-session': {
      const session_id = id();
      const section = store.sections.find((row) => row.id === data.section_id);
      const course = store.courses.find((row) => row.id === section?.course_id);
      if (!section || !course || section.active === false) fail('ไม่พบกลุ่มเรียนที่เปิดใช้งาน');
      store.sessions.push({ ...data, ...sessionTimes(data), id: session_id, status: 'SCHEDULED', active: true, course_code: course.course_code, section_code: section.section_code });
      result = { session_id }; break;
    }
    case '/api/start-session':
    case '/api/close-session': {
      const session = store.sessions.find((row) => row.id === data.session_id);
      if (!session) fail('ไม่พบรอบเช็คชื่อ');
      if (url.pathname === '/api/start-session') {
        if (store.sections.find((row) => row.id === session.section_id)?.active === false) fail('ห้องเรียนถูกลบแล้ว');
        if (now < Date.parse(session.checkin_open_time) || now > Date.parse(session.checkin_close_time)) fail('อยู่นอกเวลาเช็คชื่อ');
        session.opened_at = new Date(now).toISOString(); session.closed_at = null;
      } else session.closed_at = new Date(now).toISOString();
      session.status = url.pathname === '/api/start-session' ? 'OPEN' : 'CLOSED'; result = { status: session.status }; break;
    }
    case '/api/import-enrollments': {
      if (store.sections.find((row) => row.id === data.section_id)?.active === false) fail('ห้องเรียนถูกลบแล้ว');
      const rows = validateStudents(data.students, emailDomain);
      if (!rows.length || rows.length > 200 || rows.some((row) => row.errors.length)) fail('รายชื่อไม่ผ่านการตรวจสอบ');
      for (const [position, row] of rows.entries()) {
        const old = store.enrollments.find((value) => value.student_id === row.student_id && value.section_id === data.section_id);
        const { errors, ...student } = row;
        const order = { roster_order: position, roster_imported_at: new Date(now).toISOString() };
        if (old) Object.assign(old, student, order, { status: 'ACTIVE' });
        else store.enrollments.push({ ...student, ...order, id: id(), section_id: data.section_id, status: 'ACTIVE' });
      }
      result = { imported_count: rows.length }; break;
    }
    case '/api/issue-qr-token': {
      const session = store.sessions.find((row) => row.id === data.session_id);
      if (!session || !['OPEN', 'LATE'].includes(session.status)) fail('รอบเช็คชื่อยังไม่เปิด');
      if (store.sections.find((row) => row.id === session.section_id)?.active === false) fail('ห้องเรียนถูกลบแล้ว');
      if (now < Date.parse(session.checkin_open_time) || now > Date.parse(session.checkin_close_time)) fail('อยู่นอกเวลาเช็คชื่อ');
      const token = `demo-${id()}`;
      store.tokens = Object.fromEntries(Object.entries(store.tokens).filter(([, value]) => value.expires > now));
      store.tokens[token] = { session_id: session.id, expires: now + 20000 };
      const link = new URL(base); link.search = ''; link.hash = ''; link.searchParams.set('demo', '1'); link.searchParams.set('t', token);
      result = { token, qr_url: link.href, issued_at: new Date(now).toISOString(), expires_at: new Date(now + 20000).toISOString(), refresh_after_seconds: 10 }; break;
    }
    case '/api/check-in': result = demoCheckIn(store, data.token, data.student_id, now); break;
    default: fail('Unknown demo endpoint');
  }
  save();
  return result;
}

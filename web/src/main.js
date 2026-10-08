import './style.css';
import QRCode from 'qrcode';
import { createIcons, GraduationCap, Settings, Plus, Play, Square, RefreshCw, Upload, Download, Search, QrCode, ExternalLink, Copy, X, CheckCircle, LogOut, CalendarDays, Users, ClipboardCheck, ArrowLeft } from 'lucide';
import { readSheet } from 'read-excel-file/browser';
import { DOMAIN, validateStudents, sessionTimes, attendanceRows, csvText, escapeHtml as e } from './domain.js';
import { api, loadConfig, connectFirebase, login, signup, verifyEmail, refreshAccount, logout, resetPassword } from './backend.js';
import { DEMO_KEY, seedDemo } from './demo.js';

const icons = { GraduationCap, Settings, Plus, Play, Square, RefreshCw, Upload, Download, Search, QrCode, ExternalLink, Copy, X, CheckCircle, LogOut, CalendarDays, Users, ClipboardCheck, ArrowLeft };
const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const initialUrl = new URL(location.href);
const initialConfig = loadConfig();
const studentEmailDomain = import.meta.env.VITE_ALLOW_ANY_STUDENT_EMAIL_FOR_TESTING === 'true' ? '' : DOMAIN;
const emailLabel = studentEmailDomain ? 'อีเมลมหาวิทยาลัย' : 'อีเมล';
const emailPlaceholder = studentEmailDomain ? `name@${studentEmailDomain}` : 'name@example.com';
const state = {
  mode: initialUrl.searchParams.has('demo') ? 'demo' : initialUrl.searchParams.has('t') ? 'live' : (localStorage.getItem('checkin-mode') || (initialConfig.workerUrl ? 'live' : 'demo')),
  view: initialUrl.searchParams.has('t') ? 'student' : 'teacher', tab: 'attendance',
  config: initialConfig, user: null, courses: [], sections: [], sessions: [], enrollments: [], attendance: [],
  courseId: '', sectionId: '', sessionId: '', search: '', filter: 'ALL', busy: false, loading: false,
  error: '', token: initialUrl.searchParams.get('t') || '', studentId: 'DEMO001', result: null,
  qr: null, qrBusy: false, nextQr: 0, generation: 0, loaded: false,
  authMode: 'login', verificationSentAt: 0,
};
const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const iconButton = (action, name, title, extra = '') => `<button class="icon-button" data-action="${action}" title="${title}" aria-label="${title}" ${extra}>${icon(name)}</button>`;
const actionButton = (action, name, label, style = '', extra = '') => `<button class="${style}" data-action="${action}" ${extra}>${icon(name)}<span>${label}</span></button>`;
const options = (rows, selected, label) => rows.map((row) => `<option value="${e(row.id)}" ${row.id === selected ? 'selected' : ''}>${e(label(row))}</option>`).join('');
const session = () => state.sessions.find((row) => row.id === state.sessionId);
const time = (value) => value ? new Date(value).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-';
const date = (value) => value ? new Date(value).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
const statusLabels = { SCHEDULED: 'ยังไม่เปิด', OPEN: 'กำลังเช็คชื่อ', LATE: 'กำลังเช็คชื่อ', CLOSED: 'ปิดแล้ว', ON_TIME: 'ตรงเวลา', PENDING: 'ยังไม่เช็คชื่อ' };
const badge = (status) => `<span class="badge ${e(status.toLowerCase())}">${e(statusLabels[status] || (status === 'LATE' ? 'สาย' : status))}</span>`;
const canTeach = () => state.mode === 'demo' || ['instructor', 'admin'].includes(state.user?.role);

function toast(message, error = false) {
  const node = document.querySelector('#toast');
  node.textContent = message; node.className = error ? 'visible error' : 'visible';
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { node.className = ''; }, 5500);
}

function render() {
  app.innerHTML = `<header class="topbar">
    <a class="brand" href="${e(location.pathname)}">${icon('GraduationCap')}<span>Student Check-in<small>ระบบเช็คชื่อเข้าเรียน</small></span></a>
    <div class="top-actions"><label class="mode-label"><span class="sr-only">โหมด</span><select id="mode"><option value="demo" ${state.mode === 'demo' ? 'selected' : ''}>ข้อมูลตัวอย่าง</option><option value="live" ${state.mode === 'live' ? 'selected' : ''}>ระบบจริง</option></select></label>
    ${iconButton('settings', 'Settings', 'ตั้งค่าการเชื่อมต่อ')}${state.user ? iconButton('logout', 'LogOut', 'ออกจากระบบ') : ''}</div>
  </header>
  <div class="workspace"><aside class="sidebar"><nav aria-label="มุมมอง">
    <button class="nav-item ${state.view === 'teacher' ? 'active' : ''}" data-action="teacher">${icon('ClipboardCheck')}ผู้สอน</button>
    <button class="nav-item ${state.view === 'student' ? 'active' : ''}" data-action="student">${icon('QrCode')}นักศึกษา</button>
  </nav><div class="sidebar-bottom"><span class="connection-dot ${state.mode === 'demo' ? 'demo' : ''}"></span>${state.mode === 'demo' ? 'ตัวอย่าง · ไม่บันทึกบนคลาวด์' : 'Firebase + Workers'}<small>${e(state.user?.email || (state.mode === 'demo' ? 'Demo workspace' : 'ยังไม่เข้าสู่ระบบ'))}</small></div></aside>
  <main aria-busy="${state.busy || state.loading}">
    <div class="page-heading"><div class="eyebrow">${state.mode === 'demo' ? 'DEMO WORKSPACE' : 'CLASSROOM WORKSPACE'}</div><h1>${state.view === 'teacher' ? 'เช็คชื่อเข้าเรียน' : 'เช็คชื่อของฉัน'}</h1></div>
    ${state.error ? `<div class="alert" role="alert">${e(state.error)}</div>` : ''}
    ${state.mode === 'live' && !state.user ? authView() : state.view === 'teacher' ? (canTeach() ? teacherView() : '<div class="empty">บัญชีนี้ไม่มีสิทธิ์ผู้สอน กรุณาเปิดมุมมองนักศึกษา</div>') : studentView()}
  </main></div>`;
  createIcons({ icons });
  drawQr();
  if (state.busy) app.querySelectorAll('button, select').forEach((node) => { node.disabled = true; });
}

function authView() {
  if (!state.config.firebase?.apiKey || !state.config.workerUrl) return `<section class="auth-surface"><h2>ตั้งค่าการเชื่อมต่อ</h2><p class="muted">ยังไม่มี Firebase Web config และ Worker URL</p>${actionButton('settings', 'Settings', 'ตั้งค่า', 'primary')}</section>`;
  const registering = state.authMode === 'signup';
  return `<section class="auth-surface"><div class="tabs" role="tablist" aria-label="บัญชีผู้ใช้"><button role="tab" aria-selected="${!registering}" data-action="auth-login">เข้าสู่ระบบ</button><button role="tab" aria-selected="${registering}" data-action="auth-signup">สมัครนักศึกษา</button></div><h2>${registering ? 'สมัครบัญชีนักศึกษา' : 'เข้าสู่ระบบ'}</h2><form id="${registering ? 'signup-form' : 'login-form'}">
    <label>${emailLabel}<input name="email" type="email" autocomplete="username" placeholder="${emailPlaceholder}" required></label>
    <label>${registering ? 'รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)' : 'รหัสผ่าน'}<input name="password" type="password" autocomplete="${registering ? 'new-password' : 'current-password'}" ${registering ? 'minlength="8"' : ''} required></label>
    ${registering ? '<label>ยืนยันรหัสผ่าน<input name="confirm_password" type="password" autocomplete="new-password" minlength="8" required></label>' : ''}
    <div id="login-error" class="form-error" role="alert"></div>
    <button class="primary" type="submit">${registering ? 'สมัครบัญชี' : 'เข้าสู่ระบบ'}</button>${registering ? '' : '<button type="button" data-action="reset-password" class="text-button">ลืมรหัสผ่าน</button>'}
  </form></section>`;
}

function studentAccountView() {
  if (!state.user.email_verified) return `<section class="auth-surface account-status"><h2>ยืนยันอีเมล</h2><p class="account-email">${e(state.user.email)}</p><p class="muted">ยังไม่ได้ยืนยันอีเมล</p>
    <div class="actions">${actionButton('refresh-account', 'CheckCircle', 'ยืนยันอีเมลแล้ว', 'primary')}${actionButton('send-verification', 'RefreshCw', 'ส่งอีเมลยืนยันอีกครั้ง')}</div></section>`;
  return `<section class="auth-surface account-status"><h2>ผูกบัญชีนักศึกษา</h2><p class="account-email">${e(state.user.email)}</p><p class="form-error" role="alert">${e(state.user.account_error || 'กำลังตรวจสอบรายชื่อ')}</p>${actionButton('refresh-account', 'RefreshCw', 'ตรวจสอบบัญชีอีกครั้ง', 'primary')}</section>`;
}

function teacherView() {
  const current = session();
  const rows = attendanceRows(state.enrollments, state.attendance);
  const present = rows.filter((row) => row.attendance_status !== 'PENDING').length;
  const late = rows.filter((row) => row.attendance_status === 'LATE').length;
  return `<section class="selectors" aria-label="รายวิชาและกลุ่มเรียน">
    <label>รายวิชา<select id="course" ${state.loading ? 'disabled' : ''}>${state.courses.length ? options(state.courses, state.courseId, (row) => `${row.course_code} · ${row.course_name}`) : '<option>ยังไม่มีรายวิชา</option>'}</select></label>
    ${iconButton('new-course', 'Plus', 'เพิ่มรายวิชา')}
    <label>กลุ่มเรียน<select id="section" ${state.loading ? 'disabled' : ''}>${state.sections.length ? options(state.sections, state.sectionId, (row) => `กลุ่ม ${row.section_code}${row.room ? ` · ${row.room}` : ''}`) : '<option>ยังไม่มีกลุ่มเรียน</option>'}</select></label>
    ${iconButton('new-section', 'Plus', 'เพิ่มกลุ่มเรียน', !state.courseId ? 'disabled' : '')}
  </section>
  <div class="tabs" role="tablist"><button role="tab" aria-selected="${state.tab === 'attendance'}" data-action="tab-attendance">เช็คชื่อ</button><button role="tab" aria-selected="${state.tab === 'history'}" data-action="tab-history">รอบที่ผ่านมา <span>${state.sessions.length}</span></button></div>
  ${state.loading ? '<div class="loading" role="status">กำลังโหลดข้อมูล...</div>' : ''}
  ${state.tab === 'history' ? historyView() : `<section class="session-toolbar"><div><h2>${current ? date(current.start_time) : 'รอบเช็คชื่อ'}</h2><div class="session-meta">${current ? `${time(current.start_time)} · เกณฑ์สาย ${time(current.late_cutoff_time)} · ปิดรับ ${time(current.checkin_close_time)}` : 'ยังไม่มีรอบเช็คชื่อ'} ${current ? badge(current.status) : ''}</div></div><div class="actions">
    ${actionButton('new-session', 'CalendarDays', 'เพิ่มรอบ', '', !state.sectionId ? 'disabled' : '')}
    ${current ? (['OPEN', 'LATE'].includes(current.status) ? actionButton('close-session', 'Square', 'ปิดรอบ', 'danger') : actionButton('start-session', 'Play', current.status === 'CLOSED' ? 'เปิดอีกครั้ง' : 'เปิดเช็คชื่อ', 'primary')) : ''}
  </div></section>
  <div class="attendance-layout"><section class="register"><div class="stats">
    <div><span>รายชื่อทั้งหมด</span><strong>${rows.length}<small> คน</small></strong></div><div><span>เช็คชื่อแล้ว</span><strong class="green">${present}<small> คน</small></strong></div><div><span>มาสาย</span><strong class="amber">${late}<small> คน</small></strong></div><div><span>ยังไม่เช็คชื่อ</span><strong>${rows.length - present}<small> คน</small></strong></div>
  </div><div class="register-toolbar"><h2>รายชื่อนักศึกษา</h2><div class="actions">${actionButton('import', 'Upload', 'นำเข้า Excel', '', !state.sectionId ? 'disabled' : '')}${iconButton('export', 'Download', 'ดาวน์โหลด CSV', !rows.length ? 'disabled' : '')}${iconButton('refresh', 'RefreshCw', 'รีเฟรชข้อมูล')}</div></div>
  <div class="filters"><label class="search">${icon('Search')}<input id="search" placeholder="ค้นหารหัส ชื่อ หรืออีเมล" aria-label="ค้นหานักศึกษา" value="${e(state.search)}"></label><select id="filter" aria-label="กรองสถานะ"><option value="ALL">ทุกสถานะ</option><option value="ON_TIME" ${state.filter === 'ON_TIME' ? 'selected' : ''}>ตรงเวลา</option><option value="LATE" ${state.filter === 'LATE' ? 'selected' : ''}>สาย</option><option value="PENDING" ${state.filter === 'PENDING' ? 'selected' : ''}>ยังไม่เช็คชื่อ</option></select></div>
  <div class="table-scroll"><table><thead><tr><th>นักศึกษา</th><th>สถานะ</th><th>เวลาเช็คชื่อ</th></tr></thead><tbody id="roster-body">${rosterBody()}</tbody></table></div><div class="table-footer"><span id="row-count"></span><span>ปรับปรุงล่าสุด <span id="updated-time">${state.loaded ? time(Date.now()) : '-'}</span></span></div>
  </section><aside class="qr-panel"><div class="qr-heading"><h2>${icon('QrCode')} QR เช็คชื่อ</h2>${current ? badge(current.status) : ''}</div>
  <div class="qr-frame"><canvas id="qr-canvas" width="320" height="320" hidden aria-label="QR code สำหรับเช็คชื่อ"></canvas><div id="qr-placeholder">${icon('QrCode')}<span>${current && ['OPEN', 'LATE'].includes(current.status) ? 'กำลังรับ QR...' : 'รอเปิดรอบเช็คชื่อ'}</span></div></div>
  <div class="qr-countdown"><span>QR VALID</span><strong id="qr-seconds">--</strong><span>วินาที</span></div><div class="qr-progress"><div id="qr-progress"></div></div>
  <p id="qr-status" class="muted qr-status" role="status">${state.mode === 'demo' ? 'QR ตัวอย่าง · อายุ 20 วินาที' : 'QR จาก Cloudflare Worker'}</p>
  <div class="qr-actions">${iconButton('copy-qr', 'Copy', 'คัดลอกลิงก์ QR')}${iconButton('open-qr', 'ExternalLink', 'เปิดหน้ารับเช็คชื่อ')}${iconButton('refresh-qr', 'RefreshCw', 'รับ QR ใหม่')}</div></aside></div>`}`;
}

function rosterBody() {
  const term = state.search.trim().toLowerCase();
  const rows = attendanceRows(state.enrollments, state.attendance).filter((row) =>
    (state.filter === 'ALL' || row.attendance_status === state.filter) && `${row.student_id} ${row.student_name} ${row.student_email}`.toLowerCase().includes(term));
  queueMicrotask(() => { const node = document.querySelector('#row-count'); if (node) node.textContent = `${rows.length} รายการ`; });
  return rows.length ? rows.map((row, i) => `<tr><td><div class="student-cell"><span class="row-number">${i + 1}</span><div><strong>${e(row.student_name)}</strong><small>${e(row.student_id)} <span class="email">· ${e(row.student_email)}</span></small></div></div></td><td>${row.attendance_status === 'LATE' ? '<span class="badge late">สาย</span>' : badge(row.attendance_status)}</td><td class="mono">${time(row.checkin_time)}</td></tr>`).join('') : '<tr><td colspan="3" class="empty">ไม่พบรายชื่อ</td></tr>';
}

function historyView() {
  const sessions = [...state.sessions].sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time));
  return `<section class="history"><div class="register-toolbar"><h2>รอบเช็คชื่อ</h2>${actionButton('new-session', 'Plus', 'เพิ่มรอบ', '', !state.sectionId ? 'disabled' : '')}</div><div class="table-scroll"><table><thead><tr><th>วันที่</th><th>เริ่มเรียน</th><th>ปิดรับ</th><th>สถานะ</th><th></th></tr></thead><tbody>${sessions.length ? sessions.map((row) => `<tr><td>${date(row.start_time)}</td><td>${time(row.start_time)}</td><td>${time(row.checkin_close_time)}</td><td>${badge(row.status)}</td><td><button class="text-button" data-action="select-session" data-id="${e(row.id)}">ดูรายชื่อ</button></td></tr>`).join('') : '<tr><td colspan="5" class="empty">ยังไม่มีรอบเช็คชื่อ</td></tr>'}</tbody></table></div></section>`;
}

function studentView() {
  if (state.mode === 'live' && !canTeach() && (state.user?.role !== 'student' || !state.user?.student_id)) return studentAccountView();
  const demoStudents = state.mode === 'demo' ? (JSON.parse(localStorage.getItem(DEMO_KEY) || 'null') || seedDemo()).enrollments : [];
  const unique = [...new Map(demoStudents.map((row) => [row.student_id, row])).values()];
  return `<section class="student-surface"><div class="student-heading">${icon('Users')}<h2>${state.mode === 'demo' ? 'บัญชีนักศึกษาตัวอย่าง' : e(state.user?.email)}</h2></div>
  ${state.mode === 'demo' ? `<label>นักศึกษา<select id="demo-student">${unique.map((row) => `<option value="${e(row.student_id)}" ${row.student_id === state.studentId ? 'selected' : ''}>${e(row.student_id)} · ${e(row.student_name)}</option>`).join('')}</select></label>` : `<p class="muted">รหัสนักศึกษา ${e(state.user?.student_id || 'ยังไม่ได้ผูกบัญชี')}</p>`}
  ${state.mode === 'live' && state.user?.student_name ? `<p>${e(state.user.student_name)}</p>` : ''}
  ${state.result ? `<div class="checkin-result" role="status">${icon('CheckCircle')}<h3>${state.result.result === 'ALREADY_CHECKED_IN' ? 'เช็คชื่อไว้แล้ว' : 'เช็คชื่อสำเร็จ'}</h3><strong>${e(state.result.course_code || '')} · กลุ่ม ${e(state.result.section_code || '')}</strong><p>${date(state.result.checkin_time)} · ${time(state.result.checkin_time)}</p>${state.result.attendance_status === 'LATE' ? '<span class="badge late">สาย</span>' : badge(state.result.attendance_status)}</div>` : ''}
  <form id="checkin-form"><label>ลิงก์หรือโทเคน QR<textarea name="token" rows="3" required placeholder="https://.../?t=...">${e(state.token)}</textarea></label><button class="primary full" type="submit">${icon('ClipboardCheck')}ยืนยันเช็คชื่อ</button></form>
  <div class="student-footer">${state.mode === 'demo' ? 'ข้อมูลตัวอย่าง · ไม่บันทึกการเข้าเรียนจริง' : 'บันทึกผ่าน Cloudflare Worker'}</div></section>`;
}

async function reload(preferred = {}) {
  const generation = ++state.generation;
  state.loading = true; state.error = ''; clearQr(); render();
  try {
    const { courses } = await api(state.mode, '/api/courses');
    const courseId = preferred.courseId || state.courseId;
    const selectedCourse = courses.find((row) => row.id === courseId)?.id || courses[0]?.id || '';
    const sections = selectedCourse ? (await api(state.mode, `/api/sections?course_id=${encodeURIComponent(selectedCourse)}`)).sections : [];
    const sectionId = preferred.sectionId || state.sectionId;
    const selectedSection = sections.find((row) => row.id === sectionId)?.id || sections[0]?.id || '';
    const data = selectedSection ? await api(state.mode, `/api/section-data?section_id=${encodeURIComponent(selectedSection)}`) : { sessions: [], enrollments: [] };
    const sessions = data.sessions.sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time));
    const selectedSession = sessions.find((row) => row.id === (preferred.sessionId || state.sessionId))?.id || sessions[0]?.id || '';
    const attendance = selectedSession ? (await api(state.mode, `/api/attendance?session_id=${encodeURIComponent(selectedSession)}`)).attendance : [];
    if (generation !== state.generation) return;
    Object.assign(state, { courses, sections, ...data, attendance, courseId: selectedCourse, sectionId: selectedSection, sessionId: selectedSession, loaded: true });
  } catch (error) { if (generation === state.generation) { state.error = error.message; state.loaded = false; state.courses = []; state.sections = []; state.sessions = []; state.enrollments = []; state.attendance = []; state.courseId = ''; state.sectionId = ''; state.sessionId = ''; } }
  if (generation === state.generation) { state.loading = false; render(); await refreshQr(); }
}

function clearQr() { state.qr = null; state.nextQr = 0; }

async function refreshQr() {
  const current = session();
  if (state.qrBusy || state.view !== 'teacher' || state.tab !== 'attendance' || !current || !['OPEN', 'LATE'].includes(current.status) || state.loading) return;
  const generation = state.generation;
  const requestStarted = performance.now();
  state.qrBusy = true;
  try {
    const issued = await api(state.mode, '/api/issue-qr-token', { session_id: current.id });
    if (generation !== state.generation || current.id !== state.sessionId || state.view !== 'teacher') return;
    // Anchoring to request start avoids extending validity by network latency.
    state.qr = { ...issued, deadline: requestStarted + Math.max(0, Date.parse(issued.expires_at) - Date.parse(issued.issued_at)) };
    state.nextQr = performance.now() + issued.refresh_after_seconds * 1000;
    await drawQr();
    const node = document.querySelector('#qr-status'); if (node) node.textContent = state.mode === 'demo' ? 'QR ตัวอย่าง · อายุ 20 วินาที' : `TOKEN · ${issued.token_id}`;
  } catch (error) {
    if (generation === state.generation) { clearQr(); drawQr(); const node = document.querySelector('#qr-status'); if (node) node.textContent = error.message; }
    state.nextQr = performance.now() + 10000;
  } finally { state.qrBusy = false; }
}

async function drawQr() {
  const canvas = document.querySelector('#qr-canvas');
  if (!canvas) return;
  const active = state.qr && state.qr.deadline > performance.now();
  canvas.hidden = !active;
  document.querySelector('#qr-placeholder').hidden = !!active;
  if (active) await QRCode.toCanvas(canvas, state.qr.qr_url, { width: 320, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#182b23', light: '#ffffff' } });
  updateCountdown();
}

function updateCountdown() {
  const node = document.querySelector('#qr-seconds'); if (!node) return;
  const seconds = Math.max(0, Math.ceil(((state.qr?.deadline || 0) - performance.now()) / 1000));
  node.textContent = state.qr ? String(seconds).padStart(2, '0') : '--';
  document.querySelector('#qr-progress').style.width = `${seconds * 5}%`;
  if (!seconds && state.qr) { document.querySelector('#qr-canvas').hidden = true; document.querySelector('#qr-placeholder').hidden = false; document.querySelector('#qr-placeholder span').textContent = 'QR หมดอายุ'; }
}

function showModal(title, content, wide = false) {
  modal.className = wide ? 'wide' : '';
  modal.innerHTML = `<div class="modal-heading"><h2>${title}</h2>${iconButton('dismiss', 'X', 'ปิด')}</div>${content}`;
  createIcons({ icons }); modal.showModal();
}
const field = (label, name, value = '', type = 'text', attrs = '') => `<label>${label}<input name="${name}" type="${type}" value="${e(value)}" ${attrs} required></label>`;
const formFooter = (label) => `<div class="form-error" role="alert"></div><footer><button type="button" data-action="dismiss">ยกเลิก</button><button type="submit" class="primary">${label}</button></footer>`;

function settingsModal() {
  const config = state.config;
  showModal('ตั้งค่าการเชื่อมต่อ', `<form id="settings-form">
    ${field('Cloudflare Worker URL', 'workerUrl', config.workerUrl || '', 'url', 'placeholder="https://student-check-in-api.example.workers.dev"')}
    <label>Firebase Web config (JSON)<textarea name="firebase" rows="8" spellcheck="false" required>${e(JSON.stringify(config.firebase || { apiKey: '', authDomain: 'student-check-in-rmuti.firebaseapp.com', projectId: 'student-check-in-rmuti', appId: '' }, null, 2))}</textarea></label>
    <p class="muted">เฉพาะ Web config สาธารณะ · ไม่ใส่ service account หรือ signing secret</p>${formFooter('บันทึก')}</form>`);
}

function creationModal(type) {
  if (type === 'course') showModal('เพิ่มรายวิชา', `<form id="create-course-form">${field('รหัสวิชา', 'course_code')}${field('ชื่อวิชา', 'course_name')}<div class="form-grid">${field('ปีการศึกษา', 'academic_year', '2569')}${field('ภาคเรียน', 'semester', '1')}</div>${formFooter('สร้างรายวิชา')}</form>`);
  if (type === 'section') showModal('เพิ่มกลุ่มเรียน', `<form id="create-section-form">${field('กลุ่มเรียน', 'section_code', '01')}${field('ห้องเรียน', 'room')} ${formFooter('สร้างกลุ่มเรียน')}</form>`);
  if (type === 'session') {
    const now = Date.now();
    const local = (value) => { const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
    showModal('เพิ่มรอบเช็คชื่อ', `<form id="create-session-form"><div class="form-grid">${field('เปิดรับเช็คชื่อ', 'checkin_open_time', local(now - 60000), 'datetime-local')}${field('เริ่มเรียน', 'start_time', local(now), 'datetime-local')}${field('เกณฑ์สาย', 'late_cutoff_time', local(now + 10 * 60000), 'datetime-local')}${field('ปิดรับเช็คชื่อ', 'checkin_close_time', local(now + 60 * 60000), 'datetime-local')}</div>${formFooter('สร้างรอบเช็คชื่อ')}</form>`);
  }
}

let importRows = [];
let importSheet = [];
function importModal() {
  importRows = []; importSheet = [];
  showModal('นำเข้ารายชื่อนักศึกษา', `<form id="import-form"><label>ไฟล์ Excel (.xlsx)<input id="excel-file" type="file" accept=".xlsx" required></label><div id="import-preview"></div><div class="form-error" role="alert"></div><footer><button type="button" data-action="dismiss">ยกเลิก</button><button id="confirm-import" type="submit" class="primary" disabled>ยืนยันนำเข้า</button></footer></form>`, true);
}

function mapImport() {
  const columns = ['student_id', 'student_name', 'student_email'];
  const mapping = Object.fromEntries(columns.map((field) => [field, Number(modal.querySelector(`[data-map="${field}"]`).value)]));
  importRows = importSheet.slice(1).filter((row) => row.some((value) => value != null && value !== '')).map((row) => Object.fromEntries(columns.map((field) => [field, mapping[field] >= 0 ? String(row[mapping[field]] ?? '') : ''])));
  updateImport();
}

function updateImport() {
  const validated = validateStudents(importRows, studentEmailDomain);
  const count = validated.filter((row) => row.errors.length).length;
  const node = modal.querySelector('#import-table');
  node.innerHTML = `<div class="import-summary">${validated.length} รายชื่อ · ${count ? `${count} รายชื่อที่ต้องแก้ไข` : 'ข้อมูลผ่านการตรวจสอบ'}${validated.length > 200 ? ' · เกินขีดจำกัด 200 คนต่อครั้ง' : ''}</div><div class="table-scroll import-scroll"><table><thead><tr><th>รหัสนักศึกษา</th><th>ชื่อ</th><th>${emailLabel}</th><th>ผลตรวจ</th></tr></thead><tbody>${validated.map((row, index) => `<tr><td><input data-row="${index}" data-field="student_id" value="${e(row.student_id)}" aria-label="รหัสนักศึกษาแถว ${index + 1}"></td><td><input data-row="${index}" data-field="student_name" value="${e(row.student_name)}" aria-label="ชื่อแถว ${index + 1}"></td><td><input data-row="${index}" data-field="student_email" type="email" value="${e(row.student_email)}" placeholder="${emailPlaceholder}" aria-label="อีเมลแถว ${index + 1}"></td><td class="validation ${row.errors.length ? 'invalid' : ''}">${e(row.errors.join(' · ') || 'ผ่าน')}</td></tr>`).join('')}</tbody></table></div>`;
  modal.querySelector('#confirm-import').disabled = !!count || !validated.length || validated.length > 200;
}

async function handleAction(action, button) {
  switch (action) {
    case 'auth-login': state.authMode = 'login'; render(); return;
    case 'auth-signup': state.authMode = 'signup'; state.view = 'student'; render(); return;
    case 'refresh-account': await refreshAccount(); return;
    case 'send-verification': {
      if (Date.now() - state.verificationSentAt < 60000) throw new Error('กรุณารอ 1 นาทีก่อนส่งอีเมลอีกครั้ง');
      await verifyEmail(); state.verificationSentAt = Date.now(); toast('ส่งอีเมลยืนยันแล้ว'); return;
    }
    case 'settings': settingsModal(); return;
    case 'dismiss': modal.close(); return;
    case 'teacher': state.view = 'teacher'; state.result = null; render(); if (canTeach()) await reload(); return;
    case 'student': state.view = 'student'; clearQr(); render(); return;
    case 'logout': state.authMode = 'login'; state.verificationSentAt = 0; await logout(); return;
    case 'new-course': creationModal('course'); return;
    case 'new-section': creationModal('section'); return;
    case 'new-session': creationModal('session'); return;
    case 'tab-attendance': state.tab = 'attendance'; render(); await refreshQr(); return;
    case 'tab-history': state.tab = 'history'; render(); return;
    case 'import': importModal(); return;
    case 'refresh': await reload(); return;
    case 'select-session': state.sessionId = button.dataset.id; state.tab = 'attendance'; await reload(); return;
    case 'start-session': await api(state.mode, '/api/start-session', { session_id: state.sessionId }); await reload(); return;
    case 'close-session': {
      showModal('ปิดรอบเช็คชื่อ', `<form id="close-session-form"><p>ยืนยันปิดรับเช็คชื่อของรอบ ${e(date(session()?.start_time))}?</p>${formFooter('ปิดรอบ')}</form>`); return;
    }
    case 'refresh-qr': await refreshQr(); return;
    case 'copy-qr': if (!state.qr || state.qr.deadline <= performance.now()) throw new Error('ยังไม่มี QR ที่ใช้งานได้'); await navigator.clipboard.writeText(state.qr.qr_url); toast('คัดลอกลิงก์แล้ว'); return;
    case 'open-qr': if (!state.qr || state.qr.deadline <= performance.now()) throw new Error('ยังไม่มี QR ที่ใช้งานได้'); window.open(state.qr.qr_url, '_blank', 'noopener,noreferrer'); return;
    case 'export': {
      const rows = attendanceRows(state.enrollments, state.attendance);
      const text = csvText([['Student ID', 'Name', 'Email', 'Status', 'Check-in time'], ...rows.map((row) => [row.student_id, row.student_name, row.student_email, row.attendance_status, row.checkin_time])]);
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = `attendance-${session()?.session_date || 'roster'}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return;
    }
    case 'reset-password': {
      const email = app.querySelector('[name="email"]').value.trim(); if (!email) throw new Error('กรุณากรอกอีเมลก่อน'); await resetPassword(email); toast('ส่งคำขอตั้งรหัสผ่านใหม่แล้ว'); return;
    }
  }
}

async function submit(form) {
  const data = Object.fromEntries(new FormData(form));
  switch (form.id) {
    case 'settings-form': {
      const firebase = JSON.parse(data.firebase);
      if (!firebase.apiKey || !firebase.authDomain || !firebase.projectId || !firebase.appId || firebase.private_key || firebase.type === 'service_account') throw new Error('ต้องเป็น Firebase Web config ไม่ใช่ service account');
      const url = new URL(data.workerUrl);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Worker URL ต้องเป็น HTTPS หรือ localhost');
      state.config = { firebase, workerUrl: url.origin };
      localStorage.setItem('checkin-public-config', JSON.stringify(state.config)); modal.close(); await setupLive(); toast('บันทึกการตั้งค่าแล้ว'); break;
    }
    case 'login-form': await login(data.email.trim(), data.password); break;
    case 'signup-form': {
      if (data.password.length < 8) throw new Error('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
      if (data.password !== data.confirm_password) throw new Error('รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน');
      if (studentEmailDomain && !data.email.trim().toLowerCase().endsWith(`@${studentEmailDomain}`)) throw new Error('ต้องใช้อีเมลมหาวิทยาลัย');
      state.view = 'student';
      const sent = await signup(data.email.trim(), data.password);
      if (sent) state.verificationSentAt = Date.now();
      toast(sent ? 'ส่งอีเมลยืนยันแล้ว กรุณาตรวจกล่องจดหมายและจดหมายขยะ' : 'สร้างบัญชีแล้ว แต่ส่งอีเมลไม่สำเร็จ กรุณากดส่งอีเมลยืนยันอีกครั้ง', !sent);
      break;
    }
    case 'create-course-form': { const result = await api(state.mode, '/api/create-course', data); modal.close(); await reload({ courseId: result.course_id }); break; }
    case 'create-section-form': { const result = await api(state.mode, '/api/create-section', { ...data, course_id: state.courseId }); modal.close(); await reload({ sectionId: result.section_id }); break; }
    case 'create-session-form': { const result = await api(state.mode, '/api/create-session', { ...data, ...sessionTimes(data), section_id: state.sectionId, session_date: data.start_time.slice(0, 10) }); modal.close(); await reload({ sessionId: result.session_id }); break; }
    case 'close-session-form': await api(state.mode, '/api/close-session', { session_id: state.sessionId }); modal.close(); await reload(); break;
    case 'import-form': {
      const rows = validateStudents(importRows, studentEmailDomain);
      if (!rows.length || rows.length > 200 || rows.some((row) => row.errors.length)) throw new Error('กรุณาแก้ข้อมูลให้ผ่านการตรวจสอบก่อน');
      const result = await api(state.mode, '/api/import-enrollments', { section_id: state.sectionId, students: rows.map(({ errors, ...row }) => row) }); modal.close(); await reload(); toast(`นำเข้า ${result.imported_count} รายชื่อแล้ว`); break;
    }
    case 'checkin-form': {
      if (state.mode === 'live' && (state.user?.role !== 'student' || !state.user?.student_id)) throw new Error('บัญชียังไม่ได้รับสิทธิ์นักศึกษาและรหัสนักศึกษา');
      let token = data.token.trim();
      if (/^https?:\/\//i.test(token)) {
        const link = new URL(token);
        if ((link.searchParams.has('demo') || link.searchParams.get('t')?.startsWith('demo-')) && state.mode !== 'demo') throw new Error('QR ตัวอย่างใช้กับระบบจริงไม่ได้');
        token = link.searchParams.get('t') || '';
      }
      state.token = token;
      state.result = null;
      try { state.result = await api(state.mode, '/api/check-in', { token, student_id: state.studentId }); }
      catch (error) { render(); throw error; }
      render(); break;
    }
  }
}

async function perform(task, form) {
  if (state.busy) return;
  state.busy = true;
  const buttons = [...app.querySelectorAll('button'), ...modal.querySelectorAll('button')];
  const disabled = buttons.map((button) => button.disabled);
  buttons.forEach((button) => { button.disabled = true; });
  try { await task(); }
  catch (error) {
    const node = form?.querySelector('.form-error, #login-error');
    if (node) node.textContent = error.message; else toast(error.message, true);
  } finally {
    state.busy = false;
    buttons.forEach((button, i) => { button.disabled = disabled[i]; });
    const confirmImport = modal.querySelector('#confirm-import');
    if (confirmImport) confirmImport.disabled = !importRows.length || importRows.length > 200 || validateStudents(importRows, studentEmailDomain).some((row) => row.errors.length);
    app.querySelectorAll('button').forEach((button) => { if (button.dataset.action && !['new-section', 'new-session', 'import', 'export'].includes(button.dataset.action)) button.disabled = false; });
    if (document.querySelector('main')?.getAttribute('aria-busy') === 'true') render();
  }
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (button) perform(() => handleAction(button.dataset.action, button));
});
document.addEventListener('submit', (event) => { event.preventDefault(); perform(() => submit(event.target), event.target); });
document.addEventListener('input', (event) => {
  if (event.target.id === 'search') { state.search = event.target.value; document.querySelector('#roster-body').innerHTML = rosterBody(); }
});
document.addEventListener('change', (event) => {
  const input = event.target;
  if (input.id === 'mode') perform(async () => {
    state.generation++; state.mode = input.value; localStorage.setItem('checkin-mode', state.mode); state.result = null; clearQr();
    Object.assign(state, { courses: [], sections: [], sessions: [], enrollments: [], attendance: [], courseId: '', sectionId: '', sessionId: '', error: '' });
    if (state.mode === 'demo' && canTeach() && state.view === 'teacher') await reload(); else { render(); await setupLive(); }
  });
  if (input.id === 'course') perform(() => reload({ courseId: input.value }));
  if (input.id === 'section') perform(() => reload({ sectionId: input.value }));
  if (input.id === 'filter') { state.filter = input.value; document.querySelector('#roster-body').innerHTML = rosterBody(); }
  if (input.id === 'demo-student') { state.studentId = input.value; state.result = null; render(); }
  if (input.dataset.map) mapImport();
  if (input.dataset.row) { importRows[Number(input.dataset.row)][input.dataset.field] = input.value; updateImport(); }
  if (input.id === 'excel-file') perform(async () => {
    const file = input.files[0]; if (!file) return;
    if (file.size > 5 * 1024 * 1024) throw new Error('ไฟล์ต้องไม่เกิน 5 MB');
    importSheet = await readSheet(file);
    if (importSheet.length < 2) throw new Error('ไม่พบรายชื่อในชีตแรก');
    const headers = importSheet[0].map(String);
    const labels = { student_id: 'รหัสนักศึกษา', student_name: 'ชื่อ', student_email: 'อีเมล' };
    const aliases = { student_id: ['STUDENT_NO', 'STUDENT_ID', 'รหัสนักศึกษา'], student_name: ['FULLNAME', 'STUDENT_NAME', 'NAME', 'ชื่อ'], student_email: ['EMAIL', 'STUDENT_EMAIL', 'อีเมล'] };
    modal.querySelector('#import-preview').innerHTML = `<div class="mapping">${Object.entries(labels).map(([field, label]) => `<label>${label}<select data-map="${field}"><option value="-1">ไม่มีคอลัมน์</option>${headers.map((header, i) => `<option value="${i}" ${aliases[field].includes(header.toUpperCase()) ? 'selected' : ''}>${e(header)}</option>`).join('')}</select></label>`).join('')}</div><div id="import-table"></div>`;
    mapImport();
  });
});

async function setupLive() {
  if (state.mode !== 'live' || !state.config.firebase?.apiKey || !state.config.workerUrl) return;
  await connectFirebase(state.config, async (user) => {
    if (state.mode !== 'live') return;
    state.user = user; clearQr();
    if (user && !['instructor', 'admin'].includes(user.role)) state.view = 'student';
    if (!user) { state.result = null; state.error = ''; state.generation++; }
    render();
    if (user && canTeach() && state.view === 'teacher') await reload();
  });
}

setInterval(() => {
  updateCountdown();
  if (!document.hidden && state.nextQr && performance.now() >= state.nextQr && !state.busy) refreshQr();
}, 250);
setInterval(async () => {
  if (document.hidden || state.view !== 'teacher' || state.tab !== 'attendance' || !session() || !['OPEN', 'LATE'].includes(session().status) || state.busy || state.loading) return;
  const generation = state.generation;
  try {
    const result = await api(state.mode, `/api/attendance?session_id=${encodeURIComponent(state.sessionId)}`);
    if (generation !== state.generation) return;
    state.attendance = result.attendance; render();
  } catch (error) { toast(`รีเฟรชไม่สำเร็จ: ${error.message}`, true); }
}, 30000);
window.addEventListener('storage', (event) => {
  if (event.key === DEMO_KEY && state.mode === 'demo' && state.view === 'teacher' && state.sessionId) {
    const store = JSON.parse(event.newValue || 'null');
    if (store) { state.attendance = store.attendance.filter((row) => row.session_id === state.sessionId); render(); }
  }
});
render();
if (state.mode === 'demo' && state.view === 'teacher') reload(); else setupLive().catch((error) => toast(error.message, true));

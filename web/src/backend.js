import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, reload, signOut, sendPasswordResetEmail, onAuthStateChanged, getIdTokenResult } from 'firebase/auth';
import { demoApi } from './demo.js';
import { DOMAIN } from './domain.js';

let app;
let auth;
let unlisten;
let config;
let publishUser;
let accountRevision = 0;
export function loadConfig() {
  let built = {};
  try { built = { firebase: JSON.parse(import.meta.env.VITE_FIREBASE_CONFIG || '{}'), workerUrl: import.meta.env.VITE_WORKER_URL || '' }; } catch { /* Invalid build config remains unconfigured. */ }
  try { return JSON.parse(localStorage.getItem('checkin-public-config')) || built; } catch { return built; }
}

export async function connectFirebase(settings, onUser) {
  unlisten?.();
  if (app) await deleteApp(app);
  config = settings;
  publishUser = onUser;
  app = initializeApp(settings.firebase);
  auth = getAuth(app);
  unlisten = onAuthStateChanged(auth, () => { updateAccount().catch(() => {}); });
}

async function authOperation(operation) {
  try { return await operation(); }
  catch (error) {
    const messages = { 'auth/email-already-in-use': 'อีเมลนี้มีบัญชีแล้ว กรุณาเข้าสู่ระบบหรือตั้งรหัสผ่านใหม่',
      'auth/invalid-email': 'รูปแบบอีเมลไม่ถูกต้อง', 'auth/weak-password': 'รหัสผ่านไม่ผ่านนโยบายความปลอดภัย',
      'auth/invalid-credential': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง', 'auth/too-many-requests': 'ทำรายการบ่อยเกินไป กรุณารอสักครู่',
      'auth/network-request-failed': 'เชื่อมต่อไม่ได้ กรุณาตรวจอินเทอร์เน็ต', 'auth/operation-not-allowed': 'ยังไม่ได้เปิดการสมัครด้วยอีเมลและรหัสผ่าน' };
    throw new Error(messages[error.code] || error.message);
  }
}

async function updateAccount(refresh = false) {
  const revision = ++accountRevision;
  const user = auth?.currentUser;
  if (!user) { await publishUser(null); return; }
  let account = { email: user.email, email_verified: user.emailVerified, role: null };
  try {
    if (refresh) { await reload(user); await user.getIdToken(true); }
    const claims = (await getIdTokenResult(user)).claims;
    account.email_verified = claims.email_verified === true;
    if (['instructor', 'admin'].includes(claims.role)) {
      account = { ...account, role: claims.role, instructor_id: claims.instructor_id };
    } else if (account.email_verified) {
      account = { ...account, ...await api('live', '/api/me') };
      if (!account.role) account = { ...account, ...await api('live', '/api/register-student', {}) };
    }
  } catch (error) { account = { ...account, role: null, account_error: error.message }; }
  if (revision === accountRevision && auth.currentUser === user) await publishUser(account);
}

export const login = (email, password) => authOperation(() => signInWithEmailAndPassword(auth, email, password));
export async function signup(email, password) {
  const { user } = await authOperation(() => createUserWithEmailAndPassword(auth, email, password));
  try { await authOperation(() => sendEmailVerification(user)); return true; }
  catch { return false; }
}
export const verifyEmail = () => authOperation(() => sendEmailVerification(auth.currentUser));
export const refreshAccount = () => updateAccount(true);
export const logout = () => signOut(auth);
export const resetPassword = (email) => authOperation(() => sendPasswordResetEmail(auth, email));

export async function api(mode, path, body) {
  if (mode === 'demo') return demoApi(path, body, Date.now(), location.href, import.meta.env.VITE_ALLOW_ANY_STUDENT_EMAIL_FOR_TESTING === 'true' ? '' : DOMAIN);
  if (!auth?.currentUser || !config?.workerUrl) throw new Error('กรุณาตั้งค่า Firebase และเข้าสู่ระบบก่อน');
  const response = await fetch(`${config.workerUrl.replace(/\/$/, '')}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${await auth.currentUser.getIdToken()}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok) {
    const messages = { QR_TOKEN_EXPIRED: 'QR หมดอายุ กรุณาสแกนใหม่', TOKEN_EXPIRED: 'QR หมดอายุ กรุณาสแกนใหม่',
      CHECKIN_CLOSED: 'ปิดรับเช็คชื่อแล้ว', STUDENT_NOT_ENROLLED: 'ไม่มีรายชื่อในกลุ่มเรียน', NOT_ENROLLED: 'อีเมลหรือรายชื่อไม่ตรงกับกลุ่มเรียน',
      INVALID_EMAIL_DOMAIN: 'ต้องใช้อีเมลมหาวิทยาลัย', INSTRUCTOR_ROLE_REQUIRED: 'บัญชีนี้ไม่มีสิทธิ์ผู้สอน',
      EMAIL_NOT_VERIFIED: 'กรุณายืนยันอีเมลก่อน', STUDENT_NOT_IN_ROSTER: 'ยังไม่พบอีเมลนี้ในรายชื่อ กรุณาติดต่ออาจารย์เพื่อนำเข้ารายชื่อ',
      AMBIGUOUS_STUDENT_EMAIL: 'อีเมลนี้ตรงกับหลายรหัสนักศึกษา กรุณาให้อาจารย์แก้รายชื่อ',
      ACCOUNT_LINK_CONFLICT: 'บัญชีไม่ตรงกับรายชื่อหรือผูกไว้กับบัญชีอื่นแล้ว กรุณาติดต่ออาจารย์',
      ACCOUNT_LINK_RETRY: 'รายชื่อเปลี่ยนระหว่างผูกบัญชี กรุณาลองตรวจสอบบัญชีอีกครั้ง', STUDENT_NOT_LINKED: 'ยังไม่ได้ผูกบัญชีกับรายชื่อนักศึกษา' };
    throw new Error(messages[result.error] || result.message || `HTTP ${response.status}`);
  }
  return result;
}

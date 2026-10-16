import { escapeHtml as e } from './domain.js';

const labels = { PENDING: 'รอพิจารณา', MORE_INFO: 'ขอข้อมูลเพิ่ม', APPROVED: 'อนุมัติ · 1 คะแนน', REJECTED: 'ไม่อนุมัติ' };
const when = value => new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' });
const editable = row => ['PENDING', 'MORE_INFO'].includes(row.status) && Date.now() <= Date.parse(row.evidence_due_at);
const button = (action, text, id = '', style = '') => `<button type="button" class="${style}" data-action="leave-${action}" data-id="${e(id)}">${text}</button>`;
const filesField = `<label>หลักฐานการลา (รูปถ่ายสูงสุด 2 รูป)<input name="evidence" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple></label>`;
const footer = label => `<div class="form-error" role="alert"></div><footer><button type="button" data-action="dismiss">ยกเลิก</button><button class="primary" type="submit">${label}</button></footer>`;

export async function evidencePhoto(file) {
  if (!file || file.size > 10 * 1024 * 1024 || !/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) throw new Error('กรุณาเลือกรูปถ่าย JPEG, PNG, WebP หรือ HEIC ขนาดไม่เกิน 10 MB');
  const url = URL.createObjectURL(file), image = new Image();
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('อ่านรูปถ่ายไม่ได้ กรุณาใช้ JPEG หรือ PNG')); image.src = url; });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('รูปถ่ายไม่มีข้อมูลภาพ');
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.7, 0.5, 0.3, 0.15]) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= 500 * 1024) return blob;
    }
    throw new Error('รูปถ่ายยังใหญ่เกิน 500 KB หลังย่อ กรุณาเลือกรูปอื่น');
  } finally { URL.revokeObjectURL(url); }
}

export function createLeaveUI(ui) {
  let data = { rounds: [], requests: [], attachments_enabled: false }, loaded = false, selected = null;
  let studentTab = false, identity = '', loadRevision = 0;
  let previewUrl = '';
  function closePreview() { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = ''; }
  const call = (path, body) => ui.api(ui.mode(), path, body);
  const currentIdentity = () => `${ui.mode()}:${ui.studentId()}`;
  const assertContext = (revision, key) => {
    if (revision !== loadRevision || key !== currentIdentity()) throw new Error('บัญชีหรือมุมมองเปลี่ยน กรุณาเปิดคำขอใหม่');
  };
  const rows = () => [...data.requests].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const status = row => `<span class="badge ${row.status === 'APPROVED' ? 'on_time' : row.status === 'REJECTED' ? 'closed' : 'late'}">${row.status === 'PENDING' && !row.attachments?.length ? 'รอหลักฐาน' : labels[row.status] || e(row.status)}</span>`;
  const fileButtons = row => (row.attachments || []).map((file, index) => button('file', `ดูหลักฐาน ${index + 1}`, file.id, 'text-button')).join('');
  const summary = row => `<strong>${e(row.course_code)} · กลุ่ม ${e(row.section_code)}</strong><p class="muted">${when(row.start_time)}</p>${status(row)}<p class="leave-reason">${e(row.reason)}</p><p class="muted">แนบหลักฐานภายใน ${when(row.evidence_due_at)}${editable(row) ? '' : ['PENDING', 'MORE_INFO'].includes(row.status) ? ' · เกินกำหนด' : ''}</p>${row.reviewer_note ? `<p class="leave-reason">หมายเหตุผู้สอน: ${e(row.reviewer_note)}</p>` : ''}<div class="actions">${fileButtons(row)}</div>`;
  async function load(sectionId) {
    const revision = ++loadRevision, key = currentIdentity();
    const query = sectionId ? `?section_id=${encodeURIComponent(sectionId)}` : ui.mode() === 'demo' ? `?student_id=${encodeURIComponent(ui.studentId())}` : '';
    const result = await call(`/api/leave-data${query}`);
    if (revision !== loadRevision || key !== currentIdentity()) return false;
    data = result; loaded = true; identity = key; return true;
  }
  function studentContent() {
    const available = (data.rounds || []).filter(round => !data.requests.some(row => row.session_id === round.id));
    return `<div class="leave-student"><div class="register-toolbar"><h2>คำขอลาของฉัน</h2>${button('refresh', 'รีเฟรช')}</div>
      ${!loaded ? '<div class="empty">ยังไม่ได้โหลดคำขอลา</div>' : `${available.length ? `<form id="leave-create-form">
        <label>รอบที่เปิดรับคำขอลา<select name="session_id" required><option value="">เลือกรอบ</option>${available.map(round => `<option value="${e(round.id)}">${e(round.course_code)} · กลุ่ม ${e(round.section_code)} · ${when(round.start_time)}</option>`).join('')}</select></label>
        <label class="check-label"><input name="leave_confirmed" type="checkbox" required>ขอลาในรอบที่เลือก</label>
        <label>เหตุผลการลา<textarea name="reason" maxlength="1000" required rows="3"></textarea></label>
        ${data.attachments_enabled ? filesField : '<p class="muted">ยังไม่เปิดรับไฟล์หลักฐาน</p>'}
        <label class="check-label"><input name="paper_confirmed" type="checkbox" required>จะส่งหลักฐานภายใน 7 วัน และส่งใบลาฉบับพิมพ์ให้ผู้สอนภายหลัง</label>
        <div class="form-error" role="alert"></div><button class="primary" type="submit" ${!data.rounds.length ? 'disabled' : ''}>ยืนยันคำขอลา</button>
      </form>` : '<p class="muted" role="status">ไม่มีรอบที่เปิดรับคำขอใหม่</p>'}<div class="leave-list">${rows().map(row => `<article class="leave-item">${summary(row)}${button('student-detail', 'รายละเอียดคำขอ', row.id)}</article>`).join('') || '<p class="empty">ยังไม่มีคำขอลา</p>'}</div>`}</div>`;
  }
  function reviewList() {
    ui.showModal('คำขอลานักศึกษา', `<div class="leave-list">${rows().map(row => `<article class="leave-item"><strong>${e(row.student_name)} · ${e(row.student_id)}</strong><p>${e(row.course_code)} · ${when(row.start_time)}</p>${status(row)}<p>${row.attachments?.length || 0} รูป · ${row.paper_received ? 'รับฉบับพิมพ์แล้ว' : 'ยังไม่รับฉบับพิมพ์'}</p>${button('review-detail', 'พิจารณาคำขอ', row.id)}</article>`).join('') || '<p class="empty">ยังไม่มีคำขอลา</p>'}</div>`, true);
  }
  async function detail(id, isTeacher) {
    const revision = loadRevision, key = currentIdentity();
    const row = data.requests.find(row => row.id === id);
    if (!row) throw new Error('ไม่พบคำขอลา กรุณารีเฟรชข้อมูล');
    selected = row;
    if (!isTeacher) {
      ui.showModal('รายละเอียดคำขอลา', `${summary(row)}${editable(row) ? `<form id="leave-edit-form"><label>เหตุผลการลา<textarea name="reason" maxlength="1000" rows="3" required>${e(row.reason)}</textarea></label>${data.attachments_enabled ? filesField : ''}${footer('บันทึกคำขอ')}</form>` : ''}`);
      return;
    }
    const result = await call(`/api/attendance?session_id=${encodeURIComponent(row.session_id)}`);
    assertContext(revision, key);
    const attendance = result.attendance.find(value => value.student_id === row.student_id);
    selected = { ...row, expected_attendance_version: attendance?.attendance_version || null };
    ui.showModal('พิจารณาคำขอลา', `<p><strong>${e(row.student_name)} · ${e(row.student_id)}</strong></p>${summary(row)}
      <form id="leave-review-form"><label>ผลพิจารณา<select name="decision">${row.status === 'APPROVED' ? '<option value="REVOKE">ยกเลิกอนุมัติและคืนคะแนนเดิม</option>' : `${row.attachments?.length && ['PENDING', 'MORE_INFO'].includes(row.status) ? '<option value="APPROVE">อนุมัติลา · 1 คะแนน</option>' : ''}<option value="MORE_INFO">ขอข้อมูลเพิ่ม</option><option value="REJECT">ไม่อนุมัติ</option>${['PENDING', 'MORE_INFO'].includes(row.status) ? '<option value="EXTEND">ขยายเวลาแนบหลักฐาน</option>' : ''}`}</select></label>
      <label>หมายเหตุผู้สอน<textarea name="note" rows="3" maxlength="1000"></textarea></label>
      <label id="leave-extension" hidden>ขยายเวลา (วัน)<input name="days" type="number" min="1" max="30" step="1" value="7"></label>
      ${footer('ยืนยันผลพิจารณา')}</form><div class="leave-paper"><label class="check-label"><input id="leave-paper-received" type="checkbox" ${row.paper_received ? 'checked' : ''}>รับใบลาฉบับพิมพ์แล้ว</label>${button('paper', 'บันทึกการรับใบลา')}</div>`);
  }
  async function uploadPhotos(id, photos) {
    for (const [slot, photo] of photos.entries()) {
      const row = data.requests.find(row => row.id === id);
      if (ui.mode() === 'demo') {
        const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(photo); });
        await call('/api/leave-upload', { request_id: id, expected_version: row.request_version, slot, base64 });
      } else {
        const query = new URLSearchParams({ request_id: id, expected_version: row.request_version, slot: String(slot) });
        await call(`/api/leave-upload?${query}`, photo);
      }
      await load();
    }
  }
  return {
    closePreview,
    change(input) {
      if (input.name === 'decision' && ui.modal.querySelector('#leave-extension')) ui.modal.querySelector('#leave-extension').hidden = input.value !== 'EXTEND';
    },
    async openForStudent(studentId) {
      if (!await load(ui.sectionId())) return false;
      const row = data.requests.find(row => row.student_id === studentId && row.session_id === ui.sessionId());
      if (!row) return false;
      await detail(row.id, true); return true;
    },
    reset() { closePreview(); loadRevision++; studentTab = false; loaded = false; selected = null; identity = ''; data = { rounds: [], requests: [] }; },
    get active() { return studentTab; },
    studentView() {
      if (identity && identity !== currentIdentity()) { loaded = false; data = { rounds: [], requests: [] }; }
      return `<div class="tabs leave-tabs" role="tablist"><button role="tab" aria-selected="${!studentTab}" data-action="leave-checkin">เช็คชื่อ</button><button role="tab" aria-selected="${studentTab}" data-action="leave-student">คำขอลา</button></div>${studentTab ? studentContent() : ''}`;
    },
    async action(action, node) {
      switch (action) {
        case 'leave-checkin': studentTab = false; ui.render(); return;
        case 'leave-student': studentTab = true; if (await load()) ui.render(); return;
        case 'leave-refresh': if (await load()) ui.render(); return;
        case 'leave-teacher': if (await load(ui.sectionId())) reviewList(); return;
        case 'leave-student-detail': await detail(node.dataset.id, false); return;
        case 'leave-review-detail': await detail(node.dataset.id, true); return;
        case 'leave-paper': {
          const row = selected, revision = loadRevision, key = currentIdentity();
          await call('/api/leave-review', { request_id: row.id, expected_version: row.request_version,
            action: 'PAPER', received: ui.modal.querySelector('#leave-paper-received').checked });
          assertContext(revision, key);
          await load(row.section_id); await detail(row.id, true); ui.toast('บันทึกการรับใบลาแล้ว'); return;
        }
        case 'leave-file': {
          const revision = loadRevision, key = currentIdentity();
          const result = await call(`/api/leave-file?request_id=${encodeURIComponent(data.requests.find(row => row.attachments?.some(file => file.id === node.dataset.id))?.id || '')}&file_id=${encodeURIComponent(node.dataset.id)}`);
          assertContext(revision, key);
          if (!ui.modal.open) ui.showModal('หลักฐานการลา', '');
          const image = document.createElement('img'); image.className = 'leave-evidence-preview'; image.alt = 'หลักฐานการลา';
          closePreview();
          if (result.blob) { previewUrl = URL.createObjectURL(result.blob); image.src = previewUrl; }
          else image.src = `data:image/jpeg;base64,${result.base64}`;
          let preview = ui.modal.querySelector('.leave-evidence-preview');
          if (preview) preview.replaceWith(image); else ui.modal.append(image);
          return;
        }
      }
    },
    async submit(form) {
      const revision = loadRevision, key = currentIdentity();
      const values = new FormData(form), body = Object.fromEntries(values);
      if (form.id === 'leave-review-form') {
        const decision = body.decision, row = selected;
        if (['REJECT', 'MORE_INFO', 'EXTEND'].includes(decision) && !body.note.trim()) throw new Error('กรุณาระบุหมายเหตุผู้สอน');
        await call('/api/leave-review', { request_id: row.id, expected_version: row.request_version,
          expected_attendance_version: row.expected_attendance_version, action: decision, note: body.note, days: Number(body.days) });
        assertContext(revision, key);
        await load(row.section_id); reviewList(); await ui.onReviewed(); ui.toast('บันทึกผลพิจารณาแล้ว'); return;
      }
      const files = values.getAll('evidence').filter(file => file?.size);
      if (files.length > 2) throw new Error('แนบรูปถ่ายได้สูงสุด 2 รูป');
      const photos = [];
      for (const file of files) photos.push(await evidencePhoto(file));
      assertContext(revision, key);
      let id = selected?.id, persisted = false;
      try {
        if (form.id === 'leave-create-form') {
          const result = await call('/api/leave-create', { session_id: body.session_id, reason: body.reason,
            leave_confirmed: body.leave_confirmed === 'on', paper_confirmed: body.paper_confirmed === 'on', student_id: ui.studentId() });
          id = result.request_id;
        } else await call('/api/leave-update', { request_id: id, expected_version: selected.request_version, reason: body.reason });
        persisted = true;
        await load(); await uploadPhotos(id, photos);
        ui.modal.close(); ui.render(); ui.toast('บันทึกคำขอลาแล้ว');
      } catch (error) {
        if (persisted) { ui.modal.close(); await load(); ui.render(); ui.toast(`บันทึกคำขอลาแล้ว แต่แนบหลักฐานไม่สำเร็จ: ${error.message} สามารถแนบภายหลังได้`, true); }
        else throw error;
      }
    },
  };
}

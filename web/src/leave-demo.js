export function demoLeave(store, url, body, now) {
  const fail = message => { throw new Error(message); };
  const uuid = () => crypto.randomUUID();
  const accepting = round => round.active && ['OPEN', 'LATE'].includes(round.status) && now >= Date.parse(round.checkin_open_time) && now <= Date.parse(round.checkin_close_time);
  const reason = text => { if (typeof text !== 'string' || !text.trim() || text.trim().length > 1000) fail('กรุณาระบุเหตุผลไม่เกิน 1000 ตัวอักษร'); return text.trim(); };
  store.leave_requests ||= []; store.leave_files ||= []; store.leave_reviews ||= [];
  const requests = store.leave_requests;
  const active = row => store.courses.some(course => course.id === row.course_id && course.active !== false && course.purge_state !== 'IN_PROGRESS') && store.sections.some(section => section.id === row.section_id && section.active !== false);
  if (url.pathname === '/api/leave-data') {
    const sectionId = url.searchParams.get('section_id'), studentId = url.searchParams.get('student_id');
    return { requests: requests.filter(row => sectionId ? row.section_id === sectionId : row.student_id === studentId),
      rounds: sectionId ? [] : store.sessions.filter(round => accepting(round) && active(round) && store.enrollments.some(row => row.section_id === round.section_id && row.student_id === studentId && row.status === 'ACTIVE')),
      attachments_enabled: true };
  }
  if (url.pathname === '/api/leave-create') {
    const round = store.sessions.find(row => row.id === body.session_id);
    const student = store.enrollments.find(row => row.section_id === round?.section_id && row.student_id === body.student_id && row.status === 'ACTIVE');
    if (!round || !student || !accepting(round) || !active(round)) fail('ส่งคำขอลาได้เฉพาะรอบที่เปิดรับและมีรายชื่อเท่านั้น');
    if (!body.leave_confirmed || !body.paper_confirmed) fail('กรุณายืนยันคำขอลาและการส่งใบลาฉบับพิมพ์');
    if (requests.some(row => row.session_id === round.id && row.student_id === student.student_id)) fail('ส่งคำขอลาในรอบนี้แล้ว');
    const row = { id: `${round.id}_${student.student_id}`, student_id: student.student_id, student_name: student.student_name,
      student_email: student.student_email, course_id: round.course_id, section_id: round.section_id, session_id: round.id,
      course_code: round.course_code, section_code: round.section_code, start_time: round.start_time,
      reason: reason(body.reason), status: 'PENDING', attachments: [], paper_received: false,
      created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(),
      evidence_due_at: new Date(now + 7 * 86400000).toISOString(), request_version: uuid() };
    requests.push(row); return { request_id: row.id };
  }
  const row = requests.find(row => row.id === (body.request_id || url.searchParams.get('request_id')));
  if (!row) fail('ไม่พบคำขอลา');
  if (url.pathname === '/api/leave-file') {
    const id = url.searchParams.get('file_id');
    if (!row.attachments.some(file => file.id === id)) fail('ไม่พบหลักฐาน');
    return { base64: store.leave_files.find(file => file.id === id)?.base64, content_type: 'image/jpeg' };
  }
  if (body.expected_version !== row.request_version) fail('คำขอลาเปลี่ยนแล้ว กรุณารีเฟรช');
  if (['/api/leave-update', '/api/leave-upload'].includes(url.pathname)) {
    if (!['PENDING', 'MORE_INFO'].includes(row.status)) fail('คำขอนี้ล็อกการแก้ไขแล้ว');
    if (now > Date.parse(row.evidence_due_at)) fail('เกินกำหนดแนบหลักฐาน กรุณาขอขยายเวลาจากผู้สอน');
    if (url.pathname === '/api/leave-update') row.reason = reason(body.reason);
    else {
      if (![0, 1].includes(body.slot)) fail('แนบได้สูงสุด 2 รูป');
      const id = uuid(); row.attachments[body.slot] = { id, uploaded_at: new Date(now).toISOString() };
      store.leave_files.push({ id, course_id: row.course_id, section_id: row.section_id, request_id: row.id, base64: body.base64 });
    }
  } else if (url.pathname === '/api/leave-review') {
    const action = body.action;
    if (['APPROVE', 'REVOKE'].includes(action)) {
      if (action === 'APPROVE' && (!['PENDING', 'MORE_INFO'].includes(row.status) || !row.attachments.length)) fail('ต้องมีหลักฐานและคำขอที่รอพิจารณา');
      if (action === 'REVOKE' && row.status !== 'APPROVED') fail('ยังไม่ได้อนุมัติคำขอนี้');
      const existing = store.attendance.find(attendance => attendance.session_id === row.session_id && attendance.student_id === row.student_id);
      if ((existing?.attendance_version || null) !== body.expected_attendance_version) fail('ข้อมูลเช็คชื่อเปลี่ยนแล้ว กรุณารีเฟรช');
      if (action === 'APPROVE') {
        const original = existing?.attendance_status === 'LEAVE_APPROVED' ? existing.leave_original : existing ? { attendance_status: existing.attendance_status, source: existing.source || null } : null;
        const attendance = existing || { id: uuid(), student_id: row.student_id, student_name: row.student_name, student_email: row.student_email,
          session_id: row.session_id, section_id: row.section_id, course_id: row.course_id, course_code: row.course_code, section_code: row.section_code, checkin_time: null };
        Object.assign(attendance, { attendance_status: 'LEAVE_APPROVED', source: 'INSTRUCTOR_LEAVE', leave_original: original,
          leave_note: row.reason, leave_approved_at: new Date(now).toISOString(), attendance_version: uuid() });
        if (!existing) store.attendance.push(attendance);
        row.status = 'APPROVED';
      } else {
        if (existing?.attendance_status !== 'LEAVE_APPROVED') fail('ไม่พบคะแนนลาเดิม');
        if (existing.leave_original) Object.assign(existing, existing.leave_original, { leave_original: null, leave_note: null, leave_approved_at: null, attendance_version: uuid() });
        else store.attendance.splice(store.attendance.indexOf(existing), 1);
        row.status = 'PENDING';
      }
      row.reviewer_note = body.note || '';
    } else if (action === 'PAPER') row.paper_received = body.received === true;
    else if (['REJECT', 'MORE_INFO'].includes(action)) {
      if (row.status === 'APPROVED') fail('กรุณายกเลิกอนุมัติก่อน');
      row.status = action === 'REJECT' ? 'REJECTED' : 'MORE_INFO'; row.reviewer_note = reason(body.note);
    } else if (action === 'EXTEND') {
      if (!['PENDING', 'MORE_INFO'].includes(row.status) || !Number.isInteger(body.days) || body.days < 1 || body.days > 30) fail('ขยายเวลาได้เฉพาะคำขอที่รอพิจารณา 1–30 วัน');
      row.evidence_due_at = new Date(Math.max(now, Date.parse(row.evidence_due_at)) + body.days * 86400000).toISOString(); row.reviewer_note = reason(body.note);
    } else fail('คำสั่งไม่ถูกต้อง');
    store.leave_reviews.push({ id: uuid(), course_id: row.course_id, section_id: row.section_id, request_id: row.id, action, note: body.note || null });
  } else fail('ไม่พบคำสั่ง');
  row.request_version = uuid(); row.updated_at = new Date(now).toISOString();
  return { request_id: row.id };
}

import QrScanner from 'qr-scanner';
import { qrTokenFromText, escapeHtml } from './domain.js';

let active = null;

export function closeQrScanner() {
  const session = active;
  active = null;
  if (!session) return false;
  session.reader.destroy();
  session.video.srcObject?.getTracks().forEach((track) => track.stop());
  session.video.srcObject = null;
  return true;
}

function cameraError(error) {
  const text = `${error?.name || ''} ${error?.message || error || ''}`;
  if (/NotAllowed|Permission|denied/i.test(text)) return 'ไม่ได้รับอนุญาตให้ใช้กล้อง';
  if (/NotFound|not found|DevicesNotFound/i.test(text)) return 'เปิดกล้องไม่ได้ กรุณาตรวจการอนุญาตกล้อง';
  if (/NotReadable|TrackStart|in use/i.test(text)) return 'กล้องไม่พร้อมใช้งาน';
  return 'เปิดกล้องไม่ได้';
}

export function mountQrScanner(modal, onScan, allowDemo) {
  closeQrScanner();
  const video = modal.querySelector('#scanner-video');
  const error = modal.querySelector('#scanner-error');
  const status = modal.querySelector('#scanner-status');
  const cameras = modal.querySelector('#scanner-camera');
  const retry = modal.querySelector('#scanner-retry');
  const session = { video, reader: null, starting: false, accepted: false };
  const current = () => active === session && modal.open;
  const accept = (value) => {
    if (!current() || session.accepted) return;
    try {
      const token = qrTokenFromText(value, allowDemo);
      session.accepted = true;
      closeQrScanner();
      modal.close();
      onScan(token);
    } catch (failure) { error.textContent = failure.message; }
  };
  session.reader = new QrScanner(video, (result) => accept(result.data), {
    preferredCamera: 'environment', maxScansPerSecond: 10, returnDetailedScanResult: true,
    onDecodeError: () => {}, highlightScanRegion: true,
    calculateScanRegion: (element) => {
      const width = element.videoWidth, height = element.videoHeight;
      const scale = Math.min(1, 768 / Math.max(width, height));
      return { x: 0, y: 0, width, height, downScaledWidth: Math.round(width * scale), downScaledHeight: Math.round(height * scale) };
    },
  });
  active = session;
  const start = async () => {
    if (!current() || session.starting) return;
    session.starting = true; retry.disabled = true; error.textContent = ''; status.textContent = 'กำลังเปิดกล้อง…';
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Camera unavailable');
      await session.reader.start();
      if (!current()) { session.reader.destroy(); return; }
      status.textContent = 'กำลังสแกน';
      const devices = await QrScanner.listCameras();
      if (!current()) return;
      cameras.innerHTML = devices.map((device, index) => `<option value="${escapeHtml(device.id)}">${escapeHtml(device.label || `กล้อง ${index + 1}`)}</option>`).join('');
      const deviceId = video.srcObject?.getVideoTracks()[0]?.getSettings().deviceId;
      if (devices.some((device) => device.id === deviceId)) cameras.value = deviceId;
      cameras.disabled = devices.length < 2;
    } catch (failure) {
      if (current()) { session.reader.stop(); status.textContent = 'กล้องปิดอยู่'; error.textContent = cameraError(failure); }
    } finally {
      session.starting = false;
      if (current()) retry.disabled = false;
    }
  };
  retry.addEventListener('click', start);
  cameras.addEventListener('change', async () => {
    cameras.disabled = true; error.textContent = '';
    try { await session.reader.setCamera(cameras.value); }
    catch (failure) { if (current()) error.textContent = cameraError(failure); }
    finally { if (current()) cameras.disabled = cameras.options.length < 2; else session.reader.destroy(); }
  });
  void start();
}

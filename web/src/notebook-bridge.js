const LOCAL_ORIGIN = 'http://127.0.0.1:8788';
const LIVE_URL = /^https:\/\/prepense\.github\.io\/P7-Student-Check-in\/\?t=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;
export class NotebookBridge {
  constructor({ window = globalThis.window, now = () => performance.now(), onChange = () => {}, onInterrupted = () => {}, onRecovered = () => {}, onTick = () => {} } = {}) {
    Object.assign(this, { window, now, onChange, onInterrupted, onRecovered, onTick });
    this.connected = false; this.connecting = false; this.recovering = false; this.enabled = true; this.target = null; this.frame = 0; this.error = '';
    this.listener = event => this.receive(event); window?.addEventListener('message', this.listener);
    this.resumeListener = () => this.checkHealth();
    window?.addEventListener('focus', this.resumeListener);
    window?.document?.addEventListener('visibilitychange', this.resumeListener);
    window?.document?.addEventListener('resume', this.resumeListener);
  }
  connect() {
    if (this.popup && !this.popup.closed) { this.popup.focus(); return; }
    this.nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
    this.frame = 0; this.error = ''; this.status = null; this.target = null; this.connected = false; this.connecting = true; this.recovering = false;
    this.popup = this.window.open(`${LOCAL_ORIGIN}/bridge#${this.nonce}`, '_blank', 'popup,width=520,height=400');
    if (!this.popup) { this.connecting = false; throw Error('กรุณาอนุญาตหน้าต่างป๊อปอัปสำหรับเชื่อมต่อ hotspot'); }
    this.approvalDeadline = this.now() + 120000;
    clearInterval(this.watchdog);
    this.watchdog = setInterval(() => {
      if (this.popup?.closed) this.disconnect();
      else if (this.connecting && this.now() > this.approvalDeadline) {
        this.disconnect(); this.error = 'ยังไม่ได้อนุญาต หรือไม่พบโปรแกรม hotspot บน notebook'; this.onChange();
      } else this.checkHealth();
    }, 1000);
    this.onChange();
  }
  receive(event) {
    if (event.origin !== LOCAL_ORIGIN || event.source !== this.popup || !this.popup || event.data?.nonce !== this.nonce) return;
    const type = event.data.type;
    if (type === 'notebook-ready') this.post('notebook-hello', { pagePath: this.window.location?.pathname || '/' });
    else if (type === 'notebook-connected') { this.connected = true; this.connecting = false; this.recovering = false; this.error = ''; this.target = null; this.lastTick = this.now(); this.onRecovered(); this.onChange(); }
    else if (type === 'notebook-tick' && this.connected) {
      this.lastTick = this.now(); this.status = event.data.status;
      if (this.recovering || this.status?.clientAlive === false) {
        if (!this.recovering) this.interrupt();
        if (!this.recoveryRequested) { this.recoveryRequested = true; this.onRecovered(); }
      }
      if (this.status?.clientAlive && this.status.state === 'active') { this.recovering = false; this.error = ''; }
      this.onTick(); this.sendFrame(); this.onChange();
    } else if (type === 'notebook-stalled' && this.connected) {
      this.interrupt();
    } else if (type === 'notebook-rejected') {
      this.target = null;
      if (!this.lastRejected || this.now() - this.lastRejected >= 10000) {
        this.lastRejected = this.now(); this.error = 'ตัวส่งปฏิเสธ QR กรุณาตรวจเวลาเครื่องและรับ QR ใหม่'; this.onInterrupted(); this.onRecovered(); this.onChange();
      }
    }
    else if (type === 'notebook-disconnected') { this.connected = false; this.connecting = false; this.recovering = false; this.status = null; this.target = null; this.error = 'Hotspot ขาดการเชื่อมต่อ กรุณาอนุญาตใหม่'; this.onInterrupted(); this.onChange(); }
  }
  interrupt() {
    if (!this.recovering) {
      this.recovering = true; this.recoveryRequested = false; this.target = null; this.status = null;
      this.error = 'กำลังกู้คืน hotspot · รอ QR ใหม่'; this.onInterrupted();
    }
    this.onChange();
  }
  checkHealth() {
    if (!this.connected || this.now() - this.lastTick < 5000) return;
    this.interrupt();
    this.post('notebook-resume');
  }
  post(type, data = {}) { this.popup?.postMessage({ type, nonce: this.nonce, ...data }, LOCAL_ORIGIN); }
  update(qr, enabled = true) {
    this.enabled = enabled;
    this.target = enabled && qr && LIVE_URL.test(qr.url) && qr.url.length <= 768 && Number.isFinite(qr.deadline) ? { ...qr } : null;
    if (this.popup && !this.enabled) this.disconnect();
  }
  sendFrame() {
    if (!this.connected) return;
    const ttl = Math.min(20000, Math.floor((this.target?.deadline || 0) - this.now()));
    const active = this.enabled && this.target && ttl > 300;
    this.post('notebook-frame', { frame: { frame: ++this.frame, enabled: this.enabled, url: active ? this.target.url : null, ttl_ms: active ? ttl : 0 } });
  }
  disconnect() {
    const wasConnected = this.connected;
    this.post('notebook-close'); clearInterval(this.watchdog);
    this.popup = null; this.nonce = null; this.connected = false; this.connecting = false; this.recovering = false; this.status = null; this.target = null; this.error = '';
    if (wasConnected) this.onInterrupted();
    this.onChange();
  }
}

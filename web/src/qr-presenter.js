import QRCode from 'qrcode';

export class QrPresenter {
  constructor({ onChange = () => {}, now = () => performance.now() } = {}) {
    this.onChange = onChange;
    this.now = now;
    this.window = null;
    this.opening = false;
    this.epoch = 0;
    this.revision = 0;
    this.qr = null;
    this.message = 'รอเปิดรอบเช็คชื่อ';
  }

  get isOpen() { return !!this.window && !this.window.closed; }

  async open() {
    if (this.isOpen) { this.window.focus(); return; }
    if (this.opening) return;
    if (!globalThis.documentPictureInPicture?.requestWindow) throw new Error('หน้าต่าง QR ลอยต้องใช้ Chrome หรือ Edge ที่รองรับบนคอมพิวเตอร์');
    this.opening = true;
    const epoch = ++this.epoch;
    this.onChange();
    try {
      const target = await documentPictureInPicture.requestWindow({ width: 640, height: 640 });
      if (epoch !== this.epoch) { target.close(); return; }
      this.window = target;
      const doc = target.document;
      doc.title = 'QR เช็คชื่อ';
      doc.documentElement.lang = 'th';
      const style = doc.createElement('style');
      style.textContent = `
        * { box-sizing: border-box; }
        html, body { margin: 0; width: 100%; height: 100%; background: #fff; color: #187650; }
        body { display: grid; place-items: center; padding: 12px; overflow: hidden; font: 20px/1.5 system-ui, sans-serif; text-align: center; }
        canvas { display: block; width: min(calc(100vw - 24px), calc(100vh - 24px)); height: auto; aspect-ratio: 1; }
        [hidden] { display: none !important; }
        p { margin: 0; overflow-wrap: anywhere; }
      `;
      doc.head.append(style);
      doc.body.innerHTML = '<canvas id="presentation-qr" hidden aria-label="QR เช็คชื่อ"></canvas><p id="presentation-status" role="status"></p>';
      const timer = target.setInterval(() => this.paint(), 250);
      target.addEventListener('pagehide', () => {
        target.clearInterval(timer);
        if (this.window !== target) return;
        this.window = null;
        this.revision++;
        this.renderedUrl = null;
        this.onChange();
      }, { once: true });
      this.renderedUrl = null;
      this.paint();
    } finally { this.opening = false; this.onChange(); }
  }

  update(qr, message = 'รอเปิดรอบเช็คชื่อ') {
    if (this.qr?.url !== qr?.url || this.qr?.deadline !== qr?.deadline) this.revision++;
    this.qr = qr ? { ...qr } : null;
    this.message = message;
    this.paint();
  }

  paint() {
    if (!this.isOpen) return;
    const doc = this.window.document;
    const canvas = doc.querySelector('#presentation-qr');
    const status = doc.querySelector('#presentation-status');
    if (!canvas || !status) return;
    if (!this.qr || this.qr.deadline <= this.now()) {
      canvas.hidden = true;
      status.hidden = false;
      status.textContent = this.qr ? 'QR หมดอายุ' : this.message;
      this.renderedUrl = null;
      return;
    }
    if (this.renderedUrl === this.qr.url || this.paintingRevision === this.revision) return;
    const revision = this.revision, target = this.window, qr = this.qr;
    this.paintingRevision = revision;
    // Render offscreen so a late QR render can never overwrite a cleared or newer token.
    const buffer = doc.createElement('canvas');
    void QRCode.toCanvas(buffer, qr.url, { width: 1024, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } }).then(() => {
      if (this.window !== target || revision !== this.revision || qr.deadline <= this.now()) return;
      canvas.width = buffer.width; canvas.height = buffer.height;
      canvas.getContext('2d').drawImage(buffer, 0, 0);
      canvas.hidden = false; status.hidden = true;
      this.renderedUrl = qr.url;
    }).catch(() => {
      if (this.window !== target || revision !== this.revision) return;
      canvas.hidden = true; status.hidden = false; status.textContent = 'แสดง QR ไม่สำเร็จ';
    }).finally(() => { if (this.paintingRevision === revision) this.paintingRevision = null; });
  }

  close() {
    if (!this.window && !this.opening) return;
    this.epoch++;
    this.window?.close();
  }
}

const LIVE_URL = /^https:\/\/prepense\.github\.io\/P7-Student-Check-in\/\?t=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;
const HEX = /^[a-f0-9]{16}$/;

export class SerialBridge {
  constructor({ serial = globalThis.navigator?.serial, now = () => performance.now(), onChange = () => {}, onInterrupted = () => {}, onRecovered = () => {}, timeout = 1200, retryDelay = 1000 } = {}) {
    Object.assign(this, { serial, now, onChange, onInterrupted, onRecovered, timeout, retryDelay });
    this.connected = false;
    this.connecting = false;
    this.enabled = true;
    this.target = null;
    this.sent = null;
    this.pending = new Map();
    this.id = 0;
    this.seq = 0;
    this.status = null;
    this.error = '';
    this.wanted = false;
    this.recovering = false;
    this.connectionEpoch = 0;
    this.retryAttempt = 0;
  }

  connect(recovery = false) {
    if (this.connecting || this.connected || this.closing) return this.connectTask;
    if (recovery && (!this.wanted || !this.enabled || !this.savedPort)) return;
    const epoch = ++this.connectionEpoch;
    this.connectTask = this.openConnection(recovery, epoch).finally(() => { this.connectTask = null; });
    return this.connectTask;
  }

  async openConnection(recovery, epoch) {
    if (!this.serial) throw new Error('Web Serial is unavailable. Use desktop Chrome or Edge over HTTPS.');
    const checkCancelled = () => {
      if (epoch !== this.connectionEpoch) throw new DOMException('USB connection cancelled.', 'AbortError');
    };
    this.connecting = true;
    if (!recovery) this.error = '';
    this.onChange();
    try {
      // Recovery reopens only the exact port selected in this page's user gesture.
      this.port = recovery ? this.savedPort : await this.serial.requestPort({ filters: [{ usbVendorId: 0x10c4, usbProductId: 0xea60 }] });
      checkCancelled();
      await this.port.open({ baudRate: 115200, bufferSize: 8192 });
      checkCancelled();
      await this.port.setSignals({ dataTerminalReady: false, requestToSend: false });
      checkCancelled();
      this.writer = this.port.writable.getWriter();
      this.reader = this.port.readable.getReader();
      this.readTask = this.readLoop();
      let hello;
      for (let attempt = 0; attempt < 4; attempt++) {
        try { hello = await this.command('hello'); break; }
        catch (error) { if (attempt === 3 || !this.reader) throw error; }
      }
      checkCancelled();
      if (hello?.role !== 'qr-host' || !HEX.test(hello.boot)) throw new Error('Selected device is not a ready QR host.');
      if (!hello.ap_ready) throw new Error('QR host radio is not ready.');
      this.boot = hello.boot;
      this.stream = Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => byte.toString(16).padStart(2, '0')).join('');
      this.seq = 0;
      this.sent = null;
      this.status = hello;
      await this.streamCommand('begin');
      checkCancelled();
      if (!this.reader) throw new Error('QR host USB disconnected during handshake.');
      this.connected = true;
      this.wanted = true;
      this.savedPort = this.port;
      this.error = '';
      this.retryAttempt = 0;
      if (recovery) { this.target = null; this.onRecovered(); }
      checkCancelled();
      this.recovering = false;
      this.lastHeartbeat = -Infinity;
      this.lastStatus = -Infinity;
      this.timer = setInterval(() => this.pump(), 250);
      this.pump();
    } catch (error) {
      await this.closePort();
      if (epoch !== this.connectionEpoch || error.name === 'AbortError') return;
      if (error.name !== 'NotFoundError') this.error = error.message;
      if (!recovery) { this.wanted = false; if (error.name !== 'NotFoundError') throw error; }
      else if (error.name === 'SecurityError' || error.message === 'Selected device is not a ready QR host.') { this.wanted = false; this.recovering = false; }
    } finally {
      this.connecting = false;
      this.onChange();
      if (recovery) this.scheduleRecovery();
    }
  }

  update(qr, enabled = true) {
    this.enabled = enabled;
    this.target = !this.recovering && qr && LIVE_URL.test(qr.url) && qr.url.length <= 768 && Number.isFinite(qr.deadline) ? { ...qr } : null;
    this.pump();
  }

  pump() {
    if (!this.connected || this.pumping || this.closing) return this.pumping;
    this.pumping = this.flush().catch((error) => {
      // Do not await our own pump while closing the port.
      this.fail(error);
    }).finally(() => { this.pumping = null; });
    return this.pumping;
  }

  async flush() {
    const active = this.enabled && this.target?.deadline > this.now() ? this.target : null;
    if (active && (this.sent?.url !== active.url || this.sent?.deadline !== active.deadline)) {
      const ttl = Math.min(20000, Math.floor(active.deadline - this.now()));
      if (ttl > 0) {
        await this.streamCommand('qr', { seq: ++this.seq, ttl_ms: ttl, url: active.url });
        this.sent = active;
        this.lastHeartbeat = this.now();
      }
    } else if (!active && this.sent) {
      await this.streamCommand('clear', { seq: ++this.seq });
      this.sent = null;
    }
    // Ineligible views stop renewing the five-second USB lease; visibility alone does not.
    if (this.enabled) {
      if (this.now() - this.lastHeartbeat >= 900) {
        await this.streamCommand('heartbeat');
        this.lastHeartbeat = this.now();
      }
      if (this.now() - this.lastStatus >= 900) {
        const status = await this.command('status');
        if (status.role !== 'qr-host' || status.boot !== this.boot || status.stream !== this.stream || !status.ap_ready) throw new Error('QR host restarted or USB stream changed. Reconnect USB.');
        this.status = status;
        this.lastStatus = this.now();
        this.onChange();
      }
    }
  }

  async streamCommand(type, data = {}) {
    const reply = await this.command(type, { boot: this.boot, stream: this.stream, ...data });
    if (reply.type !== 'ack' || reply.boot !== this.boot) throw new Error('Unexpected QR host acknowledgement.');
    return reply;
  }

  async command(type, data = {}) {
    const id = ++this.id;
    let timer;
    const reply = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('QR host USB response timed out.')), this.timeout);
      this.pending.set(id, { resolve, reject });
    });
    // Attach a rejection handler before a potentially stalled USB write.
    reply.catch(() => {});
    try {
      const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, type, id, ...data }) + '\n');
      await Promise.race([this.writer.write(bytes), reply]);
      return await reply;
    } finally { clearTimeout(timer); this.pending.delete(id); }
  }

  async readLoop() {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
          let message;
          try { message = JSON.parse(line); } catch { continue; }
          if (message.v !== 1) continue;
          const pending = this.pending.get(message.id);
          if (!pending) continue;
          if (message.type === 'error') pending.reject(new Error(`QR host: ${message.code || 'USB error'}`));
          else pending.resolve(message);
        }
        if (buffer.length > 8192) throw new Error('Invalid QR host USB response.');
      }
      if (!this.closing) throw new Error('QR host USB disconnected.');
    } catch (error) {
      for (const pending of this.pending.values()) pending.reject(error);
      if (!this.closing && !this.connecting) this.fail(error);
    } finally { this.reader?.releaseLock(); this.reader = null; }
  }

  disconnect() {
    this.wanted = false;
    this.recovering = false;
    this.error = '';
    this.connectionEpoch++;
    clearTimeout(this.retryTimer);
    this.target = null;
    this.onChange();
    // Let an in-flight open/handshake observe cancellation before releasing its locks.
    if (this.connecting) return this.connectTask.catch(() => {}).then(() => this.closePort());
    return this.closePort();
  }

  fail(error) {
    if (this.closing || this.recovering) return;
    this.error = error.message;
    this.recovering = this.wanted && this.enabled;
    this.target = null;
    this.connected = false;
    this.onInterrupted();
    void this.closePort().then(() => this.scheduleRecovery());
  }

  scheduleRecovery() {
    clearTimeout(this.retryTimer);
    if (!this.wanted || !this.enabled || this.connected || !this.savedPort) return;
    this.retryTimer = setTimeout(() => { void this.connect(true); }, Math.min(10000, this.retryDelay * 2 ** Math.min(this.retryAttempt++, 4)));
  }

  resume() {
    if (!this.wanted || !this.enabled || this.connected || this.connecting || this.closing) return;
    clearTimeout(this.retryTimer);
    void this.connect(true);
  }

  closePort() {
    if (this.closing) return this.closing;
    clearInterval(this.timer);
    const wasConnected = this.connected;
    this.connected = false;
    this.onChange();
    this.closing = (async () => {
      await this.pumping;
      if (wasConnected && this.writer) {
        try { await this.streamCommand('clear', { seq: ++this.seq }); } catch { /* The USB lease still fails closed. */ }
      }
      try { await this.reader?.cancel(); await this.readTask; } catch { /* Device may have been unplugged. */ }
      try { await this.writer?.abort(); } catch { /* Device may have been unplugged. */ }
      try { this.writer?.releaseLock(); } catch { /* Port may already be closed. */ }
      this.writer = null;
      try { await this.port?.close(); } catch { /* An unopened port has no locks to release. */ }
      this.port = null; this.status = null; this.sent = null;
    })().finally(() => { this.closing = null; this.onChange(); });
    return this.closing;
  }
}

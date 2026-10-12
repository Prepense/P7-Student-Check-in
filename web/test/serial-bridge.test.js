import assert from 'node:assert/strict';
import test from 'node:test';
import { SerialBridge } from '../src/serial-bridge.js';

const url = `https://prepense.github.io/P7-Student-Check-in/?t=synthetic_payload.${'A'.repeat(43)}`;
function fixture(t, { role = 'qr-host', cancel = false, timeout = 100, retryDelay = 1000 } = {}) {
  let clock = 1000, controller, boot = '0123456789abcdef', stream = '';
  const commands = [];
  const port = {
    opens: 0, requests: 0,
    async open(options) {
      assert.equal(options.baudRate, 115200); port.opens++;
      if (port.openGate) await port.openGate;
      if (port.unavailable) throw new DOMException('USB removed', 'NetworkError');
      port.opened = true; port.closed = false;
      port.readable = new ReadableStream({ start(value) { controller = value; } });
      port.writable = new WritableStream({ write(bytes) {
      const command = JSON.parse(new TextDecoder().decode(bytes)); commands.push(command);
      if (port.silent) return;
      if (command.type === 'begin') stream = command.stream;
      const reply = command.type === 'hello' || command.type === 'status'
        ? { v: 1, type: command.type, id: command.id, role, boot, stream, ap_ready: true, displays: [true, false] }
        : { v: 1, type: 'ack', id: command.id, boot };
      if (port.rejectType === command.type) Object.assign(reply, { type: 'error', code: 'NO_STREAM' });
      const encoded = new TextEncoder().encode('startup noise\n' + JSON.stringify(reply) + '\n');
      controller.enqueue(encoded.slice(0, 13)); controller.enqueue(encoded.slice(13));
      }, abort() { if (port.abortThrows) throw new Error('Disconnected USB writer'); } });
    },
    async setSignals(signals) { assert.deepEqual(signals, { dataTerminalReady: false, requestToSend: false }); },
    async close() { assert.equal(port.readable.locked, false); assert.equal(port.writable.locked, false); port.closed = true; },
  };
  const serial = { async requestPort(options) {
    port.requests++;
    assert.deepEqual(options.filters, [{ usbVendorId: 0x10c4, usbProductId: 0xea60 }]);
    if (cancel) throw new DOMException('Cancelled', 'NotFoundError');
    return port;
  } };
  const bridge = new SerialBridge({ serial, now: () => clock, timeout, retryDelay });
  t.after(() => bridge.disconnect());
  return { bridge, port, commands, time(value) { clock = value; }, reboot() { boot = 'abcdef0123456789'; }, unplug() { controller.error(new Error('Unplugged')); } };
}

test('handshake, fragmented JSON, exact URL, heartbeat and two display slots', async (t) => {
  const { bridge, commands, time } = fixture(t);
  await bridge.connect(); await bridge.pumping;
  assert.equal(bridge.connected, true);
  assert.deepEqual(bridge.status.displays, [true, false]);
  assert.equal(commands[0].type, 'hello');
  assert.match(commands[1].stream, /^[a-f0-9]{16}$/);
  bridge.update({ url, deadline: 21000 }); await bridge.pumping;
  const qr = commands.find((row) => row.type === 'qr');
  assert.equal(qr.url, url); assert.equal(qr.ttl_ms, 20000); assert.equal(qr.seq, 1);
  assert.equal(qr.boot, commands[1].boot); assert.equal(qr.stream, commands[1].stream);
  time(2200); await bridge.pump();
  assert.ok(commands.filter((row) => row.type === 'heartbeat').length >= 2);
  assert.equal(commands.some((row) => row.type === 'pairing'), false);
  await bridge.disconnect();
  assert.equal(commands.filter((row) => row.type === 'clear').length, 1);
});

async function until(predicate) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('USB recovery did not reach expected state');
}

test('lease loss reopens only the selected port with a fresh stream and no cached QR', async (t) => {
  const { bridge, port, commands, time } = fixture(t, { retryDelay: 10 });
  let interrupted = 0, recovered = 0;
  bridge.onInterrupted = () => interrupted++;
  bridge.onRecovered = () => recovered++;
  await bridge.connect(); await bridge.pumping;
  bridge.update({ url, deadline: 21000 }); await bridge.pumping;
  const previousStream = bridge.stream;
  port.rejectType = 'heartbeat'; time(2200);
  await bridge.pump(); await bridge.closing;
  assert.equal(bridge.recovering, true);
  bridge.update({ url, deadline: 21000 });
  assert.equal(bridge.target, null);
  port.rejectType = null;
  await until(() => recovered === 1); await bridge.pumping;
  assert.equal(interrupted, 1); assert.equal(port.requests, 1); assert.equal(port.opens, 2);
  assert.notEqual(bridge.stream, previousStream);
  assert.equal(commands.filter((row) => row.type === 'qr').length, 1);
  bridge.update({ url: url.replace('synthetic_payload', 'fresh_payload'), deadline: 15000 }); await bridge.pumping;
  assert.equal(commands.at(-1).type, 'qr');
  assert.equal(commands.at(-1).stream, bridge.stream);
  assert.equal(bridge.error, '');
});

test('host reboot and USB response timeout recover without another permission picker', async (t) => {
  for (const failure of ['reboot', 'timeout']) {
    const { bridge, port, time, reboot } = fixture(t, { retryDelay: 10, timeout: 20 });
    await bridge.connect(); await bridge.pumping;
    if (failure === 'reboot') reboot(); else port.silent = true;
    time(2200); await bridge.pump(); await bridge.closing;
    port.silent = false;
    await until(() => bridge.connected); await bridge.pumping;
    assert.equal(port.requests, 1); assert.equal(port.opens, 2);
    if (failure === 'reboot') assert.equal(bridge.boot, 'abcdef0123456789');
    assert.equal(bridge.pending.size, 0);
  }
});

test('unplug retries with backoff, resumes when available, and can be stopped', async (t) => {
  const { bridge, port, unplug } = fixture(t, { retryDelay: 10 });
  await bridge.connect(); await bridge.pumping;
  port.unavailable = true; unplug();
  await until(() => port.opens >= 3 && !bridge.connecting && !bridge.closing);
  assert.equal(port.requests, 1); assert.equal(bridge.connected, false);
  port.unavailable = false; bridge.resume();
  await until(() => bridge.connected); await bridge.pumping;
  port.unavailable = true; unplug();
  await until(() => bridge.recovering && !bridge.closing);
  await bridge.disconnect();
  const opens = port.opens;
  bridge.resume(); await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(port.opens, opens); assert.equal(bridge.wanted, false);
});

test('disconnect while reopening cancels a late open without beginning a new stream', async (t) => {
  const { bridge, port, unplug, commands } = fixture(t, { retryDelay: 10 });
  await bridge.connect(); await bridge.pumping;
  let release;
  port.openGate = new Promise((resolve) => { release = resolve; });
  unplug(); await until(() => port.opens === 2);
  const stopped = bridge.disconnect(); release(); await stopped;
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(bridge.connected, false); assert.equal(bridge.wanted, false);
  assert.equal(commands.filter((row) => row.type === 'begin').length, 1);
  assert.equal(port.closed, true); assert.equal(port.opens, 2);
});

test('unsupported device or revoked permission never triggers background selection', async (t) => {
  const { bridge, port, unplug } = fixture(t, { retryDelay: 10 });
  await bridge.connect(); await bridge.pumping;
  port.open = async () => { port.opens++; throw new DOMException('Permission revoked', 'SecurityError'); };
  unplug(); await until(() => !bridge.wanted);
  const opens = port.opens;
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(port.opens, opens); assert.equal(port.requests, 1);
  assert.equal(bridge.recovering, false);
});

test('repeated renders never resend a token or renew its TTL; expiry clears', async (t) => {
  const { bridge, commands, time } = fixture(t);
  await bridge.connect(); await bridge.pumping;
  time(3000); bridge.update({ url, deadline: 5500 }); await bridge.pumping;
  assert.equal(commands.find((row) => row.type === 'qr').ttl_ms, 2500);
  time(4000); bridge.update({ url, deadline: 5500 }); await bridge.pumping;
  assert.equal(commands.filter((row) => row.type === 'qr').length, 1);
  time(5500); await bridge.pump();
  assert.equal(commands.filter((row) => row.type === 'clear').length, 1);
  bridge.update({ url, deadline: 5500 }); await bridge.pumping;
  assert.equal(commands.filter((row) => row.type === 'qr').length, 1);
});

test('clear, visibility pause, and new QR preserve increasing sequence', async (t) => {
  const { bridge, commands, time } = fixture(t);
  await bridge.connect(); await bridge.pumping;
  bridge.update({ url, deadline: 21000 }); await bridge.pumping;
  bridge.update(null, false); await bridge.pumping;
  const count = commands.length;
  time(15000); await bridge.pump(); assert.equal(commands.length, count);
  bridge.update({ url: url.replace('synthetic', 'fresh'), deadline: 16000 }); await bridge.pumping;
  assert.deepEqual(commands.filter((row) => ['qr', 'clear'].includes(row.type)).map((row) => row.seq), [1, 2, 3]);
});

test('rejects arbitrary URLs, demo tokens, overlong URLs and expired deadlines', async (t) => {
  const { bridge, commands } = fixture(t);
  await bridge.connect(); await bridge.pumping;
  for (const value of ['https://evil.example/?t=test', 'http://127.0.0.1:5173/?t=test', url + '&extra=1', url.replace('synthetic_payload', 'x'.repeat(800))]) {
    bridge.update({ url: value, deadline: 11000 }); await bridge.pumping;
  }
  bridge.update({ url, deadline: 999 }); await bridge.pumping;
  assert.equal(commands.some((row) => row.type === 'qr'), false);
});

test('cancelled selection is quiet and selecting the display is rejected', async (t) => {
  const cancelled = fixture(t, { cancel: true });
  await cancelled.bridge.connect(); assert.equal(cancelled.bridge.error, '');
  const wrong = fixture(t, { role: 'qr-display' });
  await assert.rejects(wrong.bridge.connect(), /not a ready QR host/);
  assert.equal(wrong.port.closed, true); assert.equal(wrong.bridge.connected, false);
});

test('host reboot fails closed and releases serial locks', async (t) => {
  const { bridge, commands, time, reboot, port } = fixture(t);
  await bridge.connect(); await bridge.pumping;
  bridge.update({ url, deadline: 21000 }); await bridge.pumping;
  reboot(); time(2200); await bridge.pump(); await bridge.closing;
  assert.equal(bridge.connected, false); assert.equal(port.closed, true);
  assert.match(bridge.error, /acknowledgement|restarted/);
  assert.equal(commands.filter((row) => row.type === 'qr').length, 1);
});

test('USB timeout fails closed, without leaking a pending request', async (t) => {
  const { bridge, port, time } = fixture(t, { timeout: 25 });
  await bridge.connect(); await bridge.pumping;
  port.silent = true; time(2200); await bridge.pump(); await bridge.closing;
  assert.equal(bridge.connected, false); assert.equal(port.closed, true);
  assert.equal(bridge.pending.size, 0); assert.match(bridge.error, /timed out/);
});

test('USB unplug and firmware error stop transmission', async (t) => {
  const { bridge, port } = fixture(t);
  await bridge.connect(); await bridge.pumping;
  port.rejectType = 'qr'; bridge.update({ url, deadline: 21000 }); await bridge.pumping; await bridge.closing;
  assert.equal(bridge.connected, false); assert.match(bridge.error, /NO_STREAM/);
  const second = fixture(t);
  await second.bridge.connect(); await second.bridge.pumping;
  // The second fixture exercises a fresh stream independently of the rejected port.
  second.unplug(); await new Promise((resolve) => setTimeout(resolve, 0)); await second.bridge.closing;
  assert.equal(second.bridge.connected, false); assert.equal(second.port.closed, true);
});

test('writer abort errors still release the port for reconnection', async (t) => {
  const { bridge, port } = fixture(t);
  await bridge.connect(); await bridge.pumping;
  port.abortThrows = true;
  await bridge.disconnect();
  assert.equal(port.closed, true);
  assert.equal(port.writable.locked, false);
});

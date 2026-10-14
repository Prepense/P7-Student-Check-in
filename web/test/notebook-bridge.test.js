import test from 'node:test';
import assert from 'node:assert/strict';
import { NotebookBridge } from '../src/notebook-bridge.js';
function fixture() {
  const posted = []; let clock = 0, recovered = 0, interrupted = 0;
  const popup = { closed: false, focus() {}, postMessage: message => posted.push(message) };
  const window = { addEventListener() {}, open() { return popup; } };
  const bridge = new NotebookBridge({ window, now: () => clock, onRecovered: () => recovered++, onInterrupted: () => interrupted++ });
  bridge.connect();
  const receive = (type, extra = {}) => bridge.receive({ source: popup, origin: 'http://127.0.0.1:8788', data: { type, nonce: bridge.nonce, ...extra } });
  return { bridge, popup, posted, receive, advance: ms => { clock += ms; }, counts: () => ({ recovered, interrupted }) };
}
const url = 'https://prepense.github.io/P7-Student-Check-in/?t=synthetic_payload.' + 'S'.repeat(43);
test('hotspot bridge binds messages to origin, popup and ephemeral nonce', () => {
  const f = fixture(); try {
    for (const event of [{ origin: 'https://untrusted.example', source: f.popup, data: { type: 'notebook-connected', nonce: f.bridge.nonce } }, { origin: 'http://127.0.0.1:8788', source: {}, data: { type: 'notebook-connected', nonce: f.bridge.nonce } }, { origin: 'http://127.0.0.1:8788', source: f.popup, data: { type: 'notebook-connected', nonce: 'wrong' } }]) f.bridge.receive(event);
    assert.equal(f.bridge.connected, false); f.receive('notebook-ready'); assert.equal(f.posted.at(-1).type, 'notebook-hello');
    f.receive('notebook-connected'); assert.equal(f.bridge.connected, true); assert.equal(f.counts().recovered, 1);
  } finally { f.bridge.disconnect(); }
});
test('server-driven ticks preserve QR bytes and reduce TTL without browser heartbeat timers', () => {
  const f = fixture(); try {
    f.receive('notebook-connected'); f.bridge.update({ url, deadline: 10000 }); f.receive('notebook-tick', { status: { clientAlive: true } });
    const first = f.posted.at(-1).frame; assert.equal(first.url, url); assert.equal(first.ttl_ms, 10000);
    f.advance(1100); f.receive('notebook-tick', { status: { clientAlive: true } });
    assert.equal(f.posted.at(-1).frame.ttl_ms, 8900); assert.ok(f.posted.at(-1).frame.frame > first.frame);
    f.advance(10000); f.receive('notebook-tick', { status: { clientAlive: true } }); assert.equal(f.posted.at(-1).frame.url, null);
  } finally { f.bridge.disconnect(); }
});
test('ineligible views, lease interruption and arbitrary URLs fail closed', () => {
  const f = fixture(); try {
    f.receive('notebook-connected'); f.bridge.update({ url: 'https://example.com/?display_test=1&sequence=1', deadline: 1000 });
    f.receive('notebook-tick', { status: { clientAlive: true } }); assert.equal(f.posted.at(-1).frame.url, null);
    f.bridge.update({ url, deadline: 10000 }); f.receive('notebook-tick', { status: { clientAlive: false } });
    assert.equal(f.bridge.target, null); assert.equal(f.counts().interrupted, 1);
    f.bridge.update({ url, deadline: 10000 }, false); assert.equal(f.bridge.connected, false); assert.equal(f.posted.at(-1).type, 'notebook-close');
  } finally { f.bridge.disconnect(); }
});

test('missing ticks do not leave a healthy status and recovery requires a fresh QR', () => {
  const f = fixture(); try {
    f.receive('notebook-connected'); f.bridge.update({ url, deadline: 20000 });
    f.receive('notebook-tick', { status: { clientAlive: true, state: 'active', displays: ['fixture'] } });
    f.advance(5100); f.bridge.checkHealth();
    assert.equal(f.bridge.recovering, true); assert.equal(f.bridge.target, null);
    assert.equal(f.bridge.status, null); assert.match(f.bridge.error, /กู้คืน/);
    assert.equal(f.posted.at(-1).type, 'notebook-resume');
    f.bridge.checkHealth(); assert.equal(f.counts().interrupted, 1);
    f.receive('notebook-tick', { status: { clientAlive: false, state: 'usb_lost' } });
    assert.equal(f.counts().recovered, 2); assert.equal(f.posted.at(-1).frame.url, null);
    f.receive('notebook-tick', { status: { clientAlive: false, state: 'usb_lost' } });
    assert.equal(f.counts().recovered, 2, 'Do not invalidate an in-flight QR every tick');
    const fresh = url.replace('synthetic_payload', 'fresh_payload');
    f.bridge.update({ url: fresh, deadline: 25000 });
    f.receive('notebook-tick', { status: { clientAlive: true, state: 'active' } });
    assert.equal(f.bridge.recovering, false); assert.equal(f.bridge.error, '');
    assert.equal(f.posted.at(-1).frame.url, fresh);
  } finally { f.bridge.disconnect(); }
});

test('a stalled or revoked popup clears stale display status without prompting for a new grant', () => {
  const f = fixture(); try {
    f.receive('notebook-connected'); f.bridge.update({ url, deadline: 20000 });
    f.receive('notebook-stalled'); f.receive('notebook-stalled');
    assert.equal(f.counts().interrupted, 1); assert.equal(f.bridge.recovering, true);
    f.receive('notebook-disconnected');
    assert.equal(f.bridge.connected, false); assert.equal(f.bridge.status, null);
    assert.match(f.bridge.error, /อนุญาตใหม่/);
  } finally { f.bridge.disconnect(); }
});

import test from "node:test";
import assert from "node:assert/strict";
import { decide } from "./alert.mjs";

const cfg = { sleepConfirm: 3, blockStep: 100 };
const run = (running, extra = {}) => ({ running, rpm: 20, blockHeight: NaN, checkpoint: null, ...extra });

test("first run learns the state silently", () => {
  const { state, events } = decide({}, run(true, { blockHeight: 4135, checkpoint: { corePaused: false, nextRound: "1", roundSettled: true } }), cfg);
  assert.equal(events.length, 0);
  assert.equal(state.awake, true);
  assert.equal(state.cpReady, true);
  assert.equal(state.milestone, 41);
});

test("wake fires once when the wheel starts", () => {
  let s = decide({}, run(false), cfg).state;
  let r = decide(s, run(true), cfg);
  assert.deepEqual(r.events.map((e) => e.kind), ["wake"]);
  r = decide(r.state, run(true), cfg);
  assert.equal(r.events.length, 0);
});

test("sleep needs several idle samples in a row", () => {
  let s = decide({}, run(true), cfg).state;
  for (let i = 0; i < 2; i++) {
    const r = decide(s, run(false), cfg);
    assert.equal(r.events.length, 0);
    s = r.state;
  }
  const r = decide(s, run(false), cfg);
  assert.deepEqual(r.events.map((e) => e.kind), ["sleep"]);
});

test("a short pause does not announce sleep", () => {
  let s = decide({}, run(true), cfg).state;
  s = decide(s, run(false), cfg).state;
  s = decide(s, run(true), cfg).state;
  assert.equal(s.idleStreak, 0);
  assert.equal(s.awake, true);
});

test("unknown status is never treated as idle", () => {
  let s = decide({}, run(true), cfg).state;
  for (let i = 0; i < 5; i++) s = decide(s, run(null), cfg).state;
  assert.equal(s.awake, true);
  assert.equal(s.idleStreak, 0);
});

test("checkpoint alert fires on false -> true only", () => {
  const notReady = { corePaused: false, nextRound: "1974", roundSettled: false };
  const ready = { corePaused: false, nextRound: "1975", roundSettled: true };
  let s = decide({}, run(null, { checkpoint: notReady }), cfg).state;
  let r = decide(s, run(null, { checkpoint: ready }), cfg);
  assert.deepEqual(r.events.map((e) => e.kind), ["checkpoint"]);
  r = decide(r.state, run(null, { checkpoint: ready }), cfg);
  assert.equal(r.events.length, 0);
  r = decide(r.state, run(null, { checkpoint: { ...ready, corePaused: true } }), cfg);
  assert.equal(r.events.length, 0);
  assert.equal(r.state.cpReady, false);
});

test("paused core is never 'ready'", () => {
  const s = decide({}, run(null, { checkpoint: { corePaused: false, nextRound: "1", roundSettled: false } }), cfg).state;
  const r = decide(s, run(null, { checkpoint: { corePaused: true, nextRound: "1", roundSettled: true } }), cfg);
  assert.equal(r.events.length, 0);
});

test("block milestone fires when a multiple of the step is crossed", () => {
  let s = decide({}, run(null, { blockHeight: 4195 }), cfg).state;
  let r = decide(s, run(null, { blockHeight: 4199 }), cfg);
  assert.equal(r.events.length, 0);
  r = decide(r.state, run(null, { blockHeight: 4203 }), cfg);
  assert.deepEqual(r.events.map((e) => e.kind), ["milestone"]);
  assert.match(r.events[0].title, /4200/);
});

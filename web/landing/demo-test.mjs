import assert from 'node:assert/strict';
import { setMaxListeners } from 'node:events';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Run the shipped demo against a small DOM and clock so every lifecycle edge is
// reproducible without waiting for animations or relying on a browser viewport.
const source = (await readFile(new URL('./src/demo.js', import.meta.url), 'utf8'))
  .replaceAll('export function ', 'function ');

class Element extends EventTarget {
  constructor(properties = {}) {
    super();
    Object.assign(this, { hidden: false, inert: false, textContent: '', dataset: {} }, properties);
    this.attributes = new Map();
    this.classList = {
      values: new Set(),
      add(value) { this.values.add(value); },
      remove(value) { this.values.delete(value); },
      contains(value) { return this.values.has(value); },
    };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  querySelectorAll(selector) { return selector === '[data-message]' ? this.messages ?? [] : []; }
}

function demo({ reducedMotion = false, intersectionObserver = true } = {}) {
  const controls = Object.fromEntries([
    'handoff', 'demo-title', 'demo-toggle', 'demo-action-text', 'demo-control-icon',
    'demo-previous', 'demo-next', 'demo-counter', 'demo-status',
  ].map(id => [id, new Element()]));
  const scenes = [2, 3, 1].map((count, index) => new Element({
    dataset: { title: `Example ${index + 1}` },
    messages: Array.from({ length: count }, (_, message) => new Element({
      textContent: `Message ${message + 1} for example ${index + 1}`,
    })),
  }));
  const document = new EventTarget();
  document.hidden = false;
  document.querySelector = selector => controls[selector.slice(1)];
  document.querySelectorAll = selector => selector === '[data-demo-scene]' ? scenes : [];
  const window = new EventTarget();
  const motion = new EventTarget();
  motion.matches = reducedMotion;
  window.matchMedia = query => {
    assert.equal(query, '(prefers-reduced-motion: reduce)');
    return motion;
  };
  const timers = new Map();
  let now = 0;
  let timerId = 0;
  window.setTimeout = (callback, delay = 0) => {
    assert.ok(Number.isFinite(delay) && delay >= 0, 'timer has a valid delay');
    timers.set(++timerId, { callback, due: now + delay });
    return timerId;
  };
  window.clearTimeout = id => timers.delete(id);
  const observers = [];
  if (intersectionObserver) window.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this); }
    observe(target) { this.targets.add(target); }
    disconnect() { this.targets.clear(); }
  };
  class BrowserAbortController extends AbortController {
    constructor() { super(); setMaxListeners(0, this.signal); }
  }
  const context = vm.createContext({
    window, document, AbortController: BrowserAbortController, performance: { now: () => now },
  });
  vm.runInContext(source, context);
  const initialize = () => vm.runInContext('initHandoffDemo()', context);
  const cleanup = initialize();

  function advanceBy(duration) {
    const end = now + duration;
    let callbacks = 0;
    while (timers.size) {
      const [id, timer] = [...timers].sort((a, b) => a[1].due - b[1].due)[0];
      if (timer.due > end) break;
      assert.ok(++callbacks < 1000, 'timer loop makes progress');
      now = timer.due;
      timers.delete(id);
      timer.callback();
    }
    now = end;
  }
  const nextDelay = () => {
    assert.equal(timers.size, 1, 'playback owns exactly one timer');
    return [...timers.values()][0].due - now;
  };
  return {
    controls, scenes, timers, observers, initialize, cleanup, advanceBy, nextDelay,
    nextTick() { advanceBy(nextDelay()); },
    click(id) { controls[id].dispatchEvent(new Event('click')); },
    page(type) { window.dispatchEvent(new Event(type)); },
    visible(value) {
      for (const observer of observers) {
        if (observer.targets.has(controls.handoff)) {
          observer.callback([{ target: controls.handoff, isIntersecting: value }]);
        }
      }
    },
    hidden(value) { document.hidden = value; document.dispatchEvent(new Event('visibilitychange')); },
    reduced(value) { motion.matches = value; motion.dispatchEvent(new Event('change')); },
    assertScene(index, revealed) {
      assert.equal(controls['demo-title'].textContent, scenes[index].dataset.title);
      assert.equal(controls['demo-counter'].textContent, `${index + 1} / ${scenes.length}`);
      scenes.forEach((scene, sceneIndex) => {
        const selected = index === sceneIndex;
        assert.equal(scene.inert, !selected, 'only the current scene is interactive');
        assert.equal(scene.getAttribute('aria-hidden'), String(!selected), 'inactive scenes are hidden from assistive technology');
        scene.messages.forEach((message, messageIndex) => {
          assert.equal(message.getAttribute('aria-hidden'), String(!selected || messageIndex >= revealed),
            'only revealed messages in the current scene are accessible');
        });
      });
    },
  };
}

// Visibility starts playback without a click; every message is shown before the
// next example, and the final example wraps around to the first.
{
  const d = demo();
  d.assertScene(0, 0);
  assert.equal(d.timers.size, 0, 'below-fold demo waits for intersection evidence');
  d.advanceBy(60000);
  d.assertScene(0, 0);
  d.visible(true);
  assert.equal(d.controls.handoff.dataset.state, 'playing');
  assert.equal(d.initialize(), d.cleanup, 'repeated initialization reuses the live demo');
  d.page('pageshow');
  assert.equal(d.observers.length, 1);
  for (let index = 0; index < d.scenes.length; index++) {
    d.assertScene(index, 0);
    for (let message = 0; message < d.scenes[index].messages.length; message++) {
      d.nextTick();
      d.assertScene(index, message + 1);
    }
    const readingDelay = d.nextDelay();
    d.advanceBy(readingDelay - 1);
    d.assertScene(index, d.scenes[index].messages.length);
    d.advanceBy(1);
    d.assertScene((index + 1) % d.scenes.length, 0);
  }
  d.cleanup();
  assert.equal(d.timers.size, 0);
}

// Automatic suspension preserves the unspent reading time, including when
// viewport and document visibility change independently.
{
  const d = demo();
  d.visible(true);
  d.nextTick();
  const readingDelay = d.nextDelay();
  d.advanceBy(1000);
  d.visible(false);
  assert.equal(d.controls.handoff.dataset.state, 'paused');
  assert.equal(d.timers.size, 0);
  d.advanceBy(60000);
  d.assertScene(0, 1);
  d.hidden(true);
  d.visible(true);
  assert.equal(d.timers.size, 0, 'a visible section cannot animate in a hidden page');
  d.hidden(false);
  assert.equal(d.nextDelay(), readingDelay - 1000, 'returning resumes the remaining delay');
  d.advanceBy(500);
  d.hidden(true);
  assert.equal(d.timers.size, 0);
  d.advanceBy(60000);
  d.assertScene(0, 1);
  d.hidden(false);
  assert.equal(d.nextDelay(), readingDelay - 1500);
  d.nextTick();
  d.assertScene(0, 2);
  d.cleanup();
}

{
  const d = demo();
  d.visible(true);
  d.nextTick();
  d.click('demo-toggle');
  assert.equal(d.controls['demo-action-text'].textContent, 'Play');
  assert.equal(d.controls['demo-toggle'].getAttribute('aria-label'), 'Play examples');
  assert.equal(d.controls.handoff.dataset.state, 'paused');
  assert.equal(d.timers.size, 0);
  d.visible(false); d.hidden(true); d.visible(true); d.hidden(false);
  d.advanceBy(60000);
  d.assertScene(0, 1);
  assert.equal(d.timers.size, 0, 'visibility changes never undo a deliberate pause');
  d.click('demo-toggle');
  assert.equal(d.controls['demo-action-text'].textContent, 'Pause');
  d.nextTick();
  d.assertScene(0, 2);
  d.cleanup();
}

{
  const d = demo();
  d.visible(true);
  d.click('demo-previous');
  d.assertScene(2, 1);
  assert.equal(d.timers.size, 0);
  assert.equal(d.controls['demo-action-text'].textContent, 'Play');
  assert.match(d.controls['demo-status'].textContent, /Example 3 of 3/);
  d.click('demo-next');
  d.assertScene(0, 2);
  d.click('demo-next');
  d.assertScene(1, 3);
  d.advanceBy(60000);
  d.assertScene(1, 3);
  assert.equal(d.timers.size, 0, 'manual navigation leaves a complete example paused');
  d.cleanup();
}

{
  const d = demo({ reducedMotion: true });
  d.assertScene(0, 2);
  assert.equal(d.controls['demo-toggle'].hidden, true);
  assert.equal(d.controls['demo-previous'].hidden, false);
  assert.equal(d.controls['demo-next'].hidden, false);
  d.visible(true);
  d.advanceBy(60000);
  assert.equal(d.timers.size, 0, 'reduced motion displays complete examples without a timer');
  d.click('demo-next');
  d.assertScene(1, 3);
  d.click('demo-previous');
  d.assertScene(0, 2);
  d.cleanup();

  const changed = demo();
  changed.visible(true);
  changed.nextTick();
  changed.reduced(true);
  changed.assertScene(0, 2);
  assert.equal(changed.timers.size, 0, 'enabling reduced motion stops active playback');
  assert.equal(changed.controls['demo-toggle'].hidden, true);
  changed.cleanup();
}

// Back/forward cache restores a partially read example, a manual pause, and a
// single set of listeners. A post-restore next click must move exactly one scene.
{
  const d = demo();
  d.visible(true);
  d.nextTick(); d.nextTick(); d.nextTick(); d.nextTick();
  d.assertScene(1, 1);
  const delay = d.nextDelay();
  d.advanceBy(700);
  d.page('pagehide');
  assert.equal(d.timers.size, 0, 'pagehide clears playback timers');
  assert.equal(d.observers.filter(observer => observer.targets.size).length, 0, 'pagehide disconnects observers');
  d.click('demo-next');
  d.assertScene(1, 1);
  d.advanceBy(60000);
  d.page('pageshow');
  d.assertScene(1, 1);
  d.visible(true);
  assert.equal(d.nextDelay(), delay - 700, 'bfcache retains the remaining reading time');
  d.page('pageshow');
  assert.equal(d.observers.filter(observer => observer.targets.size).length, 1);
  assert.equal(d.timers.size, 1, 'repeated pageshow never duplicates the timer');
  d.click('demo-next');
  d.assertScene(2, 1);
  assert.equal(d.timers.size, 0);
  d.page('pagehide');
  d.page('pageshow');
  d.visible(true);
  d.assertScene(2, 1);
  assert.equal(d.controls['demo-action-text'].textContent, 'Play');
  assert.equal(d.timers.size, 0, 'bfcache retains a deliberate pause');
  d.click('demo-next');
  d.assertScene(0, 2);
  d.click('demo-toggle');
  assert.equal(d.timers.size, 1, 'restored control has exactly one click listener');
  d.page('pagehide');
  assert.equal(d.timers.size, 0);
}

{
  const d = demo({ intersectionObserver: false });
  assert.equal(d.timers.size, 1, 'older browsers without IntersectionObserver still play');
  d.nextTick();
  d.assertScene(0, 1);
  d.cleanup();
}

console.log('Demo runtime: visible autostart, message sequence and looping, pause/resume, manual navigation, reduced motion, accessibility, and bfcache restore passed.');

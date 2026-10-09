import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the actual control code, including browser clipboard rejection and
// back/forward cache lifecycle, without replacing the clipboard implementation.
const source = (await readFile(new URL('./src/demo.js', import.meta.url), 'utf8')).replaceAll('export function ', 'function ');
class Control extends EventTarget {
  constructor(properties = {}) { super(); Object.assign(this, { value: '', hidden: false, disabled: false, textContent: '' }, properties); }
  focus() { this.focused = true; }
  select() { this.selected = true; }
  setSelectionRange(start, end) { this.selection = [start, end]; }
}
const controls = {
  '#copy-starter': new Control(), '#copy-label': new Control(), '#copy-status': new Control(),
  '#starter-fallback': new Control({ hidden: true }),
  '#starter-text': new Control({ value: 'Explain Hitchhike to me.', defaultValue: 'Explain Hitchhike to me.' }),
};
const explain = new Control({ value: 'explain', checked: true });
const setup = new Control({ value: 'setup', checked: false });
const browser = new EventTarget();
const timers = new Map();
let timerId = 0;
browser.setTimeout = (callback) => { timers.set(++timerId, callback); return timerId; };
browser.clearTimeout = (id) => timers.delete(id);
let copied;
const navigator = { clipboard: { writeText: async (text) => { copied = text; } } };
const ctx = vm.createContext({ window: browser, document: {
  querySelector: (selector) => controls[selector],
  querySelectorAll: () => [explain, setup],
}, navigator, AbortController });
vm.runInContext(source, ctx);
vm.runInContext('initStarterPrompt()', ctx);
const select = (control) => {
  explain.checked = control === explain; setup.checked = control === setup;
  control.dispatchEvent(new Event('change'));
};
const click = async () => {
  controls['#copy-starter'].dispatchEvent(new Event('click', { cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
};
const text = controls['#starter-text'];
text.value = 'Explain this for my Dot and Grok Bot.';
select(setup);
assert.match(text.value, /verify one real exchange/);
text.value = 'Help me connect Claude on my phone.';
select(explain);
assert.equal(text.value, 'Explain this for my Dot and Grok Bot.', 'switching preserves explanation edits');
select(setup);
assert.equal(text.value, 'Help me connect Claude on my phone.', 'switching preserves setup edits');
await click();
assert.equal(copied, text.value, 'copies edited text, not the template');
assert.equal(controls['#copy-label'].textContent, 'Copied');
assert.equal(controls['#copy-starter'].disabled, false);
navigator.clipboard.writeText = async () => { throw new Error('NotAllowedError'); };
await click();
assert.equal(controls['#starter-fallback'].hidden, false);
assert.equal(text.focused, true);
assert.equal(text.selected, true);
assert.deepEqual(text.selection, [0, text.value.length]);
assert.equal(controls['#copy-starter'].disabled, false, 'clipboard denial never strands the button');
navigator.clipboard = undefined;
await click();
assert.equal(controls['#starter-fallback'].hidden, false);
text.value = '  ';
await click();
assert.match(controls['#copy-status'].textContent, /Add some text/);
text.value = 'Keep my draft when I come back.';
browser.dispatchEvent(new Event('pagehide'));
assert.equal(timers.size, 0, 'page exit clears timers');
browser.dispatchEvent(new Event('pageshow'));
select(explain); select(setup);
assert.equal(text.value, 'Keep my draft when I come back.');
console.log('Prompt controls: edited text, choice drafts, clipboard denial/missing API, empty input, and bfcache restore passed.');

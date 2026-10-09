const SETUP_PROMPT = 'Help me connect my assistants through Hitchhike. Read https://hitchhike.dev/docs.md and use the setup guide at https://hitchhike.dev/docs/connect. Check which assistants and devices I use, reuse existing connections where possible, and guide me through the steps that need me. Then help me verify one real exchange. Explain any account, permission, or background limitation we encounter.';
const promptDrafts = new Map();

let handoffCleanup;
let handoffSnapshot;
let starterCleanup;
let handoffRequested = false;
let starterRequested = false;
let lifecycleInstalled = false;

function installLifecycle() {
  if (lifecycleInstalled) return;
  lifecycleInstalled = true;

  window.addEventListener('pagehide', () => {
    handoffCleanup?.();
    starterCleanup?.();
  });

  // Restore controls when the browser brings this page back from its cache.
  window.addEventListener('pageshow', () => {
    if (handoffRequested) initHandoffDemo();
    if (starterRequested) initStarterPrompt();
  });
}

export function initHandoffDemo() {
  if (handoffCleanup) return handoffCleanup;

  const section = document.querySelector('#handoff');
  const title = document.querySelector('#demo-title');
  const toggle = document.querySelector('#demo-toggle');
  const actionText = document.querySelector('#demo-action-text');
  const controlIcon = document.querySelector('#demo-control-icon');
  const previous = document.querySelector('#demo-previous');
  const next = document.querySelector('#demo-next');
  const counter = document.querySelector('#demo-counter');
  const status = document.querySelector('#demo-status');
  const scenes = [...document.querySelectorAll('[data-demo-scene]')].map(element => ({
    element,
    title: element.dataset.title,
    messages: [...element.querySelectorAll('[data-message]')],
  }));
  if (!section || !title || !toggle || !actionText || !controlIcon || !previous || !next ||
      !counter || !status || !scenes.length || scenes.some(scene => !scene.messages.length)) return;

  handoffRequested = true;
  installLifecycle();
  const controller = new AbortController();
  const listenerOptions = { signal: controller.signal };
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let current = 0;
  let revealed = 0;
  let manualPause = false;
  // Wait for visibility evidence before starting a loop below the fold.
  let inView = !('IntersectionObserver' in window);
  let timer;
  let deadline = 0;
  let remaining = 3200;
  let observer;

  const canPlay = () => !manualPause && !motion.matches && !document.hidden && inView && !controller.signal.aborted;
  function stopTimer() {
    if (timer !== undefined) {
      remaining = Math.max(0, deadline - performance.now());
      window.clearTimeout(timer);
      timer = undefined;
    }
  }

  function render() {
    title.textContent = scenes[current].title;
    counter.textContent = `${current + 1} / ${scenes.length}`;
    section.dataset.state = canPlay() ? 'playing' : 'paused';
    const label = manualPause ? 'Play' : 'Pause';
    actionText.textContent = label;
    controlIcon.setAttribute('href', manualPause ? '#play' : '#pause');
    toggle.setAttribute('aria-label', `${label} examples`);
    toggle.hidden = motion.matches;
    scenes.forEach((scene, index) => {
      const selected = index === current;
      scene.element.hidden = false;
      scene.element.inert = !selected;
      scene.element.setAttribute('aria-hidden', String(!selected));
      scene.messages.forEach((message, i) => {
        message.setAttribute('aria-hidden', String(!selected || i >= revealed));
        if (selected && i === revealed && canPlay()) message.dataset.waiting = `${message.dataset.speaker} is responding…`;
        else delete message.dataset.waiting;
      });
    });
  }

  function readingTime(message) {
    const words = message.textContent.trim().split(/\s+/).length;
    return Math.min(7000, Math.max(3200, words * 180));
  }

  function schedule() {
    render();
    if (!canPlay() || timer !== undefined) return;
    deadline = performance.now() + remaining;
    timer = window.setTimeout(advance, remaining);
  }

  function begin(index) {
    current = (index + scenes.length) % scenes.length;
    revealed = motion.matches ? scenes[current].messages.length : 0;
    remaining = 3200;
    scenes.forEach(scene => scene.messages.forEach(message => message.classList.remove('is-arriving')));
    render();
    schedule();
  }

  function advance() {
    timer = undefined;
    if (!canPlay()) return;
    const scene = scenes[current];
    if (revealed === scene.messages.length) {
      begin(current + 1);
      return;
    }
    const message = scene.messages[revealed++];
    message.classList.add('is-arriving');
    // Leave the result on screen before moving to another story.
    remaining = revealed === scene.messages.length ? 8500 : readingTime(message);
    schedule();
  }

  function readExample(offset) {
    stopTimer();
    manualPause = true;
    current = (current + offset + scenes.length) % scenes.length;
    revealed = scenes[current].messages.length;
    remaining = 8500;
    scenes.forEach(scene => scene.messages.forEach(message => message.classList.remove('is-arriving')));
    render();
    status.textContent = `Example ${current + 1} of ${scenes.length}: ${scenes[current].title}`;
  }

  toggle.addEventListener('click', () => {
    stopTimer();
    manualPause = !manualPause;
    status.textContent = manualPause ? 'Examples paused' : 'Examples playing';
    schedule();
  }, listenerOptions);
  previous.addEventListener('click', () => readExample(-1), listenerOptions);
  next.addEventListener('click', () => readExample(1), listenerOptions);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopTimer();
    schedule();
  }, listenerOptions);
  motion.addEventListener('change', () => {
    stopTimer();
    if (motion.matches) revealed = scenes[current].messages.length;
    remaining = 8500;
    schedule();
  }, listenerOptions);
  scenes.forEach(scene => scene.messages.forEach(message => {
    message.addEventListener('animationend', () => message.classList.remove('is-arriving'), listenerOptions);
  }));

  if ('IntersectionObserver' in window) {
    observer = new window.IntersectionObserver(entries => {
      const entry = entries.find(item => item.target === section);
      if (!entry) return;
      inView = entry.isIntersecting;
      if (!inView) stopTimer();
      schedule();
    }, { threshold: 0 });
    observer.observe(section);
  }
  previous.hidden = false;
  next.hidden = false;
  counter.hidden = false;
  if (handoffSnapshot) {
    ({ current, revealed, manualPause, remaining } = handoffSnapshot);
    if (motion.matches) revealed = scenes[current].messages.length;
    schedule();
  } else {
    begin(0);
  }
  handoffCleanup = () => {
    stopTimer();
    handoffSnapshot = { current, revealed, manualPause, remaining };
    scenes.forEach(scene => scene.messages.forEach(message => message.classList.remove('is-arriving')));
    observer?.disconnect();
    controller.abort();
    handoffCleanup = undefined;
  };
  return handoffCleanup;
}

export function initStarterPrompt() {
  if (starterCleanup) return starterCleanup;

  const button = document.querySelector('#copy-starter');
  const label = document.querySelector('#copy-label');
  const status = document.querySelector('#copy-status');
  const fallback = document.querySelector('#starter-fallback');
  const textarea = document.querySelector('#starter-text');
  const choices = [...document.querySelectorAll('input[name="starter-kind"]')];
  if (!button || !label || !status || !fallback || !textarea || !choices.length) return;

  starterRequested = true;
  installLifecycle();
  const controller = new AbortController();
  let resetTimer;
  let copying = false;
  let currentKind = choices.find((choice) => choice.checked)?.value || 'explain';
  if (!promptDrafts.size) {
    promptDrafts.set('explain', textarea.defaultValue);
    promptDrafts.set('setup', SETUP_PROMPT);
  }

  function resetLabel() {
    window.clearTimeout(resetTimer);
    label.textContent = 'Copy prompt';
  }

  function switchPrompt(event) {
    if (!event.target.checked) return;
    promptDrafts.set(currentKind, textarea.value);
    currentKind = event.target.value;
    textarea.value = promptDrafts.get(currentKind);
    resetLabel();
    fallback.hidden = true;
    status.textContent = currentKind === 'setup' ? 'Setup prompt selected. You can edit it below.' : 'Explanation prompt selected. You can edit it below.';
  }

  async function copy(event) {
    event.preventDefault();
    if (copying) return;
    if (!textarea.value.trim()) {
      status.textContent = 'Add some text to the prompt before copying.';
      textarea.focus();
      return;
    }
    copying = true;
    button.disabled = true;
    resetLabel();
    status.textContent = '';
    const copiedText = textarea.value;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(copiedText);
      if (controller.signal.aborted) return;
      label.textContent = 'Copied';
      status.textContent = 'Prompt copied. Paste it into your usual assistant.';
      fallback.hidden = true;
      resetTimer = window.setTimeout(resetLabel, 2600);
    } catch {
      if (!controller.signal.aborted) {
        fallback.hidden = false;
        status.textContent = 'Copy the selected text manually.';
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
      }
    } finally {
      if (!controller.signal.aborted) {
        copying = false;
        button.disabled = false;
      }
    }
  }

  button.addEventListener('click', copy, { signal: controller.signal });
  choices.forEach((choice) => choice.addEventListener('change', switchPrompt, { signal: controller.signal }));
  starterCleanup = () => {
    promptDrafts.set(currentKind, textarea.value);
    controller.abort();
    resetLabel();
    button.disabled = false;
    starterCleanup = undefined;
  };
  return starterCleanup;
}

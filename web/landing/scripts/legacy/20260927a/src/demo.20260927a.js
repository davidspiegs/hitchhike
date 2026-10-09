const STARTER_PROMPT =
  'Use Hitchhike to list my available agents. Show me their names and availability so I can choose one for a small task.';

let handoffCleanup;
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
  const steps = [...document.querySelectorAll('#handoff .demo-step[data-step]')];
  const result = document.querySelector('#demo-result');
  const draftPreview = document.querySelector('#draft-preview');
  const prospects = [...document.querySelectorAll('#handoff [data-prospect]')];
  const status = document.querySelector('#demo-status');
  const actionText = document.querySelector('#demo-action-text');
  const buttons = [...document.querySelectorAll('[data-run-demo]')];

  if (!section || !steps.length || !result || !status || !buttons.length) return;

  handoffRequested = true;
  installLifecycle();
  const controller = new AbortController();
  const timers = new Set();
  const stages = ['context', 'research', 'enrich', 'draft', 'complete'];
  const stageMessages = {
    context: 'ChatGPT is sharing the brief',
    research: 'Finding companies that fit',
    enrich: 'Checking contact details',
    draft: 'Preparing the outreach drafts',
    complete: 'The research and drafts are ready to review',
  };
  let running = false;

  function setDisabled(disabled) {
    buttons.forEach((button) => {
      button.disabled = disabled;
    });
  }

  function setStage(stage) {
    if (controller.signal.aborted) return;
    section.dataset.state = stage;
    const currentIndex = stages.indexOf(stage);

    steps.forEach((step) => {
      const stepIndex = stages.indexOf(step.dataset.step);
      const active = stepIndex === currentIndex;
      const complete = stepIndex < currentIndex;
      step.classList.toggle('is-pending', !active && !complete);
      step.classList.toggle('is-active', active);
      step.classList.toggle('is-complete', complete);
      if (active) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
      const state = step.querySelector('.step-state');
      if (state) state.textContent = complete ? 'Done' : active ? 'Working' : 'Waiting';
    });

    prospects.forEach((row) => {
      const contact = row.querySelector('[data-contact]');
      const draftStatus = row.querySelector('[data-draft-status]');
      const finalContact = contact?.dataset.finalContact ?? row.dataset.finalContact ?? 'Needs checking';
      row.classList.toggle('is-pending', currentIndex < 1);
      if (contact) contact.textContent = currentIndex >= 2 ? finalContact : 'Pending';
      if (draftStatus) {
        draftStatus.textContent = currentIndex >= 3
          ? finalContact === 'Found' ? 'Ready' : 'Needs contact'
          : 'Pending';
      }
    });

    const complete = stage === 'complete';
    if (draftPreview) {
      const draftPending = currentIndex < 3;
      draftPreview.classList.toggle('is-pending', draftPending);
      draftPreview.setAttribute('aria-hidden', String(draftPending));
    }
    result.classList.toggle('is-pending', !complete);
    result.setAttribute('aria-hidden', String(!complete));
    status.textContent = stageMessages[stage];
    if (complete) {
      if (actionText) actionText.textContent = 'Replay';
      running = false;
      setDisabled(false);
    }
  }

  function schedule(stage, delay) {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      setStage(stage);
    }, delay);
    timers.add(timer);
  }

  function run(event) {
    event.preventDefault();
    if (running) return;
    running = true;
    setDisabled(true);

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const bounds = section.getBoundingClientRect();
    if (bounds.top < 0 || bounds.bottom > window.innerHeight) {
      section.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' });
    }

    setStage('context');
    if (reducedMotion) {
      setStage('complete');
      return;
    }
    schedule('research', 1400);
    schedule('enrich', 2800);
    schedule('draft', 4400);
    schedule('complete', 6000);
  }

  setStage('complete');
  status.textContent = 'Example complete';

  buttons.forEach((button) => {
    button.addEventListener('click', run, { signal: controller.signal });
  });

  handoffCleanup = () => {
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.clear();
    // Leave a stable, readable result if navigation interrupts the animation.
    if (running) setStage('complete');
    controller.abort();
    setDisabled(false);
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
  if (!button || !label || !status || !fallback || !textarea) return;

  starterRequested = true;
  installLifecycle();
  const controller = new AbortController();
  let resetTimer;
  let copying = false;
  textarea.value = STARTER_PROMPT;
  textarea.readOnly = true;

  function resetLabel() {
    window.clearTimeout(resetTimer);
    label.textContent = 'Copy starter prompt';
  }

  function showFallback() {
    resetLabel();
    fallback.hidden = false;
    fallback.open = true;
    status.textContent = 'Select and copy the starter prompt below.';
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
  }

  async function copy(event) {
    event.preventDefault();
    if (copying) return;
    copying = true;
    button.disabled = true;
    resetLabel();
    status.textContent = '';

    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(STARTER_PROMPT);
      if (controller.signal.aborted) return;
      label.textContent = 'Copied';
      status.textContent = 'Starter prompt copied to clipboard.';
      fallback.open = false;
      fallback.hidden = true;
      resetTimer = window.setTimeout(resetLabel, 2600);
    } catch {
      if (!controller.signal.aborted) showFallback();
    } finally {
      if (!controller.signal.aborted) {
        copying = false;
        button.disabled = false;
      }
    }
  }

  button.addEventListener('click', copy, { signal: controller.signal });
  starterCleanup = () => {
    controller.abort();
    resetLabel();
    button.disabled = false;
    starterCleanup = undefined;
  };
  return starterCleanup;
}

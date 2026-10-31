// Scroll reveals, word-split headings and the active statement in the "why" list.
// Every hidden-before-reveal style lives under html.motion, so this module adds that
// class only when it can also promise to reveal things again.

const REVEAL_RATIO = 0.15;
const ACTIVE_BAND = '-45% 0px -45% 0px';
// Words break on collapsible HTML whitespace only; no-break spaces keep their words glued.
const SPACES = /([\t\n\f\r ]+)/;
const NO_SPLIT = 'script, style, svg, textarea, .w';

initMotion();

function initMotion() {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  if (reduce?.matches || typeof IntersectionObserver !== 'function') return;

  const root = document.documentElement;
  for (const element of document.querySelectorAll('[data-split]')) splitWords(element);

  // Measure before any class changes: if the hidden state were styled first, on-screen
  // elements would transition in from hidden once `is-in` lands.
  const targets = [...document.querySelectorAll('[data-reveal], [data-split]')];
  const onScreen = targets.map(isOnScreen);
  const pending = targets.filter((target, index) => {
    if (!onScreen[index]) return true;
    target.classList.add('is-in');
    return false;
  });
  root.classList.add('motion');

  const revealObserver = observeReveals(pending);
  const activeObserver = observeActiveGroups();

  if (!reduce) return;
  const onReduceChange = () => {
    if (!reduce.matches) return;
    root.classList.remove('motion');
    revealObserver?.disconnect();
    activeObserver?.disconnect();
  };
  if (reduce.addEventListener) reduce.addEventListener('change', onReduceChange);
  else reduce.addListener?.(onReduceChange);
}

function splitWords(element) {
  if (element.hasAttribute('data-split-done')) return;
  element.setAttribute('data-split-done', '');

  const textNodes = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const skip = node.parentElement?.closest(NO_SPLIT);
    if (skip && element.contains(skip)) continue;
    if (/[^\t\n\f\r ]/.test(node.data)) textNodes.push(node);
  }

  let index = 0;
  for (const node of textNodes) {
    const fragment = document.createDocumentFragment();
    // The capture group puts whitespace runs at odd indexes; words sit between them.
    node.data.split(SPACES).forEach((part, partIndex) => {
      if (!part) return;
      if (partIndex % 2) {
        fragment.append(part);
        return;
      }
      const word = document.createElement('span');
      word.className = 'w';
      const inner = document.createElement('span');
      inner.className = 'wi';
      inner.style.setProperty('--i', String(index++));
      inner.textContent = part;
      word.append(inner);
      fragment.append(word);
    });
    node.replaceWith(fragment);
  }
}

function isOnScreen(element) {
  const rect = element.getBoundingClientRect();
  const height = window.innerHeight || document.documentElement.clientHeight;
  const width = window.innerWidth || document.documentElement.clientWidth;
  return rect.width > 0 && rect.height > 0
    && rect.bottom > 0 && rect.right > 0 && rect.top < height && rect.left < width;
}

function observeReveals(targets) {
  if (!targets.length) return null;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const rootHeight = entry.rootBounds?.height || window.innerHeight;
      // Elements too tall to ever show 15% of themselves reveal as soon as they enter.
      const tooTall = entry.boundingClientRect.height * REVEAL_RATIO > rootHeight;
      if (entry.intersectionRatio < REVEAL_RATIO - 0.001 && !tooTall) continue;
      entry.target.classList.add('is-in');
      observer.unobserve(entry.target);
    }
  }, { threshold: [0, REVEAL_RATIO] });
  for (const target of targets) observer.observe(target);
  return observer;
}

function observeActiveGroups() {
  const groupOf = new Map();
  for (const group of document.querySelectorAll('[data-active-group]')) {
    const items = [...group.querySelectorAll('[data-active-item]')]
      .filter((item) => item.closest('[data-active-group]') === group);
    if (!items.length) continue;
    setActive(items, items[0]);
    for (const item of items) groupOf.set(item, items);
  }
  if (!groupOf.size) return null;

  const inBand = new Set();
  const observer = new IntersectionObserver((entries) => {
    const entered = new Map();
    for (const entry of entries) {
      if (entry.isIntersecting) {
        inBand.add(entry.target);
        entered.set(groupOf.get(entry.target), entry.target);
      } else {
        inBand.delete(entry.target);
      }
    }
    for (const items of new Set(entries.map((entry) => groupOf.get(entry.target)))) {
      const current = items.find((item) => item.hasAttribute('data-active'));
      // Prefer the item that just reached the band; otherwise hand over only when the
      // active item has left while another is still inside. A gap keeps the last one lit.
      const next = entered.get(items)
        ?? (inBand.has(current) ? current : items.find((item) => inBand.has(item)));
      if (next && next !== current) setActive(items, next);
    }
  }, { rootMargin: ACTIVE_BAND });
  for (const item of groupOf.keys()) observer.observe(item);
  return observer;
}

function setActive(items, active) {
  for (const item of items) item.toggleAttribute('data-active', item === active);
}

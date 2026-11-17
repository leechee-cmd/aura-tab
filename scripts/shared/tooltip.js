/**
 * The tooltip layer behind every `[data-tooltip]` element.
 *
 * It lives on `document.body` and is positioned `fixed`, for the same reason the select
 * menu does: hosts clip their own overflow. The settings cards are `overflow: hidden` so
 * their rounded corners clip the rows, which also means a tooltip drawn as a `::after` on
 * a pill gets cut off the moment it needs a third line.
 *
 * One layer, delegated listeners: the settings window throws its whole content subtree away
 * on every section change, so per-element listeners would leak with every visit.
 *
 * The text is also exposed to assistive tech by the host (an `aria-describedby` node), not
 * by this layer — the layer is marked `aria-hidden` so nothing is announced twice.
 */

const SHOW_DELAY_MS = 140;
const GAP = 8;
const EDGE = 8;

let layer = null;
let anchor = null;
let showTimer = 0;
let initialized = false;

function ensureLayer() {
    if (layer?.isConnected) return layer;

    layer = document.createElement('div');
    layer.className = 'tooltip-layer';
    layer.setAttribute('role', 'tooltip');
    layer.setAttribute('aria-hidden', 'true');
    layer.hidden = true;
    document.body.appendChild(layer);
    return layer;
}

function place(target) {
    const el = ensureLayer();
    const rect = target.getBoundingClientRect();

    // Measure at the anchor's width budget, then position.
    el.style.left = '0px';
    el.style.top = '0px';
    const box = el.getBoundingClientRect();

    // Centred on the anchor, except for anchors living in the right-hand part of the window:
    // there the tooltip would spill past the window it belongs to, so it hangs from the
    // anchor's right edge instead and grows leftwards.
    const preferRightEdge = rect.left > window.innerWidth * 0.6;
    let left = preferRightEdge
        ? rect.right - box.width
        : rect.left + rect.width / 2 - box.width / 2;
    left = Math.max(EDGE, Math.min(left, window.innerWidth - box.width - EDGE));

    let top = rect.top - box.height - GAP;
    if (top < EDGE) top = rect.bottom + GAP;
    if (top + box.height > window.innerHeight - EDGE) {
        top = Math.max(EDGE, window.innerHeight - box.height - EDGE);
    }

    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
}

function show(target) {
    const text = target?.dataset?.tooltip;
    if (!text) return;

    anchor = target;
    const el = ensureLayer();
    el.textContent = text;
    el.hidden = false;
    requestAnimationFrame(() => {
        if (anchor !== target) return;
        place(target);
        el.classList.add('is-visible');
    });
}

function hide() {
    clearTimeout(showTimer);
    anchor = null;
    if (!layer) return;
    layer.classList.remove('is-visible');
    layer.hidden = true;
}

function scheduleShow(target) {
    clearTimeout(showTimer);
    showTimer = setTimeout(() => show(target), SHOW_DELAY_MS);
}

function onPointerOver(event) {
    const target = event.target?.closest?.('[data-tooltip]');
    // Moving between two pills must not keep the previous hint on screen.
    if (!target) {
        if (anchor) hide();
        return;
    }
    if (target === anchor) return;
    scheduleShow(target);
}

function onPointerOut(event) {
    if (!anchor) return;
    const to = event.relatedTarget;
    if (to && anchor.contains(to)) return;
    hide();
}

function onFocusIn(event) {
    const target = event.target?.closest?.('[data-tooltip]');
    if (target) scheduleShow(target);
}

function onFocusOut() {
    hide();
}

function onKeyDown(event) {
    if (event.key === 'Escape') hide();
}

/**
 * Attach the delegated listeners once. Safe to call on every render.
 */
export function initTooltips() {
    if (initialized) return;
    initialized = true;

    document.addEventListener('pointerover', onPointerOver, true);
    document.addEventListener('pointerout', onPointerOut, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('keydown', onKeyDown, true);
    // A fixed layer does not follow its anchor when the page scrolls.
    document.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
}

/** Remove the layer and every listener. Only for tests. */
export function destroyTooltips() {
    hide();
    clearTimeout(showTimer);
    layer?.remove();
    layer = null;
    initialized = false;
    document.removeEventListener('pointerover', onPointerOver, true);
    document.removeEventListener('pointerout', onPointerOut, true);
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('focusout', onFocusOut, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('scroll', hide, true);
    window.removeEventListener('resize', hide);
}

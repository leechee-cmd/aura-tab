/**
 * Shared UI widgets: the modal layer, the macOS-style window base built on it, the confirm
 * dialog, the tooltip layer, the toast glyphs and the offscreen favicon parser.
 *
 * All six are small, DOM-only primitives that share the modal-layer singleton and the
 * setup.js chrome mock, so they are tested in one file instead of six (each of which used
 * to pay a full jsdom environment).
 *
 * `vi.mock('../platform/i18n.js')` below is in effect for the whole file: none of the other
 * five modules imports i18n, so it only shapes the confirmation dialog's strings.
 *
 * Sources merged here (git history of the individual files is gone, this list is the
 * replacement for `git log --follow`):
 *   tests/platform/modal-layer.test.js
 *   tests/platform/mac-window-base.test.js
 *   tests/shared/confirm-dialog.test.js
 *   tests/shared/tooltip.test.js
 *   tests/shared/toast-icons.test.js
 *   tests/shared/favicon-offscreen.test.js
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setStorageData } from '../setup.js';
import { MacWindowBase } from '../../scripts/platform/mac-window-base.js';
import { modalLayer } from '../../scripts/platform/modal-layer.js';
import { parseManifest, parsePage } from '../../scripts/platform/favicon-offscreen.js';
import { confirmDialog } from '../../scripts/shared/confirm-dialog.js';
import { destroyTooltips, initTooltips } from '../../scripts/shared/tooltip.js';
import { TOAST_ICONS } from '../../scripts/shared/toast.js';

vi.mock('../../scripts/platform/i18n.js', () => ({
    t: (key) =>
        ({
            cancel: 'Cancel',
            confirm: 'Confirm'
        })[key] || key
}));

// ===== from tests/platform/modal-layer.test.js =====
function mousedown(target) {
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
}

function clickOutside() {
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
}

describe('ModalLayer', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        modalLayer.destroy();
    });

    afterEach(() => {
        modalLayer.destroy();
    });

    it('does not dismiss when dismissOnOutsideClick=false', () => {
        const el = document.createElement('div');
        document.body.appendChild(el);

        const onDismiss = vi.fn();
        modalLayer.register('a', modalLayer.constructor.LEVEL.OVERLAY, el, onDismiss, {
            dismissOnOutsideClick: false
        });

        clickOutside();
        expect(onDismiss).not.toHaveBeenCalled();
    });

    it('dismisses dismissible top modals but keeps non-dismissible top modals', () => {
        const keepEl = document.createElement('div');
        const closeEl = document.createElement('div');
        document.body.appendChild(keepEl);
        document.body.appendChild(closeEl);

        const keepDismiss = vi.fn();
        const closeDismiss = vi.fn();

        modalLayer.register('b', modalLayer.constructor.LEVEL.OVERLAY, keepEl, keepDismiss, {
            dismissOnOutsideClick: false
        });
        modalLayer.register('c', modalLayer.constructor.LEVEL.OVERLAY, closeEl, closeDismiss, {
            dismissOnOutsideClick: true
        });

        clickOutside();
        expect(closeDismiss).toHaveBeenCalledTimes(1);
        expect(keepDismiss).not.toHaveBeenCalled();
    });

    it('keeps DIALOG visually above OVERLAY', () => {
        const overlay = document.createElement('div');
        const dialogOverlay = document.createElement('div');
        document.body.appendChild(overlay);
        document.body.appendChild(dialogOverlay);

        modalLayer.register('o', modalLayer.constructor.LEVEL.OVERLAY, overlay, () => {});
        modalLayer.bringToFront('o');

        modalLayer.register('d', modalLayer.constructor.LEVEL.DIALOG, dialogOverlay, () => {});
        modalLayer.bringToFront('d');

        const zOverlay = Number(overlay.style.zIndex || 0);
        const zDialog = Number(dialogOverlay.style.zIndex || 0);

        expect(zOverlay).toBeGreaterThanOrEqual(400);
        expect(zOverlay).toBeLessThan(500);
        expect(zDialog).toBeGreaterThanOrEqual(500);
        expect(zDialog).toBeGreaterThan(zOverlay);
    });

    it('supports separate hitTestElement and zIndexElement', () => {
        const dialogOverlay = document.createElement('div');
        const dialogCard = document.createElement('div');
        dialogOverlay.appendChild(dialogCard);
        document.body.appendChild(dialogOverlay);

        const onDismiss = vi.fn();
        modalLayer.register(
            'd',
            modalLayer.constructor.LEVEL.DIALOG,
            dialogOverlay,
            onDismiss,
            { hitTestElement: dialogCard, zIndexElement: dialogOverlay }
        );

        mousedown(dialogOverlay);
        expect(onDismiss).toHaveBeenCalledTimes(1);

        modalLayer.unregister('d');
        onDismiss.mockClear();

        modalLayer.register(
            'd',
            modalLayer.constructor.LEVEL.DIALOG,
            dialogOverlay,
            onDismiss,
            { hitTestElement: dialogCard, zIndexElement: dialogOverlay }
        );
        mousedown(dialogCard);
        expect(onDismiss).toHaveBeenCalledTimes(0);
    });

    it('lets Launchpad overlay cover existing windows while keeping background-click close', () => {
        const settingsOverlay = document.createElement('div');
        document.body.appendChild(settingsOverlay);

        const launchpadOverlay = document.createElement('div');
        const launchpadContainer = document.createElement('div');
        launchpadOverlay.appendChild(launchpadContainer);
        document.body.appendChild(launchpadOverlay);

        modalLayer.register('settings', modalLayer.constructor.LEVEL.OVERLAY, settingsOverlay, () => {});
        modalLayer.bringToFront('settings');

        const onLaunchpadDismiss = vi.fn();
        modalLayer.register(
            'launchpad',
            modalLayer.constructor.LEVEL.OVERLAY,
            launchpadOverlay,
            onLaunchpadDismiss,
            { hitTestElement: launchpadContainer, zIndexElement: launchpadOverlay }
        );
        modalLayer.bringToFront('launchpad');

        const zSettings = Number(settingsOverlay.style.zIndex || 0);
        const zLaunchpad = Number(launchpadOverlay.style.zIndex || 0);
        expect(zLaunchpad).toBeGreaterThan(zSettings);

        mousedown(launchpadOverlay);
        expect(onLaunchpadDismiss).toHaveBeenCalledTimes(1);
    });

    it('ignores toast clicks so active modals do not dismiss', () => {
        const overlay = document.createElement('div');
        document.body.appendChild(overlay);

        const toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container';
        const toast = document.createElement('button');
        toast.className = 'toast';
        toastContainer.appendChild(toast);
        document.body.appendChild(toastContainer);

        const onDismiss = vi.fn();
        modalLayer.register('overlay', modalLayer.constructor.LEVEL.OVERLAY, overlay, onDismiss);

        mousedown(toast);

        expect(onDismiss).not.toHaveBeenCalled();
    });

    it('keeps OVERLAY z-index within its band after many bringToFront calls', () => {
        const overlay = document.createElement('div');
        document.body.appendChild(overlay);
        modalLayer.register('o', modalLayer.constructor.LEVEL.OVERLAY, overlay, () => {});

        for (let i = 0; i < 250; i++) {
            modalLayer.bringToFront('o');
            const z = Number(overlay.style.zIndex || 0);
            expect(z).toBeGreaterThanOrEqual(400);
            expect(z).toBeLessThan(500);
        }
    });
});

// ===== from tests/platform/mac-window-base.test.js =====
function dispatchMousedown(target) {
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    target.dispatchEvent(event);
}

async function flushAsync() {
    await Promise.resolve();
    await Promise.resolve();
}

function createDeferred() {
    let resolve;
    const promise = new Promise((resolver) => {
        resolve = resolver;
    });
    return { promise, resolve };
}

function mountWindowDom({ overlayId = 'testOverlay', windowId = 'testWindow' } = {}) {
    document.body.insertAdjacentHTML('beforeend', `
        <div class="mac-window-overlay" id="${overlayId}" aria-hidden="true">
            <div class="mac-window" id="${windowId}">
                <div class="mac-titlebar"></div>
                <div class="mac-window-controls">
                    <button type="button" class="mac-window-btn mac-window-btn--close"></button>
                    <button type="button" class="mac-window-btn mac-window-btn--minimize"></button>
                    <button type="button" class="mac-window-btn mac-window-btn--expand"></button>
                </div>
            </div>
        </div>
    `);
}

function mountOpenerButton() {
    document.body.insertAdjacentHTML('beforeend', `
        <button type="button" id="opener">Open</button>
    `);
    return document.getElementById('opener');
}

function getZIndex(id) {
    return Number(document.getElementById(id)?.style.zIndex || 0);
}

class TestWindow extends MacWindowBase {
    constructor() {
        super();
        this._initializeBase();
    }

    _getModalId() {
        return 'test-window';
    }

    _getOverlayId() {
        return 'testOverlay';
    }

    _getWindowId() {
        return 'testWindow';
    }
}

class DeferredTestWindow extends MacWindowBase {
    constructor({ modalId, overlayId, windowId, readyPromise }) {
        super();
        this._modalId = modalId;
        this._overlayId = overlayId;
        this._windowId = windowId;
        this._readyPromise = readyPromise;
        this._initializeBase();
    }

    _getModalId() {
        return this._modalId;
    }

    _getOverlayId() {
        return this._overlayId;
    }

    _getWindowId() {
        return this._windowId;
    }

    async _loadBehaviorSettings() {
        await this._readyPromise;
        this._dismissOnOutsideClick = true;
    }
}

describe('mac-window-base', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        modalLayer.destroy();
    });

    afterEach(() => {
        modalLayer.destroy();
    });

    it('first open should adopt async outside-click setting and close on blank click', async () => {
        setStorageData({ macSettingsDismissOnOutsideClick: true }, 'sync');
        mountWindowDom();

        const testWindow = new TestWindow();
        testWindow.open();
        await flushAsync();

        expect(testWindow.isOpen).toBe(true);

        dispatchMousedown(document.body);
        expect(testWindow.isOpen).toBe(false);
    });

    it('overlay click should be treated as outside window hit area', async () => {
        setStorageData({ macSettingsDismissOnOutsideClick: true }, 'sync');
        mountWindowDom();

        const testWindow = new TestWindow();
        testWindow.open();
        await flushAsync();

        const overlay = document.getElementById('testOverlay');
        dispatchMousedown(overlay);
        expect(testWindow.isOpen).toBe(false);
    });

    it('late settings resolve should not steal top layer from newer open window', async () => {
        const firstReady = createDeferred();
        const secondReady = createDeferred();

        mountWindowDom({ overlayId: 'firstOverlay', windowId: 'firstWindow' });
        mountWindowDom({ overlayId: 'secondOverlay', windowId: 'secondWindow' });

        const firstWindow = new DeferredTestWindow({
            modalId: 'first-window',
            overlayId: 'firstOverlay',
            windowId: 'firstWindow',
            readyPromise: firstReady.promise
        });
        const secondWindow = new DeferredTestWindow({
            modalId: 'second-window',
            overlayId: 'secondOverlay',
            windowId: 'secondWindow',
            readyPromise: secondReady.promise
        });

        firstWindow.open();
        secondWindow.open();

        secondReady.resolve();
        await flushAsync();

        expect(getZIndex('secondOverlay')).toBeGreaterThan(getZIndex('firstOverlay'));

        firstReady.resolve();
        await flushAsync();

        expect(getZIndex('secondOverlay')).toBeGreaterThan(getZIndex('firstOverlay'));

        firstWindow.destroy();
        secondWindow.destroy();
    });

    it('restores focus before hiding the overlay from assistive tech', async () => {
        mountWindowDom();
        const opener = mountOpenerButton();
        opener.focus();

        const testWindow = new TestWindow();
        testWindow.open();

        const overlay = document.getElementById('testOverlay');
        const closeBtn = overlay.querySelector('.mac-window-btn--close');
        closeBtn.focus();

        let activeElementWhenHidden = null;
        const originalSetAttribute = overlay.setAttribute.bind(overlay);
        overlay.setAttribute = (name, value) => {
            if (name === 'aria-hidden' && value === 'true') {
                activeElementWhenHidden = document.activeElement;
            }
            return originalSetAttribute(name, value);
        };

        testWindow.close();

        expect(activeElementWhenHidden).toBe(opener);
        expect(overlay.contains(activeElementWhenHidden)).toBe(false);
    });

    it('restores opener focus even if focus already left the overlay before close', () => {
        mountWindowDom();
        const opener = mountOpenerButton();
        const outside = document.createElement('button');
        outside.type = 'button';
        outside.id = 'outside';
        document.body.appendChild(outside);
        opener.focus();

        const testWindow = new TestWindow();
        testWindow.open();

        outside.focus();
        testWindow.close();

        expect(document.activeElement).toBe(opener);
    });

    it('falls back to another safe control when opener was removed before close', () => {
        mountWindowDom();
        const opener = mountOpenerButton();
        const fallback = document.createElement('button');
        fallback.type = 'button';
        fallback.id = 'fallback';
        document.body.appendChild(fallback);
        opener.focus();

        const testWindow = new TestWindow();
        testWindow.open();

        const overlay = document.getElementById('testOverlay');
        const closeBtn = overlay.querySelector('.mac-window-btn--close');
        closeBtn.focus();
        opener.remove();

        testWindow.close();

        expect(document.activeElement).toBe(fallback);
    });
});

// ===== from tests/shared/confirm-dialog.test.js =====
describe('confirm-dialog', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        modalLayer.destroy();
        global.HTMLElement.prototype.focus = vi.fn(function focus() {
            Object.defineProperty(document, 'activeElement', {
                configurable: true,
                value: this
            });
        });
        global.requestAnimationFrame = vi.fn((callback) => {
            callback();
            return 1;
        });
    });

    class TestWindow extends MacWindowBase {
        constructor() {
            super();
            this._initializeBase();
        }

        _getModalId() {
            return 'test-window';
        }

        _getOverlayId() {
            return 'testOverlay';
        }

        _getWindowId() {
            return 'testWindow';
        }
    }

    function mountWindowDom() {
        document.body.insertAdjacentHTML('beforeend', `
            <button type="button" id="opener">Open</button>
            <div class="mac-window-overlay" id="testOverlay" aria-hidden="true">
                <div class="mac-window" id="testWindow">
                    <div class="mac-titlebar"></div>
                    <div class="mac-window-controls">
                        <button type="button" class="mac-window-btn mac-window-btn--close"></button>
                        <button type="button" class="mac-window-btn mac-window-btn--minimize"></button>
                        <button type="button" class="mac-window-btn mac-window-btn--expand"></button>
                    </div>
                </div>
            </div>
        `);
    }

    function readCssRule(selector) {
        const css = readFileSync(resolve(process.cwd(), 'styles/bundle.css'), 'utf8');
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
        return match?.[1] || '';
    }

    it('should resolve true when confirm button is clicked', async () => {
        const promise = confirmDialog('Confirm message');
        await Promise.resolve();

        const overlay = document.querySelector('.confirm-dialog-overlay');
        expect(overlay).toBeTruthy();

        overlay?.querySelector('.confirm-dialog__confirm')?.dispatchEvent(
            new MouseEvent('click', { bubbles: true })
        );

        await expect(promise).resolves.toBe(true);
    });

    it('should resolve false when dismissed via escape', async () => {
        const promise = confirmDialog('Dismiss message', {
            confirmLabel: 'Delete',
            confirmVariant: 'danger'
        });
        await Promise.resolve();

        const dialog = document.querySelector('.confirm-dialog');
        expect(dialog?.getAttribute('role')).toBe('alertdialog');
        expect(dialog?.querySelector('.mac-button--danger')).toBeTruthy();

        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );

        await expect(promise).resolves.toBe(false);
    });

    it('should keep cancel as the default enter action when cancel is focused', async () => {
        const promise = confirmDialog('Cancel by default');
        await Promise.resolve();

        const cancelButton = document.querySelector('.confirm-dialog__cancel');
        expect(document.activeElement).toBe(cancelButton);

        cancelButton?.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
        );
        cancelButton?.dispatchEvent(
            new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })
        );
        cancelButton?.click();

        await expect(promise).resolves.toBe(false);
    });

    it('should resolve true when enter is pressed on the focused confirm button', async () => {
        const promise = confirmDialog('Confirm by enter');
        await Promise.resolve();

        const confirmButton = document.querySelector('.confirm-dialog__confirm');
        confirmButton?.focus();

        confirmButton?.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
        );
        confirmButton?.dispatchEvent(
            new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })
        );
        confirmButton?.click();

        await expect(promise).resolves.toBe(true);
    });

    it('should keep tab focus inside the confirmation dialog when opened above a window modal', async () => {
        mountWindowDom();
        const opener = document.getElementById('opener');
        opener.focus();

        const baseWindow = new TestWindow();
        baseWindow.open();
        await Promise.resolve();

        const promise = confirmDialog('Trap focus');
        await Promise.resolve();

        const cancelButton = document.querySelector('.confirm-dialog__cancel');
        const confirmButton = document.querySelector('.confirm-dialog__confirm');
        expect(document.activeElement).toBe(cancelButton);

        cancelButton?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

        expect(document.activeElement).toBe(confirmButton);

        confirmButton?.dispatchEvent(
            new MouseEvent('click', { bubbles: true })
        );
        await expect(promise).resolves.toBe(true);
    });

    it('should render above a window modal using an isolated non-transparent dialog layer', async () => {
        mountWindowDom();
        const baseWindow = new TestWindow();
        baseWindow.open();
        await Promise.resolve();

        const promise = confirmDialog('Delete backup?');
        await Promise.resolve();

        const windowOverlay = document.getElementById('testOverlay');
        const confirmOverlay = document.querySelector('.confirm-dialog-overlay');
        const dialog = confirmOverlay?.querySelector('.confirm-dialog');

        expect(Number(confirmOverlay?.style.zIndex || 0)).toBeGreaterThan(Number(windowOverlay?.style.zIndex || 0));
        expect(confirmOverlay?.classList.contains('confirm-dialog-overlay')).toBe(true);
        expect(dialog?.classList.contains('confirm-dialog')).toBe(true);

        confirmOverlay?.querySelector('.confirm-dialog__cancel')?.dispatchEvent(
            new MouseEvent('click', { bubbles: true })
        );
        await expect(promise).resolves.toBe(false);
    });

    it('should define an isolated opaque visual layer for confirmation dialogs', () => {
        const overlayRule = readCssRule('.confirm-dialog-overlay');
        const dialogRule = readCssRule('.confirm-dialog');

        expect(overlayRule).toContain('z-index: var(--z-modal)');
        expect(overlayRule).toContain('isolation: isolate');
        expect(overlayRule).toContain('pointer-events: auto');
        expect(dialogRule).toContain('background: var(--mac-dialog-bg)');
        expect(dialogRule).toContain('isolation: isolate');
    });

    it('should restore focus before hiding the dialog subtree from assistive tech', async () => {
        mountWindowDom();
        const opener = document.getElementById('opener');
        opener.focus();

        const promise = confirmDialog('Focus return ordering');
        await Promise.resolve();

        const overlay = document.querySelector('.confirm-dialog-overlay');
        const cancelButton = overlay?.querySelector('.confirm-dialog__cancel');

        let activeElementWhenHidden = null;
        const originalSetAttribute = overlay.setAttribute.bind(overlay);
        overlay.setAttribute = (name, value) => {
            if (name === 'aria-hidden' && value === 'true') {
                activeElementWhenHidden = document.activeElement;
            }
            return originalSetAttribute(name, value);
        };

        cancelButton?.dispatchEvent(
            new MouseEvent('click', { bubbles: true })
        );

        await expect(promise).resolves.toBe(false);
        expect(activeElementWhenHidden).toBe(opener);
        expect(overlay.contains(activeElementWhenHidden)).toBe(false);
    });
});

// ===== from tests/shared/tooltip.test.js =====
/**
 * The shared tooltip layer.
 *
 * What matters is that the sentence stays readable wherever the host clips: the section
 * cards are `overflow: hidden`, so a hint drawn inside one is cut off as soon as it needs
 * a third line. Worth a test because the failure is visual and silent.
 */


const HINT = '联想词必须由服务端生成，这里固定用 Bing 这一个源。';

function mountChip() {
    document.body.innerHTML = `
        <div class="card">
            <label class="mac-chip" data-tooltip="${HINT}">
                <input type="checkbox" id="chip">
                <span>搜索联想</span>
            </label>
        </div>`;
    return document.querySelector('.mac-chip');
}

const layer = () => document.querySelector('.tooltip-layer');

function hover(el) {
    el.dispatchEvent(new window.PointerEvent('pointerover', { bubbles: true }));
}

// Tooltip timers are faked for its own describes only — a file-wide fake timer would
// silently change how every other widget here observes animation frames and timeouts.
describe('tooltip layer', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
        initTooltips();
    });

    afterEach(() => {
        destroyTooltips();
        vi.useRealTimers();
    });

    it('sits outside the clipping card, with the hint text', () => {
        const chip = mountChip();
        hover(chip);
        vi.advanceTimersByTime(200);

        const el = layer();
        expect(el).toBeTruthy();
        // The whole point: not a child of the card that would clip it.
        expect(el.parentElement).toBe(document.body);
        expect(el.textContent).toBe(HINT);
        expect(el.hidden).toBe(false);
        expect(el.getAttribute('aria-hidden')).toBe('true');
    });

    it('waits a beat, so sweeping across pills does not flash', () => {
        const chip = mountChip();
        hover(chip);
        vi.advanceTimersByTime(50);
        expect(layer()?.hidden ?? true).toBe(true);

        vi.advanceTimersByTime(200);
        expect(layer().hidden).toBe(false);
    });

    it('appears for the keyboard too', () => {
        mountChip();
        document.getElementById('chip').dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
        vi.advanceTimersByTime(200);
        expect(layer().hidden).toBe(false);
    });

    it('goes away when the pointer leaves, and on Escape', () => {
        const chip = mountChip();
        hover(chip);
        vi.advanceTimersByTime(200);
        expect(layer().hidden).toBe(false);

        chip.dispatchEvent(new window.PointerEvent('pointerout', { bubbles: true }));
        expect(layer().hidden).toBe(true);

        hover(chip);
        vi.advanceTimersByTime(200);
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
        expect(layer().hidden).toBe(true);
    });

    it('ignores elements without a hint and reuses one layer', () => {
        mountChip();
        const plain = document.createElement('span');
        document.body.appendChild(plain);
        hover(plain);
        vi.advanceTimersByTime(200);
        expect(layer()?.hidden ?? true).toBe(true);

        hover(document.querySelector('.mac-chip'));
        vi.advanceTimersByTime(200);
        const first = layer();
        destroyTooltips();
        initTooltips();
        hover(document.querySelector('.mac-chip'));
        vi.advanceTimersByTime(200);
        expect(document.querySelectorAll('.tooltip-layer')).toHaveLength(1);
        expect(layer()).not.toBe(first);
    });
});

// ===== from tests/shared/toast-icons.test.js =====
/**
 * Path `d` values from Iconify heroicons outline (heroicons:check-circle, x-circle,
 * exclamation-circle, information-circle). Regressions here mean SVG drift from official glyphs.
 */
const HEROICONS_OUTLINE_PATH_D = {
    success:
        'M9 12.75L11.25 15L15 9.75M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0',
    error: 'm9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0',
    warning:
        'M12 9v3.75m9-.75a9 9 0 1 1-18 0a9 9 0 0 1 18 0m-9 3.75h.008v.008H12z',
    info: 'm11.25 11.25l.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0m-9-3.75h.008v.008H12z'
};

function pathDFromSvgMarkup(markup) {
    const m = markup.match(/\sd="([^"]+)"/);
    return m ? m[1] : '';
}

describe('TOAST_ICONS', () => {
    it('defines four types with single path and viewBox 24', () => {
        expect(Object.keys(TOAST_ICONS).sort()).toEqual(['error', 'info', 'success', 'warning']);
        for (const key of Object.keys(TOAST_ICONS)) {
            const html = TOAST_ICONS[key];
            expect(html).toMatch(/viewBox="0 0 24 24"/);
            expect(html).toMatch(/stroke-width="1\.5"/);
            expect((html.match(/<path/g) || []).length).toBe(1);
            expect(pathDFromSvgMarkup(html).length).toBeGreaterThan(10);
        }
    });

    it('matches Iconify heroicons outline path data (incl. exclamation-circle)', () => {
        for (const type of ['success', 'error', 'warning', 'info']) {
            expect(pathDFromSvgMarkup(TOAST_ICONS[type])).toBe(HEROICONS_OUTLINE_PATH_D[type]);
        }
    });
});

// ===== from tests/shared/favicon-offscreen.test.js =====
describe('favicon offscreen parsing', () => {
    it('resolves declared icon links, manifest links, and ignores unsafe URLs', () => {
        const result = parsePage(`
            <link rel="shortcut icon" href="/favicon.svg" sizes="128x128">
            <link rel="apple-touch-icon" href="https://cdn.example.com/apple.png" sizes="180x180">
            <link rel="manifest" href="/manifest.webmanifest">
            <link rel="icon" href="javascript:alert(1)">
        `, 'https://example.com/path/page');

        expect(result.candidates).toEqual([
            expect.objectContaining({ url: 'https://example.com/favicon.svg', sourceKind: 'html-icon', sizeHint: 128 }),
            expect.objectContaining({ url: 'https://cdn.example.com/apple.png', sourceKind: 'apple-touch', sizeHint: 180 })
        ]);
        expect(result.manifests).toEqual(['https://example.com/manifest.webmanifest']);
    });

    it('parses manifest icons and excludes monochrome entries', () => {
        const icons = parseManifest(JSON.stringify({ icons: [
            { src: '/icon-192.png', sizes: '192x192', purpose: 'any' },
            { src: '/maskable.png', sizes: '512x512', purpose: 'maskable' },
            { src: '/mono.png', sizes: '512x512', purpose: 'monochrome' }
        ] }), 'https://example.com/manifest.webmanifest');

        expect(icons).toEqual([
            expect.objectContaining({ url: 'https://example.com/icon-192.png', purpose: 'any', sizeHint: 192 }),
            expect.objectContaining({ url: 'https://example.com/maskable.png', purpose: 'maskable', sizeHint: 512 })
        ]);
    });
});

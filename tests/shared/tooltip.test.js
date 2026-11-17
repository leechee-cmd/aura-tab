/**
 * The shared tooltip layer.
 *
 * What matters is that the sentence stays readable wherever the host clips: the section
 * cards are `overflow: hidden`, so a hint drawn inside one is cut off as soon as it needs
 * a third line. Worth a test because the failure is visual and silent.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initTooltips, destroyTooltips } from '../../scripts/shared/tooltip.js';

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

beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    initTooltips();
});

afterEach(() => {
    destroyTooltips();
    vi.useRealTimers();
});

describe('tooltip layer', () => {
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

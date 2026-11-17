/**
 * The popup menu that stands in for the system's own `<select>` list.
 *
 * What is worth guarding here is the contract, not the pixels: every host in the app
 * still reads `select.value` and listens for `change`, so a menu that forgets to write
 * back — or a host that writes `.value` and sees a stale label — is a silent desync.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { enhanceSelect, enhanceSelects, closeSelectMenu } from '../../scripts/shared/select-menu.js';

function mount(html = '<select id="pick"><option value="a">Alpha</option><option value="b">Beta</option><option value="c">Gamma</option></select>') {
    document.body.innerHTML = `<div class="mac-select">${html}</div>`;
    return document.getElementById('pick');
}

const trigger = () => document.querySelector('.select-menu-trigger');
const list = () => document.querySelector('.select-menu-list');
const items = () => [...document.querySelectorAll('.select-menu-item')];
const key = (el, name) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true }));

let mounted = [];

function enhance(select, options) {
    const controller = enhanceSelect(select, options);
    if (controller) mounted.push(controller);
    return controller;
}

beforeEach(() => {
    mounted = [];
    document.body.innerHTML = '';
});

afterEach(() => {
    for (const controller of mounted) controller.destroy();
    mounted = [];
    document.body.innerHTML = '';
});

describe('select-menu', () => {
    it('hides the native select and shows its current option on the trigger', () => {
        const select = mount();
        enhance(select);
        expect(select.classList.contains('select-menu-native')).toBe(true);
        expect(select.getAttribute('aria-hidden')).toBe('true');
        expect(trigger().querySelector('.select-menu-label').textContent).toBe('Alpha');
    });

    it('writes a chosen item back to the select and fires one change', () => {
        const select = mount();
        enhance(select);
        let changes = 0;
        select.addEventListener('change', () => { changes += 1; });

        trigger().click();
        items()[2].dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true }));

        expect(select.value).toBe('c');
        expect(changes).toBe(1);
        expect(trigger().querySelector('.select-menu-label').textContent).toBe('Gamma');
        expect(list().hidden).toBe(true);
    });

    it('follows a value written by the host, which fires no event', () => {
        const select = mount();
        enhance(select);
        // This is how the appearance section restores stored settings.
        select.value = 'b';
        expect(trigger().querySelector('.select-menu-label').textContent).toBe('Beta');
    });

    it('disables the trigger when the host disables the select', () => {
        const select = mount();
        enhance(select);
        select.disabled = true;
        expect(trigger().disabled).toBe(true);
        // A disabled row must not open: the Bing source pins the refresh interval this way.
        trigger().click();
        expect(list().hidden).toBe(true);
    });

    it('opens on ArrowDown, moves with arrows and commits with Enter', () => {
        const select = mount();
        enhance(select);

        key(trigger(), 'ArrowDown');
        expect(list().hidden).toBe(false);
        key(trigger(), 'ArrowDown');
        key(trigger(), 'Enter');
        expect(select.value).toBe('b');
        expect(list().hidden).toBe(true);
    });

    it('treats Escape as a cancel that leaves the value alone', () => {
        const select = mount();
        enhance(select);
        trigger().click();
        key(trigger(), 'ArrowDown');
        key(trigger(), 'ArrowDown');
        key(trigger(), 'Escape');
        expect(select.value).toBe('a');
        expect(list().hidden).toBe(true);
    });

    it('closes when the pointer goes down somewhere else', () => {
        const select = mount();
        enhance(select);
        trigger().click();
        document.body.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
        expect(list().hidden).toBe(true);
    });

    it('keeps only one menu open at a time', () => {
        document.body.innerHTML = `
            <div class="mac-select"><select id="one"><option>A</option></select></div>
            <div class="mac-select"><select id="two"><option>B</option></select></div>`;
        mounted.push(enhanceSelect(document.getElementById('one')));
        mounted.push(enhanceSelect(document.getElementById('two')));
        const [first, second] = [...document.querySelectorAll('.select-menu-trigger')];
        const [firstList, secondList] = [...document.querySelectorAll('.select-menu-list')];

        first.click();
        expect(firstList.hidden).toBe(false);

        second.click();
        expect(firstList.hidden).toBe(true);
        expect(secondList.hidden).toBe(false);
    });

    it('sweeps up the menu of a select that a re-render removed', () => {
        const select = mount();
        enhance(select);
        expect(document.querySelectorAll('.select-menu-list')).toHaveLength(1);

        // The settings window replaces its whole content subtree on every route change.
        document.body.innerHTML = '<div class="mac-select"><select id="pick"><option value="a">Alpha</option></select></div>';
        enhanceSelects(document.body);
        expect(document.querySelectorAll('.select-menu-list')).toHaveLength(1);
    });

    it('can force the dark palette for hosts whose glass is always dark', () => {
        const select = mount();
        enhance(select, { tone: 'dark' });
        expect(list().dataset.tone).toBe('dark');
    });

    it('closes everything on demand, for a window or modal that is going away', () => {
        const select = mount();
        enhance(select);
        trigger().click();
        closeSelectMenu();
        expect(list().hidden).toBe(true);
    });

    it('does nothing when handed something that is not a select', () => {
        document.body.innerHTML = '<input id="not-a-select">';
        expect(enhanceSelect(document.getElementById('not-a-select'))).toBeNull();
    });
});

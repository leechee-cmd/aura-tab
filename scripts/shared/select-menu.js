/**
 * A popup menu that replaces the one the operating system draws for `<select>`.
 *
 * The `<select>` stays exactly where it was: it keeps its id, its `value` and its `change`
 * event, so every caller that reads `container.querySelector('#x').value` or listens for
 * `change` keeps working untouched. What changes is only what the user sees and clicks —
 * a trigger plus a floating list drawn in the app's own glass.
 *
 * The list is rendered into `document.body` with `position: fixed` because every host
 * scrolls (the settings content area, the bookmarks modal) and an in-flow list would be
 * clipped by that scroll container.
 *
 * The select itself is taken out of the accessibility tree: with two controls presenting
 * the same value, one of them would be lying. The trigger carries the combobox semantics
 * and the list carries listbox semantics, so keyboard and screen readers talk to exactly
 * one of them.
 *
 * Two writes have to be mirrored back to the trigger, and neither fires an event: hosts set
 * `select.value = x` directly when they load stored settings, and `select.disabled = x` when
 * a row turns conditional. Both are shadowed on the instance so the trigger follows them.
 */

const OPEN_CLASS = 'is-open';
const MENU_ATTR = 'data-select-menu';

let idCounter = 0;

/** Menus that are currently open. Only one may be; opening another closes the rest. */
const openMenus = new Set();

/** Every live controller, so orphans left behind by a re-render can be swept up. */
const byList = new WeakMap();

function chevron() {
    return '<svg class="select-menu-chevron" viewBox="0 0 12 12" aria-hidden="true">'
        + '<path d="M3 4.6l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.4" '
        + 'stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function checkmark() {
    return '<svg class="select-menu-check" viewBox="0 0 14 14" aria-hidden="true">'
        + '<path d="M3 7.4l2.6 2.6L11 4.4" fill="none" stroke="currentColor" stroke-width="1.8" '
        + 'stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function optionsOf(select) {
    return [...select.options].map((option) => ({
        value: option.value,
        label: option.textContent.trim(),
        disabled: option.disabled
    }));
}

/**
 * Turn one `<select>` into a trigger + popup menu.
 * Idempotent: a second call on the same element returns the existing controller.
 */
export function enhanceSelect(select, { tone = '' } = {}) {
    if (!select || select.tagName !== 'SELECT') return null;
    if (select[MENU_ATTR]) return select[MENU_ATTR];

    const id = `select-menu-${idCounter += 1}`;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'select-menu-trigger';
    trigger.id = `${id}-trigger`;
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', `${id}-list`);

    const label = document.createElement('span');
    label.className = 'select-menu-label';
    trigger.appendChild(label);
    trigger.insertAdjacentHTML('beforeend', chevron());

    const list = document.createElement('div');
    list.className = 'select-menu-list';
    list.id = `${id}-list`;
    list.setAttribute('role', 'listbox');
    list.setAttribute('tabindex', '-1');
    // 'dark' for hosts whose glass is dark whatever the page theme says (the bookmarks
    // import sheet); empty means "follow the theme".
    if (tone) list.dataset.tone = tone;
    list.hidden = true;

    // The select stays in the DOM for the value contract but leaves the a11y tree: the
    // trigger is the only thing a screen reader or Tab should find.
    select.classList.add('select-menu-native');
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;
    select.after(trigger);
    // A host that draws the old arrow next to the select stops needing it.
    select.parentElement?.classList.add('has-select-menu');
    document.body.appendChild(list);

    let activeIndex = select.selectedIndex;
    let open = false;

    const reflect = () => {
        const options = optionsOf(select);
        const current = options[select.selectedIndex];
        label.textContent = current ? current.label : '';
        trigger.disabled = select.disabled;
        trigger.classList.toggle('is-disabled', select.disabled);
        // Keep the popup in step with option changes (a language switch rebuilds labels).
        if (open) render();
    };

    const render = () => {
        const options = optionsOf(select);
        list.replaceChildren(
            ...options.map((option, index) => {
                const item = document.createElement('div');
                item.className = 'select-menu-item';
                item.id = `${id}-option-${index}`;
                item.setAttribute('role', 'option');
                item.setAttribute('aria-selected', String(index === select.selectedIndex));
                item.dataset.index = String(index);
                if (option.disabled) {
                    item.setAttribute('aria-disabled', 'true');
                    item.classList.add('is-disabled');
                }
                if (index === select.selectedIndex) item.classList.add('is-selected');
                if (index === activeIndex) item.classList.add('is-active');
                item.innerHTML = `${checkmark()}<span></span>`;
                item.lastElementChild.textContent = option.label;
                return item;
            })
        );
    };

    const place = () => {
        const anchor = trigger.getBoundingClientRect();
        const rect = list.getBoundingClientRect();
        const margin = 8;
        const gap = 6;

        // Anchored to the trigger's left edge, until that would push the menu off the
        // right side — then it hangs from the right edge instead, as system menus do.
        let left = anchor.left;
        if (left + rect.width > window.innerWidth - margin) {
            left = Math.max(margin, anchor.right - rect.width);
        }

        let top = anchor.bottom + gap;
        if (top + rect.height > window.innerHeight - margin) {
            const above = anchor.top - gap - rect.height;
            top = above >= margin ? above : Math.max(margin, window.innerHeight - margin - rect.height);
        }

        list.style.left = `${Math.round(left)}px`;
        list.style.top = `${Math.round(top)}px`;
    };

    const setActive = (index) => {
        const options = optionsOf(select);
        if (!options.length) return;
        const step = index < activeIndex ? -1 : 1;
        let next = Math.max(0, Math.min(options.length - 1, index));
        // Skip over disabled options in the direction of travel.
        while (options[next] && options[next].disabled && next !== index) {
            next += step;
            if (next < 0 || next >= options.length) {
                next = Math.max(0, Math.min(options.length - 1, index));
                break;
            }
        }
        activeIndex = next;
        for (const item of list.children) {
            item.classList.toggle('is-active', Number(item.dataset.index) === activeIndex);
        }
        const active = list.children[activeIndex];
        if (active) {
            trigger.setAttribute('aria-activedescendant', active.id);
            active.scrollIntoView?.({ block: 'nearest' });
        }
    };

    const close = ({ focus = false } = {}) => {
        if (!open) return;
        open = false;
        openMenus.delete(controller);
        list.hidden = true;
        list.classList.remove(OPEN_CLASS);
        trigger.classList.remove(OPEN_CLASS);
        trigger.setAttribute('aria-expanded', 'false');
        trigger.removeAttribute('aria-activedescendant');
        if (focus) trigger.focus();
        document.removeEventListener('pointerdown', onOutside, true);
        window.removeEventListener('resize', close);
        document.removeEventListener('scroll', onScroll, true);
    };

    const onOutside = (event) => {
        if (list.contains(event.target) || trigger.contains(event.target)) return;
        close();
    };

    // The trigger's own click is what opened the menu; ignoring the pointerdown that
    // precedes it keeps the toggle from closing what it just opened.
    const onScroll = (event) => {
        if (list.contains(event.target)) return;
        place();
    };

    function choose(index) {
        const options = optionsOf(select);
        const option = options[index];
        if (!option || option.disabled) return;
        if (index !== select.selectedIndex) {
            select.selectedIndex = index;
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        reflect();
        close({ focus: true });
    }

    const openMenu = () => {
        if (select.disabled) return;
        for (const other of openMenus) other.close();
        open = true;
        openMenus.add(controller);
        document.addEventListener('pointerdown', onOutside, true);
        window.addEventListener('resize', close);
        document.addEventListener('scroll', onScroll, true);
        activeIndex = Math.max(0, select.selectedIndex);
        render();
        list.hidden = false;
        list.classList.add(OPEN_CLASS);
        trigger.classList.add(OPEN_CLASS);
        trigger.setAttribute('aria-expanded', 'true');
        place();
        setActive(activeIndex);
    };

    const onTriggerClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (open) close();
        else openMenu();
    };

    const onTriggerKeyDown = (event) => {
        if (select.disabled) return;
        const options = optionsOf(select);
        switch (event.key) {
            case 'ArrowDown':
            case 'ArrowUp': {
                event.preventDefault();
                if (!open) {
                    openMenu();
                    return;
                }
                setActive(activeIndex + (event.key === 'ArrowDown' ? 1 : -1));
                return;
            }
            case 'Home':
            case 'End':
                if (!open) return;
                event.preventDefault();
                setActive(event.key === 'Home' ? 0 : options.length - 1);
                return;
            case 'Enter':
            case ' ':
                event.preventDefault();
                if (open) choose(activeIndex);
                else openMenu();
                return;
            case 'Escape':
                if (!open) return;
                event.preventDefault();
                // Escape is a cancel: the value stays exactly where it was.
                close({ focus: true });
                return;
            case 'Tab':
                close();
                return;
            default:
        }
    };

    const onListPointerDown = (event) => {
        // Keep focus on the trigger so the menu keeps its keyboard owner.
        event.preventDefault();
        const item = event.target.closest('.select-menu-item');
        if (!item) return;
        choose(Number(item.dataset.index));
    };

    const onListPointerMove = (event) => {
        const item = event.target.closest('.select-menu-item');
        if (!item || item.classList.contains('is-disabled')) return;
        setActive(Number(item.dataset.index));
    };

    const controller = {
        select,
        trigger,
        list,
        open: openMenu,
        close,
        refresh: reflect,
        destroy() {
            close();
            byList.delete(list);
            select.parentElement?.classList.remove('has-select-menu');
            document.removeEventListener('pointerdown', onOutside, true);
            window.removeEventListener('resize', close);
            document.removeEventListener('scroll', onScroll, true);
            trigger.remove();
            list.remove();
            select.classList.remove('select-menu-native');
            select.removeAttribute('aria-hidden');
            select.removeAttribute(MENU_ATTR);
            delete select[MENU_ATTR];
        }
    };

    select[MENU_ATTR] = controller;
    byList.set(list, controller);

    trigger.addEventListener('click', onTriggerClick);
    trigger.addEventListener('keydown', onTriggerKeyDown);
    list.addEventListener('pointerdown', onListPointerDown);
    list.addEventListener('pointermove', onListPointerMove);
    select.addEventListener('change', reflect);

    // Mirrored writes (see the module note): value and disabled never fire events.
    for (const prop of ['value', 'selectedIndex', 'disabled']) {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
        if (!descriptor?.get || !descriptor?.set) continue;
        Object.defineProperty(select, prop, {
            configurable: true,
            get: () => descriptor.get.call(select),
            set: (next) => {
                descriptor.set.call(select, next);
                reflect();
            }
        });
    }

    reflect();
    return controller;
}

/**
 * Enhance every `<select>` under `root` that has not been enhanced yet.
 * Call after the host has rendered its markup.
 */
export function enhanceSelects(root = document, options = {}) {
    sweep();
    if (root instanceof HTMLSelectElement) {
        return [root.classList.contains('select-menu-native') ? null : enhanceSelect(root, options)]
            .filter(Boolean);
    }
    const scope = root instanceof Element || root instanceof Document ? root : document;
    return [...scope.querySelectorAll('select')]
        .filter((select) => !select.classList.contains('select-menu-native'))
        .map((select) => enhanceSelect(select, options))
        .filter(Boolean);
}

/**
 * Drop controllers whose select has left the document. The settings window replaces its
 * whole content subtree on every route change, and the popup lives on `body` — without
 * this sweep each visit would leave a dead menu behind.
 */
function sweep() {
    for (const list of document.querySelectorAll('.select-menu-list')) {
        const controller = byList.get(list);
        if (!controller) {
            list.remove();
            continue;
        }
        if (!controller.select.isConnected) controller.destroy();
    }
}

/** Close whatever menu is open, outside of any user gesture (route change, modal close). */
export function closeSelectMenu() {
    for (const menu of [...openMenus]) menu.close();
}

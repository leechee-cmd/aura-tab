import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DragStateMachine } from '../scripts/platform/lifecycle.js';

/**
 * 契约（specs/modules/quicklinks.md）：拖拽期间禁止其他操作，拖拽结束后还有一小段冷却期，
 * 避免拖到一半触发重排、编辑或点击。
 */

describe('drag guard', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('blocks other operations while dragging', () => {
        const machine = new DragStateMachine(150);

        expect(machine.canOperate).toBe(true);
        expect(machine.startDrag()).toBe(true);
        expect(machine.isDragging).toBe(true);
        expect(machine.canOperate).toBe(false);

        machine.destroy();
    });

    it('keeps operations blocked during the cooldown after a drop', () => {
        const machine = new DragStateMachine(150);
        machine.startDrag();

        expect(machine.endDrag()).toBe(true);
        expect(machine.canOperate).toBe(false);

        vi.advanceTimersByTime(149);
        expect(machine.canOperate).toBe(false);

        vi.advanceTimersByTime(1);
        expect(machine.canOperate).toBe(true);

        machine.destroy();
    });

    it('ignores a second drag start while one is already running', () => {
        const machine = new DragStateMachine(150);
        machine.startDrag();

        expect(machine.startDrag()).toBe(false);
        expect(machine.startDrag()).toBe(false);

        machine.destroy();
    });

    it('cannot end a drag that never started', () => {
        const machine = new DragStateMachine(150);

        expect(machine.endDrag()).toBe(false);
        expect(machine.canOperate).toBe(true);

        machine.destroy();
    });

    it('notifies subscribers on every state change', () => {
        const machine = new DragStateMachine(150);
        const seen = [];
        const unsubscribe = machine.subscribe((state) => seen.push(state));

        machine.startDrag();
        machine.endDrag();
        vi.advanceTimersByTime(150);

        expect(seen).toEqual(['dragging', 'cooldown', 'idle']);

        unsubscribe();
        machine.startDrag();
        expect(seen).toEqual(['dragging', 'cooldown', 'idle']);

        machine.destroy();
    });
});

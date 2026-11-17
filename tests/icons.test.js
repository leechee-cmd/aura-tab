/**
 * 图标模块
 *
 * Focus:
 * - 十个引擎各有一个标，`default` 与未知 key 都回落到放大镜
 * - 引擎标不带宽高（尺寸交给 CSS），永远是 24 网格单色
 * - 界面上那四个小图标仍自带尺寸（行高只有 12px，靠 CSS 推不出来）
 */

import { describe, it, expect } from 'vitest';
import { ICONS, ENGINE_MARKS, engineMark } from '../scripts/shared/icons.js';

const BRANDS = ['google', 'bing', 'baidu', 'duckduckgo', 'yahoo', 'yandex', 'ecosia', 'brave', 'naver', 'sogou'];

describe('icons', () => {
    it('has one mark for every engine the settings offer', () => {
        expect(Object.keys(ENGINE_MARKS).sort()).toEqual([...BRANDS].sort());
    });

    it('falls back to the magnifier for "default" and for anything unknown', () => {
        // Which engine the browser itself is set to is not something an extension can
        // read, so there is no honest brand to show.
        expect(engineMark('default')).toBe(ICONS.search);
        expect(engineMark('not-an-engine')).toBe(ICONS.search);
        expect(engineMark(undefined)).toBe(ICONS.search);
    });

    it('leaves the size to CSS so one mark serves the button and the switcher', () => {
        for (const key of ['default', ...BRANDS]) {
            const svg = engineMark(key);
            expect(svg).toContain('viewBox="0 0 24 24"');
            // `stroke-width` is another matter: only a real size attribute is banned here.
            expect(svg).not.toMatch(/\swidth="\d/);
            expect(svg).not.toMatch(/\sheight="\d/);
            expect(svg).toContain('currentColor');
            expect(svg).toContain('aria-hidden="true"');
        }
    });

    it('draws every mark from a single path so it inherits one colour', () => {
        for (const key of BRANDS) {
            expect(ENGINE_MARKS[key].match(/<path /g)).toHaveLength(1);
        }
    });

    it('leaves the size of the small glyphs to CSS as well', () => {
        // The row tiles are 20px; a 12px glyph inside them needs an explicit rule. When
        // the markup carried the size instead, one icon that forgot it (the magnifier)
        // silently stretched to the tile and looked heavier than the clock beside it.
        for (const key of Object.keys(ICONS)) {
            expect(ICONS[key]).not.toMatch(/\swidth="\d/);
            expect(ICONS[key]).not.toMatch(/\sheight="\d/);
        }
    });
});

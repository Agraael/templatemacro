// Colour the THT LoS ruler where it crosses templatemacro zones.

/* global canvas, game, Hooks, PIXI, Token, CONST */

import { MODULE } from "./constants.mjs";
import { getTemplateOccupiedOffsets } from "./api.mjs";

const _LINE_WIDTH = 4;
const _ALPHA = 0.75;
const _SAMPLE_PX = 10;
const _OVERLAY_NAME = "tmac-tht-ruler-overlay";

let _overlay = null;
let _activeRays = [];

function _getLosLayer() {
    return canvas?.terrainHeightLosRulerLayer
        ?? canvas?.terrainHeightLosRulerLayer$
        ?? canvas?.layers?.find?.(l => l?.constructor?.name === "LineOfSightRulerLayer")
        ?? null;
}

function _ensureOverlay() {
    const layer = _getLosLayer();
    if (!layer) return null;
    if (!_overlay || _overlay.destroyed) {
        _overlay = new PIXI.Graphics();
        _overlay.name = _OVERLAY_NAME;
    }
    if (_overlay.parent !== layer) {
        try { _overlay.parent?.removeChild(_overlay); } catch { /* */ }
    }
    layer.addChild(_overlay);
    return _overlay;
}

function _parseColor(hex) {
    if (typeof hex !== "string") return 0xffffff;
    const m = /#?([0-9a-f]{6})/i.exec(hex);
    return m ? Number.parseInt(m[1], 16) : 0xffffff;
}

function _templateColor(templateDoc) {
    return _parseColor(
        templateDoc.getFlag(MODULE, "lineColor")
        ?? templateDoc.getFlag(MODULE, "fillColor")
        ?? templateDoc.borderColor
        ?? "#ffffff"
    );
}

const SETTING_INCLUDE = "lineOfSightIncludeTemplates";
const RAY_FLAG = "_tmacIncludeTemplates";

function _includeOn() {
    try { return !!game.settings.get(MODULE, SETTING_INCLUDE); }
    catch { return false; }
}

// Sender's flag wins (broadcast via the ray), else local setting.
function _shouldShowOverlay() {
    if (_activeRays.some(r => r?.[RAY_FLAG])) return true;
    return _includeOn();
}

function* _interactingTemplates() {
    if (!_shouldShowOverlay()) return;
    if (!canvas?.scene) return;
    for (const templateDoc of canvas.scene.templates) {
        const flags = templateDoc.flags?.[MODULE];
        if (!flags || Object.keys(flags).length === 0) continue;
        if (templateDoc.hidden && !game.user.isGM) continue;
        const obj = templateDoc.object;
        if (!obj?.shape) continue;
        yield templateDoc;
    }
}


function _isGridless() {
    return canvas?.grid?.type === CONST.GRID_TYPES.GRIDLESS;
}

// Cell membership on a grid (the visible hexes), shape on gridless.
function _pointInTemplate(templateDoc, occupiedCache, x, y) {
    if (_isGridless()) {
        return !!templateDoc.object?.shape?.contains?.(x - templateDoc.x, y - templateDoc.y);
    }
    let occupied = occupiedCache.get(templateDoc.id);
    if (!occupied) {
        try { occupied = getTemplateOccupiedOffsets(templateDoc) ?? new Set(); }
        catch { occupied = new Set(); }
        occupiedCache.set(templateDoc.id, occupied);
    }
    const off = canvas.grid.getOffset({ x, y });
    return occupied.has(`${off.i},${off.j}`);
}

function _paintRay(g, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const steps = Math.max(2, Math.ceil(len / _SAMPLE_PX));
    const templates = [..._interactingTemplates()];
    if (templates.length === 0) return;
    const occupiedCache = new Map();
    for (const templateDoc of templates) {
        const color = _templateColor(templateDoc);
        g.lineStyle(_LINE_WIDTH, color, _ALPHA);
        let inside = false;
        let segStartX = 0;
        let segStartY = 0;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = ax + dx * t;
            const y = ay + dy * t;
            const here = _pointInTemplate(templateDoc, occupiedCache, x, y);
            if (here && !inside) {
                segStartX = x;
                segStartY = y;
                inside = true;
            } else if (!here && inside) {
                g.moveTo(segStartX, segStartY);
                g.lineTo(x, y);
                inside = false;
            }
        }
        if (inside) {
            g.moveTo(segStartX, segStartY);
            g.lineTo(bx, by);
        }
    }
}

function _toCenterPoint(end) {
    if (!end) return null;
    if (end instanceof Token || end?.document) {
        return { x: end.x + (end.w ?? 0) / 2, y: end.y + (end.h ?? 0) / 2 };
    }
    if (typeof end.x === "number" && typeof end.y === "number") return { x: end.x, y: end.y };
    return null;
}

function _isToken(end) {
    return end instanceof Token || !!end?.document;
}

// Token-to-token rays fan into 3 (centre + 2 edges). Use THT's calc so hex vertices match.
function _fanRay(ray, a, b) {
    if (ray?.includeEdges === false) return [{ a, b }];
    if (!_isToken(ray?.a) || !_isToken(ray?.b)) return [{ a, b }];
    const calc = globalThis.terrainHeightTools?.calculateLineOfSightRaysBetweenTokens;
    if (typeof calc === "function") {
        try {
            const { left, centre, right } = calc(ray.a, ray.b);
            return [
                { a: centre.p1, b: centre.p2 },
                { a: left.p1, b: left.p2 },
                { a: right.p1, b: right.p2 }
            ];
        } catch { /* fall through */ }
    }
    // Fallback: perpendicular offset by radius.
    const radius = Math.min((ray.a.w ?? 0) / 2, (ray.b.w ?? 0) / 2);
    if (radius <= 0) return [{ a, b }];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return [{ a, b }];
    const nx = -dy / len, ny = dx / len;
    return [
        { a, b },
        { a: { x: a.x + nx * radius, y: a.y + ny * radius }, b: { x: b.x + nx * radius, y: b.y + ny * radius } },
        { a: { x: a.x - nx * radius, y: a.y - ny * radius }, b: { x: b.x - nx * radius, y: b.y - ny * radius } }
    ];
}

function _redraw() {
    const g = _ensureOverlay();
    if (!g) return;
    g.clear();
    for (const ray of _activeRays) {
        const a = _toCenterPoint(ray?.a);
        const b = _toCenterPoint(ray?.b);
        if (!a || !b) continue;
        for (const sub of _fanRay(ray, a, b))
            _paintRay(g, sub.a.x, sub.a.y, sub.b.x, sub.b.y);
    }
}

function _onRulerDraw(rulers) {
    _activeRays = Array.isArray(rulers) ? rulers.slice() : [];
    _redraw();
}

function _onRulerClear() {
    _activeRays = [];
    const g = _ensureOverlay();
    g?.clear?.();
}

function _isThtActive() {
    return !!game.modules.get("terrain-height-tools")?.active;
}

function _registerSetting() {
    if (game.settings.settings.has(`${MODULE}.${SETTING_INCLUDE}`)) return;
    game.settings.register(MODULE, SETTING_INCLUDE, {
        scope: "client",
        config: false,
        type: Boolean,
        default: false,
        onChange: () => _redraw()
    });
}

function _styleToggle(btn, on) {
    btn.style.cssText = `
        margin-top: 1.25rem; padding: 4px 8px;
        background: ${on ? "var(--color-warm-2, rgba(255,100,0,0.18))" : "transparent"};
        border: 1px solid ${on ? "var(--color-border-highlight, #ff6400)" : "var(--color-cool-4, #555)"};
        border-radius: 4px; cursor: pointer; opacity: ${on ? "1" : "0.65"};
        line-height: 1;
    `;
}

function _injectToolbarToggle(_app, htmlOrEl) {
    const root = htmlOrEl instanceof HTMLElement ? htmlOrEl : htmlOrEl?.[0];
    if (!root) return;
    if (root.querySelector(".tmac-include-templates")) return;
    const anchor = root.querySelector('[name="rulerIncludeNoHeightTerrain"]');
    if (!anchor) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tmac-include-templates flex0";
    btn.dataset.tooltip = "Include templatemacro zones on the LoS ruler";
    btn.innerHTML = `<i class="fa-solid fa-shapes"></i>`;
    _styleToggle(btn, _includeOn());
    btn.addEventListener("click", async () => {
        const next = !_includeOn();
        await game.settings.set(MODULE, SETTING_INCLUDE, next);
        _styleToggle(btn, next);
    });
    anchor.after(btn);
}

export function setupThtRulerOverlay() {
    if (!_isThtActive()) return;
    _registerSetting();
    Hooks.on("renderLineOfSightRulerToolbar", _injectToolbarToggle);
    Hooks.on("renderTokenLineOfSightToolbar", _injectToolbarToggle);
    Hooks.on("canvasReady", () => {
        const layer = _getLosLayer();
        if (!layer) return;
        const proto = Object.getPrototypeOf(layer);
        if (proto._tmacWrapped) return;
        const origDraw = proto._drawLineOfSightRays;
        const origClear = proto._clearLineOfSightRays;
        if (typeof origDraw === "function") {
            proto._drawLineOfSightRays = function patched(rulers, ...rest) {
                // Stamp the flag so the socket broadcast carries it.
                if (Array.isArray(rulers) && _includeOn()) {
                    for (const r of rulers)
                        if (r && typeof r === "object") r[RAY_FLAG] = true;
                }
                const result = origDraw.call(this, rulers, ...rest);
                try { _onRulerDraw(rulers); } catch (e) { console.warn("templatemacro | THT ruler overlay draw failed", e); }
                return result;
            };
        }
        if (typeof origClear === "function") {
            proto._clearLineOfSightRays = function patched(...args) {
                const result = origClear.apply(this, args);
                try { _onRulerClear(); } catch (e) { console.warn("templatemacro | THT ruler overlay clear failed", e); }
                return result;
            };
        }
        proto._tmacWrapped = true;
    });
    Hooks.on("canvasTearDown", () => {
        _overlay = null;
        _activeRays = [];
    });
    Hooks.on("refreshMeasuredTemplate", () => _redraw());
}

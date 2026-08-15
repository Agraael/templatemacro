import { MODULE } from "./constants.mjs";
import { refreshCenterLabel } from "./patternFill.mjs";
import { terrainTopAt } from "./elevation-cull.mjs";

let _pendingElevation = null;
let _pendingCloneDoc = null;
let _pendingOriginalId = null;
let _elevLabel = null;
let _elevLabelTick = null;
let _baseProvider = null;
let _baseOffset = 0;
let _providerTick = null;
let _moveOffset = 0;

function _autoMove()
{
    return game.settings.get(MODULE, "thtAutoElevation") && !!globalThis.terrainHeightTools;
}

function _autoMoveElevation(origDoc, x, y)
{
    return (origDoc.elevation ?? 0) + (terrainTopAt(x, y) - terrainTopAt(origDoc.x, origDoc.y));
}

// Creation-preview mode: caller supplies the base elevation, Q/E adjust an offset on top.
export function setPreviewElevationBase(fn)
{
    _baseProvider = typeof fn === "function" ? fn : null;
    _baseOffset = 0;
    if (_baseProvider && !_providerTick)
    {
        _providerTick = () =>
        {
            if (!_baseProvider)
            {
                canvas.app?.ticker?.remove(_providerTick);
                _providerTick = null;
                return;
            }
            const preview = canvas.templates?.preview?.children?.[0];
            if (!preview?.document)
            {
                _hideElevLabel();
                return;
            }
            const total = _baseProvider(preview.document) + _baseOffset;
            preview.document.elevation = total;
            _showElevLabel(total);
        };
        canvas.app.ticker.add(_providerTick);
    }
    else if (!_baseProvider && _providerTick)
    {
        canvas.app?.ticker?.remove(_providerTick);
        _providerTick = null;
        _hideElevLabel();
    }
}

function _hideElevLabel()
{
    if (_elevLabelTick)
        canvas.app?.ticker?.remove(_elevLabelTick);
    _elevLabelTick = null;
    if (_elevLabel && !_elevLabel.destroyed)
        _elevLabel.destroy();
    _elevLabel = null;
}

function _showElevLabel(value)
{
    if (!_elevLabel || _elevLabel.destroyed)
    {
        const style = new PIXI.TextStyle({
            fontFamily: "Signika",
            fontSize: Math.max(20, canvas.grid.size * 0.3),
            fill: "#ffffff",
            stroke: "#000000",
            strokeThickness: 4,
            fontWeight: "700"
        });
        _elevLabel = new PreciseText("", style);
        _elevLabel.anchor.set(0.5, 0);
        _elevLabel.eventMode = "none";
        canvas.stage.addChild(_elevLabel);
        _elevLabelTick = () =>
        {
            const preview = canvas.templates?.preview?.children?.[0];
            if (!preview?.document || !_elevLabel || _elevLabel.destroyed)
            {
                _hideElevLabel();
                return;
            }
            _elevLabel.position.set(preview.document.x, preview.document.y + canvas.grid.size * 0.55);
        };
        canvas.app.ticker.add(_elevLabelTick);
    }
    const text = `⇕ ${value >= 0 ? "+" : ""}${value}`;
    if (_elevLabel.text !== text)
        _elevLabel.text = text;
}

function _adjustPreviewElevation(delta)
{
    const previews = canvas.templates?.preview?.children ?? [];
    if (!previews.length)
    {
        _reset();
        return false;
    }
    if (_baseProvider)
    {
        _baseOffset += delta;
        return true;
    }
    const moveClone = previews.find(preview => preview?._original && !preview.destroyed);
    if (moveClone && _autoMove())
    {
        _moveOffset += delta;
        return true;
    }
    for (const t of previews)
    {
        if (!t?.document)
            continue;
        if (_pendingCloneDoc !== t.document)
        {
            _pendingElevation = t.document.elevation ?? 0;
            _pendingCloneDoc = t.document;
            _pendingOriginalId = t._original?.document?.id ?? null;
        }
        _pendingElevation += delta;
        const targets = [t, t._original].filter(x => x && !x.destroyed);
        for (const tt of targets)
        {
            tt.document.elevation = _pendingElevation;
            if (typeof tt._refreshElevation === "function")
            {
                try { tt._refreshElevation(); } catch { /* ignore */ }
            }
            const tip = tt.controlIcon?.tooltip;
            if (tip && !tip.destroyed)
            {
                try { tip.updateText?.(false); } catch { /* ignore */ }
            }
            tt.renderFlags?.set?.({ refreshElevation: true });
            try { refreshCenterLabel(tt); } catch { /* ignore */ }
        }
        try { canvas.app?.renderer?.render?.(canvas.stage); } catch { /* ignore */ }
    }
    _showElevLabel(_pendingElevation);
    return true;
}

function _reset()
{
    _pendingElevation = null;
    _pendingCloneDoc = null;
    _pendingOriginalId = null;
    _hideElevLabel();
}

// Move-drag label: projected THT auto-elevation, or the pending Q/E value.
function _moveDragTick()
{
    if (_baseProvider)
        return;
    const previews = canvas.templates?.preview?.children ?? [];
    const clone = previews.find(preview => preview?._original && !preview.destroyed);
    if (!clone?.document)
    {
        _moveOffset = 0;
        return;
    }
    let projected = null;
    if (_autoMove())
    {
        const orig = clone._original?.document;
        if (orig)
            projected = _autoMoveElevation(orig, clone.document.x, clone.document.y) + _moveOffset;
    }
    else if (_pendingElevation !== null && _pendingCloneDoc === clone.document)
        projected = _pendingElevation;
    if (projected !== null)
        _showElevLabel(projected);
}

function _onPreCreateTemplate(doc)
{
    if (_baseProvider)
    {
        doc.updateSource({ elevation: _baseProvider(doc) + _baseOffset });
        _hideElevLabel();
        return;
    }
    if (_pendingElevation === null)
        return;
    const previewDoc = canvas.templates?.preview?.children?.[0]?.document;
    if (previewDoc === _pendingCloneDoc && _pendingOriginalId === null)
    {
        doc.updateSource({ elevation: _pendingElevation });
    }
    _reset();
}

function _onPreUpdateTemplate(doc, changes)
{
    const moving = changes.x !== undefined || changes.y !== undefined;
    if (moving && _moveOffset !== 0 && _autoMove())
    {
        changes.elevation = _autoMoveElevation(doc, changes.x ?? doc.x, changes.y ?? doc.y) + _moveOffset;
        _moveOffset = 0;
        _reset();
        return;
    }
    if (_pendingElevation === null || _pendingOriginalId === null)
        return;
    if (doc.id !== _pendingOriginalId)
        return;
    changes.elevation = _pendingElevation;
    _reset();
}

export function registerDragElevation()
{
    game.keybindings.register(MODULE, "previewElevationDown", {
        name: "Lower Template Elevation (while dragging)",
        hint: "While dragging a template preview, lower its elevation by 1.",
        editable: [{ key: "KeyQ" }],
        onDown: () => _adjustPreviewElevation(-1),
        precedence: CONST.KEYBINDING_PRECEDENCE?.PRIORITY ?? 1
    });
    game.keybindings.register(MODULE, "previewElevationUp", {
        name: "Raise Template Elevation (while dragging)",
        hint: "While dragging a template preview, raise its elevation by 1.",
        editable: [{ key: "KeyE" }],
        onDown: () => _adjustPreviewElevation(1),
        precedence: CONST.KEYBINDING_PRECEDENCE?.PRIORITY ?? 1
    });
    Hooks.on("preCreateMeasuredTemplate", _onPreCreateTemplate);
    Hooks.on("preUpdateMeasuredTemplate", _onPreUpdateTemplate);
    Hooks.on("canvasReady", () =>
    {
        canvas.app.ticker.remove(_moveDragTick);
        canvas.app.ticker.add(_moveDragTick);
    });
}

import { MODULE } from "./constants.mjs";

let _pendingElevation = null;
let _pendingCloneDoc = null;
let _pendingOriginalId = null;

function _adjustPreviewElevation(delta)
{
    const previews = canvas.templates?.preview?.children ?? [];
    if (!previews.length)
    {
        _reset();
        return false;
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
        t.document.elevation = _pendingElevation;
        t.renderFlags?.set?.({ refreshElevation: true });
    }
    return true;
}

function _reset()
{
    _pendingElevation = null;
    _pendingCloneDoc = null;
    _pendingOriginalId = null;
}

function _onPreCreateTemplate(doc)
{
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
        editable: [{ key: "BracketLeft" }],
        onDown: () => _adjustPreviewElevation(-1),
        precedence: CONST.KEYBINDING_PRECEDENCE?.PRIORITY ?? 1
    });
    game.keybindings.register(MODULE, "previewElevationUp", {
        name: "Raise Template Elevation (while dragging)",
        hint: "While dragging a template preview, raise its elevation by 1.",
        editable: [{ key: "BracketRight" }],
        onDown: () => _adjustPreviewElevation(1),
        precedence: CONST.KEYBINDING_PRECEDENCE?.PRIORITY ?? 1
    });
    Hooks.on("preCreateMeasuredTemplate", _onPreCreateTemplate);
    Hooks.on("preUpdateMeasuredTemplate", _onPreUpdateTemplate);
}

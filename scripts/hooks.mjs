import {
    findContainers,
    findGrids
} from "./api.mjs";
import {
    MODULE
} from "./constants.mjs";
import {
    _getFirstOwnerId,
    callMacro,
    renderTemplateMacroConfig,
    unregisterCallbacks
} from "./templatemacro.mjs";
import { terrainTopAt } from "./elevation-cull.mjs";

export function _createHeaderButton(config, buttons)
{
    if ((config.document instanceof Item) && !config.document.hasAreaTarget)
        return;
    buttons.unshift({
        class: MODULE,
        icon: "fa-solid fa-ruler-combined",
        onclick: () => renderTemplateMacroConfig(config.document)
    });
}

export function _preUpdateToken(tokenDoc, update, context, userId)
{
    foundry.utils.setProperty(context, `${MODULE}.wasIn`, findContainers(tokenDoc));
    const coords = {
        x: tokenDoc.x,
        y: tokenDoc.y
    };
    foundry.utils.setProperty(context, `${MODULE}.coords.previous`, coords);
}

export async function _updateToken(tokenDoc, update, context, userId)
{
    const hasX = foundry.utils.hasProperty(update, "x");
    const hasY = foundry.utils.hasProperty(update, "y");
    if (!hasX && !hasY)
        return;

    // skip intermediate ruler segments, only process the final one
    if (context.rulerSegment && !context.lastRulerSegment)
        return;

    // Move any templates attached to this token by the same delta.
    const previousCoords2 = foundry.utils.getProperty(context, `${MODULE}.coords.previous`);
    if (previousCoords2)
    {
    // tokenDoc.x/y is unreliable during animation, prefer update data
        const targetX = update.x ?? previousCoords2.x;
        const targetY = update.y ?? previousCoords2.y;
        const dx = targetX - previousCoords2.x;
        const dy = targetY - previousCoords2.y;
        if (dx !== 0 || dy !== 0)
        {
            const attached = tokenDoc.parent.templates.filter(t => t.getFlag(MODULE, "attachedTokenId") === tokenDoc.id);
            if (attached.length > 0)
            {
                const token = tokenDoc.object;

                // Visually follow the token's slide animation frame by frame
                const anim = CanvasAnimation.getAnimation(token?.animationName);
                if (anim && token && anim.state !== -1)
                {
                    const startPositions = attached.map(t => ({ id: t.id, x: t.x, y: t.y }));
                    const tickFn = () =>
                    {
                        const currentDx = token.document.x - previousCoords2.x;
                        const currentDy = token.document.y - previousCoords2.y;
                        for (const sp of startPositions)
                        {
                            const tObj = canvas.templates.get(sp.id)?.object;
                            if (tObj)
                                tObj.position.set(sp.x + currentDx, sp.y + currentDy);
                        }
                    };
                    canvas.app.ticker.add(tickFn);
                    await anim.promise;
                    canvas.app.ticker.remove(tickFn);
                }

                // Persist final positions using the known delta from update data
                const updates = attached.map(t => ({ _id: t.id, x: t.x + dx, y: t.y + dy }));
                await tokenDoc.parent.updateEmbeddedDocuments("MeasuredTemplate", updates);
            }
        }
    }
    // tokenDoc.x/y may be stale during ruler segments; prefer update coords like finalPos below.
    const coords = {
        x: update.x ?? tokenDoc.x,
        y: update.y ?? tokenDoc.y
    };
    const previousCoords = foundry.utils.getProperty(context, `${MODULE}.coords.previous`);

    const {
        id: gmId
    } = game.users.find(user =>
    {
        return user.active && user.isGM;
    }) ?? {};
    // ruler segments may not have synced tokenDoc.x/y yet, so prefer update coords
    const finalPos = (update.x !== undefined || update.y !== undefined)
        ? { x: update.x ?? tokenDoc.x, y: update.y ?? tokenDoc.y }
        : null;
    const current = findContainers(tokenDoc, finalPos);
    const previous = foundry.utils.getProperty(context, `${MODULE}.wasIn`) ?? [];
    const leaving = previous.filter(p => !current.includes(p));
    const entering = current.filter(p => !previous.includes(p));
    const staying = previous.filter(p => current.includes(p));
    // Walk the full v13 movement path so multi-waypoint drags detect all crossed templates,
    // not just the last ruler segment. Use the token's real center (hex-aware) so the ray
    // lands inside the correct cell instead of clipping neighbouring hexes.
    const toCenter = (pt) =>
    {
        const c = tokenDoc.getCenterPoint?.({ x: pt.x, y: pt.y });
        if (c) return c;
        const sx = canvas.grid.sizeX ?? canvas.grid.size;
        const sy = canvas.grid.sizeY ?? canvas.grid.size;
        return { x: pt.x + (tokenDoc.width ?? 1) * sx / 2, y: pt.y + (tokenDoc.height ?? 1) * sy / 2 };
    };
    const pathPoints = [];
    const origin = tokenDoc.movement?.origin;
    const passed = tokenDoc.movement?.passed?.waypoints;
    if (origin && Array.isArray(passed) && passed.length > 0)
    {
        pathPoints.push(toCenter(origin));
        for (const wp of passed)
            pathPoints.push(toCenter(wp));
    }
    else if (previousCoords)
    {
        pathPoints.push(toCenter(previousCoords), toCenter(coords));
    }
    const through = tokenDoc.parent.templates.reduce((acc, templateDoc) =>
    {
        const cellSet = new Set();
        const cellsList = [];
        for (let i = 1; i < pathPoints.length; i++)
        {
            const cells = findGrids(pathPoints[i - 1], pathPoints[i], templateDoc, tokenDoc.elevation ?? 0);
            for (const c of cells)
            {
                const k = `${c.x},${c.y}`;
                if (cellSet.has(k)) continue;
                cellSet.add(k);
                cellsList.push(c);
            }
        }
        if (!cellsList.length)
            return acc;
        acc.push({
            templateId: templateDoc.id,
            cells: cellsList
        });
        return acc;
    }, []);
    foundry.utils.setProperty(context, `${MODULE}.through`, through);

    if (globalThis._tmDebug)
        _drawTmDebug(pathPoints, through);

    const enteredAndLeft = through.filter(t =>
    {
        return !leaving.includes(t.templateId) && !entering.includes(t.templateId) && !staying.includes(t.templateId);
    });

    const tokenId = tokenDoc.id;
    const macroContext = {
        gmId,
        userId,
        tokenId,
        coords: {
            previous: foundry.utils.deepClone(previousCoords),
            current: coords
        },
        hook: context
    };

    function call(id, trigger)
    {
        const templateDoc = tokenDoc.parent.templates.get(id);
        if (!templateDoc)
            return Promise.resolve();
        return callMacro(templateDoc, trigger, macroContext) ?? Promise.resolve();
    }
    // Traversal: await whenEntered before whenLeft so apply-on-enter completes before remove-on-leave runs.
    for (const { templateId } of enteredAndLeft)
    {
        await call(templateId, "whenEntered");
        await call(templateId, "whenThrough");
        await call(templateId, "whenLeft");
    }
    leaving.forEach(templateId => call(templateId, "whenLeft"));
    entering.forEach(templateId => call(templateId, "whenEntered"));
    staying.forEach(templateId => call(templateId, "whenStaying"));
}

// dnd5e: stamp macros from the originating item onto the template.
export function _preCreateTemplate(templateDoc, templateData, context, userId)
{
    const item = fromUuidSync(templateDoc.flags.dnd5e?.origin || "");
    if (!item)
        return;
    const flagData = item.flags[MODULE] ?? {};
    templateDoc.updateSource({
        [`flags.${MODULE}`]: flagData
    });
}

export function _createTemplate(templateDoc, context, userId)
{
    const {
        id: gmId
    } = game.users.find(user =>
    {
        return user.active && user.isGM;
    }) ?? {};
    const current = {
        x: templateDoc.x,
        y: templateDoc.y
    };
    const macroContext = {
        gmId,
        userId,
        coords: {
            previous: null,
            current
        }
    };
    callMacro(templateDoc, "whenCreated", macroContext);
}

export function _deleteTemplate(templateDoc, context, userId)
{
    const {
        id: gmId
    } = game.users.find(user =>
    {
        return user.active && user.isGM;
    }) ?? {};
    const current = {
        x: templateDoc.x,
        y: templateDoc.y
    };
    const macroContext = {
        gmId,
        userId,
        coords: {
            previous: null,
            current
        }
    };
    callMacro(templateDoc, "whenDeleted", macroContext);
    unregisterCallbacks(templateDoc.id);
}

export function _preUpdateTemplate(templateDoc, update, context, userId)
{
    foundry.utils.setProperty(context, `${MODULE}.wasHidden`, templateDoc.hidden);
    const coords = {
        x: templateDoc.x,
        y: templateDoc.y
    };
    foundry.utils.setProperty(context, `${MODULE}.coords.previous`, coords);

    // THT auto-elevation: shift elevation by the change in terrain top between old and new position
    const auto = game.settings.get(MODULE, "thtAutoElevation");
    const movingX = update.x !== undefined && update.x !== templateDoc.x;
    const movingY = update.y !== undefined && update.y !== templateDoc.y;
    if (auto && (movingX || movingY) && update.elevation === undefined && globalThis.terrainHeightTools)
    {
        const oldTop = terrainTopAt(templateDoc.x, templateDoc.y);
        const newTop = terrainTopAt(update.x ?? templateDoc.x, update.y ?? templateDoc.y);
        const delta = newTop - oldTop;
        if (delta !== 0)
            update.elevation = (templateDoc.elevation ?? 0) + delta;
    }
}
export function _updateTemplate(templateDoc, update, context, userId)
{
    const wasHidden = foundry.utils.getProperty(context, `${MODULE}.wasHidden`);
    const isHidden = templateDoc.hidden;
    const hide = !wasHidden && isHidden;
    const show = wasHidden && !isHidden;

    const previous = foundry.utils.getProperty(context, `${MODULE}.coords.previous`);
    const current = {
        x: templateDoc.x,
        y: templateDoc.y
    };
    const hasX = foundry.utils.hasProperty(update, "x");
    const hasY = foundry.utils.hasProperty(update, "y");
    const moved = hasX || hasY;

    const {
        id: gmId
    } = game.users.find(user =>
    {
        return user.active && user.isGM;
    }) ?? {};
    const macroContext = {
        gmId,
        userId,
        coords: {
            previous,
            current
        }
    };
    if (hide)
        callMacro(templateDoc, "whenHidden", macroContext);
    if (show)
        callMacro(templateDoc, "whenRevealed", macroContext);
    if (moved)
        callMacro(templateDoc, "whenMoved", macroContext);
}

export function _preUpdateCombat(combat, update, context, userId)
{
    const was = combat.started;
    context[MODULE] = {
        was
    };
}
export function _updateCombat(combat, update, context, userId)
{
    if ((context.direction === -1) || !combat.isActive)
        return;

    const prev = context[MODULE]?.was ? canvas.scene.tokens.get(combat.previous?.tokenId) : null;
    const curr = canvas.scene.tokens.get(combat.current?.tokenId);

    const coords = {};
    if (prev)
        coords.previous = {
            x: prev.x,
            y: prev.y,
            tokenId: prev.id
        };
    if (curr)
        coords.current = {
            x: curr.x,
            y: curr.y,
            tokenId: curr.id
        };

    const {
        id: gmId
    } = game.users.find(u => u.active && u.isGM) ?? {};
    const macroContext = {};
    if (prev)
        macroContext.prev = {
            gmId,
            userId: _getFirstOwnerId(prev),
            tokenId: prev.id
        };
    if (curr)
        macroContext.curr = {
            gmId,
            userId: _getFirstOwnerId(curr),
            tokenId: curr.id
        };

    const containers = {};
    if (prev)
        containers.previous = findContainers(prev);
    if (curr)
        containers.current = findContainers(curr);

    for (const id of containers.previous ?? [])
    {
        const template = canvas.scene.templates.get(id);
        callMacro(template, "whenTurnEnd", macroContext.prev);
    }

    for (const id of containers.current ?? [])
    {
        const template = canvas.scene.templates.get(id);
        callMacro(template, "whenTurnStart", macroContext.curr);
    }
}

function _drawTmDebug(pathPoints, through)
{
    const gs = canvas.grid.size;
    const g = new PIXI.Graphics();
    canvas.controls.addChild(g);

    g.lineStyle(2, 0xff00ff);
    for (let i = 0; i < pathPoints.length; i++)
    {
        const p = pathPoints[i];
        const c = canvas.grid.getCenterPoint({ x: p.x, y: p.y });
        g.drawCircle(p.x, p.y, 8);
        g.lineStyle(2, 0xffaa00);
        g.drawCircle(c.x, c.y, 14);
        g.lineStyle(2, 0xff00ff);
        if (i > 0)
        {
            const prev = pathPoints[i - 1];
            g.moveTo(prev.x, prev.y);
            g.lineTo(p.x, p.y);
        }
    }

    g.lineStyle(2, 0x00ffff);
    for (const t of through)
        for (const c of t.cells)
            g.drawRect(c.x, c.y, gs, gs);

    setTimeout(() =>
    {
        if (!g.destroyed)
        {
            g.parent?.removeChild(g);
            g.destroy();
        }
    }, 4000);
}

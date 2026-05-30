// Band + per-cell terrain cull helpers for elevation-gated templates.

export function isInElevationBand(tokenElev, baseElev, range)
{
    const top = baseElev + Math.floor(range ?? 0);
    return tokenElev >= baseElev && tokenElev <= top;
}

export function cellOccludedByTerrain(worldX, worldY, baseElev, range)
{
    const tht = globalThis.terrainHeightTools;
    if (!tht)
        return false;
    let shapes = [];
    try { shapes = tht.getShapesAtPoint?.(worldX, worldY) ?? []; }
    catch { return false; }
    const ceiling = baseElev + Math.floor(range ?? 0);
    for (const s of shapes)
    {
        const typeId = s?.terrainTypeId ?? s?.terrainType?.id ?? s?.shape?.terrainTypeId ?? null;
        let type = null;
        if (typeId)
        {
            try { type = tht.getTerrainType?.({ id: typeId }); }
            catch { type = null; }
        }
        if (!type && s?.terrainType?.isSolid !== undefined)
            type = s.terrainType;
        if (!type?.isSolid || !type?.usesHeight)
            continue;
        const sBottom = s?.elevation ?? s?.bottom ?? s?.shape?.elevation ?? 0;
        const sTop = sBottom + (s?.height ?? s?.shape?.height ?? 0);
        if (sTop > ceiling)
            return true;
    }
    return false;
}

export function isInsideInnerCircle(templateDoc, worldX, worldY)
{
    if (templateDoc?.t !== "circle")
        return false;
    const inner = Number(templateDoc.getFlag?.("templatemacro", "innerRadius") ?? 0);
    if (inner <= 0)
        return false;
    const shape = new PIXI.Polygon(canvas.grid.getCircle({ x: 0, y: 0 }, inner));
    const lx = worldX - templateDoc.x;
    const ly = worldY - templateDoc.y;
    for (let dx = -0.5; dx <= 0.5; dx += 0.5)
    {
        for (let dy = -0.5; dy <= 0.5; dy += 0.5)
        {
            if (shape.contains(lx + dx, ly + dy))
                return true;
        }
    }
    return false;
}

export function isTemplateElevationGated(templateDoc)
{
    return !!templateDoc?.getFlag?.("templatemacro", "elevationGated");
}

export function terrainTopAt(worldX, worldY)
{
    const tht = globalThis.terrainHeightTools;
    if (!tht)
        return 0;
    let shapes = [];
    try { shapes = tht.getShapesAtPoint?.(worldX, worldY) ?? []; }
    catch { return 0; }
    let topMax = 0;
    for (const s of shapes)
    {
        const typeId = s?.terrainTypeId ?? s?.terrainType?.id ?? s?.shape?.terrainTypeId ?? null;
        let type = null;
        if (typeId)
        {
            try { type = tht.getTerrainType?.({ id: typeId }); }
            catch { type = null; }
        }
        if (!type && s?.terrainType?.isSolid !== undefined)
            type = s.terrainType;
        if (!type?.isSolid || !type?.usesHeight)
            continue;
        const sBottom = s?.elevation ?? s?.bottom ?? s?.shape?.elevation ?? 0;
        const sTop = sBottom + (s?.height ?? s?.shape?.height ?? 0);
        if (sTop > topMax)
            topMax = sTop;
    }
    return topMax;
}

export function getTemplateElevationBand(templateDoc)
{
    const base = templateDoc?.elevation ?? 0;
    const manual = !!templateDoc?.getFlag?.("templatemacro", "elevationRangeManual");
    const range = manual
        ? (templateDoc?.getFlag?.("templatemacro", "elevationRange") ?? 0)
        : (templateDoc?.distance ?? 0);
    return { base, range };
}

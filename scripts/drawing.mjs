// Dashed-polyline drawing. Dashes flow across vertices so corners look natural.

/**
 * Draw a dashed outline through a sequence of points.
 * Caller is responsible for calling `lineStyle` before this.
 * @param {PIXI.Graphics} graphics
 * @param {{x:number,y:number}[]} points  Polygon vertices. The polygon is closed back to points[0].
 * @param {{ dashSize?:number, gapSize?:number, offset?:number, closed?:boolean }} options
 */
export function drawDashedPolygon(graphics, points, { dashSize = 15, gapSize = 10, offset = 0, closed = true } = {})
{
    if (!points?.length)
        return;

    const period = dashSize + gapSize;
    const norm = ((offset % period) + period) % period;
    let dash = true;
    let remaining = dashSize - norm;
    if (remaining <= 0) { dash = false; remaining += gapSize; }

    const last = closed ? points.length : points.length - 1;
    let { x: curX, y: curY } = points[0];

    for (let i = 0; i < last; i++)
    {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len <= Number.EPSILON)
            continue;
        const cos = dx / len, sin = dy / len;

        let drawn = 0;
        while (drawn < len - Number.EPSILON)
        {
            if (remaining <= 0) { dash = !dash; remaining = dash ? dashSize : gapSize; }
            const step = Math.min(len - drawn, remaining);
            const sx = a.x + cos * drawn, sy = a.y + sin * drawn;
            const ex = a.x + cos * (drawn + step), ey = a.y + sin * (drawn + step);
            if (dash)
            {
                graphics.moveTo(sx, sy);
                graphics.lineTo(ex, ey);
            }
            drawn += step;
            remaining -= step;
        }
        curX = b.x; curY = b.y;
    }
}

/** Solid polyline through the points (closed polygon if `closed`). */
export function drawPolygon(graphics, points, { closed = true } = {})
{
    if (!points?.length)
        return;
    graphics.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++)
        graphics.lineTo(points[i].x, points[i].y);
    if (closed)
        graphics.lineTo(points[0].x, points[0].y);
}

/**
 * Convert a PIXI shape (Polygon/Circle/Rectangle) to a flat [{x,y},...] outline polygon.
 * Used to feed dashed-outline rendering for any template shape.
 * @param {PIXI.Polygon|PIXI.Circle|PIXI.Rectangle|PIXI.Ellipse} shape
 * @param {number} segments  Subdivisions for curved shapes.
 * @returns {{x:number,y:number}[]}
 */
export function shapeToPoints(shape, segments = 64)
{
    if (!shape)
        return [];

    if (shape instanceof PIXI.Polygon)
    {
        const out = [];
        const arr = shape.points;
        for (let i = 0; i < arr.length; i += 2)
            out.push({ x: arr[i], y: arr[i + 1] });
        return out;
    }

    if (shape instanceof PIXI.Circle)
    {
        const out = [];
        for (let i = 0; i < segments; i++)
        {
            const t = (i / segments) * Math.PI * 2;
            out.push({ x: shape.x + Math.cos(t) * shape.radius, y: shape.y + Math.sin(t) * shape.radius });
        }
        return out;
    }

    if (shape instanceof PIXI.Rectangle)
    {
        return [
            { x: shape.x, y: shape.y },
            { x: shape.x + shape.width, y: shape.y },
            { x: shape.x + shape.width, y: shape.y + shape.height },
            { x: shape.x, y: shape.y + shape.height }
        ];
    }

    if (shape instanceof PIXI.Ellipse)
    {
        const out = [];
        for (let i = 0; i < segments; i++)
        {
            const t = (i / segments) * Math.PI * 2;
            out.push({ x: shape.x + Math.cos(t) * shape.width, y: shape.y + Math.sin(t) * shape.height });
        }
        return out;
    }

    return [];
}

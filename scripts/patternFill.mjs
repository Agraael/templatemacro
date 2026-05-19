import { LINE_TYPES } from "./constants.mjs";
import { sampleColorAnimation } from "./color-animation.mjs";
import { drawDashedPolygon } from "./drawing.mjs";
import { cellOccludedByTerrain, getTemplateElevationBand, isTemplateElevationGated } from "./elevation-cull.mjs";

function _terrainCullFilterFor(templateDoc) {
  if (!isTemplateElevationGated(templateDoc) || !globalThis.terrainHeightTools) return null;
  const { base, range } = getTemplateElevationBand(templateDoc);
  return (cx, cy) => !cellOccludedByTerrain(cx, cy, base, range);
}

function _innerCircleShape(templateDoc) {
  if (templateDoc?.t !== "circle") return null;
  const inner = Number(templateDoc.getFlag?.(MODULE, "innerRadius") ?? 0);
  if (inner <= 0) return null;
  return new PIXI.Polygon(canvas.grid.getCircle({ x: 0, y: 0 }, inner));
}

function _innerCircleFilterFor(templateDoc) {
  const shape = _innerCircleShape(templateDoc);
  if (!shape) return null;
  const ox = templateDoc.x;
  const oy = templateDoc.y;
  // mirror Foundry's outer-circle 9-sample inclusion so the hole sizes the same way the outer does
  return (cx, cy) => {
    for (let dx = -0.5; dx <= 0.5; dx += 0.5) {
      for (let dy = -0.5; dy <= 0.5; dy += 0.5) {
        if (shape.contains(cx - ox + dx, cy - oy + dy)) return false;
      }
    }
    return true;
  };
}

function _composeFilters(...filters) {
  const live = filters.filter(Boolean);
  if (!live.length) return null;
  return (cx, cy) => live.every(f => f(cx, cy));
}

function _cellFilterFor(templateDoc) {
  return _composeFilters(_terrainCullFilterFor(templateDoc), _innerCircleFilterFor(templateDoc));
}

// templates with the same non-empty label and matching visual fingerprint merge:
// their cells render once each, their shared edges suppress, joined as a single zone.
function _mergeFingerprint(doc) {
  const label = doc.getFlag?.("templatemacro", "centerLabel") ?? "";
  if (!label) return null;
  const flag = (k, fb) => doc.getFlag?.("templatemacro", k) ?? fb;
  return JSON.stringify({
    label,
    lineType: flag("lineType", 1),
    lineColor: flag("lineColor", doc.borderColor),
    lineWidth: flag("lineWidth", 2),
    lineOpacity: flag("lineOpacity", 0.5),
    lineDashSize: flag("lineDashSize", 15),
    lineGapSize: flag("lineGapSize", 10),
    fillType: flag("fillType", 1),
    fillColor: flag("fillColor", doc.fillColor),
    fillOpacity: flag("fillOpacity", 0.25),
    fillTexture: flag("fillTexture", "")
  });
}

function _cellKey(cx, cy) {
  return `${Math.round(cx * 10)},${Math.round(cy * 10)}`;
}

// returns the set of cell keys "owned by another template" earlier in id order for the same group.
// drawing routines skip those cells (so each cell renders once per group), and edge counts include them.
function _refreshMergeSiblings(doc) {
  const fp = _mergeFingerprint(doc);
  if (!fp) return;
  const all = canvas.templates?.placeables ?? [];
  for (const t of all) {
    if (!t?.document || t.document.id === doc.id) continue;
    if (_mergeFingerprint(t.document) === fp) t.refresh?.();
  }
}

function _groupOwnership(template) {
  const fp = _mergeFingerprint(template.document);
  if (!fp) return { skipKeys: null, unionCellShapes: null };
  const all = canvas.templates?.placeables ?? [];
  const siblings = all.filter(t => t !== template && t?.document && _mergeFingerprint(t.document) === fp);
  if (!siblings.length) return { skipKeys: null, unionCellShapes: null };
  const myId = template.document.id ?? "";
  const skipKeys = new Set();
  const grid = canvas.grid;
  // build the deduped union of group cells; each physical cell appears once
  const unionMap = new Map();
  const addCells = (t, isEarlier) => {
    if (!t?.shape) return;
    let positions = [];
    try { positions = t._getGridHighlightPositions?.() ?? []; }
    catch { return; }
    const keep = _cellFilterFor(t.document);
    for (const { x, y } of positions) {
      const cx = x + (grid.sizeX / 2);
      const cy = y + (grid.sizeY / 2);
      if (keep && !keep(cx, cy)) continue;
      const key = _cellKey(cx, cy);
      if (isEarlier) skipKeys.add(key);
      if (!unionMap.has(key)) {
        const points = grid.getShape();
        for (const p of points) { p.x += cx; p.y += cy; }
        unionMap.set(key, { points });
      }
    }
  };
  for (const sib of siblings) addCells(sib, (sib.document.id ?? "") < myId);
  addCells(template, false);
  return { skipKeys, unionCellShapes: [...unionMap.values()] };
}

const MODULE = "templatemacro";
export const DEFAULT_PATTERN_TEXTURE = "modules/templatemacro/textures/hatching.png";
export const FILL_TYPES = { NONE: 0, SOLID: 1, PATTERN: 2 };

const textureCache = new Map();
const animationState = new Map();

// Labels sit on canvas.interface.grid so they render above fills, below the TemplateLayer.

const centerLabelObjects = new Map();
let _tmLabelLayer = null;

function _ensureLabelLayer() {
  if (_tmLabelLayer && !_tmLabelLayer.destroyed && _tmLabelLayer.parent) return _tmLabelLayer;
  _tmLabelLayer = new PIXI.Container();
  canvas.interface.grid.addChild(_tmLabelLayer);
  return _tmLabelLayer;
}

function _refreshCenterLabel(template) {
  const ownLabel = template.document.getFlag(MODULE, "centerLabel") ?? "";
  const fallback = game.settings.get(MODULE, "defaultCenterLabel") ?? "";
  const baseLabel = ownLabel || fallback;
  const elev = template.document.elevation ?? 0;
  const elevSuffix = (baseLabel && elev !== 0) ? ` ${elev > 0 ? "↑" : "↓"}${Math.abs(elev)}` : "";
  const label = baseLabel ? `${baseLabel}${elevSuffix}` : "";
  const labelSize = game.settings.get(MODULE, "centerLabelSize") ?? 12;

  if (!label) {
    if (template._tmCenterLabel) {
      template._tmCenterLabel.parent?.removeChild(template._tmCenterLabel);
      template._tmCenterLabel.destroy();
      template._tmCenterLabel = null;
      centerLabelObjects.delete(template.id);
    }
    return;
  }

  if (!template._tmCenterLabel) {
    const style = new PIXI.TextStyle({
      fontFamily: "Arial",
      fontSize: labelSize,
      fontWeight: "bold",
      fill: "#ffffff",
      stroke: "#000000",
      strokeThickness: 4,
      align: "center",
      dropShadow: false
    });
    template._tmCenterLabel = new PreciseText("", style);
    template._tmCenterLabel.anchor.set(0.5, 0.5);
    _ensureLabelLayer().addChild(template._tmCenterLabel);
    centerLabelObjects.set(template.id, template._tmCenterLabel);
    // drag-preview teardown does not fire deleteMeasuredTemplate
    template.once("destroyed", () => {
      const text = template._tmCenterLabel;
      if (text && !text.destroyed) {
        text.parent?.removeChild(text);
        text.destroy();
      }
      template._tmCenterLabel = null;
      centerLabelObjects.delete(template.id);
      if (template._original?._tmCenterLabel) {
        template._original._tmCenterLabel.visible = true;
      }
    });
  }

  template._tmCenterLabel.style.fontSize = labelSize;
  template._tmCenterLabel.text = label;
  template._tmCenterLabel.position.set(template.document.x, template.document.y);
  // hide the original's label while a drag clone is showing
  if (template._original?._tmCenterLabel) {
    template._original._tmCenterLabel.visible = false;
  }
}

function startAnimation(template) {
  if (animationState.has(template.id)) return;
  const state = {
    offset: { x: 0, y: 0 },
    pulseTime: 0,
    tickBound: (dt) => animationTick(template, dt)
  };
  animationState.set(template.id, state);
  canvas.app.ticker.add(state.tickBound);
}

function stopAnimation(template) {
  const state = animationState.get(template.id);
  if (!state) return;
  canvas.app.ticker.remove(state.tickBound);
  animationState.delete(template.id);
}

function animationTick(template, dt) {
  const doc = template.document;
  if (!doc || !shouldUseCustomRender(doc)) {
    stopAnimation(template);
    return;
  }

  const config = getPatternFillConfig(doc);
  const hasAnyAnim = config.fillAnimation || config.fillPulse
    || !!config.lineColorAnimation || !!config.fillColorAnimation
    || !!config.fillTextureOffsetAnimation || config.lineDashOffsetAnimation !== 0;
  if (!hasAnyAnim) {
    stopAnimation(template);
    return;
  }

  const state = animationState.get(template.id);
  if (!state) return;

  if (config.fillAnimation) {
    const speed = config.fillAnimationSpeed;
    const angle = config.fillAnimationAngle * (Math.PI / 180);
    state.offset.x += Math.cos(angle) * speed * dt;
    state.offset.y += Math.sin(angle) * speed * dt;
  }
  if (config.fillTextureOffsetAnimation) {
    state.offset.x += (config.fillTextureOffsetAnimation.x ?? 0) * dt / 60;
    state.offset.y += (config.fillTextureOffsetAnimation.y ?? 0) * dt / 60;
  }

  if (config.fillPulse) {
    const pulseSpeed = config.fillPulseSpeed ?? 1;
    state.pulseTime += pulseSpeed * dt * 0.1;
  }

  if (config.lineDashOffsetAnimation !== 0) {
    state.dashOffset = (state.dashOffset ?? 0) + config.lineDashOffsetAnimation * dt / 60;
  }

  template.renderFlags.set({ refreshGrid: true });
}

function getDashOffset(templateId) {
  return animationState.get(templateId)?.dashOffset ?? 0;
}

function getAnimationOffset(templateId) {
  return animationState.get(templateId)?.offset ?? { x: 0, y: 0 };
}

function getPulsedFillOpacity(templateId, baseOpacity) {
  const state = animationState.get(templateId);
  if (!state) return baseOpacity;
  
  const sinVal = (Math.sin(state.pulseTime) + 1) / 2;
  return 0.2 + (sinVal * (baseOpacity - 0.2));
}

async function preloadTextures() {
  if (!DEFAULT_PATTERN_TEXTURE || DEFAULT_PATTERN_TEXTURE.trim() === "") return;
  try {
    const tex = await loadTexture(DEFAULT_PATTERN_TEXTURE);
    if (tex) textureCache.set(DEFAULT_PATTERN_TEXTURE, tex);
  } catch (e) {
    console.warn(`${MODULE}|Failed to preload pattern texture:`, e);
  }
}

export function shouldUsePatternFill(templateDoc) {
  return templateDoc.getFlag(MODULE, "fillType") == FILL_TYPES.PATTERN;
}

export function shouldUseCustomRender(templateDoc) {
  const explicit = templateDoc.getFlag(MODULE, "useCustomRender");
  if (explicit === true) return true;
  if (explicit === false) return false;
  // unset on legacy templates: infer from features
  const c = getPatternFillConfig(templateDoc);
  return c.fillType === FILL_TYPES.PATTERN
    || c.lineType === LINE_TYPES.DASHED
    || c.lineType === LINE_TYPES.NONE
    || !!c.lineColorAnimation
    || !!c.fillColorAnimation
    || !!c.fillTextureOffsetAnimation
    || !!c.fillAnimation
    || !!c.fillPulse;
}

export function getPatternFillConfig(templateDoc) {
  const flag = (k, fb) => templateDoc.getFlag(MODULE, k) ?? fb;
  const legacyFillSize = templateDoc.getFlag(MODULE, "fillSize");
  const fallbackScale = legacyFillSize != null ? { x: legacyFillSize * 100, y: legacyFillSize * 100 } : { x: 100, y: 100 };
  return {
    fillType: flag("fillType", FILL_TYPES.SOLID),
    fillTexture: flag("fillTexture", DEFAULT_PATTERN_TEXTURE),
    fillTextureScale: flag("fillTextureScale", fallbackScale),
    fillTextureOffset: flag("fillTextureOffset", { x: 0, y: 0 }),
    fillTextureOffsetAnimation: flag("fillTextureOffsetAnimation", null),
    fillColor: flag("fillColor", templateDoc.fillColor ?? "#000000"),
    fillOpacity: flag("fillOpacity", 0.25),
    fillColorAnimation: flag("fillColorAnimation", null),
    borderOpacity: flag("borderOpacity", 0.5),
    lineType: flag("lineType", LINE_TYPES.SOLID),
    lineWidth: flag("lineWidth", 2),
    lineColor: flag("lineColor", templateDoc.borderColor ?? "#000000"),
    lineOpacity: flag("lineOpacity", flag("borderOpacity", 0.5)),
    lineDashSize: flag("lineDashSize", 15),
    lineGapSize: flag("lineGapSize", 10),
    lineDashOffsetAnimation: flag("lineDashOffsetAnimation", 0),
    lineColorAnimation: flag("lineColorAnimation", null),
    radiusOffset: flag("radiusOffset", 0),
    // legacy
    fillAnimation: flag("fillAnimation", false),
    fillAnimationSpeed: flag("fillAnimationSpeed", 0.5),
    fillAnimationAngle: flag("fillAnimationAngle", 0),
    fillPulse: flag("fillPulse", false),
    fillPulseSpeed: flag("fillPulseSpeed", 1)
  };
}

function sampleEffectiveColors(config) {
  const now = performance.now();
  let lineColorHex = config.lineColor;
  let lineAlpha = config.lineOpacity;
  let fillColorHex = config.fillColor;
  let fillAlpha = config.fillOpacity;
  if (config.lineColorAnimation) {
    const s = sampleColorAnimation(config.lineColorAnimation, now);
    if (s) { lineColorHex = `#${s.color.toString(16).padStart(6, "0")}`; lineAlpha = s.alpha; }
  }
  if (config.fillColorAnimation) {
    const s = sampleColorAnimation(config.fillColorAnimation, now);
    if (s) { fillColorHex = `#${s.color.toString(16).padStart(6, "0")}`; fillAlpha = s.alpha; }
  }
  return { lineColorHex, lineAlpha, fillColorHex, fillAlpha };
}

function getCachedTexture(path) {
  if (!path || path.trim() === "") return null;
  if (textureCache.has(path)) return textureCache.get(path);
  
  loadTexture(path).then(tex => {
    if (tex) textureCache.set(path, tex);
  }).catch(err => {
    console.warn(`${MODULE}|Failed to load texture:${path}`, err);
  });
  return null;
}

function drawSolidFallback(template, config) {
  const highlightLayer = canvas.interface.grid.getHighlightLayer(template.highlightId);
  if (!highlightLayer) return;

  const { lineColorHex, lineAlpha, fillColorHex, fillAlpha } = sampleEffectiveColors(config);
  const fillColor = Color.from(fillColorHex);
  const lineColor = Color.from(lineColorHex);
  const drawLine = config.lineType !== LINE_TYPES.NONE;
  const drawFill = config.fillType !== FILL_TYPES.NONE;
  const effectiveFillAlpha = config.fillPulse ? getPulsedFillOpacity(template.id, fillAlpha) : fillAlpha;

  if (canvas.grid.type === CONST.GRID_TYPES.GRIDLESS) {
    const shape = template._getGridHighlightShape?.() ?? template.shape;
    if (!shape) return;
    if (drawFill) {
      highlightLayer.beginFill(fillColor, effectiveFillAlpha);
      highlightLayer.lineStyle(0);
      highlightLayer.drawShape(shape);
      highlightLayer.endFill();
    }
    if (drawLine) {
      const gfx = _getBorderGfx(template);
      if (gfx) {
        gfx.clear();
        if (config.lineType === LINE_TYPES.SOLID) {
          gfx.lineStyle(config.lineWidth, lineColor, lineAlpha);
          gfx.drawShape(shape);
        } else if (config.lineType === LINE_TYPES.DASHED) {
          _drawDashedShapeOutline(template, shape, config, lineColor, lineAlpha, template.id);
        }
      }
    } else {
      _destroyBorderGfx(template);
    }
    return;
  }

  const grid = canvas.grid;
  const positions = template._getGridHighlightPositions();
  const cellShapes = [];
  const keep = _cellFilterFor(template.document);
  const { skipKeys, unionCellShapes } = _groupOwnership(template);

  for (const { x, y } of positions) {
    const cx = x + (grid.sizeX / 2);
    const cy = y + (grid.sizeY / 2);
    if (keep && !keep(cx, cy)) continue;
    const key = _cellKey(cx, cy);
    if (skipKeys?.has(key)) continue;
    const points = grid.getShape();
    for (const point of points) { point.x += cx; point.y += cy; }
    const shape = new PIXI.Polygon(points);
    cellShapes.push({ shape, points });

    if (drawFill) {
      highlightLayer.beginFill(fillColor, effectiveFillAlpha);
      highlightLayer.drawShape(shape);
      highlightLayer.endFill();
    }
  }

  if (drawLine) _drawCellsBorder(template, cellShapes, config, lineColor, lineAlpha, template.id, unionCellShapes);
  else _destroyBorderGfx(template);
}

function _drawCellsBorder(template, cellShapes, config, lineColor, lineAlpha, templateId, unionCellShapes = null) {
  const gfx = _getBorderGfx(template);
  if (!gfx) return;
  gfx.clear();
  const ox = template.document.x ?? 0;
  const oy = template.document.y ?? 0;
  const isDashed = config.lineType === LINE_TYPES.DASHED;
  const edgeCount = new Map();
  const tally = (points) => {
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i], p2 = points[(i + 1) % points.length];
      const x1 = Math.round(p1.x * 10) / 10, y1 = Math.round(p1.y * 10) / 10;
      const x2 = Math.round(p2.x * 10) / 10, y2 = Math.round(p2.y * 10) / 10;
      const key = `${Math.min(x1, x2)},${Math.min(y1, y2)}-${Math.max(x1, x2)},${Math.max(y1, y2)}`;
      edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
    }
  };
  // when merged into a group, tally the deduped group union; otherwise tally this template's own cells
  if (unionCellShapes) for (const { points } of unionCellShapes) tally(points);
  else for (const { points } of cellShapes) tally(points);
  gfx.lineStyle(config.lineWidth, lineColor, lineAlpha);
  const dashOffset = getDashOffset(templateId);
  for (const { points } of cellShapes) {
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i], p2 = points[(i + 1) % points.length];
      const x1 = Math.round(p1.x * 10) / 10, y1 = Math.round(p1.y * 10) / 10;
      const x2 = Math.round(p2.x * 10) / 10, y2 = Math.round(p2.y * 10) / 10;
      const key = `${Math.min(x1, x2)},${Math.min(y1, y2)}-${Math.max(x1, x2)},${Math.max(y1, y2)}`;
      if (edgeCount.get(key) !== 1) continue;
      const lp1 = { x: p1.x - ox, y: p1.y - oy };
      const lp2 = { x: p2.x - ox, y: p2.y - oy };
      if (isDashed) {
        drawDashedPolygon(gfx, [lp1, lp2], { dashSize: config.lineDashSize, gapSize: config.lineGapSize, offset: dashOffset, closed: false });
      } else {
        gfx.moveTo(lp1.x, lp1.y);
        gfx.lineTo(lp2.x, lp2.y);
      }
    }
  }
}

function _drawDashedShapeOutline(template, shape, config, lineColor, lineAlpha, templateId) {
  const gfx = _getBorderGfx(template);
  if (!gfx) return;
  gfx.clear();
  gfx.lineStyle(config.lineWidth, lineColor, lineAlpha);
  const dashOffset = getDashOffset(templateId);
  let points = [];
  if (shape instanceof PIXI.Polygon) {
    for (let i = 0; i < shape.points.length; i += 2) points.push({ x: shape.points[i], y: shape.points[i + 1] });
  } else if (shape instanceof PIXI.Circle) {
    const segs = 64;
    for (let i = 0; i < segs; i++) {
      const t = (i / segs) * Math.PI * 2;
      points.push({ x: shape.x + Math.cos(t) * shape.radius, y: shape.y + Math.sin(t) * shape.radius });
    }
  } else if (shape instanceof PIXI.Rectangle) {
    points = [
      { x: shape.x, y: shape.y },
      { x: shape.x + shape.width, y: shape.y },
      { x: shape.x + shape.width, y: shape.y + shape.height },
      { x: shape.x, y: shape.y + shape.height }
    ];
  }
  if (points.length) {
    drawDashedPolygon(gfx, points, { dashSize: config.lineDashSize, gapSize: config.lineGapSize, offset: dashOffset, closed: true });
  }
}

const _geometryCache = new Map();

function _buildGeometry(template) {
  const grid = canvas.grid;
  const positions = template._getGridHighlightPositions();
  const edgeCount = new Map();
  const hexShapes = [];

  for (const { x, y } of positions) {
    const cx = x + (grid.sizeX / 2);
    const cy = y + (grid.sizeY / 2);
    const points = grid.getShape();
    for (const point of points) { point.x += cx; point.y += cy; }

    const shape = new PIXI.Polygon(points);
    hexShapes.push({ shape, points });

    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      const x1 = Math.round(p1.x * 10) / 10;
      const y1 = Math.round(p1.y * 10) / 10;
      const x2 = Math.round(p2.x * 10) / 10;
      const y2 = Math.round(p2.y * 10) / 10;
      const edgeKey = `${Math.min(x1, x2)},${Math.min(y1, y2)}-${Math.max(x1, x2)},${Math.max(y1, y2)}`;
      edgeCount.set(edgeKey, (edgeCount.get(edgeKey) || 0) + 1);
    }
  }
  return { hexShapes, edgeCount };
}

function _getCachedGeometry(template) {
  const doc = template.document;
  const key = `${doc.x},${doc.y},${doc.distance},${doc.direction},${doc.angle},${doc.t}`;
  const cached = _geometryCache.get(template.id);
  if (cached && cached.key === key) return cached;
  const geom = _buildGeometry(template);
  geom.key = key;
  _geometryCache.set(template.id, geom);
  return geom;
}

function highlightGridWithPattern(template) {
  const doc = template.document;
  const highlightLayer = canvas.interface.grid.getHighlightLayer(template.highlightId);
  if (!highlightLayer) return;

  highlightLayer.clear();
  highlightLayer.alpha = 1;
  // keep our fill above the grid wireframe
  const parent = highlightLayer.parent;
  if (parent && parent.children[parent.children.length - 1] !== highlightLayer) {
    parent.removeChild(highlightLayer);
    parent.addChild(highlightLayer);
  }
  const config = getPatternFillConfig(doc);
  const needsAnim = config.fillAnimation || config.fillPulse
    || !!config.lineColorAnimation || !!config.fillColorAnimation
    || !!config.fillTextureOffsetAnimation || config.lineDashOffsetAnimation !== 0;
  if (needsAnim) startAnimation(template); else stopAnimation(template);

  const { lineColorHex, lineAlpha, fillColorHex, fillAlpha } = sampleEffectiveColors(config);
  const lineColor = Color.from(lineColorHex);
  const drawLine = config.lineType !== LINE_TYPES.NONE;

  if (config.fillType !== FILL_TYPES.PATTERN) {
    drawSolidFallback(template, config);
    return;
  }

  const texture = getCachedTexture(config.fillTexture);
  if (!texture) {
    drawSolidFallback(template, config);
    loadTexture(config.fillTexture).then(tex => {
      if (tex) {
        textureCache.set(config.fillTexture, tex);
        template.refresh();
      }
    }).catch(err => {
      console.warn(`${MODULE}|Failed to load texture:${config.fillTexture}`, err);
    });
    return;
  }

  const fillColor = Color.from(fillColorHex);
  const { x: scaleX, y: scaleY } = config.fillTextureScale;
  const animOffset = getAnimationOffset(template.id);
  const finalOffsetX = (config.fillTextureOffset?.x ?? 0) + animOffset.x;
  const finalOffsetY = (config.fillTextureOffset?.y ?? 0) + animOffset.y;
  const fillOpacity = config.fillPulse ? getPulsedFillOpacity(template.id, fillAlpha) : fillAlpha;
  const fillMatrix = new PIXI.Matrix(scaleX / 100, 0, 0, scaleY / 100, finalOffsetX, finalOffsetY);

  if (canvas.grid.type === CONST.GRID_TYPES.GRIDLESS) {
    const shape = template._getGridHighlightShape?.() ?? template.shape;
    if (!shape) return;
    highlightLayer.beginTextureFill({ texture, color: fillColor, alpha: fillOpacity, matrix: fillMatrix });
    highlightLayer.lineStyle(0);
    highlightLayer.drawShape(shape);
    highlightLayer.endFill();
    if (drawLine) {
      const gfx = _getBorderGfx(template);
      if (gfx) {
        gfx.clear();
        if (config.lineType === LINE_TYPES.SOLID) {
          gfx.lineStyle(config.lineWidth, lineColor, lineAlpha);
          gfx.drawShape(shape);
        } else if (config.lineType === LINE_TYPES.DASHED) {
          _drawDashedShapeOutline(template, shape, config, lineColor, lineAlpha, template.id);
        }
      }
    } else {
      _destroyBorderGfx(template);
    }
    return;
  }

  const { hexShapes } = _getCachedGeometry(template);
  const keep = _cellFilterFor(template.document);
  const { skipKeys, unionCellShapes } = _groupOwnership(template);
  const cellShapes = hexShapes
    .filter(({ points }) => {
      let sx = 0, sy = 0;
      for (const p of points) { sx += p.x; sy += p.y; }
      const cx = sx / points.length, cy = sy / points.length;
      if (keep && !keep(cx, cy)) return false;
      if (skipKeys?.has(_cellKey(cx, cy))) return false;
      return true;
    })
    .map(({ shape, points }) => ({ shape, points }));

  for (const { shape } of cellShapes) {
    highlightLayer.beginTextureFill({ texture, color: fillColor, alpha: fillOpacity, matrix: fillMatrix });
    highlightLayer.drawShape(shape);
    highlightLayer.endFill();
  }

  if (drawLine) _drawCellsBorder(template, cellShapes, config, lineColor, lineAlpha, template.id, unionCellShapes);
  else _destroyBorderGfx(template);
}

function wrapHighlightGrid(wrapped, ...args) {
  if (shouldUseCustomRender(this.document)) {
    highlightGridWithPattern(this);
    return;
  }
  _destroyBorderGfx(this);
  return wrapped.call(this, ...args);
}

const DEFAULT_CUSTOM_CONTROL_ICON = "modules/templatemacro/assets/holosphere.svg";

function _suppressNativeShape(template) {
  if (!template?.template) return;
  const useCustom = !!template.document?.getFlag(MODULE, "useCustomRender");
  template.template.alpha = useCustom ? 0 : 1;
}

function _getBorderGfx(template) {
  if (!template) return null;
  if (template._tmacBorder && !template._tmacBorder.destroyed) return template._tmacBorder;
  const gfx = new PIXI.Graphics();
  template._tmacBorder = gfx;
  template.addChild(gfx);
  return gfx;
}

function _destroyBorderGfx(template) {
  const gfx = template?._tmacBorder;
  if (!gfx) return;
  gfx.parent?.removeChild(gfx);
  if (!gfx.destroyed) gfx.destroy();
  template._tmacBorder = null;
}

async function _applyCustomControlIcon(template) {
  if (!template?.controlIcon) return;
  if (!template.document.getFlag(MODULE, "useCustomRender")) return;
  const entryIcon = template.document.getFlag(MODULE, "libraryEntryIcon") || "";
  // FA classes can't drive a PIXI sprite, fall back when the entry icon is one
  const path = (entryIcon && !entryIcon.startsWith("fa-")) ? entryIcon : DEFAULT_CUSTOM_CONTROL_ICON;
  const tex = textureCache.get(path) ?? await loadTexture(path);
  if (tex) textureCache.set(path, tex);
  const iconSprite = template.controlIcon?.icon ?? template.controlIcon?.children?.find?.(c => c instanceof PIXI.Sprite);
  if (tex && iconSprite && !iconSprite.destroyed) {
    iconSprite.texture = tex;
  }
}

export function registerPatternFillHooks() {
  preloadTextures();

  if (game.modules.get("lib-wrapper")?.active) {
    libWrapper.register(MODULE, "MeasuredTemplate.prototype.highlightGrid", wrapHighlightGrid, "MIXED");
  } else {
    const originalHighlightGrid = MeasuredTemplate.prototype.highlightGrid;
    MeasuredTemplate.prototype.highlightGrid = function(...args) {
      return shouldUseCustomRender(this.document) ? highlightGridWithPattern(this) : originalHighlightGrid.call(this, ...args);
    };
  }

  Hooks.on("updateMeasuredTemplate", (doc, changes) => {
    if (changes.flags?.templatemacro || "x" in changes || "y" in changes || "distance" in changes
        || "direction" in changes || "angle" in changes || "width" in changes) {
      const template = doc.object;
      if (!template) return;
      const useCustomChanged = "useCustomRender" in (changes.flags?.templatemacro ?? {});
      setTimeout(() => {
        useCustomChanged ? template.draw() : template.refresh();
        _refreshMergeSiblings(doc);
      }, 50);
    }
  });

  Hooks.on("createMeasuredTemplate", (doc) => setTimeout(() => _refreshMergeSiblings(doc), 80));

  Hooks.on("deleteMeasuredTemplate", (doc) => {
    _geometryCache.delete(doc.id);
    const state = animationState.get(doc.id);
    if (state) {
      canvas.app.ticker.remove(state.tickBound);
      animationState.delete(doc.id);
    }
    const text = centerLabelObjects.get(doc.id);
    if (text) {
      text.parent?.removeChild(text);
      if (!text.destroyed) text.destroy();
      centerLabelObjects.delete(doc.id);
    }
    if (doc.object) _destroyBorderGfx(doc.object);
    setTimeout(() => _refreshMergeSiblings(doc), 50);
  });

  Hooks.on("drawMeasuredTemplate", (template) => {
    _refreshCenterLabel(template);
    _applyCustomControlIcon(template);
    _suppressNativeShape(template);
  });

  Hooks.on("refreshMeasuredTemplate", (template) => {
    _suppressNativeShape(template);
    _refreshCenterLabel(template);
  });

  Hooks.on("canvasReady", async () => {
    _tmLabelLayer = null;
    centerLabelObjects.clear();
    _geometryCache.clear();
    const templates = canvas.templates?.placeables ?? [];
    const texturesToLoad = new Set([DEFAULT_PATTERN_TEXTURE]);
    
    for (const template of templates) {
      if (shouldUsePatternFill(template.document)) {
        const config = getPatternFillConfig(template.document);
        if (config.fillTexture) texturesToLoad.add(config.fillTexture);
      }
    }

    const loadPromises = [];
    for (const texturePath of texturesToLoad) {
      if (texturePath && !textureCache.has(texturePath)) {
        loadPromises.push(
          loadTexture(texturePath)
            .then(tex => { if (tex) textureCache.set(texturePath, tex); })
            .catch(err => { console.warn(`${MODULE}|Failed to preload:${texturePath}`, err); })
        );
      }
    }

    if (loadPromises.length > 0) await Promise.all(loadPromises);
    
    for (const template of templates) {
      if (shouldUsePatternFill(template.document)) template.refresh();
    }
  });
}

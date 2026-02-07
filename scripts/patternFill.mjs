const MODULE = "templatemacro";
export const DEFAULT_PATTERN_TEXTURE = "modules/templatemacro/textures/hatching.png";
export const FILL_TYPES = { NONE: 0, SOLID: 1, PATTERN: 2 };

const textureCache = new Map();
const animationState = new Map();

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
  if (!doc || !shouldUsePatternFill(doc)) {
    stopAnimation(template);
    return;
  }

  const config = getPatternFillConfig(doc);
  if (!config.fillAnimation && !config.fillPulse) {
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

  if (config.fillPulse) {
    const pulseSpeed = config.fillPulseSpeed ?? 1;
    state.pulseTime += pulseSpeed * dt * 0.1;
  }

  template.renderFlags.set({ refreshGrid: true });
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

export function getPatternFillConfig(templateDoc) {
  const fillSize = templateDoc.getFlag(MODULE, "fillSize") ?? 0.5;
  return {
    fillType: templateDoc.getFlag(MODULE, "fillType") ?? FILL_TYPES.SOLID,
    fillTexture: templateDoc.getFlag(MODULE, "fillTexture") ?? DEFAULT_PATTERN_TEXTURE,
    fillTextureScale: { x: fillSize * 100, y: fillSize * 100 },
    fillTextureOffset: { x: 0, y: 0 },
    fillColor: templateDoc.fillColor ?? "#000000",
    fillOpacity: templateDoc.getFlag(MODULE, "fillOpacity") ?? 0.25,
    borderOpacity: templateDoc.getFlag(MODULE, "borderOpacity") ?? 0.5,
    fillAnimation: templateDoc.getFlag(MODULE, "fillAnimation") ?? false,
    fillAnimationSpeed: templateDoc.getFlag(MODULE, "fillAnimationSpeed") ?? 0.5,
    fillAnimationAngle: templateDoc.getFlag(MODULE, "fillAnimationAngle") ?? 0,
    fillPulse: templateDoc.getFlag(MODULE, "fillPulse") ?? false,
    fillPulseSpeed: templateDoc.getFlag(MODULE, "fillPulseSpeed") ?? 1
  };
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
  const doc = template.document;
  const highlightLayer = canvas.interface.grid.getHighlightLayer(template.highlightId);
  if (!highlightLayer) return;

  const grid = canvas.grid;
  const positions = template._getGridHighlightPositions();
  const fillColor = Color.from(config.fillColor);
  const borderColor = Color.from(doc.borderColor ?? "#000000");

  for (const { x, y } of positions) {
    const cx = x + (grid.sizeX / 2);
    const cy = y + (grid.sizeY / 2);
    const points = grid.getShape();
    for (const point of points) { point.x += cx; point.y += cy; }
    
    const shape = new PIXI.Polygon(points);
    highlightLayer.beginFill(fillColor, config.fillOpacity * 0.5);
    highlightLayer.drawShape(shape);
    highlightLayer.endFill();
  }

  highlightLayer.lineStyle(2, borderColor, config.borderOpacity);
  for (const { x, y } of positions) {
    const cx = x + (grid.sizeX / 2);
    const cy = y + (grid.sizeY / 2);
    const points = grid.getShape();
    for (const point of points) { point.x += cx; point.y += cy; }
  }
}

function highlightGridWithPattern(template) {
  const doc = template.document;
  const highlightLayer = canvas.interface.grid.getHighlightLayer(template.highlightId);
  if (!highlightLayer) return;

  highlightLayer.clear();
  const config = getPatternFillConfig(doc);
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

  const grid = canvas.grid;
  const positions = template._getGridHighlightPositions();
  const fillColor = Color.from(config.fillColor);
  const { x: scaleX, y: scaleY } = config.fillTextureScale;
  
  const animOffset = getAnimationOffset(template.id);
  const finalOffsetX = (config.fillTextureOffset?.x ?? 0) + animOffset.x;
  const finalOffsetY = (config.fillTextureOffset?.y ?? 0) + animOffset.y;

  if (config.fillAnimation || config.fillPulse) {
    startAnimation(template);
  } else {
    stopAnimation(template);
  }

  const borderColor = Color.from(doc.borderColor ?? "#000000");
  const fillOpacity = config.fillPulse ? getPulsedFillOpacity(template.id, config.fillOpacity) : config.fillOpacity;

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

  for (const { shape } of hexShapes) {
    highlightLayer.beginTextureFill({
      texture,
      color: fillColor,
      alpha: fillOpacity,
      matrix: new PIXI.Matrix(scaleX / 100, 0, 0, scaleY / 100, finalOffsetX, finalOffsetY)
    });
    highlightLayer.drawShape(shape);
    highlightLayer.endFill();
  }

  highlightLayer.lineStyle(2, borderColor, config.borderOpacity);
  for (const { points } of hexShapes) {
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      const x1 = Math.round(p1.x * 10) / 10;
      const y1 = Math.round(p1.y * 10) / 10;
      const x2 = Math.round(p2.x * 10) / 10;
      const y2 = Math.round(p2.y * 10) / 10;
      const edgeKey = `${Math.min(x1, x2)},${Math.min(y1, y2)}-${Math.max(x1, x2)},${Math.max(y1, y2)}`;
      
      if (edgeCount.get(edgeKey) === 1) {
        highlightLayer.moveTo(p1.x, p1.y);
        highlightLayer.lineTo(p2.x, p2.y);
      }
    }
  }
}

function wrapHighlightGrid(wrapped, ...args) {
  if (shouldUsePatternFill(this.document)) {
    highlightGridWithPattern(this);
    return;
  }
  return wrapped.call(this, ...args);
}

function onRenderMeasuredTemplateConfig(app, html, data) {
  const doc = app.document;
  const currentFillType = doc.getFlag(MODULE, "fillType") ?? FILL_TYPES.SOLID;
  const currentFillTexture = doc.getFlag(MODULE, "fillTexture") || DEFAULT_PATTERN_TEXTURE;
  const currentFillSize = doc.getFlag(MODULE, "fillSize") ?? 0.5;
  const currentFillOpacity = doc.getFlag(MODULE, "fillOpacity") ?? 0.25;
  const currentBorderOpacity = doc.getFlag(MODULE, "borderOpacity") ?? 0.5;
  const currentFillPulse = doc.getFlag(MODULE, "fillPulse") ?? false;
  const currentFillPulseSpeed = doc.getFlag(MODULE, "fillPulseSpeed") ?? 1;
  const isPattern = currentFillType == FILL_TYPES.PATTERN;

  const fillTypeHtml = `
    <div class="form-group">
      <label>Fill Type</label>
      <select name="flags.templatemacro.fillType" data-dtype="Number" id="templatemacro-fillType">
        <option value="${FILL_TYPES.SOLID}" ${currentFillType == FILL_TYPES.SOLID ? "selected" : ""}>Solid</option>
        <option value="${FILL_TYPES.PATTERN}" ${currentFillType == FILL_TYPES.PATTERN ? "selected" : ""}>Pattern</option>
      </select>
    </div>`;

  const patternOptionsHtml = `
    <div class="form-group pattern-options" style="${isPattern ? '' : 'display:none;'}">
      <label>Pattern Texture</label>
      <div class="form-fields">
        <input type="text" name="flags.templatemacro.fillTexture" value="${currentFillTexture}" placeholder="path/to/texture.png">
        <button type="button" class="file-picker" data-type="imagevideo" data-target="flags.templatemacro.fillTexture" title="Browse Files"><i class="fas fa-file-import"></i></button>
      </div>
    </div>
    <div class="form-group pattern-options" style="${isPattern ? '' : 'display:none;'}">
      <label>Pattern Size</label>
      <div class="form-fields">
        <input type="range" name="flags.templatemacro.fillSize" value="${currentFillSize}" min="0.1" max="3" step="0.1"><span class="range-value">${currentFillSize}</span>
      </div>
    </div>
    <div class="form-group pattern-options" style="${isPattern ? '' : 'display:none;'}">
      <label>Fill Opacity</label>
      <div class="form-fields">
        <input type="range" name="flags.templatemacro.fillOpacity" value="${currentFillOpacity}" min="0" max="1" step="0.05"><span class="range-value">${currentFillOpacity}</span>
      </div>
    </div>
    <div class="form-group pattern-options" style="${isPattern ? '' : 'display:none;'}">
      <label>Border Opacity</label>
      <div class="form-fields">
        <input type="range" name="flags.templatemacro.borderOpacity" value="${currentBorderOpacity}" min="0" max="1" step="0.05"><span class="range-value">${currentBorderOpacity}</span>
      </div>
    </div>
    <div class="form-group pattern-options" style="${isPattern ? '' : 'display:none;'}">
      <label>Fill Animation</label>
      <input type="checkbox" name="flags.templatemacro.fillAnimation" ${doc.getFlag(MODULE, "fillAnimation") ? 'checked' : ''}>
    </div>
    <div class="form-group pattern-options" style="${isPattern ? '' : 'display:none;'}">
      <label>Animation Speed</label>
      <div class="form-fields">
        <input type="range" name="flags.templatemacro.fillAnimationSpeed" value="${doc.getFlag(MODULE, "fillAnimationSpeed") ?? 0.5}" min="0.1" max="3" step="0.1"><span class="range-value">${doc.getFlag(MODULE, "fillAnimationSpeed") ?? 0.5}</span>
      </div>
    </div>
    <div class="form-group pattern-options" style="${isPattern ? '' : 'display:none;'}">
      <label>Animation Angle</label>
      <div class="form-fields">
        <input type="range" name="flags.templatemacro.fillAnimationAngle" value="${doc.getFlag(MODULE, "fillAnimationAngle") ?? 0}" min="0" max="360" step="15"><span class="range-value">${doc.getFlag(MODULE, "fillAnimationAngle") ?? 0}°</span>
      </div>
    </div>
    <div class="form-group pattern-options" style="${isPattern ? '' : 'display:none;'}">
      <label>Fill Pulse</label>
      <input type="checkbox" name="flags.templatemacro.fillPulse" ${currentFillPulse ? 'checked' : ''}>
    </div>
    <div class="form-group pattern-options" style="${isPattern ? '' : 'display:none;'}">
      <label>Pulse Speed</label>
      <div class="form-fields">
        <input type="range" name="flags.templatemacro.fillPulseSpeed" value="${currentFillPulseSpeed}" min="0.1" max="3" step="0.1"><span class="range-value">${currentFillPulseSpeed}</span>
      </div>
    </div>`;

  const fillColorField = html.find('[name="fillColor"]').closest(".form-group");
  if (fillColorField.length) {
    fillColorField.after(fillTypeHtml + patternOptionsHtml);
  } else {
    html.find('[name="hidden"]').closest(".form-group").before(fillTypeHtml + patternOptionsHtml);
  }

  const togglePatternMode = (isPattern) => {
    html.find('.pattern-options').toggle(isPattern);
    ['texture', 'textureAlpha', 'specialEffect', 'effectTint'].forEach(f => {
      html.find(`[name="${f}"]`).closest('.form-group').toggle(!isPattern);
    });
    
    html.find('.form-group').each(function() {
      const label = $(this).find('label').text().trim().toLowerCase().replace(':', '');
      if (label.includes('special effect') || label.includes('effect tint') || label.includes('fill texture')) {
        $(this).toggle(!isPattern);
      }
    });
    app.setPosition({ height: "auto" });
  };

  togglePatternMode(isPattern);
  setTimeout(() => togglePatternMode(isPattern), 100);

  html.find('#templatemacro-fillType').on('change', function() {
    togglePatternMode(this.value == FILL_TYPES.PATTERN);
  });

  html.find('input[type="range"]').on('input', function() {
    $(this).siblings('.range-value').text(this.value);
  });

  html.find('.file-picker').on('click', async function(event) {
    event.preventDefault();
    const target = this.dataset.target;
    new FilePicker({
      type: "imagevideo",
      current: html.find(`[name="${target}"]`).val(),
      callback: path => html.find(`[name="${target}"]`).val(path)
    }).browse();
  });
  
  app.setPosition({ height: "auto" });
}

export function registerPatternFillHooks() {
  preloadTextures();
  Hooks.on("renderMeasuredTemplateConfig", onRenderMeasuredTemplateConfig);
  
  if (game.modules.get("lib-wrapper")?.active) {
    libWrapper.register(MODULE, "MeasuredTemplate.prototype.highlightGrid", wrapHighlightGrid, "MIXED");
  } else {
    const originalHighlightGrid = MeasuredTemplate.prototype.highlightGrid;
    MeasuredTemplate.prototype.highlightGrid = function(...args) {
      return shouldUsePatternFill(this.document) ? highlightGridWithPattern(this) : originalHighlightGrid.call(this, ...args);
    };
  }

  Hooks.on("updateMeasuredTemplate", (doc, changes) => {
    if (changes.flags?.templatemacro) {
      const template = doc.object;
      if (template) setTimeout(() => template.refresh(), 50);
    }
  });

  Hooks.on("deleteMeasuredTemplate", (doc) => {
    const state = animationState.get(doc.id);
    if (state) {
      canvas.app.ticker.remove(state.tickBound);
      animationState.delete(doc.id);
    }
  });

  Hooks.on("canvasReady", async () => {
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

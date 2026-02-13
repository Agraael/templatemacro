export function findGrids(A, B, templateDoc) {
  const a = canvas.grid.getCenter(A.x, A.y);
  const b = canvas.grid.getCenter(B.x, B.y);
  const ray = new Ray({ x: a[0], y: a[1] }, { x: b[0], y: b[1] });
  if (ray.distance === 0) return [];
  
  const scene = templateDoc.parent;
  const gridCenter = scene.grid.size / 2;
  const locations = new Set();
  const spacer = scene.grid.type === CONST.GRID_TYPES.SQUARE ? 1.41 : 1;
  const nMax = Math.max(Math.floor(ray.distance / (spacer * Math.min(canvas.grid.w, canvas.grid.h))), 1);
  const tMax = Array.fromRange(nMax + 1).map(t => t / nMax);
  
  let prior = null;
  for (const [i, t] of tMax.entries()){
    const { x, y } = ray.project(t);
    const [r1, c1] = canvas.grid.grid.getGridPositionFromPixels(x, y);
    if (i > 0) {
      const [r0, c0] = prior;
      if (r0 === r1 && c0 === c1) continue;
    }
    
    const [x1, y1] = canvas.grid.grid.getPixelsFromGridPosition(r1, c1);
    const contained = templateDoc.object.shape.contains(
      x1 + gridCenter - templateDoc.object.center.x,
      y1 + gridCenter - templateDoc.object.center.y
    );
    if (contained) locations.add({ x: x1, y: y1 });
    
    prior = [r1, c1];
    if (i === 0) continue;
    
    if (!canvas.grid.isNeighbor(prior[0], prior[1], r1, c1)) {
      const th = tMax[i - 1] + (0.5 / nMax);
      const { x: xhp, y: yhp } = ray.project(th);
      const [rh, ch] = canvas.grid.grid.getGridPositionFromPixels(xhp, yhp);
      const [xh, yh] = canvas.grid.grid.getPixelsFromGridPosition(rh, ch);
      const containedHalf = templateDoc.object.shape.contains(
        xh + gridCenter - templateDoc.object.center.x,
        yh + gridCenter - templateDoc.object.center.y
      );
      if (containedHalf) locations.add({ x: xh, y: yh });
    }
  }
  return [...locations];
}

export function findContained(templateDoc) {
  const { size } = templateDoc.parent.grid;
  const { x: tempx, y: tempy, object } = templateDoc;
  const contained = new Set();
  
  for (const tokenDoc of templateDoc.parent.tokens) {
    const { width, height, x: tokx, y: toky } = tokenDoc;
    const startX = width >= 1 ? 0.5 : width / 2;
    const startY = height >= 1 ? 0.5 : height / 2;
    
    for (let x = startX; x < width; x++) {
      for (let y = startY; y < width; y++) {
        const contains = object.shape.contains(tokx + x * size - tempx, toky + y * size - tempy);
        if (contains) {
          contained.add(tokenDoc.id);
          break;
        }
      }
    }
  }
  return [...contained];
}

export function findContainers(tokenDoc) {
  const { size } = tokenDoc.parent.grid;
  const { width, height, x: tokx, y: toky } = tokenDoc;
  const containers = new Set();
  
  for (const templateDoc of tokenDoc.parent.templates) {
    const { x: tempx, y: tempy, object } = templateDoc;
    const startX = width >= 1 ? 0.5 : width / 2;
    const startY = height >= 1 ? 0.5 : height / 2;
    
    for (let x = startX; x < width; x++) {
      for (let y = startY; y < width; y++) {
        const contains = object.shape.contains(tokx + x * size - tempx, toky + y * size - tempy);
        if (contains) {
          containers.add(templateDoc.id);
          break;
        }
      }
    }
  }
  return [...containers];
}


/**
 * @param {Object} options
 * @param {number} [options.x]
 * @param {number} [options.y]
 * @param {number} [options.size=1]
 * @param {string} [options.type="Blast"]
 * @param {string} [options.fillColor="#ff6400"]
 * @param {string} [options.borderColor="#000000"]
 * @param {string} [options.texture]
 * @param {Object} [options.dangerous] - If set, creates a dangerous zone that triggers ENG checks
 * @param {string} [options.dangerous.damageType="kinetic"] - Damage type (kinetic, energy, explosive, heat, burn)
 * @param {number} [options.dangerous.damageValue=5] - Amount of damage on failed check
 * @param {string[]} [options.statusEffects] - Array of status effect IDs to apply (e.g. ["impaired", "lockon"])
 * @param {Object} [hooks] - Triggers: created, deleted, moved, hidden, revealed, entered, left, through, staying, turnStart, turnEnd
 * @param {string} [hooks.trigger.command] - The macro command to execute for the specific trigger
 * @param {boolean} [hooks.trigger.asGM] - Execute the command as GM
 */
export async function placeZone(options = {}, hooks = {}) {
  // Check for specific zone types before applying general defaults
  if (options.dangerous) {
    return await placeDangerousZone({ ...options, dangerous: null }, options.dangerous.damageType, options.dangerous.damageValue, hooks);
  }
  if (options.statusEffects?.length) {
    return await placeZoneWithStatusEffect({ ...options, statusEffects: null }, options.statusEffects, hooks);
  }

  const {
    x, y,
    size = 1,
    type = "Blast",
    fillColor = "#ff6400",
    borderColor = "#000000",
    texture = null,
    fillType = 1,
    fillTexture = null,
    fillSize = 0.5,
    fillOpacity = 0.5,
    borderOpacity = 0.5,
    fillAnimation = false,
    fillAnimationSpeed = 0.5,
    fillAnimationAngle = 0,
    fillPulse = false,
    fillPulseSpeed = 1
  } = options;

  let template = null;
  const flags = _buildTemplateMacroFlags(hooks);
  const tf = {
    ...(flags.templatemacro || {}),
    fillType, fillTexture, fillSize, fillOpacity, borderOpacity,
    fillAnimation, fillAnimationSpeed, fillAnimationAngle, fillPulse, fillPulseSpeed
  };

  if (game.system.id === "lancer" && game.lancer?.canvas?.WeaponRangeTemplate) {
    try {
      const templatePreview = game.lancer.canvas.WeaponRangeTemplate.fromRange({ type, val: Math.max(size, 0) });
      template = await templatePreview.placeTemplate();
      if (template) {
        await template.update({
          fillColor,
          borderColor,
          texture: texture || template.texture,
          flags: {
            ...template.flags,
            ...flags,
            templatemacro: {
              ...template.flags.templatemacro,
              ...tf
            }
          }
        });
        await template.update({ "flags.tokenmagic.templateData.opacity": 0 });
      }
    } catch (e) {
      return null;
    }
  } else if (x !== undefined && y !== undefined) {
    const tMap = { blast: "circle", burst: "circle", circle: "circle", cone: "cone", line: "ray", ray: "ray", rect: "rect", square: "rect" };
    template = await getDocumentClass("MeasuredTemplate").create({
      t: tMap[type.toLowerCase()] || "circle",
      user: game.user.id,
      x, y,
      distance: size,
      fillColor,
      borderColor,
      texture,
      flags: {
        ...flags,
        templatemacro: tf
      }
    }, { parent: canvas.scene });
  } else {
    console.warn("placeZone requires x,y coords for non-Lancer systems.");
    return null;
  }
  return template ? { x: template.x, y: template.y, template } : null;
}


/**
 * Place a zone that applies status effects to tokens within it.
 * @param {Object} options - Standard placeZone options
 * @param {string[]} statusEffects - Array of status effect IDs (e.g. ["impaired", "lockon"])
 * @param {Object} [hooks] - Additional hooks
 */
export async function placeZoneWithStatusEffect(options = {}, statusEffects = [], hooks = {}) {
  const defaults = {
    fillType: game.settings.get("templatemacro", "statusZoneDefaultFillType"),
    fillTexture: game.settings.get("templatemacro", "statusZoneDefaultTexture"),
    fillColor: game.settings.get("templatemacro", "statusZoneDefaultFillColor"),
    fillOpacity: game.settings.get("templatemacro", "statusZoneDefaultFillOpacity"),
    fillAnimation: game.settings.get("templatemacro", "statusZoneDefaultAnimation"),
    fillPulse: game.settings.get("templatemacro", "statusZoneDefaultFillPulse"),
    borderOpacity: game.settings.get("templatemacro", "statusZoneDefaultBorderOpacity"),
    fillAnimationSpeed: game.settings.get("templatemacro", "statusZoneDefaultFillAnimationSpeed"),
    fillAnimationAngle: game.settings.get("templatemacro", "statusZoneDefaultFillAnimationAngle"),
    fillPulseSpeed: game.settings.get("templatemacro", "statusZoneDefaultFillPulseSpeed")
  };
  options = { ...defaults, ...options };
  const mkCmd = (del) => `
    const ef = ${JSON.stringify(statusEffects)};
    if (token && token.actor) {
      const a = token.actor, tid = template.id;
      for (const s of ef) {
        const e = a.effects.find(x => x.statuses.has(s) && x.getFlag("templatemacro", "sourceTemplate") === tid);
        ${del ? 
          'if (e) await e.delete();' : 
          'if (!e) { const d = CONFIG.statusEffects.find(x => x.id === s); if (d) await a.createEmbeddedDocuments("ActiveEffect", [{ ...d, statuses: [s], "flags.templatemacro.sourceTemplate": tid }]); }'
        }
      }
    }`;

  return await placeZone(options, {
    ...hooks,
    entered: {
      command: (hooks.entered?.command ? hooks.entered.command + "\n" : "") + mkCmd(false),
      asGM: true
    },
    left: {
      command: (hooks.left?.command ? hooks.left.command + "\n" : "") + mkCmd(true),
      asGM: true
    }
  });
}

export async function triggerDangerousZoneFlow(token, damageType = "kinetic", damageValue = 5) {
  if (!token?.actor) return;
  const actor = token.actor;
  const curRound = game.combat?.round || 0;
  const lastRound = actor.getFlag("templatemacro", "dangerousZoneRound");

  if (lastRound === curRound && game.combat?.started) return;

  if (game.combat?.started) {
    await actor.setFlag("templatemacro", "dangerousZoneRound", curRound);
  } else if (lastRound !== undefined) {
    await actor.unsetFlag("templatemacro", "dangerousZoneRound");
  }

  const typeMap = { kinetic: "Kinetic", energy: "Energy", explosive: "Explosive", burn: "Burn", heat: "Heat", variable: "Variable" };

  const StatRollFlow = game.lancer.flows.get("StatRollFlow");
  if (!StatRollFlow) return;

  const flow = new StatRollFlow(actor, { path: "system.eng", title: "Dangerous Terrain :: ENG" });
  const completed = await flow.begin();

  if (completed && (flow.state.data?.result?.roll?.total ?? 10) < 10) {
    const t = token.object || token;
    if (t?.setTarget) {
      t.setTarget(true, { releaseOthers: true, groupSelection: false });
    }

    const DamageRollFlow = game.lancer.flows.get("DamageRollFlow");
    const dmgFlow = new DamageRollFlow(actor.uuid, {
      title: "Dangerous Terrain",
      damage: [{ val: String(damageValue), type: typeMap[damageType.toLowerCase()] || "Kinetic" }],
      tags: [],
      hit_results: [],
      has_normal_hit: true
    });
    await dmgFlow.begin();
  }
}


/**
 * Place a dangerous zone that triggers an Engineering check.
 * Failure results in damage.
 * @param {Object} options - Standard placeZone options
 * @param {string} [damageType="kinetic"] - Damage type (kinetic, energy, explosive, heat, burn)
 * @param {number} [damageValue=5] - Amount of damage
 * @param {Object} [hooks] - Additional hooks
 */
export async function placeDangerousZone(options = {}, damageType = "kinetic", damageValue = 5, hooks = {}) {
  const defaults = {
    fillType: game.settings.get("templatemacro", "dangerZoneDefaultFillType"),
    fillTexture: game.settings.get("templatemacro", "dangerZoneDefaultTexture"),
    fillColor: game.settings.get("templatemacro", "dangerZoneDefaultFillColor"),
    fillOpacity: game.settings.get("templatemacro", "dangerZoneDefaultFillOpacity"),
    fillAnimation: game.settings.get("templatemacro", "dangerZoneDefaultAnimation"),
    fillPulse: game.settings.get("templatemacro", "dangerZoneDefaultFillPulse"),
    borderOpacity: game.settings.get("templatemacro", "dangerZoneDefaultBorderOpacity"),
    fillAnimationSpeed: game.settings.get("templatemacro", "dangerZoneDefaultFillAnimationSpeed"),
    fillAnimationAngle: game.settings.get("templatemacro", "dangerZoneDefaultFillAnimationAngle"),
    fillPulseSpeed: game.settings.get("templatemacro", "dangerZoneDefaultFillPulseSpeed")
  };
  options = { ...defaults, ...options };
  
  const useDamageTexture = game.settings.get("templatemacro", "dangerZoneUseDamageTexture");
  if (useDamageTexture && (!options.fillTexture || options.fillTexture === defaults.fillTexture)) {
      const damageTextureMap = {
          kinetic: "modules/templatemacro/textures/hatching-kinetic.png",
          energy: "modules/templatemacro/textures/hatching-energy.png",
          explosive: "modules/templatemacro/textures/hatching-explosive.png",
          heat: "modules/templatemacro/textures/hatching-heat.png",
          burn: "modules/templatemacro/textures/hatching-fire.png",
          variable: "modules/templatemacro/textures/hatching-radioactive.png"
      };
      
      const texturePath = damageTextureMap[damageType.toLowerCase()];
      if (texturePath) {
          options.fillTexture = texturePath;
      }
  }

  const cmd = `if (token) await game.modules.get('templatemacro').api.triggerDangerousZoneFlow(token, "${damageType}", ${damageValue});`;
  
  return await placeZone(options, {
    ...hooks,
    entered: {
      command: (hooks.entered?.command ? hooks.entered.command + "\n" : "") + cmd,
      asGM: false
    },
    turnStart: {
      command: (hooks.turnStart?.command ? hooks.turnStart.command + "\n" : "") + cmd,
      asGM: false
    }
  });
}

function _buildTemplateMacroFlags(hooks) {
  if (!hooks || Object.keys(hooks).length === 0) return {};
  
  const flags = { templatemacro: {} };
  const map = {
    created: "whenCreated", deleted: "whenDeleted", moved: "whenMoved",
    hidden: "whenHidden", revealed: "whenRevealed", entered: "whenEntered",
    left: "whenLeft", through: "whenThrough", staying: "whenStaying",
    turnStart: "whenTurnStart", turnEnd: "whenTurnEnd"
  };

  for (const [k, c] of Object.entries(hooks)) {
    const t = map[k] || (Object.values(map).includes(k) ? k : null);
    if (t && c.command) {
      flags.templatemacro[t] = { command: c.command, asGM: c.asGM || false };
    }
  }
  return flags;
}

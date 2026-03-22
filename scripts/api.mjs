import { MODULE } from "./constants.mjs";
import { callMacro, registerCallback, unregisterCallbacks } from "./templatemacro.mjs";

export function findGrids(A, B, templateDoc) {
  const a = canvas.grid.getCenterPoint({ x: A.x, y: A.y });
  const b = canvas.grid.getCenterPoint({ x: B.x, y: B.y });
  const ray = new Ray(a, b);
  if (ray.distance === 0) return [];
  
  const scene = templateDoc.parent;
  const gridCenter = scene.grid.size / 2;
  const locations = new Set();
  const spacer = scene.grid.type === CONST.GRID_TYPES.SQUARE ? 1.41 : 1;
  const nMax = Math.max(Math.floor(ray.distance / (spacer * Math.min(canvas.grid.sizeX, canvas.grid.sizeY))), 1);
  const tMax = Array.fromRange(nMax + 1).map(t => t / nMax);
  
  let prior = null;
  for (const [i, t] of tMax.entries()){
    const { x, y } = ray.project(t);
    const offset1 = canvas.grid.getOffset({ x, y });
    const r1 = offset1.i;
    const c1 = offset1.j;
    if (i > 0) {
      const [r0, c0] = prior;
      if (r0 === r1 && c0 === c1) continue;
    }

    const topLeft1 = canvas.grid.getTopLeftPoint(offset1);
    const contained = templateDoc.object.shape.contains(
      topLeft1.x + gridCenter - templateDoc.object.center.x,
      topLeft1.y + gridCenter - templateDoc.object.center.y
    );
    if (contained) locations.add({ x: topLeft1.x, y: topLeft1.y });

    prior = [r1, c1];
    if (i === 0) continue;

    if (!canvas.grid.testAdjacency(
      { i: prior[0], j: prior[1] },
      { i: r1, j: c1 }
    )) {
      const th = tMax[i - 1] + (0.5 / nMax);
      const { x: xhp, y: yhp } = ray.project(th);
      const offsetH = canvas.grid.getOffset({ x: xhp, y: yhp });
      const topLeftH = canvas.grid.getTopLeftPoint(offsetH);
      const containedHalf = templateDoc.object.shape.contains(
        topLeftH.x + gridCenter - templateDoc.object.center.x,
        topLeftH.y + gridCenter - templateDoc.object.center.y
      );
      if (containedHalf) locations.add({ x: topLeftH.x, y: topLeftH.y });
    }
  }
  return [...locations];
}

export function findContained(templateDoc) {
  const { size } = templateDoc.parent.grid;
  const { x: tempx, y: tempy, object } = templateDoc;
  const contained = new Set();
  if (!object?.shape) return [];
  
  for (const tokenDoc of templateDoc.parent.tokens) {
    const { width, height, x: tokx, y: toky } = tokenDoc;
    const startX = width >= 1 ? 0.5 : width / 2;
    const startY = height >= 1 ? 0.5 : height / 2;
    
    for (let x = startX; x < width; x++) {
      for (let y = startY; y < height; y++) {
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
    if (!object?.shape) continue;
    const startX = width >= 1 ? 0.5 : width / 2;
    const startY = height >= 1 ? 0.5 : height / 2;
    
    for (let x = startX; x < width; x++) {
      for (let y = startY; y < height; y++) {
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
 * Place a template zone on the scene. Supports three specialized shortcut modes via options:
 *
 * **Dangerous zone** (triggers ENG check on entry/turn start, deals damage on failure):
 * ```js
 * placeZone({ x, y, size, dangerous: { damageType: "kinetic", damageValue: 5 } });
 * // equivalent to: placeDangerousZone(options, damageType, damageValue, hooks)
 * ```
 *
 * **Status effect zone** (applies active effects to tokens inside):
 * ```js
 * placeZone({ x, y, size, statusEffects: ["impaired", "lockon"] });
 * // equivalent to: placeZoneWithStatusEffect(options, statusEffects, hooks)
 * ```
 *
 * **Difficult terrain zone** (imposes movement penalty via ElevationRuler):
 * ```js
 * placeZone({ x, y, size, difficultTerrain: { movementPenalty: 1, isFlatPenalty: true } });
 * // equivalent to: placeDifficultTerrainZone(options, movementPenalty, isFlatPenalty, hooks)
 * ```
 *
 * @param {Object} options
 * @param {number} [options.x]
 * @param {number} [options.y]
 * @param {number} [options.size=1]
 * @param {string} [options.type="Blast"]
 * @param {string} [options.fillColor="#ff6400"]
 * @param {string} [options.borderColor="#000000"]
 * @param {string} [options.texture]
 * @param {Object} [options.dangerous] - Shortcut: creates a dangerous zone that triggers ENG checks
 * @param {string} [options.dangerous.damageType="kinetic"] - Damage type (kinetic, energy, explosive, heat, burn, variable)
 * @param {number} [options.dangerous.damageValue=5] - Amount of damage on failed check
 * @param {string[]} [options.statusEffects] - Shortcut: array of status effect IDs to apply (e.g. ["impaired", "lockon"])
 * @param {Object} [options.difficultTerrain] - Shortcut: creates a difficult terrain zone via ElevationRuler
 * @param {number} [options.difficultTerrain.movementPenalty=1] - Movement cost added (flat) or multiplied per hex
 * @param {boolean} [options.difficultTerrain.isFlatPenalty=true] - If true, adds flat feet per hex; if false, multiplies cost
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
  if (options.difficultTerrain) {
    return await placeDifficultTerrainZone({ ...options, difficultTerrain: null }, options.difficultTerrain.movementPenalty, options.difficultTerrain.isFlatPenalty, hooks);
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
    fillPulseSpeed = 1,
    centerLabel = ""
  } = options;

  let adjustedSize = size;
  if (game.system.id === "lancer" && [2, 3, 4, 5].includes(canvas.grid.type)) {
    adjustedSize += 0.33;
  }

  let template = null;
  const { flags, pendingCallbacks } = _buildTemplateMacroFlags(hooks);
  const tf = {
    ...(flags.templatemacro || {}),
    fillType, fillTexture, fillSize, fillOpacity, borderOpacity,
    fillAnimation, fillAnimationSpeed, fillAnimationAngle, fillPulse, fillPulseSpeed,
    centerLabel
  };

  if (game.system.id === "lancer" && game.lancer?.canvas?.WeaponRangeTemplate) {
    try {
      const templatePreview = game.lancer.canvas.WeaponRangeTemplate.fromRange({ type, val: Math.max(adjustedSize, 0) });
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
        
        // Manually trigger whenCreated for Lancer because initial placement doesn't have flags
        if (flags.templatemacro?.whenCreated) {
          const { id: gmId } = game.users.find(u => u.active && u.isGM) ?? {};
          callMacro(template, "whenCreated", { gmId, userId: game.user.id, coords: { previous: null, current: { x: template.x, y: template.y } } });
        }
      }
    } catch (e) {
      console.error(e);
      return null;
    }
  } else if (x !== undefined && y !== undefined) {
    const tMap = { blast: "circle", burst: "circle", circle: "circle", cone: "cone", line: "ray", ray: "ray", rect: "rect", square: "rect" };
    template = await getDocumentClass("MeasuredTemplate").create({
      t: tMap[type.toLowerCase()] || "circle",
      user: game.user.id,
      x, y,
      distance: adjustedSize,
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
  // Register any pending function callbacks for the created template
  if (template && pendingCallbacks.length > 0) {
    for (const cb of pendingCallbacks) {
      registerCallback(template.id, cb.trigger, cb.fn, cb.asGM);
    }
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
          'if (!e) { const d = CONFIG.statusEffects.find(x => x.id === s); if (d) { const name = game.i18n.localize(d.name || d.label || s); await a.createEmbeddedDocuments("ActiveEffect", [{ ...d, name, statuses: [s], "flags.templatemacro.sourceTemplate": tid }]); } }'
        }
      }
    }`;

  const mkSceneCmd = (del) => `
    const ef = ${JSON.stringify(statusEffects)};
    const tid = template.id;
    const api = game.modules.get('templatemacro').api;
    if (!template.object) {
      let retries = 0;
      while (!template.object && retries < 10) {
        await new Promise(r => setTimeout(r, 50));
        retries++;
      }
    }
    const contained = ${del} ? [] : api.findContained(template);
    for (const tDoc of scene.tokens) {
      if (!tDoc.actor) continue;
      const a = tDoc.actor;
      const isContained = contained.includes(tDoc.id);
      for (const s of ef) {
        const e = a.effects.find(x => x.statuses.has(s) && x.getFlag("templatemacro", "sourceTemplate") === tid);
        if (e && (${del} || !isContained)) await e.delete();
        else if (!e && !${del} && isContained) {
          const d = CONFIG.statusEffects.find(x => x.id === s);
          if (d) {
            const name = game.i18n.localize(d.name || d.label || s);
            await a.createEmbeddedDocuments("ActiveEffect", [{ ...d, name, statuses: [s], "flags.templatemacro.sourceTemplate": tid }]);
          }
        }
      }
    }`;

  return await placeZone(options, {
    ...hooks,
    created: {
      command: (hooks.created?.command ? hooks.created.command + "\n" : "") + mkSceneCmd(false),
      asGM: true
    },
    deleted: {
      command: (hooks.deleted?.command ? hooks.deleted.command + "\n" : "") + mkSceneCmd(true),
      asGM: true
    },
    moved: {
      command: (hooks.moved?.command ? hooks.moved.command + "\n" : "") + mkSceneCmd(false),
      asGM: true
    },
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

/**
 * Place a zone that imposes a movement penalty (difficult terrain) for ElevationRuler.
 * Tokens moving through it pay extra movement cost per hex.
 * @param {Object} options - Standard placeZone options
 * @param {number} [movementPenalty=2] - Cost added (flat) or multiplied per hex
 * @param {boolean} [isFlatPenalty=true] - If true, adds flat feet per hex; if false, multiplies movement cost
 * @param {Object} [hooks] - Additional templateMacro hooks
 */
export async function placeDifficultTerrainZone(options = {}, movementPenalty = 1, isFlatPenalty = true, hooks = {}) {
  const defaults = {
    fillType: game.settings.get("templatemacro", "difficultTerrainDefaultFillType"),
    fillTexture: game.settings.get("templatemacro", "difficultTerrainDefaultTexture"),
    fillColor: game.settings.get("templatemacro", "difficultTerrainDefaultFillColor"),
    fillOpacity: game.settings.get("templatemacro", "difficultTerrainDefaultFillOpacity"),
    fillAnimation: game.settings.get("templatemacro", "difficultTerrainDefaultAnimation"),
    fillPulse: game.settings.get("templatemacro", "difficultTerrainDefaultFillPulse"),
    borderOpacity: game.settings.get("templatemacro", "difficultTerrainDefaultBorderOpacity"),
    fillAnimationSpeed: game.settings.get("templatemacro", "difficultTerrainDefaultFillAnimationSpeed"),
    fillAnimationAngle: game.settings.get("templatemacro", "difficultTerrainDefaultFillAnimationAngle"),
    fillPulseSpeed: game.settings.get("templatemacro", "difficultTerrainDefaultFillPulseSpeed")
  };
  options = { ...defaults, ...options };

  const result = await placeZone(options, hooks);
  if (result?.template) {
    await result.template.setFlag("elevationruler", "movementPenalty", movementPenalty);
    await result.template.setFlag("elevationruler", "flatMovementPenalty", isFlatPenalty);
  }
  return result;
}

/**
 * Build template macro flags from hooks, separating string commands from function callbacks.
 * @param {Object} hooks - Hook definitions, each being { command, asGM } or { function, asGM }
 * @returns {{ flags: Object, pendingCallbacks: Array<{trigger: string, fn: Function, asGM: boolean}> }}
 */
function _buildTemplateMacroFlags(hooks) {
  if (!hooks || Object.keys(hooks).length === 0) return { flags: {}, pendingCallbacks: [] };
  
  const flags = { templatemacro: {} };
  const pendingCallbacks = [];
  const map = {
    created: "whenCreated", deleted: "whenDeleted", moved: "whenMoved",
    hidden: "whenHidden", revealed: "whenRevealed", entered: "whenEntered",
    left: "whenLeft", through: "whenThrough", staying: "whenStaying",
    turnStart: "whenTurnStart", turnEnd: "whenTurnEnd"
  };

  for (const [k, c] of Object.entries(hooks)) {
    const t = map[k] || (Object.values(map).includes(k) ? k : null);
    if (!t) continue;

    // Function-based hook — queue for post-creation registration
    if (typeof c.function === 'function') {
      pendingCallbacks.push({ trigger: t, fn: c.function, asGM: c.asGM || false });
    }

    // String-based hook — store in flags as before
    if (c.command) {
      flags.templatemacro[t] = { command: c.command, asGM: c.asGM || false };
    }
  }
  return { flags, pendingCallbacks };
}


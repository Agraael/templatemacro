/**
 * Returns the upper-left coordinates of any grid cells within a template
 * that are on the direct path between the two points.
 */
export function findGrids(A, B, templateDoc) {
  const a = canvas.grid.getCenter(A.x, A.y);
  const b = canvas.grid.getCenter(B.x, B.y)
  const ray = new Ray({ x: a[0], y: a[1] }, { x: b[0], y: b[1] });
  if (ray.distance === 0) return [];

  const scene = templateDoc.parent;
  const gridCenter = scene.grid.size / 2;
  const locations = new Set();
  const spacer = scene.grid.type === CONST.GRID_TYPES.SQUARE ? 1.41 : 1;
  const nMax = Math.max(Math.floor(ray.distance / (spacer * Math.min(canvas.grid.w, canvas.grid.h))), 1);
  const tMax = Array.fromRange(nMax + 1).map(t => t / nMax);

  let prior = null;
  for (const [i, t] of tMax.entries()) {
    const { x, y } = ray.project(t);
    const [r0, c0] = (i === 0) ? [null, null] : prior;
    const [r1, c1] = canvas.grid.grid.getGridPositionFromPixels(x, y);
    if (r0 === r1 && c0 === c1) continue;

    const [x1, y1] = canvas.grid.grid.getPixelsFromGridPosition(r1, c1);
    const contained = templateDoc.object.shape.contains(
      x1 + gridCenter - templateDoc.object.center.x,
      y1 + gridCenter - templateDoc.object.center.y
    );
    if (contained) locations.add({ x: x1, y: y1 });

    prior = [r1, c1];
    if (i === 0) continue;

    if (!canvas.grid.isNeighbor(r0, c0, r1, c1)) {
      const th = tMax[i - 1] + (0.5 / nMax);
      const { x, y } = ray.project(th);
      const [rh, ch] = canvas.grid.grid.getGridPositionFromPixels(x, y);
      const [xh, yh] = canvas.grid.grid.getPixelsFromGridPosition(rh, ch);
      const contained = templateDoc.object.shape.contains(
        xh + gridCenter - templateDoc.object.center.x,
        yh + gridCenter - templateDoc.object.center.y
      );
      if (contained) locations.add({ x: xh, y: yh });
    }
  }
  return [...locations];
}

/**
 * Returns the tokenDocument ids that are contained within a templateDocument.
 */
export function findContained(templateDoc) {
  const { size } = templateDoc.parent.grid;
  const { x: tempx, y: tempy, object } = templateDoc;
  const tokenDocs = templateDoc.parent.tokens;
  const contained = new Set();
  for (const tokenDoc of tokenDocs) {
    const { width, height, x: tokx, y: toky } = tokenDoc;
    const startX = width >= 1 ? 0.5 : width / 2;
    const startY = height >= 1 ? 0.5 : height / 2;
    for (let x = startX; x < width; x++) {
      for (let y = startY; y < width; y++) {
        const curr = {
          x: tokx + x * size - tempx,
          y: toky + y * size - tempy
        };
        const contains = object.shape.contains(curr.x, curr.y);
        if (contains) {
          contained.add(tokenDoc.id);
          continue;
        }
      }
    }
  }
  return [...contained];
}

/**
 * Return the ids of the template documents that contain a given token document.
 * @param {TokenDocument} tokenDoc      The token document to evaluate.
 * @returns {string[]}                  The ids of template documents.
 */
export function findContainers(tokenDoc) {
  const { size } = tokenDoc.parent.grid;
  const { width, height, x: tokx, y: toky } = tokenDoc;
  const templateDocs = tokenDoc.parent.templates;
  const containers = new Set();
  for (const templateDoc of templateDocs) {
    const { x: tempx, y: tempy, object } = templateDoc;
    const startX = width >= 1 ? 0.5 : width / 2;
    const startY = height >= 1 ? 0.5 : height / 2;
    for (let x = startX; x < width; x++) {
      for (let y = startY; y < width; y++) {
        const curr = {
          x: tokx + x * size - tempx,
          y: toky + y * size - tempy
        };
        const contains = object.shape.contains(curr.x, curr.y);
        if (contains) {
          containers.add(templateDoc.id);
          continue;
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
  const {
    x, y,
    size = 1,
    type = "Blast",
    fillColor = "#ff6400",
    borderColor = "#000000",
    texture = null,
    dangerous = null,
    statusEffects = null
  } = options;

  // Delegate to specialized functions if needed
  if (dangerous) {
    const { damageType = "kinetic", damageValue = 5 } = dangerous;
    return await placeDangerousZone(
      { x, y, size, type, fillColor, borderColor, texture },
      damageType,
      damageValue,
      hooks
    );
  }

  if (statusEffects && statusEffects.length > 0) {
    return await placeZoneWithStatusEffect(
      { x, y, size, type, fillColor, borderColor, texture },
      statusEffects,
      hooks
    );
  }

  let template = null;
  const flags = _buildTemplateMacroFlags(hooks);

  if (game.system.id === "lancer" && game.lancer?.canvas?.WeaponRangeTemplate) {
    try {
      const templatePreview = game.lancer.canvas.WeaponRangeTemplate.fromRange({
        type: type,
        val: Math.max(size, 0)
      });

      template = await templatePreview.placeTemplate();

      if (template) {
        const updateData = {
          fillColor,
          borderColor,
          flags: { ...template.flags, ...flags }
        };
        if (texture) {
          updateData.texture = texture;
        }

        await template.update(updateData);
        await template.update({ "flags.tokenmagic.templateData.opacity": 0 });
      }
    } catch (e) {
      return null;
    }
  }
  else if (x !== undefined && y !== undefined) {
    const cls = getDocumentClass("MeasuredTemplate");
    const tMap = {
      "blast": "circle", "burst": "circle", "circle": "circle",
      "cone": "cone",
      "line": "ray", "ray": "ray",
      "rect": "rect", "square": "rect"
    };
    const foundryType = tMap[type.toLowerCase()] || "circle";

    const data = {
      t: foundryType,
      user: game.user.id,
      x: x,
      y: y,
      distance: size,
      fillColor: fillColor,
      borderColor: borderColor,
      texture: texture,
      flags: flags
    };

    template = await cls.create(data, { parent: canvas.scene });
  } else {
    console.warn("placeZone: Interactive placement is currently only supported for the Lancer system. Please provide x and y coordinates for generic usage.");
    return null;
  }

  if (!template) return null;

  return {
    x: template.x,
    y: template.y,
    template: template
  };
}

/**
 * Place a zone that applies status effects to tokens within it.
 * @param {Object} options - Standard placeZone options
 * @param {string[]} statusEffects - Array of status effect IDs (e.g. ["impaired", "lockon"])
 * @param {Object} [hooks] - Additional hooks
 */
export async function placeZoneWithStatusEffect(options = {}, statusEffects = [], hooks = {}) {
  const enterCommand = `
    const effects = ${JSON.stringify(statusEffects)};
    if (token && token.actor) {
      const actor = token.actor;
      const templateId = template.id;

      for (const statusId of effects) {
        const existing = actor.effects.find(e => e.statuses.has(statusId) && e.getFlag("templatemacro", "sourceTemplate") === templateId);

        if (!existing) {
          const effectData = CONFIG.statusEffects.find(e => e.id === statusId);
          if (effectData) {
            await actor.createEmbeddedDocuments("ActiveEffect", [{
              ...effectData,
              statuses: [statusId],
              "flags.templatemacro.sourceTemplate": templateId
            }]);
          }
        }
      }
    }
  `;

  const leftCommand = `
    const effects = ${JSON.stringify(statusEffects)};
    if (token && token.actor) {
      const actor = token.actor;
      const templateId = template.id;

      for (const statusId of effects) {
        const effect = actor.effects.find(e => e.statuses.has(statusId) && e.getFlag("templatemacro", "sourceTemplate") === templateId);
        if (effect) {
          await effect.delete();
        }
      }
    }
  `;

  const finalHooks = {
    ...hooks,
    entered: {
      command: (hooks.entered?.command ? hooks.entered.command + "\n" : "") + enterCommand,
      asGM: true
    },
    left: {
      command: (hooks.left?.command ? hooks.left.command + "\n" : "") + leftCommand,
      asGM: true
    }
  };

  return await placeZone(options, finalHooks);
}

export async function triggerDangerousZoneFlow(token, damageType = "kinetic", damageValue = 5) {
  if (!token || !token.actor) return;

  const actor = token.actor;
  const currentRound = game.combat ? game.combat.round : 0;
  const lastRound = actor.getFlag("templatemacro", "dangerousZoneRound");

  if (lastRound === currentRound && game.combat && game.combat.started) {
    return;
  }

  if (game.combat && game.combat.started) {
    await actor.setFlag("templatemacro", "dangerousZoneRound", currentRound);
  } else if (lastRound !== undefined) {
    await actor.unsetFlag("templatemacro", "dangerousZoneRound");
  }

  const triggerDamage = async () => {
    const DamageRollFlow = game.lancer.flows.get("DamageRollFlow");
    if (!DamageRollFlow) return;

    const typeMap = {
      kinetic: "Kinetic",
      energy: "Energy",
      explosive: "Explosive",
      burn: "Burn",
      heat: "Heat",
      variable: "Variable"
    };
    const normalizedType = typeMap[damageType.toLowerCase()] || "Kinetic";

    const t = token.object || token;
    if (t && t.setTarget) {
      t.setTarget(true, { releaseOthers: true, groupSelection: false });
    }

    const params = {
      title: "Dangerous Terrain",
      damage: [{ val: String(damageValue), type: normalizedType }],
      tags: [],
      hit_results: [],
      has_normal_hit: true
    };

    const flow = new DamageRollFlow(actor.uuid, params);
    await flow.begin();
  };

  Hooks.once("createChatMessage", async (msg) => {
    if (msg.user.id !== game.user.id) return;

    if (msg.speaker.actor === actor.id) {
      const roll = msg.rolls[0];
      if (roll && roll.total < 10) {
        await triggerDamage();
      }
    }
  });

  await actor.beginStatFlow("system.eng", "Dangerous Terrain :: ENG");
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
  const checkCommand = `
    if (token) {
       await game.modules.get('templatemacro').api.triggerDangerousZoneFlow(token, "${damageType}", ${damageValue});
    }
  `;

  const finalHooks = {
    ...hooks,
    entered: {
      command: (hooks.entered?.command ? hooks.entered.command + "\n" : "") + checkCommand,
      asGM: false
    },
    turnStart: {
      command: (hooks.turnStart?.command ? hooks.turnStart.command + "\n" : "") + checkCommand,
      asGM: false
    }
  };

  return await placeZone(options, finalHooks);
}

function _buildTemplateMacroFlags(hooks) {
  if (!hooks || Object.keys(hooks).length === 0) return {};

  const flags = { templatemacro: {} };
  const hookMap = {
    "created": "whenCreated",
    "deleted": "whenDeleted",
    "moved": "whenMoved",
    "hidden": "whenHidden",
    "revealed": "whenRevealed",
    "entered": "whenEntered",
    "left": "whenLeft",
    "through": "whenThrough",
    "staying": "whenStaying",
    "turnStart": "whenTurnStart",
    "turnEnd": "whenTurnEnd"
  };

  for (const [key, config] of Object.entries(hooks)) {
    const trigger = hookMap[key] || (Object.values(hookMap).includes(key) ? key : null);
    if (trigger && config.command) {
      flags.templatemacro[trigger] = {
        command: config.command,
        asGM: config.asGM || false
      };
    }
  }
  return flags;
}

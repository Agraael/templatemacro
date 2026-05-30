// Color keyframe animation. Ported from grid-aware-auras.

import { easingFunctions } from "./easing.mjs";

/**
 * @typedef {Object} ColorAnimationKeyframe
 * @property {number} color  Packed RGB int (0xRRGGBB)
 * @property {number} alpha  0-1
 * @property {number} position  0-1 within the loop
 */
/**
 * @typedef {Object} ColorAnimation
 * @property {ColorAnimationKeyframe[]} keyframes
 * @property {number} duration  Loop duration in ms.
 * @property {string} easingFunc
 */

function interpolateNumber(a, b, t)
{
    return a + ((b - a) * t);
}

function interpolateColor(c1, c2, t)
{
    const r1 = (c1 >> 16) & 255, g1 = (c1 >> 8) & 255, b1 = c1 & 255;
    const r2 = (c2 >> 16) & 255, g2 = (c2 >> 8) & 255, b2 = c2 & 255;
    const r = Math.round(interpolateNumber(r1, r2, t));
    const g = Math.round(interpolateNumber(g1, g2, t));
    const b = Math.round(interpolateNumber(b1, b2, t));
    return (r << 16) | (g << 8) | b;
}

export function hexToInt(hex)
{
    if (typeof hex === "number")
        return hex;
    if (typeof hex !== "string")
        return 0;
    const m = /^#?([a-f0-9]{6})/i.exec(hex);
    return m ? parseInt(m[1], 16) : 0;
}

/**
 * Sample a color animation at the given absolute time.
 * @param {ColorAnimation} anim
 * @param {number} nowMs  performance.now() or similar
 * @returns {{ color: number, alpha: number }}
 */
export function sampleColorAnimation(anim, nowMs)
{
    if (!anim || !anim.keyframes?.length)
        return null;
    const kfs = anim.keyframes.slice().sort((a, b) => a.position - b.position);
    const duration = Math.max(1, anim.duration ?? 2500);
    const ease = easingFunctions[anim.easingFunc] ?? easingFunctions.linear;
    const t = ease((nowMs % duration) / duration);

    if (t <= kfs[0].position)
        return { color: hexToInt(kfs[0].color), alpha: kfs[0].alpha };
    if (t >= kfs[kfs.length - 1].position)
    {
        const last = kfs[kfs.length - 1];
        return { color: hexToInt(last.color), alpha: last.alpha };
    }
    for (let i = 0; i < kfs.length - 1; i++)
    {
        const a = kfs[i], b = kfs[i + 1];
        if (a.position <= t && b.position >= t)
        {
            const tAB = (t - a.position) / (b.position - a.position);
            return {
                color: interpolateColor(hexToInt(a.color), hexToInt(b.color), tAB),
                alpha: interpolateNumber(a.alpha, b.alpha, tAB)
            };
        }
    }
    return { color: hexToInt(kfs[0].color), alpha: kfs[0].alpha };
}

/** Build a default 2-stop pulse animation. */
export function buildPulseAnimation(color, baseAlpha, durationMs = 1000)
{
    return {
        keyframes: [
            { color: hexToInt(color), alpha: baseAlpha, position: 0 },
            { color: hexToInt(color), alpha: Math.max(0.05, baseAlpha * 0.4), position: 0.5 },
            { color: hexToInt(color), alpha: baseAlpha, position: 1 }
        ],
        duration: durationMs,
        easingFunc: "easeInOutQuad"
    };
}

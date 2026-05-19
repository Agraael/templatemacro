// Easing functions for color animation interpolation. Ported from grid-aware-auras.
export const EASING_FUNCTIONS = {
  linear: "linear",
  easeInCubic: "easeInCubic",
  easeOutCubic: "easeOutCubic",
  easeInOutCubic: "easeInOutCubic",
  easeInQuad: "easeInQuad",
  easeOutQuad: "easeOutQuad",
  easeInOutQuad: "easeInOutQuad"
};

export const easingFunctions = {
  linear: v => v,
  easeInQuad: v => v * v,
  easeOutQuad: v => 1 - (1 - v) * (1 - v),
  easeInOutQuad: v => v < 0.5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2,
  easeInCubic: v => Math.pow(v, 3),
  easeOutCubic: v => 1 - Math.pow(1 - v, 3),
  easeInOutCubic: v => v < 0.5 ? 4 * Math.pow(v, 3) : 1 - (Math.pow((-2 * v) + 2, 3) / 2)
};

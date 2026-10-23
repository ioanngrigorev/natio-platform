// Reserve pixels inside numeric axes so extrema (including exactly 0% / 100%)
// stay visible. Unlike extending a percentage domain, this preserves its meaning.
export const valueAxisPadding = {top: 20, bottom: 4};
export const horizontalValuePadding = {left: 0, right: 20};
export const percentageTicks = [0, 25, 50, 75, 100];

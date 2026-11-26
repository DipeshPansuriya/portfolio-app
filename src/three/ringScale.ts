/** A stack item's icon size on the hero ring: level 80 is 1, from 0.6 (level 0) to 1.1 (level 100). */
export const ringScale = (level: number) => 0.6 + Math.min(100, Math.max(0, level)) / 200

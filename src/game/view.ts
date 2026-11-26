/** Camera and start-gantry sizes. Kept together so the beam never covers the HUD on the start line. */
export const FOV = 55

/** Chase camera: metres behind and above the car, and the point it looks at ahead of it. */
export const CHASE = { back: 9.4, height: 3.6, lookAhead: 6, lookY: 1.1 }

/** `beamY` is the beam centre; its underside must stay above the top of the view from the start. */
export const GANTRY = { beamY: 7.4, beamHeight: 0.7, depth: 0.5 }

/** Chapter gate arches. The label floats `labelGap` above the top bar. */
export const GATE = { barY: 6, bar: 0.28, labelGap: 1.6, labelHeight: 2.4 }

/** The start gate shares the start line, so its bar sits just above the gantry beam. */
export const gateBarY = (id: string) => (id === '__start' ? GANTRY.beamY + 0.55 : GATE.barY)

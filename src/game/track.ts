import * as THREE from 'three'

/**
 * The circuit. A closed Catmull-Rom loop with a long straight, a hairpin and a
 * chicane — enough shape that braking points matter, short enough to lap in
 * about 40 seconds.
 *
 * Everything else (road mesh, barriers, gates, terrain flattening) is derived
 * from this curve, so editing the points reshapes the whole track.
 */
const CONTROL_POINTS: [number, number, number][] = [
  [0, 0, 46],
  [46, 0, 38],
  [74, 0, 6],
  [72, 0, -42],
  [44, 0, -78],
  [4, 0, -92],
  [-38, 0, -84],
  [-68, 0, -50],
  [-72, 0, -4],
  [-54, 0, 32],
  [-26, 0, 46],
]

export const ROAD_HALF_WIDTH = 9
export const WALL_HALF_WIDTH = ROAD_HALF_WIDTH + 1.6

export type TrackSample = {
  pos: THREE.Vector3
  tangent: THREE.Vector3
  normal: THREE.Vector3
  t: number
}

export type Gate = {
  id: string
  label: string
  kicker: string
  hint: string
  color: string
  index: number
  /** 0 = start/finish line, 1..n = chapters. */
  position: THREE.Vector3
  tangent: THREE.Vector3
  heading: number
  t: number
}

export type Track = {
  curve: THREE.CatmullRomCurve3
  samples: TrackSample[]
  length: number
  gates: Gate[]
}

export const SAMPLE_COUNT = 520

export function buildTrack(
  chapters: { id: string; label: string; kicker: string; hint: string; accent: string }[],
): Track {
  const curve = new THREE.CatmullRomCurve3(
    CONTROL_POINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    true,
    'catmullrom',
    0.5,
  )

  const samples: TrackSample[] = []
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const t = i / SAMPLE_COUNT
    const pos = curve.getPointAt(t)
    const tangent = curve.getTangentAt(t).normalize()
    // Lateral axis: perpendicular to the tangent, in the ground plane.
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
    samples.push({ pos, tangent, normal, t })
  }

  const length = curve.getLength()

  // Start/finish at t=0, then chapters spread evenly around the lap.
  const gates: Gate[] = [
    {
      // Distinct from any chapter id: the first chapter is itself called "start".
      id: '__start',
      label: 'Start',
      kicker: 'Start line',
      hint: 'Lap',
      color: '#e8fbff',
      index: 0,
      position: samples[0].pos.clone(),
      tangent: samples[0].tangent.clone(),
      heading: Math.atan2(samples[0].tangent.x, samples[0].tangent.z),
      t: 0,
    },
  ]

  chapters.forEach((chapter, i) => {
    const t = ((i + 1) / (chapters.length + 1)) % 1
    const idx = Math.round(t * SAMPLE_COUNT) % SAMPLE_COUNT
    const sample = samples[idx]
    gates.push({
      id: chapter.id,
      label: chapter.label,
      kicker: chapter.kicker,
      hint: chapter.hint,
      color: chapter.accent,
      index: i + 1,
      position: sample.pos.clone(),
      tangent: sample.tangent.clone(),
      heading: Math.atan2(sample.tangent.x, sample.tangent.z),
      t,
    })
  })

  return { curve, samples, length, gates }
}

/** Road ribbon: two vertices per sample, closed loop. */
export function buildRoadGeometry(track: Track, halfWidth = ROAD_HALF_WIDTH) {
  const { samples } = track
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    const l = s.pos.clone().addScaledVector(s.normal, halfWidth)
    const r = s.pos.clone().addScaledVector(s.normal, -halfWidth)
    positions.push(l.x, 0.02, l.z, r.x, 0.02, r.z)
    normals.push(0, 1, 0, 0, 1, 0)
    const v = i / samples.length
    uvs.push(0, v, 1, v)
  }

  for (let i = 0; i < samples.length; i++) {
    const a = i * 2
    const b = i * 2 + 1
    const c = ((i + 1) % samples.length) * 2
    const d = ((i + 1) % samples.length) * 2 + 1
    indices.push(a, c, b, b, c, d)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeBoundingSphere()
  return geo
}

/** Thin strip offset from the centre line — used for the edge markings. */
export function buildStripeGeometry(track: Track, offset: number, halfWidth: number) {
  const { samples } = track
  const positions: number[] = []
  const indices: number[] = []

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    const centre = s.pos.clone().addScaledVector(s.normal, offset)
    const l = centre.clone().addScaledVector(s.normal, halfWidth)
    const r = centre.clone().addScaledVector(s.normal, -halfWidth)
    positions.push(l.x, 0.035, l.z, r.x, 0.035, r.z)
  }

  for (let i = 0; i < samples.length; i++) {
    const a = i * 2
    const b = i * 2 + 1
    const c = ((i + 1) % samples.length) * 2
    const d = ((i + 1) % samples.length) * 2 + 1
    indices.push(a, c, b, b, c, d)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

/** Barrier posts along both edges, for an instanced mesh. */
export function buildBarrierTransforms(track: Track, spacing = 5.5) {
  const out: { position: [number, number, number]; rotation: number }[] = []
  const count = Math.floor(track.length / spacing)
  for (let i = 0; i < count; i++) {
    const t = i / count
    const pos = track.curve.getPointAt(t)
    const tan = track.curve.getTangentAt(t).normalize()
    const nrm = new THREE.Vector3(-tan.z, 0, tan.x).normalize()
    const heading = Math.atan2(tan.x, tan.z)
    for (const side of [1, -1]) {
      const p = pos.clone().addScaledVector(nrm, WALL_HALF_WIDTH * side)
      out.push({ position: [p.x, 0.5, p.z], rotation: heading })
    }
  }
  return out
}

/** Distance from a point to the track centre line, for terrain flattening. */
export function distanceToTrack(x: number, z: number, samples: TrackSample[]) {
  let best = Infinity
  for (let i = 0; i < samples.length; i += 2) {
    const p = samples[i].pos
    const d = (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z)
    if (d < best) best = d
  }
  return Math.sqrt(best)
}

/** Writes the barrier posts into an instanced mesh. Call once the mesh exists. */
export function fillBarriers(mesh: THREE.InstancedMesh, barriers: ReturnType<typeof buildBarrierTransforms>) {
  const dummy = new THREE.Object3D()
  barriers.forEach((b, i) => {
    dummy.position.set(b.position[0], b.position[1], b.position[2])
    dummy.rotation.set(0, b.rotation, 0)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  })
  mesh.instanceMatrix.needsUpdate = true
  // Without this the whole set is culled against the single box at the origin.
  mesh.computeBoundingSphere()
}

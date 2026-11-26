import * as THREE from 'three'
import type { TrackSample } from './track'
import { distanceToTrack } from './track'

/**
 * Rolling terrain with a flattened corridor around the circuit, so the road
 * sits on ground that is level across its width but still banked by hills.
 */

function rawHeight(x: number, z: number) {
  return (
    Math.sin(x * 0.048) * Math.cos(z * 0.041) * 7.2 +
    Math.sin((x * 0.5 + z) * 0.026) * 4.1 +
    Math.cos(x * 0.019 + z * 0.031) * 2.8 +
    Math.sin(x * 0.11 + z * 0.09) * 1.2
  )
}

/** Ground elevation at a world position, flattened near the circuit. */
export function groundHeight(x: number, z: number, samples: TrackSample[]) {
  const d = distanceToTrack(x, z, samples)
  const flatten = THREE.MathUtils.smoothstep(d, 13, 40)
  return rawHeight(x, z) * flatten
}

export function buildTerrainGeometry(samples: TrackSample[], size = 460, segments = 150) {
  const geo = new THREE.PlaneGeometry(size, size, segments, segments)
  geo.rotateX(-Math.PI / 2)
  geo.translate(0, 0, -22)

  const pos = geo.attributes.position as THREE.BufferAttribute
  const colors = new Float32Array(pos.count * 3)

  const low = new THREE.Color('#04070c')
  const mid = new THREE.Color('#091420')
  const high = new THREE.Color('#16324a')

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const y = groundHeight(x, z, samples)
    pos.setY(i, y)

    const t = THREE.MathUtils.clamp((y + 7) / 18, 0, 1)
    const c = low.clone().lerp(mid, Math.min(1, t * 1.8))
    if (t > 0.55) c.lerp(high, (t - 0.55) / 0.45)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  return geo
}

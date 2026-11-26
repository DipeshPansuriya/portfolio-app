import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Track } from './track'

/**
 * Establishing helicopter shot over the circuit while the intro card is up.
 * Hands the camera back to the car the moment the run starts.
 */
export function IntroCamera({ track, still = false }: { track: Track; still?: boolean }) {
  const { camera } = useThree()
  const t = useRef(0)

  const centre = useMemo(() => {
    const box = new THREE.Box3()
    for (const s of track.samples) box.expandByPoint(s.pos)
    return box.getCenter(new THREE.Vector3())
  }, [track])

  const look = useMemo(() => new THREE.Vector3(), [])
  const pos = useMemo(() => new THREE.Vector3(), [])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 30)
    if (!still) t.current += dt

    const angle = t.current * 0.18
    const radius = 108
    pos.set(
      centre.x + Math.sin(angle) * radius,
      46 + Math.sin(t.current * 0.35) * 6,
      centre.z + Math.cos(angle) * radius,
    )

    // Reduced motion: go straight to the shot and stay there.
    const k = still ? 1 : 1 - Math.pow(0.02, dt)
    camera.position.lerp(pos, k)
    look.lerp(centre, k)
    camera.lookAt(look)
  })

  return null
}

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

type Ring = {
  radius: number
  tilt: [number, number, number]
  speed: number
  color: string
  opacity: number
  thickness: number
  dot?: boolean
}

const RINGS: Ring[] = [
  { radius: 1.62, tilt: [1.32, 0.18, 0.1], speed: 0.22, color: '#4dd6f7', opacity: 0.5, thickness: 0.006, dot: true },
  { radius: 2.05, tilt: [1.05, -0.5, 0.42], speed: -0.16, color: '#8b7cf6', opacity: 0.38, thickness: 0.005 },
  { radius: 2.55, tilt: [1.5, 0.9, -0.28], speed: 0.11, color: '#f5b463', opacity: 0.3, thickness: 0.004, dot: true },
  { radius: 3.15, tilt: [1.18, 0.2, 0.9], speed: -0.08, color: '#9fb3c8', opacity: 0.16, thickness: 0.003 },
]

function Orbit({ ring, reduced, dark }: { ring: Ring; reduced: boolean; dark: boolean }) {
  const group = useRef<THREE.Group>(null)
  const dot = useRef<THREE.Mesh>(null)

  const geometry = useMemo(() => {
    const pts: THREE.Vector3[] = []
    const segments = 220
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2
      pts.push(new THREE.Vector3(Math.cos(a) * ring.radius, 0, Math.sin(a) * ring.radius))
    }
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [ring.radius])

  useFrame((state, delta) => {
    const d = Math.min(delta, 0.05)
    if (group.current && !reduced) group.current.rotation.y += d * ring.speed
    if (dot.current) {
      const t = state.clock.elapsedTime * ring.speed * 1.6
      dot.current.position.set(
        Math.cos(t) * ring.radius,
        Math.sin(t * 1.4) * 0.045,
        Math.sin(t) * ring.radius,
      )
    }
  })

  return (
    <group ref={group} rotation={ring.tilt}>
      <line>
        <primitive object={geometry} attach="geometry" />
        <lineBasicMaterial
          color={ring.color}
          transparent
          opacity={ring.opacity * (dark ? 1 : 0.85)}
          blending={dark ? THREE.AdditiveBlending : THREE.NormalBlending}
          depthWrite={false}
        />
      </line>
      {ring.dot && (
        <mesh ref={dot}>
          <sphereGeometry args={[ring.thickness * 5, 12, 12]} />
          <meshBasicMaterial color={ring.color} toneMapped={false} />
        </mesh>
      )}
    </group>
  )
}

export function OrbitRings({ reduced, dark = true }: { reduced: boolean; dark?: boolean }) {
  return (
    <group rotation={[0.12, 0, -0.06]}>
      {RINGS.map((ring) => (
        <Orbit key={ring.radius} ring={ring} reduced={reduced} dark={dark} />
      ))}
    </group>
  )
}

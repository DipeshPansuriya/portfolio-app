import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { getStudioEnvironment } from './studioEnv'

/**
 * A low-poly sports car built from a real side profile, extruded across the
 * width and bevelled so the edges catch light. Shared by the hero showcase and
 * the racing game so both read as the same vehicle.
 */

export type CarPalette = {
  body: string
  accent: string
  glass: string
  trim: string
  rim: string
}

export const DEFAULT_PALETTE: CarPalette = {
  body: '#4dd6f7',
  accent: '#8b7cf6',
  glass: '#0a1622',
  trim: '#0d1620',
  rim: '#c9d6e6',
}

/** Side silhouette in (z, y). z runs nose (+) to tail (−). */
const PROFILE: [number, number][] = [
  [2.18, 0.3],
  [2.26, 0.5],
  [2.2, 0.62],
  [1.86, 0.68],
  [1.2, 0.74],
  [0.72, 0.8],
  [0.62, 1.16],
  [0.1, 1.3],
  [-0.62, 1.32],
  [-1.08, 1.24],
  [-1.28, 0.94],
  [-1.86, 0.86],
  [-2.14, 0.78],
  [-2.24, 0.56],
  [-2.18, 0.3],
  [-1.9, 0.2],
  [1.9, 0.2],
]

function buildBodyGeometry(width: number) {
  const shape = new THREE.Shape()
  PROFILE.forEach(([z, y], i) => {
    if (i === 0) shape.moveTo(z, y)
    else shape.lineTo(z, y)
  })
  shape.closePath()

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.07,
    bevelSegments: 3,
    curveSegments: 8,
  })

  // Extrude runs along +Z; rotate so depth becomes width along X, and centre it.
  geo.rotateY(-Math.PI / 2)
  geo.translate(width / 2, 0, 0)
  geo.computeVertexNormals()
  return geo
}

function Wheel({
  position,
  radius,
  width,
  palette,
  steer,
  spin,
}: {
  position: [number, number, number]
  radius: number
  width: number
  palette: CarPalette
  steer?: React.RefObject<THREE.Group | null>
  spin?: React.RefObject<number>
}) {
  const inner = useRef<THREE.Group>(null)

  useFrame((_, delta) => {
    if (inner.current && spin) inner.current.rotation.x += (spin.current ?? 0) * delta
  })

  return (
    <group position={position} ref={steer}>
      <group ref={inner}>
        {/* tyre */}
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[radius, radius, width, 24]} />
          <meshStandardMaterial color="#0b0f14" roughness={0.92} metalness={0.05} />
        </mesh>
        {/* rim */}
        <mesh rotation={[0, 0, Math.PI / 2]} position={[0, 0, 0]}>
          <cylinderGeometry args={[radius * 0.62, radius * 0.62, width + 0.02, 20]} />
          <meshStandardMaterial color={palette.rim} metalness={0.85} roughness={0.25} />
        </mesh>
        {/* spokes */}
        {[0, 1, 2, 3, 4].map((i) => (
          <mesh
            key={i}
            rotation={[0, 0, (i / 5) * Math.PI * 2]}
            position={[0, 0, 0]}
          >
            <boxGeometry args={[width + 0.03, radius * 1.05, 0.05]} />
            <meshStandardMaterial color={palette.rim} metalness={0.8} roughness={0.3} />
          </mesh>
        ))}
        {/* hub */}
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[radius * 0.18, radius * 0.18, width + 0.06, 12]} />
          <meshStandardMaterial color={palette.trim} metalness={0.6} roughness={0.4} />
        </mesh>
      </group>
    </group>
  )
}

type Props = {
  palette?: CarPalette
  /** Radians per second added to wheel spin. */
  spin?: React.RefObject<number>
  steer?: React.RefObject<number>
  /** Lean the body (used by the racing car). */
  lean?: React.RefObject<{ roll: number; pitch: number }>
  showUnderglow?: boolean
}

export function CarModel({
  palette = DEFAULT_PALETTE,
  spin,
  steer,
  lean,
  showUnderglow = true,
}: Props) {
  const bodyRef = useRef<THREE.Group>(null)
  const steerL = useRef<THREE.Group>(null)
  const steerR = useRef<THREE.Group>(null)

  const geometry = useMemo(() => buildBodyGeometry(1.62), [])
  const { gl, scene } = useThree()

  // Metallic paint needs reflections; build the studio env once per renderer.
  useEffect(() => {
    const env = getStudioEnvironment(gl)
    scene.environment = env
    return () => {
      if (scene.environment === env) scene.environment = null
    }
  }, [gl, scene])

  useFrame(() => {
    if (bodyRef.current && lean) {
      const l = lean.current
      bodyRef.current.rotation.z = THREE.MathUtils.lerp(bodyRef.current.rotation.z, l?.roll ?? 0, 0.14)
      bodyRef.current.rotation.x = THREE.MathUtils.lerp(bodyRef.current.rotation.x, l?.pitch ?? 0, 0.12)
    }
    const s = steer?.current ?? 0
    if (steerL.current) steerL.current.rotation.y = s
    if (steerR.current) steerR.current.rotation.y = s
  })

  return (
    <group>
      <group ref={bodyRef}>
        {/* main body */}
        <mesh geometry={geometry} castShadow receiveShadow>
          <meshStandardMaterial
            color={palette.body}
            metalness={0.72}
            roughness={0.22}
            envMapIntensity={1.1}
          />
        </mesh>

        {/* glass canopy — a slim shell sitting inside the roof line */}
        <mesh position={[0, 1.14, 0.12]} scale={[1.18, 0.62, 1.62]} castShadow>
          <sphereGeometry args={[0.5, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial
            color={palette.glass}
            metalness={0.9}
            roughness={0.08}
            transparent
            opacity={0.92}
          />
        </mesh>

        {/* side skirts */}
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * 0.83, 0.3, 0]} castShadow>
            <boxGeometry args={[0.08, 0.16, 2.6]} />
            <meshStandardMaterial color={palette.trim} metalness={0.5} roughness={0.5} />
          </mesh>
        ))}

        {/* front splitter */}
        <mesh position={[0, 0.22, 2.12]} castShadow>
          <boxGeometry args={[1.72, 0.07, 0.34]} />
          <meshStandardMaterial color={palette.trim} metalness={0.4} roughness={0.6} />
        </mesh>

        {/* rear diffuser */}
        <mesh position={[0, 0.24, -2.14]} castShadow>
          <boxGeometry args={[1.66, 0.12, 0.3]} />
          <meshStandardMaterial color={palette.trim} metalness={0.4} roughness={0.6} />
        </mesh>

        {/* rear wing */}
        <group position={[0, 1.02, -1.92]}>
          <mesh castShadow>
            <boxGeometry args={[1.78, 0.07, 0.46]} />
            <meshStandardMaterial color={palette.trim} metalness={0.6} roughness={0.35} />
          </mesh>
          {[-0.7, 0.7].map((x) => (
            <mesh key={x} position={[x, -0.16, 0]}>
              <boxGeometry args={[0.07, 0.3, 0.14]} />
              <meshStandardMaterial color={palette.trim} metalness={0.5} roughness={0.45} />
            </mesh>
          ))}
        </group>

        {/* headlights */}
        {[-0.56, 0.56].map((x) => (
          <mesh key={`h${x}`} position={[x, 0.62, 2.24]}>
            <boxGeometry args={[0.44, 0.11, 0.05]} />
            <meshBasicMaterial color="#eafcff" toneMapped={false} />
          </mesh>
        ))}

        {/* tail light bar */}
        <mesh position={[0, 0.74, -2.22]}>
          <boxGeometry args={[1.4, 0.09, 0.05]} />
          <meshBasicMaterial color="#ff3b5c" toneMapped={false} />
        </mesh>

        {/* accent stripe along the flank */}
        {[-1, 1].map((side) => (
          <mesh key={`s${side}`} position={[side * 0.845, 0.52, 0.1]}>
            <boxGeometry args={[0.02, 0.06, 2.4]} />
            <meshBasicMaterial color={palette.accent} toneMapped={false} />
          </mesh>
        ))}

        {/* mirrors */}
        {[-1, 1].map((side) => (
          <mesh key={`m${side}`} position={[side * 0.86, 0.95, 0.5]}>
            <boxGeometry args={[0.2, 0.09, 0.13]} />
            <meshStandardMaterial color={palette.body} metalness={0.7} roughness={0.25} />
          </mesh>
        ))}
      </group>

      {/* wheels sit outside the body group so lean does not tilt them */}
      <Wheel position={[-0.86, 0.38, 1.32]} radius={0.38} width={0.26} palette={palette} steer={steerL} spin={spin} />
      <Wheel position={[0.86, 0.38, 1.32]} radius={0.38} width={0.26} palette={palette} steer={steerR} spin={spin} />
      <Wheel position={[-0.86, 0.38, -1.34]} radius={0.4} width={0.3} palette={palette} spin={spin} />
      <Wheel position={[0.86, 0.38, -1.34]} radius={0.4} width={0.3} palette={palette} spin={spin} />

      {showUnderglow && (
        <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[2.4, 4.6]} />
          <meshBasicMaterial color={palette.body} transparent opacity={0.14} toneMapped={false} />
        </mesh>
      )}
    </group>
  )
}

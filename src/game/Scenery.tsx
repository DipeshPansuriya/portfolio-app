import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { TrackSample } from './track'
import { distanceToTrack } from './track'
import { groundHeight } from './terrain'

/**
 * Deterministic pseudo-random so the island looks the same on every load
 * (a seeded LCG, not Math.random).
 */
function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

type Rock = {
  position: [number, number, number]
  scale: [number, number, number]
  rotation: number
  color: string
  emissive: boolean
}

function buildRocks(samples: TrackSample[]): Rock[] {
  const rand = rng(20261124)
  const out: Rock[] = []
  const palette = ['#16222f', '#1b2a3a', '#12202b', '#1f3243']

  for (let i = 0; i < 190; i++) {
    const x = (rand() - 0.5) * 300
    const z = -rand() * 300 + 30
    const d = distanceToTrack(x, z, samples)
    // Keep the driving corridor clear, cluster along its shoulders.
    if (d < 13) continue
    if (d > 110) continue
    const y = groundHeight(x, z, samples)
    const h = 0.8 + rand() * 4.6
    out.push({
      position: [x, y + h * 0.28, z],
      scale: [0.7 + rand() * 2.4, h, 0.7 + rand() * 2.4],
      rotation: rand() * Math.PI,
      color: palette[Math.floor(rand() * palette.length)],
      emissive: rand() > 0.86,
    })
  }
  return out
}

export function Scenery({ samples }: { samples: TrackSample[] }) {
  const rocks = useMemo(() => buildRocks(samples), [samples])

  return (
    <group>
      {rocks.map((r, i) => (
        <mesh
          key={i}
          position={r.position}
          scale={r.scale}
          rotation={[0, r.rotation, 0]}
          castShadow
          receiveShadow
        >
          <coneGeometry args={[0.62, 1.6, 5 + (i % 3)]} />
          <meshStandardMaterial
            color={r.color}
            roughness={0.95}
            metalness={0.12}
            emissive={r.emissive ? '#4dd6f7' : '#000000'}
            emissiveIntensity={r.emissive ? 0.55 : 0}
            flatShading
          />
        </mesh>
      ))}
    </group>
  )
}

/** Slow-drifting motes so the air reads as depth, not empty space. */
export function Motes({ count = 420 }: { count?: number }) {
  const points = useRef<THREE.Points>(null)

  const geometry = useMemo(() => {
    const rand = rng(77123)
    const pos = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rand() - 0.5) * 180
      pos[i * 3 + 1] = rand() * 26 + 1
      pos[i * 3 + 2] = -rand() * 220 + 20
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return g
  }, [count])

  useFrame((state, delta) => {
    if (!points.current) return
    points.current.rotation.y += delta * 0.012
    const pos = geometry.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 1] += Math.sin(state.clock.elapsedTime * 0.4 + i) * 0.004
    }
    pos.needsUpdate = true
  })

  return (
    <points ref={points} geometry={geometry}>
      <pointsMaterial
        size={0.14}
        color="#9fe9fb"
        transparent
        opacity={0.5}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

/** Vertical gradient dome — cheap, and it gives the horizon a colour. */
export function Sky() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uTop: { value: new THREE.Color('#04070c') },
          uBottom: { value: new THREE.Color('#08131d') },
          uGlow: { value: new THREE.Color('#12384c') },
        },
        vertexShader: /* glsl */ `
          varying vec3 vPos;
          void main() {
            vPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop;
          uniform vec3 uBottom;
          uniform vec3 uGlow;
          varying vec3 vPos;
          void main() {
            float h = clamp(normalize(vPos).y * 0.5 + 0.5, 0.0, 1.0);
            vec3 color = mix(uBottom, uTop, smoothstep(0.42, 0.92, h));
            float band = smoothstep(0.30, 0.52, h) * (1.0 - smoothstep(0.52, 0.68, h));
            color = mix(color, uGlow, band * 0.55);
            gl_FragColor = vec4(color, 1.0);
          }
        `,
      }),
    [],
  )

  return (
    <mesh material={material} scale={1}>
      <sphereGeometry args={[400, 32, 24]} />
    </mesh>
  )
}

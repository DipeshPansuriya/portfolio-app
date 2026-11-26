import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Gate, Track } from './track'
import {
  buildBarrierTransforms,
  buildRoadGeometry,
  buildStripeGeometry,
  fillBarriers,
  ROAD_HALF_WIDTH,
} from './track'
import { GANTRY, GATE, gateBarY } from './view'

/** Road surface, edge markings and barrier posts. */
export function Circuit({ track }: { track: Track }) {
  const road = useMemo(() => buildRoadGeometry(track), [track])
  const stripeL = useMemo(() => buildStripeGeometry(track, ROAD_HALF_WIDTH - 0.55, 0.16), [track])
  const stripeR = useMemo(() => buildStripeGeometry(track, -(ROAD_HALF_WIDTH - 0.55), 0.16), [track])
  const barriers = useMemo(() => buildBarrierTransforms(track), [track])

  const barrierRef = useRef<THREE.InstancedMesh>(null)

  // A layout effect, not render: the mesh does not exist until React commits it.
  useLayoutEffect(() => {
    if (barrierRef.current) fillBarriers(barrierRef.current, barriers)
  }, [barriers])

  return (
    <group>
      <mesh geometry={road} receiveShadow>
        <meshStandardMaterial color="#12161d" roughness={0.86} metalness={0.18} />
      </mesh>

      <mesh geometry={stripeL}>
        <meshBasicMaterial color="#4dd6f7" transparent opacity={0.55} toneMapped={false} />
      </mesh>
      <mesh geometry={stripeR}>
        <meshBasicMaterial color="#4dd6f7" transparent opacity={0.55} toneMapped={false} />
      </mesh>

      <instancedMesh
        ref={barrierRef}
        args={[undefined, undefined, barriers.length]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[0.3, 1, 0.9]} />
        <meshStandardMaterial color="#1d2836" roughness={0.7} metalness={0.35} />
      </instancedMesh>
    </group>
  )
}

/** Checkered start line plus a light gantry. */
export function StartLine({ track }: { track: Track }) {
  const texture = useMemo(() => {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    const cells = 8
    const cell = size / cells
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#e8fbff' : '#0a0f16'
        ctx.fillRect(x * cell, y * cell, cell, cell)
      }
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(6, 1)
    return tex
  }, [])

  const sample = track.samples[0]
  const heading = Math.atan2(sample.tangent.x, sample.tangent.z)

  return (
    <group position={[sample.pos.x, 0, sample.pos.z]} rotation={[0, heading, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <planeGeometry args={[ROAD_HALF_WIDTH * 2, 2.4]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>

      {/* gantry */}
      <group position={[0, 0, 0]}>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * (ROAD_HALF_WIDTH + 1.4), (GANTRY.beamY + 0.2) / 2, 0]} castShadow>
            <boxGeometry args={[0.4, GANTRY.beamY + 0.2, 0.4]} />
            <meshStandardMaterial color="#1d2836" metalness={0.5} roughness={0.5} />
          </mesh>
        ))}
        <mesh position={[0, GANTRY.beamY, 0]} castShadow>
          <boxGeometry args={[ROAD_HALF_WIDTH * 2 + 3.2, GANTRY.beamHeight, GANTRY.depth]} />
          <meshStandardMaterial
            color="#0d1620"
            emissive="#4dd6f7"
            emissiveIntensity={0.5}
            metalness={0.4}
            roughness={0.4}
          />
        </mesh>
      </group>
    </group>
  )
}

function makeGateTexture(label: string, color: string, hint: string) {
  const canvas = document.createElement('canvas')
  const w = 512
  const h = 192
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, w, h)

  ctx.fillStyle = 'rgba(5,6,10,0.86)'
  ctx.beginPath()
  ctx.roundRect(6, 6, w - 12, h - 12, 24)
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 4
  ctx.stroke()

  ctx.fillStyle = color
  ctx.font = '600 62px "Space Grotesk", system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // The last argument squeezes long text into the sign instead of cutting it off.
  ctx.fillText(label.toUpperCase(), w / 2, h / 2 - 18, w - 48)

  ctx.fillStyle = 'rgba(154,163,178,0.95)'
  ctx.font = '400 28px "JetBrains Mono", monospace'
  ctx.fillText(hint.toUpperCase(), w / 2, h / 2 + 40, w - 48)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

function GateArch({ gate, passed }: { gate: Gate; passed: boolean }) {
  const label = useRef<THREE.CanvasTexture | null>(null)
  if (!label.current) label.current = makeGateTexture(gate.label, gate.color, gate.hint)

  const pulse = useRef<THREE.Mesh>(null)
  const barY = gateBarY(gate.id)

  useFrame((state) => {
    if (!pulse.current) return
    const t = state.clock.elapsedTime
    const s = 1 + Math.sin(t * 2.2 + gate.index) * 0.06
    pulse.current.scale.setScalar(passed ? s * 1.1 : s)
  })

  return (
    <group position={[gate.position.x, 0, gate.position.z]} rotation={[0, gate.heading, 0]}>
      {/* arch posts */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (ROAD_HALF_WIDTH + 1.2), barY / 2, 0]} castShadow>
          <boxGeometry args={[0.36, barY, 0.36]} />
          <meshStandardMaterial
            color={passed ? gate.color : '#1d2836'}
            emissive={gate.color}
            emissiveIntensity={passed ? 1.4 : 0.15}
            metalness={0.5}
            roughness={0.45}
          />
        </mesh>
      ))}

      {/* top bar */}
      <mesh ref={pulse} position={[0, barY, 0]}>
        <boxGeometry args={[ROAD_HALF_WIDTH * 2 + 2.4, GATE.bar, GATE.bar]} />
        <meshStandardMaterial
          color={gate.color}
          emissive={gate.color}
          emissiveIntensity={passed ? 2.2 : 0.8}
          toneMapped={false}
        />
      </mesh>

      {/* floating label */}
      <sprite position={[0, barY + GATE.labelGap, 0]} scale={[6.4, GATE.labelHeight, 1]}>
        <spriteMaterial map={label.current} transparent depthWrite={false} toneMapped={false} />
      </sprite>

      {/* ground glow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <planeGeometry args={[ROAD_HALF_WIDTH * 2, 3.2]} />
        <meshBasicMaterial color={gate.color} transparent opacity={passed ? 0.3 : 0.1} toneMapped={false} />
      </mesh>
    </group>
  )
}

export function Gates({ gates, passed }: { gates: Gate[]; passed: Set<string> }) {
  return (
    <group>
      {gates.map((g) => (
        <GateArch key={g.id} gate={g} passed={passed.has(g.id)} />
      ))}
    </group>
  )
}

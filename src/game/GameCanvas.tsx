import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import { Car } from './Car'
import { Ground } from './Scene'
import { Circuit, Gates, StartLine } from './Circuit'
import { FOV } from './view'
import { Motes, Scenery, Sky } from './Scenery'
import { IntroCamera } from './IntroCamera'
import { buildTrack, type Gate } from './track'
import { getState, passGate, setState, teleportTo, useGameState } from './store'
import type { Chapter } from '../content/types'
import { usePrefersReducedMotion } from '../hooks/useMediaQuery'

type Props = {
  chapters: Chapter[]
  onGateChange?: (gate: Gate | null) => void
  onPass?: (id: string) => void
  /** The browser took the WebGL context away (GPU reset, too many contexts). */
  onContextLost?: () => void
}

export function GameCanvas({ chapters, onGateChange, onPass, onContextLost }: Props) {
  const track = useMemo(() => buildTrack(chapters), [chapters])
  const { phase, holding, discovered, runId } = useGameState()
  const passed = useMemo(() => new Set(discovered), [discovered])
  const reduced = usePrefersReducedMotion()
  const still = reduced && phase === 'intro'

  const activeRef = useRef<string | null>(null)
  const runRef = useRef(runId)

  const total = track.gates.length - 1

  // Dev-only hook so the lap can be exercised without driving it.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as Record<string, unknown>
    w.__island = {
      gates: track.gates.map((g) => ({ id: g.id, at: [g.position.x, 0, g.position.z] })),
      go: (x: number, z: number) => teleportTo([x, 0, z]),
    }
    return () => {
      delete w.__island
    }
  }, [track])

  const handleMove = useCallback(
    (pos: THREE.Vector3) => {
      if (getState().phase !== 'playing') return

      if (runRef.current !== getState().runId) {
        runRef.current = getState().runId
        activeRef.current = null
      }

      let found: Gate | null = null
      let best = Infinity
      for (const gate of track.gates) {
        const dx = pos.x - gate.position.x
        const dz = pos.z - gate.position.z
        const d = Math.hypot(dx, dz)
        if (d < 11 && d < best) {
          best = d
          found = gate
        }
      }

      const nextId = found?.id ?? null
      if (nextId !== activeRef.current) {
        activeRef.current = nextId
        setState({ activeZone: nextId })
        onGateChange?.(found)

        if (found && found.id !== '__start' && passGate(found.id, total)) onPass?.(found.id)
      }
    },
    [track, onGateChange, onPass, total],
  )

  return (
    <Canvas
      shadows
      // A still picture behind the intro card for visitors who asked for less motion.
      frameloop={still ? 'demand' : 'always'}
      dpr={[1, 1.6]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ position: [0, 14, 62], fov: FOV, near: 0.1, far: 900 }}
      onCreated={({ gl, scene }) => {
        gl.domElement.addEventListener('webglcontextlost', (event) => {
          event.preventDefault()
          // Unmounting also drops the context; only report it for a live canvas.
          if (gl.domElement.isConnected) onContextLost?.()
        })
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.05
        scene.fog = new THREE.Fog('#060b13', 150, 480)
      }}
    >
      <color attach="background" args={['#05060a']} />

      <hemisphereLight args={['#7fb6d8', '#05060a', 0.22]} />
      <ambientLight intensity={0.1} />
      <directionalLight
        position={[26, 34, 18]}
        intensity={2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-90}
        shadow-camera-right={90}
        shadow-camera-top={90}
        shadow-camera-bottom={-90}
      />
      <pointLight position={[0, 10, 40]} intensity={80} distance={140} color="#4dd6f7" />
      <pointLight position={[0, 10, -80]} intensity={80} distance={140} color="#8b7cf6" />

      <Sky />
      <Ground samples={track.samples} />
      <Scenery samples={track.samples} />
      <Motes />

      {phase === 'intro' && <IntroCamera track={track} still={still} />}

      <Circuit track={track} />
      <StartLine track={track} />
      <Gates gates={track.gates} passed={passed} />

      <Car track={track} onMove={handleMove} paused={phase !== 'playing' || holding} />
    </Canvas>
  )
}

import { Suspense, useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import { Core } from './Core'
import { ParticleField } from './ParticleField'
import { OrbitRings } from './OrbitRings'
import { TechRing } from './TechRing'
import type { StackItem } from '../content/types'
import { usePrefersReducedMotion } from '../hooks/useMediaQuery'

type Props = {
  className?: string
  dark?: boolean
  stack: StackItem[]
  /** True while the game covers the page. */
  covered?: boolean
}

export default function HeroScene({ className, dark = true, stack, covered = false }: Props) {
  const pointer = useRef({ x: 0, y: 0 })
  const box = useRef<HTMLDivElement>(null)
  const reduced = usePrefersReducedMotion()
  const [onScreen, setOnScreen] = useState(true)

  // Stop rendering once the scene is scrolled away.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // The hero wrapper ignores pointer events (so it never blocks the copy), so track on the window.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const rect = box.current?.getBoundingClientRect()
      if (!rect) return
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      const y = ((e.clientY - rect.top) / rect.height) * 2 - 1
      const inside = Math.abs(x) <= 1 && Math.abs(y) <= 1
      pointer.current.x = inside ? x : 0
      pointer.current.y = inside ? y : 0
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  return (
    <div ref={box} className={className} aria-hidden="true">
      <Canvas
        frameloop={onScreen && !covered ? 'always' : 'never'}
        dpr={[1, 1.75]}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
        }}
        camera={{ position: [0, 0.62, 7.2], fov: 40, near: 0.1, far: 40 }}
        style={{ pointerEvents: 'none' }}
      >
        <Suspense fallback={null}>
          <hemisphereLight args={['#9fd8ff', '#05060a', dark ? 0.28 : 0.7]} />
          <ambientLight intensity={dark ? 0.12 : 0.35} />
          <directionalLight position={[5, 8, 4]} intensity={dark ? 1.5 : 2.0} />
          <directionalLight position={[-6, 4, -5]} intensity={dark ? 0.7 : 1.0} color="#8b7cf6" />
          <directionalLight position={[0, 3, -8]} intensity={dark ? 0.5 : 0.8} color="#4dd6f7" />
          <pointLight position={[0, 1.4, 3.2]} intensity={dark ? 6 : 9} distance={9} color="#4dd6f7" />

          <group position={[0, 1.15, -3.4]}>
            <Core pointer={pointer} reduced={reduced} dark={dark} />
          </group>
          <ParticleField reduced={reduced} dark={dark} />
          <OrbitRings reduced={reduced} dark={dark} />
          <TechRing items={stack} reduced={reduced} />
        </Suspense>
      </Canvas>
    </div>
  )
}

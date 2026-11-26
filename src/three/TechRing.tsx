import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { iconPaths } from '../data/icon-paths'
import type { StackItem } from '../content/types'
import { ringScale } from './ringScale'

/**
 * The hero's orbiting tech ring.
 *
 * Each stack item becomes a sprite drawn from its simple-icons path — no
 * network requests, no DOM, and the icons stay crisp because the canvas is
 * rendered at 4× the sprite's on-screen size.
 */

const PALETTE = ['#4dd6f7', '#8b7cf6', '#f5b463', '#37d399', '#60a5fa', '#f472b6']

function makeIconTexture(slug: string, color: string) {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, size, size)

  const path = iconPaths[slug]
  if (!path) return null

  // Rounded tile behind the glyph.
  ctx.fillStyle = 'rgba(6,10,16,0.82)'
  ctx.beginPath()
  ctx.roundRect(8, 8, size - 16, size - 16, 28)
  ctx.fill()
  ctx.strokeStyle = `${color}66`
  ctx.lineWidth = 3
  ctx.stroke()

  ctx.save()
  ctx.translate(size / 2, size / 2)
  ctx.scale(size / 32, size / 32)
  ctx.translate(-12, -12)
  ctx.fillStyle = color
  ctx.fill(new Path2D(path))
  ctx.restore()

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

type RingProps = {
  items: StackItem[]
  radius: number
  tilt: [number, number, number]
  speed: number
  size: number
  y: number
  reduced: boolean
}

function Ring({ items, radius, tilt, speed, size, y, reduced }: RingProps) {
  const group = useRef<THREE.Group>(null)

  const textures = useMemo(
    () =>
      items.map((item, i) => ({
        key: `${item.icon}-${i}`,
        tex: makeIconTexture(item.icon, PALETTE[i % PALETTE.length]),
        size: size * ringScale(item.level),
      })),
    [items, size],
  )

  useFrame((_, delta) => {
    if (!group.current || reduced) return
    group.current.rotation.y += delta * speed
  })

  return (
    <group ref={group} rotation={tilt} position={[0, y, 0]}>
      {textures.map((t, i) => {
        if (!t.tex) return null
        const angle = (i / Math.max(1, textures.length)) * Math.PI * 2
        return (
          <sprite
            key={t.key}
            position={[Math.cos(angle) * radius, 0, Math.sin(angle) * radius]}
            scale={[t.size, t.size, 1]}
          >
            <spriteMaterial map={t.tex} transparent depthWrite={false} toneMapped={false} />
          </sprite>
        )
      })}
    </group>
  )
}

export function TechRing({ items, reduced }: { items: StackItem[]; reduced: boolean }) {
  // Split into three bands so the ring reads as a sphere, not a single hoop.
  const bands = useMemo(() => {
    const per = Math.ceil(items.length / 3)
    return [items.slice(0, per), items.slice(per, per * 2), items.slice(per * 2)]
  }, [items])

  return (
    <group position={[0, -0.1, 0]}>
      <Ring
        items={bands[0]}
        radius={2.35}
        tilt={[0.34, 0, 0.12]}
        speed={0.16}
        size={0.62}
        y={0.42}
        reduced={reduced}
      />
      <Ring
        items={bands[1]}
        radius={2.05}
        tilt={[-0.28, 0.6, -0.18]}
        speed={-0.21}
        size={0.56}
        y={-0.15}
        reduced={reduced}
      />
      <Ring
        items={bands[2]}
        radius={2.6}
        tilt={[0.16, -0.5, 0.24]}
        speed={0.12}
        size={0.52}
        y={-0.62}
        reduced={reduced}
      />
    </group>
  )
}

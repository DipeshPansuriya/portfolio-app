import { useEffect, useMemo } from 'react'
import type { TrackSample } from './track'
import { buildTerrainGeometry } from './terrain'

/** Terrain mesh, built once per circuit. */
export function Ground({ samples }: { samples: TrackSample[] }) {
  const geometry = useMemo(() => buildTerrainGeometry(samples), [samples])

  useEffect(() => {
    return () => {
      geometry.dispose()
    }
  }, [geometry])

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial vertexColors roughness={0.94} metalness={0.08} />
    </mesh>
  )
}

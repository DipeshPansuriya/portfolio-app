import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

type Props = {
  count?: number
  radius?: number
  reduced?: boolean
  dark?: boolean
}

/**
 * A shell of drifting particles around the core. Colours are sampled from the
 * site accent ramp so the field reads as part of the same system.
 */
export function ParticleField({ count = 1400, radius = 6.4, reduced = false, dark = true }: Props) {
  const points = useRef<THREE.Points>(null)
  const { viewport } = useThree()

  const { positions, colors, sizes, phases } = useMemo(() => {
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    const phases = new Float32Array(count)

    const palette = [
      new THREE.Color('#4dd6f7'),
      new THREE.Color('#8b7cf6'),
      new THREE.Color('#f5b463'),
      new THREE.Color('#cbd5e1'),
    ]

    const golden = Math.PI * (3 - Math.sqrt(5))

    for (let i = 0; i < count; i++) {
      // Fibonacci sphere with jitter for even coverage and no visible seams.
      const t = i / Math.max(1, count - 1)
      const y = 1 - t * 2
      const r = Math.sqrt(Math.max(0, 1 - y * y))
      const theta = golden * i

      const shell = radius * (0.42 + Math.pow(Math.random(), 0.6) * 0.72)
      const jitter = 0.94 + Math.random() * 0.12

      positions[i * 3] = Math.cos(theta) * r * shell * jitter
      positions[i * 3 + 1] = y * shell * jitter * 0.78
      positions[i * 3 + 2] = Math.sin(theta) * r * shell * jitter

      const c = palette[i % palette.length]
      const tint = 0.55 + Math.random() * 0.45
      colors[i * 3] = c.r * tint
      colors[i * 3 + 1] = c.g * tint
      colors[i * 3 + 2] = c.b * tint

      sizes[i] = 0.012 + Math.random() * 0.038
      phases[i] = Math.random() * Math.PI * 2
    }

    return { positions, colors, sizes, phases }
  }, [count, radius])

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    g.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    g.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))
    return g
  }, [positions, colors, sizes, phases])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: 1 },
          uOpacity: { value: 1 },
          uTint: { value: 1 },
        },
        vertexShader: /* glsl */ `
          attribute float aSize;
          attribute float aPhase;
          uniform float uTime;
          uniform float uPixelRatio;
          varying vec3 vColor;
          varying float vAlpha;

          void main() {
            vColor = color;
            vec3 p = position;

            float drift = sin(uTime * 0.35 + aPhase) * 0.09;
            p.y += drift;
            p.x += cos(uTime * 0.22 + aPhase * 1.7) * 0.07;

            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;

            float twinkle = 0.55 + 0.45 * sin(uTime * 1.4 + aPhase * 3.0);
            vAlpha = twinkle;

            gl_PointSize = aSize * uPixelRatio * (260.0 / max(0.001, -mv.z)) * (0.7 + twinkle * 0.6);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uOpacity;
          uniform float uTint;
          varying vec3 vColor;
          varying float vAlpha;

          void main() {
            vec2 uv = gl_PointCoord - 0.5;
            float d = length(uv);
            float mask = smoothstep(0.5, 0.06, d);
            if (mask < 0.01) discard;
            // Light theme needs darker grains; additive glow would wash out.
            vec3 tinted = mix(vColor * 0.22, vColor, uTint);
            gl_FragColor = vec4(tinted, mask * vAlpha * uOpacity);
          }
        `,
      }),
    [],
  )

  const blendingRef = useRef<boolean | null>(null)

  useFrame((state, delta) => {
    const d = Math.min(delta, 0.05)
    material.uniforms.uTime.value += reduced ? 0 : d
    material.uniforms.uPixelRatio.value = Math.min(2, state.gl.getPixelRatio())
    material.uniforms.uOpacity.value = THREE.MathUtils.lerp(
      material.uniforms.uOpacity.value,
      dark ? 1 : 0.62,
      0.06,
    )
    material.uniforms.uTint.value = THREE.MathUtils.lerp(
      material.uniforms.uTint.value,
      dark ? 1 : 0,
      0.06,
    )

    // Additive glow only reads on a dark ground; light theme needs normal alpha.
    if (blendingRef.current !== dark) {
      blendingRef.current = dark
      material.blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending
      material.needsUpdate = true
    }

    if (points.current) {
      points.current.rotation.y += reduced ? 0 : d * 0.035
      points.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.12) * 0.06
    }
  })

  const scale = Math.min(1.05, Math.max(0.7, viewport.height / 4.4))

  return <points ref={points} geometry={geometry} material={material} scale={scale} />
}

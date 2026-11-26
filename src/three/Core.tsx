import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}

float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uAmp;
uniform vec2 uPointer;

varying vec3 vNormalW;
varying vec3 vViewDir;
varying float vDisp;
varying vec3 vPos;

${NOISE}

void main() {
  vec3 pos = position;
  float n = snoise(pos * 1.35 + vec3(0.0, uTime * 0.16, uTime * 0.1));
  float n2 = snoise(pos * 3.1 - vec3(uTime * 0.12, 0.0, 0.0));
  float disp = (n * 0.62 + n2 * 0.24) * uAmp;

  vDisp = disp;
  pos += normal * disp;

  vec4 world = modelMatrix * vec4(pos, 1.0);
  vPos = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vViewDir = normalize(cameraPosition - world.xyz);

  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const fragmentShader = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform float uTime;
uniform float uOpacity;
uniform float uDark;

varying vec3 vNormalW;
varying vec3 vViewDir;
varying float vDisp;
varying vec3 vPos;

void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(vViewDir);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.4);

  float h = clamp(vPos.y * 0.22 + 0.5, 0.0, 1.0);
  vec3 base = mix(uColorA, uColorB, h);
  base = mix(base, uColorC, smoothstep(0.55, 1.0, fres) * 0.7);

  float bands = smoothstep(0.35, 0.9, abs(sin(vPos.y * 6.0 - uTime * 0.9))) * 0.16;

  // Dark theme: additive glow. Light theme: ink silhouette with an accent rim.
  vec3 dark = base * (0.24 + fres * 1.5 + bands);
  vec3 ink = vec3(0.035, 0.045, 0.07);
  vec3 lightBody = mix(ink, base, clamp(fres * 1.2, 0.0, 1.0) * 0.85);
  vec3 color = mix(lightBody, dark, uDark);

  float alpha = mix(0.62 + fres * 0.32, 0.14 + fres * 0.92, uDark) * uOpacity;

  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
}
`

type CoreProps = {
  pointer: React.RefObject<{ x: number; y: number }>
  reduced: boolean
  dark: boolean
}

export function Core({ pointer, reduced, dark }: CoreProps) {
  const mesh = useRef<THREE.Mesh>(null)
  const wire = useRef<THREE.Mesh>(null)
  const { viewport } = useThree()

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAmp: { value: 0.24 },
      uPointer: { value: new THREE.Vector2(0, 0) },
      uColorA: { value: new THREE.Color('#4dd6f7') },
      uColorB: { value: new THREE.Color('#8b7cf6') },
      uColorC: { value: new THREE.Color('#f5b463') },
      uOpacity: { value: 1 },
      uDark: { value: 1 },
    }),
    [],
  )

  // Fit the sphere to the canvas height so it reads the same at any breakpoint.
  const scale = Math.min(0.78, Math.max(0.42, viewport.height / 6.4))

  useFrame((state, delta) => {
    const d = Math.min(delta, 0.05)
    uniforms.uTime.value += reduced ? 0 : d
    uniforms.uDark.value = THREE.MathUtils.lerp(uniforms.uDark.value, dark ? 1 : 0, 0.08)

    const px = pointer.current?.x ?? 0
    const py = pointer.current?.y ?? 0

    if (mesh.current) {
      mesh.current.rotation.y += d * (reduced ? 0 : 0.12)
      mesh.current.rotation.x = THREE.MathUtils.lerp(mesh.current.rotation.x, py * 0.22, 0.04)
      mesh.current.rotation.z = THREE.MathUtils.lerp(mesh.current.rotation.z, -px * 0.14, 0.04)
      const breathe = 1 + Math.sin(state.clock.elapsedTime * 0.7) * 0.012
      mesh.current.scale.setScalar(scale * breathe)
    }
    if (wire.current) {
      wire.current.rotation.y -= d * (reduced ? 0 : 0.05)
      wire.current.rotation.x = mesh.current?.rotation.x ?? 0
      wire.current.rotation.z = mesh.current?.rotation.z ?? 0
      wire.current.scale.setScalar(scale * 1.045)
    }
  })

  return (
    <group>
      <mesh ref={mesh} scale={scale}>
        <icosahedronGeometry args={[1, 48]} />
        <shaderMaterial
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={dark ? THREE.AdditiveBlending : THREE.NormalBlending}
        />
      </mesh>

      <mesh ref={wire} scale={scale}>
        <icosahedronGeometry args={[1.02, 2]} />
        <meshBasicMaterial
          color={dark ? '#7fe6ff' : '#0e7490'}
          wireframe
          transparent
          opacity={dark ? 0.11 : 0.16}
          blending={dark ? THREE.AdditiveBlending : THREE.NormalBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

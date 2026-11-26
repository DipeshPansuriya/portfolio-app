import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { readInput, consumeLook } from './useControls'
import { commands, getState, telemetry } from './store'
import { isBoosting, stepSpeed, BOOST_SPEED, MAX_SPEED } from './physics'
import { CarModel, DEFAULT_PALETTE } from '../three/CarModel'
import type { Track } from './track'
import { ROAD_HALF_WIDTH, WALL_HALF_WIDTH } from './track'
import { CHASE } from './view'

const STEER_RATE = 2.5
const OFFROAD_DRAG = 2.6

type Props = {
  track: Track
  onMove?: (pos: THREE.Vector3, heading: number) => void
  paused?: boolean
}

export function Car({ track, onMove, paused = false }: Props) {
  const root = useRef<THREE.Group>(null)
  const { camera } = useThree()

  const start = track.samples[0]

  const startState = () => ({
    x: start.pos.x,
    z: start.pos.z,
    heading: Math.atan2(start.tangent.x, start.tangent.z),
    speed: 0,
    steer: 0,
    drift: 0,
  })

  const s = useRef(startState())
  const run = useRef(getState().runId)

  const wheelSpin = useRef(0)
  const steerAngle = useRef(0)
  const lean = useRef({ roll: 0, pitch: 0 })

  const camYaw = useRef(0)
  const camPos = useMemo(() => new THREE.Vector3(), [])
  const camTarget = useMemo(() => new THREE.Vector3(), [])
  const desired = useMemo(() => new THREE.Vector3(), [])
  const look = useMemo(() => new THREE.Vector3(), [])
  const seeded = useRef(false)

  useFrame((_, delta) => {
    const st = s.current

    // A new or reset run puts the car back on the start line.
    const { runId } = getState()
    if (runId !== run.current) {
      run.current = runId
      Object.assign(st, startState())
      commands.teleportTo = null
      camYaw.current = 0
      seeded.current = false
      wheelSpin.current = 0
      steerAngle.current = 0
      telemetry.speed = 0
      telemetry.boosting = false
      root.current?.position.set(st.x, 0, st.z)
      if (root.current) root.current.rotation.y = st.heading
    }

    // Fast travel applies even while the car is held at a gate.
    const jumped = commands.teleportTo
    if (jumped) {
      st.x = jumped[0]
      st.z = jumped[2]
      st.speed = 0
      commands.teleportTo = null
      seeded.current = false
    }

    if (paused) {
      // Held or finished: the car stands still, whatever speed it will resume with.
      telemetry.speed = 0
      telemetry.boosting = false
      if (jumped && root.current) {
        root.current.position.set(st.x, 0, st.z)
        const yaw = st.heading + Math.PI
        camera.position.set(st.x + Math.sin(yaw) * CHASE.back, CHASE.height, st.z + Math.cos(yaw) * CHASE.back)
        camera.lookAt(st.x, CHASE.lookY, st.z)
        onMove?.(root.current.position, st.heading)
      }
      return
    }

    const dt = Math.min(delta, 1 / 30)
    const input = readInput()
    const look2 = consumeLook()

    camYaw.current -= look2.x * 0.003

    // --- longitudinal ---
    const boosting = isBoosting(st.speed, input)
    const topSpeed = boosting ? BOOST_SPEED : MAX_SPEED
    st.speed = stepSpeed(st.speed, input, dt)

    // --- steering: speed-sensitive, reversed when backing up ---
    const gripFactor = THREE.MathUtils.clamp(Math.abs(st.speed) / 8, 0, 1)
    const turn = (input.left ? 1 : 0) - (input.right ? 1 : 0)
    st.steer = THREE.MathUtils.lerp(st.steer, turn, 1 - Math.pow(0.001, dt))

    const dir = st.speed >= 0 ? 1 : -1
    const turnRate = STEER_RATE * gripFactor * dir * (1 - Math.min(0.45, Math.abs(st.speed) / (topSpeed * 2.4)))
    st.heading += st.steer * turnRate * dt

    // --- drift: lateral slip that decays ---
    st.drift = THREE.MathUtils.lerp(st.drift, st.steer * gripFactor * 0.55, 1 - Math.pow(0.002, dt))

    // --- integrate ---
    const fwdX = Math.sin(st.heading)
    const fwdZ = Math.cos(st.heading)
    const rightX = Math.cos(st.heading)
    const rightZ = -Math.sin(st.heading)

    st.x += (fwdX * st.speed + rightX * st.drift * st.speed * 0.35) * dt
    st.z += (fwdZ * st.speed + rightZ * st.drift * st.speed * 0.35) * dt

    // --- off-road: bleed speed when outside the road width ---
    const lateral = Math.abs(nearestLateral(st.x, st.z, track))
    if (lateral > ROAD_HALF_WIDTH) {
      st.speed -= Math.sign(st.speed) * OFFROAD_DRAG * dt * 4
    }
    // --- barriers: hard clamp at the wall ---
    if (lateral > WALL_HALF_WIDTH) {
      const push = lateral - WALL_HALF_WIDTH
      const n = nearestNormal(st.x, st.z, track)
      st.x -= n.x * Math.sign(nearestLateral(st.x, st.z, track)) * push
      st.z -= n.z * Math.sign(nearestLateral(st.x, st.z, track)) * push
      st.speed *= 0.72
    }

    // --- transform ---
    if (root.current) {
      root.current.position.set(st.x, 0, st.z)
      root.current.rotation.y = st.heading
    }
    lean.current.roll = -st.steer * 0.075 * gripFactor
    lean.current.pitch = boosting ? -0.03 : 0.006
    wheelSpin.current = st.speed * 2.6
    steerAngle.current = st.steer * 0.42

    // --- telemetry ---
    telemetry.x = st.x
    telemetry.y = 0
    telemetry.z = st.z
    telemetry.heading = st.heading
    telemetry.speed = Math.abs(st.speed)
    telemetry.maxSpeed = MAX_SPEED
    telemetry.grounded = true
    telemetry.boosting = boosting

    onMove?.(root.current?.position ?? camTarget.set(st.x, 0, st.z), st.heading)

    // --- chase camera ---
    const { back, height, lookAhead, lookY } = CHASE
    const yaw = st.heading + Math.PI + camYaw.current
    desired.set(st.x + Math.sin(yaw) * back, height, st.z + Math.cos(yaw) * back)

    if (!seeded.current) {
      camPos.copy(desired)
      camTarget.set(st.x, 1, st.z)
      seeded.current = true
    }
    camPos.lerp(desired, 1 - Math.pow(0.0009, dt))
    camera.position.copy(camPos)

    look.set(st.x + fwdX * lookAhead, lookY, st.z + fwdZ * lookAhead)
    camTarget.lerp(look, 1 - Math.pow(0.0006, dt))
    camera.lookAt(camTarget)
  })

  return (
    <group ref={root} position={[start.pos.x, 0, start.pos.z]}>
      <CarModel
        palette={DEFAULT_PALETTE}
        spin={wheelSpin}
        steer={steerAngle}
        lean={lean}
      />
    </group>
  )
}

/** Signed lateral offset from the centre line (positive = left). */
function nearestLateral(x: number, z: number, track: Track) {
  let best = Infinity
  let lateral = 0
  for (const sample of track.samples) {
    const dx = x - sample.pos.x
    const dz = z - sample.pos.z
    const d = dx * dx + dz * dz
    if (d < best) {
      best = d
      lateral = dx * sample.normal.x + dz * sample.normal.z
    }
  }
  return lateral
}

function nearestNormal(x: number, z: number, track: Track) {
  let best = Infinity
  let normal = track.samples[0].normal
  for (const sample of track.samples) {
    const dx = x - sample.pos.x
    const dz = z - sample.pos.z
    const d = dx * dx + dz * dz
    if (d < best) {
      best = d
      normal = sample.normal
    }
  }
  return normal
}

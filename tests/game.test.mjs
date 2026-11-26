/** Pure game and content logic. Run with `npm test` (node:test, no extra packages). */
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import * as store from '../src/game/store.ts'
import { classifyKey } from '../src/game/useControls.ts'
import { stepSpeed } from '../src/game/physics.ts'
import { createGateHold } from '../src/game/hold.ts'
import { buildTrack, buildBarrierTransforms, fillBarriers } from '../src/game/track.ts'
import { splitHeadline, countWord, anchorFor } from '../src/content/text.ts'
import { shapeProblem } from '../src/content/validate.ts'

const el = (tagName, extra = {}) => ({ tagName, closest: () => null, isContentEditable: false, ...extra })
/** An element that sits inside (or is) a button/link. */
const control = (tagName) => {
  const node = el(tagName)
  node.closest = (sel) =>
    sel.split(',').some((s) => s.trim().split('[')[0] === tagName.toLowerCase()) ? node : null
  return node
}
const key = (code, extra = {}) => ({ code, metaKey: false, ctrlKey: false, altKey: false, target: el('BODY'), ...extra })

test('P0-1: browser shortcuts are never taken', () => {
  for (const mod of ['metaKey', 'ctrlKey', 'altKey']) {
    for (const code of ['KeyR', 'KeyP', 'KeyE', 'Enter', 'KeyW']) {
      assert.equal(classifyKey(key(code, { [mod]: true })), null, `${mod}+${code}`)
    }
  }
})

test('P0-1/P1-13: Enter and Space stay with a focused control or field', () => {
  for (const tag of ['BUTTON', 'A', 'INPUT', 'TEXTAREA']) {
    assert.equal(classifyKey(key('Enter', { target: control(tag) })), null, tag)
    assert.equal(classifyKey(key('Space', { target: control(tag) })), null, tag)
  }
  assert.equal(classifyKey(key('KeyW', { target: control('INPUT') })), null, 'typing is not driving')
  assert.equal(classifyKey(key('KeyW', { target: control('BUTTON') })).drive, 'forward')
})

test('game keys still work on the page body', () => {
  assert.equal(classifyKey(key('Enter')).action, 'interact')
  assert.equal(classifyKey(key('Escape', { target: control('BUTTON') })).action, 'close')
  const space = classifyKey(key('Space'))
  assert.equal(space.drive, 'brake')
  assert.equal(space.preventDefault, true)
  assert.equal(classifyKey(key('ArrowDown')).preventDefault, true)
  assert.equal(classifyKey(key('Tab')), null)
})

const input = (extra = {}) => ({ forward: false, back: false, brake: false, boost: false, ...extra })

test('P1-12: brake slows the car to a stop and never reverses', () => {
  let speed = 40
  for (let i = 0; i < 120; i++) speed = stepSpeed(speed, input({ brake: true, forward: true }), 1 / 60)
  assert.equal(speed, 0)
  let reverse = -9
  for (let i = 0; i < 60; i++) reverse = stepSpeed(reverse, input({ brake: true }), 1 / 60)
  assert.equal(reverse, 0)
  assert.ok(stepSpeed(10, input({ forward: true }), 1 / 60) > 10)
})

const finishLap = (ids) => ids.forEach((id) => store.passGate(id, ids.length))

test('P0-3: win, race again, win', () => {
  const ids = ['a', 'b', 'c']
  store.startRun()
  const first = store.getState().runId
  finishLap(ids)
  assert.equal(store.getState().phase, 'won')

  store.startRun()
  assert.notEqual(store.getState().runId, first)
  assert.deepEqual(store.getState().discovered, [])
  finishLap(ids)
  assert.equal(store.getState().phase, 'won')
  assert.deepEqual(store.getState().discovered, ids)
})

test('P0-3: HUD reset clears the gates and bumps the run id', () => {
  store.startRun()
  store.passGate('a', 3)
  const before = store.getState().runId
  store.resetGame()
  assert.equal(store.getState().runId, before + 1)
  assert.deepEqual(store.getState().discovered, [])
  assert.equal(store.passGate('a', 3), false, 'no gates outside a run')
  store.startRun()
  assert.equal(store.passGate('a', 3), true)
  assert.equal(store.passGate('a', 3), false, 'a gate counts once')
})

test('P2-8: a lap that used fast travel never sets the best time', () => {
  store.startRun()
  store.clock.elapsed = 50_000
  finishLap(['a'])
  const best = store.getState().bestMs
  store.startRun()
  store.markAssisted()
  store.clock.elapsed = 1
  finishLap(['a'])
  assert.equal(store.getState().bestMs, best)
  store.startRun()
  assert.equal(store.getState().assisted, false)
})

test('P2-9: blocked storage does not break the store', async () => {
  globalThis.window = {
    get localStorage() {
      throw new Error('SecurityError')
    },
  }
  try {
    const blocked = await import('../src/game/store.ts?blocked')
    blocked.startRun()
    blocked.passGate('a', 1)
    assert.equal(blocked.getState().phase, 'won')
  } finally {
    delete globalThis.window
  }
})

test('P1-14: gate hold pauses, resumes, finishes and cancels', () => {
  mock.timers.enable({ apis: ['setInterval'] })
  try {
    let done = 0
    let left = null
    const hold = createGateHold({ seconds: 5, onTick: (s) => (left = s), onDone: () => done++ })
    hold.start()
    mock.timers.tick(1000)
    assert.equal(left, 4)
    hold.setPaused('hover', true)
    mock.timers.tick(60_000)
    assert.equal(left, 4)
    assert.equal(hold.isPaused(), true)
    hold.setPaused('focus', true)
    hold.setPaused('hover', false)
    assert.equal(hold.isPaused(), true, 'focus still holds it')

    // A new gate must not inherit a stale pause (the car used to freeze).
    hold.start()
    assert.equal(hold.isPaused(), false)
    mock.timers.tick(5000)
    assert.equal(done, 1)

    hold.setPaused('hover', true)
    hold.start()
    hold.end()
    assert.equal(done, 2, 'closing the card releases the car')
    hold.end()
    assert.equal(done, 2)

    hold.start()
    hold.cancel()
    mock.timers.tick(10_000)
    assert.equal(done, 2)
  } finally {
    mock.timers.reset()
  }
})

const chapters = ['one', 'two'].map((id) => ({ id, label: id, kicker: id, hint: id, accent: '#ffffff' }))

test('P1-5: barrier instances are spread around the track', () => {
  const transforms = buildBarrierTransforms(buildTrack(chapters))
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), transforms.length)
  fillBarriers(mesh, transforms)
  const m = new THREE.Matrix4()
  const seen = new Set()
  for (let i = 0; i < transforms.length; i++) {
    mesh.getMatrixAt(i, m)
    const p = new THREE.Vector3().setFromMatrixPosition(m)
    seen.add(`${p.x.toFixed(2)},${p.z.toFixed(2)}`)
  }
  assert.ok(transforms.length > 20)
  assert.equal(seen.size, transforms.length)
  assert.ok(mesh.boundingSphere.radius > 40)
  assert.ok(mesh.instanceMatrix.version > 0)
})

test('P1-6: headline split and chapter count come from content', () => {
  assert.deepEqual(splitHeadline('I build systems that move data.'), ['I build systems', 'that move data.'])
  assert.deepEqual(splitHeadline('Ship it | every day'), ['Ship it', 'every day'])
  assert.deepEqual(splitHeadline('Hello there'), ['', 'Hello there'])
  assert.deepEqual(splitHeadline('Trailing |'), ['Trailing', ''])
  assert.equal(countWord(5), 'five')
  assert.equal(countWord(14), '14')
  assert.equal(anchorFor([{ id: 'intro' }]), 'intro')
  assert.equal(anchorFor([]), 'main')
})

test('P2-15: content that would crash a section is refused', () => {
  const good = JSON.parse(readFileSync(new URL('../content/site.json', import.meta.url), 'utf8'))
  assert.equal(shapeProblem(good), null)
  assert.match(shapeProblem({ ...good, contact: undefined }), /contact/)
  assert.match(shapeProblem({ ...good, profile: { ...good.profile, socials: undefined } }), /socials/)
  assert.match(shapeProblem({ ...good, stats: [null] }), /stats/)
  assert.match(shapeProblem(null), /root/)
})

test('P1-4: raw JSON with objects or gaps where text belongs is refused', () => {
  const good = JSON.parse(readFileSync(new URL('../content/site.json', import.meta.url), 'utf8'))
  const bad = (edit) => {
    const copy = structuredClone(good)
    edit(copy)
    return shapeProblem(copy)
  }
  assert.equal(shapeProblem(good), null)
  assert.match(shapeProblem({}), /profile/)
  assert.match(bad((c) => (c.profile = { socials: [] })), /profile\.name/)
  assert.match(bad((c) => (c.chapters[0].label = {})), /chapters\[0\]\.label/)
  assert.match(bad((c) => delete c.chapters[0].title), /chapters\[0\]\.title/)
  assert.match(bad((c) => (c.chapters[0].bullets = [{}])), /bullets/)
  assert.match(bad((c) => (c.stats[0].value = 13)), /stats\[0\]\.value/)
  assert.match(bad((c) => delete c.contact.heading), /contact\.heading/)
  assert.match(bad((c) => delete c.principles[0].body), /principles\[0\]\.body/)
  assert.match(bad((c) => delete c.stack[0].name), /stack\[0\]\.name/)
  assert.match(bad((c) => (c.stack[0].level = 'x')), /stack\[0\]\.level/)
  // Empty strings are what the admin "Add" buttons create: still applicable, the server rejects them on save.
  assert.equal(bad((c) => (c.chapters[0].title = '')), null)
})

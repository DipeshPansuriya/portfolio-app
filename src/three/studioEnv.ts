import * as THREE from 'three'

/**
 * A procedural studio environment, generated once per renderer.
 *
 * Metallic materials need something to reflect — without an environment map a
 * `metalness: 0.7` surface renders almost black. This builds a small gradient
 * room (bright sky band, dark floor, two coloured softboxes) into a PMREM cube
 * so every car reads with proper highlights, with no network request.
 */
// A texture belongs to one WebGL context: reopening the game makes a new renderer.
const cache = new WeakMap<THREE.WebGLRenderer, THREE.Texture>()

export function getStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const cached = cache.get(renderer)
  if (cached) return cached

  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  // Vertical gradient: cool sky at the top, near-black floor at the bottom.
  const grad = ctx.createLinearGradient(0, 0, 0, size)
  grad.addColorStop(0, '#cfe9ff')
  grad.addColorStop(0.42, '#6f8fa8')
  grad.addColorStop(0.55, '#243444')
  grad.addColorStop(1, '#05080d')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)

  // Softboxes: two bright bands that give the bodywork a long highlight.
  const band = (x: number, y: number, w: number, h: number, color: string, alpha: number) => {
    const g = ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, Math.max(w, h) / 1.6)
    g.addColorStop(0, color)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.globalAlpha = alpha
    ctx.fillStyle = g
    ctx.fillRect(x, y, w, h)
    ctx.globalAlpha = 1
  }

  band(10, 24, size - 20, 54, '#ffffff', 0.95)
  band(-30, 96, 150, 90, '#4dd6f7', 0.6)
  band(size - 120, 96, 150, 90, '#8b7cf6', 0.55)
  band(60, 150, size - 120, 60, '#f5b463', 0.25)

  const texture = new THREE.CanvasTexture(canvas)
  texture.mapping = THREE.EquirectangularReflectionMapping
  texture.colorSpace = THREE.SRGBColorSpace

  const pmrem = new THREE.PMREMGenerator(renderer)
  pmrem.compileEquirectangularShader()
  const env = pmrem.fromEquirectangular(texture).texture
  pmrem.dispose()
  texture.dispose()

  cache.set(renderer, env)
  return env
}

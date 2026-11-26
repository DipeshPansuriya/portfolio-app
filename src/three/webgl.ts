let supported: boolean | null = null

/** three.js needs WebGL 2. Probed once; the probe context is released straight away. */
export function hasWebGL(): boolean {
  if (supported !== null) return supported
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    supported = Boolean(gl)
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    supported = false
  }
  return supported
}

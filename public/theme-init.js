// Applies the theme before first paint: the saved choice, otherwise the OS preference.
// External file because the CSP blocks inline scripts.
;(function () {
  var theme = null
  try {
    theme = localStorage.getItem('dp-theme')
  } catch (e) {
    /* storage blocked: fall through to the OS preference */
  }
  if (theme !== 'light' && theme !== 'dark') {
    theme = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  if (theme === 'light') {
    document.documentElement.classList.replace('dark', 'light')
    document.documentElement.style.colorScheme = 'light'
    var meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', '#f5f4f0')
  }
})()

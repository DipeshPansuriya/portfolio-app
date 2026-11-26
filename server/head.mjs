/**
 * The parts of `index.html` that a crawler, a link preview or a browser without
 * scripts reads, filled from the live content. The template marks each such tag
 * with `data-content="<name>"`; a tag with no value here keeps its built-in text.
 */
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
/** Safe as element text and inside a double-quoted attribute. */
const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ENTITIES[c])

/** One marked element: a void `<meta>`, or an element with its closing tag. */
const marked = (name) =>
  new RegExp(`<meta\\b[^>]*\\bdata-content="${name}"[^>]*>|<(title|script|p)\\b[^>]*\\bdata-content="${name}"[^>]*>[\\s\\S]*?</\\1>`)

function tags({ profile, meta = {} }) {
  const title = escape(`${profile.name} — ${profile.role}`)
  const web = profile.socials.filter((s) => /^https?:\/\//.test(s.href))
  const person = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: profile.name,
    jobTitle: profile.role,
    ...(web.length ? { sameAs: web.map((s) => s.href) } : {}),
  }
  const link = (href, text) => `<a href="${escape(href)}">${escape(text)}</a>`
  const without = web.length
    ? `${link(web[0].href, `the ${web[0].label} profile`)} works without it.`
    : `email ${link(`mailto:${profile.email}`, profile.email)} instead.`
  return {
    title: `<title>${title}</title>`,
    'og:title': `<meta property="og:title" content="${title}" />`,
    description: meta.description?.trim() && `<meta name="description" content="${escape(meta.description)}" />`,
    'og:description':
      meta.shareDescription?.trim() && `<meta property="og:description" content="${escape(meta.shareDescription)}" />`,
    // With no `<` left, no value can close the script element.
    person: `<script type="application/ld+json">${JSON.stringify(person).replaceAll('<', '\\u003c')}</script>`,
    noscript: `<p style="padding: 2rem; font-family: sans-serif">${escape(`${profile.name}, ${profile.role}`)}. This portfolio needs JavaScript; ${without}</p>`,
  }
}

export function fillHead(html, content) {
  // A page with no marked tag has nothing to fill.
  if (!html.includes('data-content=')) return html
  return Object.entries(tags(content)).reduce(
    // A function, so `$&` and friends in the content are not replacement patterns.
    (page, [name, tag]) => (tag ? page.replace(marked(name), () => tag) : page),
    html,
  )
}

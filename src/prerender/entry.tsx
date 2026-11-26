/** Server bundle (`vite build --ssr`), loaded by `server/shell.mjs`. */
import { renderToStaticMarkup } from 'react-dom/server'
import type { SiteContent } from '../content/types'
import { HeroShell } from './HeroShell'

export const render = (content: SiteContent) => renderToStaticMarkup(<HeroShell content={content} />)

import './lib/web-mock'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
import './styles/index.css'
import './styles/base.css'
import './styles/components.css'
import './styles/ai.css'
import './styles/extra.css'
import './styles/low-power.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { DetachedApp, detachedTabIdFromUrl } from './app/DetachedApp'
import { applyLanguage, useI18n } from './lib/i18n'

const detachedTabId = detachedTabIdFromUrl()

// Load the stored UI language before the first render: switching it later
// remounts the tree, and doing that mid-bootstrap would restart bootstrap.
try {
  const settings = await window.api.storageLoad('settings')
  await applyLanguage(settings?.language || 'ru')
} catch {
  // No settings yet (or no main process in browser preview) — stay Russian.
}

/**
 * `tr()` reads the active catalog synchronously — including from module-level
 * constants — so switching language remounts the tree instead of trying to make
 * every call site reactive. The epoch key does exactly that, once per switch.
 */
function Root(): JSX.Element {
  const epoch = useI18n((s) => s.epoch)
  return (
    <div key={epoch} style={{ display: 'contents' }}>
      {detachedTabId ? <DetachedApp tabId={detachedTabId} /> : <App />}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
)

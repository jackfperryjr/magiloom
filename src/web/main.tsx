import React from 'react'
import ReactDOM from 'react-dom/client'
import { installDr } from './dr'
import { setupPush } from './push'
import { startUpdateChecks } from './updater'

// Install the WebSocket-backed window.dr BEFORE importing the app: App.tsx reads
// window.dr.app.platform at module-evaluation time, so it must exist first. The
// dynamic import guarantees that ordering.
installDr()
setupPush()
startUpdateChecks()

import('../renderer/src/App').then(({ default: App }) => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})

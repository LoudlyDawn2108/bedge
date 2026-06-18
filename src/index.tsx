/* @refresh reload */
import { render } from 'solid-js/web'
import './index.css'
import App from './App.tsx'

function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) {
    return
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('Service Worker registered:', registration)
      })
      .catch((error) => {
        console.error('Service Worker registration failed:', error)
      })
  })
}

const root = document.getElementById('root')

render(() => <App />, root!)
registerServiceWorker()

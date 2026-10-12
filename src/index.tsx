/* @refresh reload */
import { render } from 'solid-js/web'
import './index.css'
import App from './App.tsx'

function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) {
    return
  }

  window.addEventListener('load', () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`
    navigator.serviceWorker.register(swUrl, { scope: import.meta.env.BASE_URL })
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

/* global firebase */
importScripts('https://www.gstatic.com/firebasejs/11.6.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/11.6.0/firebase-messaging-compat.js')

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(self.clients.openWindow('/supervisor'))
})

fetch('/firebase-config.json')
  .then((response) => response.json())
  .then((config) => {
    if (!config.apiKey || !config.projectId) return
    firebase.initializeApp(config)
    const messaging = firebase.messaging()
    messaging.onBackgroundMessage((payload) => {
      const title = payload.notification?.title || 'Supervisor alert'
      const body = payload.notification?.body || ''
      self.registration.showNotification(title, { body, icon: '/favicon.ico' })
    })
  })
  .catch(() => {})

// Runs in Relay's plugin sandbox on every click of the "hello" button.
relay.on('button:hello', () => {
  relay.toast('Привет из плагина!', 'ok')
})

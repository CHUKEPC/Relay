// The `request` hook runs before every send and may change the request.
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

relay.on('request', () => {
  const name = relay.config.headerName || 'X-Request-Id'
  relay.request.setHeader(name, uuid())
})

#!/usr/bin/env node
/**
 * Demo service «Интернет-магазин API» (online shop API) for the Relay examples
 * in getting-started/demo and for the thesis chapter 4.
 *
 * Run (only Node.js 18+ is needed, no dependencies):
 *   node demo-server.mjs            or   getting-started/<system>/3-demo-server
 *
 * It starts two stands, matching the two Relay environments:
 *   «Локальный стенд» (local stand)  http://127.0.0.1:8470
 *   «Тестовый стенд»  (test stand)   http://127.0.0.1:8471
 * Both listen on 127.0.0.1 only; data lives in memory and resets on restart.
 * Other ports: node demo-server.mjs 9000 9001
 *
 * Credentials: login tester / password secret; OAuth 2.0 client relay-desktop / demo-secret.
 *
 * Endpoints:
 *   POST   /auth/login                     sign in with login and password → access_token (Bearer)
 *   GET    /api/v1/products?category&limit product catalogue          (Bearer)
 *   GET    /api/v1/products/:id            one product                (Bearer)
 *   POST   /api/v1/orders                  create an order → 201      (Bearer; Idempotency-Key)
 *   GET    /api/v1/orders/:id              read an order              (Bearer)
 *   DELETE /api/v1/orders/:id              cancel an order → 204      (Bearer)
 *   GET    /health                         availability check
 *   POST   /oauth/token                    OAuth 2.0 client_credentials (payment gateway)
 *   POST   /pay/v1/payments                create a payment → 201     (OAuth 2.0 token)
 *   GET    /pay/v1/payments/:id            payment status             (OAuth 2.0 token)
 */
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'

const USERS = { tester: 'secret' }
const OAUTH_CLIENTS = { 'relay-desktop': 'demo-secret' }
const TOKEN_TTL = 3600

const CATALOG = [
  { id: 101, name: 'Ноутбук «Горизонт 14»', category: 'electronics', price: 74990, stock: 12 },
  { id: 102, name: 'Монитор 27" IPS', category: 'electronics', price: 21990, stock: 7 },
  { id: 103, name: 'Клавиатура механическая', category: 'electronics', price: 5490, stock: 25 },
  { id: 104, name: 'Мышь беспроводная', category: 'electronics', price: 1890, stock: 40 },
  { id: 105, name: 'Наушники «Тишина»', category: 'electronics', price: 8990, stock: 15 },
  { id: 201, name: 'Рюкзак городской', category: 'accessories', price: 3490, stock: 30 },
  { id: 202, name: 'Термокружка', category: 'accessories', price: 1290, stock: 55 },
  { id: 301, name: 'Книга «Тестирование API»', category: 'books', price: 1590, stock: 9 }
]

/** One stand = one port with its own users' tokens, orders and payments. */
function createStand(name, slug, port, firstOrderId) {
  const tokens = new Map() // token -> { user, expires }
  const oauthTokens = new Map() // token -> { client, expires }
  const orders = new Map()
  const idempotency = new Map() // key -> order id
  const payments = new Map()
  let nextOrderId = firstOrderId
  const started = Date.now()

  const send = (res, status, body, headers = {}) => {
    const text = body === undefined ? '' : JSON.stringify(body, null, 2)
    res.writeHead(status, {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
      'X-Demo-Stand': slug,
      'Cache-Control': 'no-store',
      ...headers
    })
    res.end(text)
  }
  const fail = (res, status, error, message) => send(res, status, { error, message })

  const bearer = (req, store) => {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')
    const entry = m && store.get(m[1].trim())
    return entry && entry.expires > Date.now() ? entry : null
  }

  const readBody = (req) =>
    new Promise((resolve) => {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    })

  const parseJson = (text) => {
    try {
      return text ? JSON.parse(text) : {}
    } catch {
      return null
    }
  }

  const productOf = (id) => CATALOG.find((p) => p.id === Number(id))

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err)
      if (!res.headersSent) fail(res, 500, 'internal', String(err?.message ?? err))
      else res.end()
    })
  })

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
    const path = url.pathname.replace(/\/+$/, '') || '/'
    const method = req.method ?? 'GET'
    const raw = method === 'GET' || method === 'DELETE' ? '' : await readBody(req)
    const at = new Date().toISOString().slice(11, 19)
    res.on('finish', () => console.log(`[${at}] ${name.padEnd(16)} ${method.padEnd(6)} ${url.pathname}${url.search} → ${res.statusCode}`))

    // ---- health ----
    if (method === 'GET' && path === '/health') {
      return send(res, 200, { status: 'ok', stand: name, standId: slug, version: '1.0.0', uptimeSec: Math.round((Date.now() - started) / 1000) })
    }

    // ---- login ----
    if (method === 'POST' && path === '/auth/login') {
      const body = parseJson(raw)
      if (!body) return fail(res, 400, 'bad_json', 'Тело запроса не является JSON')
      if (!body.login || !body.password) return fail(res, 400, 'validation', 'Нужны поля login и password')
      if (USERS[body.login] !== body.password) return fail(res, 401, 'invalid_credentials', 'Неверный логин или пароль')
      const token = randomBytes(24).toString('hex')
      tokens.set(token, { user: body.login, expires: Date.now() + TOKEN_TTL * 1000 })
      return send(
        res,
        200,
        { access_token: token, token_type: 'Bearer', expires_in: TOKEN_TTL },
        { 'Set-Cookie': `session=${randomBytes(8).toString('hex')}; Path=/; HttpOnly; SameSite=Lax` }
      )
    }

    // ---- OAuth 2.0 client credentials (payment gateway sandbox) ----
    if (method === 'POST' && path === '/oauth/token') {
      const form = new URLSearchParams(raw)
      let clientId = form.get('client_id')
      let clientSecret = form.get('client_secret')
      const basic = /^Basic\s+(.+)$/i.exec(req.headers.authorization ?? '')
      if (basic) [clientId, clientSecret] = Buffer.from(basic[1], 'base64').toString('utf8').split(':')
      if (form.get('grant_type') !== 'client_credentials') return send(res, 400, { error: 'unsupported_grant_type' })
      if (!clientId || OAUTH_CLIENTS[clientId] !== clientSecret) return send(res, 401, { error: 'invalid_client' })
      const token = randomBytes(24).toString('hex')
      oauthTokens.set(token, { client: clientId, expires: Date.now() + TOKEN_TTL * 1000 })
      return send(res, 200, { access_token: token, token_type: 'Bearer', expires_in: TOKEN_TTL, scope: 'payments' })
    }

    // ---- payments (OAuth 2.0 token) ----
    if (path === '/pay/v1/payments' || path.startsWith('/pay/v1/payments/')) {
      if (!bearer(req, oauthTokens)) return fail(res, 401, 'unauthorized', 'Нужен токен OAuth 2.0 (POST /oauth/token)')
      if (method === 'POST' && path === '/pay/v1/payments') {
        const body = parseJson(raw)
        if (!body || !(Number(body.amount) > 0)) return fail(res, 400, 'validation', 'Нужна положительная сумма amount')
        const payment = { id: `pay_${randomBytes(5).toString('hex')}`, orderId: body.orderId ?? null, amount: Number(body.amount), currency: body.currency ?? 'RUB', status: 'pending', createdAt: new Date().toISOString() }
        payments.set(payment.id, payment)
        // The sandbox settles a payment a moment later.
        setTimeout(() => (payment.status = 'succeeded'), 1500)
        return send(res, 201, payment)
      }
      const id = path.split('/')[4]
      if (method === 'GET' && id) {
        const payment = payments.get(id)
        return payment ? send(res, 200, payment) : fail(res, 404, 'not_found', `Платёж ${id} не найден`)
      }
      return fail(res, 405, 'method_not_allowed', `${method} ${path} не поддерживается`)
    }

    // ---- shop API (Bearer from /auth/login) ----
    if (path.startsWith('/api/v1/')) {
      if (!bearer(req, tokens)) return fail(res, 401, 'unauthorized', 'Нужен заголовок Authorization: Bearer <token> (POST /auth/login)')
      const parts = path.split('/').slice(3) // ['products', '101']

      if (parts[0] === 'products' && method === 'GET') {
        if (parts[1]) {
          const product = productOf(parts[1])
          return product ? send(res, 200, product) : fail(res, 404, 'not_found', `Товар ${parts[1]} не найден`)
        }
        const category = url.searchParams.get('category')
        const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit')) || 20))
        const matched = CATALOG.filter((p) => !category || p.category === category)
        return send(res, 200, { total: matched.length, items: matched.slice(0, limit) })
      }

      if (parts[0] === 'orders') {
        if (method === 'POST' && !parts[1]) {
          const key = req.headers['idempotency-key']
          if (key && idempotency.has(key)) return send(res, 200, orders.get(idempotency.get(key)))
          const body = parseJson(raw)
          if (!body) return fail(res, 400, 'bad_json', 'Тело запроса не является JSON')
          if (!Array.isArray(body.items) || body.items.length === 0) return fail(res, 400, 'validation', 'Нужен непустой массив items')
          const items = []
          for (const it of body.items) {
            const product = productOf(it.productId)
            const quantity = Number(it.quantity)
            if (!product) return fail(res, 400, 'validation', `Товар ${it.productId} не найден`)
            if (!Number.isInteger(quantity) || quantity < 1) return fail(res, 400, 'validation', 'quantity — целое число от 1')
            if (quantity > product.stock) return fail(res, 409, 'out_of_stock', `Недостаточно товара ${product.id} на складе`)
            items.push({ productId: product.id, quantity, price: product.price })
          }
          const order = {
            id: nextOrderId++,
            status: 'created',
            items,
            total: items.reduce((s, i) => s + i.price * i.quantity, 0),
            comment: body.comment ?? null,
            createdAt: new Date().toISOString()
          }
          orders.set(order.id, order)
          if (key) idempotency.set(key, order.id)
          return send(res, 201, order, { Location: `/api/v1/orders/${order.id}` })
        }
        const order = parts[1] ? orders.get(Number(parts[1])) : undefined
        if (parts[1] && !order) return fail(res, 404, 'not_found', `Заказ ${parts[1]} не найден`)
        if (method === 'GET' && order) return send(res, 200, order)
        if (method === 'DELETE' && order) {
          order.status = 'cancelled'
          return send(res, 204, undefined)
        }
      }
      return fail(res, 404, 'not_found', `${method} ${path} не найден`)
    }

    return fail(res, 404, 'not_found', `${method} ${path} не найден. Список эндпоинтов — в начале demo-server.mjs`)
  }

  server.listen(port, '127.0.0.1', () => console.log(`  ${name.padEnd(16)} http://127.0.0.1:${port}`))
  server.on('error', (err) => {
    console.error(`Не удалось запустить «${name}» на порту ${port}: ${err.message}`)
    process.exitCode = 1
  })
  return server
}

// Only numbers count: started from another script, the argv holds its own words.
const [localPort = 8470, testPort = 8471] = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 65536)
console.log('Demo service «Интернет-магазин API» / Демо-сервис «Интернет-магазин API»  (Ctrl+C — stop / остановить)')
console.log('  login tester, password secret / логин tester, пароль secret; OAuth 2.0: relay-desktop / demo-secret')
createStand('Локальный стенд', 'local', localPort, 5001)
createStand('Тестовый стенд', 'test', testPort, 7001)

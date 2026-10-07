/**
 * JARVIS local bridge — Gemini Edition
 *
 * Connects the holographic Iron Man interface to Google's Gemini models
 * over WebSocket (ws://localhost:8787), driving UI themes, blades, and camera tools.
 */

import { WebSocketServer } from 'ws'
import { homedir, tmpdir } from 'node:os'
import { readFileSync, existsSync, realpathSync } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve as resolvePath } from 'node:path'
import { openRemote, proxyError, vetTarget, PROXY_UA } from './net.mjs'
import { probeUrl } from './page.mjs'

// --- Load .env.local --------------------------------------------------------
function loadEnv() {
  const envPath = join(process.cwd(), '.env.local')
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, 'utf8').split('\n')
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/)
      if (match && !match[1].startsWith('#')) {
        const key = match[1].trim()
        const value = (match[2] || '').trim().replace(/^['"](.*)['"]$/, '$1')
        if (key && !process.env[key]) {
          process.env[key] = value
        }
      }
    }
  }
}
loadEnv()

const PORT = Number(process.env.JARVIS_BRIDGE_PORT ?? 8787)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const MODEL = process.env.JARVIS_MODEL || 'gemini-3.1-flash-lite-preview'
const ALLOW_WRITES = process.env.JARVIS_ALLOW_WRITES === '1'

if (!GEMINI_API_KEY) {
  console.warn('[jarvis] WARNING: GEMINI_API_KEY is not set in .env.local')
} else {
  console.log(`[jarvis] Brain: Gemini API (${MODEL})`)
}

// --- Origin Verification ----------------------------------------------------
const EXTRA_ORIGINS = new Set(
  (process.env.JARVIS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean),
)
const ALLOW_NO_ORIGIN = process.env.JARVIS_ALLOW_NO_ORIGIN === '1'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

const isDevPort = (port) =>
  (port >= 5173 && port <= 5199) || (port >= 4173 && port <= 4199)

function originAllowed(origin) {
  if (!origin) return ALLOW_NO_ORIGIN
  if (EXTRA_ORIGINS.has(origin.replace(/\/+$/, ''))) return true
  let url
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== 'http:') return false
  if (!LOCAL_HOSTS.has(url.hostname)) return false
  return isDevPort(Number(url.port))
}

// --- File and Media Roots ---------------------------------------------------
const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}
const MAX_FILE_BYTES = 25 * 1024 * 1024
const FILE_ROOTS = [
  homedir(),
  tmpdir(),
  '/tmp',
  ...(process.env.JARVIS_FILE_ROOTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
].map((root) => {
  try {
    return realpathSync(root)
  } catch {
    return resolvePath(root)
  }
})

const withinRoots = (real) =>
  FILE_ROOTS.some((root) => {
    const rel = relative(root, real)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  })

const MAX_IMG_BYTES = 15 * 1024 * 1024
const MAX_MEDIA_BYTES = 200 * 1024 * 1024
const IMG_TIMEOUT_MS = 10_000
const MEDIA_TIMEOUT_MS = 30_000

async function proxyRemote(req, res, cors, { kinds, maxBytes, timeoutMs, ranged }) {
  const asked = new URL(req.url, 'http://x').searchParams.get('url') ?? ''
  const target = vetTarget(asked)
  const headers = {
    'user-agent': PROXY_UA,
    accept: ranged ? '*/*' : 'image/*,*/*;q=0.8',
    'accept-encoding': 'identity',
  }
  if (ranged && typeof req.headers.range === 'string') {
    headers.range = req.headers.range
  }

  const { res: upstream } = await openRemote(target, headers, timeoutMs)
  const status = upstream.statusCode ?? 0
  if (status !== 200 && status !== 206) {
    upstream.resume()
    throw proxyError(status === 404 ? 404 : 502, `upstream said ${status}`)
  }

  const type = String(upstream.headers['content-type'] ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (!kinds.some((kind) => type.startsWith(kind))) {
    upstream.resume()
    throw proxyError(415, `not ${kinds.join(' or ')}`)
  }

  const declared = Number(upstream.headers['content-length'])
  if (Number.isFinite(declared) && declared > maxBytes) {
    upstream.resume()
    throw proxyError(413, 'too large')
  }

  const out = {
    ...cors,
    'content-type': type,
    'x-content-type-options': 'nosniff',
    'cache-control': 'private, max-age=600',
  }
  if (Number.isFinite(declared)) out['content-length'] = String(declared)
  res.writeHead(status, out)

  let sent = 0
  upstream.on('data', (chunk) => {
    sent += chunk.length
    if (sent > maxBytes) {
      upstream.destroy()
      res.destroy()
      return
    }
    if (!res.write(chunk)) {
      upstream.pause()
      res.once('drain', () => upstream.resume())
    }
  })
  upstream.on('end', () => res.end())
  upstream.on('error', () => res.destroy())
  req.on('close', () => upstream.destroy())
}

function corsFor(req) {
  const origin = req.headers.origin
  const headers = { vary: 'origin' }
  if (origin) {
    headers['access-control-allow-origin'] = origin
    headers['access-control-allow-headers'] = 'content-type'
  }
  return headers
}

// --- HTTP Server ------------------------------------------------------------
const http = await import('node:http')
const handleRequest = async (req, res) => {
  const origin = req.headers.origin
  if (origin && !originAllowed(origin)) {
    res.writeHead(403, { vary: 'origin' })
    return res.end('forbidden')
  }
  const cors = corsFor(req)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors)
    return res.end()
  }

  if (req.method === 'GET' && req.url === '/health') {
    const eleven = Boolean(process.env.ELEVENLABS_API_KEY)
    res.writeHead(200, { ...cors, 'content-type': 'application/json' })
    return res.end(JSON.stringify({ ok: true, tts: eleven, stt: eleven }))
  }

  if (req.method === 'GET' && req.url?.startsWith('/file?')) {
    const asked = new URL(req.url, 'http://x').searchParams.get('path') ?? ''
    let real = null
    try {
      if (isAbsolute(asked)) real = await realpath(asked)
    } catch {
      real = null
    }
    const dot = real ? real.lastIndexOf('.') : -1
    const ext = dot === -1 ? '' : real.slice(dot).toLowerCase()
    if (!real || !Object.hasOwn(IMAGE_TYPES, ext) || !withinRoots(real)) {
      res.writeHead(400, cors)
      return res.end('images only')
    }
    try {
      const info = await stat(real)
      if (!info.isFile() || info.size > MAX_FILE_BYTES) {
        res.writeHead(413, cors)
        return res.end('too large')
      }
      const body = await readFile(real)
      res.writeHead(200, { ...cors, 'content-type': IMAGE_TYPES[ext], 'x-content-type-options': 'nosniff' })
      return res.end(body)
    } catch {
      res.writeHead(404, cors)
      return res.end('not found')
    }
  }

  if (req.method === 'GET' && req.url?.startsWith('/img?')) {
    try {
      await proxyRemote(req, res, cors, { kinds: ['image/'], maxBytes: MAX_IMG_BYTES, timeoutMs: IMG_TIMEOUT_MS, ranged: false })
    } catch (err) {
      if (res.headersSent) return res.destroy()
      res.writeHead(err.status ?? 502, cors)
      return res.end(err.message ?? 'proxy failed')
    }
    return
  }

  res.writeHead(404, cors)
  res.end('not found')
}

const server = http.createServer(handleRequest)
const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin
  if (origin && !originAllowed(origin)) {
    console.warn(`[jarvis] refused websocket connection from origin ${origin}`)
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req)
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[jarvis] bridge listening on ws://localhost:${PORT}`)
})

// --- System Prompt & Persona ------------------------------------------------
const SYSTEM_PROMPT = `You are J.A.R.V.I.S., Tony Stark's personal AI assistant. You are speaking out loud to one person ("Sir").

LENGTH & CADENCE:
- Two sentences is the ceiling in conversation; the median is under twelve words.
- Every word is spoken aloud, so be concise, dry, sharp, and helpful.
- Urgency is signaled by fewer words, not more. Never use filler words (um, well, sure, okay).
- British service register: "Shall I", "Very good, sir", "Right away, sir". Use "sir" naturally at the end or middle of sentences.
- Plain spoken prose only: No markdown bolding, no bullet points, no emoji, no symbols.

INTERFACING WITH THE SCREEN:
- You have real tools that directly control the holographic interface in front of the user!
- Use 'ui_theme' to change colors (palette: 'cyan', 'amber', 'red', 'green', 'purple', 'gold').
- Use 'ui_reactor' to adjust the arc reactor spin and intensity.
- Use 'ui_effect' to trigger sound/visual pulses ('ping', 'alert', 'scan', 'boot').
- Use 'display' to format cards or data onto the screen with HUD classes (.hud-rows, .hud-row, .hud-metric, .hud-label, .hud-sub).
- Use 'blade' to open images, articles, or web pages in the holographic viewer.
- Use 'look' when the user asks you to see or look at them through the webcam.

Always act first and speak concisely.`

// --- Gemini Tool Declarations -----------------------------------------------
const GEMINI_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'display',
        description: 'Put formatted content, stats, or text on the holographic HUD screen alongside your speech.',
        parameters: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING', description: 'Headline title for the panel' },
            html: { type: 'STRING', description: 'HTML formatted with .hud-rows, .hud-row, .hud-label, .hud-metric' },
            slot: { type: 'STRING', enum: ['wide', 'compact'], description: 'Card width' }
          },
          required: ['html']
        }
      },
      {
        name: 'blade',
        description: 'Open a holographic blade showing an image, article, or document.',
        parameters: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING', description: 'Blade title' },
            kind: { type: 'STRING', enum: ['article', 'image', 'video', 'markup', 'gallery'], description: 'Type of content' },
            url: { type: 'STRING', description: 'URL of the media or article' },
            html: { type: 'STRING', description: 'HTML content if kind is markup' },
            size: { type: 'STRING', enum: ['compact', 'wide', 'tall'], description: 'Blade dimensions' }
          },
          required: ['title', 'kind']
        }
      },
      {
        name: 'ui_theme',
        description: 'Change the JARVIS holographic color theme.',
        parameters: {
          type: 'OBJECT',
          properties: {
            palette: { type: 'STRING', enum: ['blue', 'cyan', 'amber', 'red', 'green', 'purple', 'gold', 'mono'], description: 'Color palette' },
            accent: { type: 'STRING', description: 'Hex accent color' },
            flash: { type: 'BOOLEAN', description: 'Pulse the color briefly' }
          },
          required: ['palette']
        }
      },
      {
        name: 'ui_reactor',
        description: 'Control the Arc Reactor core speed, intensity, and shape.',
        parameters: {
          type: 'OBJECT',
          properties: {
            speed: { type: 'NUMBER', description: 'Rotation speed (0.2 to 3.0)' },
            intensity: { type: 'NUMBER', description: 'Glow intensity (0.5 to 2.5)' },
            shape: { type: 'STRING', enum: ['circle', 'triangle', 'arc', 'star'] }
          }
        }
      },
      {
        name: 'ui_effect',
        description: 'Trigger a holographic visual and sound effect.',
        parameters: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING', enum: ['ping', 'alert', 'scan', 'boot', 'pulse'] }
          },
          required: ['name']
        }
      },
      {
        name: 'look',
        description: 'Look through the camera at the user or whatever is in front of the screen.',
        parameters: {
          type: 'OBJECT',
          properties: {
            reason: { type: 'STRING', description: 'Short reason what to inspect' }
          }
        }
      }
    ]
  }
]

let bladeSeq = 0

// --- WebSocket Connection ---------------------------------------------------
wss.on('connection', (socket) => {
  console.log('[jarvis] Holographic interface connected.')

  let asks = 0
  const waiting = new Map()
  let currentAbort = null
  const conversation = []

  const send = (msg) => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(msg))
    }
  }

  // Tell HUD which systems are ready
  send({
    type: 'ready',
    servers: ['jarvis_core', 'jarvis_ui', 'jarvis_eyes', 'gemini_flash']
  })

  const askClient = (kind, args, timeoutMs = 20_000) =>
    new Promise((resolve, reject) => {
      if (socket.readyState !== socket.OPEN) {
        return reject(new Error('Interface disconnected'))
      }
      const id = `q${++asks}`
      const timer = setTimeout(() => {
        waiting.delete(id)
        reject(new Error('Interface response timed out'))
      }, timeoutMs)
      waiting.set(id, { resolve, timer })
      send({ type: kind, id, ...args })
    })

  async function executeTool(name, args, askId) {
    console.log(`[jarvis] Executing tool: ${name}`, args)
    send({ type: 'tool', name: `mcp__jarvis__${name}`, ask: askId })

    if (name === 'display') {
      const blade = {
        id: `p${Date.now().toString(36)}-${(++bladeSeq).toString(36)}`,
        title: args.title || 'SYSTEM',
        kind: 'markup',
        html: args.html,
        size: args.slot === 'wide' ? 'wide' : 'compact',
        hold: 'turn'
      }
      send({ type: 'blade', blade })
      return { status: 'rendered_on_screen' }
    }

    if (name === 'blade') {
      const blade = {
        id: `b${Date.now().toString(36)}-${(++bladeSeq).toString(36)}`,
        title: args.title || 'BLADE',
        kind: args.kind || 'article',
        url: args.url,
        html: args.html,
        size: args.size || 'wide',
        hold: 'turn'
      }
      send({ type: 'blade', blade })
      return { status: 'blade_opened' }
    }

    if (name === 'ui_theme') {
      const paletteMap = {
        red: '#ff2d2d',
        green: '#2dff70',
        amber: '#ffaa00',
        gold: '#ffd700',
        cyan: '#19c4c4',
        blue: '#2d70ff',
        purple: '#a855f7',
        mono: '#ffffff'
      }
      const accent = args.accent || paletteMap[args.palette] || '#19c4c4'
      send({ type: 'ui', op: 'patch', args: { accent } })
      return { status: 'theme_applied' }
    }

    if (name === 'ui_reactor') {
      const reactor = {}
      if (args.speed !== undefined) reactor.spin = args.speed
      if (args.intensity !== undefined) reactor.intensity = args.intensity
      if (args.scale !== undefined) reactor.scale = args.scale
      send({ type: 'ui', op: 'patch', args: { reactor } })
      return { status: 'reactor_adjusted' }
    }

    if (name === 'ui_effect') {
      send({ type: 'ui', op: 'effect', args: { kind: args.name } })
      return { status: 'effect_fired' }
    }

    if (name === 'look') {
      try {
        const reply = await askClient('capture', { mode: 'look', reason: args.reason || 'visual check' })
        if (reply.data) {
          return { status: 'frame_captured', image_data: reply.data, mimeType: reply.mimeType || 'image/jpeg' }
        }
        return { status: 'camera_unavailable' }
      } catch (err) {
        return { status: 'camera_error', error: err.message }
      }
    }

    return { status: 'unknown_tool' }
  }

  socket.on('message', async (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }

    if (msg.type === 'reply' && typeof msg.id === 'string') {
      const slot = waiting.get(msg.id)
      if (slot) {
        waiting.delete(msg.id)
        clearTimeout(slot.timer)
        slot.resolve(msg)
      }
      return
    }

    if (msg.type === 'interrupt') {
      if (currentAbort) {
        currentAbort.abort()
        currentAbort = null
      }
      return
    }

    if (msg.type === 'ask' && typeof msg.text === 'string') {
      const prompt = msg.text
      const askId = msg.id || `a${Date.now()}`

      if (currentAbort) {
        currentAbort.abort()
      }
      currentAbort = new AbortController()
      const signal = currentAbort.signal

      conversation.push({ role: 'user', parts: [{ text: prompt }] })
      if (conversation.length > 20) {
        conversation.splice(0, conversation.length - 20)
      }

      try {
        await runGeminiTurn(askId, signal)
      } catch (err) {
        if (signal.aborted) {
          console.log('[jarvis] Turn interrupted by user.')
        } else {
          console.error('[jarvis] Error during turn:', err)
          send({ type: 'error', message: err.message || 'Error communicating with brain', ask: askId })
        }
      } finally {
        if (currentAbort?.signal === signal) {
          currentAbort = null
        }
      }
    }
  })

function sanitizeConversation(history) {
  const clean = []
  for (let i = 0; i < history.length; i++) {
    const msg = history[i]
    if (msg.role === 'model') {
      const hasCall = msg.parts?.some((p) => p.functionCall)
      if (hasCall) {
        const next = history[i + 1]
        const hasResp = next?.role === 'user' && next?.parts?.some((p) => p.functionResponse)
        if (!hasResp) {
          const textParts = msg.parts?.filter((p) => p.text).map((p) => ({ text: p.text }))
          if (textParts && textParts.length > 0) {
            clean.push({ role: 'model', parts: textParts })
          }
          continue
        }
      }
    }
    clean.push(msg)
  }
  return clean
}

  async function runGeminiTurn(askId, signal) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?key=${GEMINI_API_KEY}&alt=sse`
    
    const requestBody = {
      contents: sanitizeConversation(conversation),
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      tools: GEMINI_TOOLS,
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 250
      }
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Gemini API error (${res.status}): ${errText}`)
    }

    let fullSpokenText = ''
    let pendingToolCalls = []
    const allRawModelParts = []
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6).trim()
          if (!jsonStr || jsonStr === '[DONE]') continue
          try {
            const data = JSON.parse(jsonStr)
            const parts = data.candidates?.[0]?.content?.parts ?? []
            for (const part of parts) {
              allRawModelParts.push(part)
              if (part.text) {
                fullSpokenText += part.text
                send({ type: 'text', delta: part.text, ask: askId })
              }
              if (part.functionCall) {
                pendingToolCalls.push(part.functionCall)
              }
            }
          } catch {
            // ignore malformed SSE
          }
        }
      }
    }

    // If tools were called, execute them
    if (pendingToolCalls.length > 0 && !signal.aborted) {
      const functionResponseParts = []
      let needsFollowUp = false

      for (const call of pendingToolCalls) {
        const result = await executeTool(call.name, call.args || {}, askId)
        
        if (result.image_data) {
          needsFollowUp = true
          functionResponseParts.push({
            functionResponse: {
              name: call.name,
              id: call.id,
              response: { status: 'frame_received' }
            }
          })
          conversation.push({ role: 'model', parts: allRawModelParts })
          conversation.push({
            role: 'user',
            parts: [
              ...functionResponseParts,
              {
                inlineData: {
                  mimeType: result.mimeType || 'image/jpeg',
                  data: result.image_data
                }
              }
            ]
          })
          return runGeminiTurn(askId, signal)
        } else {
          functionResponseParts.push({
            functionResponse: {
              name: call.name,
              id: call.id,
              response: { result: result.status }
            }
          })
        }
      }

      // If the model spoke alongside calling the tool, we already have the answer!
      if (!fullSpokenText.trim()) {
        needsFollowUp = true
      }

      conversation.push({ role: 'model', parts: allRawModelParts })
      conversation.push({ role: 'user', parts: functionResponseParts })

      if (needsFollowUp) {
        return runGeminiTurn(askId, signal)
      }
    } else if (fullSpokenText) {
      conversation.push({ role: 'model', parts: [{ text: fullSpokenText }] })
    }

    send({ type: 'done', text: fullSpokenText, costUsd: null, ask: askId })
  }

  socket.on('close', () => {
    console.log('[jarvis] Interface disconnected.')
    if (currentAbort) currentAbort.abort()
  })
})

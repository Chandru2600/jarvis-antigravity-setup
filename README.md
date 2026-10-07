# J.A.R.V.I.S. — Antigravity Setup

A browser-based AI voice assistant with an **Iron Man Holographic 3D Arc Reactor interface**, real-time **hand gesture tracking**, and a **Google Gemini AI brain** via local WebSocket bridge.

Say **"Hey Jarvis"** (or hold <kbd>Space</kbd>) — he wakes, listens, answers with low latency, and dynamically controls his own interface, holographic themes, and cards.

---

## ✨ Features

- **3D Arc Reactor Hologram**: Built with Three.js, React Three Fiber, custom GLSL shaders, bloom lighting, and chromatic aberration.
- **Hand Gesture Tracking**: Powered by MediaPipe Vision WebAssembly running on-device:
  - **Parallax Cam**: Moving your hand left, right, up, or down tilts and steers the 3D Arc Reactor hologram in real time.
  - **Pinch to Grab & Drag**: Pinch your thumb and index finger to pick up and move holographic blades and cards across the screen.
  - **Two-Hand Zoom**: Move two hands closer or farther apart to zoom into the reactor core.
  - **Pinch Energy Pulse**: Pinching in open space accelerates the reactor core's rotation and energy glow.
- **Google Gemini Brain**: Connects to Google's fast `gemini-3.1-flash-lite-preview` model over WebSocket (`ws://localhost:8787`), supporting tool execution and live UI patching.
- **Voice Pipeline with Barge-In**:
  - Local Voice Activity Detection (VAD) lets you interrupt JARVIS naturally mid-sentence.
  - Fast on-device browser speech recognition and synthesis, with optional ElevenLabs neural voice upgrade.
- **Interactive Heads-Up Display (HUD)**: Status telemetry, draggable holographic blades, diagnostics, and keyboard shortcuts.

---

## 📋 Requirements

1. **Node.js 20 or newer** — Download from [nodejs.org](https://nodejs.org).
2. **Google Chrome or Microsoft Edge** — Real browser window (embedded IDE preview panes block microphone and webcam access).
3. **Google Gemini API Key** — Free API key from [Google AI Studio](https://aistudio.google.com/).
4. **Webcam & Microphone** — For hand gesture tracking and voice input.

---

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/Chandru2600/jarvis-antigravity.git
cd jarvis-antigravity
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Open `.env.local` and add your Google Gemini API key:

```env
GEMINI_API_KEY=your_actual_gemini_api_key_here
```

### 3. Start JARVIS

Run both the Gemini brain bridge and the Vite UI together:

```bash
npm start
```

Or run them in separate terminals:

```bash
# Terminal 1 — The Brain (Gemini WebSocket Bridge)
npm run bridge

# Terminal 2 — The Face (Holographic UI)
npm run dev
```

### 4. Launch in Browser

1. Open **[http://localhost:5173](http://localhost:5173)** in Google Chrome or Edge.
2. Click **INITIALISE** on the boot screen.
3. Allow microphone and camera permissions when prompted.
4. Say **"Hey Jarvis"** or hold <kbd>Space</kbd> to talk!

---

## 🎮 Controls & Shortcuts

| Key / Action | Function |
|---|---|
| **"Hey Jarvis"** | Voice wake word |
| <kbd>Space</kbd> | Push-to-talk (speak without wake word) |
| Speak mid-sentence | Barge-in (interrupts JARVIS immediately) |
| <kbd>G</kbd> | Toggle Hand Gesture Mode (Webcam tracking) |
| <kbd>V</kbd> | Cycle browser speech synthesis voices |
| <kbd>D</kbd> | Open Live Diagnostics panel |
| <kbd>T</kbd> | Audio speech self-test |
| <kbd>Esc</kbd> | Stand down / sleep |

---

## 🖐️ Gesture Control Guide

Press <kbd>G</kbd> to activate the webcam tracking overlay:

- ☝️ **Point**: Aim the holographic reticle on screen.
- 🤏 **Pinch (Thumb + Index)**: Grab and drag any holographic blade/card across the glass.
- 📐 **Frame (Both Hands L-Shape)**: Pull corners apart to resize cards.
- ✌️ **Peace Pose (Two fingers)**: Move up and down to scroll content.
- 🖐️ **Open Hand**: Release and let go.
- 🌐 **Hand Parallax**: Waving your hand steers the 3D camera angle of the Arc Reactor.

---

## 🏗️ Architecture

```
  ┌─ Browser (The Face) ───────────────┐        ┌─ Bridge (The Brain) ─────────────┐
  │  "Hey Jarvis" wake word            │        │  Node.js · bridge/server.mjs     │
  │  Local VAD → Speech Recognition    │   ws   │  Google Gemini API               │
  │  Three.js Arc Reactor (GLSL)       │◄─────► │  (gemini-3.1-flash-lite-preview) │
  │  MediaPipe Hand Tracking (WASM)    │  8787  │  UI tool & patch dispatcher      │
  │  Holographic HUD & Audio FX        │        │  Local file & proxy services     │
  └────────────────────────────────────┘        └──────────────────────────────────┘
```

---

## ⚙️ Configuration Variables

Configurable in `.env.local`:

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | *(Required)* | Google Gemini API key from AI Studio |
| `JARVIS_MODEL` | `gemini-3.1-flash-lite-preview` | Gemini model name |
| `JARVIS_BRIDGE_PORT` | `8787` | WebSocket & HTTP bridge port |
| `VITE_TTS_ENGINE` | `system` | Speech synthesis engine (`system` or `kokoro`) |
| `ELEVENLABS_API_KEY` | *(Optional)* | Optional ElevenLabs key for neural TTS |
| `VITE_PICOVOICE_ACCESS_KEY` | *(Optional)* | Optional Porcupine key for offline wake word |

---

## 🛡️ License

MIT License. Designed and adapted for Google Gemini & Antigravity.

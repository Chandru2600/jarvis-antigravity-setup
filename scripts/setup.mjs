#!/usr/bin/env node
// JARVIS Antigravity preflight — advisory check run with `npm run setup`.
//
// It inspects your machine, verifies Node.js and Gemini API key configuration,
// and displays start instructions.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const tick = '  ok  ';
const warn = ' note ';
const info = '  ·   ';

function line(tag, msg) {
  console.log(`[${tag}] ${msg}`);
}

console.log('');
console.log('JARVIS Antigravity Setup — System Preflight');
console.log('------------------------------------------------------------');

// --- Node version --------------------------------------------------------
try {
  const major = Number(process.versions.node.split('.')[0]);
  if (Number.isFinite(major) && major >= 20) {
    line(tick, `Node.js ${process.versions.node} (20+ required).`);
  } else {
    line(warn, `Node.js ${process.versions.node} is below 20. Please upgrade — the bridge needs Node 20 or newer.`);
  }
} catch {
  line(warn, 'Could not read the Node.js version. JARVIS needs Node 20 or newer.');
}

// --- Gemini API Key -------------------------------------------------------
function checkGeminiKey() {
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
    return 'environment variable';
  }
  const envPath = join(process.cwd(), '.env.local');
  if (existsSync(envPath)) {
    const raw = readFileSync(envPath, 'utf8');
    const match = raw.match(/^\s*GEMINI_API_KEY\s*=\s*(.*)?\s*$/m);
    if (match && match[1] && match[1].trim().replace(/^['"]|['"]$/g, '')) {
      return '.env.local';
    }
  }
  return null;
}

const geminiSource = checkGeminiKey();
if (geminiSource) {
  line(tick, `Google Gemini API key configured (found in ${geminiSource}).`);
} else {
  line(warn, 'GEMINI_API_KEY not found in .env.local.');
  line(info, 'Get a free Gemini API key from https://aistudio.google.com/');
  line(info, 'Add it to .env.local: GEMINI_API_KEY=your_key_here');
}

// --- ElevenLabs key (optional) --------------------------------------------
function checkElevenLabsKey() {
  if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY.trim()) {
    return 'environment variable';
  }
  const envPath = join(process.cwd(), '.env.local');
  if (existsSync(envPath)) {
    const raw = readFileSync(envPath, 'utf8');
    const match = raw.match(/^\s*ELEVENLABS_API_KEY\s*=\s*(.*)?\s*$/m);
    if (match && match[1] && match[1].trim().replace(/^['"]|['"]$/g, '')) {
      return '.env.local';
    }
  }
  return null;
}

const elSource = checkElevenLabsKey();
if (elSource) {
  line(tick, `Premium voice available — ElevenLabs key found via ${elSource}.`);
} else {
  line(info, 'No ElevenLabs key found — JARVIS will use high-speed browser speech synthesis.');
}

// --- How to run ----------------------------------------------------------
console.log('');
console.log('To run JARVIS:');
console.log('  npm start             # starts both the Gemini brain and the holographic face');
console.log('');
console.log('Or run in two separate terminals:');
console.log('  1) npm run bridge     # the brain (Google Gemini WebSocket bridge)');
console.log('  2) npm run dev        # the holographic Three.js interface (http://localhost:5173)');
console.log('');
console.log('Then open http://localhost:5173 in Chrome/Edge, click INITIALISE, and say "Hey Jarvis".');
console.log('');

process.exit(0);

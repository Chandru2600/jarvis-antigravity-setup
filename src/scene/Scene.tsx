import React, { Component, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import {
  EffectComposer,
  Bloom,
  ChromaticAberration,
  Vignette,
  Noise,
} from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import * as THREE from 'three'
import { Core } from './Core'
import { Particles } from './Particles'
import { Orbits } from './Orbits'
import { useStore, phaseColor, accentFor, type Phase } from '../store'
import { hands } from '../lib/hands'

/** Rings spin harder while JARVIS is working — reads as effort. */
const spinFor: Record<Phase, number> = {
  offline: 0.08, // barely turning — the machine is off
  boot: 3.2,
  dormant: 0.25,
  waking: 4.5,
  listening: 1.1,
  thinking: 2.8,
  tooling: 3.6,
  speaking: 1.4,
}

/**
 * Surface displacement amplitude. Both states where nothing is happening get
 * the calm figure: 'offline' is the quietest moment in the whole piece — the
 * reactor hasn't been powered on yet — so it must not be the most agitated
 * thing on screen.
 */
/*
 * Much lower than they were. At 0.13/0.26 on a unit sphere the displacement is
 * a quarter of the radius, which is not a reactor breathing — it is a potato.
 * The reference core is a clean circle whose surface only shimmers; the drama
 * belongs to the instrument rings around it, not to the silhouette.
 */
const AMP_CALM = 0.035
const AMP_LIVE = 0.085

/**
 * Everything the three children animate from, in one mutable object.
 *
 * These used to be render-time props, which had two consequences. The scene
 * subscribed to mic level, so the entire r3f tree reconciled sixty times a
 * second for numbers that never leave useFrame; and because they were only
 * delivered on a re-render, they were delivered late or — before the analyser
 * starts and `level` is a constant zero — not at all, which is why the ignition
 * screen never picked up its own spin rate.
 *
 * Nothing here belongs in React state. The scene is updated by mutation and
 * React only ever mounts it: Rig writes this object once per frame, the
 * children read it in their own useFrame. Children subscribe to the frame loop
 * before their parent does, so they are reading the previous frame's values —
 * one frame of lag on quantities that are all lerped anyway, and invisible.
 */
export type Drive = {
  color: THREE.Color
  /** 0..1 smoothed loudness, with an idle breath under it. */
  level: number
  /** Rotation multiplier for the drifting dust. */
  spin: number
  /** Target displacement amplitude for the core surface. */
  amp: number
  /** 0..1 power-up reveal — the ring assembles outwards from the centre. */
  open: number
  /**
   * The reactor slice of the ui state, already resolved and smoothed.
   *
   * Everything here is a no-op at UI_DEFAULTS: colour follows the phase exactly
   * as it always did, and the three multipliers sit at one.
   */
  reactor: {
    /** ui.reactor.color if set, otherwise the accent. */
    color: THREE.Color
    scale: number
    intensity: number
    /** Multiplier on the ring's own rotation rate. */
    spin: number
    /** 0 ring, 1 sphere, 2 wire — a number because it ends up in a uniform. */
    style: number
    visible: boolean
  }
}

/**
 * A colour target that only re-parses when the string actually changes.
 *
 * The colours in the ui slice are arbitrary CSS written by JARVIS, and
 * THREE.Color.set logs a warning for anything it cannot parse. Setting one
 * unconditionally per frame turns a single typo into sixty console lines a
 * second, which drowns everything else out during a demo.
 */
type Tint = { key: string; color: THREE.Color }

function aim(tint: Tint, css: string): THREE.Color {
  if (tint.key !== css) {
    tint.key = css
    tint.color.set(css)
  }
  return tint.color
}

const STYLE_INDEX = { ring: 0, sphere: 1, wire: 2 } as const

function Rig() {
  const drive = useMemo<Drive>(
    () => ({
      color: new THREE.Color(phaseColor.offline),
      level: 0,
      spin: spinFor.offline,
      amp: AMP_CALM,
      open: 0,
      reactor: {
        color: new THREE.Color(phaseColor.offline),
        scale: 1,
        intensity: 1,
        spin: 1,
        style: STYLE_INDEX.ring,
        visible: true,
      },
    }),
    [],
  )
  const target = useMemo<Tint>(() => ({ key: '', color: new THREE.Color() }), [])
  const reactorTarget = useMemo<Tint>(
    () => ({ key: '', color: new THREE.Color() }),
    [],
  )

  useFrame((state, dt) => {
    // Read imperatively rather than subscribing — see the note on Drive.
    const { phase, level, ui } = useStore.getState()

    // accentFor owns the accent -> palette -> phase resolution order. The scene
    // asking the store for the answer rather than working it out again is what
    // keeps the orb and the HUD from ever disagreeing about the colour.
    const accent = accentFor(phase, ui)
    drive.color.lerp(aim(target, accent), Math.min(1, dt * 2.5))

    const r = ui.reactor
    drive.reactor.color.lerp(
      aim(reactorTarget, r.color ?? accent),
      Math.min(1, dt * 2.5),
    )
    // Smoothed rather than assigned, so "make it twice the size" grows into
    // place instead of snapping. The style is the exception: it is a mode, and
    // easing between two of them would drag the picture through the third.
    const k = Math.min(1, dt * 5)
    drive.reactor.scale += (r.scale - drive.reactor.scale) * k
    drive.reactor.intensity += (r.intensity - drive.reactor.intensity) * k
    drive.reactor.spin += (r.spin - drive.reactor.spin) * k
    drive.reactor.style = STYLE_INDEX[r.style] ?? STYLE_INDEX.ring
    drive.reactor.visible = r.visible

    drive.spin += (spinFor[phase] - drive.spin) * Math.min(1, dt * 2)
    drive.amp = phase === 'dormant' || phase === 'offline' ? AMP_CALM : AMP_LIVE
    // Held shut until the reactor is powered on, so the ring builds itself out
    // of the centre on the ignition click rather than simply appearing.
    drive.open = phase === 'offline' ? 0.28 : phase === 'boot' ? 0.7 : 1.6

    // Idle breathing so the orb is never completely still.
    const idle = phase === 'offline' ? 0.02 : phase === 'dormant' ? 0.05 : 0.12
    const breathe =
      (Math.sin(state.clock.elapsedTime * 0.9) * 0.5 + 0.5) * idle
    const want = Math.max(level, breathe)
    drive.level += (want - drive.level) * Math.min(1, dt * 9)

    // Dynamic hand tracking: parallax camera and interactive holographic reactions
    const primaryHand = hands[0]
    if (primaryHand && primaryHand.points && primaryHand.points.length > 0) {
      // Normalized screen coordinates (-1 to 1)
      const nx = (primaryHand.x / Math.max(1, window.innerWidth) - 0.5) * 2
      const ny = -(primaryHand.y / Math.max(1, window.innerHeight) - 0.5) * 2

      const targetCamX = nx * 1.5
      const targetCamY = ny * 1.0
      state.camera.position.x += (targetCamX - state.camera.position.x) * Math.min(1, dt * 6)
      state.camera.position.y += (targetCamY - state.camera.position.y) * Math.min(1, dt * 6)

      // When pinching, accelerate the reactor rotation and energy
      if (primaryHand.pinched) {
        drive.reactor.spin = Math.max(drive.reactor.spin, 3.2)
        drive.level = Math.max(drive.level, 0.45)
      }

      // If two hands present, pinch/zoom the camera distance based on hand span!
      if (hands.length >= 2 && hands[1].points?.length) {
        const dx = (hands[0].x - hands[1].x) / Math.max(1, window.innerWidth)
        const dy = (hands[0].y - hands[1].y) / Math.max(1, window.innerHeight)
        const handDist = Math.hypot(dx, dy)
        // Normal separation ~0.3; spread hands to zoom in, close hands to zoom out
        const targetZ = 8.2 - handDist * 4.5
        const clampedZ = Math.max(3.8, Math.min(8.5, targetZ))
        state.camera.position.z += (clampedZ - state.camera.position.z) * Math.min(1, dt * 4)
      } else {
        state.camera.position.z += (6.2 - state.camera.position.z) * Math.min(1, dt * 3)
      }
    } else {
      // Slow drift on the camera keeps handheld-ish life in the shot when idle.
      const t = state.clock.elapsedTime
      const idleX = Math.sin(t * 0.13) * 0.35
      const idleY = Math.cos(t * 0.17) * 0.22
      state.camera.position.x += (idleX - state.camera.position.x) * Math.min(1, dt * 3)
      state.camera.position.y += (idleY - state.camera.position.y) * Math.min(1, dt * 3)
      state.camera.position.z += (6.2 - state.camera.position.z) * Math.min(1, dt * 3)
    }
    state.camera.lookAt(0, 0, 0)
  })

  // Nothing in here is lit: both the core and the dust are raw ShaderMaterials,
  // which do not read the light list. The scene therefore has no lights at all.
  //
  // The tilted gyro rings that used to sit here are gone. Steeply tilted arcs
  // crossing in front of a complete circle do not read as depth — they read as
  // scratches on the lens, and as broken circles in a design whose whole
  // subject is one unbroken one.
  return (
    <>
      <Core drive={drive} />
      <Particles drive={drive} />
      <Orbits />
    </>
  )
}

class PostEffectsErrorBoundary extends Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err: unknown) {
    console.warn('[jarvis] Postprocessing effect failed, continuing with direct render:', err)
  }
  render() {
    if (this.state.failed) return null
    return this.props.children
  }
}

class SceneErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean; retry: number }
> {
  state = { hasError: false, retry: 0 }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  componentDidCatch(err: unknown) {
    console.warn('[jarvis] WebGL Scene caught error:', err)
    if (this.state.retry < 3) {
      setTimeout(() => {
        this.setState((s) => ({ hasError: false, retry: s.retry + 1 }))
      }, 1200)
    }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div
          onClick={() => this.setState((s) => ({ hasError: false, retry: s.retry + 1 }))}
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: 'rgba(25, 196, 196, 0.7)',
            fontSize: 12,
            letterSpacing: '0.2em',
            fontFamily: 'monospace',
            zIndex: 10,
          }}
        >
          <span>HOLOGRAPHIC CORE STANDBY</span>
          <span style={{ fontSize: 9, opacity: 0.6, marginTop: 8 }}>
            [CLICK OR OPEN NEW TAB TO RECONNECT]
          </span>
        </div>
      )
    }
    return (
      <React.Fragment key={this.state.retry}>{this.props.children}</React.Fragment>
    )
  }
}

export function Scene() {
  return (
    <SceneErrorBoundary>
      <Canvas
        className="scene"
        camera={{ position: [0, 0, 6.2], fov: 45 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'default' }}
        dpr={[1, 2]}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault()
            console.warn('[jarvis] WebGL context lost; preventing default to allow auto-recovery')
          })
        }}
      >
        <Rig />
        <PostEffectsErrorBoundary>
          <EffectComposer multisampling={0}>
            {/* Bloom is what turns additive lines into "hologram". */}
            <Bloom
              intensity={1.15}
              luminanceThreshold={0.22}
              luminanceSmoothing={0.85}
              mipmapBlur
              radius={0.72}
            />
            <ChromaticAberration
              offset={new THREE.Vector2(0.0009, 0.0012)}
              radialModulation={false}
              modulationOffset={0}
            />
            <Noise opacity={0.035} blendFunction={BlendFunction.OVERLAY} />
            <Vignette eskil={false} offset={0.22} darkness={0.95} />
          </EffectComposer>
        </PostEffectsErrorBoundary>
      </Canvas>
    </SceneErrorBoundary>
  )
}

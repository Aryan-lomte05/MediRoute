import { useRef, useEffect, useState, Suspense } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Stars, Sphere, MeshDistortMaterial, Float, Text3D, Center } from '@react-three/drei'
import { motion, useScroll, useTransform, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import * as THREE from 'three'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

// ─── 3D Earth Globe ───────────────────────────────────────────────────────────
function EarthGlobe() {
  const meshRef = useRef()
  const atmosphereRef = useRef()
  const glowRef = useRef()

  useFrame(({ clock }) => {
    if (meshRef.current) meshRef.current.rotation.y = clock.elapsedTime * 0.08
    if (atmosphereRef.current) atmosphereRef.current.rotation.y = clock.elapsedTime * 0.06
  })

  return (
    <group>
      {/* Core globe */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[2.2, 64, 64]} />
        <meshPhongMaterial
          color="#0a1628"
          emissive="#051020"
          specular="#00F5FF"
          shininess={60}
          wireframe={false}
        />
      </mesh>

      {/* Wireframe overlay */}
      <mesh ref={atmosphereRef} scale={1.001}>
        <sphereGeometry args={[2.2, 32, 32]} />
        <meshBasicMaterial
          color="#00F5FF"
          wireframe={true}
          transparent
          opacity={0.06}
        />
      </mesh>

      {/* Atmosphere glow */}
      <mesh ref={glowRef} scale={1.15}>
        <sphereGeometry args={[2.2, 32, 32]} />
        <meshBasicMaterial
          color="#FF2D4A"
          transparent
          opacity={0.03}
          side={THREE.BackSide}
        />
      </mesh>

      {/* Outer atmosphere */}
      <mesh scale={1.25}>
        <sphereGeometry args={[2.2, 32, 32]} />
        <meshBasicMaterial
          color="#1a0a2e"
          transparent
          opacity={0.08}
          side={THREE.BackSide}
        />
      </mesh>

      {/* Incident markers */}
      <IncidentMarker position={[1.8, 0.8, 1.2]} color="#FF2D4A" />
      <IncidentMarker position={[-1.5, 0.3, 1.7]} color="#FF8C00" delay={0.5} />
      <IncidentMarker position={[0.5, 1.9, 0.8]} color="#FF2D4A" delay={1} />
      <IncidentMarker position={[-0.8, -1.5, 1.6]} color="#00F5FF" delay={1.5} />
      <IncidentMarker position={[2.0, -0.4, 0.7]} color="#FF2D4A" delay={0.8} />
      <IncidentMarker position={[-1.9, 1.0, 0.5]} color="#7C3AED" delay={0.3} />

      {/* Route arcs */}
      <RouteArc
        start={[1.8, 0.8, 1.2]}
        end={[-1.5, 0.3, 1.7]}
        color="#FF2D4A"
      />
      <RouteArc
        start={[0.5, 1.9, 0.8]}
        end={[2.0, -0.4, 0.7]}
        color="#00F5FF"
        delay={1}
      />
    </group>
  )
}

function IncidentMarker({ position, color, delay = 0 }) {
  const ringRef = useRef()
  const dotRef = useRef()

  useFrame(({ clock }) => {
    const t = (clock.elapsedTime + delay) % 2
    if (ringRef.current) {
      const scale = 1 + t * 1.5
      ringRef.current.scale.setScalar(scale)
      ringRef.current.material.opacity = Math.max(0, 0.8 - t * 0.4)
    }
    if (dotRef.current) {
      dotRef.current.material.emissiveIntensity = 0.8 + Math.sin(clock.elapsedTime * 3 + delay) * 0.4
    }
  })

  return (
    <group position={position}>
      {/* Pulsing ring */}
      <mesh ref={ringRef}>
        <ringGeometry args={[0.06, 0.09, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>
      {/* Core dot */}
      <mesh ref={dotRef}>
        <sphereGeometry args={[0.04, 8, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1} />
      </mesh>
    </group>
  )
}

function RouteArc({ start, end, color, delay = 0 }) {
  const lineRef = useRef()
  const progressRef = useRef(0)

  const points = []
  const startVec = new THREE.Vector3(...start)
  const endVec = new THREE.Vector3(...end)
  const midVec = new THREE.Vector3()
    .addVectors(startVec, endVec)
    .multiplyScalar(0.5)
    .normalize()
    .multiplyScalar(startVec.length() * 1.4)

  for (let i = 0; i <= 40; i++) {
    const t = i / 40
    const point = new THREE.Vector3()
    point.x = (1 - t) ** 2 * startVec.x + 2 * (1 - t) * t * midVec.x + t ** 2 * endVec.x
    point.y = (1 - t) ** 2 * startVec.y + 2 * (1 - t) * t * midVec.y + t ** 2 * endVec.y
    point.z = (1 - t) ** 2 * startVec.z + 2 * (1 - t) * t * midVec.z + t ** 2 * endVec.z
    points.push(point)
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(points)

  useFrame(({ clock }) => {
    progressRef.current = ((clock.elapsedTime + delay) % 4) / 4
    if (lineRef.current) {
      lineRef.current.material.dashOffset = -progressRef.current * 2
    }
  })

  return (
    <line ref={lineRef} geometry={geometry}>
      <lineDashedMaterial
        color={color}
        dashSize={0.15}
        gapSize={0.08}
        linewidth={1}
        transparent
        opacity={0.7}
      />
    </line>
  )
}

// ─── Floating Particles ────────────────────────────────────────────────────────
function ParticleField() {
  const points = useRef()
  const count = 2000

  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 20
    positions[i * 3 + 1] = (Math.random() - 0.5) * 20
    positions[i * 3 + 2] = (Math.random() - 0.5) * 20
  }

  useFrame(({ clock }) => {
    if (points.current) {
      points.current.rotation.y = clock.elapsedTime * 0.02
      points.current.rotation.x = clock.elapsedTime * 0.01
    }
  })

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          array={positions}
          count={count}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial size={0.025} color="#00F5FF" transparent opacity={0.4} sizeAttenuation />
    </points>
  )
}

// ─── Ambient Ring ──────────────────────────────────────────────────────────────
function OrbitRing({ radius, color, speed, tilt = 0 }) {
  const ref = useRef()
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.z = clock.elapsedTime * speed
  })
  return (
    <mesh ref={ref} rotation={[tilt, 0, 0]}>
      <torusGeometry args={[radius, 0.003, 16, 100]} />
      <meshBasicMaterial color={color} transparent opacity={0.3} />
    </mesh>
  )
}

// ─── Scene ─────────────────────────────────────────────────────────────────────
function Scene() {
  return (
    <>
      <ambientLight intensity={0.2} />
      <pointLight position={[5, 5, 5]} intensity={1.5} color="#FF2D4A" />
      <pointLight position={[-5, -3, -5]} intensity={0.8} color="#00F5FF" />
      <pointLight position={[0, 8, 0]} intensity={0.5} color="#7C3AED" />
      <Stars radius={80} depth={50} count={6000} factor={4} saturation={0} fade speed={0.5} />
      <ParticleField />
      <EarthGlobe />
      <OrbitRing radius={3.2} color="#FF2D4A" speed={0.15} tilt={Math.PI / 6} />
      <OrbitRing radius={3.6} color="#00F5FF" speed={-0.1} tilt={Math.PI / 3} />
      <OrbitRing radius={4.0} color="#7C3AED" speed={0.08} tilt={Math.PI / 2} />
      <OrbitControls
        enableZoom={false}
        enablePan={false}
        autoRotate
        autoRotateSpeed={0.4}
        minPolarAngle={Math.PI / 3}
        maxPolarAngle={Math.PI / 1.5}
      />
    </>
  )
}

// ─── Stats Counter ─────────────────────────────────────────────────────────────
function AnimatedCounter({ target, label, suffix = '' }) {
  const [count, setCount] = useState(0)
  const ref = useRef()

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        let start = 0
        const duration = 2000
        const step = (timestamp) => {
          if (!start) start = timestamp
          const progress = Math.min((timestamp - start) / duration, 1)
          setCount(Math.floor(progress * target))
          if (progress < 1) requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
        observer.disconnect()
      }
    })
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [target])

  return (
    <div ref={ref} className="text-center">
      <div className="font-display text-5xl font-bold gradient-text-emergency">
        {count.toLocaleString()}{suffix}
      </div>
      <div className="text-white/50 mt-1 text-sm font-medium">{label}</div>
    </div>
  )
}

// ─── Feature Card ──────────────────────────────────────────────────────────────
function FeatureCard({ icon, title, desc, accent, delay }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay }}
      viewport={{ once: true }}
      whileHover={{ scale: 1.03, y: -4 }}
      className="glass-card p-6 relative overflow-hidden group cursor-default"
    >
      <div
        className="absolute top-0 left-0 right-0 h-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
      />
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl mb-4"
        style={{ background: `${accent}22`, border: `1px solid ${accent}44` }}
      >
        {icon}
      </div>
      <h3 className="font-display font-semibold text-lg text-white mb-2">{title}</h3>
      <p className="text-white/50 text-sm leading-relaxed">{desc}</p>
    </motion.div>
  )
}

// ─── Workflow Step ─────────────────────────────────────────────────────────────
function WorkflowStep({ step, title, desc, active }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      whileInView={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay: step * 0.1 }}
      viewport={{ once: true }}
      className={`flex gap-4 p-4 rounded-xl transition-all duration-300 ${
        active ? 'bg-emergency/10 border border-emergency/30' : 'hover:bg-white/[0.02]'
      }`}
    >
      <div
        className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 font-mono ${
          active ? 'bg-emergency text-white glow-red' : 'bg-surface-elevated text-white/40 border border-surface-border'
        }`}
      >
        {String(step).padStart(2, '0')}
      </div>
      <div>
        <div className={`font-semibold ${active ? 'text-emergency' : 'text-white'}`}>{title}</div>
        <div className="text-white/40 text-sm mt-0.5">{desc}</div>
      </div>
    </motion.div>
  )
}

// ─── Portal Card ───────────────────────────────────────────────────────────────
function PortalCard({ title, role, desc, color, icon, features, path }) {
  const navigate = useNavigate()
  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      whileInView={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7 }}
      viewport={{ once: true }}
      whileHover={{ y: -8 }}
      className="glass-card p-8 relative overflow-hidden group cursor-pointer flex flex-col"
      onClick={() => navigate(path)}
    >
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ background: `radial-gradient(circle at top left, ${color}08, transparent 60%)` }}
      />
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-6"
        style={{ background: `${color}15`, border: `1px solid ${color}30` }}
      >
        {icon}
      </div>
      <div className="text-xs font-mono uppercase tracking-widest mb-2" style={{ color }}>
        {role}
      </div>
      <h3 className="font-display text-2xl font-bold text-white mb-3">{title}</h3>
      <p className="text-white/50 text-sm leading-relaxed mb-6">{desc}</p>
      <ul className="space-y-2 flex-1">
        {features.map((f, i) => (
          <li key={i} className="flex items-center gap-2 text-sm text-white/60">
            <span style={{ color }} className="text-xs">▸</span> {f}
          </li>
        ))}
      </ul>
      <button
        className="mt-6 w-full py-3 rounded-xl font-semibold text-sm transition-all duration-300"
        style={{
          background: `${color}15`,
          border: `1px solid ${color}30`,
          color,
        }}
        onMouseEnter={(e) => {
          e.target.style.background = `${color}25`
          e.target.style.boxShadow = `0 0 20px ${color}40`
        }}
        onMouseLeave={(e) => {
          e.target.style.background = `${color}15`
          e.target.style.boxShadow = 'none'
        }}
      >
        Enter Portal →
      </button>
    </motion.div>
  )
}

// ─── Main Landing Page ─────────────────────────────────────────────────────────
export default function Landing() {
  const navigate = useNavigate()
  const heroRef = useRef()
  const { scrollY } = useScroll()
  const globeY = useTransform(scrollY, [0, 600], [0, 100])
  const globeOpacity = useTransform(scrollY, [0, 400], [1, 0.3])

  const features = [
    {
      icon: '🎙️',
      title: 'AI Voice Triage',
      desc: 'Real-time speech-to-text with LLM-powered Emergency Severity Index scoring within 3 seconds.',
      accent: '#FF2D4A',
    },
    {
      icon: '🧮',
      title: 'MILP Allocation Engine',
      desc: 'Multi-objective optimization matching patients to the best hospital using OR-Tools.',
      accent: '#00F5FF',
    },
    {
      icon: '🗺️',
      title: 'Dynamic Green Corridor',
      desc: 'AI-predicted traffic congestion with real-time route recalculation via OSRM.',
      accent: '#7C3AED',
    },
    {
      icon: '📡',
      title: 'Live GPS Tracking',
      desc: 'Sub-2-second ambulance location updates streamed via WebSocket to all portals.',
      accent: '#FF8C00',
    },
    {
      icon: '🏥',
      title: 'Zero-Wait ER Handover',
      desc: 'Pre-reserves ICU beds and alerts trauma teams before ambulance arrival.',
      accent: '#00C851',
    },
    {
      icon: '📊',
      title: 'Surge Forecasting',
      desc: 'Temporal Fusion Transformer predicts hospital capacity demand 6–24 hours ahead.',
      accent: '#FF2D4A',
    },
  ]

  const portals = [
    {
      title: 'Patient Portal',
      role: 'Emergency SOS',
      desc: 'One-tap emergency request with real-time ambulance tracking and ETA countdown.',
      color: '#FF2D4A',
      icon: '🆘',
      path: '/patient',
      features: ['1-tap SOS trigger', 'Live ambulance tracker', 'ETA countdown', 'Emergency ID profile'],
    },
    {
      title: 'Paramedic PWA',
      role: 'Field Operations',
      desc: 'Turn-by-turn navigation with AI-suggested routes and live patient vitals dashboard.',
      color: '#00F5FF',
      icon: '🚑',
      path: '/paramedic',
      features: ['Turn-by-turn nav', 'Vitals entry form', 'Dynamic re-routing', 'Incident status updates'],
    },
    {
      title: 'Hospital Command',
      role: 'ER Management',
      desc: 'Real-time incoming patient feed with auto bed reservation and one-click pre-accept.',
      color: '#7C3AED',
      icon: '🏥',
      path: '/hospital',
      features: ['Live patient feed', 'Auto bed reservation', 'Resource management', 'Diversion control'],
    },
    {
      title: 'Admin Analytics',
      role: 'Operations Center',
      desc: 'City-wide emergency heatmaps, fleet utilization, and AI allocation override controls.',
      color: '#FF8C00',
      icon: '📊',
      path: '/admin',
      features: ['City heatmaps', 'Fleet utilization', 'Surge forecasting', 'AI overrides'],
    },
  ]

  const workflow = [
    { title: 'SOS Triggered', desc: 'Patient triggers emergency via app or voice call' },
    { title: 'AI Voice Triage', desc: 'LLM classifies acuity (ESI 1–5) within 3 seconds' },
    { title: 'Nearest Ambulance Dispatched', desc: 'Geospatial query finds optimal unit' },
    { title: 'MILP Hospital Allocation', desc: 'AI ranks hospitals by ETA, capacity, specialty' },
    { title: 'Green Corridor Activated', desc: 'AI-optimized route avoids congestion' },
    { title: 'Zero-Wait ER Handover', desc: 'Bed pre-reserved, trauma team pre-alerted' },
  ]

  return (
    <div className="min-h-screen bg-[#0a0a0f] overflow-x-hidden">
      {/* ── Navbar ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 px-6 py-4 flex items-center justify-between">
        <div
          className="absolute inset-0 -z-10 backdrop-blur-xl"
          style={{ background: 'linear-gradient(180deg, rgba(10,10,15,0.95) 0%, transparent 100%)' }}
        />
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-emergency rounded-lg flex items-center justify-center glow-red">
            <span className="text-white text-sm font-bold">M</span>
          </div>
          <span className="font-display font-bold text-xl text-white">
            Medi<span className="text-emergency">Route</span>
          </span>
        </div>
        <div className="hidden md:flex items-center gap-8 text-sm text-white/60">
          {['Features', 'How It Works', 'Portals'].map((item) => (
            <a
              key={item}
              href={`#${item.toLowerCase().replace(' ', '-')}`}
              className="hover:text-white transition-colors"
            >
              {item}
            </a>
          ))}
        </div>
        <button
          onClick={() => navigate('/login')}
          className="btn-ghost text-sm px-4 py-2"
        >
          Launch Platform →
        </button>
      </nav>

      {/* ── Hero Section ── */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        {/* 3D Globe Canvas */}
        <motion.div
          style={{ y: globeY, opacity: globeOpacity }}
          className="absolute inset-0 z-0"
        >
          <Canvas
            camera={{ position: [0, 0, 7], fov: 50 }}
            gl={{ antialias: true, alpha: true }}
            style={{ background: 'transparent' }}
          >
            <Suspense fallback={null}>
              <Scene />
            </Suspense>
          </Canvas>
        </motion.div>

        {/* Background radial glow */}
        <div
          className="absolute inset-0 z-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 80% 60% at 50% 50%, rgba(255,45,74,0.08) 0%, transparent 70%)',
          }}
        />

        {/* Grid pattern */}
        <div className="absolute inset-0 z-0 opacity-20 bg-grid-pattern pointer-events-none" />

        {/* Hero content */}
        <div className="relative z-10 text-center px-6 max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-emergency/30 bg-emergency/10 mb-8"
          >
            <span className="pulse-dot text-emergency" />
            <span className="text-emergency text-sm font-mono font-medium">
              SYSTEM ONLINE — AI DISPATCH ACTIVE
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="font-display font-bold leading-tight mb-6"
            style={{ fontSize: 'clamp(3rem, 8vw, 7rem)' }}
          >
            <span className="text-white">Every Second</span>
            <br />
            <span className="gradient-text-emergency text-glow-red">Saves a Life.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.6 }}
            className="text-white/60 text-lg md:text-xl max-w-2xl mx-auto leading-relaxed mb-10"
          >
            AI-powered emergency dispatch with real-time hospital allocation,
            dynamic green-corridor routing, and zero-wait ER handover.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.8 }}
            className="flex flex-col sm:flex-row gap-4 justify-center"
          >
            <button onClick={() => navigate('/login')} className="btn-emergency text-base">
              <span>🚨</span> Launch MediRoute
            </button>
            <a href="#how-it-works" className="btn-ghost text-base">
              See How It Works
            </a>
          </motion.div>

          {/* Scroll indicator */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 2, duration: 1 }}
            className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
          >
            <span className="text-white/30 text-xs font-mono uppercase tracking-widest">Scroll</span>
            <motion.div
              animate={{ y: [0, 8, 0] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="w-px h-8 bg-gradient-to-b from-emergency to-transparent"
            />
          </motion.div>
        </div>
      </section>

      {/* ── Stats Bar ── */}
      <section className="relative py-16 border-y border-surface-border">
        <div className="absolute inset-0 bg-gradient-to-r from-emergency/5 via-transparent to-cyber/5" />
        <div className="max-w-5xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8">
          <AnimatedCounter target={8} suffix="s" label="Avg. Dispatch Time" />
          <AnimatedCounter target={94} suffix="%" label="AI Triage Accuracy" />
          <AnimatedCounter target={1000} suffix="+" label="Hospitals Networked" />
          <AnimatedCounter target={37} suffix="%" label="Mortality Reduction" />
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <div className="text-cyber font-mono text-sm uppercase tracking-widest mb-3">
              AI Engine Suite
            </div>
            <h2 className="font-display text-5xl font-bold text-white mb-4">
              Next-Gen{' '}
              <span className="gradient-text-cyber">Intelligence</span>
            </h2>
            <p className="text-white/50 max-w-xl mx-auto">
              Five AI modules working in concert to eliminate every bottleneck in emergency response.
            </p>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f, i) => (
              <FeatureCard key={i} {...f} delay={i * 0.1} />
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section id="how-it-works" className="py-24 px-6 bg-surface-card/50">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <div className="text-emergency font-mono text-sm uppercase tracking-widest mb-3">
              End-to-End Workflow
            </div>
            <h2 className="font-display text-5xl font-bold text-white mb-4">
              From SOS to{' '}
              <span className="gradient-text-emergency">Safe Hands</span>
            </h2>
          </motion.div>
          <div className="grid md:grid-cols-2 gap-4">
            {workflow.map((step, i) => (
              <WorkflowStep
                key={i}
                step={i + 1}
                title={step.title}
                desc={step.desc}
                active={i === 0}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── Portals ── */}
      <section id="portals" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <div className="text-purple-400 font-mono text-sm uppercase tracking-widest mb-3">
              Role-Based Access
            </div>
            <h2 className="font-display text-5xl font-bold text-white mb-4">
              Four{' '}
              <span className="gradient-text-cyber">Command Portals</span>
            </h2>
            <p className="text-white/50 max-w-xl mx-auto">
              Tailored interfaces for every stakeholder in the emergency response chain.
            </p>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {portals.map((p, i) => (
              <PortalCard key={i} {...p} />
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-24 px-6 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 60% 80% at 50% 50%, rgba(255,45,74,0.12) 0%, transparent 70%)',
          }}
        />
        <div className="max-w-3xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
          >
            <h2 className="font-display text-6xl font-bold text-white mb-6">
              Ready to{' '}
              <span className="gradient-text-emergency text-glow-red">Save Lives?</span>
            </h2>
            <p className="text-white/50 text-lg mb-10 leading-relaxed">
              Join the future of emergency medical response. Real-time. AI-powered. Life-saving.
            </p>
            <button onClick={() => navigate('/login')} className="btn-emergency text-xl px-12 py-5">
              <span>🚨</span> Launch MediRoute Now
            </button>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-surface-border py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-emergency rounded flex items-center justify-center">
              <span className="text-white text-xs font-bold">M</span>
            </div>
            <span className="font-display font-bold text-white">
              Medi<span className="text-emergency">Route</span>
            </span>
          </div>
          <p className="text-white/30 text-sm font-mono">
            © 2026 MediRoute. Next-Gen Emergency Response Platform.
          </p>
          <div className="flex gap-4 text-white/30 text-sm">
            {['Patient', 'Paramedic', 'Hospital', 'Admin'].map((role) => (
              <a
                key={role}
                href={`/${role.toLowerCase()}`}
                className="hover:text-white/60 transition-colors"
              >
                {role}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  )
}

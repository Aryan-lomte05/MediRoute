import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'

export default function Landing() {
  const navigate = useNavigate()
  const [videoModalOpen, setVideoModalOpen] = useState(false)

  const portalCards = [
    {
      num: '01',
      role: 'Citizen',
      subrole: 'Emergency SOS',
      desc: 'Instant geolocation lock, AI voice triage and live ambulance tracking.',
      tag: 'ANYONE ANYWHERE',
      image: '/card-citizen.jpg',
      path: '/patient',
      accentColor: '#FF2D4A',
      icon: (
        <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
    },
    {
      num: '02',
      role: 'Paramedic',
      subrole: 'Field HUD',
      desc: 'Real-time dispatch, turn-by-turn navigation and patient vitals stream.',
      tag: 'FASTER ON GROUND',
      image: '/card-paramedic.jpg',
      path: '/paramedic',
      accentColor: '#00F5FF',
      icon: (
        <svg className="w-5 h-5 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 16v3m-2-1.5h4M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v4H9V9z" />
        </svg>
      ),
    },
    {
      num: '03',
      role: 'Hospital',
      subrole: 'Emergency Room',
      desc: 'Dynamic bed allocation, inbound alerts and zero-wait trauma intake.',
      tag: 'PREPARE BEFORE THEY ARRIVE',
      image: '/card-hospital.jpg',
      path: '/hospital',
      accentColor: '#10B981',
      icon: (
        <svg className="w-5 h-5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
    },
    {
      num: '04',
      role: 'City Command',
      subrole: 'Dispatcher',
      desc: 'City-wide GIS map, AI fleet allocation and real-time incident management.',
      tag: 'A SMARTER SAFER CITY',
      image: '/card-command.jpg',
      path: '/admin',
      accentColor: '#8B5CF6',
      icon: (
        <svg className="w-5 h-5 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
    },
  ]

  const workflowItems = [
    {
      step: '01',
      title: 'Emergency Detection',
      desc: '1-tap SOS or automatic incident detection.',
      color: '#FF2D4A',
      icon: (
        <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
        </svg>
      ),
    },
    {
      step: '02',
      title: 'AI Triage Classification',
      desc: 'Analyze symptoms and assign ESI 1–5 within seconds.',
      color: '#3B82F6',
      icon: (
        <svg className="w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      ),
    },
    {
      step: '03',
      title: 'Dynamic Hospital Matching',
      desc: 'MILP algorithm selects the optimal hospital based on ETA, capacity and specialty.',
      color: '#10B981',
      icon: (
        <svg className="w-5 h-5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
    },
    {
      step: '04',
      title: 'Green-Corridor Dispatch',
      desc: 'Real-time traffic-synced routing with priority clearance.',
      color: '#8B5CF6',
      icon: (
        <svg className="w-5 h-5 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      ),
    },
    {
      step: '05',
      title: 'Definitive Care',
      desc: 'Patient handover with pre-reserved resources and clinical readiness.',
      color: '#00F5FF',
      icon: (
        <svg className="w-5 h-5 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      ),
    },
  ]

  return (
    <div className="min-h-screen bg-[#06070a] text-white selection:bg-red-500/30 selection:text-white relative overflow-x-hidden font-sans">
      {/* ── TOP HEADER / NAVBAR ── */}
      <header className="sticky top-0 z-50 w-full border-b border-white/[0.06] bg-[#06070a]/90 backdrop-blur-md">
        <div className="max-w-[1400px] mx-auto px-6 h-20 flex items-center justify-between">
          {/* Brand with Heartbeat line */}
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('/')}>
            {/* Heartbeat pulse icon */}
            <svg className="w-7 h-7 text-[#FF2D4A]" viewBox="0 0 24 12" fill="none" stroke="currentColor" strokeWidth={2.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M0 6h6l2.5-6 4 12 2.5-6h9" />
            </svg>
            <div>
              <div className="font-extrabold text-2xl tracking-tight text-white flex items-center">
                Medi<span className="text-[#FF2D4A]">Route</span>
              </div>
              <div className="text-[8px] font-mono uppercase tracking-[0.28em] text-white/40 -mt-1 font-semibold">
                INTELLIGENCE IN EVERY MILE
              </div>
            </div>
          </div>

          {/* Nav links */}
          <nav className="hidden lg:flex items-center gap-9 text-xs font-semibold text-white/70 tracking-wide">
            <a href="#platform" className="hover:text-white transition-colors">Platform</a>
            <a href="#workflow" className="hover:text-white transition-colors">AI Triage</a>
            <a href="#gis-network" className="hover:text-white transition-colors">GIS Network</a>
            <a href="#impact" className="hover:text-white transition-colors">Impact</a>
            <a href="#docs" className="hover:text-white transition-colors">Documentation</a>
          </nav>

          {/* Right actions */}
          <div className="flex items-center gap-4">
            {/* Live telemetry badge */}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/20 bg-emerald-950/20 text-emerald-400 text-xs font-mono">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#10b981]" />
              <span className="font-medium">Live City Telemetry</span>
            </div>

            {/* Launch Portal button */}
            <button
              onClick={() => navigate('/login')}
              className="px-5 py-2 rounded-lg bg-gradient-to-r from-[#941324] via-[#b5172e] to-[#941324] hover:from-[#b5172e] hover:to-[#c91a33] text-white text-xs font-semibold border border-red-500/40 shadow-[0_0_20px_rgba(255,45,74,0.3)] transition-all flex items-center gap-2"
            >
              <span>Launch Portal</span>
              <span>→</span>
            </button>
          </div>
        </div>
      </header>

      {/* ── HERO SECTION ── */}
      <section className="relative pt-12 pb-16 px-6 max-w-[1400px] mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          {/* Left Column: Typography & CTAs */}
          <div className="lg:col-span-6 space-y-6 z-10">
            <div className="text-[11px] font-mono tracking-[0.25em] text-white/50 uppercase font-semibold">
              FASTER RESPONSE. BRIGHTER TOMORROWS.
            </div>

            <h1 className="text-4xl sm:text-6xl xl:text-7xl font-extrabold tracking-tight text-white leading-[1.06]">
              Every Second <br />
              Engineered for <br />
              <span className="text-[#FF2D4A] drop-shadow-[0_0_40px_rgba(255,45,74,0.45)]">
                Survival.
              </span>
            </h1>

            <p className="text-white/60 text-sm sm:text-base leading-relaxed max-w-lg">
              MediRoute leverages multi-agent AI, real-time traffic intelligence and dynamic hospital allocation to deliver the right care, to the right patient, at the right time.
            </p>

            {/* Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              {/* Emergency SOS Button */}
              <button
                onClick={() => navigate('/login')}
                className="group relative px-6 py-3.5 rounded-xl bg-gradient-to-r from-[#b31427] to-[#e61732] hover:from-[#e61732] hover:to-[#b31427] text-white shadow-[0_0_30px_rgba(255,45,74,0.4)] border border-red-400/40 transition-all flex items-center justify-between min-w-[220px]"
              >
                <div className="flex items-center gap-3 text-left">
                  <span className="text-2xl">🚑</span>
                  <div>
                    <div className="text-sm font-bold tracking-wide">Emergency SOS</div>
                    <div className="text-[10px] text-white/70 font-mono">Get help now</div>
                  </div>
                </div>
                <span className="text-lg font-bold ml-4 group-hover:translate-x-1 transition-transform">→</span>
              </button>

              {/* Explore Platform Button */}
              <button
                onClick={() => {
                  const el = document.getElementById('platform')
                  el?.scrollIntoView({ behavior: 'smooth' })
                }}
                className="px-6 py-3.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/10 text-white transition-all flex items-center gap-3 text-left min-w-[200px]"
              >
                <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-[10px]">
                  ▶
                </div>
                <div>
                  <div className="text-sm font-bold">Explore the Platform</div>
                  <div className="text-[10px] text-white/50 font-mono">See how it works</div>
                </div>
              </button>
            </div>
          </div>

          {/* Right Column: Exact 3D City Night Scene Visualizer */}
          <div className="lg:col-span-6 relative">
            <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-[#08090e] shadow-[0_0_60px_rgba(0,0,0,0.9)]">
              {/* City illustration asset */}
              <img
                src="/hero-city.jpg"
                alt="MediRoute Dynamic City GIS Grid"
                className="w-full h-auto object-cover opacity-95 select-none"
              />

              {/* Overlay vignette */}
              <div className="absolute inset-0 bg-gradient-to-r from-[#06070a]/80 via-transparent to-transparent pointer-events-none" />

              {/* Floating Badge 1: Patient Pin */}
              <div className="absolute top-[28%] left-[28%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
                <div className="px-3 py-1.5 rounded-md bg-[#0a0a14]/90 border border-red-500/40 text-[10px] font-mono text-center shadow-xl backdrop-blur-md">
                  <div className="text-red-400 font-bold">Patient</div>
                  <div className="text-white/70 text-[9px]">AI Triage: <strong className="text-white">ESI 1</strong></div>
                </div>
              </div>

              {/* Floating Badge 2: Trauma Center Pin */}
              <div className="absolute top-[18%] right-[8%] flex flex-col items-center">
                <div className="px-3.5 py-2 rounded-md bg-[#0a0a14]/90 border border-cyan-500/40 text-[10px] font-mono text-center shadow-xl backdrop-blur-md">
                  <div className="text-cyan-300 font-bold">Trauma Center</div>
                  <div className="text-white/70 text-[9px]">ETA 6 min · <strong className="text-cyan-400">Bed Reserved</strong></div>
                </div>
              </div>

              {/* Bottom Right Tag */}
              <div className="absolute bottom-3 right-4 text-[9px] font-mono tracking-[0.25em] text-white/40 uppercase font-semibold">
                SMART CITIES · SAFER PEOPLE
              </div>
            </div>
          </div>
        </div>

        {/* ── METRICS STRIP (Matches Image 1 bottom) ── */}
        <div className="mt-14 rounded-xl border border-white/[0.08] bg-[#090a10] p-6 grid grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Card 1 */}
          <div className="border-r border-white/[0.06] last:border-0 pr-4">
            <div className="flex items-center gap-2 text-white/40 text-[11px] font-mono uppercase tracking-wider mb-1">
              <span>⏱</span>
              <span>AVERAGE RESPONSE TIME</span>
            </div>
            <div className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              4.2 min
            </div>
            <div className="text-xs font-mono text-emerald-400 mt-1 flex items-center gap-1">
              <span>↓ 28%</span>
              <span className="text-white/40">vs. city average</span>
            </div>
          </div>

          {/* Card 2 */}
          <div className="border-r border-white/[0.06] last:border-0 pr-4">
            <div className="flex items-center gap-2 text-white/40 text-[11px] font-mono uppercase tracking-wider mb-1">
              <span>🛣</span>
              <span>ACTIVE GREEN CORRIDORS</span>
            </div>
            <div className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              14
            </div>
            <div className="text-xs font-mono text-emerald-400 mt-1 flex items-center gap-1">
              <span>↑ Live</span>
              <span className="text-white/40">across Mumbai</span>
            </div>
          </div>

          {/* Card 3 */}
          <div className="border-r border-white/[0.06] last:border-0 pr-4">
            <div className="flex items-center gap-2 text-white/40 text-[11px] font-mono uppercase tracking-wider mb-1">
              <span>🏥</span>
              <span>PARTICIPATING TRAUMA CENTERS</span>
            </div>
            <div className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              38
            </div>
            <div className="text-xs font-mono text-emerald-400 mt-1 flex items-center gap-1">
              <span>↑ 100%</span>
              <span className="text-white/40">real-time bed sync</span>
            </div>
          </div>

          {/* Card 4 */}
          <div>
            <div className="flex items-center gap-2 text-white/40 text-[11px] font-mono uppercase tracking-wider mb-1">
              <span>🧠</span>
              <span>AI TRIAGE ACCURACY</span>
            </div>
            <div className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              99.4%
            </div>
            <div className="text-xs font-mono text-emerald-400 mt-1 flex items-center gap-1">
              <span>↑ 0.3%</span>
              <span className="text-white/40">validated on 50K+ cases</span>
            </div>
          </div>
        </div>

        {/* ── "PEOPLE X TECHNOLOGY X SAFER CITIES" RIBBON ── */}
        <div className="mt-6 rounded-xl border border-white/[0.08] bg-[#090a10] p-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="space-y-1">
            <div className="text-[10px] font-mono text-white/40 tracking-[0.2em] uppercase font-semibold">
              BUILT FOR A STRONGER TOMORROW
            </div>
            <div className="text-xl sm:text-2xl font-bold text-white">
              People <span className="text-white/30">×</span> Technology <span className="text-white/30">×</span> Safer Cities
            </div>
          </div>

          <div className="text-xs text-white/60 max-w-md text-left md:text-center leading-relaxed">
            A unified emergency response ecosystem connecting citizens, paramedics, hospitals and city command through intelligent technology.
          </div>

          <button
            onClick={() => setVideoModalOpen(true)}
            className="flex items-center gap-3 px-5 py-2.5 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-white text-xs font-mono transition-all whitespace-nowrap"
          >
            <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[9px]">▶</span>
            <span>Watch Video</span>
            <span className="text-white/50 text-[10px]">See MediRoute in action →</span>
          </button>
        </div>

        {/* ── TRUSTED PARTNERS STRIP ── */}
        <div className="mt-8 pt-6 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-6 text-white/40 text-xs font-mono">
          <div className="flex flex-wrap items-center gap-6">
            <span className="text-white/30 uppercase tracking-widest text-[10px]">TRUSTED PARTNERS</span>
            <span className="hover:text-white/70 transition-colors">🏛️ Ministry of Health & Family Welfare</span>
            <span className="hover:text-white/70 transition-colors">🏙️ BMC</span>
            <span className="hover:text-white/70 transition-colors">🩺 NATIONAL HEALTH MISSION</span>
            <span className="hover:text-white/70 transition-colors">🌐 Smart City</span>
            <span className="hover:text-white/70 transition-colors">⚛️ AI FOR SOCIAL GOOD</span>
          </div>

          <div className="flex items-center gap-2 text-white/40 text-[11px]">
            <span>FASTER CARE. STRONGER COMMUNITIES.</span>
            <svg className="w-6 h-3 text-[#FF2D4A]" viewBox="0 0 24 12" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M0 6h6l2-6 4 12 2-6h10" />
            </svg>
          </div>
        </div>
      </section>

      {/* ── SECTION 2: ONE PLATFORM. A STRONGER RESPONSE (Matches Image 3) ── */}
      <section id="platform" className="py-20 px-6 max-w-[1400px] mx-auto border-t border-white/[0.06]">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-4">
          <div>
            <div className="text-[10px] font-mono text-white/40 tracking-[0.25em] uppercase font-semibold mb-2">
              BUILT FOR EVERY STAKEHOLDER
            </div>
            <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight">
              One Platform. <span className="text-white">A Stronger Response.</span>
            </h2>
          </div>

          <div className="text-[11px] font-mono text-white/40 tracking-widest uppercase">
            DIFFERENT ROLES. A SHARED MISSION.
          </div>
        </div>

        {/* 4 Cards Grid (With Exact Photos Cropped from Image 3) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {portalCards.map((card) => (
            <motion.div
              key={card.num}
              whileHover={{ y: -5, transition: { duration: 0.2 } }}
              onClick={() => navigate(card.path)}
              className="group cursor-pointer rounded-xl border p-5 flex flex-col justify-between relative overflow-hidden transition-all bg-[#090a10]"
              style={{
                borderColor: `${card.accentColor}30`,
                boxShadow: `0 0 25px rgba(0,0,0,0.5)`,
              }}
            >
              <div>
                {/* Header with Icon, Name, and Arrow Number */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center"
                      style={{ background: `${card.accentColor}15`, border: `1px solid ${card.accentColor}30` }}
                    >
                      {card.icon}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-white leading-tight">{card.role}</div>
                      <div className="text-[11px] font-mono text-white/50">{card.subrole}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-white/30">{card.num}</span>
                    <span className="w-6 h-6 rounded-full border border-white/20 flex items-center justify-center text-xs text-white/50 group-hover:text-white group-hover:border-white transition-all">
                      →
                    </span>
                  </div>
                </div>

                <p className="text-white/60 text-xs leading-relaxed mb-4 min-h-[36px]">
                  {card.desc}
                </p>
              </div>

              {/* Exact Photo Crop from User's Generation */}
              <div>
                <div className="w-full h-36 rounded-lg overflow-hidden border border-white/10 bg-black relative">
                  <img
                    src={card.image}
                    alt={card.role}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                </div>
                <div className="mt-3 text-[9px] font-mono tracking-[0.2em] text-white/40 uppercase font-semibold">
                  {card.tag}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── SECTION 3: THE MEDIROUTE FLOW (Matches Image 3) ── */}
      <section id="workflow" className="py-20 px-6 max-w-[1400px] mx-auto border-t border-white/[0.06]">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-4">
          <div>
            <div className="text-[10px] font-mono text-white/40 tracking-[0.25em] uppercase font-semibold mb-2">
              THE MEDIROUTE FLOW
            </div>
            <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight">
              From Distress to <span className="text-[#3B82F6]">Definitive Care</span>
            </h2>
          </div>

          <div className="text-[11px] font-mono text-white/40 tracking-widest uppercase">
            INTELLIGENCE ACROSS EVERY STEP
          </div>
        </div>

        {/* 5 Connected Step Circles */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 relative">
          {workflowItems.map((item, idx) => (
            <div
              key={item.step}
              className="flex flex-col items-center text-center p-4 rounded-xl border border-white/[0.05] bg-[#090a10]/60 hover:bg-[#090a10] transition-colors relative"
            >
              {/* Circular Icon with number */}
              <div className="relative mb-3 flex items-center justify-center">
                <div
                  className="w-14 h-14 rounded-full border-2 flex items-center justify-center bg-black/40"
                  style={{ borderColor: item.color }}
                >
                  {item.icon}
                </div>
              </div>

              {/* Number and Title */}
              <div className="text-[10px] font-mono text-white/40 font-bold mb-1">{item.step}</div>
              <div className="text-xs font-bold text-white mb-2 leading-snug">{item.title}</div>
              <p className="text-[11px] text-white/50 leading-relaxed max-w-[200px]">{item.desc}</p>

              {/* Connecting Arrow for desktop */}
              {idx < 4 && (
                <div className="hidden md:block absolute -right-3 top-10 text-white/30 text-base font-bold z-10">
                  →
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── SECTION 4: PRE-FOOTER "LET'S BUILD SAFER CITIES" (Matches Image 3) ── */}
      <section className="py-16 px-6 max-w-[1400px] mx-auto">
        <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-[#090a10] p-8 sm:p-12 shadow-2xl">
          {/* Skyline Silhouette Image in Background */}
          <div
            className="absolute inset-y-0 right-0 w-full sm:w-2/3 pointer-events-none bg-right bg-no-repeat bg-contain opacity-40 mix-blend-screen"
            style={{ backgroundImage: 'url(/cta-skyline.jpg)' }}
          />

          <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-7 space-y-3">
              <div className="text-[10px] font-mono tracking-[0.25em] text-white/40 uppercase font-semibold">
                A HEALTHIER, MORE RESILIENT TOMORROW
              </div>

              <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight">
                Let's Build <span className="text-[#FF2D4A]">Safer Cities.</span>
              </h2>

              <p className="text-white/60 text-xs sm:text-sm max-w-lg leading-relaxed pt-1">
                Join government bodies, healthcare institutions and innovators in creating a faster, smarter and more humane emergency response ecosystem.
              </p>
            </div>

            <div className="lg:col-span-5 flex flex-col sm:flex-row items-center gap-3 justify-end">
              <button
                onClick={() => navigate('/login')}
                className="px-6 py-3.5 rounded-xl bg-gradient-to-r from-[#941324] via-[#b5172e] to-[#941324] hover:from-[#b5172e] hover:to-[#c91a33] text-white text-xs font-bold shadow-[0_0_20px_rgba(255,45,74,0.3)] border border-red-500/40 transition-all flex items-center gap-2 whitespace-nowrap"
              >
                <span>🚑 Launch Command Portal</span>
                <span>→</span>
              </button>

              <button
                onClick={() => { window.location.href = 'mailto:contact@mediroute.org' }}
                className="px-6 py-3.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-white text-xs font-semibold transition-all flex items-center gap-2 whitespace-nowrap"
              >
                <span>Get in Touch</span>
                <span>→</span>
              </button>

              <div className="hidden sm:block text-right text-[9px] font-mono tracking-widest text-white/30 uppercase pl-3">
                PEOPLE<br />TECHNOLOGY<br />SAFER CITIES
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER (Matches Image 3) ── */}
      <footer className="border-t border-white/[0.06] py-8 px-6 max-w-[1400px] mx-auto">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 text-xs text-white/50 font-mono">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-[#FF2D4A]" viewBox="0 0 24 12" fill="none" stroke="currentColor" strokeWidth={2.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M0 6h6l2.5-6 4 12 2.5-6h9" />
            </svg>
            <span className="text-white font-bold font-display text-sm">MediRoute</span>
            <span className="text-white/40">© 2026 MediRoute. All rights reserved.</span>
          </div>

          {/* Legal Links */}
          <div className="flex items-center gap-6">
            <a href="#privacy" className="hover:text-white transition-colors">Privacy</a>
            <a href="#terms" className="hover:text-white transition-colors">Terms</a>
            <a href="#contact" className="hover:text-white transition-colors">Contact</a>
          </div>

          {/* Tagline */}
          <div className="flex items-center gap-2 text-white/40 text-[11px]">
            <span>Faster Response. Brighter Tomorrows.</span>
            <svg className="w-5 h-3 text-[#FF2D4A]" viewBox="0 0 24 12" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M0 6h6l2-6 4 12 2-6h10" />
            </svg>
          </div>
        </div>
      </footer>

      {/* Video Modal (Mock presentation) */}
      <AnimatePresence>
        {videoModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
            onClick={() => setVideoModalOpen(false)}
          >
            <div className="relative w-full max-w-3xl rounded-2xl overflow-hidden border border-white/20 bg-[#0a0a14] p-6 text-center" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <span className="font-bold text-white font-display">MediRoute Platform Overview</span>
                <button onClick={() => setVideoModalOpen(false)} className="text-white/50 hover:text-white text-lg">✕</button>
              </div>
              <div className="aspect-video w-full rounded-xl bg-black border border-white/10 flex flex-col items-center justify-center p-6">
                <div className="w-16 h-16 rounded-full bg-red-600/20 border border-red-500/40 flex items-center justify-center mb-3">
                  <span className="text-2xl text-red-400">▶</span>
                </div>
                <div className="text-white font-semibold">MediRoute — Real-Time Emergency Coordination Engine</div>
                <p className="text-white/50 text-xs mt-1 max-w-md">Demonstrating automated dispatch, AI triage scoring (ESI 1–5), green corridor signals, and zero-wait ER handover.</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuthStore } from '../store/authStore'
import toast from 'react-hot-toast'

const ROLE_CONFIG = {
  patient: { label: 'Patient', icon: '🆘', color: '#FF2D4A', path: '/patient' },
  paramedic: { label: 'Paramedic', icon: '🚑', color: '#00F5FF', path: '/paramedic' },
  hospital_staff: { label: 'Hospital Staff', icon: '🏥', color: '#7C3AED', path: '/hospital' },
  admin: { label: 'Admin', icon: '📊', color: '#FF8C00', path: '/admin' },
}

const DEMO_PRESETS = [
  { role: 'admin', label: 'Admin', email: 'admin@mediroute.com', pass: 'admin123', icon: '📊', color: '#FF8C00' },
  { role: 'paramedic', label: 'Paramedic', email: 'paramedic@mediroute.com', pass: 'paramedic123', icon: '🚑', color: '#00F5FF' },
  { role: 'hospital_staff', label: 'Hospital ER', email: 'hospital@mediroute.com', pass: 'hospital123', icon: '🏥', color: '#7C3AED' },
  { role: 'patient', label: 'Citizen SOS', email: 'patient@mediroute.com', pass: 'patient123', icon: '🆘', color: '#FF2D4A' },
]

export default function LoginPage() {
  const navigate = useNavigate()
  const { login, register, loading } = useAuthStore()
  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [selectedRole, setSelectedRole] = useState('admin')
  const [form, setForm] = useState({ name: '', email: 'admin@mediroute.com', password: 'admin123', phone: '' })

  const handleQuickDemo = async (preset) => {
    setSelectedRole(preset.role)
    setMode('login')
    setForm({ ...form, email: preset.email, password: preset.pass })
    try {
      const data = await login(preset.email, preset.pass, preset.role)
      toast.success(`Welcome to ${preset.label} Portal!`)
      navigate(ROLE_CONFIG[data.user.role].path)
    } catch (err) {
      toast.error(err.response?.data?.message || 'Login failed')
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      if (mode === 'login') {
        const data = await login(form.email, form.password, selectedRole)
        toast.success(`Welcome back, ${data.user.name}!`)
        navigate(ROLE_CONFIG[data.user.role].path)
      } else {
        const data = await register({ ...form, role: selectedRole })
        toast.success('Account created successfully!')
        navigate(ROLE_CONFIG[data.user.role].path)
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Authentication failed')
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center px-4 py-8 relative overflow-hidden">
      {/* Background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 70% 60% at 50% 50%, rgba(255,45,74,0.07) 0%, transparent 70%)' }}
      />
      <div className="absolute inset-0 bg-grid-pattern opacity-10 pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-lg"
      >
        {/* Logo */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-3 mb-2 cursor-pointer" onClick={() => navigate('/')}>
            <div className="w-12 h-12 bg-emergency rounded-xl flex items-center justify-center glow-red">
              <span className="text-white text-2xl font-bold font-display">M</span>
            </div>
            <span className="font-display font-bold text-3xl text-white">
              Medi<span className="text-emergency">Route</span>
            </span>
          </div>
          <p className="text-white/40 text-sm font-mono">Next-Gen Intelligent Emergency Response</p>
        </div>

        {/* 1-Click Demo Logins Banner */}
        <div className="glass-card p-4 mb-4 border border-cyan-500/30 bg-cyan-950/20">
          <div className="flex items-center justify-between mb-2">
            <span className="text-cyan-400 font-mono text-xs font-semibold tracking-wider uppercase flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
              1-Click Demo Evaluation Portals
            </span>
            <span className="text-white/30 text-[11px] font-mono">Instant Access</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {DEMO_PRESETS.map((p) => (
              <button
                key={p.role}
                type="button"
                onClick={() => handleQuickDemo(p)}
                disabled={loading}
                className="flex flex-col items-center justify-center p-2 rounded-lg bg-surface-elevated/80 border border-white/10 hover:border-white/30 hover:bg-white/5 transition-all text-center group"
                style={{ borderColor: `${p.color}40` }}
              >
                <span className="text-lg mb-0.5 group-hover:scale-110 transition-transform">{p.icon}</span>
                <span className="text-xs font-semibold text-white/90">{p.label}</span>
                <span className="text-[10px] text-white/40 font-mono">Auto Login →</span>
              </button>
            ))}
          </div>
        </div>

        {/* Card */}
        <div className="glass-card p-6 sm:p-8">
          {/* Mode toggle */}
          <div className="flex rounded-xl bg-surface-elevated p-1 mb-6">
            {['login', 'register'].map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all duration-200 capitalize ${
                  mode === m ? 'bg-emergency text-white glow-red' : 'text-white/40 hover:text-white/70'
                }`}
              >
                {m === 'login' ? 'Sign In' : 'Register New'}
              </button>
            ))}
          </div>

          {/* Role selector */}
          <div className="mb-5">
            <label className="text-white/50 text-xs font-mono uppercase tracking-wider mb-2 block">
              Select Active Role
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {Object.entries(ROLE_CONFIG).map(([role, cfg]) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setSelectedRole(role)}
                  className={`p-2.5 rounded-xl text-center transition-all duration-200 border ${
                    selectedRole === role
                      ? 'border-current bg-current/10 shadow-lg'
                      : 'border-surface-border bg-surface-elevated hover:border-white/20'
                  }`}
                  style={selectedRole === role ? { color: cfg.color, borderColor: `${cfg.color}80` } : {}}
                >
                  <div className="text-lg mb-0.5">{cfg.icon}</div>
                  <div className="text-xs font-semibold" style={selectedRole === role ? { color: cfg.color } : { color: '#ffffff99' }}>
                    {cfg.label}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <>
                <div>
                  <label className="text-white/50 text-xs font-mono uppercase tracking-wider mb-1.5 block">Full Name</label>
                  <input
                    className="input-dark"
                    placeholder="Dr. Jane Doe / Chief Operator"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="text-white/50 text-xs font-mono uppercase tracking-wider mb-1.5 block">Phone Number</label>
                  <input
                    className="input-dark"
                    placeholder="+91 98765 43210"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>
              </>
            )}
            <div>
              <label className="text-white/50 text-xs font-mono uppercase tracking-wider mb-1.5 block">Email Address</label>
              <input
                type="email"
                className="input-dark"
                placeholder="admin@mediroute.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="text-white/50 text-xs font-mono uppercase tracking-wider mb-1.5 block">Password</label>
              <input
                type="password"
                className="input-dark"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-emergency w-full justify-center mt-3 py-3"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="block w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
                  />
                  Authorizing Access...
                </span>
              ) : (
                mode === 'login' ? `→ Enter ${ROLE_CONFIG[selectedRole]?.label || ''} Portal` : '→ Create Account'
              )}
            </button>
          </form>

          {/* Credentials Info Helper Box */}
          <div className="mt-5 p-3 rounded-lg bg-surface-elevated/50 border border-white/5 text-[11px] font-mono text-white/50 space-y-1">
            <div className="text-white/70 font-semibold mb-1">Pre-configured Demo Credentials:</div>
            <div>• <strong className="text-orange-400">Admin:</strong> admin@mediroute.com / admin123</div>
            <div>• <strong className="text-cyan-400">Paramedic:</strong> paramedic@mediroute.com / paramedic123</div>
            <div>• <strong className="text-purple-400">Hospital ER:</strong> hospital@mediroute.com / hospital123</div>
            <div>• <strong className="text-red-400">Patient:</strong> patient@mediroute.com / patient123</div>
          </div>
        </div>

        <div className="text-center mt-4">
          <button
            onClick={() => navigate('/')}
            className="text-white/40 hover:text-white text-xs font-mono transition-colors"
          >
            ← Back to Landing Page & 3D Visualizer
          </button>
        </div>
      </motion.div>
    </div>
  )
}

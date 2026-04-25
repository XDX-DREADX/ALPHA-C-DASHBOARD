import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase, fetchSensorData, subscribeToSensorData } from "./lib/supabase";
import {
  Leaf,
  Droplet,
  Activity,
  Cloud,
  Download,
  Clock,
  ArrowUpRight,
  Fan,
  Sun,
  Moon
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  ComposedChart
} from "recharts";

// ----------------------------------------------------------------------
// Fallback Data (shown while loading or if DB is empty)
// ----------------------------------------------------------------------
const fallbackChartData = [
  { time: "00:00", ph: 7.1, od: 12.0, co2: 400 },
  { time: "04:00", ph: 7.2, od: 12.5, co2: 420 },
  { time: "08:00", ph: 7.4, od: 13.2, co2: 450 },
  { time: "12:00", ph: 7.3, od: 14.1, co2: 480 },
  { time: "16:00", ph: 7.2, od: 14.5, co2: 460 },
  { time: "20:00", ph: 7.1, od: 14.8, co2: 430 },
  { time: "24:00", ph: 7.2, od: 15.0, co2: 450 },
];

const fallbackHistoryData = [
  { id: 1, time: "10:00", ph: 7.2, od: 14.5, co2: 450 },
  { id: 2, time: "09:45", ph: 7.1, od: 14.4, co2: 455 },
  { id: 3, time: "09:30", ph: 7.3, od: 14.2, co2: 460 },
  { id: 4, time: "09:15", ph: 7.2, od: 14.1, co2: 465 },
  { id: 5, time: "09:00", ph: 7.4, od: 13.9, co2: 470 },
];

// Helper: format timestamp to HH:MM
const formatTime = (ts) => {
  const d = new Date(ts);
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
};

// Polling interval in ms (10 seconds for responsive sync)
const POLL_INTERVAL_MS = 10_000;

// ----------------------------------------------------------------------
// Custom Components
// ----------------------------------------------------------------------

// Liquid Wave Component (SVG)
const LiquidWave = ({ color = "rgba(16, 185, 129, 0.2)" }) => (
  <div className="absolute bottom-0 left-0 w-full overflow-hidden leading-none z-0 h-24 pointer-events-none opacity-60">
    <svg
      className="absolute bottom-0 w-[200%] h-full animate-wave"
      viewBox="0 0 1200 120"
      preserveAspectRatio="none"
    >
      <path
        d="M0,0V46.29c47.79,22.2,103.59,32.17,158,28,70.36-5.37,136.33-33.31,206.8-37.5C438.64,32.43,512.34,53.67,583,72.05c69.27,18,138.3,24.88,209.4,13.08,36.15-6,69.85-17.84,104.45-29.34C989.49,25,1113-14.29,1200,52.47V0Z"
        fill="none"
      ></path>
      <path
        d="M0,46.29c47.79,22.2,103.59,32.17,158,28,70.36-5.37,136.33-33.31,206.8-37.5C438.64,32.43,512.34,53.67,583,72.05c69.27,18,138.3,24.88,209.4,13.08,36.15-6,69.85-17.84,104.45-29.34C989.49,25,1113-14.29,1200,52.47V120H0Z"
        fill={color}
      ></path>
    </svg>
    <svg
      className="absolute bottom-0 w-[200%] h-full animate-wave-slow opacity-50"
      viewBox="0 0 1200 120"
      preserveAspectRatio="none"
      style={{ animationDirection: "reverse" }}
    >
      <path
        d="M0,46.29c47.79,22.2,103.59,32.17,158,28,70.36-5.37,136.33-33.31,206.8-37.5C438.64,32.43,512.34,53.67,583,72.05c69.27,18,138.3,24.88,209.4,13.08,36.15-6,69.85-17.84,104.45-29.34C989.49,25,1113-14.29,1200,52.47V120H0Z"
        fill={color}
      ></path>
    </svg>
  </div>
);

// Glassmorphism Card Wrapper
const GlassCard = ({ children, className = "", waveColor }) => {
  return (
    <div
      className={`relative overflow-hidden backdrop-blur-2xl border rounded-3xl transition-all duration-500 group ${className}
        bg-white/40 border-white/40 shadow-[0_8px_32px_0_rgba(0,0,0,0.05)] hover:bg-white/60 hover:border-white/60
        dark:bg-slate-900/40 dark:border-white/10 dark:shadow-[0_8px_32px_0_rgba(0,0,0,0.4)] dark:hover:bg-slate-900/50 dark:hover:border-white/20`}
    >
      {/* Specular Highlight & Inner Glass Reflection */}
      <div className="absolute inset-0 border-t border-l border-white/40 dark:border-white/20 rounded-3xl opacity-50 pointer-events-none"></div>
      <div className="absolute inset-0 bg-gradient-to-br from-white/20 dark:from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
      
      {waveColor && <LiquidWave color={waveColor} />}
      
      <div className="relative z-10">{children}</div>
    </div>
  );
};

// ----------------------------------------------------------------------
// Main Application
// ----------------------------------------------------------------------
export default function App() {
  const [co2Level, setCo2Level] = useState(450);
  const [isAeratorOn, setIsAeratorOn] = useState(true);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Live data states
  const [chartData, setChartData] = useState(fallbackChartData);
  const [historyData, setHistoryData] = useState(fallbackHistoryData);
  const [latestData, setLatestData] = useState({ ph: 7.2, od: 14.5, co2: 450 });
  const [lastUpdated, setLastUpdated] = useState(null);
  const channelRef = useRef(null);
  const isMountedRef = useRef(true);

  // ----- helpers to process rows from Supabase -----
  const processRows = useCallback((rows) => {
    if (!rows || rows.length === 0) return;

    // rows are newest-first from the API
    const reversed = [...rows].reverse();
    setChartData(reversed.map(r => ({
      time: formatTime(r.created_at),
      ph: r.ph,
      od: r.turbidity,
      co2: r.co2,
    })));

    // Latest reading = most recent row (first in the original order)
    const latest = rows[0];
    setLatestData({ ph: latest.ph, od: latest.turbidity, co2: latest.co2 });
    setCo2Level(Math.round(latest.co2));
    setLastUpdated(new Date(latest.created_at));

    // Sync aerator status from IoT
    if (latest.aerator_status !== undefined) {
      setIsAeratorOn(latest.aerator_status === 'ON');
    }

    // History table = last 10
    setHistoryData(rows.slice(0, 10).map((r) => ({
      id: r.id,
      time: formatTime(r.created_at),
      ph: r.ph,
      od: r.turbidity,
      co2: r.co2,
    })));
  }, []);

  // ----- Fetch data from Supabase -----
  const fetchData = useCallback(async () => {
    const { rows, error } = await fetchSensorData(50);

    if (error) {
      console.error("[ALPHA-C] fetchData error:", error);
      return;
    }

    if (isMountedRef.current && rows.length > 0) {
      processRows(rows);
    }
  }, [processRows]);

  // ----- Initial setup: fetch + realtime subscribe -----
  useEffect(() => {
    isMountedRef.current = true;

    // 1) Fetch existing sensor data immediately
    fetchData();

    // 2) Subscribe to realtime inserts — data appears instantly when IoT pushes to Supabase
    const channel = subscribeToSensorData({
      onInsert: (row) => {
        if (!isMountedRef.current) return;
        const newPoint = { time: formatTime(row.created_at), ph: row.ph, od: row.turbidity, co2: row.co2 };

        setLastUpdated(new Date(row.created_at));
        setChartData(prev => [...prev.slice(-49), newPoint]);
        setLatestData({ ph: row.ph, od: row.turbidity, co2: row.co2 });
        setCo2Level(Math.round(row.co2));
        if (row.aerator_status !== undefined) {
          setIsAeratorOn(row.aerator_status === 'ON');
        }
        setHistoryData(prev => [{ id: row.id, ...newPoint }, ...prev.slice(0, 9)]);
      },
      onStatusChange: (status, err) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error("[ALPHA-C] Realtime error:", status, err);
        }
      },
    });

    channelRef.current = channel;

    // 3) Poll every POLL_INTERVAL_MS as a backup (in case realtime drops)
    const interval = setInterval(fetchData, POLL_INTERVAL_MS);

    return () => {
      isMountedRef.current = false;
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [fetchData]);

  // Handle cursor spotlight effect
  useEffect(() => {
    const handleMouseMove = (e) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // Recharts Dynamic Colors
  const chartStrokeColor = isDarkMode ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.2)";
  const chartTickColor = isDarkMode ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)";
  const chartGridColor = isDarkMode ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";
  const tooltipStyle = {
    backgroundColor: isDarkMode ? 'rgba(15, 23, 42, 0.8)' : 'rgba(255, 255, 255, 0.8)',
    backdropFilter: 'blur(16px)',
    border: isDarkMode ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.1)',
    borderRadius: '16px',
    boxShadow: isDarkMode ? '0 8px 32px rgba(0,0,0,0.5)' : '0 8px 32px rgba(0,0,0,0.1)',
    color: isDarkMode ? '#fff' : '#1e293b'
  };

  return (
    <div className={isDarkMode ? "dark" : ""}>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 font-sans overflow-hidden relative selection:bg-emerald-500/30 transition-colors duration-500">
        
        {/* Injecting CSS for complex animations (Waves, Blobs, Glows) */}
        <style>{`
          @keyframes wave {
            0% { transform: translateX(0) translateZ(0); }
            50% { transform: translateX(-25%) translateZ(0); }
            100% { transform: translateX(-50%) translateZ(0); }
          }
          @keyframes blob {
            0% { transform: translate(0px, 0px) scale(1); }
            33% { transform: translate(40px, -60px) scale(1.1); }
            66% { transform: translate(-30px, 30px) scale(0.9); }
            100% { transform: translate(0px, 0px) scale(1); }
          }
          .animate-wave { animation: wave 12s linear infinite; }
          .animate-wave-slow { animation: wave 18s linear infinite; }
          .animate-blob { animation: blob 15s infinite alternate; }
          .animation-delay-2000 { animation-delay: 2s; }
          .animation-delay-4000 { animation-delay: 4s; }
          
          /* Icon Animations */
          @keyframes breath-glow {
            0%, 100% { transform: scale(1); filter: drop-shadow(0 0 5px rgba(16, 185, 129, 0.4)); }
            50% { transform: scale(1.05); filter: drop-shadow(0 0 15px rgba(16, 185, 129, 0.9)); }
          }
          @keyframes morph-drip {
            0%, 100% { transform: scale(1) translateY(0); }
            30% { transform: scale(1.05, 0.95) translateY(2px); }
            60% { transform: scale(0.95, 1.05) translateY(-2px); }
          }
          @keyframes dash-flow {
            to { stroke-dashoffset: -24; }
          }
          @keyframes float-cloud {
            0%, 100% { transform: translateY(0px); opacity: 0.85; }
            50% { transform: translateY(-5px); opacity: 1; filter: drop-shadow(0 5px 10px rgba(245,158,11,0.3)); }
          }
          .animate-breath-glow { animation: breath-glow 3.2s ease-in-out infinite; }
          .animate-morph-drip { animation: morph-drip 2.7s ease-in-out infinite; }
          .animate-oscilloscope { stroke-dasharray: 12; animation: dash-flow 1s linear infinite; }
          .animate-float-cloud { animation: float-cloud 4.1s ease-in-out infinite; }
          
          /* Recharts Customization for Glowing Lines */
          .recharts-line-curve { filter: drop-shadow(0 0 8px rgba(16, 185, 129, 0.6)); }
          .recharts-line:nth-child(2) .recharts-line-curve { filter: drop-shadow(0 0 8px rgba(56, 189, 248, 0.6)); }
          .recharts-line:nth-child(3) .recharts-line-curve { filter: drop-shadow(0 0 8px rgba(245, 158, 11, 0.6)); }
        `}</style>

        {/* Dynamic Mesh Background */}
        <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none transition-colors duration-500">
          <div className="absolute top-[-10%] left-[-10%] w-[60vw] h-[60vw] bg-emerald-300/40 dark:bg-emerald-700/20 rounded-full mix-blend-multiply dark:mix-blend-screen filter blur-[120px] animate-blob transition-colors duration-500"></div>
          <div className="absolute top-[20%] right-[-10%] w-[50vw] h-[50vw] bg-teal-300/50 dark:bg-teal-800/30 rounded-full mix-blend-multiply dark:mix-blend-screen filter blur-[140px] animate-blob animation-delay-2000 transition-colors duration-500"></div>
          <div className="absolute bottom-[-20%] left-[20%] w-[60vw] h-[60vw] bg-blue-300/50 dark:bg-blue-900/40 rounded-full mix-blend-multiply dark:mix-blend-screen filter blur-[130px] animate-blob animation-delay-4000 transition-colors duration-500"></div>
          <div className="absolute inset-0 bg-slate-50/40 dark:bg-slate-950/40 backdrop-blur-[50px] transition-colors duration-500"></div>
        </div>

        {/* Cursor Spotlight Overlay */}
        <div
          className="pointer-events-none fixed inset-0 z-50 transition-opacity duration-300"
          style={{
            background: `radial-gradient(800px circle at ${mousePos.x}px ${mousePos.y}px, ${isDarkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'}, transparent 40%)`,
          }}
        />

        <div className="relative z-10 p-4 md:p-8 max-w-7xl mx-auto">
          
          {/* Header */}
          <header className="flex flex-col md:flex-row justify-between items-center mb-10">
            <div className="flex items-center gap-4 mb-4 md:mb-0 group cursor-pointer">
              <div className="relative">
                <div className="absolute inset-0 bg-emerald-500 rounded-xl blur-lg opacity-40 group-hover:opacity-70 transition-opacity duration-500"></div>
                <div className="relative bg-white/80 dark:bg-emerald-950/50 backdrop-blur-xl border border-emerald-500/30 p-3 rounded-xl text-emerald-600 dark:text-emerald-400 transition-colors">
                  <Leaf className="w-7 h-7 animate-breath-glow" />
                </div>
              </div>
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-800 dark:text-white drop-shadow-sm dark:drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] transition-colors duration-300">
                ALPHA-C <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-500 to-teal-500 dark:from-emerald-400 dark:to-teal-400 font-bold">Command Center</span>
              </h1>
            </div>
            
            <div className="flex items-center gap-4">
              {/* Theme Toggle Button */}
              <button 
                onClick={() => setIsDarkMode(!isDarkMode)}
                className="p-3 rounded-full bg-white/50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 shadow-sm dark:shadow-[0_0_15px_rgba(255,255,255,0.05)] text-slate-600 dark:text-slate-300 hover:bg-white/80 dark:hover:bg-slate-700/50 transition-all focus:outline-none"
                aria-label="Toggle Theme"
              >
                {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>
            </div>
          </header>

          {/* Hero Section: Liquid Glass Metrics Grid */}
          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
            
            {/* Card 1: pH */}
            <GlassCard className="p-6" waveColor={isDarkMode ? "rgba(56, 189, 248, 0.15)" : "rgba(56, 189, 248, 0.3)"}>
              <div className="flex justify-between items-start mb-6">
                <div>
                  <p className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Tingkat pH</p>
                  <h2 className="text-5xl font-bold text-slate-800 dark:text-white drop-shadow-sm dark:drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]">
                    {latestData.ph.toFixed(1)} <span className="text-xl font-medium text-slate-400 dark:text-slate-500">pH</span>
                  </h2>
                </div>
                <div className="bg-sky-100 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/20 p-3 rounded-2xl text-sky-600 dark:text-sky-400 shadow-sm dark:shadow-[0_0_15px_rgba(56,189,248,0.2)] transition-colors">
                  <Droplet className="w-6 h-6 animate-morph-drip" />
                </div>
              </div>
              <div className="flex items-center text-sm mt-4">
                <span className="bg-sky-100 dark:bg-sky-500/20 border border-sky-200 dark:border-sky-500/30 text-sky-700 dark:text-sky-300 px-3 py-1 rounded-lg text-xs font-semibold mr-3 shadow-sm dark:shadow-[0_0_10px_rgba(56,189,248,0.2)] transition-colors">
                  Optimal
                </span>
                <span className="text-slate-500 dark:text-slate-400">Batas: 6.5 - 8.0</span>
              </div>
            </GlassCard>

            {/* Card 2: OD / Biomass */}
            <GlassCard className="p-6" waveColor={isDarkMode ? "rgba(16, 185, 129, 0.15)" : "rgba(16, 185, 129, 0.3)"}>
              <div className="flex justify-between items-start mb-6">
                <div>
                  <p className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Kepadatan OD</p>
                  <h2 className="text-5xl font-bold text-slate-800 dark:text-white drop-shadow-sm dark:drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]">
                    {latestData.od.toFixed(1)} <span className="text-xl font-medium text-slate-400 dark:text-slate-500">NTU</span>
                  </h2>
                </div>
                <div className="bg-emerald-100 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 p-3 rounded-2xl text-emerald-600 dark:text-emerald-400 shadow-sm dark:shadow-[0_0_15px_rgba(16,185,129,0.2)] transition-colors">
                  <Activity className="w-6 h-6 animate-oscilloscope" />
                </div>
              </div>
              <div className="flex items-center text-sm mt-4">
                <ArrowUpRight className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mr-1 drop-shadow-sm dark:drop-shadow-[0_0_5px_rgba(16,185,129,0.5)]" />
                <span className="text-emerald-700 dark:text-emerald-400 font-bold mr-3 drop-shadow-sm dark:drop-shadow-[0_0_5px_rgba(16,185,129,0.3)]">+1.2%</span>
                <span className="text-slate-500 dark:text-slate-400">Turbidity Level</span>
              </div>
            </GlassCard>

            {/* Card 3: CO2 Sequestration */}
            <GlassCard className="p-6" waveColor={isDarkMode ? "rgba(245, 158, 11, 0.1)" : "rgba(245, 158, 11, 0.2)"}>
              <div className="flex justify-between items-start mb-6">
                <div>
                  <p className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Sekuestrasi CO₂</p>
                  <h2 className={`text-5xl font-bold ${co2Level > 1000 ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"} drop-shadow-sm dark:drop-shadow-[0_0_10px_rgba(245,158,11,0.3)]`}>
                    {co2Level} <span className="text-xl font-medium text-slate-400 dark:text-slate-500">PPM</span>
                  </h2>
                </div>
                <div className="bg-amber-100 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-3 rounded-2xl text-amber-600 dark:text-amber-400 shadow-sm dark:shadow-[0_0_15px_rgba(245,158,11,0.2)] transition-colors">
                  <Cloud className="w-6 h-6 animate-float-cloud" />
                </div>
              </div>
              <div className="flex items-center text-sm mt-4">
                <span className="bg-amber-100 dark:bg-amber-500/20 border border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 px-3 py-1 rounded-lg text-xs font-semibold mr-3 shadow-sm dark:shadow-[0_0_10px_rgba(245,158,11,0.2)] transition-colors">
                  Stabil
                </span>
                <span className="text-slate-500 dark:text-slate-400">Konsumsi gas aktif</span>
              </div>
            </GlassCard>

            {/* Card 4: Aerator Status */}
            <GlassCard className="p-6 flex flex-col justify-between group/aerator relative">
              {/* Ambient inner glow when ON */}
              {isAeratorOn && (
                <div className="absolute inset-0 bg-cyan-300/20 dark:bg-cyan-500/5 mix-blend-multiply dark:mix-blend-screen pointer-events-none transition-opacity duration-1000 rounded-3xl"></div>
              )}
              
              <div className="flex justify-between items-start mb-4 relative z-10">
                <div>
                  <p className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Sistem Aerator</p>
                  <h2 className={`text-3xl font-extrabold ${isAeratorOn ? "text-cyan-600 dark:text-cyan-400 drop-shadow-sm dark:drop-shadow-[0_0_10px_rgba(34,211,238,0.4)]" : "text-slate-400 dark:text-slate-500"}`}>
                    {isAeratorOn ? "MENYALA" : "MATI"}
                  </h2>
                </div>
                
                <button 
                  onClick={() => setIsAeratorOn(!isAeratorOn)}
                  className={`p-3 rounded-2xl transition-all duration-300 border backdrop-blur-md relative
                    ${isAeratorOn 
                      ? 'bg-cyan-50 dark:bg-cyan-500/10 border-cyan-200 dark:border-cyan-500/30 text-cyan-600 dark:text-cyan-400 shadow-md dark:shadow-[0_0_20px_rgba(34,211,238,0.3)]' 
                      : 'bg-slate-100 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700'}
                  `}
                >
                  <Fan className={`w-6 h-6 ${isAeratorOn ? 'animate-spin' : ''}`} style={{ animationDuration: isAeratorOn ? '0.6s' : '0s' }} />
                </button>
              </div>
              
              <div className="flex flex-col gap-3 mt-auto border-t border-slate-200 dark:border-white/5 pt-4 relative z-10">
                <div className="flex items-center text-sm">
                  <span className="bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 px-3 py-1 rounded-lg text-xs font-semibold mr-3 transition-colors">
                    Interval
                  </span>
                  <span className="text-slate-600 dark:text-slate-300 font-medium">15m ON / 45m OFF</span>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-800/80 rounded-full h-1.5 overflow-hidden border border-transparent dark:border-white/5 transition-colors">
                  <div className="bg-gradient-to-r from-cyan-500 to-cyan-300 dark:from-cyan-600 dark:to-cyan-400 h-1.5 rounded-full" style={{ width: '45%' }}></div>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-500">Siklus berjalan:</span>
                  <span className="font-semibold text-cyan-600 dark:text-cyan-400">8 menit tersisa</span>
                </div>
              </div>
            </GlassCard>

          </section>

          {/* Main Content: Glowing Live Chart Area */}
          <GlassCard className="p-6 md:p-8 mb-10 shadow-lg dark:shadow-[0_10px_40px_rgba(0,0,0,0.5)]">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
              <div>
                <h3 className="text-xl font-bold text-slate-800 dark:text-white drop-shadow-sm dark:drop-shadow-[0_0_8px_rgba(255,255,255,0.2)] transition-colors">Fluktuasi Sistem Real-Time</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Pemantauan 24 jam terakhir (Diperbarui setiap menit)</p>
              </div>
              
              <div className="flex bg-white/60 dark:bg-slate-900/60 p-2 rounded-2xl border border-white/60 dark:border-white/5 backdrop-blur-md shadow-sm dark:shadow-none transition-colors">
                <div className="flex items-center px-4 py-2 bg-emerald-50 dark:bg-emerald-500/10 rounded-xl border border-emerald-100 dark:border-emerald-500/20 mr-2 transition-colors">
                  <span className="w-3 h-3 rounded-full bg-emerald-500 shadow-sm dark:shadow-[0_0_10px_rgba(16,185,129,0.8)] mr-2"></span>
                  <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">OD</span>
                </div>
                <div className="flex items-center px-4 py-2 bg-sky-50 dark:bg-sky-500/10 rounded-xl border border-sky-100 dark:border-sky-500/20 mr-2 transition-colors">
                  <span className="w-3 h-3 rounded-full bg-sky-500 shadow-sm dark:shadow-[0_0_10px_rgba(56,189,248,0.8)] mr-2"></span>
                  <span className="text-xs font-bold text-sky-700 dark:text-sky-400">pH</span>
                </div>
                <div className="flex items-center px-4 py-2 bg-amber-50 dark:bg-amber-500/10 rounded-xl border border-amber-100 dark:border-amber-500/20 transition-colors">
                  <span className="w-3 h-3 rounded-full bg-amber-500 shadow-sm dark:shadow-[0_0_10px_rgba(245,158,11,0.8)] mr-2"></span>
                  <span className="text-xs font-bold text-amber-700 dark:text-amber-400">CO₂</span>
                </div>
              </div>
            </div>
            
            <div className="h-[350px] w-full relative min-h-[350px]">
              {/* Chart Grid Background Enhancements */}
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-emerald-100/50 dark:from-emerald-900/10 via-transparent to-transparent pointer-events-none transition-colors duration-500"></div>
              
              <ResponsiveContainer width="100%" height={350} minHeight={350}>
                <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorOD" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={isDarkMode ? 0.3 : 0.2}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} vertical={false} />
                  <XAxis dataKey="time" stroke={chartStrokeColor} tick={{fill: chartTickColor, fontSize: 12}} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="left" orientation="left" stroke={chartStrokeColor} tick={{fill: chartTickColor, fontSize: 12}} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="right" orientation="right" stroke={chartStrokeColor} tick={{fill: chartTickColor, fontSize: 12}} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={tooltipStyle}
                    itemStyle={{ fontWeight: 'bold' }}
                  />
                  <Area yAxisId="left" type="monotone" dataKey="od" stroke="#10b981" strokeWidth={4} fillOpacity={1} fill="url(#colorOD)" activeDot={{ r: 6, fill: '#10b981', stroke: '#fff', strokeWidth: 2 }} />
                  <Line yAxisId="left" type="monotone" dataKey="ph" stroke="#38bdf8" strokeWidth={3} dot={false} activeDot={{ r: 6, fill: '#38bdf8', stroke: '#fff', strokeWidth: 2 }} />
                  <Line yAxisId="right" type="monotone" dataKey="co2" stroke="#f59e0b" strokeWidth={3} dot={false} activeDot={{ r: 6, fill: '#f59e0b', stroke: '#fff', strokeWidth: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </GlassCard>

          {/* Bottom Section: Table & Action */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 relative z-10">
            
            {/* Table Area */}
            <GlassCard className="lg:col-span-2 p-6 md:p-8 overflow-x-auto">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-slate-800 dark:text-white drop-shadow-sm dark:drop-shadow-[0_0_5px_rgba(255,255,255,0.2)] transition-colors">Riwayat Pembacaan Terakhir</h3>
                <div className="bg-white/80 dark:bg-slate-800/80 p-2 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm dark:shadow-none transition-colors">
                  <Clock className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                </div>
              </div>
              
              <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
                <thead className="bg-slate-100/80 dark:bg-slate-900/80 text-slate-500 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-white/10 transition-colors">
                  <tr>
                    <th className="px-6 py-4 rounded-tl-xl">Waktu</th>
                    <th className="px-6 py-4">pH Sensor</th>
                    <th className="px-6 py-4">OD (NTU)</th>
                    <th className="px-6 py-4 rounded-tr-xl">CO₂ (PPM)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5 transition-colors">
                  {historyData.map((row, index) => (
                    <tr key={`history-${row.id}-${index}`} className="hover:bg-white/50 dark:hover:bg-white/5 transition-colors group cursor-default">
                      <td className="px-6 py-4 font-medium text-slate-700 dark:text-slate-200 flex items-center gap-3">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm dark:shadow-[0_0_8px_rgba(16,185,129,0.8)] group-hover:animate-pulse"></span>
                        {row.time}
                      </td>
                      <td className="px-6 py-4 text-sky-700 dark:text-sky-200">{row.ph}</td>
                      <td className="px-6 py-4 text-emerald-700 dark:text-emerald-200">{row.od}</td>
                      <td className="px-6 py-4 text-amber-700 dark:text-amber-200">{row.co2}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </GlassCard>

            {/* Action Area */}
            <GlassCard className="p-8 flex flex-col justify-center items-center text-center relative overflow-hidden group/btn">
              {/* Background glowing orb */}
              <div className="absolute inset-0 bg-emerald-500/5 dark:bg-emerald-500/10 opacity-0 group-hover/btn:opacity-100 transition-opacity duration-700 blur-2xl"></div>
              
              <div className="bg-white/90 dark:bg-slate-900/80 p-5 rounded-full mb-6 border border-slate-200 dark:border-white/10 shadow-md dark:shadow-[0_0_30px_rgba(0,0,0,0.5)] relative z-10 transition-colors">
                <Download className="w-10 h-10 text-emerald-500 dark:text-emerald-400" />
              </div>
              
              <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-3 relative z-10 transition-colors">Ekspor Laporan</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-8 relative z-10 leading-relaxed transition-colors">
                Unduh log data sensor komprehensif dalam format CSV terenkripsi untuk analisis laboratorium.
              </p>
              
              <button className="relative w-full overflow-hidden rounded-2xl p-[1px] group/button z-10">
                <span className="absolute inset-0 bg-gradient-to-r from-emerald-400 via-teal-300 to-sky-400 dark:from-emerald-500 dark:via-teal-400 dark:to-sky-500 opacity-70 group-hover/button:opacity-100 transition-opacity duration-300"></span>
                <div className="relative flex items-center justify-center gap-2 bg-white/90 dark:bg-slate-950/80 backdrop-blur-xl px-6 py-4 rounded-2xl transition-all duration-300 group-hover/button:bg-white/50 dark:group-hover/button:bg-slate-900/50">
                  <Download className="w-5 h-5 text-emerald-600 dark:text-emerald-400 group-hover/button:text-slate-800 dark:group-hover/button:text-white transition-colors" />
                  <span className="font-bold text-emerald-600 dark:text-emerald-400 group-hover/button:text-slate-800 dark:group-hover/button:text-white transition-colors tracking-wide">DOWNLOAD CSV</span>
                </div>
              </button>
            </GlassCard>
          </section>
          
        </div>
      </div>
    </div>
  );
}

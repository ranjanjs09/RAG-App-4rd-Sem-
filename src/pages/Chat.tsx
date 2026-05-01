import React, { useState, useEffect } from "react";
import { Search, Loader2, BookOpen, ChevronRight, Quote, Settings, Database, Activity, Plus, Terminal, FileText, Image, Upload } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { processRAGQuery, RAGResponse, Document, saveKnowledge, processImageKnowledge } from "../lib/rag";
import { db } from "../lib/firebase";
import { User } from "firebase/auth";
import { collection, query as firestoreQuery, where, onSnapshot, orderBy } from "firebase/firestore";
import { useNavigate } from "react-router-dom";

interface LogEntry {
  id: string;
  message: string;
  status: "pending" | "success" | "error";
  timestamp: Date;
}

interface ChatProps {
  user: User | null;
}

export default function Chat({ user }: ChatProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [includePublicSearch, setIncludePublicSearch] = useState(true);
  const [result, setResult] = useState<RAGResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Pipeline Stats & Config
  const [k, setK] = useState(3);
  const [model, setModel] = useState("gemini-3-flash-preview");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [dataset, setDataset] = useState<Document[]>([]);
  
  // Doc Management
  const [showDocModal, setShowDocModal] = useState(false);
  const [newDoc, setNewDoc] = useState({ title: "", content: "", isPublic: false });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [isIngesting, setIsIngesting] = useState(false);

  useEffect(() => {
    // 1. Fetch Guest/Seed knowledge from server regardless of user status
    const fetchBaseKnowledge = async () => {
      try {
        const resp = await fetch("/api/documents");
        if (resp.ok) {
          const baseDocs = await resp.json();
          setDataset(prev => {
            // Merge unique docs
            const existingIds = new Set(prev.map(d => d.id));
            const newUnique = baseDocs.filter((d: any) => !existingIds.has(d.id));
            return [...prev, ...newUnique];
          });
        }
      } catch (err) {
        console.warn("Failed to fetch baseline knowledge", err);
      }
    };

    fetchBaseKnowledge();

    if (!user) return;

    // 2. Subscribe to user-specific knowledge in Firestore
    const q = firestoreQuery(
      collection(db, "knowledge"),
      where("userId", "==", user.uid),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const userDocs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Document));
      setDataset(prev => {
        // Keep only seed docs + these user docs
        const seedIds = ["ml-01", "ml-02", "rag-01", "vec-01", "eval-01", "doc1"];
        const seeds = prev.filter(d => seedIds.includes(d.id));
        return [...seeds, ...userDocs];
      });
    }, (err) => {
      console.error("Firestore snapshot error:", err);
    });

    return () => unsubscribe();
  }, [user]);

  const addLog = (message: string, status: "pending" | "success" | "error" = "pending") => {
    const entry: LogEntry = { id: Math.random().toString(36).substr(2, 9), message, status, timestamp: new Date() };
    setLogs(prev => [entry, ...prev].slice(0, 12));
    return entry.id;
  };

  const updateLog = (id: string, status: "success" | "error") => {
    setLogs(prev => prev.map(log => log.id === id ? { ...log, status } : log));
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setLogs([]);
    
    try {
      const logRetrievalId = addLog("Vector Space Scan: Searching knowledge base...");
      const data = await processRAGQuery(query, user?.uid || null, includePublicSearch || !user, k, model);
      updateLog(logRetrievalId, "success");
      
      addLog("Contextual Grounding: Infusing retrieval results...", "success");
      addLog(`Gemini synthesis complete via server endpoint [${model}]`, "success");

      setResult(data);
    } catch (err: any) {
      console.error("SEARCH ERROR:", err);
      const msg = typeof err === 'string' ? err : err.message;
      setError(msg || "RAG Pipeline Failure");
      addLog("CRITICAL: Pipeline crash during execution", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleAddKnowledge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setIsIngesting(true);
    const logId = addLog(imageFile ? `Analyzing image via vision engine...` : `Indexing text fragment...`);
    
    try {
      if (imageFile) {
        await processImageKnowledge(imageFile, user.uid, newDoc.isPublic);
      } else {
        await saveKnowledge({
          title: newDoc.title,
          content: newDoc.content,
          type: "text",
          userId: user.uid,
          isPublic: newDoc.isPublic
        });
      }
      
      updateLog(logId, "success");
      setNewDoc({ title: "", content: "", isPublic: false });
      setImageFile(null);
      setShowDocModal(false);
    } catch (err) {
      console.error(err);
      updateLog(logId, "error");
      setError("Knowledge ingestion failed. Check your connection.");
    } finally {
      setIsIngesting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070709] text-neutral-300 font-sans selection:bg-blue-500/30 overflow-x-hidden">
      {/* Ambient background glow */}
      <div className="fixed top-0 left-1/4 w-[500px] h-[500px] bg-blue-600/10 rounded-full blur-[120px] -z-10 animate-pulse" />
      <div className="fixed bottom-0 right-1/4 w-[400px] h-[400px] bg-purple-600/10 rounded-full blur-[120px] -z-10" />

      <header className="h-20 border-b border-white/5 bg-white/[0.02] backdrop-blur-md sticky top-0 z-50">
        <div className="w-full px-6 h-full flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-700 rounded-xl flex items-center justify-center text-white shadow-[0_0_20px_rgba(59,130,246,0.3)]">
              <Activity size={22} strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-xl font-display font-bold tracking-tight text-white">FAITH<span className="text-blue-500"> RAG</span></h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`w-1.5 h-1.5 rounded-full ${user ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" : "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]"}`} />
                <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest font-medium">
                  {user ? `Session: ${user.displayName?.split(' ')[0] || "Active"}` : "Guest Interface (Read-Only)"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-6">
            {!user && (
              <div className="hidden lg:block text-[9px] font-mono text-amber-500/80 bg-amber-500/5 px-3 py-1.5 rounded border border-amber-500/10 max-w-[200px] leading-tight">
                Authentication restricted in console. Enable "Anonymous" Auth to index private knowledge.
              </div>
            )}
            <button 
              onClick={() => setShowDocModal(true)}
              disabled={!user}
              className={`flex items-center gap-2.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all border ${
                user 
                ? "bg-white/5 hover:bg-white/10 border-white/10 hover:border-white/20 text-white" 
                : "bg-white/2 opacity-30 cursor-not-allowed border-white/5 text-neutral-500"
              }`}
            >
              <Plus size={16} />
              <span>Add Knowledge</span>
            </button>
            <div className="h-8 w-px bg-white/5 hidden md:block" />
            <div className="hidden md:flex items-center gap-3 text-xs font-mono text-neutral-400">
              <Database size={14} className="text-blue-500" />
              <span className="bg-white/5 px-2.5 py-1 rounded-md border border-white/5">{dataset.length} Elements indexed</span>
            </div>
          </div>
        </div>
      </header>


      <main className="w-full px-6 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          
          {/* Sidebar: Diagnostics & Controls */}
          <aside className="lg:col-span-3 space-y-8 h-fit lg:sticky lg:top-32">
            <div className="glass-panel rounded-3xl p-7 glow-blue">
              <h3 className="text-[11px] font-display font-bold uppercase tracking-[0.2em] text-neutral-500 mb-8 flex items-center gap-3">
                <Settings size={14} className="text-blue-500" /> Engine Parameters
              </h3>
              
              <div className="space-y-10">
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <label className="text-sm font-bold text-white">Retrieved Context</label>
                    <span className="text-xs font-mono text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">K={k}</span>
                  </div>
                  <input 
                    type="range" min="1" max="5" value={k} 
                    onChange={(e) => setK(parseInt(e.target.value))}
                    className="w-full h-1.5 bg-white/5 rounded-lg appearance-none cursor-pointer accent-blue-500" 
                  />
                  <div className="flex justify-between text-[10px] text-neutral-500 font-mono mt-3 uppercase tracking-tighter">
                    <span>Precision</span>
                    <span>Broad Context</span>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-bold text-white mb-4 block">Neural Architecture</label>
                  <div className="grid grid-cols-1 gap-2">
                    {["gemini-3-flash-preview", "gemini-3.1-pro-preview"].map((m) => (
                      <button
                        key={m}
                        onClick={() => setModel(m)}
                        className={`text-left px-4 py-3 rounded-xl text-xs font-medium transition-all border ${
                          model === m 
                            ? "bg-blue-600/10 border-blue-500/50 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.1)]" 
                            : "bg-white/5 border-white/5 text-neutral-500 hover:border-white/10"
                        }`}
                      >
                        {m === "gemini-3-flash-preview" ? "Flash Optimized (Real-time)" : "Pro Reasoning (High Fidelity)"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-[#0c0c0e] border border-white/[0.03] rounded-3xl p-7 overflow-hidden">
              <h3 className="text-[11px] font-display font-bold uppercase tracking-[0.2em] text-neutral-500 mb-6 flex items-center gap-3">
                <Terminal size={14} className="text-blue-500" /> Activity Stream
              </h3>
              <div className="space-y-3 font-mono text-[11px]">
                <AnimatePresence mode="popLayout">
                  {logs.length === 0 && <div className="text-neutral-700 italic opacity-40">System idle...</div>}
                  {logs.map((log) => (
                    <motion.div 
                      key={log.id} 
                      layout
                      initial={{ opacity: 0, x: -10 }} 
                      animate={{ opacity: 1, x: 0 }}
                      className="flex items-start gap-3 group"
                    >
                      <span className={`mt-1.5 w-1 h-1 rounded-full shrink-0 ${
                        log.status === "error" ? "bg-red-500" : log.status === "success" ? "bg-green-500" : "bg-blue-500 animate-pulse"
                      }`} />
                      <span className={`leading-relaxed ${
                        log.status === "error" ? "text-red-400/80" : log.status === "success" ? "text-white/80" : "text-neutral-500"
                      }`}>
                        {log.message}
                      </span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          </aside>

          {/* Center: Command Interface & Insights */}
          <div className="lg:col-span-9 space-y-10">
            <section className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-purple-600 rounded-[2.5rem] blur opacity-25 group-focus-within:opacity-40 transition duration-500" />
              <form onSubmit={handleSearch} className="relative flex bg-[#0c0c0e] border border-white/10 rounded-[2rem] p-2 pr-4 shadow-2xl items-center focus-within:border-blue-500/50 transition-all">
                <div className="flex items-center pl-6 pr-4 text-blue-500">
                  <Search size={24} strokeWidth={2.5} />
                </div>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Initiate grounded query scan..."
                  className="flex-1 bg-transparent border-none outline-none text-xl font-display font-medium text-white placeholder-neutral-600 py-6"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="px-10 h-14 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-2xl transition-all shadow-[0_10px_20px_-10px_rgba(59,130,246,0.5)] active:scale-95 disabled:opacity-50 disabled:active:scale-100"
                >
                  {loading ? (
                    <div className="flex items-center gap-3">
                      <Loader2 className="animate-spin" size={20} />
                      <span className="hidden sm:inline">Processing...</span>
                    </div>
                  ) : "GENERATE"}
                </button>
              </form>
              <div className="flex items-center gap-4 mt-6 px-4">
                <button 
                  type="button"
                  onClick={() => setIncludePublicSearch(!includePublicSearch)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all border ${
                    includePublicSearch 
                    ? "bg-purple-600/10 border-purple-500/50 text-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.1)]" 
                    : "bg-white/5 border-white/5 text-neutral-500 hover:border-white/10"
                  }`}
                >
                  <Activity size={12} />
                  Include Shared Hub Index
                </button>
              </div>
            </section>

            <AnimatePresence mode="wait">
              {result && !loading ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="grid grid-cols-1 xl:grid-cols-12 gap-10"
                >
                  {/* Primary Report Card */}
                  <div className="xl:col-span-8 flex flex-col gap-8">
                    <div className="glass-panel rounded-[2.5rem] p-10 glow-blue overflow-hidden relative">
                      <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl -mr-32 -mt-32" />
                      
                      <div className="flex items-center justify-between mb-12 relative z-10">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-blue-500/10 rounded-lg border border-blue-500/20">
                            <Quote size={20} className="text-blue-400" />
                          </div>
                          <h2 className="text-lg font-display font-bold text-white tracking-tight">Verified Synthesis</h2>
                        </div>
                        <div className="flex items-center gap-6">
                           <div className="flex flex-col items-end">
                             <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest">Similarity F1</span>
                             <span className="text-sm font-mono font-bold text-white">{result.evaluation.f1.toFixed(3)}</span>
                           </div>
                        </div>
                      </div>

                      <div className="prose prose-invert max-w-none relative z-10">
                        <p className="text-xl leading-relaxed text-neutral-200 font-sans tracking-tight whitespace-pre-wrap">
                          {result.answer.split(/(\[doc\d+\])/g).map((part, i) => {
                            const isCitation = part.match(/\[(doc\d+)\]/);
                            if (isCitation) {
                              const docId = isCitation[1];
                              return (
                                <span
                                  key={i}
                                  className="inline-flex items-center justify-center min-w-[2.5rem] h-6 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-md mx-1.5 text-[10px] font-mono font-bold cursor-help hover:bg-blue-500/20 transition-colors shadow-sm"
                                  title={`Source Reference: ${docId}`}
                                >
                                  {part.toUpperCase()}
                                </span>
                              );
                            }
                            return <span key={i}>{part}</span>;
                          })}
                        </p>
                      </div>

                      {/* Faithfulness Score Gauge */}
                      <div className="mt-16 flex flex-col md:flex-row items-center gap-10 p-8 bg-white/[0.02] rounded-3xl border border-white/[0.05]">
                        <div className="relative w-28 h-28 shrink-0">
                          <svg className="w-full h-full transform -rotate-90">
                            <circle cx="56" cy="56" r="48" stroke="currentColor" strokeWidth="10" fill="transparent" className="text-white/[0.03]" />
                            <circle 
                              cx="56" cy="56" r="48" 
                              stroke="currentColor" 
                              strokeWidth="10" 
                              fill="transparent" 
                              className="text-blue-500 filter drop-shadow-[0_0_8px_rgba(59,130,246,0.4)]" 
                              strokeDasharray="301.6" 
                              strokeDashoffset={301.6 * (1 - result.faithfulnessScore)} 
                              strokeLinecap="round"
                            />
                          </svg>
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-2xl font-mono font-bold text-white">{Math.round(result.faithfulnessScore * 100)}%</span>
                            <span className="text-[8px] font-mono font-bold text-neutral-500 uppercase tracking-widest">Score</span>
                          </div>
                        </div>
                        <div className="text-center md:text-left">
                          <h4 className="text-lg font-display font-bold text-white mb-2">Automated Evidence Calibration</h4>
                          <p className="text-sm text-neutral-400 leading-relaxed max-w-md">
                            Cross-referencing engine has verified this response against indexed facts. 
                            {result.faithfulnessScore > 0.85 
                              ? " Verification signal is exceptionally strong." 
                              : " Moderate grounding detected. Verify citations manually."}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Knowledge Base Inspection */}
                  <div className="xl:col-span-4 space-y-6">
                    <div className="flex items-center justify-between px-2">
                       <h4 className="text-[11px] font-display font-bold uppercase tracking-[0.2em] text-neutral-500 flex items-center gap-3">
                         <BookOpen size={14} className="text-blue-500" /> Evidence Matrix
                       </h4>
                       <span className="text-[10px] font-mono text-neutral-600 uppercase tracking-widest bg-white/5 py-1 px-2 rounded-md">Retrieved {result.documents.length}</span>
                    </div>
                    
                    <div className="grid grid-cols-1 gap-4">
                      {result.documents.map((doc, idx) => (
                        <motion.div
                          key={doc.id}
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.15 }}
                          className="bg-white/[0.02] border border-white/5 rounded-3xl p-6 hover:border-blue-500/30 hover:bg-blue-500/[0.02] transition-all group relative overflow-hidden"
                        >
                          <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                            <ChevronRight size={16} className="text-blue-500" />
                          </div>
                          <div className="flex items-center justify-between mb-4">
                             <div className="flex items-center gap-2">
                               <span className="text-[10px] font-mono font-bold py-1 px-3 bg-blue-500/10 text-blue-400 rounded-lg border border-blue-500/20 uppercase tracking-widest">{doc.id}</span>
                               {doc.isPublic && (
                                 <span className="text-[9px] font-mono text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20">SHARED</span>
                               )}
                             </div>
                             <div className="flex items-center gap-1.5">
                               <Activity size={10} className="text-neutral-500" />
                               <span className="text-[10px] font-mono text-neutral-500">{doc.score.toFixed(3)}</span>
                             </div>
                          </div>
                          <h5 className="font-display font-bold text-white mb-3 leading-snug group-hover:text-blue-400 transition-colors">{doc.title}</h5>
                          <div className="p-4 bg-[#070709] rounded-2xl border border-white/[0.03]">
                            <p className="text-xs text-neutral-400 leading-relaxed italic line-clamp-4">"{doc.content}"</p>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              ) : !loading && (
                <motion.div 
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="py-32 text-center rounded-[3rem] bg-white/[0.01] border-[1.5px] border-dashed border-white/10"
                >
                   <div className="w-24 h-24 bg-gradient-to-br from-blue-500/5 to-purple-500/5 shadow-inner border border-white/5 rounded-[2rem] flex items-center justify-center mx-auto mb-10">
                     <Terminal size={40} className="text-neutral-600" />
                   </div>
                   <h2 className="text-3xl font-display font-bold text-white mb-4 tracking-tight">Awaiting Neural Stimulus</h2>
                   <p className="text-neutral-500 max-w-md mx-auto text-lg font-medium leading-relaxed">
                     Input a query to trigger vector search and high-fidelity generation grounded in your local knowledge base.
                   </p>
                   <div className="mt-12 flex justify-center gap-3">
                      {["How is faithfulness calculated?", "What is dense retrieval?", "Explain top-k"].map((t) => (
                        <button 
                          key={t}
                          onClick={() => setQuery(t)}
                          className="px-5 py-2.5 rounded-full bg-white/5 border border-white/5 text-xs font-semibold text-neutral-400 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all"
                        >
                          {t}
                        </button>
                      ))}
                   </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* Add Document Modal - Dark Themed */}
      <AnimatePresence>
        {showDocModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-[#070709]/90 backdrop-blur-md"
              onClick={() => setShowDocModal(false)}
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }} 
              animate={{ scale: 1, opacity: 1, y: 0 }} 
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-xl bg-[#0c0c0e] rounded-[2.5rem] p-10 shadow-koma border border-white/10"
            >
              <div className="flex items-center justify-between mb-10">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-blue-500/10 rounded-2xl border border-blue-500/20">
                    <Database className="text-blue-400" size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-display font-bold text-white">Knowledge Ingestion</h3>
                    <p className="text-xs text-neutral-500 uppercase tracking-widest mt-1">Populating Vector Storage</p>
                  </div>
                </div>
                <button onClick={() => setShowDocModal(false)} className="p-2 hover:bg-white/5 rounded-full text-neutral-500 transition-colors">
                  <Plus className="rotate-45" size={24} />
                </button>
              </div>

              <form onSubmit={handleAddKnowledge} className="space-y-8">
                <div className="flex gap-4 p-1 bg-white/[0.03] rounded-2xl border border-white/5">
                   <button
                     type="button"
                     onClick={() => setImageFile(null)}
                     className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold transition-all ${
                       !imageFile ? "bg-blue-600 text-white shadow-lg" : "text-neutral-500 hover:text-white"
                     }`}
                   >
                     <FileText size={14} /> TEXT
                   </button>
                   <button
                     type="button"
                     className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold transition-all border border-transparent ${
                       imageFile ? "bg-blue-600 text-white shadow-lg" : "text-neutral-500 hover:text-white"
                     }`}
                     onClick={() => document.getElementById('image-upload')?.click()}
                   >
                     <Image size={14} /> VISUAL
                   </button>
                   <input 
                    id="image-upload" type="file" accept="image/*" className="hidden" 
                    onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                   />
                </div>

                {!imageFile ? (
                  <>
                    <div>
                      <label className="text-xs font-bold uppercase tracking-widest text-neutral-500 mb-3 block">Document Identifier</label>
                      <input 
                        type="text" required value={newDoc.title}
                        onChange={e => setNewDoc(prev => ({ ...prev, title: e.target.value }))}
                        className="w-full bg-white/[0.03] border border-white/5 rounded-2xl px-5 py-4 outline-none focus:border-blue-500/50 transition-all font-medium text-white"
                        placeholder="e.g. Fundamental Laws of Retrieval"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold uppercase tracking-widest text-neutral-500 mb-3 block">Dense Knowledge Content</label>
                      <textarea 
                        required value={newDoc.content} rows={6}
                        onChange={e => setNewDoc(prev => ({ ...prev, content: e.target.value }))}
                        className="w-full bg-white/[0.03] border border-white/5 rounded-2xl px-5 py-4 outline-none focus:border-blue-500/50 transition-all font-medium resize-none text-white text-sm"
                        placeholder="Paste the factual source content here for indexing..."
                      />
                    </div>
                  </>
                ) : (
                  <div className="py-10 text-center border-2 border-dashed border-white/10 rounded-3xl bg-white/[0.01]">
                    <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-blue-500/20">
                      <Upload className="text-blue-400" size={24} />
                    </div>
                    <p className="text-sm font-bold text-white mb-1">{imageFile.name}</p>
                    <p className="text-xs text-neutral-500 uppercase">{(imageFile.size / 1024).toFixed(1)} KB Ready for Vision Extraction</p>
                    <button 
                      type="button" onClick={() => setImageFile(null)}
                      className="mt-6 text-xs font-bold text-red-500 hover:text-red-400 transition-colors"
                    >
                      Remove and switch to text
                    </button>
                  </div>
                )}

                <div className="flex items-center justify-between p-4 bg-white/[0.03] rounded-2xl border border-white/5">
                  <div>
                    <h4 className="text-sm font-bold text-white">Public Sharing</h4>
                    <p className="text-[10px] text-neutral-500 uppercase tracking-widest mt-0.5">Enable community retrieval</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setNewDoc(prev => ({ ...prev, isPublic: !prev.isPublic }))}
                    className={`w-12 h-6 rounded-full p-1 transition-all ${newDoc.isPublic ? "bg-blue-600" : "bg-white/10"}`}
                  >
                    <div className={`w-4 h-4 bg-white rounded-full transition-all ${newDoc.isPublic ? "ml-6" : "ml-0"}`} />
                  </button>
                </div>
                
                <button 
                  type="submit"
                  disabled={isIngesting || (!imageFile && (!newDoc.title || !newDoc.content))}
                  className="w-full py-5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-2xl shadow-[0_15px_30px_-10px_rgba(59,130,246,0.3)] transition-all active:scale-[0.98] flex items-center justify-center gap-3 disabled:opacity-50"
                >
                  {isIngesting ? <Loader2 className="animate-spin" size={18} /> : <Search size={18} />}
                  {isIngesting ? "PROCESSING NEURAL MEMORY..." : "INDEX NEURAL MEMORY"}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <footer className="mt-40 border-t border-white/[0.05] py-16 bg-white/[0.01]">
        <div className="w-full px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="flex items-center gap-3 opacity-40 grayscale transition-all hover:grayscale-0 hover:opacity-100">
               <Activity size={24} className="text-blue-500" />
               <span className="font-display font-medium text-white tracking-widest text-sm uppercase">Faith RAG Protocol 2.0</span>
            </div>
            <div className="flex gap-12">
               {["Pipeline Logic", "Security Layers", "API Interface", "Lab Docs"].map((l) => (
                 <span key={l} className="text-xs font-mono font-medium text-neutral-600 hover:text-blue-400 cursor-pointer transition-colors uppercase tracking-[0.1em]">{l}</span>
               ))}
            </div>
            <div className="text-xs font-mono text-neutral-700">
               SYSTEM TIME: {new Date().toISOString().split('T')[0]}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

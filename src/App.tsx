import React, { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth, loginWithGoogle } from "./lib/firebase";
import { Loader2, LogIn, Activity } from "lucide-react";
import Chat from "./pages/Chat";
import { fetchPublicKnowledge, Document } from "./lib/rag";

function LoginView({ publicDocs }: { publicDocs: Document[] }) {
  return (
    <div className="min-h-screen bg-[#070709] flex flex-col items-center justify-center p-6 font-sans">
      <div className="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center text-white mb-8 shadow-[0_0_40px_rgba(59,130,246,0.3)]">
        <Activity size={40} />
      </div>
      <h1 className="text-4xl font-display font-bold text-white mb-4">FAITH<span className="text-blue-500"> RAG</span></h1>
      <p className="text-neutral-500 text-center max-w-md mb-12 leading-relaxed font-medium">
        Secure, grounded, and multimodal Retrieval Augmented Generation research platform.
      </p>
      
      <button 
        onClick={() => loginWithGoogle()}
        className="flex items-center gap-4 bg-white text-black px-8 py-4 rounded-2xl font-bold hover:bg-neutral-200 transition-all shadow-xl active:scale-95 mb-16"
      >
        <LogIn size={20} />
        <span>Continue with Google</span>
      </button>

      {publicDocs.length > 0 && (
        <div className="w-full max-w-4xl">
          <h2 className="text-[10px] font-mono font-bold text-neutral-600 uppercase tracking-[0.3em] mb-8 text-center">Community Research Feed</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {publicDocs.map(doc => (
              <div key={doc.id} className="glass-panel p-6 rounded-2xl border border-white/5 bg-white/[0.01]">
                 <span className="text-[9px] font-mono text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20 mb-3 inline-block">SHARED</span>
                 <h3 className="text-sm font-bold text-white mb-2 line-clamp-1">{doc.title}</h3>
                 <p className="text-xs text-neutral-500 line-clamp-3 leading-relaxed">{doc.content}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [publicDocs, setPublicDocs] = useState<Document[]>([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const loadPublicDocs = async () => {
      try {
        const docs = await fetchPublicKnowledge(5);
        setPublicDocs(docs);
      } catch (err) {
        console.error("Public docs load failed", err);
      }
    };
    loadPublicDocs();
  }, []);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#070709] flex items-center justify-center">
        <Loader2 className="text-blue-500 animate-spin" size={40} />
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        <Route 
          path="/" 
          element={user ? <Chat user={user} /> : <LoginView publicDocs={publicDocs} />} 
        />
        <Route 
          path="/chat" 
          element={user ? <Chat user={user} /> : <Navigate to="/" replace />} 
        />
        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

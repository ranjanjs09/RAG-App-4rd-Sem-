import React from "react";
import { LogIn, Activity } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { loginWithGoogle } from "../lib/firebase";
import { Document } from "../lib/rag";

interface HomeProps {
  publicDocs: Document[];
}

export default function Home({ publicDocs }: HomeProps) {
  const navigate = useNavigate();

  const handleAccess = async () => {
    try {
      await loginWithGoogle();
      navigate("/chat");
    } catch (err) {
      console.error("Login failed", err);
    }
  };

  return (
    <div className="min-h-screen bg-[#070709] flex flex-col items-center justify-center p-6 font-sans">
      <div className="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center text-white mb-8 shadow-[0_0_40px_rgba(59,130,246,0.3)]">
        <Activity size={40} />
      </div>
      <h1 className="text-4xl font-display font-bold text-white mb-4">VERI<span className="text-blue-500">FAITH</span></h1>
      <p className="text-neutral-500 text-center max-w-md mb-10 leading-relaxed font-medium">
        Secure, grounded, and multimodal Retrieval Augmented Generation research platform.
      </p>
      <button 
        onClick={handleAccess}
        className="flex items-center gap-4 bg-white text-black px-8 py-4 rounded-2xl font-bold hover:bg-neutral-200 transition-all shadow-xl active:scale-95 mb-16"
      >
        <LogIn size={20} />
        <span>Access Command Interface</span>
      </button>

      {publicDocs.length > 0 && (
        <div className="w-full max-w-4xl">
          <h2 className="text-[10px] font-mono font-bold text-neutral-600 uppercase tracking-[0.3em] mb-8 text-center">Recent Shared Research</h2>
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

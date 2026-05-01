import React, { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth, loginAnonymously } from "./lib/firebase";
import { Loader2 } from "lucide-react";
import Chat from "./pages/Chat";
import { fetchPublicKnowledge, Document } from "./lib/rag";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [publicDocs, setPublicDocs] = useState<Document[]>([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        try {
          await loginAnonymously();
        } catch (err) {
          console.error("Anonymous authentication failed", err);
          setAuthLoading(false);
        }
      } else {
        setUser(u);
        setAuthLoading(false);
      }
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
          element={user ? <Chat user={user} /> : <div className="min-h-screen bg-[#070709]" />} 
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

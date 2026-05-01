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
          // If anonymous auth is disabled in the console, this will throw auth/admin-restricted-operation
          await loginAnonymously();
        } catch (err: any) {
          if (err?.code !== 'auth/admin-restricted-operation') {
            console.error("Authentication check failed", err);
          }
          // We set loading to false even on error to allow "Guest Mode"
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
          element={<Chat user={user} />} 
        />
        <Route 
          path="/chat" 
          element={<Chat user={user} />} 
        />
        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

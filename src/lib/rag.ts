import { GoogleGenAI } from "@google/genai";
import { db, auth } from "./firebase";
import { collection, query as firestoreQuery, where, getDocs, addDoc, serverTimestamp, orderBy, limit } from "firebase/firestore";

// Initialize Gemini lazily
let genAI: GoogleGenAI | null = null;
function getAI() {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not defined. Please check your environment settings.");
    }
    genAI = new GoogleGenAI({ apiKey });
  }
  return genAI;
}

enum OperationType {
  // ... (keep lines 4-11)
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid || null,
      email: auth?.currentUser?.email || null,
      emailVerified: auth?.currentUser?.emailVerified || null,
      isAnonymous: auth?.currentUser?.isAnonymous || null,
      tenantId: auth?.currentUser?.tenantId || null,
      providerInfo: auth?.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error Detailed: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export interface Document {
  id: string;
  title: string;
  content: string;
  embedding?: number[];
  userId?: string;
  isPublic?: boolean;
  type?: "text" | "image";
  score?: number;
}

export interface RAGResponse {
  answer: string;
  documents: { id: string; title: string; content: string; score: number }[];
  faithfulnessScore: number;
  citations: { text: string; docId: string }[];
  evaluation: {
    exactMatch: boolean;
    f1: number;
  };
}

// Helper: Vector Similarity
function cosineSimilarity(vec1: number[], vec2: number[]) {
  if (!vec1 || !vec2) return 0;
  const dotProduct = vec1.reduce((sum, val, i) => sum + val * (vec2[i] || 0), 0);
  const mag1 = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
  const mag2 = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));
  if (mag1 === 0 || mag2 === 0) return 0;
  return dotProduct / (mag1 * mag2);
}

// Helper: Calculate F1 Score
function calculateF1(prediction: string, context: string) {
  const normalize = (text: string) => text.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean);
  const predTokens = normalize(prediction);
  const contextTokens = normalize(context);
  
  if (predTokens.length === 0 || contextTokens.length === 0) return 0;
  
  const common = predTokens.filter(t => contextTokens.includes(t));
  if (common.length === 0) return 0;
  
  const precision = common.length / predTokens.length;
  const recall = common.length / contextTokens.length;
  
  return (2 * precision * recall) / (precision + recall);
}

// Helper: Get Embedding
export async function getEmbedding(text: string) {
  const ai = getAI();
  try {
    const resp = await ai.models.embedContent({
      model: "gemini-embedding-2-preview",
      contents: [{ parts: [{ text }] }]
    });
    return resp.embeddings[0].values;
  } catch (err: any) {
    console.error("[RAG] Embedding Error:", err);
    throw new Error(`Failed to generate vector embedding: ${err.message}`);
  }
}

// Database Helpers
export async function saveKnowledge(data: { title: string; content: string; type: "text" | "image"; userId?: string | null; isPublic?: boolean; metadata?: any }) {
  try {
    const finalUserId = data.userId || "guest_session_" + Math.random().toString(36).substr(2, 5);
    const embedding = await getEmbedding(data.content);
    const docRef = await addDoc(collection(db, "knowledge"), {
      ...data,
      userId: finalUserId,
      isPublic: data.isPublic ?? true, // Default to public for guests
      embedding,
      createdAt: serverTimestamp()
    });
    console.log(`[Indexing] Stored in Vector DB with ID: ${docRef.id}`);
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, "knowledge");
    throw error;
  }
}

// Image handling moved to placeholder since vision usually requires multi-part server support
export async function processImageKnowledge(file: File, userId: string | null, isPublic: boolean = false) {
  throw new Error("Image processing currently unavailable. Please use text indexing.");
}

export async function fetchPublicKnowledge(limitCount: number = 10) {
  try {
    const q = firestoreQuery(
      collection(db, "knowledge"),
      where("isPublic", "==", true),
      orderBy("createdAt", "desc"),
      limit(limitCount)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Document));
  } catch (error) {
    console.warn("Public knowledge fetch with order failed, falling back to unordered.", error);
    try {
      const qSimple = firestoreQuery(
        collection(db, "knowledge"),
        where("isPublic", "==", true),
        limit(limitCount)
      );
      const snapshot = await getDocs(qSimple);
      return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Document));
    } catch (innerError) {
      handleFirestoreError(innerError, OperationType.LIST, "knowledge");
      return [];
    }
  }
}

export async function processRAGQuery(
  queryText: string, 
  userId: string | null,
  includePublic: boolean = false,
  k: number = 3, 
  modelName: string = "gemini-3-flash-preview"
): Promise<RAGResponse> {
  const ai = getAI();

  // 1. Fetch relevant docs from Firestore
  let docs: Document[] = [];
  
  // User docs
  if (userId) {
    try {
      const qUser = firestoreQuery(collection(db, "knowledge"), where("userId", "==", userId), orderBy("createdAt", "desc"), limit(100));
      const snapUser = await getDocs(qUser);
      docs = snapUser.docs.map(d => ({ id: d.id, ...d.data() } as Document));
    } catch (e) {
      console.warn("User docs fetch failed", e);
    }
  }

  // Public docs
  if (includePublic || !userId) {
    try {
      const qPublic = firestoreQuery(collection(db, "knowledge"), where("isPublic", "==", true), orderBy("createdAt", "desc"), limit(100));
      const snapPublic = await getDocs(qPublic);
      const publicDocs = snapPublic.docs
        .map(d => ({ id: d.id, ...d.data() } as Document))
        .filter(pd => pd.userId !== userId);
      docs = [...docs, ...publicDocs];
    } catch (e) {
      console.warn("Public docs fetch failed", e);
    }
  }

  // 1b. Vector search
  const queryEmbedding = await getEmbedding(queryText);

  const scoredDocs = docs
    .map(doc => ({
      ...doc,
      score: doc.embedding ? cosineSimilarity(queryEmbedding, doc.embedding) : 0
    }))
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, Math.min(k, docs.length));

  const contextText = scoredDocs.length > 0 
    ? scoredDocs.map(d => `[Source: ${d.id}] ${d.content}`).join("\n\n")
    : "No relevant documents found in the current knowledge base.";

  // 2. Generation
  const promptText = `Relevant Context:\n${contextText}\n\nUser Question: ${queryText}\n\nTask: Answer accurately using the context. Cite sources like [docId]. If the context is empty or unhelpful, answer with general knowledge but be honest about the lack of specific context.`;

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: [{ parts: [{ text: promptText }] }],
      config: {
        systemInstruction: "You are the FAITH RAG Assistant. Provide factual, grounded answers based on provided context."
      }
    });

    const answer = response.text || "I was unable to generate an answer.";

    // 3. Faithfulness Verification (Dual-stage)
    const verificationInstruction = `Analyze the faithfulness of the answer based on the context. Return JSON: { "score": 0.95, "alignment": [{ "text": "...", "docId": "..." }] }`;
    const verifyResp = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ parts: [{ text: `Context:\n${contextText}\n\nAnswer: ${answer}` }] }],
      config: {
        systemInstruction: verificationInstruction,
        responseMimeType: "application/json"
      }
    });

    let verificationData;
    try {
      verificationData = JSON.parse(verifyResp.text || "{}");
    } catch (e) {
      verificationData = { score: 0.5, alignment: [] };
    }

    // 4. Real Evaluation
    const f1 = calculateF1(answer, contextText);
    const exactMatch = answer.toLowerCase().trim() === contextText.toLowerCase().trim();

    return {
      answer,
      documents: scoredDocs.map(({ id, title, content, score }) => ({ id, title, content, score: score || 0 })),
      faithfulnessScore: verificationData.score || 0,
      citations: verificationData.alignment || [],
      evaluation: {
        exactMatch,
        f1
      }
    };
  } catch (err: any) {
    console.error("[RAG Client] Generation Error:", err);
    throw err;
  }
}

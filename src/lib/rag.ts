import { GoogleGenAI } from "@google/genai";
import { db, auth } from "./firebase";
import { collection, query as firestoreQuery, where, getDocs, addDoc, serverTimestamp, orderBy, limit } from "firebase/firestore";

// Initialize Gemini lazily
let genAI: GoogleGenAI | null = null;
function getAI() {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not defined in the environment.");
    }
    genAI = new GoogleGenAI({ apiKey });
  }
  return genAI;
}

enum OperationType {
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
  const resp = await ai.models.embedContent({
    model: "gemini-embedding-2-preview",
    contents: [{ parts: [{ text }] }]
  });
  return resp.embeddings[0].values;
}

// Database Helpers
export async function saveKnowledge(data: { title: string; content: string; type: "text" | "image"; userId: string; isPublic?: boolean; metadata?: any }) {
  try {
    const embedding = await getEmbedding(data.content);
    const docRef = await addDoc(collection(db, "knowledge"), {
      ...data,
      isPublic: data.isPublic || false,
      embedding,
      createdAt: serverTimestamp()
    });
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, "knowledge");
    throw error;
  }
}

// Helper: Process direct AI requests if needed (Vision / Extraction)
export async function processImageKnowledge(file: File, userId: string, isPublic: boolean = false) {
  const ai = getAI();
  
  const base64 = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(file);
  });

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          {
            inlineData: {
              data: base64,
              mimeType: file.type
            }
          },
          {
            text: "Extract all factual information from this image. Summarize it into a rich text passage that can be used for RAG retrieval. Focus on data, dates, names, and key insights."
          }
        ]
      }
    ]
  });

  const content = response.text || "No content extracted.";
  return await saveKnowledge({
    title: `Image Extraction: ${file.name}`,
    content,
    type: "image",
    userId,
    isPublic,
    metadata: { fileName: file.name, fileSize: file.size }
  });
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
      handleFirestoreError(e, OperationType.LIST, "knowledge/user");
    }
  }

  // Public docs (if requested or if no user is present)
  if (includePublic || !userId) {
    try {
      const qPublic = firestoreQuery(collection(db, "knowledge"), where("isPublic", "==", true), orderBy("createdAt", "desc"), limit(100));
      const snapPublic = await getDocs(qPublic);
      const publicDocs = snapPublic.docs
        .map(d => ({ id: d.id, ...d.data() } as Document))
        .filter(pd => pd.userId !== userId); // Avoid duplicates
      docs = [...docs, ...publicDocs];
    } catch (e) {
      console.warn("Public docs retrieval failed, skipping...", e);
    }
  }

  // 1b. Vector search (Client-side)
  const queryEmbedding = await getEmbedding(queryText);

  const scoredDocs = docs
    .map(doc => ({
      ...doc,
      score: doc.embedding ? cosineSimilarity(queryEmbedding, doc.embedding) : 0
    }))
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, Math.min(k, docs.length));

  const contextText = scoredDocs.map(d => `[Source: ${d.id}] ${d.content}`).join("\n\n");

  // 2. Generation
  const promptText = `Provided Context:\n${contextText}\n\nUser Query: ${queryText}`;
  const systemInstruction = `You are an intelligent AI assistant for the FAITH RAG system. Follow these rules strictly:
1. Try to answer the user's question using the provided context first. 
2. Use clear citations like [docId] for claims supported by context.
3. If search is needed, use your internal reasoning to provide the most accurate answer.
4. Keep it concise and helpful.`;

  const response = await ai.models.generateContent({
    model: modelName,
    contents: [{ parts: [{ text: promptText }] }],
    config: {
      systemInstruction
    }
  });

  const answer = response.text || "No response generated.";

  // 3. Faithfulness Verification
  const verificationPrompt = `Context:\n${contextText}\n\nAnswer: ${answer}`;
  const verificationInstruction = `Analyze the faithfulness of the answer based on the provided context. Return ONLY JSON: { "score": 0.95, "alignment": [{ "text": "...", "docId": "..." }] }`;

  const verificationResponse = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{ parts: [{ text: verificationPrompt }] }],
    config: {
      systemInstruction: verificationInstruction,
      responseMimeType: "application/json"
    }
  });

  const verificationText = verificationResponse.text || "{}";

  let verificationData;
  try {
    const jsonMatch = verificationText.match(/\{[\s\S]*\}/);
    verificationData = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(verificationText);
  } catch (e) {
    verificationData = { score: 0, alignment: [] };
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
}

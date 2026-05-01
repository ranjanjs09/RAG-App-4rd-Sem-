import { GoogleGenAI } from "@google/genai";
import { db } from "./firebase";
import { collection, query as firestoreQuery, where, getDocs, addDoc, serverTimestamp, orderBy, limit } from "firebase/firestore";

// Initialize Gemini lazily to ensure API key is available
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
  const embedding = await getEmbedding(data.content);
  const docRef = await addDoc(collection(db, "knowledge"), {
    ...data,
    isPublic: data.isPublic || false,
    embedding,
    createdAt: serverTimestamp()
  });
  return docRef.id;
}

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
  const q = firestoreQuery(
    collection(db, "knowledge"),
    where("isPublic", "==", true),
    orderBy("createdAt", "desc"),
    limit(limitCount)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Document));
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
    const qUser = firestoreQuery(collection(db, "knowledge"), where("userId", "==", userId), orderBy("createdAt", "desc"), limit(100));
    const snapUser = await getDocs(qUser);
    docs = snapUser.docs.map(d => ({ id: d.id, ...d.data() } as Document));
  }

  // Public docs (if requested or if no user is present)
  if (includePublic || !userId) {
    const qPublic = firestoreQuery(collection(db, "knowledge"), where("isPublic", "==", true), orderBy("createdAt", "desc"), limit(100));
    const snapPublic = await getDocs(qPublic);
    const publicDocs = snapPublic.docs
      .map(d => ({ id: d.id, ...d.data() } as Document))
      .filter(pd => pd.userId !== userId); // Avoid duplicates
    docs = [...docs, ...publicDocs];
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
  const generationResponse = await ai.models.generateContent({
    model: modelName,
    contents: `Provided Context:\n${contextText}\n\nUser Query: ${queryText}`,
    config: {
      tools: [{ googleSearch: {} }],
      systemInstruction: `You are an intelligent AI assistant. Follow these rules strictly:
1. Try to answer the user's question using the provided context first. 
2. If the answer is not found in the context OR your confidence is low: Automatically use the Google Search tool to find relevant, up-to-date information from the internet.
3. Extract the most accurate and reliable information.
4. Summarize the information in a clear and easy-to-understand way.
5. Do NOT mention that you searched Google unless explicitly asked.
6. Ensure the answer is factual and not misleading.
7. If multiple sources are available (context + search), combine them to present the best answer.
8. If no reliable information is found after both context check and search, clearly say: "I couldn't find reliable information on this topic."

Output format:
- Clear explanation
- Use bullet points if needed
- Keep it concise but informative
- For claims supported by the provided context, include citations in the format [docId].`,
    }
  });

  const answer = generationResponse.text || "No response generated.";

  // 3. Faithfulness Verification
  const verificationResponse = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: `Context:\n${contextText}\n\nAnswer: ${answer}`,
    config: {
      systemInstruction: `Analyze the faithfulness of the answer based on the provided context.
      An answer is faithful if every claim made in it is directly supported by the context.
      Calculate a faithfulness score from 0.0 to 1.0. 0.0 means completely hallucinated, 1.0 means perfectly grounded.
      Identify specific spans in the answer and link them to document IDs.
      Return ONLY JSON: { "score": 0.95, "alignment": [{ "text": "...", "docId": "..." }] }`,
      responseMimeType: "application/json"
    }
  });

  let verificationData;
  try {
    const text = verificationResponse.text;
    verificationData = text ? JSON.parse(text) : { score: 0, alignment: [] };
  } catch (e) {
    verificationData = { score: 0, alignment: [] };
  }

  // 4. Real Evaluation
  const f1 = calculateF1(answer, contextText);
  const exactMatch = answer.toLowerCase().trim() === contextText.toLowerCase().trim();

  return {
    answer,
    documents: scoredDocs.map(({ id, title, content, score }) => ({ id, title, content, score: score || 0 })),
    faithfulnessScore: verificationData.score,
    citations: verificationData.alignment || [],
    evaluation: {
      exactMatch,
      f1
    }
  };
}

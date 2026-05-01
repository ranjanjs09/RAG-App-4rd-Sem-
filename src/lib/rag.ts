import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "./firebase";
import { collection, query as firestoreQuery, where, getDocs, addDoc, serverTimestamp, orderBy, limit } from "firebase/firestore";

// Initialize Gemini lazily to ensure API key is available
let genAI: GoogleGenerativeAI | null = null;

function getAI() {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not defined in the environment.");
    }
    genAI = new GoogleGenerativeAI(apiKey);
  }
  return genAI;
}

export interface Document {
  id: string;
  title: string;
  content: string;
  embedding?: number[];
  userId?: string;
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
  const model = ai.getGenerativeModel({ model: "text-embedding-004" });
  const resp = await model.embedContent(text);
  return resp.embedding.values;
}

// Database Helpers
export async function saveKnowledge(data: { title: string; content: string; type: "text" | "image"; userId: string; metadata?: any }) {
  const embedding = await getEmbedding(data.content);
  const docRef = await addDoc(collection(db, "knowledge"), {
    ...data,
    embedding,
    createdAt: serverTimestamp()
  });
  return docRef.id;
}

export async function processImageKnowledge(file: File, userId: string) {
  const ai = getAI();
  const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
  
  const base64 = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(file);
  });

  const result = await model.generateContent([
    {
      inlineData: {
        data: base64,
        mimeType: file.type
      }
    },
    "Extract all factual information from this image. Summarize it into a rich text passage that can be used for RAG retrieval. Focus on data, dates, names, and key insights."
  ]);

  const content = result.response.text();
  return await saveKnowledge({
    title: `Image Extraction: ${file.name}`,
    content,
    type: "image",
    userId,
    metadata: { fileName: file.name, fileSize: file.size }
  });
}

export async function processRAGQuery(
  queryText: string, 
  userId: string,
  k: number = 3, 
  modelName: string = "gemini-1.5-flash"
): Promise<RAGResponse> {
  const ai = getAI();

  // 1. Fetch relevant docs from Firestore
  const q = firestoreQuery(collection(db, "knowledge"), where("userId", "==", userId), orderBy("createdAt", "desc"), limit(100));
  const snapshot = await getDocs(q);
  const dataset: Document[] = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Document));

  // 1b. Vector search (Client-side)
  const queryEmbedding = await getEmbedding(queryText);

  const scoredDocs = dataset
    .map(doc => ({
      ...doc,
      score: doc.embedding ? cosineSimilarity(queryEmbedding, doc.embedding) : 0
    }))
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, Math.min(k, dataset.length));

  const contextText = scoredDocs.map(d => `[Source: ${d.id}] ${d.content}`).join("\n\n");

  // 2. Generation
  const genModel = ai.getGenerativeModel({ 
    model: modelName,
    systemInstruction: `You are a faithful assistant. Answer the user query strictly using the provided context. 
      If the answer is not in the context, say you don't know and do not use your external knowledge.
      Provide citations in the format [docId] after each claim. Keep the answer concise.`,
  });

  const generationResponse = await genModel.generateContent(`Context:\n${contextText}\n\nQuery: ${queryText}`);
  const answer = generationResponse.response.text();

  // 3. Faithfulness Verification
  const verifyModel = ai.getGenerativeModel({ 
    model: "gemini-1.5-pro",
    systemInstruction: `Analyze the faithfulness of the answer based on the provided context.
      An answer is faithful if every claim made in it is directly supported by the context.
      Calculate a faithfulness score from 0.0 to 1.0. 0.0 means completely hallucinated, 1.0 means perfectly grounded.
      Identify specific spans in the answer and link them to document IDs.
      Return ONLY JSON: { "score": 0.95, "alignment": [{ "text": "...", "docId": "..." }] }`,
    generationConfig: { responseMimeType: "application/json" }
  });

  const verificationResponse = await verifyModel.generateContent(`Context:\n${contextText}\n\nAnswer: ${answer}`);

  let verificationData;
  try {
    const text = verificationResponse.response.text();
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

import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Types
interface Document {
  id: string;
  title: string;
  content: string;
}

// Sample Dataset
const dataset: Document[] = [
  {
    id: "doc1",
    title: "Introduction to RAG",
    content: "Retrieval-Augmented Generation (RAG) is a technique that enhances large language models by retrieving relevant information from a knowledge base before generating a response. It helps reduce hallucinations and provides up-to-date information."
  },
  {
    id: "doc2",
    title: "Dense Retrieval",
    content: "Dense retrieval uses vector embeddings to find relevant documents. Instead of matching keywords, it compares the semantic meaning of queries and documents in a high-dimensional vector space, often using cosine similarity."
  },
  {
    id: "doc3",
    title: "The Role of LLMs in RAG",
    content: "In a RAG system, the LLM acts as the generator. It takes the original query and the retrieved documents as context to produce a coherent and grounded answer. Models like GPT-4 or Gemini are commonly used."
  },
  {
    id: "doc4",
    title: "Faithfulness in Generation",
    content: "Faithfulness refers to how well a generated answer aligns with the provided source documents. A faithful model avoids making claims that are not supported by the retrieved evidence."
  },
  {
    id: "doc5",
    title: "Evaluation Metrics for RAG",
    content: "Common metrics for evaluating RAG systems include RAGAS (Retrieval, Answer Relevance, and Faithfulness), BLEU, and ROUGE. Faithfulness specifically measures if the answer can be derived solely from the context."
  },
  {
    id: "doc6",
    title: "Vector Databases",
    content: "Vector databases like FAISS, Pinecone, and Weaviate are specialized for storing and querying high-dimensional vectors. They enable efficient similarity search over millions of documents."
  },
  {
    id: "doc7",
    title: "Prompt Engineering for RAG",
    content: "Effective RAG requires careful prompt engineering. The prompt should clearly distinguish between the user's query and the retrieved context, instructing the model to cite its sources."
  }
];

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/documents", (req, res) => {
    res.json(dataset);
  });

  app.post("/api/documents", (req, res) => {
    const { title, content } = req.body;
    if (!title || !content) return res.status(400).json({ error: "Title and content are required" });
    
    const newDoc: Document = {
      id: `doc${dataset.length + 1}`,
      title,
      content
    };
    
    dataset.push(newDoc);
    res.json({ success: true, docId: newDoc.id });
  });

  // Serve static files and handle SPA
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

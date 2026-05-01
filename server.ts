import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Types
interface Document {
  id: string;
  title: string;
  content: string;
}

// Global dataset state (Seed Knowledge Base)
const dataset: Document[] = [
  // ... (keep dataset entries)
  {
    id: "ml-01",
    title: "Introduction to Machine Learning",
    content: "Machine Learning (ML) is a subset of AI that provides systems the ability to automatically learn and improve from experience without being explicitly programmed. It focuses on the development of computer programs that can access data and use it to learn for themselves."
  },
  {
    id: "ml-02",
    title: "Supervised vs Unsupervised Learning",
    content: "Supervised learning uses labeled datasets to train algorithms to classify data or predict outcomes accurately. Unsupervised learning uses machine learning algorithms to analyze and cluster unlabeled datasets, discovering hidden patterns or data groupings without the need for human intervention."
  },
  {
    id: "rag-01",
    title: "What is RAG?",
    content: "Retrieval-Augmented Generation (RAG) is a technique that grants LLMs access to specific, up-to-date information beyond their initial training data. It involves retrieving relevant documents from an external knowledge base and passing them to the generator (LLM) to produce grounded responses."
  },
  {
    id: "vec-01",
    title: "Vector Embeddings",
    content: "Vector embeddings represent text as numbers in a high-dimensional space. Words or sentences with similar meanings are placed close together, allowing computers to understand semantic relationships and perform efficient similarity searches."
  },
  {
    id: "eval-01",
    title: "Evaluating RAG Performance",
    content: "RAG systems are often evaluated based on Faithfulness (Is the answer derived from context?), Answer Relevance (Does it solve the query?), and Retrieval Precision (Are the retrieved documents actually useful?)."
  },
  {
    id: "doc1",
    title: "FAITH RAG Overview",
    content: "FAITH RAG is a modern retrieval-augmented generation framework designed for high fidelity and low latency. It uses advanced vector matching and a dual-stage verification process to ensure zero hallucinations."
  }
];

async function startServer() {
  const app = express();
  const PORT = 3000;

  // 1. GLOBAL MIDDLEWARE
  app.use(cors());
  app.use(express.json());

  // Request Logger
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} ${res.statusCode} - ${duration}ms`);
    });
    next();
  });

  // 2. API ROUTES
  
  // Test Endpoint
  app.get("/api/test", (req, res) => {
    res.json({
      status: "online",
      timestamp: new Date().toISOString(),
      message: "Backend is responding successfully!",
      config: {
        port: PORT,
        node_env: process.env.NODE_ENV || "development"
      }
    });
  });

  // Knowledge Retrieval
  app.get("/api/documents", (req, res) => {
    res.json(dataset);
  });

  // 3. FRONTEND SERVING
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting server in DEVELOPMENT mode with Vite tracking...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting server in PRODUCTION mode...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // 4. ERROR HANDLING
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Unhandled Server Error:", err);
    res.status(500).json({ error: "Internal Server Error", message: err.message });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n🚀 SERVER LIVE`);
    console.log(`🔗 Local URL: http://localhost:${PORT}`);
    console.log(`📡 Network:   http://0.0.0.0:${PORT}`);
    console.log(`🛠  Mode:      ${process.env.NODE_ENV || "development"}\n`);
  });
}

startServer().catch(err => {
  console.error("FAILED TO START SERVER:", err);
  process.exit(1);
});

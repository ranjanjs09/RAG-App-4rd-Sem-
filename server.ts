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

// Global dataset state
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

  // Knowledge Retrieval (Metadata/Static fallback)
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

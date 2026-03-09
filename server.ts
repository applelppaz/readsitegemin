import express from "express";
import { createServer as createViteServer } from "vite";
import * as cheerio from "cheerio";
import fetch from "node-fetch";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API route to fetch URL content
  app.post("/api/fetch-url", async (req, res) => {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch URL: ${response.statusText}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Remove scripts, styles, and other non-content elements
      $("script, style, nav, footer, iframe, noscript, header, aside, .nav, .footer, .header, .sidebar, .menu, .ads, .advertisement").remove();

      // Try to find the main content area
      let contentElement = $("article, main, section, [role='main'], .content, #content, .post, .article, .entry-content, .main-content").first();
      
      // If no specific content area found, use body
      if (contentElement.length === 0) {
        contentElement = $("body");
      }

      // Extract text while preserving some structure (newlines for paragraphs)
      // We can iterate over block elements and add newlines
      let extractedText = "";
      contentElement.find("p, h1, h2, h3, h4, h5, h6, li, div").each((_, el) => {
        const text = $(el).text().trim();
        if (text) {
          extractedText += text + "\n\n";
        }
      });

      // If the above method failed to get enough text, fallback to simple text()
      if (extractedText.length < 200) {
        extractedText = contentElement.text();
      }
      
      // Clean up whitespace but keep some newlines
      const cleanedText = extractedText
        .replace(/[ \t]+/g, " ") // Replace multiple spaces/tabs with single space
        .replace(/\n\s*\n/g, "\n\n") // Normalize multiple newlines
        .trim();

      res.json({ text: cleanedText });
    } catch (error: any) {
      console.error("Error fetching URL:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

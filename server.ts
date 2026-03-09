import express from "express";
import { createServer as createViteServer } from "vite";
import * as cheerio from "cheerio";
import fetch from "node-fetch";
import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const errorMessage = error?.message || "";
      const isRateLimit = errorMessage.includes("429") || errorMessage.includes("RESOURCE_EXHAUSTED");
      const isOverloaded = errorMessage.includes("503") || errorMessage.includes("overloaded");

      if ((isRateLimit || isOverloaded) && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 3000 + Math.random() * 1000;
        console.warn(`Gemini API busy (Attempt ${i + 1}/${maxRetries}), retrying in ${Math.round(delay)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "5mb" }));

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

  // API route to analyze text with Gemini
  app.post("/api/analyze", async (req, res) => {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }

    try {
      const model = "gemini-3-flash-preview";
      const chunkSize = 6000;
      const textChunks: string[] = [];
      for (let i = 0; i < text.length; i += chunkSize) {
        textChunks.push(text.substring(i, i + chunkSize));
      }

      let combinedResult: any = {
        summary: "",
        writingStyleAnalysis: "",
        culturalContext: "",
        sentencePatterns: [],
        tokens: []
      };

      for (let i = 0; i < textChunks.length; i++) {
        const isFirst = i === 0;
        const chunk = textChunks[i];

        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        const prompt = isFirst ? `
          Analyze the following text (Part 1 of ${textChunks.length}) for a language learner who wants to achieve native-level understanding.
          The text could be in any language (e.g., English, Spanish, French, Chinese, etc.).

          **IMPORTANT INSTRUCTIONS:**
          1. IGNORE website UI elements (e.g., "Share", "Save", "Watch", "Like", "Subscribe", "Menu", etc.) that are not part of the actual article content.
          2. **STRICT WORD-LEVEL TOKENIZATION:** Every single token MUST be an individual word, a punctuation mark, or a whitespace character.
             - **NEVER** group multiple words into a single token unless they form a strictly inseparable idiom (e.g., "by the way").
             - **NEVER** include a full sentence, a phrase, or a clause in a single token.
             - If you see a sentence like "The cat sat on the mat", you MUST provide tokens for "The", " ", "cat", " ", "sat", " ", "on", " ", "the", " ", "mat".
          3. Provide a brief summary of the ENTIRE text in Japanese.
          4. Provide a detailed "Writing Style Analysis" in Japanese for the entire text.
          5. Provide a "Cultural & Contextual Background" in Japanese, explaining any cultural references, historical context, or societal norms mentioned or implied in the text.
          6. Identify key "Sentence Patterns" or grammatical structures used in this part.
          7. Segment this part into tokens sequentially (including ALL characters).
          8. For each token (except whitespace/punctuation):
             - Japanese translation. **If the language is Chinese, MUST include Pinyin (e.g., "こんにちは (nǐ hǎo)").**
             - Detailed explanation. **CRITICAL: If the token is a proper noun, historical event, or cultural reference, provide a concise but comprehensive background explanation.**
             - Dictionary form (lemma) if the word is inflected.
             - Inflection details: Specify the EXACT conjugation or inflection used in the "type" field.

          Text to analyze:
          ${chunk}
        ` : `
          Analyze the following text (Part ${i + 1} of ${textChunks.length}) for a language learner.

          **IMPORTANT INSTRUCTIONS:**
          1. IGNORE website UI elements (e.g., "Share", "Save", "Watch", etc.) that are not part of the actual article content.
          2. **STRICT WORD-LEVEL TOKENIZATION:** Every single token MUST be an individual word, a punctuation mark, or a whitespace character.
             - **NEVER** group multiple words into a single token unless they form a strictly inseparable idiom.
             - **NEVER** include a full sentence, a phrase, or a clause in a single token.
          3. Identify key "Sentence Patterns" or grammatical structures used in this part.
          4. Segment this part into tokens sequentially (including ALL characters).
          5. For each token (except whitespace/punctuation):
             - Japanese translation. **If the language is Chinese, MUST include Pinyin.**
             - Detailed explanation. **CRITICAL: Provide deep background for proper nouns, cultural references, or specialized terms.**
             - Dictionary form (lemma).
             - Inflection details: Specify the EXACT conjugation or inflection used in the "type" field.

          Text to analyze:
          ${chunk}
        `;

        const schema: any = {
          type: Type.OBJECT,
          properties: {
            sentencePatterns: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  pattern: { type: Type.STRING },
                  explanation: { type: Type.STRING },
                  example: { type: Type.STRING }
                },
                required: ["pattern", "explanation", "example"]
              }
            },
            tokens: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  text: { type: Type.STRING },
                  translation: { type: Type.STRING },
                  explanation: { type: Type.STRING },
                  lemma: { type: Type.STRING },
                  inflection: {
                    type: Type.OBJECT,
                    properties: {
                      type: { type: Type.STRING },
                      table: { type: Type.ARRAY, items: { type: Type.STRING } }
                    }
                  },
                  isPunctuation: { type: Type.BOOLEAN },
                  isWhitespace: { type: Type.BOOLEAN }
                },
                required: ["id", "text", "translation", "explanation"]
              }
            }
          },
          required: ["sentencePatterns", "tokens"]
        };

        if (isFirst) {
          schema.properties.summary = { type: Type.STRING };
          schema.properties.writingStyleAnalysis = { type: Type.STRING };
          schema.properties.culturalContext = { type: Type.STRING };
          schema.required.push("summary", "writingStyleAnalysis", "culturalContext");
        }

        const response = await withRetry(() => ai.models.generateContent({
          model,
          contents: [{ parts: [{ text: prompt }] }],
          config: {
            responseMimeType: "application/json",
            responseSchema: schema
          }
        }));

        try {
          const result = JSON.parse(response.text || "{}");
          if (isFirst) {
            combinedResult.summary = result.summary;
            combinedResult.writingStyleAnalysis = result.writingStyleAnalysis;
            combinedResult.culturalContext = result.culturalContext;
          }
          combinedResult.sentencePatterns.push(...(result.sentencePatterns || []));
          combinedResult.tokens.push(...(result.tokens || []));
        } catch (e) {
          console.error(`Failed to parse Gemini response for chunk ${i}:`, e);
          if (isFirst) throw new Error("Initial analysis failed");
        }
      }

      res.json(combinedResult);
    } catch (error: any) {
      console.error("Error analyzing text:", error);
      const msg = error.message || "Analysis failed";
      const status = msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") ? 429 : 500;
      res.status(status).json({ error: msg });
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

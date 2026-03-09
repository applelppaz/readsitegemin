import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Search, Globe, ChevronRight, ChevronLeft, Info, Book, Loader2, X, PenTool, Layout, Quote } from "lucide-react";
import { analyzeText } from "./services/geminiService";
import { AnalysisResult, Token } from "./types";

export default function App() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [fullText, setFullText] = useState<string>("");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"tokens" | "style" | "patterns">("tokens");
  
  const handleFetch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!url) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setFullText("");
    setSelectedIndex(null);

    try {
      const response = await fetch("/api/fetch-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to fetch URL");
      }

      const { text } = await response.json();
      setFullText(text);
      const analysis = await analyzeText(text);
      setResult(analysis);
    } catch (err: any) {
      console.error(err);
      let msg = err.message || "An unexpected error occurred";
      if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
        msg = "AIの利用制限に達しました。しばらく待ってから再度お試しいただくか、少し短めの文章で試してみてください。";
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!result) return;
    
    const isMeaningful = (idx: number) => {
      const t = result.tokens[idx];
      return t && !t.isWhitespace && !t.isPunctuation;
    };

    if (e.key === "ArrowRight") {
      setSelectedIndex(prev => {
        if (prev === null) {
          // Find first meaningful token
          for (let i = 0; i < result.tokens.length; i++) {
            if (isMeaningful(i)) return i;
          }
          return null;
        }
        
        // Find next meaningful token
        let next = prev + 1;
        while (next < result.tokens.length && !isMeaningful(next)) {
          next++;
        }
        return next < result.tokens.length ? next : prev;
      });
    } else if (e.key === "ArrowLeft") {
      setSelectedIndex(prev => {
        if (prev === null) return null;
        
        // Find previous meaningful token
        let next = prev - 1;
        while (next >= 0 && !isMeaningful(next)) {
          next--;
        }
        return next >= 0 ? next : prev;
      });
    } else if (e.key === "Escape") {
      setSelectedIndex(null);
    }
  }, [result]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const selectedToken = selectedIndex !== null ? result?.tokens[selectedIndex] : null;

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans selection:bg-emerald-100">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-emerald-200">
              <PenTool size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">LingoLens Writing</h1>
              <p className="text-xs text-stone-500 font-medium uppercase tracking-wider">Master Foreign Composition</p>
            </div>
          </div>

          <form onSubmit={handleFetch} className="flex-1 w-full max-w-md relative group">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste a URL to analyze writing style..."
              className="w-full pl-10 pr-4 py-2.5 bg-stone-100 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 transition-all outline-none"
              required
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 group-focus-within:text-emerald-500 transition-colors" size={18} />
            <button
              type="submit"
              disabled={loading}
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-emerald-600 text-white px-4 py-1.5 rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader2 className="animate-spin" size={16} /> : "Analyze"}
            </button>
          </form>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-2xl mb-8 flex items-center gap-3">
            <Info size={20} />
            <p>{error}</p>
          </div>
        )}

        {!result && !loading && !error && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-20 h-20 bg-stone-100 rounded-full flex items-center justify-center text-stone-300 mb-6">
              <PenTool size={40} />
            </div>
            <h2 className="text-2xl font-semibold text-stone-800 mb-2">Learn to Write Like a Native</h2>
            <p className="text-stone-500 max-w-sm">Enter a URL to analyze its writing style, rhetorical devices, and sentence structures.</p>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="animate-spin text-emerald-600 mb-4" size={48} />
            <p className="text-stone-500 animate-pulse">Analyzing writing style and structure...</p>
          </div>
        )}

        {result && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Column: Content & Analysis */}
            <div className="lg:col-span-8 space-y-8">
              {/* Summary & Writing Style Analysis */}
              <section className="bg-white p-8 rounded-3xl border border-stone-200 shadow-sm space-y-6">
                <div>
                  <h3 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <Info size={14} /> Summary
                  </h3>
                  <p className="text-stone-700 leading-relaxed italic font-serif text-lg border-l-4 border-emerald-100 pl-4">
                    {result.summary}
                  </p>
                </div>

                <div className="pt-6 border-t border-stone-100">
                  <h3 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Globe size={14} /> Cultural & Contextual Background
                  </h3>
                  <div className="text-stone-700 text-sm leading-relaxed space-y-4 bg-stone-50 p-6 rounded-2xl border border-stone-100">
                    {result.culturalContext.split('\n').map((para, i) => (
                      <p key={i}>{para}</p>
                    ))}
                  </div>
                </div>

                <div className="pt-6 border-t border-stone-100">
                  <h3 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <PenTool size={14} /> Writing Style Analysis
                  </h3>
                  <div className="text-stone-700 text-sm leading-relaxed space-y-4 bg-emerald-50/30 p-6 rounded-2xl border border-emerald-100/50">
                    {result.writingStyleAnalysis.split('\n').map((para, i) => (
                      <p key={i}>{para}</p>
                    ))}
                  </div>
                </div>
              </section>

              {/* Tabs for Content */}
              <div className="flex gap-4 border-b border-stone-200 pb-px">
                <button
                  onClick={() => setActiveTab("tokens")}
                  className={`pb-4 px-2 text-sm font-bold uppercase tracking-widest transition-all relative ${activeTab === "tokens" ? "text-emerald-600" : "text-stone-400 hover:text-stone-600"}`}
                >
                  Interactive Text
                  {activeTab === "tokens" && <motion.div layoutId="tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-600" />}
                </button>
                <button
                  onClick={() => setActiveTab("patterns")}
                  className={`pb-4 px-2 text-sm font-bold uppercase tracking-widest transition-all relative ${activeTab === "patterns" ? "text-emerald-600" : "text-stone-400 hover:text-stone-600"}`}
                >
                  Sentence Patterns
                  {activeTab === "patterns" && <motion.div layoutId="tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-600" />}
                </button>
              </div>

              {activeTab === "tokens" && (
                <section className="bg-white p-8 rounded-3xl border border-stone-200 shadow-sm min-h-[400px]">
                  <div className="text-lg leading-relaxed font-serif">
                    {result.tokens.map((token, idx) => {
                      if (token.isWhitespace) {
                        return <span key={token.id + idx} className="whitespace-pre-wrap">{token.text}</span>;
                      }
                      return (
                        <span
                          key={token.id + idx}
                          onClick={() => setSelectedIndex(idx)}
                          className={`
                            cursor-pointer transition-all duration-200 rounded px-0.5
                            ${token.isPunctuation ? 'text-stone-400' : 'hover:bg-emerald-50 hover:text-emerald-700'}
                            ${selectedIndex === idx ? 'bg-emerald-600 text-white hover:bg-emerald-600 hover:text-white shadow-md shadow-emerald-200' : ''}
                          `}
                        >
                          {token.text}
                        </span>
                      );
                    })}
                  </div>
                </section>
              )}

              {activeTab === "patterns" && (
                <section className="grid grid-cols-1 gap-4">
                  {result.sentencePatterns.map((pattern, i) => (
                    <motion.div
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.1 }}
                      key={i}
                      className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm hover:border-emerald-200 transition-colors"
                    >
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600 shrink-0">
                          <Layout size={20} />
                        </div>
                        <div className="space-y-3">
                          <h4 className="text-lg font-bold text-stone-800">{pattern.pattern}</h4>
                          <p className="text-stone-600 text-sm leading-relaxed">{pattern.explanation}</p>
                          <div className="bg-stone-50 p-4 rounded-2xl border border-stone-100 font-serif italic text-stone-500 relative">
                            <Quote className="absolute -top-2 -left-2 text-stone-200" size={24} />
                            {pattern.example}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </section>
              )}
            </div>

            {/* Right Column: Detail Area */}
            <aside className="lg:col-span-4">
              <div className="sticky top-28 space-y-6">
                <AnimatePresence mode="wait">
                  {selectedToken ? (
                    <motion.div
                      key={selectedToken.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      className="bg-white rounded-3xl border border-stone-200 shadow-xl overflow-hidden"
                    >
                      <div className="bg-emerald-600 p-6 text-white">
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="text-3xl font-bold tracking-tight">{selectedToken.text}</h4>
                          <button onClick={() => setSelectedIndex(null)} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
                            <X size={20} />
                          </button>
                        </div>
                        <p className="text-emerald-100 text-lg font-medium">{selectedToken.translation}</p>
                      </div>

                      <div className="p-6 space-y-6">
                        {/* Lemma & Inflection */}
                        {selectedToken.lemma && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-stone-400 text-xs font-bold uppercase tracking-wider">
                              <Book size={14} /> Dictionary Form
                            </div>
                            <div className="bg-stone-50 p-3 rounded-xl border border-stone-100">
                              <span className="font-mono font-medium text-emerald-700">{selectedToken.lemma}</span>
                              {selectedToken.inflection && (
                                <div className="mt-2 pt-2 border-t border-stone-200/50">
                                  <span className="text-xs text-stone-500 block mb-1">{selectedToken.inflection.type}</span>
                                  <div className="flex flex-wrap gap-1">
                                    {selectedToken.inflection.table.map((form, i) => (
                                      <span key={i} className="text-[10px] bg-white border border-stone-200 px-1.5 py-0.5 rounded text-stone-600">
                                        {form}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Explanation */}
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 text-stone-400 text-xs font-bold uppercase tracking-wider">
                            <Info size={14} /> Nuance & Usage
                          </div>
                          <div className="text-stone-700 text-sm leading-relaxed space-y-4">
                            {selectedToken.explanation.split('\n').map((para, i) => (
                              <p key={i}>{para}</p>
                            ))}
                          </div>
                        </div>

                        {/* Navigation Hints */}
                        <div className="pt-4 border-t border-stone-100 flex justify-between items-center text-[10px] text-stone-400 font-bold uppercase tracking-widest">
                          <div className="flex items-center gap-1">
                            <kbd className="bg-stone-100 px-1.5 py-0.5 rounded border border-stone-200"><ChevronLeft size={10} /></kbd>
                            <span>Prev</span>
                          </div>
                          <span>Use Arrows to navigate</span>
                          <div className="flex items-center gap-1">
                            <span>Next</span>
                            <kbd className="bg-stone-100 px-1.5 py-0.5 rounded border border-stone-200"><ChevronRight size={10} /></kbd>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ) : (
                    <div className="bg-stone-100/50 border-2 border-dashed border-stone-200 rounded-3xl p-8 text-center flex flex-col items-center justify-center min-h-[300px]">
                      <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-stone-300 shadow-sm mb-4">
                        <PenTool size={24} />
                      </div>
                      <p className="text-stone-400 text-sm font-medium">Select a word to see its nuance and how it contributes to the writing style.</p>
                    </div>
                  )}
                </AnimatePresence>
              </div>
            </aside>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-6xl mx-auto px-4 py-12 border-t border-stone-200 text-center">
        <p className="text-stone-400 text-xs font-medium uppercase tracking-widest">Powered by Gemini AI & LingoLens Writing</p>
      </footer>
    </div>
  );
}

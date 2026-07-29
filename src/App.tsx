import { useState } from "react";
import TranslateView from "./components/TranslateView";
import LearnView from "./components/LearnView";

type Tab = "translate" | "learn";

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("translate");

  return (
    <div className="flex min-h-full flex-col bg-black">
      {/* Header */}
      <header className="border-b border-red-900/30 px-6 py-6">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-wide text-red-100">
              Idlang
            </h1>
            <p className="text-xs italic text-red-500">
              The Guardian of History
            </p>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex gap-1 rounded-lg border border-red-900/30 bg-neutral-950 p-0.5">
            <button
              onClick={() => setActiveTab("translate")}
              className={`rounded-md px-5 py-2 text-xs font-semibold uppercase tracking-wider transition-all ${
                activeTab === "translate"
                  ? "bg-red-900 text-red-100 shadow"
                  : "text-red-600 hover:text-red-400"
              }`}
            >
              Translate
            </button>
            <button
              onClick={() => setActiveTab("learn")}
              className={`rounded-md px-5 py-2 text-xs font-semibold uppercase tracking-wider transition-all ${
                activeTab === "learn"
                  ? "bg-red-900 text-red-100 shadow"
                  : "text-red-600 hover:text-red-400"
              }`}
            >
              Learn
            </button>
          </nav>
        </div>
      </header>

      {/* Decorative divider */}
      <div className="mx-auto h-px w-24 bg-red-900/50" />

      {/* Content */}
      <main className="flex-1 py-12">
        {activeTab === "translate" ? <TranslateView /> : <LearnView />}
      </main>

      {/* Footer */}
      <footer className="border-t border-red-900/20 px-6 py-4 text-center">
        <p className="text-xs text-red-700">
          Preserving Idoma — the language of our ancestors
        </p>
      </footer>
    </div>
  );
}

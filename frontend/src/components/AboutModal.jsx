import React, { useState, useEffect } from 'react';
import {
  X,
  Info,
  ExternalLink,
  Sparkles,
  Layers,
  Globe,
  Calendar,
  Cpu,
  Heart,
  ShieldCheck,
  MousePointer,
  ZoomIn,
  Edit3,
  Download,
  Code2,
  CheckCircle2,
  BookOpen,
  ArrowRight,
  Mail,
  Copy,
  Check
} from 'lucide-react';
import ChroniXLogo from './ChroniXLogo';

const TABS = [
  { id: 'overview', label: 'Overview', icon: Sparkles },
  { id: 'credits', label: 'Credits & Attributions', icon: Heart },
  { id: 'guide', label: 'Quick Guide', icon: MousePointer }
];

export default function AboutModal({ isOpen, onClose, onOpenGuide }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [copiedEmail, setCopiedEmail] = useState(false);

  const handleCopyEmail = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText('chronix.ai.com@gmail.com');
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2000);
  };

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-md animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-chronix-title"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-200">
        
        {/* Header with Logo & Hero */}
        <div className="relative px-6 pt-6 pb-4 border-b border-slate-200/80 dark:border-slate-800 bg-gradient-to-br from-slate-50 via-sky-50/30 to-white dark:from-slate-900 dark:via-slate-900/90 dark:to-slate-950">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-sky-500/15 to-indigo-500/15 dark:from-sky-500/25 dark:to-indigo-500/25 border border-sky-500/20 shadow-xs flex items-center justify-center">
                <ChroniXLogo size="sm" mode="minimal" variant="auto" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2
                    id="about-chronix-title"
                    className="font-black text-xl text-slate-900 dark:text-white tracking-tight"
                  >
                    ChroniX
                  </h2>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-700 dark:bg-sky-950/80 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                    v1.0
                  </span>
                </div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                  AI-Powered Interactive Visual Chronology
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-xl hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title="Close (Esc)"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tab Navigation */}
          <div className="flex items-center gap-1.5 mt-5 bg-slate-200/70 dark:bg-slate-800/80 p-1 rounded-xl">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-white/50 dark:hover:bg-slate-700/50'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 text-sm text-slate-700 dark:text-slate-300 leading-relaxed max-h-[calc(92vh-180px)]">
          
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-5 animate-in fade-in duration-150">
              <div className="p-4 rounded-2xl bg-gradient-to-r from-sky-500/10 via-indigo-500/5 to-transparent border border-sky-500/15">
                <p className="text-slate-800 dark:text-slate-200 text-xs sm:text-sm leading-relaxed">
                  <strong>ChroniX</strong> transforms any natural language subject into an interactive, zoomable visual chronology. From cosmic history billions of years ago to modern day political, scientific, or cultural milestones, ChroniX synthesizes rich narratives with structured swimlanes and verified Wikimedia imagery.
                </p>
              </div>

              <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                Core Capabilities
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1.5">
                  <div className="flex items-center gap-2 text-sky-600 dark:text-sky-400">
                    <Sparkles className="w-4 h-4" />
                    <span className="font-semibold text-xs text-slate-900 dark:text-white">
                      Generative Chronology
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Natural language prompts are structured by Google Gemini into coherent, sequential timelines across Overview, Standard, and Deep Dive granularities.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1.5">
                  <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                    <Layers className="w-4 h-4" />
                    <span className="font-semibold text-xs text-slate-900 dark:text-white">
                      Dynamic Swimlanes & Eras
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Events are organized in parallel thematic tracks (e.g. Allied vs Axis, Hardware vs Software) layered with broad historical time bands.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1.5">
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                    <Globe className="w-4 h-4" />
                    <span className="font-semibold text-xs text-slate-900 dark:text-white">
                      Wikimedia Enrichment
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Automatically pairs events with verified historical photographs, portrait thumbnails, and encyclopedic extracts directly from Wikimedia Commons.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1.5">
                  <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400">
                    <Edit3 className="w-4 h-4" />
                    <span className="font-semibold text-xs text-slate-900 dark:text-white">
                      AI Refine & Manual Tuning
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Add custom events, modify existing cards, or converse with AI to expand specific historical eras, battles, or discoveries.
                  </p>
                </div>
              </div>

              {/* Contact & Support */}
              <div className="p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-gradient-to-r from-sky-500/10 via-indigo-500/5 to-slate-50 dark:to-slate-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-sky-500/15 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400 shrink-0">
                    <Mail className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white">
                      Contact & Support
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Have questions, feedback, or ideas? Reach out anytime.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <a
                    href="mailto:chronix.ai.com@gmail.com"
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-slate-800 hover:bg-sky-50 dark:hover:bg-slate-700/80 text-sky-600 dark:text-sky-400 border border-slate-200 dark:border-slate-700 shadow-2xs transition-all cursor-pointer"
                    title="Send an email to chronix.ai.com@gmail.com"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    <span>chronix.ai.com@gmail.com</span>
                  </a>
                  <button
                    type="button"
                    onClick={handleCopyEmail}
                    className="p-1.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700/80 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 shadow-2xs transition-all cursor-pointer"
                    title={copiedEmail ? 'Copied!' : 'Copy email to clipboard'}
                    aria-label="Copy email address"
                  >
                    {copiedEmail ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CREDITS & ATTRIBUTIONS */}
          {activeTab === 'credits' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                ChroniX stands on the shoulders of incredible open projects, engines, and public resources. We express our deep appreciation to the following creators and communities:
              </p>

              {/* Histropedia Credit */}
              <div className="p-4 rounded-2xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/50 dark:bg-sky-950/20 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-400 font-bold text-xs">
                      JS
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                        HistropediaJS
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Interactive Timeline Canvas Engine
                      </p>
                    </div>
                  </div>
                  <a
                    href="https://histropedia.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline"
                  >
                    <span>histropedia.com</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  The visual canvas and interactive timeline rendering in ChroniX are powered by <strong>HistropediaJS</strong>, developed by <strong>Histropedia Ltd</strong>. HistropediaJS enables fluid multi-scale navigation, from cosmological scales to exact minutes.
                </p>
                <div className="pt-1 text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between border-t border-sky-100 dark:border-sky-900/40">
                  <span>Subject to the HistropediaJS Non-Commercial Licence Agreement (free for educational & non-commercial use).</span>
                  <a
                    href="https://js.histropedia.com/licence"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-600 dark:text-sky-400 hover:underline shrink-0 ml-2"
                  >
                    Licence details
                  </a>
                </div>
              </div>

              {/* Google Gemini Credit */}
              <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
                      <Cpu className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                        Google Gemini
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        AI Reasoning & Chronological Structuring
                      </p>
                    </div>
                  </div>
                  <a
                    href="https://aistudio.google.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    <span>Google AI Studio</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Timeline synthesis, milestone event selection, multi-language translation, and contextual refinement are driven by Google&apos;s Gemini large language models.
                </p>
              </div>

              {/* Wikipedia & Wikimedia Commons Credit */}
              <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                      <Globe className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                        Wikimedia Commons & Wikipedia
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Encyclopedic Media & Summaries
                      </p>
                    </div>
                  </div>
                  <a
                    href="https://commons.wikimedia.org"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
                  >
                    <span>Wikimedia</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Event thumbnail images, portraits, and encyclopedic extracts are retrieved via the public MediaWiki & Wikimedia REST APIs under Creative Commons licenses (CC BY-SA).
                </p>
              </div>

              {/* Open Source Tech Stack & License */}
              <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
                      <Code2 className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                        Open-Source Ecosystem
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Modern Web Technologies & Libraries
                      </p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                    MIT License
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  ChroniX is built with React 19, Vite, Tailwind CSS, Lucide Icons, FastAPI, Leaflet, and canvas-confetti. The ChroniX application source code is released under the open-source MIT License.
                </p>
              </div>

              {/* Contact / Inquiries */}
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-sky-500/10 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400 shrink-0">
                    <Mail className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h5 className="font-semibold text-xs text-slate-900 dark:text-white">
                      Questions & Suggestions
                    </h5>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Reach out for inquiries, licensing or feedback
                    </p>
                  </div>
                </div>
                <a
                  href="mailto:chronix.ai.com@gmail.com"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline w-fit"
                >
                  <Mail className="w-3 h-3" />
                  <span>chronix.ai.com@gmail.com</span>
                </a>
              </div>
            </div>
          )}

          {/* TAB 3: QUICK GUIDE */}
          {activeTab === 'guide' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              {/* Callout to Full User Guide */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-sky-500/10 via-indigo-500/10 to-transparent border border-sky-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <h4 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white flex items-center gap-1.5">
                    <BookOpen className="w-4 h-4 text-sky-500" />
                    Looking for comprehensive guides & prompt tutorials?
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Explore our complete User Guide with prompt writing tips, interactive examples with "Try Now", and map features.
                  </p>
                </div>
                <button
                  type="button"
                  id="about-open-user-guide-btn"
                  onClick={() => {
                    onClose();
                    onOpenGuide?.();
                  }}
                  className="px-3.5 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-semibold text-xs flex items-center gap-1.5 shadow-xs transition-all shrink-0 cursor-pointer"
                >
                  <span>Open User Guide</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                Navigating the Timeline
              </h3>

              <div className="space-y-2.5">
                <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                  <div className="p-1.5 rounded-lg bg-sky-100 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5">
                    <ZoomIn className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-xs text-slate-900 dark:text-white">
                      Zoom & Pan Canvas
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                      Use the <strong>mouse scroll wheel</strong> or pinch-to-zoom to zoom in and out. Click and drag the timeline background to pan across time.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                  <div className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5">
                    <MousePointer className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-xs text-slate-900 dark:text-white">
                      Inspect Event Drawer
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                      Click any card on the timeline to open the detailed slide-over drawer, showing full-resolution Wikimedia photography, Wikipedia extracts, and direct article links.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                  <div className="p-1.5 rounded-lg bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-xs text-slate-900 dark:text-white">
                      AI Refine Dialogue
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                      Click the <strong>Refine</strong> button on the toolbar to converse with Gemini. Request extra events for specific sub-periods (e.g., <em>&ldquo;Add key battles between 1941 and 1943&rdquo;</em>).
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                  <div className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5">
                    <Download className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-xs text-slate-900 dark:text-white">
                      Save, Import & Export
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                      Export your timeline as a high-resolution PNG snapshot or structured JSON file. Timelines can also be saved to your personal library for instant recall.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/70 flex flex-col sm:flex-row items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 text-[11px] text-slate-500 dark:text-slate-400 flex-wrap">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-sky-500 shrink-0" />
              <span>Made with curiosity for history, science & discovery.</span>
            </div>
            <span className="hidden sm:inline text-slate-300 dark:text-slate-700">•</span>
            <a
              href="mailto:chronix.ai.com@gmail.com"
              className="inline-flex items-center gap-1.5 hover:text-sky-600 dark:hover:text-sky-400 transition-colors font-medium text-slate-600 dark:text-slate-400"
              title="Contact us via email"
            >
              <Mail className="w-3 h-3 text-sky-500 shrink-0" />
              <span>chronix.ai.com@gmail.com</span>
            </a>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              id="about-footer-guide-btn"
              onClick={() => {
                onClose();
                onOpenGuide?.();
              }}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <BookOpen className="w-3.5 h-3.5 text-sky-500" />
              <span>User Guide</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 shadow-xs transition-all active:scale-95 cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

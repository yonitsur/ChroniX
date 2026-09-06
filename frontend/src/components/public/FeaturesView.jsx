import React from 'react';
import { Sparkles, Clock, Globe, ArrowRight, Layers, ShieldCheck, Camera } from 'lucide-react';

export default function FeaturesView({ onEnter }) {
  return (
    <div className="w-full flex-1 flex flex-col animate-fade-in">
      {/* Hero Header */}
      <section className="public-hero">
        <div className="public-badge">
          <Sparkles className="w-3.5 h-3.5 text-sky-400" />
          <span>Interactive Visual Chronologies</span>
        </div>
        <h1>Platform Features &amp; Capabilities</h1>
        <p className="public-subtitle">
          ChroniX unifies advanced multi-lane data visualization with artificial intelligence to reveal the flow of human history, cross-cultural milestones, and multi-dimensional timelines.
        </p>
      </section>

      {/* 6 Features Grid */}
      <main className="public-feature-grid">
        {/* 1. Cartesian Timelines */}
        <div className="public-feature-card">
          <div className="public-feature-icon">
            <Clock className="w-5 h-5 text-sky-400" />
          </div>
          <h3 className="public-feature-title">Multi-Lane &amp; Thematic Chronology</h3>
          <p className="public-feature-desc">
            Navigate fluidly from millennia down to single days. Compare parallel swimlanes side-by-side or explore automatic color-coded themes with a draggable filter legend.
          </p>
        </div>

        {/* 2. AI Historical Engine */}
        <div className="public-feature-card">
          <div className="public-feature-icon">
            <Sparkles className="w-5 h-5 text-sky-400" />
          </div>
          <h3 className="public-feature-title">AI-Powered Multilingual Synthesis</h3>
          <p className="public-feature-desc">
            Generate timelines in any language on demand. Powered by Google Gemini and enriched with verified Wikimedia Commons imagery and encyclopedic summaries.
          </p>
        </div>

        {/* 3. Geospatial Mapping */}
        <div className="public-feature-card">
          <div className="public-feature-icon">
            <Globe className="w-5 h-5 text-sky-400" />
          </div>
          <h3 className="public-feature-title">Geospatial Synchronized Maps</h3>
          <p className="public-feature-desc">
            Explore where history happened. Mapped milestones synchronize live between the interactive world map and the timeline canvas.
          </p>
        </div>

        {/* 4. Cross-Cultural Comparisons */}
        <div className="public-feature-card">
          <div className="public-feature-icon">
            <Layers className="w-5 h-5 text-sky-400" />
          </div>
          <h3 className="public-feature-title">Cross-Cultural Comparisons</h3>
          <p className="public-feature-desc">
            Contrast civilizations side-by-side—see concurrent revolutions, scientific breakthroughs, or opposing factions in parallel tracks.
          </p>
        </div>

        {/* 5. Cloud Research & Sync */}
        <div className="public-feature-card">
          <div className="public-feature-icon">
            <ShieldCheck className="w-5 h-5 text-sky-400" />
          </div>
          <h3 className="public-feature-title">Private Workspace &amp; Cloud Sync</h3>
          <p className="public-feature-desc">
            Save custom timelines, star key milestones, and securely access your historical research across all your devices.
          </p>
        </div>

        {/* 6. High-Resolution Visual Export */}
        <div className="public-feature-card">
          <div className="public-feature-icon">
            <Camera className="w-5 h-5 text-sky-400" />
          </div>
          <h3 className="public-feature-title">High-Res Visual Snapshot Export</h3>
          <p className="public-feature-desc">
            Export your timelines as crisp PNG snapshots or structured JSON datasets for presentations, study, and research.
          </p>
        </div>
      </main>

      {/* Call to Action Box */}
      <div className="public-cta-box">
        <h3>Ready to Explore History?</h3>
        <p>Start discovering parallel timelines and deep historical narratives with ChroniX today.</p>
        <button type="button" onClick={onEnter} className="public-cta-button">
          <span>Enter ChroniX</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

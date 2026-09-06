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
          <h3 className="public-feature-title">Cartesian Multi-Lane Chronology</h3>
          <p className="public-feature-desc">
            Navigate fluidly across millennia, centuries, and days. The horizontal X-axis maps chronological progression, while the vertical Y-axis separates distinct thematic and cultural lanes.
          </p>
        </div>

        {/* 2. AI Historical Engine */}
        <div className="public-feature-card">
          <div className="public-feature-icon">
            <Sparkles className="w-5 h-5 text-sky-400" />
          </div>
          <h3 className="public-feature-title">AI-Powered Multilingual Synthesis</h3>
          <p className="public-feature-desc">
            Generate comprehensive historical narratives on demand in any language. Powered by Google Gemini AI, ChroniX produces events and summaries in your prompt's language, dynamically connecting to localized Wikipedia editions worldwide.
          </p>
        </div>

        {/* 3. Geospatial Mapping */}
        <div className="public-feature-card">
          <div className="public-feature-icon">
            <Globe className="w-5 h-5 text-sky-400" />
          </div>
          <h3 className="public-feature-title">Geospatial Synchronized Maps</h3>
          <p className="public-feature-desc">
            Explore where history unfolded. Every historical milestone with geographic coordinates is rendered on an interactive global map synchronized dynamically with the chronological viewport.
          </p>
        </div>

        {/* 4. Cross-Cultural Comparisons */}
        <div className="public-feature-card">
          <div className="public-feature-icon">
            <Layers className="w-5 h-5 text-sky-400" />
          </div>
          <h3 className="public-feature-title">Cross-Cultural Comparisons</h3>
          <p className="public-feature-desc">
            See what was happening in East Asia while the Roman Republic expanded, or compare scientific breakthroughs during the Islamic Golden Age with medieval Europe in parallel lanes.
          </p>
        </div>

        {/* 5. Cloud Research & Sync */}
        <div className="public-feature-card">
          <div className="public-feature-icon">
            <ShieldCheck className="w-5 h-5 text-sky-400" />
          </div>
          <h3 className="public-feature-title">Private Workspace &amp; Cloud Sync</h3>
          <p className="public-feature-desc">
            Save custom timelines, star pivotal turning points, annotate event records, and securely sync your historical research across desktop and mobile devices.
          </p>
        </div>

        {/* 6. High-Resolution Visual Export */}
        <div className="public-feature-card">
          <div className="public-feature-icon">
            <Camera className="w-5 h-5 text-sky-400" />
          </div>
          <h3 className="public-feature-title">High-Res Visual Snapshot Export</h3>
          <p className="public-feature-desc">
            Export full visual representations of your custom chronologies as high-resolution images or structured JSON datasets for academic research, presentations, or publication.
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

import React from 'react';
import { ShieldCheck } from 'lucide-react';

export default function PrivacyView() {
  return (
    <div className="w-full flex-1 flex flex-col animate-fade-in">
      {/* Hero Header */}
      <section className="public-hero">
        <div className="public-badge">
          <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
          <span>Data Privacy &amp; Security</span>
        </div>
        <h1>Privacy Policy</h1>
        <p className="public-last-updated">Last Updated: September 2026 &bull; ChroniX Limited Use Disclosure</p>
      </section>

      {/* Legal Content Container */}
      <article className="public-content-card">
        <p>
          Welcome to <strong>ChroniX</strong> ("we", "our", or "us"), available at <a href="https://chronix-ai.com" target="_blank" rel="noopener noreferrer">https://chronix-ai.com</a>.
          ChroniX is an interactive, multi-dimensional historical timeline platform that allows users to explore, compare, and visualize historical events and parallel chronologies.
        </p>
        <p>
          We value your privacy and are committed to protecting your personal data. This Privacy Policy explains how we collect, use, and protect your information when you access or use our service.
        </p>

        <h2>1. Information We Collect</h2>
        <p>We only collect the minimal information necessary to provide and operate our service:</p>
        <ul>
          <li>
            <strong>Authentication Information (Google OAuth):</strong> When you sign in using Google, we receive your Google account ID, email address, name, and profile picture provided by Google's OAuth 2.0 service. We do not receive or store your Google password.
          </li>
          <li>
            <strong>User-Generated Content:</strong> Timelines, bookmarks, custom event annotations, and preferences created or saved while using ChroniX.
          </li>
          <li>
            <strong>Usage &amp; Technical Data:</strong> Standard server logs, IP address, and browser metadata strictly for security, rate-limiting, and error prevention.
          </li>
        </ul>

        <h2>2. How We Use Your Information</h2>
        <p>We use the information we collect strictly to:</p>
        <ul>
          <li>Authenticate your identity and provide secure access to your account.</li>
          <li>Save, synchronize, and retrieve your personal timelines, favorites, and settings across sessions.</li>
          <li>Ensure platform security, prevent abuse, and enforce usage limits.</li>
          <li>Provide user support and respond to your requests.</li>
        </ul>

        <div className="public-callout">
          <strong>Google API Services User Data Compliance:</strong><br />
          ChroniX's use and transfer to any other app of information received from Google APIs adheres to the{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
            Google API Services User Data Policy
          </a>, including the Limited Use requirements.
        </div>

        <h2>3. Information Sharing and Disclosure</h2>
        <p>
          <strong>We do not sell, rent, or trade your personal information to third parties.</strong>
        </p>
        <p>We do not share your Google user data with third-party AI models or advertisers. Your data is only processed by trusted infrastructure providers (such as Supabase for database management and secure cloud hosting) solely to deliver the ChroniX application functionality.</p>

        <h2>4. Data Storage and Security</h2>
        <p>
          Your data is transmitted using modern TLS/HTTPS encryption and stored in secure cloud databases with strict Row-Level Security (RLS) policies. Access is restricted to authenticated user sessions.
        </p>

        <h2>5. Data Retention and Deletion</h2>
        <p>
          We retain your personal information only as long as your account is active. You may request the deletion of your account and all associated data at any time by contacting us. Upon receiving your request, we will permanently delete your user profile and stored timelines within 30 days.
        </p>

        <h2>6. Children's Privacy</h2>
        <p>
          ChroniX does not knowingly collect personal identifiable information from children under the age of 13. If you believe that a child has provided us with personal information, please contact us immediately.
        </p>

        <h2>7. Contact Us</h2>
        <p>
          If you have questions, concerns, or data deletion requests regarding this Privacy Policy, please contact us at:
        </p>
        <p>
          <strong>Website:</strong> <a href="https://chronix-ai.com" target="_blank" rel="noopener noreferrer">https://chronix-ai.com</a><br />
          <strong>Email:</strong> chronix.ai.com@gmail.com
        </p>
      </article>
    </div>
  );
}

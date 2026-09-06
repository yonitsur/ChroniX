import React from 'react';
import { FileText } from 'lucide-react';

export default function TermsView() {
  return (
    <div className="w-full flex-1 flex flex-col animate-fade-in">
      {/* Hero Header */}
      <section className="public-hero">
        <div className="public-badge">
          <FileText className="w-3.5 h-3.5 text-sky-400" />
          <span>Terms &amp; Conditions</span>
        </div>
        <h1>Terms of Service</h1>
        <p className="public-last-updated">Last Updated: September 2026 &bull; ChroniX Service Agreement</p>
      </section>

      {/* Legal Content Container */}
      <article className="public-content-card">
        <p>
          These Terms of Service govern your access to and use of <strong>ChroniX</strong> (<a href="https://chronix-ai.com" target="_blank" rel="noopener noreferrer">https://chronix-ai.com</a>).
          By accessing or using our platform, you agree to be bound by these terms.
        </p>

        <h2>1. Use of the Service</h2>
        <p>
          ChroniX provides interactive multi-lane historical timelines, visual comparisons, and AI-assisted historical research tools. You agree to use the service in compliance with all applicable laws, respect other users' rights, and refrain from any unauthorized scraping or abuse of platform APIs.
        </p>

        <h2>2. User Accounts</h2>
        <p>
          When creating an account via Google OAuth or email, you are responsible for maintaining the confidentiality of your account credentials and for all activities conducted under your account. You agree to notify us immediately of any unauthorized access to your account.
        </p>

        <h2>3. Intellectual Property</h2>
        <p>
          The ChroniX platform, including its software, interface design, algorithms, visual timelines, and brand assets, is the proprietary property of ChroniX and protected by applicable copyright and intellectual property laws. User-created timeline annotations, personal notes, and bookmarks remain the intellectual property of their respective creators.
        </p>

        <h2>4. Disclaimer of Warranties</h2>
        <p>
          Historical timelines, event data, and AI-generated summaries are provided for educational, academic, and personal research purposes. While we strive for historical accuracy and objectivity, ChroniX is provided on an "as is" and "as available" basis without warranties of any kind, whether express or implied.
        </p>

        <h2>5. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, ChroniX and its operators shall not be liable for any indirect, incidental, special, consequential, or punitive damages resulting from your access to or inability to access the service.
        </p>

        <h2>6. Contact Information</h2>
        <p>
          For questions or inquiries regarding these Terms of Service, please contact us at:
        </p>
        <p>
          <strong>Website:</strong> <a href="https://chronix-ai.com" target="_blank" rel="noopener noreferrer">https://chronix-ai.com</a><br />
          <strong>Email:</strong> chronix.ai.com@gmail.com
        </p>
      </article>
    </div>
  );
}

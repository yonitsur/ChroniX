import React from 'react';
import { Trophy, Star, Check, X, ArrowLeft, ArrowRight, Crosshair } from '../icons/ThemeIcons';
import { useLanguage } from '../../context/LanguageContext';
import { getTextDir } from '../../utils/textDirection';

/**
 * Shared presentation pieces for every timeline game so they share one
 * visual language (progress HUD, round feedback, results screen).
 */

export function formatPoints(value, lang) {
  try {
    return new Intl.NumberFormat(lang === 'he' ? 'he-IL' : 'en-US').format(Math.round(value || 0));
  } catch {
    return String(Math.round(value || 0));
  }
}

/**
 * Progress header: step label, live stats and one segment per round that is
 * tinted with the outcome of each finished round.
 * results[i]: 'correct' | 'partial' | 'wrong' | undefined
 */
export function GameHud({ label, stats = [], total = 0, current = 0, results = [] }) {
  return (
    <div className="game-hud">
      <div className="game-hud-row">
        <span className="game-hud-label">{label}</span>
        {stats.length > 0 && (
          <div className="game-hud-stats">
            {stats.map(({ key, Icon, text, tone }) => (
              <span key={key} className="game-stat" data-tone={tone || 'default'}>
                {Icon && <Icon aria-hidden="true" />}
                <span>{text}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      {total > 0 && (
        <ol className="game-hud-track" aria-hidden="true">
          {Array.from({ length: total }).map((_, idx) => (
            <li
              key={idx}
              data-state={results[idx] || (idx === current ? 'current' : 'pending')}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * Round outcome card shared by all games (same anatomy as the trivia
 * explanation card): status title, optional body, then "explore" + "next".
 */
export function RoundFeedback({
  tone = 'correct',
  Icon,
  title,
  children,
  onShowEvent,
  nextLabel,
  onNext,
  secondaryAction,
}) {
  const { t, isRtl } = useLanguage();
  const NextArrow = isRtl ? ArrowLeft : ArrowRight;
  return (
    <section className="quiz-feedback game-feedback quiz-enter" data-tone={tone} role="status">
      <div className="quiz-feedback-title">
        {Icon && <Icon aria-hidden="true" />}
        <h4>{title}</h4>
      </div>
      {children && <div className="game-feedback-body">{children}</div>}
      {(onShowEvent || onNext || secondaryAction) && (
        <div className="game-feedback-actions">
          {onShowEvent && (
            <button type="button" className="game-link-button" onClick={onShowEvent}>
              <Crosshair aria-hidden="true" />
              <span>{t('quiz.showOnTimeline')}</span>
            </button>
          )}
          <div className="game-feedback-actions-end">
            {secondaryAction}
            {onNext && (
              <button type="button" className="quiz-button quiz-button--primary" onClick={onNext}>
                <span>{nextLabel}</span>
                <NextArrow aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * End-of-game summary: score ring + stars, headline, recap list of every round
 * (each row jumps to its event on the timeline) and the replay actions.
 */
export function GameResults({
  ratio = 0,
  starCount = 0,
  title,
  subtitle,
  scoreValue,
  scoreSuffix,
  scoreCaption,
  recapTitle,
  recap = [],
  actions = [],
}) {
  const { t, isRtl } = useLanguage();
  const JumpArrow = isRtl ? ArrowLeft : ArrowRight;
  const clamped = Math.max(0, Math.min(1, ratio));
  return (
    <section className="quiz-results game-results quiz-enter">
      <span className="quiz-eyebrow">{t('quiz.completedEyebrow')}</span>
      <div className="quiz-result-ring" style={{ '--quiz-score-angle': `${clamped * 360}deg` }}>
        <div>
          <Trophy aria-hidden="true" />
          <strong>
            {scoreValue}
            {scoreSuffix && <span>{scoreSuffix}</span>}
          </strong>
          {scoreCaption && <span>{scoreCaption}</span>}
        </div>
      </div>
      <div className="quiz-stars" role="img" aria-label={t('quiz.starsEarned', { count: starCount, total: 3 })}>
        {[1, 2, 3].map((idx) => (
          <Star key={idx} aria-hidden="true" data-earned={idx <= starCount} />
        ))}
      </div>
      <h3>{title}</h3>
      {subtitle && <p className="quiz-description">{subtitle}</p>}

      {recap.length > 0 && (
        <div className="game-recap">
          {recapTitle && <h4 className="game-section-label">{recapTitle}</h4>}
          <ol className="game-recap-list">
            {recap.map((item) => {
              const content = (
                <>
                  <span className="game-recap-status" data-tone={item.tone || 'neutral'} aria-hidden="true">
                    {item.tone === 'correct' ? <Check /> : item.tone === 'wrong' ? <X /> : <span className="game-recap-dot" />}
                  </span>
                  <span className="game-recap-text">
                    <span className="game-recap-title" dir={getTextDir(item.title || '', isRtl)}>{item.title}</span>
                    {item.detail && <span className="game-recap-detail">{item.detail}</span>}
                  </span>
                  {item.meta != null && <span className="game-recap-meta">{item.meta}</span>}
                  {item.onClick && <JumpArrow className="game-recap-go" aria-hidden="true" />}
                </>
              );
              return (
                <li key={item.key}>
                  {item.onClick ? (
                    <button type="button" className="game-recap-row" onClick={item.onClick}>{content}</button>
                  ) : (
                    <div className="game-recap-row">{content}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {actions.length > 0 && (
        <div className="quiz-result-actions">
          {actions.map(({ key, label, Icon, onClick, variant = 'primary' }) => (
            <button key={key} type="button" className={`quiz-button quiz-button--${variant}`} onClick={onClick}>
              {Icon && <Icon aria-hidden="true" />}
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function starsForRatio(ratio, three = 0.85, two = 0.5) {
  if (ratio >= three) return 3;
  if (ratio >= two) return 2;
  return ratio > 0 ? 1 : 0;
}

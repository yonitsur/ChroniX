import React, { forwardRef } from 'react';
import {
  useIsToyTheme,
  Trophy,
  Puzzle,
  Compass,
  Copy,
  LayoutGrid,
  Layers,
  HelpCircle,
} from './ThemeIcons';

/**
 * Game icons for Classic Mode — "Editorial Tiles".
 *
 * Each game owns a flat, muted editorial color; the icon *is* the tile.
 * On it sits a bold glyph drawn only in ink (#141414) and paper (#fff) with a
 * 2px ink outline, so the set reads as one published product line in both
 * light and dark themes. Drawn on a 44×44 grid (the tile's native size).
 *
 * In Kids Mode (`useIsToyTheme() === true`) the playful toy icons are used.
 */
const INK = '#141414';
const PAPER = '#ffffff';

const GAME_TILE_COLORS = {
  trivia: '#E9C46A',
  puzzle: '#BBA9E4',
  timeGuesser: '#9FCDB5',
  memory: '#F1AA90',
  wordle: '#A3C6EA',
  sequence: '#E8D3A0',
  whoAmI: '#B3BDCB',
};

function createGameEmblem(ToyIconComponent, tileColor, renderGlyph, displayName) {
  const Component = forwardRef(function GameEmblemIcon(
    { className = '', size, style, ...rest },
    ref
  ) {
    const isToy = useIsToyTheme();
    if (isToy) {
      return (
        <ToyIconComponent
          ref={ref}
          className={className}
          size={size}
          style={style}
          {...rest}
        />
      );
    }

    const sizeProps = size ? { width: size, height: size } : {};

    return (
      <svg
        ref={ref}
        viewBox="0 0 44 44"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`${className} chronix-game-emblem`.trim()}
        style={style}
        aria-hidden="true"
        {...sizeProps}
        {...rest}
      >
        <rect width="44" height="44" rx="10" fill={tileColor} />
        <g stroke={INK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {renderGlyph()}
        </g>
      </svg>
    );
  });
  Component.displayName = displayName;
  return Component;
}

export const GameTriviaIcon = createGameEmblem(
  Trophy,
  GAME_TILE_COLORS.trivia,
  () => (
    <>
      <path d="M15 13.5h-2.5a2.5 2.5 0 0 0-2.5 2.5v.5a4.5 4.5 0 0 0 4.5 4.5h1M29 13.5h2.5a2.5 2.5 0 0 1 2.5 2.5v.5a4.5 4.5 0 0 1-4.5 4.5h-1" />
      <path d="M15 11h14v7a7 7 0 0 1-14 0Z" fill={PAPER} />
      <path d="M22 25v4" />
      <rect x="16.5" y="29" width="11" height="4.5" rx="1.5" fill={INK} />
      <path
        d="M22 14.3l.79 2.11 2.25.1-1.76 1.41.6 2.17L22 18.85l-1.88 1.24.6-2.17-1.76-1.41 2.25-.1Z"
        fill={INK}
        stroke="none"
      />
    </>
  ),
  'GameTriviaIcon'
);

export const GamePuzzleIcon = createGameEmblem(
  Puzzle,
  GAME_TILE_COLORS.puzzle,
  () => (
    <path
      d="M13.5 14h6a3 3 0 1 1 5.5 0h5.5v6a3 3 0 1 1 0 5.5V31H13.5v-5.5a3 3 0 1 0 0-5.5Z"
      fill={PAPER}
    />
  ),
  'GamePuzzleIcon'
);

export const GameTimeGuesserIcon = createGameEmblem(
  Compass,
  GAME_TILE_COLORS.timeGuesser,
  () => (
    <>
      <path
        d="M22 34.5s-8.5-6.8-8.5-13.75a8.5 8.5 0 0 1 17 0c0 6.95-8.5 13.75-8.5 13.75Z"
        fill={PAPER}
      />
      <path d="M22 16.75v4l2.75 1.75" />
    </>
  ),
  'GameTimeGuesserIcon'
);

export const GameMemoryIcon = createGameEmblem(
  Copy,
  GAME_TILE_COLORS.memory,
  () => (
    <>
      <rect x="10.5" y="12" width="10" height="20" rx="2.5" fill={PAPER} />
      <rect x="23.5" y="12" width="10" height="20" rx="2.5" fill={INK} />
      <path d="M15.5 18.5l3 3.5-3 3.5-3-3.5Z" fill={INK} stroke="none" />
      <path d="M28.5 18.5l3 3.5-3 3.5-3-3.5Z" fill={PAPER} stroke="none" />
    </>
  ),
  'GameMemoryIcon'
);

export const GameWordleIcon = createGameEmblem(
  LayoutGrid,
  GAME_TILE_COLORS.wordle,
  () => (
    <>
      <rect x="11.25" y="11.25" width="9.5" height="9.5" rx="2" fill={INK} />
      <rect x="23.25" y="11.25" width="9.5" height="9.5" rx="2" fill={PAPER} />
      <rect x="11.25" y="23.25" width="9.5" height="9.5" rx="2" fill={PAPER} />
      <rect x="23.25" y="23.25" width="9.5" height="9.5" rx="2" fill={PAPER} />
      <circle cx="28" cy="16" r="1.6" fill={INK} stroke="none" />
    </>
  ),
  'GameWordleIcon'
);

export const GameSequenceIcon = createGameEmblem(
  Layers,
  GAME_TILE_COLORS.sequence,
  () => (
    <>
      <path d="M13.5 10.5v23" />
      <rect x="17" y="10.5" width="14" height="5.5" rx="2.75" fill={PAPER} />
      <rect x="20" y="19.25" width="14" height="5.5" rx="2.75" fill={INK} />
      <rect x="17" y="28" width="10" height="5.5" rx="2.75" fill={PAPER} />
    </>
  ),
  'GameSequenceIcon'
);

export const GameWhoAmIIcon = createGameEmblem(
  HelpCircle,
  GAME_TILE_COLORS.whoAmI,
  () => (
    <>
      <circle cx="20" cy="20" r="8.5" fill={PAPER} />
      <path d="M26.4 26.4 33 33" strokeWidth="3.25" />
      <path d="M17.6 17.7a2.4 2.4 0 1 1 3.35 2.2c-.55.25-.95.7-.95 1.3v.4" />
      <circle cx="20" cy="24.3" r="1.25" fill={INK} stroke="none" />
    </>
  ),
  'GameWhoAmIIcon'
);

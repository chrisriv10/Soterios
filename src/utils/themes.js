'use strict';

/**
 * Shared UI theme catalog — splash window background colors and toast accents.
 * Keep names aligned with `data-theme` values in style.css / settings.
 */

const THEME_BACKGROUNDS = {
  dark: '#0B0E14',
  light: '#f5f7fb',
  ocean: '#081727',
  emerald: '#0c3024',
  sunset: '#1c1214',
  violet: '#231836',
  crimson: '#0c0405',
  terminal: '#050c07',
  midnight: '#0a0e1a',
  bumblebee: '#0c0b08',
  monochrome: '#0a0a0a',
  rose: '#1a1216',
  aurora: '#0b1220',
};

const TOAST_THEMES = {
  dark: {
    bg: 'rgba(20, 26, 33, 0.97)',
    border: 'rgba(255,255,255,0.08)',
    textMain: '#f2f5f8',
    textMuted: '#aab4bf',
    textDim: '#7d8a99',
    closeBtn: '#5b6672',
    closeHover: '#aab4bf',
    accents: { info: '#4fc3d9', success: '#3ddc97', warn: '#e8b339', danger: '#e85f5c' },
  },
  light: {
    bg: 'rgba(248, 250, 252, 0.98)',
    border: 'rgba(15, 23, 42, 0.1)',
    textMain: '#0f172a',
    textMuted: '#475569',
    textDim: '#94a3b8',
    closeBtn: '#94a3b8',
    closeHover: '#64748b',
    accents: { info: '#2563eb', success: '#16a34a', warn: '#d97706', danger: '#dc2626' },
  },
  ocean: {
    bg: 'rgba(8, 23, 39, 0.95)',
    border: 'rgba(125, 211, 252, 0.16)',
    textMain: '#ecfeff',
    textMuted: '#7dd3fc',
    textDim: '#5bb8e0',
    closeBtn: '#5bb8e0',
    closeHover: '#7dd3fc',
    accents: { info: '#2dd4bf', success: '#34d399', warn: '#f59e0b', danger: '#fb7185' },
  },
  emerald: {
    bg: 'rgba(12, 48, 36, 0.95)',
    border: 'rgba(134, 239, 172, 0.28)',
    textMain: '#eafff0',
    textMuted: '#9ff5bf',
    textDim: '#7ddb9f',
    closeBtn: '#7ddb9f',
    closeHover: '#9ff5bf',
    accents: { info: '#32e06f', success: '#5ff08f', warn: '#fcd34d', danger: '#ff8fa0' },
  },
  sunset: {
    bg: 'rgba(46, 24, 27, 0.95)',
    border: 'rgba(251, 191, 36, 0.16)',
    textMain: '#fff7ed',
    textMuted: '#fdba74',
    textDim: '#f59e6b',
    closeBtn: '#f59e6b',
    closeHover: '#fdba74',
    accents: { info: '#f97316', success: '#fb923c', warn: '#facc15', danger: '#f43f5e' },
  },
  violet: {
    bg: 'rgba(35, 24, 54, 0.95)',
    border: 'rgba(192, 132, 252, 0.18)',
    textMain: '#f5f3ff',
    textMuted: '#d8b4fe',
    textDim: '#c094e0',
    closeBtn: '#c094e0',
    closeHover: '#d8b4fe',
    accents: { info: '#8b5cf6', success: '#a78bfa', warn: '#f59e0b', danger: '#fb7185' },
  },
  crimson: {
    bg: 'rgba(12, 4, 5, 0.96)',
    border: 'rgba(220, 38, 38, 0.22)',
    textMain: '#fef2f2',
    textMuted: '#fca5a5',
    textDim: '#e08080',
    closeBtn: '#e08080',
    closeHover: '#fca5a5',
    accents: { info: '#dc2626', success: '#f87171', warn: '#fb923c', danger: '#b91c1c' },
  },
  terminal: {
    bg: 'rgba(5, 12, 7, 0.97)',
    border: 'rgba(0, 255, 170, 0.18)',
    textMain: '#e9ffee',
    textMuted: '#8af5c0',
    textDim: '#60d9a0',
    closeBtn: '#60d9a0',
    closeHover: '#8af5c0',
    accents: { info: '#16a34a', success: '#4ade80', warn: '#a3e635', danger: '#f87171' },
  },
  midnight: {
    bg: 'rgba(10, 14, 26, 0.97)',
    border: 'rgba(96, 165, 250, 0.18)',
    textMain: '#e8edf5',
    textMuted: '#94a3c4',
    textDim: '#64748b',
    closeBtn: '#64748b',
    closeHover: '#94a3c4',
    accents: { info: '#38bdf8', success: '#2dd4bf', warn: '#fbbf24', danger: '#f87171' },
  },
  bumblebee: {
    bg: 'rgba(12, 11, 8, 0.97)',
    border: 'rgba(250, 204, 21, 0.22)',
    textMain: '#fefce8',
    textMuted: '#ca8a04',
    textDim: '#a16207',
    closeBtn: '#a16207',
    closeHover: '#ca8a04',
    accents: { info: '#facc15', success: '#84cc16', warn: '#f59e0b', danger: '#ef4444' },
  },
  monochrome: {
    bg: 'rgba(10, 10, 10, 0.97)',
    border: 'rgba(255, 255, 255, 0.1)',
    textMain: '#f5f5f5',
    textMuted: '#a3a3a3',
    textDim: '#737373',
    closeBtn: '#737373',
    closeHover: '#a3a3a3',
    accents: { info: '#e5e5e5', success: '#d4d4d4', warn: '#a3a3a3', danger: '#737373' },
  },
  rose: {
    bg: 'rgba(26, 18, 22, 0.97)',
    border: 'rgba(244, 114, 182, 0.18)',
    textMain: '#fdf2f8',
    textMuted: '#f9a8d4',
    textDim: '#db2777',
    closeBtn: '#db2777',
    closeHover: '#f9a8d4',
    accents: { info: '#f472b6', success: '#6ee7b7', warn: '#fbbf24', danger: '#e11d48' },
  },
  aurora: {
    bg: 'rgba(20, 30, 50, 0.96)',
    border: 'rgba(125, 211, 252, 0.18)',
    textMain: '#e0faff',
    textMuted: '#94a3b8',
    textDim: '#7dd3fc',
    closeBtn: '#7dd3fc',
    closeHover: '#e0faff',
    accents: { info: '#7dd3fc', success: '#3ddc97', warn: '#fbbf24', danger: '#fb7185' },
  },
};

/**
 * Resolves a theme name to a canonical catalog key.
 *
 * Unknown names fall back to `dark`. Legacy aliases `black-red` and
 * `black-green` are mapped to `crimson` and `terminal` respectively.
 *
 * @param {string} name - Raw theme name.
 * @returns {string} Canonical theme key.
 */
function resolveThemeName(name) {
  const key = String(name || 'dark').toLowerCase();
  if (THEME_BACKGROUNDS[key]) return key;
  if (key === 'black-red') return 'crimson';
  if (key === 'black-green') return 'terminal';
  return 'dark';
}

/**
 * Returns the background color for a theme.
 *
 * @param {string} name - Raw theme name.
 * @returns {string} Background color hex value.
 */
function themeBackground(name) {
  return THEME_BACKGROUNDS[resolveThemeName(name)] || THEME_BACKGROUNDS.dark;
}

module.exports = {
  THEME_BACKGROUNDS,
  TOAST_THEMES,
  resolveThemeName,
  themeBackground,
};

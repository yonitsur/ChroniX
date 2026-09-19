// Step definitions for the timeline-screen interactive guide (InteractiveGuide.jsx).
//
// Each step carries a stable `key` (used for i18n lookup under `tour.steps.<key>`),
// the DOM target to spotlight (an element id, or a function returning an element so
// we can pick whichever variant is currently visible), a preferred placement, and
// optional lifecycle hooks. Steps marked `optional` are silently skipped when their
// target is absent (e.g. the Filter button only exists once a timeline has 2+ groups).

// Helper to find the visible instance among multiple responsive elements
const getVisibleElement = (selector) => {
  const els = Array.from(document.querySelectorAll(selector));
  return (
    els.find((el) => {
      const r = el.getBoundingClientRect();
      return (r.width > 0 || r.height > 0) && window.getComputedStyle(el).display !== 'none';
    }) || els[0] || null
  );
};

// Target for the chat step: either the floating bubble or the open panel.
const chatTarget = () =>
  getVisibleElement('#guide-chat-bubble, [data-guide="chat-bubble"]') ||
  getVisibleElement('#guide-chat-panel, [data-guide="chat-panel"]');

// Target for the main menu / more actions trigger button
const moreActionsTarget = () =>
  getVisibleElement('#guide-more-actions, [data-guide="more-actions"]');

// Target for the Saved Timelines row in the actions menu (falls back to the user menu button on timeline view)
const savedTarget = () =>
  getVisibleElement('#guide-menu-saved, [data-guide="menu-saved"]') ||
  moreActionsTarget();

// Strict targets for the home screen (do not fall back to moreActionsTarget, so we wait for the menu to open)
const homeSavedTarget = () =>
  getVisibleElement('#guide-menu-saved, [data-guide="menu-saved"]');

const homeQuotaTarget = () =>
  getVisibleElement('#guide-menu-quota, [data-guide="menu-quota"]') ||
  getVisibleElement('#guide-menu-api-key, [data-guide="menu-api-key"]');

// Target for the home screen grounding toggle (Fast / Web Search)
const homeGroundingTarget = () =>
  getVisibleElement('#guide-home-grounding, [data-guide="home-grounding"]');

// Check if user menu is open on the home screen
const isHomeMenuOpen = () => {
  const el = getVisibleElement('#guide-menu-saved, [data-guide="menu-saved"], #guide-menu-quota, [data-guide="menu-quota"]');
  return !!(el && el.getBoundingClientRect().width > 0);
};

// Open the actions menu on the home screen
export const openHomeMenu = () => {
  if (isHomeMenuOpen()) return;
  const btn = moreActionsTarget();
  btn?.click();
};

// Close it again when leaving the menu-related steps
export const closeHomeMenu = () => {
  if (isHomeMenuOpen()) {
    const btn = moreActionsTarget();
    btn?.click();
  }
};

// Open the actions menu so the Saved Timelines row can be highlighted.
const openMoreMenu = () => {
  const target = savedTarget();
  if (target && target.getBoundingClientRect().width > 0) return;

  // If mobile dock is collapsed, expand it first
  const expandBtn = document.querySelector(
    '#chronix-mobile-dock button[title*="Expand"], #chronix-mobile-dock button[aria-label*="Expand"], #chronix-mobile-dock button[title*="הרחב"], #chronix-mobile-dock button[aria-label*="הרחב"]'
  );
  if (expandBtn && expandBtn.offsetWidth > 0) {
    expandBtn.click();
  }

  const btn = moreActionsTarget();
  btn?.click();
};

// Close it again when leaving the step.
const closeMoreMenu = () => {
  const target = savedTarget();
  if (target && target.getBoundingClientRect().width > 0) {
    const btn = moreActionsTarget();
    btn?.click();
  }
};

/**
 * Build the ordered list of resolved guide steps for the timeline view.
 * Filters out steps that target controls not present or hidden in the current view.
 * @param {(path: string, params?: object) => string} t translation helper
 */
export function buildGuideSteps(t) {
  const step = (key, extra = {}) => ({
    key,
    title: t(`tour.steps.${key}.title`),
    body: t(`tour.steps.${key}.body`),
    ...extra,
  });

  const allSteps = [
    step('welcome', { target: moreActionsTarget, placement: 'right', optional: true }),
    step('chat', { target: chatTarget, placement: 'left', optional: true }),
    step('filter', { target: 'guide-dock-filter', placement: 'right', optional: true }),
    step('explore', { target: 'guide-dock-explore', placement: 'right', optional: true }),
    step('saved', {
      target: savedTarget,
      placement: 'right',
      beforeShow: openMoreMenu,
      afterHide: closeMoreMenu,
    }),
  ];

  return allSteps;
}

/**
 * Build the ordered list of 3 resolved guide steps for the home screen.
 * 1. Fast / Web Search grounding toggle (PromptBar)
 * 2. Saved timelines (in user menu, with note that cloud save is for registered accounts)
 * 3. Fast AI actions quota and custom API key settings (in user menu)
 * @param {(path: string, params?: object) => string} t translation helper
 */
export function buildHomeGuideSteps(t) {
  const step = (key, extra = {}) => ({
    key,
    title: t(`tour.homeSteps.${key}.title`),
    body: t(`tour.homeSteps.${key}.body`),
    ...extra,
  });

  return [
    step('grounding', {
      target: homeGroundingTarget,
      placement: 'bottom',
      beforeShow: closeHomeMenu,
    }),
    step('saved', {
      target: homeSavedTarget,
      placement: 'bottom',
      beforeShow: openHomeMenu,
    }),
    step('quickAi', {
      target: homeQuotaTarget,
      placement: 'bottom',
      beforeShow: openHomeMenu,
      afterHide: closeHomeMenu,
    }),
  ];
}

export const userGuideEn = {
  getting_started: {
    welcomeTitle: 'Welcome to ChroniX',
    welcomeDesc: 'ChroniX transforms any topic into an interactive visual timeline powered by Google Gemini, HistropediaJS, and verified Wikimedia imagery. Built for interactive inquiry, it empowers you to ask exploratory questions, test historical perspectives, and uncover connections across time.',
    exploreBtn: 'Explore Examples',
    navHeading: '1. Navigating the Canvas',
    zoomTitle: 'Fluid Multi-Scale Zoom',
    zoomDesc: 'Scroll or pinch to zoom smoothly from millions of years down to single days.',
    panTitle: 'Pan Across Time',
    panDesc: 'Click and drag anywhere on the canvas background to move forward or backward.',
    fitAllTitle: 'Fit All Articles',
    fitAllDesc: 'Click "Fit All" on the toolbar anytime to center the full timeline at a glance.',
    inspectHeading: '2. Inspecting Events & Drawers',
    eventDrawerTitle: 'Event Details Drawer',
    eventDrawerDesc: 'Click any card to view photos, verified dates, Wikipedia extracts, and editing tools.',
    cardsDrawerTitle: 'Cards List Drawer',
    cardsDrawerDesc: 'Open the searchable chronological list of events grouped by lanes with quick jump-to-event.',
    starTitle: 'Starring Favorites',
    starDesc: 'Click the star icon on any card to highlight key events and keep them visible even when zoomed far out.',
    exploreTitle: 'Guided Exploration Mode',
    exploreDesc: 'Launch a step-by-step tour that glides through events one at a time, automatically pairing the map and timeline in split-screen for an interactive chronological-geographic journey through both time and place.',
    stopGenTitle: 'Cancel Generation:',
    stopGenDesc: 'Press Esc or click "Stop generate" in the bottom status pill anytime.'
  },
  prompt_mastery: {
    title: 'Prompt Crafting Guide',
    subtitle: 'A few simple words are enough. Here is how to achieve the exact depth and layout you want.',
    detailHeading: '1. Choosing Detail Level',
    levels: {
      overview: {
        name: 'Overview',
        count: '~10–15 events',
        bestFor: 'A clean bird’s-eye view of key milestones or focused short-span events.',
        example: '"American Revolution Overview" or "Ancient Egypt Overview"'
      },
      standard: {
        name: 'Standard (Recommended)',
        count: '~20–30 events',
        bestFor: 'Balanced depth and narrative flow for complete historical eras and biographies.',
        example: '"Ancient Rome: Republic to Empire" or "The Space Race: NASA vs. USSR"'
      },
      deep_dive: {
        name: 'Deep Dive',
        count: '~35–50 events',
        bestFor: 'Granular step-by-step history and complex multi-lane timelines.',
        example: '"World War II, divide into parallel lanes: European Theater vs. Pacific Theater"'
      }
    },
    swimlanesHeading: '2. Parallel Swimlanes',
    swimlanesDesc: 'Explicitly ask to divide the timeline into parallel swimlanes:',
    swimlanesExamples: [
      {
        title: 'Opposing Sides:',
        desc: '"Divide into parallel lanes: Soviet Space Program vs. NASA"'
      },
      {
        title: 'Thematic Tracks:',
        desc: '"Divide into parallel lanes: Inventions, Transport, and Labor Movements"'
      },
      {
        title: 'Biographical Tracks:',
        desc: '"Divide into parallel lanes: Scientific Breakthroughs vs. Personal Life & Public Impact"'
      }
    ],
    topicSplitHeading: '3. Divide into Themes or Topics',
    topicSplitDesc: 'Explicitly ask to divide one timeline by subject:',
    topicSplitExamples: [
      {
        title: 'Historical Themes:',
        desc: '"Divide into themes: Politics, Military, and Culture"'
      },
      {
        title: 'Life Topics:',
        desc: '"Divide into topics: Education, Career, and Family Milestones"'
      }
    ],
    themesHeading: '4. Automatic Color Themes',
    themesTitle: 'Color-Coded Themes & Floating Legend',
    themesDesc: 'In single timelines, events are automatically colored by theme (Politics, Science, Culture) with a draggable filter legend.',
    framingHeading: '5. Prompt Framing: Simple vs. Detailed',
    conciseTitle: 'Natural & Short: Let AI Explore',
    conciseDesc: 'Prompts like "Evolution of the horse" or "Industrial Revolution" let the AI discover key milestones automatically—no jargon required.',
    detailedTitle: 'Structured: Focus on Specific Angles',
    detailedDesc: 'Guide the AI explicitly when you want a narrow angle (e.g. "French Revolution from 1789 to 1799").',
    narrativeHeading: '6. Build a Narrative, Not Just a List',
    narrativeTitle: 'Connect Causes, Turning Points, and Consequences',
    narrativeDesc: 'Frame the prompt as a story of change: name the starting condition, the transformation you want to follow, the internal and external forces at work, and the final outcome. This produces a timeline with a clear causal arc rather than disconnected milestones.',
    narrativeExample: '"How did a prosperous republic become an empire, and how did internal corruption and external invasions lead to its collapse?"',
    multilingualHeading: '7. Multilingual Prompts',
    multilingualTitle: 'Write in Any Language',
    multilingualDesc: 'ChroniX works in virtually any language (English, Spanish, French, German, etc.). Milestones and Wikipedia links match the language of your prompt.'
  },
  personal_timelines: {
    title: 'Personal Timelines & Life Stories',
    subtitle: 'Craft memoirs, family histories, and personal milestones with complete manual privacy or creative AI drafting.',
    manualHeading: '1. Manual Canvas: "Build Your Own Timeline"',
    manualDesc: 'Create a custom timeline from scratch without involving AI. Ideal for sensitive family history and private memories.',
    manualCards: [
      {
        title: 'Blank Canvas',
        desc: 'Start completely empty and author every single milestone, date, and description yourself.'
      },
      {
        title: 'Starter Templates',
        desc: 'Choose from "Family Story", "A Life Story", or "Family Tree" to begin with pre-structured milestone cards ready to replace.'
      },
      {
        title: 'Custom Topics (Swimlanes)',
        desc: 'Organize personal journeys into parallel tracks like "Education", "Career", "Family", and "Travel".'
      }
    ],
    aiScaffoldHeading: '2. AI Creative Drafting: The "Grandpa\'s Story" Technique',
    aiScaffoldDesc: 'Not sure where to begin? Overcome the blank page by letting Gemini generate a complete, plausible narrative arc to edit and adapt.',
    aiScaffoldPromptTitle: 'Try This Starter Prompt:',
    aiScaffoldPrompt: 'The life story of a grandfather who was born in Baghdad, studied at the University of Paris, and worked as an electrical engineer',
    aiScaffoldTipTitle: 'How the "Draft & Refine" Workflow Works:',
    aiScaffoldTipDesc: 'Gemini invents a rich, chronologically sequenced storyline across the lifespan (childhood, studies in France, career achievements, family milestones). You then simply edit real dates, delete fictional events, add missing family anecdotes, and attach photos.',
    stepsHeading: '3. Suggested 5-Step Workflow',
    steps: [
      {
        title: '1. Draft or Template',
        desc: 'Prompt Gemini with a few anchor facts, or start from a clean starter template.'
      },
      {
        title: '2. Prune Fictional Events',
        desc: 'Delete generated events that don\'t match your family\'s true story.'
      },
      {
        title: '3. Edit & Correct Facts',
        desc: 'Click any card in the Event Drawer to update exact dates, locations, and details.'
      },
      {
        title: '4. Add Personal Anecdotes & Photos',
        desc: 'Click + to insert cherished family memories and link custom photos.'
      },
      {
        title: '5. Map the Family Journey',
        desc: 'Add coordinates to trace family migrations (e.g. Baghdad to Paris) on the synced world map.'
      }
    ]
  },
  grounding: {
    title: 'Fast vs. Verified Modes (Google Grounding)',
    subtitle: 'Generate timelines with live Google Search fact-checking by default, or flip to Fast mode for rapid generation from internal model knowledge.',
    howItWorksHeading: '1. How Fast & Verified Modes Work',
    howItWorksTitle: 'Internal Model Knowledge vs. Live Web Research',
    howItWorksDesc: 'By default, Verified mode executes real-time Google searches to verify facts, discover breaking milestones, and corroborate exact day/month/year dates before generating the timeline or answering in chat. When Fast mode is selected, web search is skipped and Gemini generates timelines in ~2–3 seconds using internal model knowledge.',
    toggleHeading: '2. Simple Fast / Verified Toggle',
    toggleTitle: 'One-Click Control with Automatic Persistence',
    toggleDesc: 'Click the Fast / Verified toggle in the search bar or timeline chat anytime to switch modes. Verified mode is active by default; your choice is remembered across sessions.',
    featuresHeading: '3. Key Benefits of Grounded Timelines',
    cards: [
      {
        title: 'Live & Breaking Events',
        desc: 'Build timelines for events that happened this year, this month, or this week without being constrained by static AI training data cutoffs.'
      },
      {
        title: 'Verified Date Accuracy',
        desc: 'Cross-checks complex dates, battles, treaties, launches, and tenures against primary sources to minimize historical hallucination.'
      },
      {
        title: 'Direct Source Links & Queries',
        desc: 'Inspect exact Google search queries and jump to verified web sources and articles directly from the Event Details Drawer.'
      }
    ],
    tradeoffsHeading: '4. When to Use It (Trade-Offs)',
    modes: [
      {
        title: 'Verified Mode (Default / Grounded)',
        desc: 'Active by default. Recommended for modern history, recent science & space exploration, tech releases, and exact date verification. Uses live web sources.'
      },
      {
        title: 'Fast Mode (Rapid / Parametric)',
        desc: 'Best for ancient history, literature, mythology, and fictional universes (Tolkien, Marvel). Delivers lightning-fast results in 2–3 seconds without web queries.'
      }
    ]
  },
  prompt_showcase: {
    title: 'Curated Prompt Showcase',
    subtitle: 'Explore recommended prompts, including narrative questions that connect causes, turning points, and outcomes. Click Try Now ↗ to begin!',
    tryNow: 'Try Now',
    copyPrompt: 'Copy Prompt',
    copied: 'Copied!',
    whyItWorksLabel: 'Why it works:',
    detailLevels: {
      overview: 'Overview',
      standard: 'Standard',
      deep_dive: 'Deep Dive'
    }
  },
  event_editing: {
    title: 'Editing & Adding Events',
    subtitle: 'Full control to customize, edit, or add events with AI assistance, AI retouching, and Wikipedia search.',
    cards: [
      {
        title: 'Edit & Customize Any Event',
        desc: 'Click on any event or its edit icon to change its title, dates, description, photo/media URL, or delete it completely.'
      },
      {
        title: 'Gemini AI Auto-Fill',
        desc: 'Type an event title and click AI Auto-Fill to automatically fetch dates, summaries, and coordinates.'
      },
      {
        title: 'Wikipedia Search',
        desc: 'Search Wikipedia directly to pull verified photography and encyclopedic article summaries.'
      },
      {
        title: 'Add Custom Event (+)',
        desc: 'Click + in the toolbar, or simply ask the AI chat, to add any milestone to existing swimlanes or create brand new lanes on the fly.'
      }
    ],
    geoCoordsTitle: 'Geographic Coordinates & Location',
    geoCoordsDesc: 'Add or update a location name and latitude/longitude coordinates in the event editor to place an interactive pin on the world map.'
  },
  ai_refine: {
    title: 'Discuss & Edit with AI Chat',
    subtitle: 'Open "Talk to your timeline" — the floating chat bubble in the bottom-right corner — for a real conversation about your timeline. Ask follow-up questions to explore deeper, or ask the AI to change it: add, remove, split into lanes, rename, or polish events. The timeline updates live, and every AI edit has one-step Undo.',
    splitTipTitle: 'Ask or act — in one conversation',
    splitTipDesc: 'Type a question for an answer, or a request ("Split into Politics and Culture") to reshape the timeline. Flip the Fast/Verified pill in the chat header (Verified is default) to trade speed for depth, and use "Discuss this event" from any event drawer to ask about a specific card.',
    examplesHeading: 'Things you can ask the chat:',
    prompts: [
      {
        label: 'Split into parallel thematic paths:',
        prompt: '"Split the timeline into three parallel paths: Politics, Science, and Culture"'
      },
      {
        label: 'Divide by geographic theaters:',
        prompt: '"Divide the events into two timelines: European Theater and Pacific Theater"'
      },
      {
        label: 'Separate opposing sides:',
        prompt: '"Restructure the events into two parallel tracks: United States vs. Soviet Union"'
      },
      {
        label: 'Add, remove, or edit themes:',
        prompt: '"Add a \'Diplomacy\' theme, remove the \'Culture\' theme, and rename \'Science\' to \'Science & Technology\'"'
      },
      {
        label: 'Expand a sub-period:',
        prompt: '"Add 5 more key battles between 1942 and 1943"'
      },
      {
        label: 'Highlight scientific breakthroughs:',
        prompt: '"Add key scientific inventions and technological discoveries from this era"'
      }
    ]
  },
  geo_map: {
    title: 'Synchronized World Map',
    subtitle: 'Explore where history happened on an interactive map synchronized live with the timeline.',
    modesHeading: '4 Map Display Modes:',
    modes: [
      {
        title: '1. Floating Globe',
        desc: 'Draggable globe button showing mapped events count. Click to open PiP or Split view.'
      },
      {
        title: '2. Picture-in-Picture',
        desc: 'Compact floating map overlaid on the canvas. Drag by header or resize from corners.'
      },
      {
        title: '3. Resizable Split Screen',
        desc: 'Map on top, timeline on bottom. Drag the divider to adjust the height ratio.'
      },
      {
        title: '4. Fullscreen Map',
        desc: 'Expands across the entire screen for a comprehensive spatial overview.'
      }
    ],
    syncHeading: 'Bi-Directional Synchronization',
    syncPoints: [
      'Timeline to Map: Clicking an event card flies the map camera directly to its geographic pin.',
      'Map to Timeline: Clicking a map marker highlights the event and centers the timeline canvas.',
      'Color Coding: Map pins match each event’s swimlane color for instant visual clarity.'
    ]
  },
  export_saving: {
    title: 'Export & Cloud Saving',
    subtitle: 'Save your work, export presentation snapshots, or share timeline datasets.',
    cards: [
      {
        title: 'Snapshot Image (PNG)',
        desc: 'Download a crisp, high-resolution image of your timeline canvas from More Actions.'
      },
      {
        title: 'JSON Export & Import',
        desc: 'Export the complete dataset as JSON or import previously saved timeline files.'
      },
      {
        title: 'Cloud Saved Timelines',
        desc: 'Timelines automatically save to your personal cloud library in Supabase for access anywhere.'
      }
    ],
    disclaimerTitle: 'AI Accuracy Notice',
    disclaimerDesc: 'Events are AI-generated and Wikipedia-enriched. While reliable, ancient dates may be approximations. You can always edit and verify any event.'
  },
  footer: {
    tagline: 'ChroniX User Guide • Built for curious minds, researchers & educators.',
    closeBtn: 'Close Guide'
  }
};

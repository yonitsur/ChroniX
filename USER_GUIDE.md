# ChroniX User Guide
### *Mastering AI-Powered Visual Chronologies, Spatial Maps & Historical Exploration*

> **Looking for installation, system architecture, or developer setup instructions?**  
> Check out the [ChroniX Installation & Developer Guide (README.md)](README.md).

---

## Table of Contents

1. [Introduction to ChroniX](#introduction-to-chronix)
2. [Getting Started & Canvas Navigation](#1-getting-started--canvas-navigation)
   - [Canvas Navigation (Zoom & Pan)](#canvas-navigation-zoom--pan)
   - [Toolbar Quick Actions & "Fit All"](#toolbar-quick-actions--fit-all)
   - [Event Details Drawer](#event-details-drawer)
   - [Starring & Bookmarking Events](#starring--bookmarking-events)
   - [Cards List Explorer Drawer](#cards-list-explorer-drawer)
   - [Canceling Generation](#canceling-generation)
3. [Prompt Mastery & Timeline Architecture](#2-prompt-mastery--timeline-architecture)
   - [Detail Levels (Overview, Standard, Deep Dive)](#detail-levels)
   - [Parallel Swimlanes (Horizontal Thematic Tracks)](#parallel-swimlanes-horizontal-thematic-tracks)
   - [Thematic Color-Coding in Single Timelines](#thematic-color-coding-in-single-timelines)
   - [Prompt Framing: Concise vs. Structured](#prompt-framing-concise-vs-structured)
   - [Multilingual Support: Prompt Language vs. UI Language](#multilingual-support-prompt-language-vs-ui-language)
4. [Curated Prompt Showcase](#3-curated-prompt-showcase)
   - [Science & Space](#science--space)
   - [Modern History](#modern-history)
   - [Israel & Jewish History](#israel--jewish-history)
   - [Ancient Civilizations](#ancient-civilizations)
   - [Prehistory & Nature](#prehistory--nature)
   - [Culture & Lore](#culture--lore)
5. [Event Editing & Manual Timeline Studio](#4-event-editing--manual-timeline-studio)
   - [Gemini AI Auto-Fill](#gemini-ai-auto-fill)
   - [Wikipedia Candidate Disambiguation Picker](#wikipedia-candidate-disambiguation-picker)
   - [Adding Custom Events (+) & New Swimlanes](#adding-custom-events---new-swimlanes)
   - [Geographic Coordinates & Map Pinning](#geographic-coordinates--map-pinning)
6. [AI Refine System (Iterative Expansion & Splitting)](#5-ai-refine-system-iterative-expansion--splitting)
   - [Splitting into Multiple Parallel Paths & Theaters](#splitting-into-multiple-parallel-paths--theaters)
   - [Expanding Sub-Eras & Adding Historical Context](#expanding-sub-eras--adding-historical-context)
   - [Refinement Prompt Cheat-Sheet](#refinement-prompt-cheat-sheet)
7. [Synchronized Geographic World Map (Leaflet)](#6-synchronized-geographic-world-map-leaflet)
   - [The 4 Map Display Modes](#the-4-map-display-modes)
   - [Bi-Directional Synchronization](#bi-directional-synchronization)
   - [Swimlane Color-Coded Markers](#swimlane-color-coded-markers)
8. [Exporting, Cloud Saving & Settings](#7-exporting-cloud-saving--settings)
   - [Snapshot Image Export (PNG)](#snapshot-image-export-png)
   - [Data Export & Import (JSON)](#data-export--import-json)
   - [Supabase Cloud Library](#supabase-cloud-library)
   - [AI Accuracy Notice & Best Practices](#ai-accuracy-notice--best-practices)

---

## Introduction to ChroniX

**ChroniX** transforms natural language topics into interactive visual chronologies. By combining **Google Gemini (`gemini-2.5-flash`)**, **HistropediaJS**, **Leaflet**, and verified media from the **Wikipedia REST API** and **Wikimedia Commons**, ChroniX allows you to explore any story across **both Time and Space**.

Whether you are exploring deep geological eras, multi-theater global conflicts, technological revolutions, or literary sagas, ChroniX provides an encyclopedic, multi-scale canvas with synchronized geographic mapping.

---

## 1. Getting Started & Canvas Navigation

### Canvas Navigation (Zoom & Pan)
The timeline canvas is powered by HistropediaJS and supports multi-scale chronological zooming:
- **Zoom In / Out**: Use your **mouse scroll wheel** or **pinch gesture** on a trackpad. You can zoom fluidly from billions and millions of years ago (`Ma` scales) down to centuries, decades, single days, and hours. You can also use the **`+`** and **`-`** buttons on the toolbar.
- **Pan Across Time**: Click and drag anywhere on the timeline background to travel backward or forward across history.
- **Time Bands**: Broad historical, geological, or cultural epochs are painted across the background as colored bands with date boundaries.

### Toolbar Quick Actions & "Fit All"
- **Fit All Articles**: Click the **Fit All** button (or press its toolbar shortcut) anytime to re-center the canvas and view the full chronological span of all events at a single glance.
- **Timeline Tabs**: Easily switch between opened timelines or start a clean exploration using the timeline tabs selector.
- **Language Switcher**: Toggle between English and Hebrew (with full Right-to-Left layout support) via the globe menu.

### Event Details Drawer
Clicking any event card on the canvas opens a comprehensive slide-over drawer on the right side of the screen:
- **Authentic Media**: High-resolution photography and portraits retrieved from Wikimedia Commons under Creative Commons licensing.
- **Verified Dates & Precision**: Displaying precise start and end dates or era approximations.
- **Encyclopedic Summary**: Read the verified Wikipedia article extract.
- **Direct Article Link**: Click to open the full Wikipedia article in a new tab.
- **Edit & Delete**: Quick buttons to modify or remove the event directly from your timeline.

### Starring & Bookmarking Events
Mark the events that matter most to you with a star so they are easy to find and always stay visible:
- **Star on Hover (Canvas)**: Hover over any event card on the timeline and click the ⭐ **star icon** that appears in its top-right corner. Click it again to unstar.
- **Star from the Event Details Drawer**: Open an event and use the star button in the drawer header to toggle it.
- **Star from the Cards List Drawer**: Each row in the Cards List Explorer has its own star button for quick bookmarking.
- **Priority Visibility**: Starred events are boosted in rank, so they remain on-screen even when you zoom far out across large time spans.
- **Filter to Starred Only**: In the Cards List Explorer, toggle the **star filter** to display only your starred events (a counter shows how many are starred).
- **Persistent**: Your stars are saved together with the timeline, so they are restored the next time you open it.

### Cards List Explorer Drawer
When a timeline contains dozens of events across multiple swimlanes, finding a specific milestone is effortless:
1. Click the **Cards** button on the top toolbar (or the floating button on the screen edge).
2. Browse a searchable, chronological list of all timeline events, organized cleanly by swimlane.
3. Use the search input to filter events by title, description, or era.
4. **Instant Camera Fly-To**: Clicking any card in the list immediately animates the timeline camera to that event on the canvas and opens its Event Details drawer.

### Canceling Generation
If you submit a prompt and wish to cancel it while in progress:
- Press the **`Esc`** key, or
- Click **Stop generate** in the floating status pill at the bottom of the screen.

---

## 2. Prompt Mastery & Timeline Architecture

ChroniX natively understands natural language queries in both **English** and **Hebrew**. Here is how to achieve the best chronological structure, swimlane divisions, and event depth.

### Detail Levels

Before generating, choose the appropriate detail level from the dropdown:

| Detail Level | Event Count | Best For | Example Topic |
|---|---|---|---|
| **Overview** | ~10–15 events | Broad historical epochs, civilizational overviews, single missions or expeditions. | *"Ancient Egypt overview from the Old Kingdom to Cleopatra"* or *"Race to the South Pole: Amundsen vs. Scott"* |
| **Standard** *(Default)* | ~20–30 events | Balanced narrative with turning points, dual-lane comparisons, cultural and political arcs. | *"The Space Race (1955–1975) between NASA and USSR"* or *"The Industrial Revolution"* |
| **Deep Dive** | ~35–50 events | Complex multi-lane timelines (3+ swimlanes), multi-theater world conflicts, expansive multi-decade sagas. | *"World War II (1939–1945), divided into European Theater, Pacific Theater, and Diplomatic Summits"* |

---

### Parallel Swimlanes (Horizontal Thematic Tracks)

One of ChroniX's most powerful capabilities is **parallel swimlanes**. You can instruct Gemini to categorize events into distinct horizontal tracks for side-by-side chronological comparison:

> [!TIP]
> Use keywords like `divided into swimlanes for...`, `split into parallel tracks for...`, or `organized into separate lanes for...` in your prompt.

#### Common Swimlane Patterns:
1. **Opposing Factions / Nations**:
   - `"...divided into swimlanes for the Soviet Space Program vs. NASA"`
   - `"...Allied Powers vs. Axis Powers"`
2. **Thematic Disciplines**:
   - `"...split into Technological Inventions, Steam & Transport, and Labor Movements"`
   - `"...separated into Military Campaigns, Political Treaties, and Cultural Developments"`
3. **Geographic Theaters**:
   - `"...divided into lanes for European Theater, Pacific Theater, and Diplomatic Summits"`
4. **Parallel Dynasties / Entities**:
   - `"...in a parallel division for the Kings of Judah and the Kings of Israel"`
   - `"...House Stark vs. House Lannister vs. House Targaryen"`

---

### Thematic Color-Coding in Single Timelines

Even when a timeline is **not split into parallel swimlanes** (a single unified timeline), ChroniX automatically divides events into thematic categories (e.g. *Politics*, *Military*, *Science & Technology*, *Culture*, *Economy*):

- **Automatic Theme Color-Coding**: Events on the canvas receive distinct museum-palette colors corresponding to their theme, providing instant visual categorization without requiring horizontal swimlane splits.
- **Interactive Floating Desktop Legend**:
  - **Draggable**: Click and drag the grip icon or legend header to position the legend anywhere across the canvas.
  - **Horizontal / Vertical Toggle**: Switch between a compact vertical stack and a wrapping horizontal layout.
  - **Minimize & Expand**: Click the minimize button (`—`) to collapse the legend into a discrete palette pill showing the number of themes; tap it anytime to re-expand.
- **Full Platform Synchronization**:
  - **Map Pins**: Geographic map pins match each event's theme color in single-timeline mode.
  - **Cards List Drawer**: Event badges display the theme name and color dot, and the filter dropdown switches to filtering by theme.
  - **Mobile Experience**: Both the interactive ruler timeline and the chronological card feed color-code events by theme, with tappable theme filter pills in the top header.

---

### Prompt Framing: Concise vs. Structured

#### Concise & Natural Prompts (Fast Exploration)
You do not need to memorize exact dates or historical terminology. Simple prompts let the AI uncover milestones and verified imagery automatically:
- *"The Industrial Revolution"*
- *"Evolution of the Horse"*
- *"The French Revolution"*
- *"History of Aviation"*

#### Structured Prompts (Targeted Research)
When studying a specific angle or comparing parallel narratives, specify bookend dates and categories explicitly:
- *"The French Revolution from 1789 to 1799, divided into political shifts, popular uprisings, and foreign wars"*
- *"The Space Race (1955–1975), divided into parallel swimlanes for the Soviet Space Program and NASA"*

---

### Multilingual Support: Prompt Language vs. UI Language

> [!IMPORTANT]
> **Prompt Language Dictates Timeline Language**:
> While the ChroniX user interface (menus, dialogs, buttons) currently supports English and Hebrew, **the timeline generation engine is fully multilingual and works in virtually any language**.
>
> - **Write in Any Language**: You can enter prompts in Spanish, French, German, Italian, Arabic, Russian, Japanese, or any other language, completely independent of the language currently selected in the UI.
> - **Events Match Your Prompt**: The milestones generated on the canvas (event titles, dates, descriptions, and swimlanes) will be written in the exact language of your prompt.
> - **Localized Wikipedia Links & Media**: Wikipedia summaries and article links will automatically point to that language's specific Wikipedia edition (e.g. `es.wikipedia.org`, `fr.wikipedia.org`, `de.wikipedia.org`, `he.wikipedia.org`, or `en.wikipedia.org`).
> - **Automatic English Wikipedia Fallback**: Because the English Wikipedia possesses the largest and richest repository of articles, historical portraits, and coordinates, ChroniX automatically checks English Wikipedia (`en.wikipedia.org`) whenever an entry or portrait is missing from the local language edition. If an entry has no article in your prompt's language, it smoothly links to the English Wikipedia article so no event is left empty. If an article exists locally but lacks an image, the thumbnail is supplemented from English Wikipedia while preserving your localized title and summary.
> - **RTL Support**: When generating or viewing in Hebrew or other right-to-left scripts, the timeline interface cleanly formats text and layout direction accordingly.

---

## 3. Curated Prompt Showcase

Here is a curated catalog of 18 ready-to-use prompts across 6 domains. You can copy any prompt directly into the ChroniX search bar:

### Science & Space

#### 1. The Space Race (1955–1975)
- **Detail Level**: Standard
- **English Prompt**:
  ```text
  The Space Race (1955–1975), divided into separate swimlanes for the Soviet Space Program and NASA
  ```
- **Hebrew Prompt**:
  ```text
  המרוץ לחלל (1955–1975), בחלוקה לשני מסלולי זמן מקבילים: תוכנית החלל הסובייטית מול נאס״א
  ```
- **Why It Works**: Demonstrates parallel swimlanes comparing two geopolitical adversaries across simultaneous technological milestones (Sputnik, Vostok, Apollo).

#### 2. The Industrial Revolution & Inventions
- **Detail Level**: Standard
- **English Prompt**:
  ```text
  The Industrial Revolution: The major inventions and breakthroughs that shaped our modern world
  ```
- **Hebrew Prompt**:
  ```text
  המהפכה התעשייתית: ההמצאות הגדולות והטכנולוגיות ששינו את חיי האדם
  ```
- **Why It Works**: A direct, thematic prompt that maps steam power, railways, textile mechanization, and electricity chronologically.

#### 3. History of Aviation
- **Detail Level**: Overview
- **English Prompt**:
  ```text
  History of Aviation: From the Wright brothers' first flight to jet aircraft and space exploration
  ```
- **Hebrew Prompt**:
  ```text
  תולדות התעופה: מהטיסה הראשונה של האחים רייט ועד למטוסי הסילון והחלל
  ```
- **Why It Works**: A fast-paced chronological journey across the 20th century in clear, accessible language.

#### 4. Evolution of the Universe
- **Detail Level**: Standard
- **English Prompt**:
  ```text
  The Evolution of the Universe from the Big Bang to today, divided into parallel swimlanes for Early Universe Expansion, Stars & Galaxies Formation, and the Solar System & Earth
  ```
- **Hebrew Prompt**:
  ```text
  התפתחות היקום מהמפץ הגדול ועד ימינו, בחלוקה לשלושה מסלולים מקבילים: שלבי התפשטות היקום, היווצרות כוכבים וגלקסיות, והיווצרות מערכת השמש וכדור הארץ
  ```
- **Why It Works**: Handles astronomical cosmic timescales (billions of years ago) while categorizing cosmic epochs into parallel tracks.

---

### Modern History

#### 5. World War II Multi-Theater Chronology
- **Detail Level**: Deep Dive
- **English Prompt**:
  ```text
  World War II (1939–1945), divided into parallel time lanes for the European Theater, Pacific Theater, and Diplomatic Summits
  ```
- **Hebrew Prompt**:
  ```text
  מלחמת העולם השנייה (1939–1945), בחלוקה למסלולים מקבילים: הזירה האירופית, זירת האוקיינוס השקט וועידות דיפלומטיות
  ```
- **Why It Works**: Maximizes Deep Dive granularity across 3 distinct geographic and political theaters simultaneously.

#### 6. The Israeli-Palestinian Conflict
- **Detail Level**: Standard
- **English Prompt**:
  ```text
  The history of the Israeli-Palestinian conflict: Major events, wars, and peace agreements from its beginnings to the present day
  ```
- **Hebrew Prompt**:
  ```text
  ההיסטוריה של הסכסוך הישראלי-פלסטיני: סקירה של האירועים, המלחמות והסכמי השלום המרכזיים מראשיתו ועד ימינו
  ```
- **Why It Works**: A balanced, step-by-step chronological roadmap covering wars, summits, and peace accords.

---

### Israel & Jewish History

#### 7. History of Zionism & the State of Israel
- **Detail Level**: Deep Dive
- **English Prompt**:
  ```text
  The History of Zionism and the founding of Israel: from the First Zionist Congress in Basel and the Balfour Declaration, through the Aliyah waves, underground organizations, UN Partition Plan, to the Declaration of Independence
  ```
- **Hebrew Prompt**:
  ```text
  תולדות הציונות והקמת מדינת ישראל: מהקונגרס הציוני בבזל והצהרת בלפור, דרך גלי העלייה ומחתרות היישוב, ועד להחלטת כ"ט בנובמבר והכרזת העצמאות
  ```
- **Why It Works**: Explicit bookends (Basel 1897 to Independence 1948) ensure focused coverage of pivotal pre-state milestones.

#### 8. Kings of Judah and Kings of Israel (First Temple)
- **Detail Level**: Standard
- **English Prompt**:
  ```text
  First Temple Era: A timeline divided into two parallel time lanes for the Kings of Judah versus the Kings of Israel, from the division of the monarchy to the destruction of the First Temple
  ```
- **Hebrew Prompt**:
  ```text
  תקופת בית ראשון: ציר זמן בחלוקה לשני מסלולי זמן מקבילים עבור מלכי יהודה מול מלכי ישראל, מפלג הממלכה ועד חורבן בית ראשון
  ```
- **Why It Works**: Splits the divided monarchy era into parallel tracks for direct chronological comparison of contemporary monarchs.

#### 9. Evolution of the Hebrew Alphabet & Script
- **Detail Level**: Standard
- **English Prompt**:
  ```text
  The Evolution of the Hebrew Alphabet from ancient origins to modern times, divided into parallel swimlanes for Script Styles & Typography (from Proto-Canaanite and Paleo-Hebrew to Square Script and modern print) vs. Languages, Peoples & Cultural Influences
  ```
- **Hebrew Prompt**:
  ```text
  התפתחות האלפבית והכתב העברי מהמקורות הקדומים ועד ימינו, בחלוקה לשני מסלולים מקבילים: גלגולי סגנונות הכתב (מפרוטו-כנעני ועברי קדום ועד הכתב המרובע והדפוס המודרני) מול השפות, העמים וההשפעות התרבותיות לאורך הדורות
  ```
- **Why It Works**: Juxtaposes epigraphic letterforms against historical and cultural influences across three millennia.

---

### Ancient Civilizations

#### 10. Ancient Egypt: Dynastic Overview
- **Detail Level**: Overview
- **English Prompt**:
  ```text
  Ancient Egypt: The story of the great pharaohs and monuments from the pyramids to Cleopatra
  ```
- **Hebrew Prompt**:
  ```text
  מצרים העתיקה: ציר זמן של הפרעונים והמונומנטים הגדולים מהפירמידות ועד לקלאופטרה
  ```
- **Why It Works**: Covers 3,000 years of dynastic history seamlessly without requiring knowledge of dynasty numbers or archaeological jargon.

#### 11. Seven Wonders of the Ancient World
- **Detail Level**: Overview
- **English Prompt**:
  ```text
  The Seven Wonders of the Ancient World: When the famous monuments were built and what happened to them
  ```
- **Hebrew Prompt**:
  ```text
  שבעת פלאי תבל של העולם העתיק: מתי נבנו המבנים המפורסמים ומה עלה בגורלם
  ```
- **Why It Works**: Displays construction dates, lifespans, and destruction events of the classical wonders on an easy-to-read scale.

---

### Prehistory & Nature

#### 12. Dinosaurs: Evolution and Extinction
- **Detail Level**: Standard
- **English Prompt**:
  ```text
  Dinosaurs: Timeline of major eras and famous species, divided into swimlanes for Carnivores vs Herbivores
  ```
- **Hebrew Prompt**:
  ```text
  עולם הדינוזאורים: סקירה של התקופות והמינים המפורסמים, בחלוקה למסלולים: דינוזאורים טורפים מול דינוזאורים צמחוניים
  ```
- **Why It Works**: Leverages intuitive dietary swimlanes (Carnivores vs. Herbivores) across the Triassic, Jurassic, and Cretaceous periods.

#### 13. Human Evolution Milestones
- **Detail Level**: Overview
- **English Prompt**:
  ```text
  Human Evolution: The journey of humanity from early hominid ancestors to modern humans
  ```
- **Hebrew Prompt**:
  ```text
  האבולוציה של האדם: המסע של האנושות מהקופים הקדומים ועד לאדם המודרני
  ```
- **Why It Works**: Spans millions of years of hominid evolutionary breakthroughs (tool use, bipedalism, fire, language) in an accessible overview.

#### 14. Evolution of Life on Earth
- **Detail Level**: Deep Dive
- **English Prompt**:
  ```text
  The Evolution of Life on Earth from the beginning to the present day, divided into parallel swimlanes for Animals, Plants, and Microorganisms
  ```
- **Hebrew Prompt**:
  ```text
  התפתחות החיים על פני כדור הארץ מראשיתם ועד ימינו, בחלוקה לשלושה מסלולים מקבילים: בעלי חיים, צמחים, ומיקרואורגניזמים (יצורים חד-תאיים)
  ```
- **Why It Works**: Maps biological history from single-celled organisms through the Cambrian explosion up to modern ecosystems across three distinct biological kingdoms.

#### 15. Evolution of the Horse
- **Detail Level**: Overview
- **English Prompt**:
  ```text
  Evolution of the horse
  ```
- **Hebrew Prompt**:
  ```text
  האבולוציה של הסוס
  ```
- **Why It Works**: Traces a specific, fascinating evolutionary transition (from small multi-toed forest dwellers to the modern horse) with transitional fossil milestones.

---

### Culture & Lore

#### 16. Harry Potter Saga (Seven School Years)
- **Detail Level**: Overview
- **English Prompt**:
  ```text
  Harry Potter: Chronological journey through the seven school years at Hogwarts
  ```
- **Hebrew Prompt**:
  ```text
  עלילת הארי פוטר לאורך שבע שנות הלימוד בהוגוורטס
  ```
- **Why It Works**: Demonstrates ChroniX's ability to structure fictional narratives and literary sagas just as accurately as real history.

#### 17. Game of Thrones: The Great Houses
- **Detail Level**: Standard
- **English Prompt**:
  ```text
  The storyline of Game of Thrones, divided into three parallel swimlanes for House Stark, House Lannister, and House Targaryen
  ```
- **Hebrew Prompt**:
  ```text
  עלילת משחקי הכס, בחלוקה לשלושה מסלולים מקבילים עבור בית סטארק, בית לאניסטר ובית טרגאריין
  ```
- **Why It Works**: Organizes an intricate epic fantasy narrative by faction, letting you follow each family's arc chronologically without confusion.

#### 18. History of Rock Music
- **Detail Level**: Deep Dive
- **English Prompt**:
  ```text
  History of rock music from the 1950s to the present day, divided into parallel swimlanes for Classic Rock, Punk & Heavy Metal, and Alternative & Grunge
  ```
- **Hebrew Prompt**:
  ```text
  תולדות מוזיקת הרוק משנות ה-50 ועד ימינו, בחלוקה לשלושה מסלולים מקבילים: רוק קלאסי, פאנק ומטאל, ורוק אלטרנטיבי וגראנג'
  ```
- **Why It Works**: Breaks down 70 years of musical innovation into stylistic movements across parallel tracks.

---

## 4. Event Editing & Manual Timeline Studio

You are never locked into AI-generated content. ChroniX provides a full manual editing studio where you can edit, enrich, or create brand-new events with smart AI and Wikipedia integration.

```
┌────────────────────────────────────────────────────────┐
│                   Edit Event Modal                     │
├────────────────────────────────────────────────────────┤
│ Title: [ Apollo 11 Moon Landing                       ]│
│        [ AI Auto-Fill ]     [ Search Wikipedia ]       │
│                                                        │
│ Date:  [ 1969-07-20 ]      Precision: [ Day ▼ ]        │
│ Lane:  [ NASA       ]      Color:     [ Blue ]         │
│                                                        │
│ Location & Coordinates                                 │
│ Location: [ Cape Canaveral, Florida                  ] │
│ Latitude: [ 28.3922 ]      Longitude: [ -80.6077     ] │
└────────────────────────────────────────────────────────┘
```

### Gemini AI Auto-Fill
When adding or editing an event:
1. Simply type an event title (e.g., *"Apollo 11 Moon Landing"* or *"Battle of Marathon"*).
2. Click **AI Auto-Fill**.
3. Gemini automatically determines and fills:
   - Historical start and end dates.
   - Appropriate date precision (year, month, or exact day).
   - Relevant swimlane.
   - Wikipedia search term and encyclopedic summary.
   - **Geographic location name and Latitude/Longitude coordinates!**

### Wikipedia Candidate Disambiguation Picker
To pull verified Wikimedia photography and encyclopedic text:
1. Click **Search Wikipedia** inside the event dialog.
2. If multiple relevant articles exist, an interactive **disambiguation picker** appears with title candidates and snippet previews.
3. Click your intended article; ChroniX immediately retrieves verified imagery, license metadata, and summary extracts.

### Adding Custom Events (+) & New Swimlanes
- Click the **`+`** button on the top toolbar anytime to add an event manually.
- Choose an existing swimlane from the dropdown, or **type a brand-new lane name** to create a new swimlane on the canvas automatically.

### Geographic Coordinates & Map Pinning
Inside the event modal, scroll to **Location & Coordinates**:
- Enter a location name (e.g., *"Normandy, France"*) and coordinates (e.g., `49.4144`, `-0.8322`).
- As soon as valid coordinates exist, the event is automatically plotted as an interactive pin on the **Synchronized Geographic World Map**!

---

## 5. AI Refine System (Iterative Expansion & Splitting)

Instead of regenerating a timeline from scratch when you want to change its focus, click the **Refine** button on the top toolbar to converse with Gemini and update the active timeline interactively.

### Splitting into Multiple Parallel Paths & Theaters
You can instruct Gemini to restructure an existing single-track timeline into parallel swimlanes:
- **By Geography**: *"Split this timeline into European Theater and Pacific Theater."*
- **By Opposing Sides**: *"Restructure into two parallel lanes: Allied Powers and Axis Powers."*
- **By Topic**: *"Divide the events into Political & Military, Science & Technology, and Culture & Society."*

> [!NOTE]
> Gemini intelligently redistributes existing events into the new swimlanes while preserving all event details and adding missing milestones to fill chronological gaps.

### Expanding Sub-Eras & Adding Historical Context
You can ask the AI to zoom into a specific sub-period:
- *"Add 5 more key naval battles in the Pacific between 1942 and 1943."*
- *"Include the major peace treaties and diplomatic summits that followed."*
- *"Add cultural and philosophical milestones during this golden age."*

### Refinement Prompt Cheat-Sheet

| Refinement Goal | Example Refinement Instruction |
|---|---|
| **Parallel Thematic Paths** | `"Split the timeline into three parallel paths: Political & Military, Science & Technology, and Culture & Society"` |
| **Geographic Separation** | `"Divide the events into two separate timelines: European Theater and Pacific Theater"` |
| **Opposing Factions** | `"Restructure the events into two parallel tracks: United States and Soviet Union"` |
| **Domestic vs. Foreign** | `"Split the timeline into two parallel paths: Domestic Policy & Reforms and Foreign Relations & Treaties"` |
| **Expand Sub-Era** | `"Add 5 more key battles that took place in the Pacific theater between 1942 and 1943"` |
| **Cultural Context** | `"Include cultural, philosophical, and social developments that occurred during this reign"` |
| **Scientific Focus** | `"Add events focused on medicine, science, and technological inventions in this era"` |
| **Aftermath & Treaties** | `"Add 3 events showing the long-term aftermath and diplomatic treaties in the decade following"` |

---

## 6. Synchronized Geographic World Map (Leaflet)

History is not just a sequence of dates; it is anchored in physical geography. ChroniX embeds an interactive Leaflet world map synchronized in real time with the timeline canvas.

```
┌────────────────────────────────────────────────────────┐
│ [Floating Earth] ───────▶ [Picture-in-Picture (PiP)]   │
│         │                                              │
│         ▼                                              │
│ [Resizable Split Screen] ──▶ [Fullscreen Map]          │
└────────────────────────────────────────────────────────┘
```

### The 4 Map Display Modes

1. **Floating Earth Icon**:
   - A discrete, draggable globe button located on your screen showing the count of mapped events.
   - Click it to toggle the map in your preferred mode.
2. **Picture-in-Picture (PiP) Window**:
   - A compact floating window overlaid on top of the timeline canvas.
   - **Draggable**: Grab it by the header bar and move it anywhere on your screen.
   - **Resizable**: Drag from the bottom-right corner or edges to resize.
3. **Resizable Split Screen**:
   - Divides your screen horizontally: the interactive World Map on top and the Timeline canvas on the bottom.
   - **Draggable Splitter**: Drag the divider bar up or down to customize the height ratio.
   - **Double-Click Reset**: Double-click the splitter bar to quickly reset to an even 50/50 split.
4. **Fullscreen Map**:
   - Expands the map to occupy 100% of the viewport for deep spatial exploration of global historical distributions.

### Bi-Directional Synchronization

The map and the timeline canvas communicate seamlessly:
- **Timeline -> Map**: Clicking any event card on the timeline automatically flies the map camera (`flyTo`) directly to that event's coordinates and opens a popup containing the event's thumbnail and title.
- **Map -> Timeline**: Clicking any map pin highlights the event, centers the timeline canvas smoothly onto that event's card, and opens the Event Details drawer.

### Swimlane & Theme Color-Coded Markers
Every map pin marker is automatically color-coded to match its respective timeline swimlane color (e.g., blue for NASA, red for Soviet Space Program) or its event theme in single-timeline mode, providing immediate visual correlation between temporal domains and geographical positions.

---

## 7. Exporting, Cloud Saving & Settings

### Snapshot Image Export (PNG)
Want to include your timeline in a presentation, paper, or research report?
1. Click the **More Actions** menu (`⋮` three vertical dots) on the toolbar.
2. Click **Export Snapshot (PNG)**.
3. ChroniX generates and downloads a high-resolution PNG image of the active canvas view.

### Data Export & Import (JSON)
- **Export (JSON)**: Download your entire timeline dataset — including all events, dates, precision scales, swimlanes, Wikipedia extracts, and latitude/longitude coordinates.
- **Import (JSON)**: Open the **Saved Timelines** menu and click **Import JSON** to restore any previously exported timeline.

### Supabase Cloud Library
- When logged in, every timeline you generate or edit is automatically synchronized to your personal cloud library in **Supabase**.
- Re-open past chronologies anytime from the **Saved Timelines** modal without needing to regenerate them.

### AI Accuracy Notice & Best Practices

> [!CAUTION]
> **AI Accuracy Considerations**:
> ChroniX utilizes Google Gemini and Wikimedia Commons to construct chronologies. While Gemini is exceptionally knowledgeable, dates (especially in ancient BCE history, legendary events, or complex multi-calendar records) can occasionally be approximate.
> 
> You can always verify and fine-tune dates, descriptions, and media using the **Edit Event** dialog and the **Wikipedia Candidate Disambiguation Picker**.

---

## Summary & Quick Links

- [Installation & Developer Guide (README.md)](README.md)
- [ChroniX Live Web Application](https://chronix.pages.dev) *(or your deployed URL)*
- [Report Issues / Suggest Features](https://github.com/yonitsur/ChroniX/issues)

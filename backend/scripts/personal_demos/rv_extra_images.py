"""
Definitions for the 2 additional images per event (60 images total) for the 30-day North America RV Road Trip.
Each entry (1..30) contains two items with:
- `prompt`: Detailed English visual prompt for Gemini Image AI (`gemini-3.1-flash-image`)
- `caption_he`: Hebrew caption displayed in the EventDrawer gallery/slideshow
- `caption_en`: English caption displayed in the EventDrawer gallery/slideshow
"""

from typing import Dict, List

RV_EXTRA_IMAGES_SPEC: Dict[int, List[Dict[str, str]]] = {
    1: [
        {
            "prompt": (
                "Atmospheric documentary travel photograph of morning coastal fog swirling through the towering "
                "international-orange steel suspension towers and cables of the Golden Gate Bridge viewed from Marin Headlands, "
                "soft golden morning sunlight breaking through mist over San Francisco Bay, 35mm DSLR photography, 16:9."
            ),
            "caption_he": "ערפל הבוקר מתפזר מעל המגדלים האדומים של גשר שער הזהב בתצפית מרין הדלנדס",
            "caption_en": "Morning coastal fog lifting around the Golden Gate Bridge towers from Marin Headlands",
        },
        {
            "prompt": (
                "Cozy interior detail photograph inside an RV camper cab dashboard: a folded paper road map of North America "
                "spread across the dashboard, two speckled blue enamel camping mugs steaming with fresh coffee, and RV keys with a brass keychain, "
                "warm morning light through the windshield, 35mm candid travel photography, 16:9."
            ),
            "caption_he": "מפת הדרכים פרוסה על הדשבורד של 'גולדי' ושני ספלי אמייל עם הקפה של היום הראשון",
            "caption_en": "Our North America road atlas spread on Goldie's dashboard with morning coffee mugs",
        },
    ],
    2: [
        {
            "prompt": (
                "Dramatic wide landscape photograph of Bixby Creek Bridge on Highway 1 in Big Sur, California, "
                "graceful concrete arch bridge spanning a steep green coastal canyon above turquoise crashing Pacific Ocean waves, "
                "golden afternoon sunlight, crisp 35mm nature photography, 16:9."
            ),
            "caption_he": "גשר ביקסבי המפורסם תלוי מעל המצוקים התלולים והגלים הטורקיזיים של ביג סור",
            "caption_en": "Bixby Creek Bridge arching high above the turquoise Pacific surf along Highway 1",
        },
        {
            "prompt": (
                "Natural wildlife photograph of wild California sea lions basking on sun-warmed dark coastal rocks "
                "along the Big Sur shoreline, turquoise ocean waves and white sea spray crashing behind them in golden afternoon light, "
                "telephoto nature photography, 16:9."
            ),
            "caption_he": "מושבת אריות ים משתזפת על הסלעים למרגלות מצוקי כביש 1",
            "caption_en": "Wild California sea lions basking on coastal rocks below the Big Sur cliffs",
        },
    ],
    3: [
        {
            "prompt": (
                "Awe-inspiring upward-angle forest photograph looking straight up into the towering cinnamon-red bark trunks "
                "and emerald canopy of ancient Giant Sequoia trees in Sequoia National Park, golden sunbeams filtering through morning forest mist, "
                "35mm nature photography, 16:9."
            ),
            "caption_he": "מבט אל צמרות עצי הסקויה העצומים בני ה-2,200 שנה ביער הענקים",
            "caption_en": "Looking straight up into 2,200-year-old cinnamon-red trunks in the Giant Forest",
        },
        {
            "prompt": (
                "Charming close-up wildlife photograph of a wild Douglas squirrel perched on a giant sequoia cone "
                "on a mossy log in Sequoia National Park, soft dappled forest sunlight, shallow depth of field, 35mm wildlife photography, 16:9."
            ),
            "caption_he": "סנאי דאגלס סקרן על אצטרובל סקויה ביער הענקים",
            "caption_en": "A curious Douglas squirrel perched on a sequoia cone along the forest trail",
        },
    ],
    4: [
        {
            "prompt": (
                "Majestic golden sunrise landscape photograph of Yosemite Valley from Tunnel View, showing the sheer granite monolith "
                "of El Capitan on the left, Half Dome in the distance, and misty Bridalveil Fall on the right, warm golden-pink dawn light, "
                "35mm landscape photography, 16:9."
            ),
            "caption_he": "אור ראשון בתצפית המנהרה (Tunnel View) על אל קפיטן, האף דום ומפל הינומת הכלה",
            "caption_en": "First golden light at Tunnel View illuminating El Capitan, Half Dome, and Bridalveil Fall",
        },
        {
            "prompt": (
                "Peaceful wildlife photograph of a wild mule deer with velvety ears grazing in the golden tall meadow grass "
                "of El Capitan Meadow in Yosemite Valley, towering vertical granite cliffs in the soft-focus background, natural daylight, 16:9."
            ),
            "caption_he": "איילה שלווה באחו הירוק למרגלות מצוק הגרניט של אל קפיטן",
            "caption_en": "A peaceful mule deer grazing in El Capitan Meadow beneath the granite walls",
        },
    ],
    5: [
        {
            "prompt": (
                "Pristine alpine landscape photograph of Tenaya Lake along Tioga Pass Road in the High Sierra of Yosemite, "
                "crystal-clear turquoise water reflecting smooth white granite domes and pine trees under a deep blue sky, 16:9."
            ),
            "caption_he": "מי הטורקיז הצלולים של אגם טנאיה לאורך כביש מעבר טיוגה בגובה 3,000 מטר",
            "caption_en": "Mirror-calm alpine waters of Tenaya Lake along the high Tioga Pass Road",
        },
        {
            "prompt": (
                "Surreal twilight landscape photograph of ancient limestone tufa towers rising out of the mirror-still alkaline water "
                "of Mono Lake in California, vibrant violet, magenta, and amber sunset sky reflected in the water, 16:9."
            ),
            "caption_he": "מגדלי הגיר (Tufa) המסתוריים של אגם מונו משתקפים במים בשקיעה סגולה-כתומה",
            "caption_en": "Otherworldly limestone tufa spires reflecting in Mono Lake at twilight",
        },
    ],
    6: [
        {
            "prompt": (
                "Breathtaking desert sunrise photograph at Zabriskie Point in Death Valley National Park, "
                "rippled erosional badlands hills glowing in shades of burnished gold, amber, and soft rose under dawn light, 16:9."
            ),
            "caption_he": "גבעות החוואר הגליות של זבריסקי פוינט נצבעות בזהב עם קרני השמש הראשונות",
            "caption_en": "The rippled badlands of Zabriskie Point glowing burnished gold at dawn",
        },
        {
            "prompt": (
                "Striking wide-angle desert landscape photograph of hexagonal white salt crust polygons stretching across "
                "the floor of Badwater Basin in Death Valley National Park, rugged purple desert mountains on the horizon, low morning sun, 16:9."
            ),
            "caption_he": "משושי המלח הלבנים באגן בדווטר — 86 מטרים מתחת לפני הים",
            "caption_en": "Geometric white salt polygons across Badwater Basin, 282 feet below sea level",
        },
    ],
    7: [
        {
            "prompt": (
                "Spectacular night photograph of the Bellagio Fountains in Las Vegas shooting towering illuminated jets of water "
                "into the night sky, golden hotel lights and neon reflections shimmering across the lagoon, candid documentary travel shot, 16:9."
            ),
            "caption_he": "מופע המזרקות המואר של מלון בלאג'יו מול אורות הסטריפ בלאס וגאס",
            "caption_en": "The illuminated Bellagio Fountains dancing against the night lights of the Las Vegas Strip",
        },
        {
            "prompt": (
                "Atmospheric night street photograph of vintage colorful neon signs glowing in warm ruby red, turquoise, and yellow "
                "along historic downtown Las Vegas at dusk, classic retro Americana neon aesthetic, 35mm night photography, 16:9."
            ),
            "caption_he": "שלטי ניאון וינטג' צבעוניים מאירים את שמי הלילה של לאס וגאס",
            "caption_en": "Classic vintage neon signs glowing against the desert night sky in Las Vegas",
        },
    ],
    8: [
        {
            "prompt": (
                "Dramatic canyon landscape photograph inside The Narrows in Zion National Park, Utah: "
                "towering 1,000-foot sculpted red and orange Navajo sandstone walls reflecting in the clear emerald-blue flowing current "
                "of the Virgin River, warm reflected canyon glow, 16:9."
            ),
            "caption_he": "קירות אבן החול האדומים של ה-Narrows סוגרים מעל הזרם הצלול של נהר הווירג'ין",
            "caption_en": "Towering crimson sandstone walls reflecting in the Virgin River inside The Narrows",
        },
        {
            "prompt": (
                "Authentic outdoor adventure detail photograph of two pairs of wet canyon hiking boots and two wooden walking sticks "
                "resting on a smooth red sandstone riverside boulder beside the clear flowing Virgin River in Zion Canyon, dappled sunlight, 16:9."
            ),
            "caption_he": "נעלי המים ומקלות ההליכה שלנו במנוחה על סלע אדום בלב קניון ציון",
            "caption_en": "Our river boots and wooden walking sticks resting on a sandstone boulder in Zion",
        },
    ],
    9: [
        {
            "prompt": (
                "Panoramic morning landscape photograph of the Bryce Amphitheater in Bryce Canyon National Park, Utah, "
                "thousands of intricate orange, coral-pink, and white limestone hoodoo rock spires glowing in crisp morning sunlight, 16:9."
            ),
            "caption_he": "אמפיתיאטרון אלפי עמודי ה-Hoodoos הכתומים-ורודים בפארק לאומי ברייס קניון",
            "caption_en": "Thousands of glowing orange and coral hoodoo spires filling the Bryce Amphitheater",
        },
        {
            "prompt": (
                "Dramatic upward-looking photograph from the narrow Wall Street slot canyon trail in Bryce Canyon National Park, "
                "two tall ancient green Douglas fir trees growing up between narrow glowing orange canyon walls toward a deep blue sky, 16:9."
            ),
            "caption_he": "עצי דאגלס עתיקים צומחים מתוך הנקיק הצר של 'וול סטריט' בשביל נבאחו לופ",
            "caption_en": "Ancient Douglas fir trees reaching for the sky inside the narrow 'Wall Street' canyon",
        },
    ],
    10: [
        {
            "prompt": (
                "Iconic wide-angle sunset landscape photograph of Horseshoe Bend near Page, Arizona, "
                "the emerald-green Colorado River carving a dramatic 270-degree horseshoe curve 1,000 feet below sheer red sandstone cliffs, "
                "warm golden-orange sunset sky, 16:9."
            ),
            "caption_he": "פיתול 270 המעלות של נהר הקולורדו בתצפית פרסת הסוס (Horseshoe Bend) בשקיעה",
            "caption_en": "The emerald Colorado River curving 270 degrees below the cliffs of Horseshoe Bend at sunset",
        },
        {
            "prompt": (
                "Cozy dusk RV camping atmosphere photograph on the sandy shore of Lone Rock Beach at Lake Powell: "
                "warm string lights glowing under the awning of a vintage-striped Class-C RV parked right on the sand, two camp chairs facing "
                "the calm blue lake water and Lone Rock monolith at twilight, 16:9."
            ),
            "caption_he": "חניית שטח (Boondocking) עם גרילנדת אורות על החול של חוף לון רוק מול אגם פאוול",
            "caption_en": "Twilight boondocking on the sand of Lone Rock Beach right at the water's edge of Lake Powell",
        },
    ],
    11: [
        {
            "prompt": (
                "Breathtaking natural wonder photograph inside Upper Antelope Canyon in Page, Arizona: "
                "dramatic shafts of midday sunbeams piercing down from the narrow crevice above into the shadowy slot canyon, "
                "illuminating swirling wave-sculpted orange and violet sandstone walls and fine desert sand, 16:9."
            ),
            "caption_he": "עמודי אור השמש חודרים מבעד לסדק העליון אל תוך קניון אנטילופ",
            "caption_en": "Midday shafts of sunlight piercing down into the sculpted chambers of Antelope Canyon",
        },
        {
            "prompt": (
                "Artistic close-up nature photograph of wind-and-water-sculpted Navajo sandstone walls inside Antelope Canyon, "
                "flowing ribbon-like rock textures glowing in rich gradients of burnt orange, crimson, gold, and deep violet, 16:9."
            ),
            "caption_he": "גלי אבן החול המפוסלים בגווני אש, זהב וסגול בדפנות הנקיק",
            "caption_en": "Flowing ribbons of crimson, gold, and violet sandstone carved by flash floods",
        },
    ],
    12: [
        {
            "prompt": (
                "Epic golden-hour panoramic landscape photograph of the Grand Canyon South Rim from Mather Point, "
                "vast mile-deep chasm of layered crimson, ochre, and violet rock temples and buttes stretching to the horizon, "
                "warm dramatic sunset light and shadows, 16:9."
            ),
            "caption_he": "שקיעה זהובה מעל תהום הסלעים האינסופית של הגרנד קניון בתצפית מאת'ר פוינט",
            "caption_en": "Golden-hour shadows stretching across the mile-deep temples of the Grand Canyon",
        },
        {
            "prompt": (
                "Warm cozy evening campfire photograph at Mather Campground in the pine forest of the Grand Canyon: "
                "a crackling wood campfire in a stone ring, two wooden sticks roasting golden marshmallows, and an acoustic guitar "
                "leaning against a canvas camp chair under twilight pines, 16:9."
            ),
            "caption_he": "מרשמלו על האש וגיטרה אקוסטית סביב המדורה בחניון היער של הגרנד קניון",
            "caption_en": "Roasting marshmallows with our acoustic guitar beside the pine campfire at Mather Campground",
        },
    ],
    13: [
        {
            "prompt": (
                "Nostalgic Americana travel photograph along Historic Route 66 in Williams, Arizona: "
                "a gleaming cherry-red 1957 classic American tailfin convertible parked in front of a vintage chrome roadside diner "
                "with warm neon lights under a desert blue sky, 35mm documentary photography, 16:9."
            ),
            "caption_he": "מכונית אספנות משנות ה-50 חונה מול דיינר ניאון קלאסי על כביש 66 ההיסטורי",
            "caption_en": "A cherry-red 1950s classic convertible parked outside a vintage neon diner on Route 66",
        },
        {
            "prompt": (
                "Close-up retro diner photograph of two tall fluted glass fountain cups filled with thick vanilla and strawberry milkshakes "
                "topped with whipped cream, cherries, and paper straws, resting on a glossy chrome-edged counter beside a jukebox selector, 16:9."
            ),
            "caption_he": "צמד מילקשייקים בכוסות זכוכית של פעם על דלפק הכרום בדיינר בוויליאמס",
            "caption_en": "Classic malted vanilla and strawberry milkshakes on the chrome counter beside a table jukebox",
        },
    ],
    14: [
        {
            "prompt": (
                "Iconic American Southwest landscape photograph from Forrest Gump Point on Highway 163 in Utah, "
                "a long straight desert ribbon of highway leading directly toward the towering red sandstone buttes and mesas "
                "of Monument Valley under a warm golden sunrise sky, 16:9."
            ),
            "caption_he": "הכביש הישר של נקודת פורסט גאמפ המוביל אל הרי השולחן של עמק מוניומנט",
            "caption_en": "The iconic desert highway at Forrest Gump Point leading straight into Monument Valley",
        },
        {
            "prompt": (
                "Dramatic desert dawn photograph of the West Mitten Butte, East Mitten Butte, and Merrick Butte in Monument Valley, "
                "towering red sandstone formations glowing fiery crimson and orange against a soft pink and gold sunrise sky, 16:9."
            ),
            "caption_he": "שלושת הרי ה-Mittens בוערים באדום מול שמי הזריחה של עמק מוניומנט",
            "caption_en": "The Mittens and Merrick Butte glowing fiery crimson in the first light of dawn",
        },
    ],
    15: [
        {
            "prompt": (
                "Spectacular sunrise landscape photograph of Mesa Arch in Canyonlands National Park, Utah: "
                "the underside of the natural sandstone arch glowing like molten orange fire from reflected dawn sunlight, "
                "framing deep red rock canyons and the distant snow-dusted La Sal Mountains, 16:9."
            ),
            "caption_he": "תחתית הקשת של מסה ארץ' בוערת בכתום לוהט עם פגיעת קרני הזריחה במצוק",
            "caption_en": "The underside of Mesa Arch glowing like molten gold as sunrise hits the canyon wall below",
        },
        {
            "prompt": (
                "Vast breathtaking canyon panorama from Grand View Point Overlook in Canyonlands National Park (Island in the Sky), "
                "deep meandering gorges carved thousands of feet into red and buff sandstone plateaus stretching to the horizon, 16:9."
            ),
            "caption_he": "תצפית 'אי בשמיים' (Island in the Sky) אל הקניונים העמוקים שחצב נהר הקולורדו",
            "caption_en": "Vast canyon chasms carved thousands of feet deep below Island in the Sky",
        },
    ],
    16: [
        {
            "prompt": (
                "Iconic golden-hour landscape photograph of Delicate Arch in Arches National Park, Moab, Utah: "
                "the majestic 52-foot freestanding red sandstone arch glowing warm amber above a smooth slickrock bowl "
                "with distant mountains under a clear evening sky, 16:9."
            ),
            "caption_he": "קשת הסלע המפורסמת Delicate Arch זוהרת באור הזהב של השקיעה במואב",
            "caption_en": "Freestanding Delicate Arch glowing warm amber above its natural slickrock amphitheater",
        },
        {
            "prompt": (
                "Vivid wildlife close-up photograph of a colorful desert collared lizard with turquoise-blue and bright yellow spots "
                "basking on warm red slickrock sandstone in Arches National Park, red rock fins in soft background focus, 16:9."
            ),
            "caption_he": "לטאת קולר מדברית בצבעי טורקיז וצהוב משתזפת על סלעי ה-Slickrock",
            "caption_en": "A vibrant turquoise-and-gold desert collared lizard basking on warm Moab slickrock",
        },
    ],
    17: [
        {
            "prompt": (
                "Joyful, authentic candid travel photograph at the Bonneville Salt Flats in Utah: "
                "a young woman and man jumping high in mid-air with arms raised in pure celebration and laughter, "
                "surrounded by blindingly bright, flat white polygonal salt crust stretching uninterrupted from horizon to horizon "
                "under a crisp brilliant blue sky, natural DSLR photography, horizontal 16:9, no text."
            ),
            "caption_he": "קפיצה באוויר באמצע מדבר המלח הלבן הבוהק מאופק לאופק ב-Bonneville Salt Flats!",
            "caption_en": "Leaping mid-air with endless blinding-white salt stretching from horizon to horizon at the Bonneville Salt Flats!",
        },
        {
            "prompt": (
                "Majestic wildlife photograph of a wild American bison standing in golden autumn prairie grass on Antelope Island, Utah, "
                "with the shimmering blue waters of the Great Salt Lake and distant Wasatch Mountains in the background, 16:9."
            ),
            "caption_he": "ביזון אמריקאי פראי בערבות העשב של האי אנטילופ מול ימת המלח הגדולה",
            "caption_en": "A wild American bison grazing on Antelope Island above the shimmering Great Salt Lake",
        },
    ],
    18: [
        {
            "prompt": (
                "Classic sunrise landscape photograph of the historic weathered wooden Moulton Barn on Mormon Row in Grand Teton National Park, "
                "warm morning light illuminating the triangular barn roof with the jagged snow-streaked granite peaks of the Teton Range towering behind, 16:9."
            ),
            "caption_he": "אסם העץ ההיסטורי ב-Mormon Row מול הפסגות המשוננות של רכס הגרנד טיטון בזריחה",
            "caption_en": "The historic Moulton Barn on Mormon Row beneath the jagged granite peaks of the Teton Range",
        },
        {
            "prompt": (
                "Serene alpine landscape photograph of Jenny Lake in Grand Teton National Park, Wyoming, "
                "mirror-calm turquoise water reflecting snow-dusted granite peaks and bright golden autumn aspen trees along the shoreline, 16:9."
            ),
            "caption_he": "השתקפות פסגות הטיטון ועצי הצפצפה הזהובים במים השקטים של אגם ג'ני",
            "caption_en": "Snow-dusted Teton summits and golden autumn aspens mirrored in Jenny Lake",
        },
    ],
    19: [
        {
            "prompt": (
                "Spectacular elevated overlook photograph of Grand Prismatic Spring in Yellowstone National Park, "
                "vivid deep sapphire-blue geothermal pool surrounded by brilliant concentric rings of turquoise, yellow, and fiery orange "
                "thermophilic bacteria, warm steam rising into the air, 16:9."
            ),
            "caption_he": "מניפת הצבעים הוולקנית של המעיין הפריזמטי הגדול (Grand Prismatic) מתצפית הגבעה",
            "caption_en": "Electric turquoise and fiery orange rings of Grand Prismatic Spring from the overlook trail",
        },
        {
            "prompt": (
                "Dramatic nature photograph of Old Faithful geyser in Yellowstone National Park erupting a towering 140-foot column "
                "of boiling white water and billowing steam into a crisp blue Wyoming sky, wooden boardwalk in the distance, 16:9."
            ),
            "caption_he": "סילון המים הרותחים והקיטור של גייזר Old Faithful מתפרץ לגובה של יותר מ-40 מטר",
            "caption_en": "Old Faithful shooting a towering column of boiling water and steam into the Wyoming sky",
        },
    ],
    20: [
        {
            "prompt": (
                "Striking close-up wildlife photograph of a massive wild American bison bull in Lamar Valley, Yellowstone National Park, "
                "frost clinging to its thick dark shaggy winter coat, visible clouds of warm breath rising in the golden dawn mist, 16:9."
            ),
            "caption_he": "ביזון ענק עטוף כפור בוקר מעלה ענני הבל פה באוויר הקר של עמק לאמאר",
            "caption_en": "A frost-covered bison bull breathing clouds of steam in the chilly Lamar Valley dawn",
        },
        {
            "prompt": (
                "Expansive golden sunrise landscape photograph of Lamar Valley in Yellowstone National Park, "
                "a winding silver river cutting through golden autumn meadows dotted with herds of grazing wild bison and elk, "
                "mist rising from the valley floor with mountain ridges behind, 16:9."
            ),
            "caption_he": "עדרי ביזונים ואיילים רועים בעמק לאמאר עם עלות השחר",
            "caption_en": "Herds of wild bison dotted across the golden morning meadows of Lamar Valley",
        },
    ],
    21: [
        {
            "prompt": (
                "Warm atmospheric interior photograph of a rustic historic wooden country saloon in Bozeman, Montana: "
                "warm string lights over weathered timber walls, a small country band playing acoustic guitar and fiddle on a corner stage, "
                "and locals in cowboy hats dancing on a wooden floor, candid documentary photography, 16:9."
            ),
            "caption_he": "להקת קאנטרי חיה ורחבת ריקודים מעץ בבר ההיסטורי בבוזמן, מונטנה",
            "caption_en": "Live fiddle and acoustic guitar at the historic timber saloon in Bozeman, Montana",
        },
        {
            "prompt": (
                "Cozy close-up photograph of two cold pint glasses of amber Montana craft beer clinking together above a weathered oak barrel table, "
                "warm golden bar string lights bokeh in the background, authentic candid travel moment, 16:9."
            ),
            "caption_he": "משיקים כוסות בירה מקומית במונטנה אחרי תיקון הפנצ'ר המוצלח",
            "caption_en": "Toasting with local Montana craft beer after Hank patched our RV tire",
        },
    ],
    22: [
        {
            "prompt": (
                "Iconic alpine landscape photograph of Wild Goose Island in Saint Mary Lake, Glacier National Park, Montana: "
                "a tiny pine-topped rock island rising from deep sapphire-blue water, surrounded by steep glacially carved mountain peaks "
                "under dramatic clouds, 16:9."
            ),
            "caption_he": "האי הקטן Wild Goose Island בלב אגם סנט מרי בפארק לאומי גליישר",
            "caption_en": "Tiny Wild Goose Island framed by glacially carved peaks on Saint Mary Lake",
        },
        {
            "prompt": (
                "Crisp wildlife photograph of a fluffy white mountain goat with short black horns standing gracefully on an alpine rock ledge "
                "at Logan Pass along Going-to-the-Sun Road in Glacier National Park, rugged mountain peaks in the background, 16:9."
            ),
            "caption_he": "עז הרים לבנה על מצוקי הסלע של מעבר לוגן בכביש Going-to-the-Sun",
            "caption_en": "A sure-footed white mountain goat on the alpine ledges of Logan Pass",
        },
    ],
    23: [
        {
            "prompt": (
                "Breathtaking long-exposure astrophotography landscape in Many Glacier Valley, Glacier National Park, Montana: "
                "the glowing Milky Way galaxy packed with millions of stars arching over the jagged dark silhouette of Swiftcurrent Peak "
                "and reflecting faintly in a still alpine lake, 16:9."
            ),
            "caption_he": "חשיפה ארוכה של שביל החלב מעל פסגות מני גליישר בלילה נטול עננים",
            "caption_en": "A 25-second exposure of the Milky Way arching above Swiftcurrent Peak in Many Glacier",
        },
        {
            "prompt": (
                "Cozy night camping photograph of a vintage-striped Class-C RV parked in a dark pine campground under a starry night sky, "
                "warm amber light glowing softly from the camper windows and a small camping lantern on the folding table outside, 16:9."
            ),
            "caption_he": "האור החם בחלונות של 'גולדי' בחניון הלילה השקט של מונטנה",
            "caption_en": "Goldie's windows glowing warmly beneath a canopy of Montana stars",
        },
    ],
    24: [
        {
            "prompt": (
                "Iconic Canadian Rockies landscape photograph of a bright red wooden canoe floating on the vivid milky-turquoise glacial water "
                "of Lake Louise in Banff National Park, framed by dark green spruce forests and the white ice of Victoria Glacier, 16:9."
            ),
            "caption_he": "קאנו עץ אדום על מי הטורקיז הקרחוניים של אגם לואיז בפארק לאומי באנף",
            "caption_en": "A classic red canoe gliding across the glacial-turquoise waters of Lake Louise",
        },
        {
            "prompt": (
                "First-person perspective photograph looking over the wooden bow of a red canoe and a wooden paddle dipping into "
                "the surreal emerald-turquoise water of Lake Louise, snow-capped Canadian Rockies peaks ahead, 16:9."
            ),
            "caption_he": "מבט מחרטום הקאנו אל קרחון ויקטוריה והמים בצבע שמסרב להיראות אמיתי",
            "caption_en": "View from the bow of our canoe toward Victoria Glacier as paddles dip into turquoise water",
        },
    ],
    25: [
        {
            "prompt": (
                "Breathtaking sunrise landscape photograph of Moraine Lake and the Valley of the Ten Peaks in Banff National Park, Canada, "
                "ten jagged snow-dusted peaks reflecting in intense cobalt-turquoise water, framed by golden autumn larch trees and driftwood logs, 16:9."
            ),
            "caption_he": "עשר הפסגות ועצי הלגש הזהובים משתקפים במי הטורקיז של אגם מוריין",
            "caption_en": "The Valley of the Ten Peaks and golden autumn larches reflected in Moraine Lake",
        },
        {
            "prompt": (
                "Delicious travel detail photograph of a warm freshly fried Canadian BeaverTails pastry topped with cinnamon sugar "
                "and maple syrup drizzle, held in a gloved hand with picturesque Banff Avenue wooden chalets and Cascade Mountain in the background, 16:9."
            ),
            "caption_he": "מאפה BeaverTails חם עם קינמון ומייפל מול הר קסקייד בשדרה המרכזית של באנף",
            "caption_en": "Warm cinnamon-maple BeaverTails pastry with Banff Avenue and Cascade Mountain behind",
        },
    ],
    26: [
        {
            "prompt": (
                "Stunning high-angle alpine vista of Peyto Lake along the Icefields Parkway in Banff/Jasper National Park, Canada, "
                "the wolf-head-shaped lake glowing intense bright neon-turquoise surrounded by dark spruce forests and snow-covered Rocky Mountain peaks, 16:9."
            ),
            "caption_he": "אגם פייטו (Peyto Lake) בצורת ראש הזאב בוהק בטורקיז עז לאורך כביש הקרחונים",
            "caption_en": "Wolf-shaped Peyto Lake glowing intense turquoise along the Icefields Parkway",
        },
        {
            "prompt": (
                "Authentic wildlife photograph of a wild North American black bear with two cute cubs walking through golden-red autumn bushes "
                "and pine trees in a meadow along the Icefields Parkway in Jasper National Park, telephoto documentary nature shot, 16:9."
            ),
            "caption_he": "דובה שחורה ושני גורים חוצים את אחו השלכת לצד כביש הקרחונים בג'ספר!",
            "caption_en": "A wild black bear and two cubs foraging in autumn brush along the Icefields Parkway",
        },
    ],
    27: [
        {
            "prompt": (
                "Majestic rainforest waterfall photograph of Shannon Falls along the Sea-to-Sky Highway near Whistler, British Columbia, "
                "white cascading water plunging down steep granite cliffs framed by lush green western red cedar and moss-covered rocks, 16:9."
            ),
            "caption_he": "מפלי שאנון השוצפים בתוך יער הגשם הירוק לאורך כביש Sea-to-Sky",
            "caption_en": "Thundering cascades of Shannon Falls surrounded by lush British Columbia cedar forest",
        },
        {
            "prompt": (
                "Warm cozy interior photograph inside an RV camper kitchenette on a rainy evening: a steaming pan of wild mushroom pasta "
                "with fresh herbs on the stove, two glasses of red wine on the wooden counter, and raindrops on the window, 16:9."
            ),
            "caption_he": "ארוחת ערב חמה של פסטה ופטריות יער במטבחון הקראוון בלילה גשום בוויסלר",
            "caption_en": "Cooking wild mushroom pasta with red wine inside Goldie's cozy galley in Whistler",
        },
    ],
    28: [
        {
            "prompt": (
                "Scenic coastal photograph of the Stanley Park Seawall bike path in Vancouver, British Columbia: "
                "two rented bicycles parked by the stone seawall, towering red cedar trees, traditional First Nations carved wooden totem poles, "
                "and the Vancouver harbor and mountains across the water, sunny autumn day, 16:9."
            ),
            "caption_he": "שביל האופניים על חומת הים (Seawall) בסטנלי פארק מול המפרץ של ונקובר",
            "caption_en": "Cycling along the Stanley Park Seawall with harbor views and towering red cedars",
        },
        {
            "prompt": (
                "Vibrant documentary market photograph inside Granville Island Public Market in Vancouver: "
                "artisan wooden stalls overflowing with fresh red raspberries, blueberries, smoked Pacific salmon, local cheeses, and colorful bouquets, "
                "warm indoor market lighting, 16:9."
            ),
            "caption_he": "דוכני פירות היער, הגבינות והסלמון המעושן בשוק המקורה של גרנוויל איילנד",
            "caption_en": "Colorful stalls of fresh berries, artisan cheeses, and smoked salmon at Granville Island Market",
        },
    ],
    29: [
        {
            "prompt": (
                "Enchanted temperate rainforest photograph in the Hoh Rain Forest, Olympic National Park, Washington: "
                "golden morning sunbeams filtering through giant Sitka spruce and bigleaf maple trees draped in thick curtains "
                "of hanging emerald-green moss above a lush fern floor, 16:9."
            ),
            "caption_he": "וילונות הטחב הירוקים וקרני השמש ביער הגשם המכושף הוה (Hoh Rain Forest)",
            "caption_en": "Sunbeams filtering through curtains of emerald moss in the enchanted Hoh Rain Forest",
        },
        {
            "prompt": (
                "Dramatic Pacific Northwest sunset photograph at Ruby Beach in Olympic National Park, Washington: "
                "dark silhouetted sea stacks rising from the ocean surf, glowing orange and magenta sunset sky reflected in wet beach sand, "
                "and silver driftwood logs in the foreground, 16:9."
            ),
            "caption_he": "סלעי הענק (Sea Stacks) ועצי הסחף בשקיעה דרמטית על חוף רובי באוקיינוס השקט",
            "caption_en": "Towering sea stacks and wet-sand reflections at sunset on Olympic's Ruby Beach",
        },
    ],
    30: [
        {
            "prompt": (
                "Iconic maritime travel photograph from the open car deck and sun deck of a white-and-green Washington State Ferry "
                "gliding across blue Puget Sound waters toward the downtown Seattle skyline and the Space Needle under a clear sky, 16:9."
            ),
            "caption_he": "המעבורת חוצה את מפרץ פיוג'ט ישירות אל קו הרקיע וה-Space Needle של סיאטל",
            "caption_en": "Gliding across Puget Sound aboard the Bainbridge Ferry toward the Seattle skyline and Space Needle",
        },
        {
            "prompt": (
                "Lively documentary street photograph at Pike Place Market in downtown Seattle: "
                "the iconic vintage red neon 'Public Market Center' sign and clock above bustling stalls overflowing with vibrant bouquets "
                "of fresh sunflowers and dahlias, Elliott Bay water in the background, 16:9."
            ),
            "caption_he": "שלט הניאון האייקוני ודוכני הפרחים הצבעוניים בשוק פייק פלייס בסיאטל",
            "caption_en": "The iconic red neon clock and vibrant flower stalls at Seattle's Pike Place Market",
        },
    ],
}

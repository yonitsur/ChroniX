/**
 * Real Astronomical Constellations Catalog
 * Exact relative star coordinates, astronomical magnitudes, spectral colors, and line connections.
 */
export const CONSTELLATIONS = [
  {
    id: 'orion',
    nameEn: 'Orion',
    nameHe: 'אוריון',
    width: 220,
    height: 240,
    stars: [
      // 0: Head (Meissa)
      { id: 'meissa', x: 0.48, y: 0.26, mag: 3.3, name: 'Meissa' },
      // 1: Betelgeuse (left shoulder, warm supergiant)
      { id: 'betelgeuse', x: 0.33, y: 0.40, mag: 0.5, color: 'warm', name: 'Betelgeuse' },
      // 2: Bellatrix (right shoulder, blue giant)
      { id: 'bellatrix', x: 0.63, y: 0.33, mag: 1.6, color: 'blue', name: 'Bellatrix' },

      // 3, 4, 5: Left Arm & Raised Torch / Club (from Betelgeuse)
      // 3: Elbow junction
      { id: 'club_elbow', x: 0.14, y: 0.26, mag: 4.1, name: 'Mu Ori' },
      // 4: Left vertical prong tip
      { id: 'torch_tip_left', x: 0.11, y: 0.05, mag: 2.8, color: 'warm', name: 'Torch' },
      // 5: Right vertical prong tip
      { id: 'torch_tip_right', x: 0.18, y: 0.02, mag: 2.6, color: 'warm', name: 'Torch Flame' },

      // 6, 7, 8, 9, 10: Right Arm & Shield / Bow (from Bellatrix)
      // 6: Bow center / grip (connects from Bellatrix)
      { id: 'bow_mid', x: 0.86, y: 0.18, mag: 3.16, color: 'blue', name: 'Tabit' },
      // 7: Bow upper-mid
      { id: 'bow_up1', x: 0.82, y: 0.12, mag: 4.0, name: 'Pi2' },
      // 8: Bow top tip
      { id: 'bow_top', x: 0.74, y: 0.08, mag: 4.4, name: 'Pi1' },
      // 9: Bow lower-mid
      { id: 'bow_down1', x: 0.90, y: 0.36, mag: 3.7, name: 'Pi4' },
      // 10: Bow bottom tip
      { id: 'bow_bot', x: 0.86, y: 0.42, mag: 4.2, name: 'Pi5' },

      // 11, 12, 13: Orion's Belt (tilted diagonal)
      // 11: Bottom-left belt star (Alnitak)
      { id: 'alnitak', x: 0.50, y: 0.61, mag: 1.7, color: 'blue', name: 'Alnitak' },
      // 12: Middle belt star (Alnilam)
      { id: 'alnilam', x: 0.54, y: 0.58, mag: 1.6, color: 'blue', name: 'Alnilam' },
      // 13: Top-right belt star (Mintaka)
      { id: 'mintaka', x: 0.58, y: 0.54, mag: 2.2, color: 'blue', name: 'Mintaka' },

      // 14: Sword (hanging down from middle belt star Alnilam)
      { id: 'sword_nebula', x: 0.58, y: 0.69, mag: 2.4, color: 'blue', name: 'Sword (M42)' },

      // 15: Saiph (bottom-left foot)
      { id: 'saiph', x: 0.56, y: 0.88, mag: 2.0, color: 'blue', name: 'Saiph' },
      // 16: Rigel (bottom-right foot, blazing sapphire supergiant)
      { id: 'rigel', x: 0.79, y: 0.72, mag: 0.1, color: 'blue', name: 'Rigel' },
    ],
    lines: [
      // 1. Head connections (Betelgeuse to Head, Head to Bellatrix)
      [1, 0], [0, 2],

      // 2. Left Arm & Torch prongs:
      // Betelgeuse -> Elbow
      [1, 3],
      // Elbow -> Left prong
      [3, 4],
      // Elbow -> Right prong
      [3, 5],

      // 3. Right Arm & Shield / Bow:
      // Bellatrix -> Bow center
      [2, 6],
      // Bow upward curve
      [6, 7], [7, 8],
      // Bow downward curve
      [6, 9], [9, 10],

      // 4. Torso to Belt:
      // Betelgeuse -> bottom-left belt star (Alnitak)
      [1, 11],
      // Bellatrix -> top-right belt star (Mintaka)
      [2, 13],

      // 5. Belt line:
      [11, 12], [12, 13],

      // 6. Sword (from middle belt star down):
      [12, 14],

      // 7. Legs:
      // Alnitak -> Saiph
      [11, 15],
      // Saiph -> Rigel
      [15, 16],
      // Rigel -> Mintaka
      [16, 13],
    ],
  },
  {
    id: 'cassiopeia',
    nameEn: 'Cassiopeia',
    nameHe: 'קסיופיאה',
    width: 180,
    height: 110,
    stars: [
      { id: 'caph', x: 0.05, y: 0.45, mag: 2.2, name: 'Caph' },
      { id: 'schedar', x: 0.28, y: 0.72, mag: 2.2, color: 'warm', name: 'Schedar' },
      { id: 'navi', x: 0.52, y: 0.35, mag: 2.1, color: 'blue', name: 'Navi' },
      { id: 'ruchbah', x: 0.76, y: 0.62, mag: 2.6, name: 'Ruchbah' },
      { id: 'segin', x: 0.95, y: 0.22, mag: 3.3, name: 'Segin' },
    ],
    lines: [
      [0, 1], [1, 2], [2, 3], [3, 4], // The iconic 'W'
    ],
  },
  {
    id: 'ursa_major',
    nameEn: 'Ursa Major',
    nameHe: 'הדובה הגדולה',
    width: 220,
    height: 140,
    stars: [
      { id: 'dubhe', x: 0.18, y: 0.18, mag: 1.8, name: 'Dubhe' },
      { id: 'merak', x: 0.15, y: 0.62, mag: 2.3, name: 'Merak' },
      { id: 'phecda', x: 0.45, y: 0.65, mag: 2.4, name: 'Phecda' },
      { id: 'megrez', x: 0.48, y: 0.24, mag: 3.3, name: 'Megrez' },
      { id: 'alioth', x: 0.70, y: 0.20, mag: 1.7, name: 'Alioth' },
      { id: 'mizar', x: 0.85, y: 0.32, mag: 2.2, name: 'Mizar' },
      { id: 'alkaid', x: 0.98, y: 0.52, mag: 1.8, name: 'Alkaid' },
    ],
    lines: [
      [0, 1], [1, 2], [2, 3], [3, 0], // Bowl
      [3, 4], [4, 5], [5, 6],         // Handle
    ],
  },
  {
    id: 'cygnus',
    nameEn: 'Cygnus',
    nameHe: 'הברבור',
    width: 190,
    height: 180,
    stars: [
      // 0: Deneb (Alpha Cyg - Tail of the Swan / Top of Northern Cross)
      { id: 'deneb', x: 0.50, y: 0.08, mag: 1.25, color: 'blue', name: 'Deneb' },
      // 1: Sadr (Gamma Cyg - Chest / Center of Cross)
      { id: 'sadr', x: 0.50, y: 0.45, mag: 2.2, name: 'Sadr' },
      // 2: Albireo (Beta Cyg - Beak / Head of Swan)
      { id: 'albireo', x: 0.50, y: 0.95, mag: 3.0, color: 'warm', name: 'Albireo' },
      // 3: Gienah (Epsilon Cyg - Eastern wing inner)
      { id: 'gienah', x: 0.24, y: 0.52, mag: 2.4, name: 'Gienah' },
      // 4: Fawaris (Delta Cyg - Western wing inner)
      { id: 'fawaris', x: 0.76, y: 0.40, mag: 2.8, name: 'Fawaris' },
      // 5: Zeta Cyg (Eastern wingtip)
      { id: 'zeta_cyg', x: 0.06, y: 0.62, mag: 3.2, name: 'Zeta Cyg' },
      // 6: Iota Cyg (Western wingtip)
      { id: 'iota_cyg', x: 0.94, y: 0.32, mag: 3.75, name: 'Iota Cyg' },
    ],
    lines: [
      // Swan Spine (Tail -> Chest -> Beak)
      [0, 1], [1, 2],
      // Eastern Wing (Chest -> Gienah -> Wingtip)
      [1, 3], [3, 5],
      // Western Wing (Chest -> Fawaris -> Wingtip)
      [1, 4], [4, 6],
    ],
  },
  {
    id: 'sagittarius',
    nameEn: 'Sagittarius',
    nameHe: 'קשת',
    width: 190,
    height: 170,
    stars: [
      // The famous Teapot Asterism
      { id: 'alnasl', x: 0.08, y: 0.48, mag: 2.9, name: 'Alnasl' }, // Spout tip
      { id: 'kaus_med', x: 0.30, y: 0.45, mag: 2.7, name: 'Kaus Media' }, // Spout base
      { id: 'kaus_bor', x: 0.45, y: 0.18, mag: 2.8, name: 'Kaus Borealis' }, // Lid top
      { id: 'kaus_aust', x: 0.35, y: 0.82, mag: 1.8, color: 'blue', name: 'Kaus Australis' }, // Bottom bowl
      { id: 'ascella', x: 0.65, y: 0.80, mag: 2.6, name: 'Ascella' }, // Handle bottom
      { id: 'nunki', x: 0.72, y: 0.32, mag: 2.05, color: 'blue', name: 'Nunki' }, // Handle top
      { id: 'tau_sgr', x: 0.88, y: 0.52, mag: 3.3, name: 'Tau Sgr' }, // Handle outer
      { id: 'phi_sgr', x: 0.56, y: 0.35, mag: 3.1, name: 'Phi Sgr' }, // Center lid
    ],
    lines: [
      // Spout
      [0, 1],
      // Bowl & Lid (Teapot)
      [1, 2], [2, 7], [7, 1],
      [1, 3], [3, 4], [4, 7],
      // Handle
      [7, 5], [5, 6], [6, 4],
    ],
  },
  {
    id: 'ursa_minor',
    nameEn: 'Ursa Minor',
    nameHe: 'הדובה הקטנה',
    width: 170,
    height: 130,
    stars: [
      { id: 'polaris', x: 0.05, y: 0.15, mag: 1.9, color: 'blue', name: 'Polaris' },
      { id: 'yildun', x: 0.25, y: 0.28, mag: 4.3, name: 'Yildun' },
      { id: 'anwar', x: 0.45, y: 0.35, mag: 4.2, name: 'Epsilon UMi' },
      { id: 'akhfa', x: 0.62, y: 0.48, mag: 4.2, name: 'Zeta UMi' },
      { id: 'kochab', x: 0.92, y: 0.55, mag: 2.0, color: 'warm', name: 'Kochab' },
      { id: 'pherkad', x: 0.78, y: 0.82, mag: 3.0, name: 'Pherkad' },
      { id: 'yigar', x: 0.58, y: 0.75, mag: 4.9, name: 'Eta UMi' },
    ],
    lines: [
      [0, 1], [1, 2], [2, 3], // Tail from Polaris
      [3, 4], [4, 5], [5, 6], [6, 3], // Bowl
    ],
  },
  {
    id: 'leo',
    nameEn: 'Leo',
    nameHe: 'אריה',
    width: 220,
    height: 150,
    stars: [
      // 0: Regulus (Alpha Leo - Blue-white Heart of the Lion / Base of Sickle)
      { id: 'regulus', x: 0.22, y: 0.82, mag: 1.35, color: 'blue', name: 'Regulus' },
      // 1: Al Jabhah (Eta Leo - Mane base)
      { id: 'al_jabhah', x: 0.23, y: 0.65, mag: 3.48, name: 'Al Jabhah' },
      // 2: Algieba (Gamma Leo - Golden giant / Neck of Lion)
      { id: 'algieba', x: 0.28, y: 0.48, mag: 2.0, color: 'warm', name: 'Algieba' },
      // 3: Adhafera (Zeta Leo - Forehead)
      { id: 'adhafera', x: 0.35, y: 0.30, mag: 3.44, name: 'Adhafera' },
      // 4: Rasalas (Mu Leo - Crown of the Sickle)
      { id: 'rasalas', x: 0.46, y: 0.14, mag: 3.88, name: 'Rasalas' },
      // 5: Ras Elased Australis (Epsilon Leo - Snout of Lion)
      { id: 'ras_elased', x: 0.54, y: 0.22, mag: 2.98, name: 'Ras Elased' },
      // 6: Zosma (Delta Leo - Hip / Top of rear triangle)
      { id: 'zosma', x: 0.74, y: 0.42, mag: 2.56, name: 'Zosma' },
      // 7: Denebola (Beta Leo - Sapphire tail tip)
      { id: 'denebola', x: 0.95, y: 0.58, mag: 2.14, color: 'blue', name: 'Denebola' },
      // 8: Chertan (Theta Leo - Belly / Rear leg junction)
      { id: 'chertan', x: 0.72, y: 0.75, mag: 3.33, name: 'Chertan' },
    ],
    lines: [
      // The Sickle (Head & Mane)
      [0, 1], [1, 2], [2, 3], [3, 4], [4, 5],
      // Spine (Neck to Hip)
      [2, 6],
      // Rear Triangle (Hip -> Tail -> Chertan -> Hip)
      [6, 7], [7, 8], [8, 6],
      // Belly (Chertan -> Regulus)
      [8, 0],
    ],
  },
  {
    id: 'taurus',
    nameEn: 'Taurus',
    nameHe: 'השור',
    width: 220,
    height: 140,
    stars: [
      // 0: Lambda Tauri (Stem / Handle of the fork, back of the bull)
      { id: 'lambda_tau', x: 0.10, y: 0.52, mag: 3.4, name: 'Lambda Tau' },
      // 1: Gamma Tauri (Hyad 1 - Base junction of the two prongs)
      { id: 'hyad_vertex', x: 0.36, y: 0.52, mag: 3.6, name: 'Hyad Vertex' },
      // 2: Ain (Epsilon Tauri - Base of upper prong / northern eye)
      { id: 'ain', x: 0.58, y: 0.35, mag: 3.5, name: 'Ain' },
      // 3: Aldebaran (Alpha Tauri - Brilliant orange eye / base of lower prong)
      { id: 'aldebaran', x: 0.58, y: 0.68, mag: 0.85, color: 'warm', name: 'Aldebaran' },
      // 4: Elnath (Beta Tauri - Northern Horn / Tip of upper prong)
      { id: 'elnath', x: 0.92, y: 0.18, mag: 1.65, color: 'blue', name: 'Elnath' },
      // 5: Tianguan (Zeta Tauri - Southern Horn / Tip of lower prong)
      { id: 'tianguan', x: 0.94, y: 0.78, mag: 3.0, name: 'Tianguan' },
    ],
    lines: [
      // Handle (Stem of the fork)
      [0, 1],
      // Upper Prong (Junction -> Ain -> Elnath tip)
      [1, 2], [2, 4],
      // Lower Prong (Junction -> Aldebaran -> Tianguan tip)
      [1, 3], [3, 5],
    ],
  },
  {
    id: 'pegasus',
    nameEn: 'Pegasus',
    nameHe: 'פגסוס',
    width: 220,
    height: 200,
    stars: [
      // The Great Square of Pegasus:
      // 0: Markab (Alpha Peg - South-West corner / Base of neck)
      { id: 'markab', x: 0.44, y: 0.65, mag: 2.49, name: 'Markab' },
      // 1: Scheat (Beta Peg - North-West corner / Base of legs, warm red giant)
      { id: 'scheat', x: 0.46, y: 0.26, mag: 2.44, color: 'warm', name: 'Scheat' },
      // 2: Alpheratz (Alpha And / Delta Peg - North-East corner, sapphire blue)
      { id: 'alpheratz', x: 0.84, y: 0.22, mag: 2.07, color: 'blue', name: 'Alpheratz' },
      // 3: Algenib (Gamma Peg - South-East corner)
      { id: 'algenib', x: 0.82, y: 0.68, mag: 2.84, name: 'Algenib' },

      // Neck & Head (from Markab):
      // 4: Biham (Theta Peg - Neck junction)
      { id: 'biham', x: 0.25, y: 0.76, mag: 3.53, name: 'Biham' },
      // 5: Enif (Epsilon Peg - Muzzle / Nose of Pegasus, warm orange)
      { id: 'enif', x: 0.06, y: 0.92, mag: 2.38, color: 'warm', name: 'Enif' },

      // Front Legs (from Scheat):
      // 6: Matar (Eta Peg - Upper knee)
      { id: 'matar', x: 0.28, y: 0.16, mag: 2.93, name: 'Matar' },
      // 7: Pi Peg (Hoof 1)
      { id: 'pi_peg', x: 0.14, y: 0.08, mag: 4.28, name: 'Pi Peg' },
      // 8: Iota Peg (Lower knee)
      { id: 'iota_peg', x: 0.30, y: 0.34, mag: 3.77, name: 'Iota Peg' },
      // 9: Kappa Peg (Hoof 2)
      { id: 'kappa_peg', x: 0.16, y: 0.42, mag: 4.14, name: 'Kappa Peg' },
    ],
    lines: [
      // The Great Square
      [0, 1], [1, 2], [2, 3], [3, 0],
      // Neck and Head
      [0, 4], [4, 5],
      // Front Leg 1
      [1, 6], [6, 7],
      // Front Leg 2
      [1, 8], [8, 9],
    ],
  },
  {
    id: 'scorpius',
    nameEn: 'Scorpius',
    nameHe: 'עקרב',
    width: 200,
    height: 190,
    stars: [
      // The 3-star Crown / Claws:
      // 0: Graffias (Beta Sco / Acrab - Northern claw)
      { id: 'graffias', x: 0.16, y: 0.16, mag: 2.62, name: 'Graffias' },
      // 1: Dschubba (Delta Sco - Center of the Crown)
      { id: 'dschubba', x: 0.14, y: 0.28, mag: 2.29, name: 'Dschubba' },
      // 2: Pi Sco (Fang - Southern claw)
      { id: 'pi_sco', x: 0.18, y: 0.40, mag: 2.89, name: 'Pi Sco' },

      // Body & Curved Stinger:
      // 3: Antares (Alpha Sco - Glowing red supergiant Heart of the Scorpion)
      { id: 'antares', x: 0.32, y: 0.48, mag: 1.06, color: 'warm', name: 'Antares' },
      // 4: Larawag (Epsilon Sco - Upper spine)
      { id: 'larawag', x: 0.44, y: 0.62, mag: 2.29, name: 'Larawag' },
      // 5: Zeta Sco (Lower spine curve)
      { id: 'zeta_sco', x: 0.52, y: 0.78, mag: 3.62, name: 'Zeta Sco' },
      // 6: Sargas (Theta Sco - Tail base)
      { id: 'sargas', x: 0.66, y: 0.88, mag: 1.86, name: 'Sargas' },
      // 7: Iota Sco (Tail upward curve)
      { id: 'iota_sco', x: 0.78, y: 0.86, mag: 2.99, name: 'Iota Sco' },
      // 8: Shaula (Lambda Sco - Sapphire stinger tip)
      { id: 'shaula', x: 0.86, y: 0.74, mag: 1.62, color: 'blue', name: 'Shaula' },
      // 9: Lesath (Upsilon Sco - Secondary stinger star)
      { id: 'lesath', x: 0.92, y: 0.66, mag: 2.70, name: 'Lesath' },
    ],
    lines: [
      // Crown / Claws arc
      [0, 1], [1, 2],
      // Crown to Heart
      [1, 3],
      // Spine to Tail curve
      [3, 4], [4, 5], [5, 6], [6, 7], [7, 8],
      // Stinger pair
      [8, 9],
    ],
  },
  {
    id: 'canis_major',
    nameEn: 'Canis Major',
    nameHe: 'הכלב הגדול',
    width: 180,
    height: 180,
    stars: [
      // 0: Sirius (Alpha CMa - Blazing sapphire Dog Star, brightest star in the night sky)
      { id: 'sirius', x: 0.36, y: 0.22, mag: -1.46, color: 'blue', name: 'Sirius' },
      // 1: Mirzam (Beta CMa - Front foot)
      { id: 'mirzam', x: 0.16, y: 0.32, mag: 1.98, name: 'Mirzam' },
      // 2: Muliphein (Gamma CMa - Snout)
      { id: 'muliphein', x: 0.56, y: 0.18, mag: 4.11, name: 'Muliphein' },
      // 3: Wezen (Delta CMa - Torso / Hip)
      { id: 'wezen', x: 0.56, y: 0.64, mag: 1.83, name: 'Wezen' },
      // 4: Adhara (Epsilon CMa - Sapphire hind leg)
      { id: 'adhara', x: 0.42, y: 0.82, mag: 1.50, color: 'blue', name: 'Adhara' },
      // 5: Aludra (Eta CMa - Tail tip)
      { id: 'aludra', x: 0.78, y: 0.76, mag: 2.45, name: 'Aludra' },
      // 6: Furud (Zeta CMa - Hind foot)
      { id: 'furud', x: 0.30, y: 0.94, mag: 3.02, name: 'Furud' },
    ],
    lines: [
      // Front leg
      [1, 0],
      // Snout
      [0, 2],
      // Spine / Torso
      [0, 3],
      // Tail
      [3, 5],
      // Hind leg (Torso -> Adhara -> Furud foot)
      [3, 4], [4, 6],
    ],
  },
  {
    id: 'gemini',
    nameEn: 'Gemini',
    nameHe: 'תאומים',
    width: 220,
    height: 240,
    stars: [
      // Twin 1 (Castor):
      // 0: Castor (Alpha Gem - Blue-white head of Castor)
      { id: 'castor', x: 0.30, y: 0.12, mag: 1.58, color: 'blue', name: 'Castor' },
      // 1: Tau Gem (Shoulder junction)
      { id: 'tau_gem', x: 0.44, y: 0.18, mag: 4.4, name: 'Tau Gem' },
      // 2: Theta Gem (Outer arm tip)
      { id: 'theta_gem', x: 0.54, y: 0.06, mag: 3.6, name: 'Theta Gem' },
      // 3: Iota Gem (Inner hand - holding hands with Pollux)
      { id: 'iota_gem', x: 0.35, y: 0.26, mag: 3.8, name: 'Iota Gem' },
      // 4: Mebsuta (Epsilon Gem - Torso / waist)
      { id: 'mebsuta', x: 0.60, y: 0.34, mag: 3.06, name: 'Mebsuta' },
      // 5: Tejat Posterior (Mu Gem - Leg 1)
      { id: 'tejat_post', x: 0.74, y: 0.42, mag: 2.87, name: 'Tejat Posterior' },
      // 6: Propus (Eta Gem - Foot 1 tip)
      { id: 'propus', x: 0.84, y: 0.42, mag: 3.32, name: 'Propus' },
      // 7: Nu Gem (Foot 2)
      { id: 'nu_gem', x: 0.70, y: 0.50, mag: 4.14, name: 'Nu Gem' },

      // Twin 2 (Pollux):
      // 8: Pollux (Beta Gem - Warm golden head of Pollux)
      { id: 'pollux', x: 0.20, y: 0.24, mag: 1.14, color: 'warm', name: 'Pollux' },
      // 9: Upsilon Gem (Shoulder junction)
      { id: 'upsilon_gem', x: 0.27, y: 0.28, mag: 4.06, name: 'Upsilon Gem' },
      // 10: Kappa Gem (Outer arm tip)
      { id: 'kappa_gem', x: 0.20, y: 0.36, mag: 3.57, name: 'Kappa Gem' },
      // 11: Wasat (Delta Gem - Torso / waist)
      { id: 'wasat', x: 0.37, y: 0.44, mag: 3.53, name: 'Wasat' },
      // 12: Mekbuda (Zeta Gem - Leg 1 knee)
      { id: 'mekbuda', x: 0.48, y: 0.49, mag: 4.01, name: 'Mekbuda' },
      // 13: Alhena (Gamma Gem - Brilliant foot 1)
      { id: 'alhena', x: 0.65, y: 0.61, mag: 1.93, color: 'blue', name: 'Alhena' },
      // 14: Lambda Gem (Leg 2 knee)
      { id: 'lambda_gem', x: 0.37, y: 0.60, mag: 3.58, name: 'Lambda Gem' },
      // 15: Alzirr (Xi Gem - Foot 2 tip)
      { id: 'alzirr', x: 0.60, y: 0.72, mag: 3.35, name: 'Alzirr' },
    ],
    lines: [
      // Twin 1 (Castor)
      [0, 1], // Castor -> Tau
      [1, 2], // Tau -> Theta (Arm)
      [1, 3], // Tau -> Iota
      [1, 4], // Tau -> Mebsuta (Torso)
      [4, 5], // Mebsuta -> Mu
      [5, 6], // Mu -> Propus (Foot 1)
      [4, 7], // Mebsuta -> Nu (Foot 2)

      // Twin 2 (Pollux)
      [8, 9],   // Pollux -> Upsilon
      [9, 10],  // Upsilon -> Kappa (Arm)
      [9, 11],  // Upsilon -> Wasat (Torso)
      [11, 12], // Wasat -> Zeta
      [12, 13], // Zeta -> Alhena (Foot 1)
      [11, 14], // Wasat -> Lambda
      [14, 15], // Lambda -> Alzirr (Foot 2)

      // Twins holding hands in the center!
      [9, 3],   // Upsilon (Pollux) -> Iota (Castor)
    ],
  },
  {
    id: 'lyra',
    nameEn: 'Lyra',
    nameHe: 'הנבל',
    width: 150,
    height: 160,
    stars: [
      // 0: Vega (Alpha Lyr - Brilliant sapphire beacon, 5th brightest star in the sky)
      { id: 'vega', x: 0.30, y: 0.12, mag: 0.03, color: 'blue', name: 'Vega' },
      // 1: Epsilon Lyr (The famous Double Double quadruple star)
      { id: 'epsilon_lyr', x: 0.54, y: 0.16, mag: 4.67, name: 'Double Double' },
      // 2: Zeta Lyr (Rhombus corner / base of tuning triangle)
      { id: 'zeta_lyr', x: 0.44, y: 0.38, mag: 4.34, name: 'Zeta Lyr' },
      // 3: Delta Lyr (Rhombus north-east corner)
      { id: 'delta_lyr', x: 0.74, y: 0.40, mag: 4.22, name: 'Delta Lyr' },
      // 4: Sulafat (Gamma Lyr - South-east corner)
      { id: 'sulafat', x: 0.76, y: 0.80, mag: 3.25, name: 'Sulafat' },
      // 5: Sheliak (Beta Lyr - South-west corner, eclipsing binary)
      { id: 'sheliak', x: 0.46, y: 0.84, mag: 3.52, name: 'Sheliak' },
    ],
    lines: [
      // Tuning Head Triangle
      [0, 1], [1, 2], [2, 0],
      // Harp Rhombus
      [2, 3], [3, 4], [4, 5], [5, 2],
    ],
  },
  {
    id: 'bootes',
    nameEn: 'Bootes',
    nameHe: 'הרועה',
    width: 170,
    height: 200,
    stars: [
      { id: 'arcturus', x: 0.50, y: 0.88, mag: -0.05, color: 'warm', name: 'Arcturus' },
      { id: 'izar', x: 0.72, y: 0.60, mag: 2.3, name: 'Izar' },
      { id: 'muphrid', x: 0.25, y: 0.82, mag: 2.6, name: 'Muphrid' },
      { id: 'seginus', x: 0.28, y: 0.25, mag: 3.0, name: 'Seginus' },
      { id: 'nekkar', x: 0.52, y: 0.10, mag: 3.4, name: 'Nekkar' },
      { id: 'princeps', x: 0.76, y: 0.32, mag: 3.4, name: 'Princeps' },
    ],
    lines: [
      [0, 1], [0, 2], [1, 5], [5, 4], [4, 3], [3, 0],
    ],
  },
  {
    id: 'pleiades',
    nameEn: 'Pleiades',
    nameHe: 'כימה',
    width: 130,
    height: 95,
    stars: [
      // The 7 Sisters / Micro-dipper asterism
      { id: 'alcyone', x: 0.55, y: 0.50, mag: 1.8, color: 'blue', name: 'Alcyone' },
      { id: 'atlas', x: 0.88, y: 0.60, mag: 2.3, color: 'blue', name: 'Atlas' },
      { id: 'pleione', x: 0.90, y: 0.42, mag: 3.1, color: 'blue', name: 'Pleione' },
      { id: 'electra', x: 0.18, y: 0.40, mag: 2.4, color: 'blue', name: 'Electra' },
      { id: 'maia', x: 0.38, y: 0.22, mag: 2.5, color: 'blue', name: 'Maia' },
      { id: 'merope', x: 0.34, y: 0.74, mag: 2.7, color: 'blue', name: 'Merope' },
      { id: 'taygeta', x: 0.16, y: 0.22, mag: 2.9, color: 'blue', name: 'Taygeta' },
    ],
    lines: [
      // Cup
      [3, 6], [6, 4], [4, 0], [0, 5], [5, 3],
      // Handle
      [0, 1], [1, 2],
    ],
  },
  {
    id: 'aries',
    nameEn: 'Aries',
    nameHe: 'טלה',
    width: 135,
    height: 85,
    stars: [
      // 0: Mesarthim (Gamma Arietis - double star)
      { id: 'mesarthim', x: 0.15, y: 0.70, mag: 3.88, color: 'blue', name: 'Mesarthim' },
      // 1: Sheratan (Beta Arietis - blue-white horn base)
      { id: 'sheratan', x: 0.35, y: 0.56, mag: 2.64, color: 'blue', name: 'Sheratan' },
      // 2: Hamal (Alpha Arietis - glowing warm golden-yellow giant)
      { id: 'hamal', x: 0.66, y: 0.32, mag: 2.00, color: 'warm', name: 'Hamal' },
      // 3: Botein (Delta Arietis - horn tip)
      { id: 'botein', x: 0.88, y: 0.40, mag: 4.35, name: 'Botein' },
    ],
    lines: [
      [0, 1], [1, 2], [2, 3], // The classic curved ram horn arc
    ],
  },
  {
    id: 'corona_borealis',
    nameEn: 'Corona Borealis',
    nameHe: 'כתר צפוני',
    width: 130,
    height: 85,
    stars: [
      // Semicircular celestial tiara / crown
      { id: 'theta_crb', x: 0.14, y: 0.36, mag: 4.14, name: 'Theta CrB' },
      { id: 'nusakan', x: 0.30, y: 0.62, mag: 3.68, name: 'Nusakan' },
      { id: 'alphecca', x: 0.50, y: 0.72, mag: 2.22, color: 'blue', name: 'Alphecca (Gemma)' },
      { id: 'gamma_crb', x: 0.70, y: 0.62, mag: 3.81, name: 'Gamma CrB' },
      { id: 'delta_crb', x: 0.86, y: 0.36, mag: 4.59, name: 'Delta CrB' },
    ],
    lines: [
      [0, 1], [1, 2], [2, 3], [3, 4], // The iconic tiara arc
    ],
  },
  {
    id: 'delphinus',
    nameEn: 'Delphinus',
    nameHe: 'דולפין',
    width: 100,
    height: 130,
    stars: [
      { id: 'sualocin', x: 0.54, y: 0.16, mag: 3.77, color: 'blue', name: 'Sualocin' },
      { id: 'rotanev', x: 0.68, y: 0.40, mag: 3.63, name: 'Rotanev' },
      { id: 'gamma_del', x: 0.14, y: 0.12, mag: 4.27, color: 'warm', name: 'Gamma Del' },
      { id: 'delta_del', x: 0.33, y: 0.31, mag: 4.43, name: 'Delta Del' },
      { id: 'epsilon_del', x: 0.93, y: 0.89, mag: 4.03, color: 'blue', name: 'Epsilon Del' },
    ],
    lines: [[0, 2], [2, 3], [3, 1], [1, 0], [1, 4]],
  },
  {
    id: 'triangulum',
    nameEn: 'Triangulum',
    nameHe: 'משולש',
    width: 95,
    height: 110,
    stars: [
      { id: 'mothallah', x: 0.82, y: 0.84, mag: 3.42, name: 'Mothallah' },
      { id: 'beta_tri', x: 0.38, y: 0.14, mag: 3.00, name: 'Beta Tri' },
      { id: 'gamma_tri', x: 0.18, y: 0.28, mag: 4.01, name: 'Gamma Tri' },
    ],
    lines: [[0, 1], [1, 2], [2, 0]],
  },
  {
    id: 'sagitta',
    nameEn: 'Sagitta',
    nameHe: 'חץ',
    width: 120,
    height: 80,
    stars: [
      { id: 'sham', x: 0.88, y: 0.78, mag: 4.37, name: 'Sham' },
      { id: 'beta_sge', x: 0.78, y: 0.92, mag: 4.39, name: 'Beta Sge' },
      { id: 'delta_sge', x: 0.53, y: 0.58, mag: 3.68, color: 'warm', name: 'Delta Sge' },
      { id: 'gamma_sge', x: 0.12, y: 0.14, mag: 3.47, color: 'warm', name: 'Gamma Sge' },
    ],
    lines: [[0, 2], [1, 2], [2, 3]],
  },
  {
    id: 'equuleus',
    nameEn: 'Equuleus',
    nameHe: 'סוסון',
    width: 95,
    height: 110,
    stars: [
      { id: 'kitalpha', x: 0.55, y: 0.88, mag: 3.92, name: 'Kitalpha' },
      { id: 'delta_equ', x: 0.29, y: 0.18, mag: 4.49, name: 'Delta Equ' },
      { id: 'gamma_equ', x: 0.78, y: 0.16, mag: 4.69, name: 'Gamma Equ' },
      { id: 'beta_equ', x: 0.12, y: 0.61, mag: 5.16, name: 'Beta Equ' },
    ],
    lines: [[0, 3], [3, 1], [1, 2], [2, 0]],
  },
  {
    id: 'monoceros',
    nameEn: 'Monoceros',
    nameHe: 'חד קרן',
    width: 110,
    height: 90,
    stars: [
      { id: 'alpha_mon', x: 0.14, y: 0.86, mag: 3.94, color: 'warm', name: 'Alpha Mon' },
      { id: 'beta_mon', x: 0.77, y: 0.63, mag: 3.74, color: 'blue', name: 'Beta Mon' },
      { id: 'gamma_mon', x: 0.91, y: 0.56, mag: 3.99, color: 'warm', name: 'Gamma Mon' },
      { id: 'delta_mon', x: 0.39, y: 0.14, mag: 4.15, name: 'Delta Mon' },
    ],
    lines: [[0, 1], [1, 2], [1, 3]],
  },
  {
    id: 'cancer',
    nameEn: 'Cancer',
    nameHe: 'סרטן',
    width: 110,
    height: 90,
    stars: [
      { id: 'acubens', x: 0.50, y: 0.86, mag: 3.53, name: 'Acubens' },
      { id: 'asellus_borealis', x: 0.42, y: 0.32, mag: 4.66, name: 'Asellus Borealis' },
      { id: 'asellus_australis', x: 0.58, y: 0.42, mag: 3.94, color: 'warm', name: 'Asellus Australis' },
      { id: 'al_tarf', x: 0.12, y: 0.55, mag: 3.52, color: 'warm', name: 'Al Tarf' },
      { id: 'iota_cnc', x: 0.30, y: 0.10, mag: 4.02, color: 'warm', name: 'Iota Cnc' },
    ],
    lines: [[3, 2], [2, 1], [1, 4], [2, 0]],
  },
  {
    id: 'virgo',
    nameEn: 'Virgo',
    nameHe: 'בתולה',
    width: 170,
    height: 160,
    stars: [
      // Official Y-shaped asterism: Spica anchors the tail, Porrima is the junction,
      // one branch rises to Vindemiatrix, the other to Zaniah/Zavijava.
      { id: 'spica', x: 0.55, y: 0.95, mag: 1.04, color: 'blue', name: 'Spica' },
      { id: 'auva', x: 0.50, y: 0.70, mag: 3.38, name: 'Auva' },
      { id: 'porrima', x: 0.45, y: 0.45, mag: 2.74, name: 'Porrima' },
      { id: 'vindemiatrix', x: 0.75, y: 0.20, mag: 2.85, color: 'warm', name: 'Vindemiatrix' },
      { id: 'zaniah', x: 0.20, y: 0.35, mag: 3.89, name: 'Zaniah' },
      { id: 'zavijava', x: 0.05, y: 0.10, mag: 3.61, name: 'Zavijava' },
    ],
    lines: [[0, 1], [1, 2], [2, 3], [2, 4], [4, 5]],
  },
  {
    id: 'libra',
    nameEn: 'Libra',
    nameHe: 'מאזניים',
    width: 120,
    height: 95,
    stars: [
      { id: 'zubenelgenubi', x: 0.12, y: 0.62, mag: 2.75, color: 'blue', name: 'Zubenelgenubi' },
      { id: 'zubeneschamali', x: 0.55, y: 0.15, mag: 2.61, color: 'blue', name: 'Zubeneschamali' },
      { id: 'brachium', x: 0.85, y: 0.55, mag: 3.29, name: 'Brachium' },
      { id: 'zubenelakrab', x: 0.50, y: 0.85, mag: 3.91, name: 'Zubenelakrab' },
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0]],
  },
  {
    id: 'capricornus',
    nameEn: 'Capricornus',
    nameHe: 'גדי',
    width: 150,
    height: 70,
    stars: [
      // Official "sea-goat" boat/triangle outline: Algedi-Dabih tip, long edges to Nashira-Deneb Algedi.
      { id: 'algedi', x: 0.06, y: 0.35, mag: 3.57, name: 'Algedi' },
      { id: 'dabih', x: 0.10, y: 0.75, mag: 3.08, color: 'warm', name: 'Dabih' },
      { id: 'nashira', x: 0.88, y: 0.30, mag: 3.68, name: 'Nashira' },
      { id: 'deneb_algedi', x: 0.95, y: 0.68, mag: 2.87, name: 'Deneb Algedi' },
    ],
    lines: [[0, 1], [0, 2], [2, 3], [3, 1]],
  },
  {
    id: 'aquarius',
    nameEn: 'Aquarius',
    nameHe: 'דלי',
    width: 160,
    height: 130,
    stars: [
      { id: 'sadalsuud', x: 0.20, y: 0.25, mag: 2.87, color: 'warm', name: 'Sadalsuud' },
      { id: 'sadalmelik', x: 0.45, y: 0.10, mag: 2.95, color: 'warm', name: 'Sadalmelik' },
      { id: 'sadachbia', x: 0.65, y: 0.45, mag: 3.84, name: 'Sadachbia' },
      { id: 'skat', x: 0.55, y: 0.85, mag: 3.27, name: 'Skat' },
      { id: 'albali', x: 0.15, y: 0.60, mag: 3.77, name: 'Albali' },
    ],
    lines: [[0, 1], [0, 4], [0, 2], [2, 3]],
  },
  {
    id: 'pisces',
    nameEn: 'Pisces',
    nameHe: 'דגים',
    width: 180,
    height: 100,
    stars: [
      { id: 'alrescha', x: 0.50, y: 0.50, mag: 3.82, name: 'Alrescha' },
      { id: 'eta_psc', x: 0.12, y: 0.30, mag: 3.62, color: 'warm', name: 'Eta Psc' },
      { id: 'omega_psc', x: 0.05, y: 0.55, mag: 4.03, name: 'Omega Psc' },
      { id: 'gamma_psc', x: 0.90, y: 0.20, mag: 3.70, name: 'Gamma Psc' },
      { id: 'iota_psc', x: 0.85, y: 0.45, mag: 4.13, name: 'Iota Psc' },
    ],
    lines: [[0, 1], [1, 2], [0, 3], [3, 4]],
  },
  {
    id: 'horologium',
    nameEn: 'Horologium',
    nameHe: 'שעון מטוטלת',
    width: 100,
    height: 130,
    stars: [
      // Matches the reference chart's hook/pendulum chain: isolated Alpha, a tight curved
      // link, then a tail down to the variable star R Hor.
      { id: 'alpha_hor', x: 0.09, y: 0.08, mag: 3.85, color: 'warm', name: 'Alpha Hor' },
      { id: 'delta_hor', x: 0.76, y: 0.37, mag: 4.93, name: 'Delta Hor' },
      { id: 'nu_hor', x: 0.85, y: 0.42, mag: 4.75, name: 'Nu Hor' },
      { id: 'mu_hor', x: 0.87, y: 0.50, mag: 5.11, name: 'Mu Hor' },
      { id: 'beta_hor', x: 0.83, y: 0.58, mag: 4.98, name: 'Beta Hor' },
      { id: 'iota_hor', x: 0.66, y: 0.77, mag: 5.40, name: 'Iota Hor' },
      { id: 'r_hor', x: 0.66, y: 0.94, mag: 4.95, color: 'warm', name: 'R Horologii' },
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]],
  },
  {
    id: 'centaurus',
    nameEn: 'Centaurus',
    nameHe: 'קנטאור',
    width: 220,
    height: 220,
    stars: [
      // Matches the reference chart's 14-star figure: forked front legs (pointer stars)
      // at bottom-left, a spine rising through the body/shoulder fork, and hind legs to the right.
      { id: 'hadar', x: 0.195, y: 0.87, mag: 0.61, color: 'blue', name: 'Hadar' },
      { id: 'alpha_cen', x: 0.27, y: 0.848, mag: -0.27, color: 'warm', name: 'Alpha Centauri' },
      { id: 'menkent', x: 0.2375, y: 0.278, mag: 2.06, name: 'Menkent' },
      { id: 'epsilon_cen', x: 0.675, y: 0.424, mag: 2.30, color: 'blue', name: 'Epsilon Cen' },
      { id: 'zeta_cen', x: 0.42, y: 0.489, mag: 2.55, name: 'Zeta Cen' },
      { id: 'eta_cen', x: 0.1425, y: 0.374, mag: 2.31, color: 'blue', name: 'Eta Cen' },
      { id: 'gamma_cen', x: 0.35, y: 0.435, mag: 2.20, color: 'blue', name: 'Gamma Cen' },
      { id: 'delta_cen', x: 0.80, y: 0.446, mag: 2.58, color: 'blue', name: 'Delta Cen' },
      { id: 'iota_cen', x: 0.5125, y: 0.283, mag: 2.75, name: 'Iota Cen' },
      { id: 'mu_cen', x: 0.045, y: 0.413, mag: 3.04, name: 'Mu Cen' },
      { id: 'nu_cen', x: 0.37, y: 0.337, mag: 3.41, color: 'blue', name: 'Nu Cen' },
      { id: 'lambda_cen', x: 0.38, y: 0.380, mag: 3.13, name: 'Lambda Cen' },
      { id: 'kappa_cen', x: 0.825, y: 0.587, mag: 3.13, name: 'Kappa Cen' },
      { id: 'xi_cen', x: 0.70, y: 0.467, mag: 4.27, name: 'Xi Cen' },
    ],
    lines: [
      [1, 0], [0, 4], [4, 6], [6, 11], [11, 5], [5, 9],
      [11, 10], [10, 8], [6, 3], [3, 12], [3, 7], [7, 12],
    ],
  },
];


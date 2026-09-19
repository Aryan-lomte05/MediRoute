# MediRoute — Figma Design Guide
## How to Create the UI/UX Prototype (For Neil)

---

## Step 0: Setup

1. Go to **figma.com** → Sign up free (Education plan available)
2. Create new project: **"MediRoute — Emergency Response Platform"**
3. Create a new file: **"MediRoute UI Prototype"**
4. Set frame size: **390 × 844** (iPhone 14 Pro) for mobile views
5. Also create **1440 × 900** frames for landing page desktop

---

## Step 1: Design System Setup

Before making any screens, set up the design system:

### Color Styles (add these in Figma)
| Name | Hex | Usage |
|---|---|---|
| `Emergency/Default` | `#FF2D4A` | Primary action, SOS, ESI-1 |
| `Emergency/Dark` | `#CC1535` | Hover states |
| `Cyber/Default` | `#00F5FF` | Ambulance, secondary accent |
| `Pulse/Default` | `#7C3AED` | Hospital, purple accent |
| `Orange/Alert` | `#FF8C00` | ESI-2, warnings |
| `Success` | `#00C851` | Available status, ESI-4 |
| `Surface/Default` | `#0A0A0F` | Page background |
| `Surface/Card` | `#0F0F1A` | Card background |
| `Surface/Elevated` | `#161625` | Input, elevated elements |
| `Surface/Border` | `#1E1E35` | Card borders |
| `Text/Primary` | `#FFFFFF` | Headings |
| `Text/Secondary` | `#FFFFFF80` | Body text (50% opacity) |
| `Text/Muted` | `#FFFFFF40` | Labels (25% opacity) |

### Text Styles
| Style Name | Font | Size | Weight |
|---|---|---|---|
| `Display/Hero` | Rajdhani | 64px | Bold 700 |
| `Display/H1` | Rajdhani | 48px | SemiBold 600 |
| `Display/H2` | Rajdhani | 32px | SemiBold 600 |
| `Body/Large` | Inter | 18px | Regular 400 |
| `Body/Default` | Inter | 16px | Regular 400 |
| `Body/Small` | Inter | 14px | Regular 400 |
| `Caption` | Inter | 12px | Regular 400 |
| `Mono/Default` | JetBrains Mono | 12px | Regular 400 |
| `Mono/Bold` | JetBrains Mono | 12px | Medium 500 |

> **Install fonts in Figma:** Use the Figma Font Installer desktop app to use Inter, Rajdhani, JetBrains Mono from Google Fonts

### Effects to Add
- **Card Shadow:** `0px 0px 40px rgba(255, 45, 74, 0.1)` (for emergency cards)
- **Glow Red:** `0px 0px 20px rgba(255, 45, 74, 0.4)` (for SOS button)
- **Glow Cyan:** `0px 0px 20px rgba(0, 245, 255, 0.4)` (for ambulance markers)
- **Blur Background:** `backdrop-filter: blur(20px)` → use Figma "Background Blur" effect

---

## Step 2: Component Library (Create These First)

### Component 1: Glass Card
- Rectangle: `Surface/Card` fill, 16px corner radius
- Border: 1px `Surface/Border`
- Optional: Add soft inner glow using Fill with gradient (transparent to Surface/Card)

### Component 2: ESI Badge
Create 5 variants (ESI 1–5):
- ESI 1: Background `Emergency/Default` 20% opacity, Border `Emergency/Default` 40%, Text `#FF2D4A`
- ESI 2: Orange variant
- ESI 3: Yellow variant
- ESI 4: Green variant
- ESI 5: Blue variant
- Size: Auto width, 24px height, 8px horizontal padding, 8px border radius

### Component 3: Primary Button (SOS/Emergency)
- Background: `Emergency/Default`
- Shadow: Glow Red effect
- Corner radius: 12px
- Padding: 16px 32px
- Text: White, Display/H3, 16px

### Component 4: Ghost Button
- Background: Transparent
- Border: 1px `#FFFFFF20`
- Hover border: `Cyber/Default`
- Corner radius: 12px

### Component 5: Input Field
- Background: `Surface/Elevated`
- Border: 1px `Surface/Border`
- Corner radius: 12px
- Focus border: `Emergency/Default` 60%
- Placeholder text: `Text/Muted`

### Component 6: Pulse Dot Indicator
- Circle 8px × 8px
- Fill: `Emergency/Default`
- Add "Ping" animation variant (larger circle 16px, opacity 30%)

### Component 7: Status Bar
- Horizontal bar, 4px height
- Fill: Linear gradient Left→Right: `Emergency/Default` to `Cyber/Default`

### Component 8: Nav Bar
- Full width, 60px height
- Background: `Surface/Default` 95% opacity + Background Blur 20px
- Border Bottom: 1px `Surface/Border`
- Logo left, actions right

### Component 9: Portal Tab Bar
- Full width, 64px height, 3–4 tabs
- Active: `Emergency/Default` text + 2px bottom border
- Inactive: `Text/Muted`

### Component 10: Metric Card
- Glass Card base
- Top accent line: Emergency Red gradient
- Large number (Display/H1) in accent color
- Label below in Caption style

---

## Step 3: Screens to Design (12 Total)

### Screen 1: Landing Page — Hero (1440 × 900)
**Elements:**
- Black background with subtle grid dots (use dots pattern in Figma)
- Center: Large circle representing the 3D globe (dark blue gradient sphere)
  - Add glowing dots on sphere surface (red + cyan circles)
  - Curved dashed lines between dots (animated route arcs)
  - Outer glow: Soft red radial gradient behind sphere
- Nav bar at top
- Hero text: "Every Second" (white) / "Saves a Life." (red gradient text)
- Sub headline in `Body/Large` white 50% opacity
- Two buttons: "🚨 Launch MediRoute" (Emergency red) + "See How It Works" (Ghost)
- Floating stat cards below globe

### Screen 2: Landing Page — Features Section (1440 × 900)
**Elements:**
- Section heading: "Next-Gen" + "Intelligence" (cyan gradient)
- 6 feature cards in 3×2 grid (Glass Card)
- Each card: Accent icon box + title + description
- Subtle top border glow on each card (colored by feature type)

### Screen 3: Login Page (390 × 844)
**Elements:**
- Black background with subtle red radial glow center
- MediRoute logo + wordmark centered
- Glass Card containing:
  - Toggle pills: "Sign In" | "Register" (active = red fill)
  - Role grid (2×2): Patient 🆘 | Paramedic 🚑 | Hospital 🏥 | Admin 📊
  - Email + Password inputs
  - "Enter Platform →" red button
- 1-Click Demo Login badges for quick evaluation

### Screen 4: Patient Portal — SOS Tab (390 × 844)
**Elements:**
- Dark header with MediRoute logo
- Tab bar: SOS (active) | Track | Profile
- Large circle SOS button (center, 176px):
  - Red radial gradient fill
  - Pulsing ring animation (show 2 rings at different scales/opacity)
  - Red glow box shadow
  - 🆘 icon + "SOS" text inside
- AI Voice Triage card below:
  - "AI Voice Triage" heading
  - "Describe emergency by voice for instant ESI scoring"
  - 🎙️ "Start" button (red)
- Text area: "Chief Complaint" input

### Screen 5: Patient Portal — Track Tab (390 × 844)
**Elements:**
- Full-width dark map (use Figma's dark map mockup or dark rectangle)
  - Dark buildings represented as dark grey rectangles at angle
  - Blue glowing route line
  - Red pulsing dot (patient location)
  - Cyan circle with 🚑 (ambulance)
- Bottom panel:
  - Incident number (mono text)
  - Status: "Ambulance En Route" (white headline)
  - ESI badge
  - Ambulance card (cyan accent)
  - Hospital card
  - Status timeline (checkboxes)

### Screen 6: Patient Portal — SOS Active State (390 × 844)
- Same as Screen 4 but button is dimmed/disabled
- Toast notification visible at top: "🚨 SOS sent! Finding nearest ambulance..."
- ESI result card visible: "ESI Level 2 — EMERGENT — 94% confidence"

### Screen 7: Paramedic Portal — Dispatch (390 × 844)
**Elements:**
- Header with ambulance icon, "GPS Active" with cyan pulse dot
- Dispatch banner (red background strip): Active Dispatch + incident # + ESI badge
- Tab bar: Dispatch | Navigate | Vitals
- Incident details glass card
- Status update 2×2 button grid (En Route / At Patient / To Hospital / Arrived)

### Screen 8: Paramedic Portal — Navigate Tab (390 × 844)
**Elements:**
- Almost full-screen dark 3D map (pitch 60°)
- 3D buildings in very dark grey
- Bright red glowing route line with thick glow
- Blue ambulance marker
- Red destination marker
- ETA chip at bottom: "⏱ 8 min — 4.2 km"

### Screen 9: Hospital Portal — ER Feed (390 × 844)
**Elements:**
- Header: Hospital name + "✅ OPEN" green badge + "ER Wait: 12min"
- Tabs: Feed (2) | Live Map | Resources
- 2 patient cards:
  - Card 1 (red left border): ESI-1 CRITICAL badge, Patient name, "Chest pain radiating to arm", vitals row (HR: 118, SpO₂: 92%, RR: 24), AI summary, "Pre-Accept ✓" button
  - Card 2 (orange left border): ESI-2 EMERGENT badge

### Screen 10: Hospital Portal — Resources Tab (390 × 844)
**Elements:**
- Resource cards with progress bars:
  - ICU Beds: 3/20 (red bar — critical)
  - Trauma Beds: 1/10 (red)
  - General Beds: 30/100 (green)
  - Ventilators: 4/15 (yellow)
- Duty physicians list

### Screen 11: Admin Portal — Dashboard (390 × 844)
**Elements:**
- 2×2 stat card grid:
  - "847" Total Incidents (red)
  - "12" Active Now (cyan)
  - "39" Today (purple)
  - "835" Completed (green)
- Fleet status bar (green/orange/grey segments)
- ESI pie chart
- Recent incidents list (compact)

### Screen 12: Admin Portal — Surge Forecast (390 × 844)
**Elements:**
- "Surge Forecast" heading + "TFT Model" purple badge
- Area chart (12h): Red filled area with glow, Cyan dashed line
- 3 metric chips: Peak Hour, Peak Load %, Avg Confidence
- High risk periods list with red badges

---

## Step 4: Prototyping Connections

Set up these click interactions:
1. Landing "Launch MediRoute" → Login screen
2. Login "Enter Platform" → Patient Portal (SOS tab)
3. Patient SOS tab → (after tap) → SOS Active state
4. Patient tab "Track" → Track tab
5. Patient tab "Profile" → Profile tab
6. Hospital card "Pre-Accept" → success toast overlay
7. Admin tab "Surge" → Surge forecast screen
8. Back navigation throughout

---

## Step 5: Export & Share

1. **Share for presentation:** Top right "Share" → "Anyone with link can view" → Copy link
2. **Export screens:** Select frame → Right panel → "Export" → PNG 2x
3. **Present mode:** Click Play ▶ button to show as interactive prototype
4. **Embed in PPT:** Use "Publish to web" or screenshot each frame at 2x

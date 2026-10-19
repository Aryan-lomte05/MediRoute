/**
 * ==============================================================================
 * MEDIROUTE - LANGUAGE SUPPORT (lib/i18n.jsx)
 * ==============================================================================
 *
 * WHAT IS WHERE:
 * - Line 40-70:    LANGUAGES - the languages offered and their metadata
 * - Line 72-120:   Store - the chosen language, persisted per device
 * - Line 122-170:  useT() - the translation hook, and t(key, vars)
 * - Line 172-200:  LanguageSwitcher - the control shown in page headers
 * - Line 202+:     STRINGS - every translated string, grouped by surface
 *
 * WHY THIS EXISTS:
 * The people most likely to need this product are the least likely to read
 * English comfortably. An emergency page that a caller cannot read is not an
 * emergency page. Mumbai's common languages are covered first.
 *
 * HOW IT DEGRADES:
 * A missing translation falls back to English rather than rendering a key, so
 * a partially translated surface stays usable. `t()` never throws and never
 * returns undefined.
 *
 * ADDING A LANGUAGE:
 * Add it to LANGUAGES, then add that code to the entries in STRINGS. Anything
 * not yet translated falls back, so a language can be added incrementally.
 * ==============================================================================
 */

import { createContext, useContext, useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ──────────────────────────────────────────────────────────────────────────────
// LANGUAGES
// ──────────────────────────────────────────────────────────────────────────────

/**
 * `speech` is the BCP-47 tag handed to the browser's speech APIs and to the
 * telephony voice agent, so a caller is answered in the language they used.
 */
export const LANGUAGES = [
  { code: 'en', label: 'English', native: 'English', speech: 'en-IN' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी', speech: 'hi-IN' },
  { code: 'mr', label: 'Marathi', native: 'मराठी', speech: 'mr-IN' },
  { code: 'gu', label: 'Gujarati', native: 'ગુજરાતી', speech: 'gu-IN' },
  { code: 'ta', label: 'Tamil', native: 'தமிழ்', speech: 'ta-IN' },
  { code: 'bn', label: 'Bengali', native: 'বাংলা', speech: 'bn-IN' },
]

export const DEFAULT_LANGUAGE = 'en'

/** Guess from the browser, so a first visit is already in the right language. */
function detectLanguage() {
  try {
    const navLangs = navigator.languages || [navigator.language]
    for (const raw of navLangs) {
      const code = String(raw).toLowerCase().split('-')[0]
      if (LANGUAGES.some((l) => l.code === code)) return code
    }
  } catch {
    // Storage or navigator unavailable; English is a safe default.
  }
  return DEFAULT_LANGUAGE
}

// ──────────────────────────────────────────────────────────────────────────────
// STORE
// ──────────────────────────────────────────────────────────────────────────────

export const useLanguageStore = create(
  persist(
    (set) => ({
      language: detectLanguage(),
      setLanguage: (code) => {
        set({ language: code })
        // Keep the document in step, which matters for screen readers and for
        // the browser's own font selection on Indic scripts.
        try {
          document.documentElement.lang = code
        } catch {
          /* no document in tests */
        }
      },
    }),
    { name: 'mediroute-language' }
  )
)

// ──────────────────────────────────────────────────────────────────────────────
// TRANSLATION
// ──────────────────────────────────────────────────────────────────────────────

const I18nContext = createContext(null)

/**
 * Look a key up, falling back to English, then to the key's own last segment
 * so a missing string still reads as words rather than as `sos.title`.
 */
function lookup(key, lang) {
  const entry = STRINGS[key]
  if (!entry) {
    // Unknown key: show something human rather than a dotted path.
    return key.split('.').pop().replace(/([A-Z])/g, ' $1').toLowerCase()
  }
  return entry[lang] ?? entry[DEFAULT_LANGUAGE] ?? key
}

/**
 * The translation hook.
 *
 * @returns {{t: (key: string, vars?: object) => string, language: string,
 *            speechTag: string, setLanguage: (code: string) => void}}
 */
export function useT() {
  const language = useLanguageStore((s) => s.language)
  const setLanguage = useLanguageStore((s) => s.setLanguage)

  return useMemo(() => {
    const t = (key, vars) => {
      let out = lookup(key, language)
      if (vars) {
        // {name} style placeholders, so a translator can move them around.
        for (const [k, v] of Object.entries(vars)) {
          out = out.split(`{${k}}`).join(String(v))
        }
      }
      return out
    }

    const meta = LANGUAGES.find((l) => l.code === language) || LANGUAGES[0]
    return { t, language, setLanguage, speechTag: meta.speech, languageLabel: meta.native }
  }, [language, setLanguage])
}

export function I18nProvider({ children }) {
  const value = useT()
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  return useContext(I18nContext) || useT()
}

// ──────────────────────────────────────────────────────────────────────────────
// LANGUAGE SWITCHER
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Shown in every page header.
 *
 * A native select is used on purpose: it is keyboard accessible for free, it
 * renders in the platform's own language list on a phone, and it needs no
 * portal or focus trap on a page that may be used under stress.
 */
export function LanguageSwitcher({ className = '', compact = false }) {
  const { language, setLanguage } = useI18n()

  return (
    <label className={`relative inline-flex items-center ${className}`}>
      <span className="sr-only">Choose language</span>
      <select
        value={language}
        onChange={(e) => setLanguage(e.target.value)}
        aria-label="Choose language"
        className={`appearance-none rounded-xl border border-white/15 bg-white/[0.04] hover:border-white/35 text-white/80 cursor-pointer transition-colors focus:outline-none focus:border-cyan-400/60 ${
          compact ? 'py-1.5 pl-2.5 pr-7 text-[11px]' : 'py-2 pl-3 pr-8 text-sm'
        }`}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} className="bg-[#12121c] text-white">
            {l.native}
          </option>
        ))}
      </select>
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute text-white/40 ${compact ? 'right-2 text-[9px]' : 'right-3 text-[10px]'}`}
      >
        ▼
      </span>
    </label>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// STRINGS
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Every translated string.
 *
 * Keys are grouped by surface. Clinical wording was translated for meaning
 * rather than word by word: "Most urgent" is what a person needs to
 * understand, not a literal rendering of an Emergency Severity Index level.
 */
export const STRINGS = {
  // ── Shared ───────────────────────────────────────────────────────────────
  'common.back': { en: 'Back', hi: 'वापस', mr: 'मागे', gu: 'પાછળ', ta: 'பின்', bn: 'ফিরে' },
  'common.continue': { en: 'Continue', hi: 'आगे बढ़ें', mr: 'पुढे चला', gu: 'આગળ વધો', ta: 'தொடரவும்', bn: 'এগিয়ে যান' },
  'common.close': { en: 'Close', hi: 'बंद करें', mr: 'बंद करा', gu: 'બંધ કરો', ta: 'மூடு', bn: 'বন্ধ করুন' },
  'common.optional': { en: 'optional', hi: 'वैकल्पिक', mr: 'ऐच्छिक', gu: 'વૈકલ્પિક', ta: 'விருப்பம்', bn: 'ঐচ্ছিক' },
  'common.yes': { en: 'Yes', hi: 'हाँ', mr: 'होय', gu: 'હા', ta: 'ஆம்', bn: 'হ্যাঁ' },
  'common.no': { en: 'No', hi: 'नहीं', mr: 'नाही', gu: 'ના', ta: 'இல்லை', bn: 'না' },
  'common.notSure': { en: 'Not sure', hi: 'पता नहीं', mr: 'माहीत नाही', gu: 'ખબર નથી', ta: 'தெரியவில்லை', bn: 'জানি না' },
  'common.sending': { en: 'Sending…', hi: 'भेजा जा रहा है…', mr: 'पाठवत आहे…', gu: 'મોકલી રહ્યા છીએ…', ta: 'அனுப்புகிறது…', bn: 'পাঠানো হচ্ছে…' },

  // ── Emergency banner ─────────────────────────────────────────────────────
  'banner.call': {
    en: 'Life-threatening and need to speak to someone? Tap to call 108',
    hi: 'जान को खतरा है और किसी से बात करनी है? 108 पर कॉल करने के लिए दबाएँ',
    mr: 'जीवाला धोका आहे आणि कोणाशी बोलायचे आहे? 108 वर कॉल करण्यासाठी दाबा',
    gu: 'જીવનું જોખમ છે અને કોઈ સાથે વાત કરવી છે? 108 પર કૉલ કરવા દબાવો',
    ta: 'உயிருக்கு ஆபத்தா? 108 ஐ அழைக்க தட்டவும்',
    bn: 'জীবনের ঝুঁকি? 108 নম্বরে কল করতে চাপুন',
  },
  'banner.callNumber': { en: 'Call 108', hi: '108 पर कॉल करें', mr: '108 वर कॉल करा', gu: '108 પર કૉલ કરો', ta: '108 ஐ அழைக்கவும்', bn: '108 এ কল করুন' },

  // ── SOS: entry ───────────────────────────────────────────────────────────
  'sos.title': { en: 'Get emergency help', hi: 'आपातकालीन मदद पाएँ', mr: 'आपत्कालीन मदत मिळवा', gu: 'કટોકટીની મદદ મેળવો', ta: 'அவசர உதவி பெறுங்கள்', bn: 'জরুরি সাহায্য নিন' },
  'sos.subtitle': {
    en: 'No account needed. Two questions, then we send an ambulance.',
    hi: 'खाते की ज़रूरत नहीं। दो सवाल, फिर हम एम्बुलेंस भेजते हैं।',
    mr: 'खात्याची गरज नाही. दोन प्रश्न, मग आम्ही रुग्णवाहिका पाठवतो.',
    gu: 'ખાતાની જરૂર નથી. બે પ્રશ્નો, પછી અમે એમ્બ્યુલન્સ મોકલીએ છીએ.',
    ta: 'கணக்கு தேவையில்லை. இரண்டு கேள்விகள், பின் ஆம்புலன்ஸ் அனுப்புவோம்.',
    bn: 'অ্যাকাউন্ট লাগবে না। দুটি প্রশ্ন, তারপর আমরা অ্যাম্বুলেন্স পাঠাব।',
  },
  'sos.self': { en: 'I need help', hi: 'मुझे मदद चाहिए', mr: 'मला मदत हवी आहे', gu: 'મને મદદ જોઈએ', ta: 'எனக்கு உதவி வேண்டும்', bn: 'আমার সাহায্য দরকার' },
  'sos.selfHint': {
    en: 'Something is wrong with me',
    hi: 'मेरे साथ कुछ गड़बड़ है',
    mr: 'माझ्यासोबत काहीतरी चुकीचे आहे',
    gu: 'મારી સાથે કંઈક ખોટું છે',
    ta: 'எனக்கு ஏதோ பிரச்சினை',
    bn: 'আমার কিছু সমস্যা হচ্ছে',
  },
  'sos.bystander': { en: 'Someone else needs help', hi: 'किसी और को मदद चाहिए', mr: 'दुसऱ्या कोणाला मदत हवी आहे', gu: 'બીજા કોઈને મદદ જોઈએ', ta: 'வேறு ஒருவருக்கு உதவி தேவை', bn: 'অন্য কারও সাহায্য দরকার' },
  'sos.bystanderHint': {
    en: 'I can see a person who is hurt',
    hi: 'मुझे कोई घायल व्यक्ति दिख रहा है',
    mr: 'मला एक जखमी व्यक्ती दिसत आहे',
    gu: 'મને કોઈ ઘાયલ વ્યક્તિ દેખાય છે',
    ta: 'காயமடைந்த ஒருவரை நான் பார்க்கிறேன்',
    bn: 'আমি একজন আহত ব্যক্তিকে দেখছি',
  },
  'sos.privacy': {
    en: 'Your location is used only to send help to the right place. You will get a tracking link on this device and can cancel at any time.',
    hi: 'आपका स्थान केवल सही जगह मदद भेजने के लिए इस्तेमाल होता है। इसी डिवाइस पर ट्रैकिंग लिंक मिलेगा और आप कभी भी रद्द कर सकते हैं।',
    mr: 'तुमचे स्थान फक्त योग्य ठिकाणी मदत पाठवण्यासाठी वापरले जाते. याच डिव्हाइसवर ट्रॅकिंग लिंक मिळेल आणि तुम्ही कधीही रद्द करू शकता.',
    gu: 'તમારું સ્થાન ફક્ત યોગ્ય જગ્યાએ મદદ મોકલવા વપરાય છે. આ જ ડિવાઇસ પર ટ્રેકિંગ લિંક મળશે અને તમે ગમે ત્યારે રદ કરી શકો છો.',
    ta: 'உங்கள் இருப்பிடம் சரியான இடத்திற்கு உதவி அனுப்பவே பயன்படுகிறது. இந்த சாதனத்தில் கண்காணிப்பு கிடைக்கும், எப்போதும் ரத்து செய்யலாம்.',
    bn: 'আপনার অবস্থান কেবল সঠিক জায়গায় সাহায্য পাঠাতে ব্যবহৃত হয়। এই ডিভাইসে ট্র্যাকিং লিঙ্ক পাবেন এবং যেকোনো সময় বাতিল করতে পারেন।',
  },

  // ── SOS: describe ────────────────────────────────────────────────────────
  'sos.whatWrong': { en: "What's wrong?", hi: 'क्या तकलीफ़ है?', mr: 'काय त्रास होत आहे?', gu: 'શું તકલીફ છે?', ta: 'என்ன பிரச்சினை?', bn: 'কী সমস্যা?' },
  'sos.whatHappened': { en: 'What has happened?', hi: 'क्या हुआ है?', mr: 'काय झाले आहे?', gu: 'શું થયું છે?', ta: 'என்ன நடந்தது?', bn: 'কী হয়েছে?' },
  'sos.pickClosest': {
    en: 'Pick the closest one. If nothing fits, choose "Something else".',
    hi: 'सबसे मिलता-जुलता चुनें। अगर कुछ ठीक न लगे तो "कुछ और" चुनें।',
    mr: 'सर्वात जवळचे निवडा. काहीच जुळत नसेल तर "दुसरे काहीतरी" निवडा.',
    gu: 'સૌથી નજીકનું પસંદ કરો. કંઈ બંધબેસતું ન હોય તો "બીજું કંઈક" પસંદ કરો.',
    ta: 'மிக அருகிலுள்ளதைத் தேர்வு செய்க. பொருந்தவில்லை எனில் "வேறு ஏதோ".',
    bn: 'সবচেয়ে কাছেরটি বেছে নিন। কিছু না মিললে "অন্য কিছু" বেছে নিন।',
  },
  'sos.awake': { en: 'Is the person awake?', hi: 'क्या व्यक्ति होश में है?', mr: 'व्यक्ती शुद्धीवर आहे का?', gu: 'વ્યક્તિ ભાનમાં છે?', ta: 'அந்த நபர் நினைவுடன் இருக்கிறாரா?', bn: 'ব্যক্তি কি জ্ঞানে আছেন?' },
  'sos.breathing': { en: 'Are they breathing?', hi: 'क्या उनकी साँस चल रही है?', mr: 'त्यांचा श्वास चालू आहे का?', gu: 'તેમનો શ્વાસ ચાલે છે?', ta: 'அவர் மூச்சு விடுகிறாரா?', bn: 'তিনি কি শ্বাস নিচ্ছেন?' },
  'sos.howMany': { en: 'How many people are hurt?', hi: 'कितने लोग घायल हैं?', mr: 'किती लोक जखमी आहेत?', gu: 'કેટલા લોકો ઘાયલ છે?', ta: 'எத்தனை பேர் காயமடைந்துள்ளனர்?', bn: 'কতজন আহত?' },
  'sos.danger': { en: 'Is there any danger there?', hi: 'क्या वहाँ कोई खतरा है?', mr: 'तिथे काही धोका आहे का?', gu: 'ત્યાં કોઈ જોખમ છે?', ta: 'அங்கே ஏதேனும் ஆபத்து உள்ளதா?', bn: 'সেখানে কোনো বিপদ আছে?' },
  'sos.dangerHint': {
    en: 'This keeps the crew safe. Skip if there is none.',
    hi: 'इससे टीम सुरक्षित रहती है। कुछ न हो तो छोड़ दें।',
    mr: 'यामुळे टीम सुरक्षित राहते. काही नसेल तर वगळा.',
    gu: 'આથી ટીમ સુરક્ષિત રહે છે. કંઈ ન હોય તો છોડી દો.',
    ta: 'இது குழுவைப் பாதுகாக்கும். இல்லையெனில் தவிர்க்கவும்.',
    bn: 'এতে দল নিরাপদ থাকে। কিছু না থাকলে এড়িয়ে যান।',
  },
  'sos.anythingElse': { en: 'Anything else?', hi: 'और कुछ?', mr: 'आणखी काही?', gu: 'બીજું કંઈ?', ta: 'வேறு ஏதேனும்?', bn: 'আর কিছু?' },
  'sos.typeOrSpeak': {
    en: 'Type it, or hold the button and speak.',
    hi: 'लिखें, या बटन दबाकर बोलें।',
    mr: 'टाइप करा, किंवा बटण दाबून बोला.',
    gu: 'લખો, અથવા બટન દબાવીને બોલો.',
    ta: 'தட்டச்சு செய்க, அல்லது பொத்தானை அழுத்திப் பேசுக.',
    bn: 'লিখুন, বা বোতাম চেপে বলুন।',
  },
  'sos.holdToSpeak': { en: 'Hold to speak', hi: 'बोलने के लिए दबाए रखें', mr: 'बोलण्यासाठी दाबून धरा', gu: 'બોલવા માટે દબાવી રાખો', ta: 'பேச அழுத்திப் பிடிக்கவும்', bn: 'বলতে চেপে ধরুন' },
  'sos.listening': { en: 'Listening, release to stop', hi: 'सुन रहे हैं, रोकने के लिए छोड़ें', mr: 'ऐकत आहे, थांबवण्यासाठी सोडा', gu: 'સાંભળી રહ્યા છીએ, રોકવા છોડો', ta: 'கேட்கிறது, நிறுத்த விடுங்கள்', bn: 'শুনছি, থামাতে ছাড়ুন' },
  'sos.writingDown': { en: 'Writing down what you said…', hi: 'आपने जो कहा वह लिखा जा रहा है…', mr: 'तुम्ही सांगितले ते लिहीत आहे…', gu: 'તમે કહ્યું તે લખી રહ્યા છીએ…', ta: 'நீங்கள் சொன்னதை எழுதுகிறோம்…', bn: 'আপনি যা বললেন লিখছি…' },
  'sos.chooseOrDescribe': {
    en: 'Choose an option above, or describe what happened.',
    hi: 'ऊपर से कोई विकल्प चुनें, या बताएँ क्या हुआ।',
    mr: 'वरून पर्याय निवडा, किंवा काय झाले ते सांगा.',
    gu: 'ઉપરથી વિકલ્પ પસંદ કરો, અથવા શું થયું તે જણાવો.',
    ta: 'மேலே ஒன்றைத் தேர்வு செய்க, அல்லது நடந்ததைக் கூறுக.',
    bn: 'উপরে একটি বিকল্প বাছুন, বা কী হয়েছে বলুন।',
  },

  // ── SOS: location ────────────────────────────────────────────────────────
  'sos.whereSend': { en: 'Where should we send help?', hi: 'मदद कहाँ भेजें?', mr: 'मदत कुठे पाठवायची?', gu: 'મદદ ક્યાં મોકલીએ?', ta: 'உதவியை எங்கே அனுப்ப வேண்டும்?', bn: 'সাহায্য কোথায় পাঠাব?' },
  'sos.findingLocation': { en: 'Finding your location…', hi: 'आपका स्थान खोजा जा रहा है…', mr: 'तुमचे स्थान शोधत आहे…', gu: 'તમારું સ્થાન શોધી રહ્યા છીએ…', ta: 'உங்கள் இருப்பிடம் தேடுகிறோம்…', bn: 'আপনার অবস্থান খুঁজছি…' },
  'sos.locationFound': { en: 'Location found', hi: 'स्थान मिल गया', mr: 'स्थान सापडले', gu: 'સ્થાન મળ્યું', ta: 'இருப்பிடம் கிடைத்தது', bn: 'অবস্থান পাওয়া গেছে' },
  'sos.locationBlocked': { en: 'Location permission was blocked', hi: 'स्थान की अनुमति रोक दी गई', mr: 'स्थानाची परवानगी नाकारली', gu: 'સ્થાનની પરવાનગી અટકાવાઈ', ta: 'இருப்பிட அனுமதி தடுக்கப்பட்டது', bn: 'অবস্থানের অনুমতি আটকানো হয়েছে' },
  'sos.typeAddress': {
    en: 'Type where the emergency is instead. A landmark is enough.',
    hi: 'इसके बजाय बताएँ आपातकाल कहाँ है। कोई पहचान वाली जगह काफ़ी है।',
    mr: 'त्याऐवजी आपत्कालीन ठिकाण लिहा. एखादी ओळखीची खूण पुरेशी आहे.',
    gu: 'તેના બદલે કટોકટી ક્યાં છે તે લખો. કોઈ જાણીતી જગ્યા પૂરતી છે.',
    ta: 'அவசரநிலை எங்கே என்பதைத் தட்டச்சு செய்க. ஒரு அடையாளம் போதும்.',
    bn: 'বরং জরুরি অবস্থা কোথায় লিখুন। একটি ল্যান্ডমার্কই যথেষ্ট।',
  },
  'sos.yourPhone': { en: 'Your phone number', hi: 'आपका फ़ोन नंबर', mr: 'तुमचा फोन नंबर', gu: 'તમારો ફોન નંબર', ta: 'உங்கள் தொலைபேசி எண்', bn: 'আপনার ফোন নম্বর' },
  'sos.phoneHintSelf': {
    en: 'So the crew can call you on the way.',
    hi: 'ताकि टीम रास्ते में आपको कॉल कर सके।',
    mr: 'जेणेकरून टीम वाटेत तुम्हाला कॉल करू शकेल.',
    gu: 'જેથી ટીમ રસ્તામાં તમને કૉલ કરી શકે.',
    ta: 'வழியில் குழு உங்களை அழைக்க.',
    bn: 'যাতে দল পথে আপনাকে ফোন করতে পারে।',
  },
  'sos.phoneHintBystander': {
    en: 'So the crew can call you if they cannot find the spot.',
    hi: 'ताकि जगह न मिलने पर टीम आपको कॉल कर सके।',
    mr: 'जागा न सापडल्यास टीम तुम्हाला कॉल करू शकेल.',
    gu: 'જગ્યા ન મળે તો ટીમ તમને કૉલ કરી શકે.',
    ta: 'இடம் கிடைக்கவில்லை எனில் குழு உங்களை அழைக்க.',
    bn: 'জায়গা না পেলে দল আপনাকে ফোন করতে পারে।',
  },
  'sos.sendNow': { en: 'Send for help now', hi: 'अभी मदद बुलाएँ', mr: 'आता मदत बोलवा', gu: 'હમણાં મદદ બોલાવો', ta: 'இப்போதே உதவி அழைக்கவும்', bn: 'এখনই সাহায্য ডাকুন' },
  'sos.needLocation': {
    en: 'We need a location before we can send a crew.',
    hi: 'टीम भेजने से पहले हमें स्थान चाहिए।',
    mr: 'टीम पाठवण्यापूर्वी आम्हाला स्थान हवे.',
    gu: 'ટીમ મોકલતા પહેલા અમને સ્થાન જોઈએ.',
    ta: 'குழுவை அனுப்ப இருப்பிடம் தேவை.',
    bn: 'দল পাঠানোর আগে অবস্থান দরকার।',
  },
  'sos.waking': {
    en: 'Waking the dispatch service. This can take up to a minute the first time, please stay on this page.',
    hi: 'सेवा शुरू की जा रही है। पहली बार एक मिनट लग सकता है, कृपया इसी पेज पर रहें।',
    mr: 'सेवा सुरू होत आहे. पहिल्यांदा एक मिनिट लागू शकतो, कृपया याच पानावर रहा.',
    gu: 'સેવા શરૂ થઈ રહી છે. પહેલી વાર એક મિનિટ લાગી શકે, કૃપા કરી આ જ પેજ પર રહો.',
    ta: 'சேவை தொடங்குகிறது. முதல் முறை ஒரு நிமிடம் ஆகலாம், இந்தப் பக்கத்திலேயே இருங்கள்.',
    bn: 'পরিষেবা চালু হচ্ছে। প্রথমবার এক মিনিট লাগতে পারে, এই পেজেই থাকুন।',
  },
  'sos.tryAgain': { en: 'Try sending again', hi: 'फिर से भेजने की कोशिश करें', mr: 'पुन्हा पाठवण्याचा प्रयत्न करा', gu: 'ફરી મોકલવાનો પ્રયાસ કરો', ta: 'மீண்டும் அனுப்ப முயற்சிக்கவும்', bn: 'আবার পাঠানোর চেষ্টা করুন' },

  // ── SOS: tracking ────────────────────────────────────────────────────────
  'sos.reference': { en: 'Reference', hi: 'संदर्भ', mr: 'संदर्भ', gu: 'સંદર્ભ', ta: 'குறிப்பு', bn: 'রেফারেন্স' },
  'sos.yourAmbulance': { en: 'Your ambulance', hi: 'आपकी एम्बुलेंस', mr: 'तुमची रुग्णवाहिका', gu: 'તમારી એમ્બ્યુલન્સ', ta: 'உங்கள் ஆம்புலன்ஸ்', bn: 'আপনার অ্যাম্বুলেন্স' },
  'sos.minutesAway': { en: 'About {n} minutes away', hi: 'लगभग {n} मिनट दूर', mr: 'सुमारे {n} मिनिटे दूर', gu: 'આશરે {n} મિનિટ દૂર', ta: 'சுமார் {n} நிமிடம் தொலைவில்', bn: 'প্রায় {n} মিনিট দূরে' },
  'sos.hospitalExpecting': { en: 'Hospital expecting you', hi: 'अस्पताल आपका इंतज़ार कर रहा है', mr: 'रुग्णालय तुमची वाट पाहत आहे', gu: 'હોસ્પિટલ તમારી રાહ જુએ છે', ta: 'மருத்துவமனை உங்களை எதிர்பார்க்கிறது', bn: 'হাসপাতাল আপনার জন্য প্রস্তুত' },
  'sos.howUrgent': { en: 'How urgent this was judged', hi: 'कितना ज़रूरी माना गया', mr: 'किती तातडीचे मानले गेले', gu: 'કેટલું તાત્કાલિક ગણાયું', ta: 'எவ்வளவு அவசரம் எனக் கணிக்கப்பட்டது', bn: 'কতটা জরুরি বিবেচিত' },
  'sos.whileYouWait': { en: 'What you can do while you wait', hi: 'इंतज़ार के दौरान आप क्या कर सकते हैं', mr: 'वाट पाहताना तुम्ही काय करू शकता', gu: 'રાહ જોતી વખતે તમે શું કરી શકો', ta: 'காத்திருக்கும்போது நீங்கள் செய்யக்கூடியவை', bn: 'অপেক্ষার সময় যা করতে পারেন' },
  'sos.cancel': { en: 'Help is no longer needed, cancel', hi: 'अब मदद की ज़रूरत नहीं, रद्द करें', mr: 'आता मदतीची गरज नाही, रद्द करा', gu: 'હવે મદદની જરૂર નથી, રદ કરો', ta: 'இனி உதவி தேவையில்லை, ரத்து செய்க', bn: 'আর সাহায্য লাগবে না, বাতিল করুন' },
  'sos.reportAnother': { en: 'Report another emergency', hi: 'दूसरी आपात स्थिति बताएँ', mr: 'दुसरी आपत्कालीन स्थिती कळवा', gu: 'બીજી કટોકટી જણાવો', ta: 'மற்றொரு அவசரநிலையைத் தெரிவிக்கவும்', bn: 'আরেকটি জরুরি অবস্থা জানান' },
  'sos.keepOpen': {
    en: 'Keep this page open to follow the ambulance. If you close it, this device will remember and bring you back.',
    hi: 'एम्बुलेंस देखने के लिए यह पेज खुला रखें। बंद करने पर यह डिवाइस याद रखेगा और आपको वापस लाएगा।',
    mr: 'रुग्णवाहिका पाहण्यासाठी हे पान उघडे ठेवा. बंद केल्यास हे डिव्हाइस लक्षात ठेवेल आणि परत आणेल.',
    gu: 'એમ્બ્યુલન્સ જોવા આ પેજ ખુલ્લું રાખો. બંધ કરશો તો આ ડિવાઇસ યાદ રાખી પાછા લાવશે.',
    ta: 'ஆம்புலன்ஸைப் பின்தொடர இந்தப் பக்கத்தைத் திறந்து வையுங்கள். மூடினால் சாதனம் நினைவில் வைத்து மீண்டும் கொண்டுவரும்.',
    bn: 'অ্যাম্বুলেন্স দেখতে এই পেজ খোলা রাখুন। বন্ধ করলে ডিভাইস মনে রেখে ফিরিয়ে আনবে।',
  },

  // ── Urgency, in words ────────────────────────────────────────────────────
  'urgency.1': { en: 'Most urgent', hi: 'सबसे ज़रूरी', mr: 'सर्वात तातडीचे', gu: 'સૌથી તાત્કાલિક', ta: 'மிக அவசரம்', bn: 'সবচেয়ে জরুরি' },
  'urgency.2': { en: 'Very urgent', hi: 'बहुत ज़रूरी', mr: 'खूप तातडीचे', gu: 'ખૂબ તાત્કાલિક', ta: 'மிகவும் அவசரம்', bn: 'খুব জরুরি' },
  'urgency.3': { en: 'Urgent', hi: 'ज़रूरी', mr: 'तातडीचे', gu: 'તાત્કાલિક', ta: 'அவசரம்', bn: 'জরুরি' },
  'urgency.4': { en: 'Less urgent', hi: 'कम ज़रूरी', mr: 'कमी तातडीचे', gu: 'ઓછું તાત્કાલિક', ta: 'குறைவான அவசரம்', bn: 'কম জরুরি' },
  'urgency.5': { en: 'Non-urgent', hi: 'ज़रूरी नहीं', mr: 'तातडीचे नाही', gu: 'તાત્કાલિક નથી', ta: 'அவசரம் இல்லை', bn: 'জরুরি নয়' },

  // ── Status, in words ─────────────────────────────────────────────────────
  'status.received': { en: 'Report received', hi: 'सूचना मिल गई', mr: 'माहिती मिळाली', gu: 'જાણ મળી', ta: 'தகவல் பெறப்பட்டது', bn: 'রিপোর্ট পাওয়া গেছে' },
  'status.assessed': { en: 'Urgency assessed', hi: 'ज़रूरत आँकी गई', mr: 'तातडी तपासली', gu: 'તાકીદ આંકવામાં આવી', ta: 'அவசரம் மதிப்பிடப்பட்டது', bn: 'জরুরিত্ব যাচাই হয়েছে' },
  'status.assigned': { en: 'Ambulance assigned', hi: 'एम्बुलेंस तय हुई', mr: 'रुग्णवाहिका ठरली', gu: 'એમ્બ્યુલન્સ નક્કી થઈ', ta: 'ஆம்புலன்ஸ் ஒதுக்கப்பட்டது', bn: 'অ্যাম্বুলেন্স নির্ধারিত' },
  'status.onTheWay': { en: 'Ambulance on the way', hi: 'एम्बुलेंस रास्ते में है', mr: 'रुग्णवाहिका वाटेत आहे', gu: 'એમ્બ્યુલન્સ રસ્તામાં છે', ta: 'ஆம்புலன்ஸ் வழியில்', bn: 'অ্যাম্বুলেন্স পথে' },
  'status.arrived': { en: 'Crew has arrived', hi: 'टीम पहुँच गई', mr: 'टीम पोहोचली', gu: 'ટીમ પહોંચી', ta: 'குழு வந்துவிட்டது', bn: 'দল পৌঁছেছে' },
  'status.toHospital': { en: 'On the way to hospital', hi: 'अस्पताल के रास्ते में', mr: 'रुग्णालयाच्या वाटेवर', gu: 'હોસ્પિટલના રસ્તે', ta: 'மருத்துவமனைக்கு செல்கிறது', bn: 'হাসপাতালের পথে' },
  'status.atHospital': { en: 'Arrived at hospital', hi: 'अस्पताल पहुँच गए', mr: 'रुग्णालयात पोहोचले', gu: 'હોસ્પિટલ પહોંચ્યા', ta: 'மருத்துவமனையை அடைந்தது', bn: 'হাসপাতালে পৌঁছেছে' },

  // ── Landing ──────────────────────────────────────────────────────────────
  'landing.emergencySos': { en: 'Emergency SOS', hi: 'आपातकालीन SOS', mr: 'आपत्कालीन SOS', gu: 'કટોકટી SOS', ta: 'அவசர SOS', bn: 'জরুরি SOS' },
  'landing.noLogin': { en: 'No login needed', hi: 'लॉगिन की ज़रूरत नहीं', mr: 'लॉगिनची गरज नाही', gu: 'લૉગિનની જરૂર નથી', ta: 'உள்நுழைவு தேவையில்லை', bn: 'লগইন লাগবে না' },
  'landing.watchHow': { en: 'Watch how it works', hi: 'देखें यह कैसे काम करता है', mr: 'हे कसे काम करते ते पहा', gu: 'તે કેવી રીતે કામ કરે છે જુઓ', ta: 'இது எப்படி வேலை செய்கிறது பாருங்கள்', bn: 'কীভাবে কাজ করে দেখুন' },
  'landing.ifYouNeedHelp': { en: 'If you need help right now', hi: 'अगर आपको अभी मदद चाहिए', mr: 'तुम्हाला आत्ता मदत हवी असल्यास', gu: 'જો તમને હમણાં મદદ જોઈએ', ta: 'இப்போதே உதவி தேவைப்பட்டால்', bn: 'এখনই সাহায্য লাগলে' },
  'landing.step1': {
    en: 'Tap Emergency SOS. No account, no password.',
    hi: 'आपातकालीन SOS दबाएँ। कोई खाता नहीं, कोई पासवर्ड नहीं।',
    mr: 'आपत्कालीन SOS दाबा. खाते नाही, पासवर्ड नाही.',
    gu: 'કટોકટી SOS દબાવો. ખાતું નહીં, પાસવર્ડ નહીં.',
    ta: 'அவசர SOS ஐ அழுத்தவும். கணக்கு இல்லை, கடவுச்சொல் இல்லை.',
    bn: 'জরুরি SOS চাপুন। অ্যাকাউন্ট নেই, পাসওয়ার্ড নেই।',
  },
  'landing.step2': {
    en: 'Say whether it is you or someone else, and what is wrong.',
    hi: 'बताएँ कि यह आप हैं या कोई और, और क्या तकलीफ़ है।',
    mr: 'तुम्ही आहात की दुसरे कोणी, आणि काय त्रास आहे ते सांगा.',
    gu: 'કહો કે તે તમે છો કે બીજું કોઈ, અને શું તકલીફ છે.',
    ta: 'நீங்களா வேறு ஒருவரா, என்ன பிரச்சினை எனக் கூறுங்கள்.',
    bn: 'বলুন এটি আপনি না অন্য কেউ, এবং কী সমস্যা।',
  },
  'landing.step3': {
    en: 'An ambulance is sent and you can follow it on this phone.',
    hi: 'एम्बुलेंस भेजी जाती है और आप इसी फ़ोन पर देख सकते हैं।',
    mr: 'रुग्णवाहिका पाठवली जाते आणि तुम्ही याच फोनवर पाहू शकता.',
    gu: 'એમ્બ્યુલન્સ મોકલાય છે અને તમે આ ફોન પર જોઈ શકો છો.',
    ta: 'ஆம்புலன்ஸ் அனுப்பப்படும், இந்த தொலைபேசியில் பின்தொடரலாம்.',
    bn: 'অ্যাম্বুলেন্স পাঠানো হয় এবং এই ফোনে অনুসরণ করতে পারেন।',
  },
  'landing.notReplace': {
    en: 'In a life-threatening emergency you can always call 108 directly. This does not replace that.',
    hi: 'जान के खतरे में आप हमेशा सीधे 108 पर कॉल कर सकते हैं। यह उसका विकल्प नहीं है।',
    mr: 'जीवघेण्या परिस्थितीत तुम्ही नेहमी थेट 108 वर कॉल करू शकता. हा त्याचा पर्याय नाही.',
    gu: 'જીવલેણ કટોકટીમાં તમે હંમેશા સીધા 108 પર કૉલ કરી શકો. આ તેનો વિકલ્પ નથી.',
    ta: 'உயிருக்கு ஆபத்தான நிலையில் எப்போதும் 108 ஐ நேரடியாக அழைக்கலாம். இது அதற்கு மாற்றல்ல.',
    bn: 'জীবনসংকটে আপনি সবসময় সরাসরি 108 এ কল করতে পারেন। এটি তার বিকল্প নয়।',
  },


  // ── Complaint catalogue, self-report ─────────────────────────────────────
  'c.chest': { en: 'Chest pain', hi: 'सीने में दर्द', mr: 'छातीत दुखणे', gu: 'છાતીમાં દુખાવો', ta: 'மார்பு வலி', bn: 'বুকে ব্যথা' },
  'c.breathing': { en: "Can't breathe properly", hi: 'साँस लेने में तकलीफ़', mr: 'श्वास घेण्यास त्रास', gu: 'શ્વાસ લેવામાં તકલીફ', ta: 'மூச்சுத் திணறல்', bn: 'শ্বাস নিতে কষ্ট' },
  'c.bleeding': { en: 'Bleeding badly', hi: 'बहुत खून बह रहा है', mr: 'खूप रक्तस्राव', gu: 'ખૂબ લોહી વહે છે', ta: 'அதிக ரத்தப்போக்கு', bn: 'প্রচুর রক্তক্ষরণ' },
  'c.accident': { en: 'I had an accident', hi: 'मेरा एक्सीडेंट हुआ है', mr: 'माझा अपघात झाला', gu: 'મારો અકસ્માત થયો', ta: 'எனக்கு விபத்து', bn: 'আমার দুর্ঘটনা হয়েছে' },
  'c.stroke': { en: 'Face or arm went weak', hi: 'चेहरा या हाथ कमज़ोर हो गया', mr: 'चेहरा किंवा हात लुळा पडला', gu: 'ચહેરો કે હાથ નબળો પડ્યો', ta: 'முகம் அல்லது கை செயலிழந்தது', bn: 'মুখ বা হাত অবশ' },
  'c.pain': { en: 'Severe pain', hi: 'तेज़ दर्द', mr: 'तीव्र वेदना', gu: 'તીવ્ર દુખાવો', ta: 'கடுமையான வலி', bn: 'তীব্র ব্যথা' },
  'c.allergy': { en: 'Allergic reaction', hi: 'एलर्जी की प्रतिक्रिया', mr: 'ॲलर्जीची प्रतिक्रिया', gu: 'એલર્જીની પ્રતિક્રિયા', ta: 'ஒவ்வாமை', bn: 'অ্যালার্জি' },
  'c.other': { en: 'Something else', hi: 'कुछ और', mr: 'दुसरे काहीतरी', gu: 'બીજું કંઈક', ta: 'வேறு ஏதோ', bn: 'অন্য কিছু' },

  // ── Situation catalogue, bystander ───────────────────────────────────────
  'b.road': { en: 'Road accident', hi: 'सड़क दुर्घटना', mr: 'रस्ता अपघात', gu: 'માર્ગ અકસ્માત', ta: 'சாலை விபத்து', bn: 'সড়ক দুর্ঘটনা' },
  'b.collapse': { en: 'Someone collapsed', hi: 'कोई गिर पड़ा है', mr: 'कोणीतरी कोसळले', gu: 'કોઈ ઢળી પડ્યું', ta: 'ஒருவர் மயங்கி விழுந்தார்', bn: 'কেউ পড়ে গেছে' },
  'b.fall': { en: 'Bad fall', hi: 'बुरी तरह गिरना', mr: 'वाईट पडझड', gu: 'ખરાબ રીતે પડ્યા', ta: 'மோசமான விழுச்சி', bn: 'খারাপভাবে পড়ে গেছে' },
  'b.fire': { en: 'Fire or burns', hi: 'आग या जलना', mr: 'आग किंवा भाजणे', gu: 'આગ કે દાઝવું', ta: 'தீ அல்லது தீக்காயம்', bn: 'আগুন বা পোড়া' },
  'b.drown': { en: 'Drowning', hi: 'डूबना', mr: 'बुडणे', gu: 'ડૂબવું', ta: 'நீரில் மூழ்குதல்', bn: 'ডুবে যাওয়া' },
  'b.assault': { en: 'Someone is hurt by violence', hi: 'किसी को मारपीट से चोट', mr: 'कोणाला मारहाणीने दुखापत', gu: 'કોઈને મારપીટથી ઈજા', ta: 'வன்முறையால் காயம்', bn: 'সহিংসতায় আহত' },
  'b.unknown': { en: "I don't know what happened", hi: 'पता नहीं क्या हुआ', mr: 'काय झाले माहीत नाही', gu: 'શું થયું ખબર નથી', ta: 'என்ன நடந்தது தெரியவில்லை', bn: 'কী হয়েছে জানি না' },

  // ── Scene hazards ────────────────────────────────────────────────────────
  'h.traffic': { en: 'Traffic', hi: 'ट्रैफ़िक', mr: 'वाहतूक', gu: 'ટ્રાફિક', ta: 'போக்குவரத்து', bn: 'যানবাহন' },
  'h.fire': { en: 'Fire or smoke', hi: 'आग या धुआँ', mr: 'आग किंवा धूर', gu: 'આગ કે ધુમાડો', ta: 'தீ அல்லது புகை', bn: 'আগুন বা ধোঁয়া' },
  'h.water': { en: 'Water', hi: 'पानी', mr: 'पाणी', gu: 'પાણી', ta: 'நீர்', bn: 'জল' },
  'h.electrical': { en: 'Live wires', hi: 'बिजली के तार', mr: 'विजेच्या तारा', gu: 'વીજળીના તાર', ta: 'மின் கம்பிகள்', bn: 'বিদ্যুতের তার' },
  'h.crowd': { en: 'Crowd or violence', hi: 'भीड़ या हिंसा', mr: 'गर्दी किंवा हिंसा', gu: 'ભીડ કે હિંસા', ta: 'கூட்டம் அல்லது வன்முறை', bn: 'ভিড় বা সহিংসতা' },

  // ── Portal chrome ────────────────────────────────────────────────────────
  'portal.simple': { en: 'Simple', hi: 'सरल', mr: 'सोपे', gu: 'સરળ', ta: 'எளிய', bn: 'সহজ' },
  'portal.full': { en: 'Full', hi: 'पूरा', mr: 'पूर्ण', gu: 'પૂર્ણ', ta: 'முழு', bn: 'পূর্ণ' },
  'portal.help': { en: 'How to use this screen', hi: 'यह स्क्रीन कैसे इस्तेमाल करें', mr: 'ही स्क्रीन कशी वापरावी', gu: 'આ સ્ક્રીન કેવી રીતે વાપરવી', ta: 'இந்தத் திரையை எப்படிப் பயன்படுத்துவது', bn: 'এই স্ক্রিন কীভাবে ব্যবহার করবেন' },
  'portal.walkthrough': { en: 'Walkthrough', hi: 'मार्गदर्शन', mr: 'मार्गदर्शन', gu: 'માર્ગદર્શન', ta: 'வழிகாட்டி', bn: 'নির্দেশিকা' },
  'portal.emergencyPage': { en: 'Emergency page', hi: 'आपातकालीन पेज', mr: 'आपत्कालीन पान', gu: 'કટોકટી પેજ', ta: 'அவசரப் பக்கம்', bn: 'জরুরি পেজ' },
  'portal.logout': { en: 'Log out', hi: 'लॉग आउट', mr: 'लॉग आउट', gu: 'લૉગ આઉટ', ta: 'வெளியேறு', bn: 'লগ আউট' },
  'portal.notRecorded': { en: 'Not recorded', hi: 'दर्ज नहीं', mr: 'नोंद नाही', gu: 'નોંધાયું નથી', ta: 'பதிவு இல்லை', bn: 'রেকর্ড নেই' },
  'portal.aiOnline': { en: 'AI ONLINE', hi: 'AI चालू', mr: 'AI चालू', gu: 'AI ચાલુ', ta: 'AI இயக்கத்தில்', bn: 'AI চালু' },
  'portal.aiDegraded': { en: 'AI DEGRADED', hi: 'AI सीमित', mr: 'AI मर्यादित', gu: 'AI મર્યાદિત', ta: 'AI குறைந்த நிலை', bn: 'AI সীমিত' },
}

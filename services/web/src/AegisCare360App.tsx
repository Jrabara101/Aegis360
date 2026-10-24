import React, { useState, useEffect } from "react";
import { LiveApi, homeStatusFor, loadConfig, signIn, toAlertItems, type LiveConfig, type Overview } from "./live";

// --- Types & Interfaces ---
export type AppRoute =
  | "welcome"
  | "language"
  | "what-we-do"
  | "create-account"
  | "sign-in"
  | "care-profile-setup"
  | "trusted-contact"
  | "home"
  | "alerts"
  | "alert-details"
  | "activity"
  | "care-circle"
  | "settings"
  | "verification-prompt"
  | "voice-bridge"
  | "demo-panel";

export type HomeStatus = "OK" | "NEEDS_VERIFICATION" | "EMERGENCY" | "UNKNOWN";

export type AlertFilter = "all" | "needs_review" | "emergency" | "resolved";

export interface AlertItem {
  id: string;
  title: string;
  description: string;
  time: string;
  location: string;
  category: "needs_review" | "emergency" | "resolved";
  priority: "CRITICAL" | "HIGH" | "NORMAL" | "RESOLVED";
  icon: string;
  threatScore?: number;
  signals?: string[];
  safeWordResult?: "PASSED" | "FAILED" | "PENDING";
  transcriptSnippet?: string;
  seniorQuote?: string;
}

export interface CaregiverContact {
  id: string;
  name: string;
  role: string;
  phone: string;
  relationship: string;
  isPrimary: boolean;
  avatarLetter: string;
}

// --- Initial Mock Data ---
const INITIAL_ALERTS: AlertItem[] = [
  {
    id: "alert-fall-1",
    title: "Possible fall detected",
    description: "Living room motion sensor flagged an abrupt deceleration event.",
    time: "Today · 9:15 AM",
    location: "Living room hub",
    category: "emergency",
    priority: "CRITICAL",
    icon: "personal_injury",
    threatScore: 0.95,
    signals: ["abrupt_deceleration", "unresponsive_period", "sensor_bedside"],
    safeWordResult: "PENDING",
    transcriptSnippet: "Motion sensor triggered abrupt drop event at 9:15 AM in living room. Alexa check-in initiated without spoken response.",
    seniorQuote: "No verbal reply heard from room sensor."
  },
  {
    id: "alert-scam-1",
    title: "Potential AI Impersonation Scam",
    description: "Urgent caller claiming to be grandson in legal trouble requesting urgent funds transfer.",
    time: "Today · 11:20 AM",
    location: "Home Landline / Alexa Call Shield",
    category: "needs_review",
    priority: "HIGH",
    icon: "phone_disabled",
    threatScore: 0.88,
    signals: ["urgency_pressure", "financial_transfer", "grandparent_bail_claim"],
    safeWordResult: "FAILED",
    transcriptSnippet: "Caller: 'Grandma, I had an accident and I am in custody. Do not tell Mom or Dad, just send the $4,500 bail.' Alexa+ intervened with safe word challenge.",
    seniorQuote: "Senior answered: 'Is this Rohan?' - Safe word challenge failed twice."
  },
  {
    id: "alert-checkin-1",
    title: "Morning check-in not confirmed",
    description: "Scheduled 8:00 AM wellness check-in has passed without senior acknowledgment.",
    time: "Today · 8:00 AM",
    location: "Bedroom terminal",
    category: "needs_review",
    priority: "NORMAL",
    icon: "schedule",
    threatScore: 0.45,
    signals: ["missed_check_in", "inactivity_threshold"],
    safeWordResult: "PENDING",
    transcriptSnippet: "Scheduled check-in chime played. No verbal confirmation registered within 15 minutes window.",
    seniorQuote: "Alexa prompted: 'Good morning Lakshmi, how are you feeling today?'"
  },
  {
    id: "alert-resolved-1",
    title: "Medication routine confirmed",
    description: "Morning blood pressure medication check acknowledged by senior.",
    time: "Yesterday · 8:15 AM",
    location: "Kitchen Alexa Show",
    category: "resolved",
    priority: "RESOLVED",
    icon: "check_circle",
    threatScore: 0.05,
    signals: ["routine_confirmed"],
    safeWordResult: "PASSED",
    transcriptSnippet: "Senior: 'Alexa, I have taken my morning pills.' Routine logged.",
    seniorQuote: "Confirmed by Lakshmi."
  }
];

const INITIAL_CONTACTS: CaregiverContact[] = [
  {
    id: "contact-1",
    name: "Rahul Sharma",
    role: "Primary Caregiver",
    phone: "+1 (555) 382-9014",
    relationship: "Son",
    isPrimary: true,
    avatarLetter: "R"
  },
  {
    id: "contact-2",
    name: "Priya Sharma",
    role: "Secondary Caregiver",
    phone: "+1 (555) 749-1022",
    relationship: "Daughter",
    isPrimary: false,
    avatarLetter: "P"
  },
  {
    id: "contact-3",
    name: "Dr. A. Mehta",
    role: "Geriatric Physician",
    phone: "+1 (555) 234-5678",
    relationship: "Care Specialist",
    isPrimary: false,
    avatarLetter: "M"
  },
  {
    id: "contact-4",
    name: "Sunita Rao",
    role: "Neighbor",
    phone: "+1 (555) 987-6543",
    relationship: "Local Emergency Keyholder",
    isPrimary: false,
    avatarLetter: "S"
  }
];

// --- Main Unified AegisCare360App Component ---
export default function AegisCare360App() {
  // Navigation & Routing State
  const [currentRoute, setCurrentRoute] = useState<AppRoute>("welcome");
  const [routeHistory, setRouteHistory] = useState<AppRoute[]>(["welcome"]);

  // Core Caregiver & Senior State
  const [seniorName, setSeniorName] = useState("Lakshmi");
  const [seniorRelation, setSeniorRelation] = useState("Mother");
  const [homeStatus, setHomeStatus] = useState<HomeStatus>("OK");
  const [homeVariant, setHomeVariant] = useState<1 | 2>(1);
  const [selectedLanguage, setSelectedLanguage] = useState("en");

  // Alerts & Incident Review
  const [alerts, setAlerts] = useState<AlertItem[]>(INITIAL_ALERTS);
  const [selectedAlertId, setSelectedAlertId] = useState<string>("alert-fall-1");
  const [alertFilter, setAlertFilter] = useState<AlertFilter>("all");

  // Contacts & Care Circle
  const [contacts, setContacts] = useState<CaregiverContact[]>(INITIAL_CONTACTS);
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [newContactName, setNewContactName] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [newContactRel, setNewContactRel] = useState("Family member");

  // Voice Bridge State
  const [bridgeConnected, setBridgeConnected] = useState(false);
  const [bridgeMuted, setBridgeMuted] = useState(false);
  const [bridgeSpeaker, setBridgeSpeaker] = useState(true);
  const [bridgeTimer, setBridgeTimer] = useState(0);

  // Activity Date Selector
  const [activityDateIndex, setActivityDateIndex] = useState(1);
  const activityDates = [
    "Yesterday · 16 October",
    "Today · 17 October",
    "Tomorrow · 18 October"
  ];

  // Demo Controls Floating Visibility
  const [showDemoFlyout, setShowDemoFlyout] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Live mode (see live.ts): on when /config.json exists and a caregiver signs in.
  const [liveConfig, setLiveConfig] = useState<LiveConfig | null>(null);
  const [liveSession, setLiveSession] = useState<{ api: LiveApi; seniorId: string; overview: Overview } | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    loadConfig().then(setLiveConfig);
  }, []);

  // Timer effect for live voice bridge simulation
  useEffect(() => {
    let interval: any = null;
    if (bridgeConnected) {
      interval = setInterval(() => {
        setBridgeTimer((t) => t + 1);
      }, 1000);
    } else {
      setBridgeTimer(0);
    }
    return () => clearInterval(interval);
  }, [bridgeConnected]);

  // Navigate helper with history stack
  const navigate = (route: AppRoute) => {
    setRouteHistory((prev) => [...prev, route]);
    setCurrentRoute(route);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goBack = () => {
    if (routeHistory.length > 1) {
      const newHistory = [...routeHistory];
      newHistory.pop();
      const prev = newHistory[newHistory.length - 1];
      if (prev) {
        setRouteHistory(newHistory);
        setCurrentRoute(prev);
        return;
      }
    }
    setCurrentRoute("home");
  };

  // Toast notification helper
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const applyOverview = (overview: Overview) => {
    setSeniorName(overview.senior.name);
    setHomeStatus(homeStatusFor(overview.senior.status));
    const items = toAlertItems(overview);
    setAlerts(items);
    setSelectedAlertId((prev) => (items.some((i) => i.id === prev) ? prev : (items[0]?.id ?? prev)));
  };

  const handleSignIn = async (email: string, password: string) => {
    if (!liveConfig) {
      navigate("home");
      return;
    }
    setSigningIn(true);
    try {
      const api = new LiveApi(liveConfig, await signIn(liveConfig, email, password));
      const senior = (await api.me()).seniors[0];
      if (!senior) throw new Error("No one is linked to this account yet.");
      const overview = await api.overview(senior.senior_id);
      applyOverview(overview);
      setLiveSession({ api, seniorId: senior.senior_id, overview });
      showToast(`Signed in · watching over ${senior.name}`);
      navigate("home");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setSigningIn(false);
    }
  };

  // Refresh live data every 15 seconds.
  useEffect(() => {
    if (!liveSession) return;
    const { api, seniorId } = liveSession;
    const timer = setInterval(() => {
      api
        .overview(seniorId)
        .then((overview) => {
          applyOverview(overview);
          setLiveSession((s) => (s ? { ...s, overview } : s));
        })
        .catch((err: Error) => showToast(err.message));
    }, 15000);
    return () => clearInterval(timer);
  }, [liveSession?.api, liveSession?.seniorId]);

  // Selected Alert Object
  const fallbackAlert: AlertItem = INITIAL_ALERTS[0]!;
  const currentAlert: AlertItem = alerts.find((a) => a.id === selectedAlertId) ?? alerts[0] ?? fallbackAlert;

  // Simulation Triggers (from Demo Panel)
  const triggerSimulation = (type: "fall" | "scam" | "checkin" | "unknown" | "reset") => {
    if (type === "fall") {
      setHomeStatus("EMERGENCY");
      setSelectedAlertId("alert-fall-1");
      showToast("Simulated Critical Event: Possible fall flagged in Living Room");
      navigate("home");
    } else if (type === "scam") {
      setHomeStatus("NEEDS_VERIFICATION");
      setHomeVariant(2);
      setSelectedAlertId("alert-scam-1");
      showToast("Simulated Threat: Bedrock detected suspicious scam call (Threat score 0.88)");
      navigate("home");
    } else if (type === "checkin") {
      setHomeStatus("NEEDS_VERIFICATION");
      setHomeVariant(1);
      setSelectedAlertId("alert-checkin-1");
      showToast("Simulated Check-In: 8:00 AM routine missed");
      navigate("home");
    } else if (type === "unknown") {
      setHomeStatus("UNKNOWN");
      showToast("Simulated Connectivity Issue: Home hub offline");
      navigate("home");
    } else {
      setHomeStatus("OK");
      showToast("Status Reset: All Clear · Senior is safe & restful");
      navigate("home");
    }
  };

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // Filtered alerts
  const filteredAlerts = alerts.filter((a) => {
    if (alertFilter === "all") return true;
    if (alertFilter === "needs_review") return a.category === "needs_review";
    if (alertFilter === "emergency") return a.category === "emergency";
    if (alertFilter === "resolved") return a.category === "resolved";
    return true;
  });

  // Reusable Bottom Tab Navigation Bar
  const renderBottomNav = (activeTab: "home" | "alerts" | "circle" | "settings") => {
    return (
      <nav
        className="fixed bottom-0 inset-x-0 z-40 pb-safe bg-surface/90 backdrop-blur-xl border-t border-surface-container-high/60 shadow-[0_-2px_12px_rgba(27,43,41,0.05)]"
        aria-label="Main Navigation"
      >
        <div className="flex justify-around items-center h-16 max-w-lg mx-auto px-space-xs">
          <button
            onClick={() => navigate("home")}
            className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors min-h-[48px] ${
              activeTab === "home" ? "text-primary font-bold" : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            <span
              className={`material-symbols-outlined text-[24px] ${activeTab === "home" ? "fill-1 text-primary" : ""}`}
            >
              home
            </span>
            <span className="font-label-sm text-label-sm mt-0.5">Home</span>
          </button>

          <button
            onClick={() => navigate("alerts")}
            className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors min-h-[48px] relative ${
              activeTab === "alerts" ? "text-primary font-bold" : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            <div className="relative">
              <span
                className={`material-symbols-outlined text-[24px] ${
                  activeTab === "alerts" ? "fill-1 text-primary" : ""
                }`}
              >
                notifications
              </span>
              {homeStatus !== "OK" && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-error ring-2 ring-surface animate-pulse" />
              )}
            </div>
            <span className="font-label-sm text-label-sm mt-0.5">Alerts</span>
          </button>

          <button
            onClick={() => navigate("care-circle")}
            className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors min-h-[48px] ${
              activeTab === "circle" ? "text-primary font-bold" : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            <span
              className={`material-symbols-outlined text-[24px] ${
                activeTab === "circle" ? "fill-1 text-primary" : ""
              }`}
            >
              group
            </span>
            <span className="font-label-sm text-label-sm mt-0.5">Circle</span>
          </button>

          <button
            onClick={() => navigate("settings")}
            className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors min-h-[48px] ${
              activeTab === "settings" ? "text-primary font-bold" : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            <span
              className={`material-symbols-outlined text-[24px] ${
                activeTab === "settings" ? "fill-1 text-primary" : ""
              }`}
            >
              settings
            </span>
            <span className="font-label-sm text-label-sm mt-0.5">Settings</span>
          </button>
        </div>
      </nav>
    );
  };

  // Reusable Top Header Bar
  const renderTopHeader = (title: string, showBack = false, subtitle?: string) => {
    return (
      <header className="fixed top-0 inset-x-0 z-40 bg-surface/85 backdrop-blur-xl border-b border-surface-container-high/40 shadow-[0_1px_8px_rgba(27,43,41,0.03)] pt-safe">
        <div className="h-16 px-gutter max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-space-sm min-w-0">
            {showBack ? (
              <button
                aria-label="Go back"
                onClick={goBack}
                className="w-10 h-10 -ml-1.5 flex items-center justify-center rounded-full text-on-surface hover:bg-surface-container active:bg-surface-container-high transition-colors"
              >
                <span className="material-symbols-outlined text-[22px]">arrow_back</span>
              </button>
            ) : (
              <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary shadow-sm shrink-0">
                <span className="material-symbols-outlined text-[22px]">shield_with_heart</span>
              </div>
            )}
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-label-md text-label-md text-on-surface font-semibold tracking-tight truncate">
                  {title}
                </span>
                {subtitle && (
                  <span className="font-label-sm text-label-sm text-on-surface-variant font-medium truncate">
                    · {subtitle}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    homeStatus === "EMERGENCY"
                      ? "bg-error animate-pulse"
                      : homeStatus === "NEEDS_VERIFICATION"
                      ? "bg-tertiary animate-pulse"
                      : homeStatus === "UNKNOWN"
                      ? "bg-outline"
                      : "bg-primary animate-pulse"
                  }`}
                />
                <span className="font-label-sm text-[11px] text-primary font-medium tracking-tight">
                  {homeStatus === "EMERGENCY"
                    ? "Critical Incident"
                    : homeStatus === "NEEDS_VERIFICATION"
                    ? "Needs Review"
                    : homeStatus === "UNKNOWN"
                    ? "Hub Offline"
                    : "Connected · Live sync"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("demo-panel")}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container text-primary hover:bg-surface-container-high font-label-sm text-[11px] font-semibold tracking-wider transition-colors"
              title="Open Demo Simulator Panel"
            >
              <span className="material-symbols-outlined text-[14px]">science</span>
              <span>DEMO</span>
            </button>
            <div className="w-8 h-8 rounded-full bg-primary-container text-on-primary flex items-center justify-center font-semibold text-xs shadow-sm">
              R
            </div>
          </div>
        </div>
      </header>
    );
  };

  // ==========================================
  // SCREEN 1: WELCOME SCREEN
  // ==========================================
  if (currentRoute === "welcome") {
    return (
      <main className="flex-1 flex flex-col relative w-full min-h-screen bg-surface pt-safe pb-safe max-w-lg mx-auto">
        <div className="flex flex-col w-full justify-between px-space-md py-space-lg select-none min-h-screen">
          {/* Top Branding Area & Hero Visual */}
          <div className="relative w-full flex flex-col items-center">
            <div className="absolute -top-10 w-56 h-56 bg-primary-fixed/25 rounded-full blur-3xl pointer-events-none -z-10" />

            <div className="flex flex-col items-center pt-8 pb-4">
              <div className="w-20 h-20 rounded-2xl bg-surface-container-low shadow-sm flex items-center justify-center p-3 mb-5 transition-transform duration-300 hover:scale-105">
                <svg className="w-11 h-11 text-primary-container" fill="none" viewBox="0 0 48 48">
                  <path
                    d="M24 4L8 10V22C8 32.2 14.84 41.68 24 44C33.16 41.68 40 32.2 40 22V10L24 4Z"
                    fill="currentColor"
                    fillOpacity="0.12"
                  />
                  <path
                    d="M24 4L8 10V22C8 32.2 14.84 41.68 24 44C33.16 41.68 40 32.2 40 22V10L24 4Z"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.5"
                  />
                  <path
                    d="M24 33.5C24 33.5 15 28.5 15 21C15 18 17.5 15.5 20.5 15.5C22.24 15.5 23.44 16.35 24 17.2C24.56 16.35 25.76 15.5 27.5 15.5C30.5 15.5 33 18 33 21C33 28.5 24 33.5 24 33.5Z"
                    fill="currentColor"
                    fillOpacity="0.25"
                  />
                  <path
                    d="M20 23.5L23 26.5L29 20"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.5"
                  />
                </svg>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="font-label-lg text-label-lg tracking-wider uppercase text-on-surface font-bold">
                  AegisCare 360
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-primary-container" />
              </div>
            </div>

            <div className="flex flex-col items-center text-center mt-6 max-w-[320px]">
              <h1 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface leading-tight tracking-tight font-bold">
                Care for the people who matter, even when you're apart.
              </h1>
              <p className="font-body-md text-body-md text-on-surface-variant mt-4 leading-relaxed max-w-[280px]">
                Scam protection, fall alerts and calm family coordination with Alexa+ and Amazon Bedrock.
              </p>
            </div>
          </div>

          {/* Action Stack & Discreet Footer */}
          <div className="w-full flex flex-col items-center gap-3.5 pt-12 pb-6">
            <button
              onClick={() => navigate("what-we-do")}
              className="w-full h-[54px] rounded-[14px] bg-primary-container text-on-primary font-label-lg text-label-lg shadow-md flex items-center justify-center transition-all duration-200 active:scale-[0.98] active:bg-primary hover:shadow-lg focus:outline-none"
              type="button"
            >
              Get Started
            </button>

            <button
              onClick={() => navigate("sign-in")}
              className="w-full h-[54px] rounded-[14px] bg-surface-container-lowest text-on-surface font-body-md-medium text-body-md-medium shadow-sm flex items-center justify-center transition-all duration-200 active:scale-[0.98] active:bg-surface-container-high focus:outline-none"
              type="button"
            >
              Sign In
            </button>

            <button
              onClick={() => {
                setHomeStatus("OK");
                navigate("home");
              }}
              className="flex items-center justify-center gap-1.5 py-2 font-label-md text-label-md text-on-surface-variant hover:text-primary transition-colors duration-150 mt-1 focus:outline-none"
              type="button"
            >
              <span>Explore Live Demo</span>
              <span className="material-symbols-outlined text-base">arrow_forward</span>
            </button>

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => navigate("language")}
                className="text-xs text-primary underline hover:text-primary-container"
              >
                Language / भाषा / தமிழ்
              </button>
              <span className="text-outline text-xs">•</span>
              <button
                onClick={() => navigate("demo-panel")}
                className="text-xs text-tertiary font-semibold hover:underline"
              >
                Demo Panel
              </button>
            </div>

            <span className="font-label-sm text-[11px] text-outline tracking-wide pt-2">
              Amazon Developer Hackathon • Alexa+ Self-Hosted MCP Track
            </span>
          </div>
        </div>
      </main>
    );
  }

  // ==========================================
  // SCREEN 2: LANGUAGE SELECTION
  // ==========================================
  if (currentRoute === "language") {
    return (
      <main className="flex-1 flex flex-col relative w-full min-h-screen bg-surface pt-safe pb-safe max-w-lg mx-auto">
        <header className="fixed top-0 inset-x-0 z-40 bg-surface/85 backdrop-blur-xl border-b border-surface-container-high/40 pt-safe">
          <div className="h-16 px-margin max-w-lg mx-auto flex items-center justify-between">
            <div className="flex items-center gap-space-sm">
              <button onClick={goBack} className="w-10 h-10 flex items-center justify-center rounded-full text-on-surface">
                <span className="material-symbols-outlined text-[24px]">arrow_back</span>
              </button>
              <span className="font-label-lg text-primary font-bold">AegisCare 360</span>
            </div>
            <span className="font-label-sm text-on-surface-variant">Step 1 of 4</span>
          </div>
        </header>

        <div className="flex flex-col w-full px-margin pt-20 pb-8 flex-1">
          <div className="w-full flex flex-col pt-2 pb-4">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container text-primary mb-3 self-start">
              <span className="material-symbols-outlined text-[16px]">translate</span>
              <span className="font-label-sm text-label-sm font-semibold tracking-wide uppercase">Care Accessibility</span>
            </div>
            <h1 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface font-bold tracking-tight">
              Choose your language
            </h1>
            <p className="font-body-md text-body-md text-on-surface-variant mt-0.5">
              Use AegisCare in the language that feels most comfortable for your family.
            </p>
          </div>

          <div className="flex flex-col gap-3 w-full my-2">
            {[
              { code: "en", name: "English", native: "English", sub: "Continue in English", glyph: "Aa", badge: "Default" },
              { code: "ta", name: "Tamil", native: "தமிழ்", sub: "தமிழில் தொடரவும்", glyph: "அ", badge: "Family Preferred" },
              { code: "hi", name: "Hindi", native: "हिन्दी", sub: "हिन्दी में जारी रखें", glyph: "अ", badge: "Supported" },
              { code: "es", name: "Spanish", native: "Español", sub: "Continuar en español", glyph: "Es", badge: "Supported" }
            ].map((lang) => {
              const isSelected = selectedLanguage === lang.code;
              return (
                <label
                  key={lang.code}
                  onClick={() => setSelectedLanguage(lang.code)}
                  className={`relative flex items-center justify-between p-4 rounded-xl cursor-pointer transition-all duration-200 bg-surface-container-lowest shadow-sm hover:shadow-md border-2 ${
                    isSelected ? "border-primary-container bg-surface-container-low" : "border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div
                      className={`w-12 h-12 rounded-xl flex items-center justify-center font-headline-sm font-bold shadow-sm shrink-0 ${
                        isSelected ? "bg-primary text-on-primary" : "bg-surface-container-high text-primary"
                      }`}
                    >
                      {lang.glyph}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-headline-sm text-headline-sm text-on-surface font-semibold truncate">
                          {lang.native}
                        </span>
                        <span className="font-label-sm text-label-sm text-on-surface-variant">({lang.name})</span>
                        {lang.badge && (
                          <span className="font-label-sm text-xs px-2 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed font-medium">
                            {lang.badge}
                          </span>
                        )}
                      </div>
                      <span className="font-body-md text-body-md text-on-surface-variant mt-0.5">{lang.sub}</span>
                    </div>
                  </div>
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 border-2 ${
                      isSelected ? "border-primary bg-primary" : "border-outline"
                    }`}
                  >
                    {isSelected && <div className="w-2.5 h-2.5 rounded-full bg-white" />}
                  </div>
                </label>
              );
            })}
          </div>

          <div className="pt-6 mt-auto">
            <button
              onClick={() => navigate("what-we-do")}
              className="w-full h-14 bg-primary text-on-primary rounded-[14px] font-label-lg text-label-lg flex items-center justify-center gap-2 shadow-sm active:bg-primary-container transition-all"
            >
              <span>Continue</span>
              <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ==========================================
  // SCREEN 3: WHAT WE DO (ONBOARDING)
  // ==========================================
  if (currentRoute === "what-we-do") {
    return (
      <main className="flex-1 flex flex-col relative w-full min-h-screen bg-surface pt-safe pb-safe max-w-lg mx-auto px-margin">
        <header className="h-16 flex items-center justify-between">
          <div className="flex items-center gap-space-sm">
            <button onClick={goBack} className="w-10 h-10 flex items-center justify-center rounded-full text-on-surface">
              <span className="material-symbols-outlined text-[22px]">arrow_back</span>
            </button>
            <span className="font-label-lg tracking-wider text-primary font-bold uppercase">AEGISCARE 360</span>
          </div>
          <button
            onClick={() => navigate("create-account")}
            className="text-on-surface-variant font-label-md text-sm hover:text-primary"
          >
            Skip
          </button>
        </header>

        <div className="flex flex-col w-full pb-6 pt-2">
          {/* Progress Indicator */}
          <div className="w-full flex items-center justify-between gap-2 mb-6">
            <div className="h-1.5 flex-1 rounded-full bg-primary-container" />
            <div className="h-1.5 flex-1 rounded-full bg-primary-container" />
            <div className="h-1.5 flex-1 rounded-full bg-surface-container-high" />
            <div className="h-1.5 flex-1 rounded-full bg-surface-container-high" />
          </div>

          <div className="flex flex-col mb-6">
            <div className="inline-flex items-center gap-1.5 mb-2 self-start px-2.5 py-1 rounded-full bg-surface-container text-primary">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span className="font-label-sm text-label-sm tracking-wide font-semibold">ONBOARDING · STEP 2 OF 4</span>
            </div>
            <h1 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface tracking-tight mb-2 font-bold">
              A little more peace of mind
            </h1>
            <p className="font-body-md text-body-md text-on-surface-variant leading-relaxed">
              Three proactive ways AegisCare protects your loved ones around the clock.
            </p>
          </div>

          <div className="flex flex-col gap-4 mb-8">
            <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm flex items-start gap-3.5 border border-surface-container-high/40">
              <div className="w-12 h-12 rounded-2xl bg-surface-container-low flex items-center justify-center shrink-0 text-primary-container">
                <span className="material-symbols-outlined text-2xl">phone_in_talk</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <h2 className="font-body-md-medium text-body-md-medium text-on-surface font-semibold tracking-tight">
                    Scam calls, spotted
                  </h2>
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary bg-surface-container-low px-2 py-0.5 rounded-full">
                    <span className="material-symbols-outlined text-[13px] fill-1">verified</span>
                    Bedrock AI
                  </span>
                </div>
                <p className="font-label-md text-label-md text-on-surface-variant font-normal leading-relaxed">
                  Screen suspicious phone calls and detect impersonation attempts before harm occurs, backed by keyword floors and Bedrock Agents.
                </p>
              </div>
            </div>

            <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm flex items-start gap-3.5 border border-surface-container-high/40">
              <div className="w-12 h-12 rounded-2xl bg-surface-container-low flex items-center justify-center shrink-0 text-primary-container">
                <span className="material-symbols-outlined text-2xl">personal_injury</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <h2 className="font-body-md-medium text-body-md-medium text-on-surface font-semibold tracking-tight">
                    Falls, noticed
                  </h2>
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary bg-surface-container-low px-2 py-0.5 rounded-full">
                    <span className="material-symbols-outlined text-[13px]">sensors</span>
                    Sensors Online
                  </span>
                </div>
                <p className="font-label-md text-label-md text-on-surface-variant font-normal leading-relaxed">
                  Compatible motion sensors flag abrupt falls and trigger calm Alexa+ spoken check-ins with safe-word verification.
                </p>
              </div>
            </div>

            <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm flex items-start gap-3.5 border border-surface-container-high/40">
              <div className="w-12 h-12 rounded-2xl bg-surface-container-low flex items-center justify-center shrink-0 text-primary-container">
                <span className="material-symbols-outlined text-2xl">notifications_active</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <h2 className="font-body-md-medium text-body-md-medium text-on-surface font-semibold tracking-tight">
                    Know when it matters
                  </h2>
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary bg-surface-container-low px-2 py-0.5 rounded-full">
                    <span className="material-symbols-outlined text-[13px]">group</span>
                    Care Circle
                  </span>
                </div>
                <p className="font-label-md text-label-md text-on-surface-variant font-normal leading-relaxed">
                  Receive SMS-safe, prioritized alerts across your family circle with one-tap emergency voice bridge drop-in.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-auto flex flex-col gap-3">
            <button
              onClick={() => navigate("create-account")}
              className="w-full h-14 rounded-[14px] bg-primary text-on-primary font-label-lg text-label-lg flex items-center justify-center gap-2 shadow-sm hover:bg-primary-container active:scale-[0.99] transition-all"
            >
              <span>Continue</span>
              <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
            </button>
            <button
              onClick={() => navigate("sign-in")}
              className="w-full py-2.5 text-center text-on-surface-variant font-label-md hover:text-on-surface"
            >
              Already have an account? Sign In
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ==========================================
  // SCREEN 4: CREATE ACCOUNT
  // ==========================================
  if (currentRoute === "create-account") {
    return (
      <main className="flex-1 flex flex-col relative w-full min-h-screen bg-surface pt-safe pb-safe max-w-lg mx-auto px-5">
        <header className="h-16 flex items-center justify-between">
          <button onClick={goBack} className="w-10 h-10 flex items-center justify-center rounded-full text-on-surface">
            <span className="material-symbols-outlined text-[24px]">arrow_back</span>
          </button>
          <span className="font-label-sm text-primary font-bold uppercase tracking-widest">AegisCare 360</span>
          <div className="w-10" />
        </header>

        <div className="flex flex-col w-full pb-6 select-none">
          <div className="text-center mb-6">
            <h1 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface mb-1.5 font-bold">
              Create your account
            </h1>
            <p className="font-body-md text-body-md text-on-surface-variant">
              One step closer to caring with confidence.
            </p>
          </div>

          <div className="bg-surface-container-lowest rounded-2xl shadow-sm p-5 space-y-4 border border-surface-container-high/40">
            <div className="space-y-1.5">
              <label className="block font-label-md text-label-md text-on-surface" htmlFor="reg-name">
                Full name
              </label>
              <div className="relative flex items-center">
                <span className="material-symbols-outlined absolute left-3.5 text-outline text-[20px]">person</span>
                <input
                  id="reg-name"
                  type="text"
                  defaultValue="Rahul Sharma"
                  className="w-full h-[50px] pl-11 pr-4 rounded-xl bg-surface-container-low text-on-surface font-body-md focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary-container outline-none transition-all"
                  placeholder="Enter your full name"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block font-label-md text-label-md text-on-surface" htmlFor="reg-email">
                Email address
              </label>
              <div className="relative flex items-center">
                <span className="material-symbols-outlined absolute left-3.5 text-outline text-[20px]">mail</span>
                <input
                  id="reg-email"
                  type="email"
                  defaultValue="rahul.sharma@example.com"
                  className="w-full h-[50px] pl-11 pr-4 rounded-xl bg-surface-container-low text-on-surface font-body-md focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary-container outline-none transition-all"
                  placeholder="Enter your email"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block font-label-md text-label-md text-on-surface" htmlFor="reg-pass">
                Password
              </label>
              <div className="relative flex items-center">
                <span className="material-symbols-outlined absolute left-3.5 text-outline text-[20px]">lock</span>
                <input
                  id="reg-pass"
                  type="password"
                  defaultValue="••••••••••••"
                  className="w-full h-[50px] pl-11 pr-11 rounded-xl bg-surface-container-low text-on-surface font-body-md focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary-container outline-none transition-all"
                  placeholder="Create a password"
                />
              </div>
              <div className="flex items-center space-x-1.5 pt-0.5">
                <span className="material-symbols-outlined text-primary text-[16px]">verified_user</span>
                <span className="font-label-sm text-label-sm text-on-surface-variant">Use at least 8 characters.</span>
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={() => navigate("care-profile-setup")}
                className="w-full h-[54px] rounded-[14px] bg-primary hover:bg-primary-container text-on-primary font-label-lg text-label-lg flex items-center justify-center transition-all active:scale-[0.99] shadow-md shadow-primary/20"
                type="button"
              >
                Create Account
              </button>
            </div>
          </div>

          <div className="mt-6 flex flex-col items-center space-y-4">
            <p className="font-label-md text-label-md text-on-surface-variant text-center">
              Already have an account?{" "}
              <button
                onClick={() => navigate("sign-in")}
                className="text-primary font-label-lg hover:underline transition-colors ml-0.5"
              >
                Sign In
              </button>
            </p>

            <button
              onClick={() => {
                setHomeStatus("OK");
                navigate("home");
              }}
              className="inline-flex items-center space-x-1 text-primary font-label-md hover:opacity-85"
            >
              <span>Explore Demo Directly</span>
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </button>

            <div className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-surface-container-low text-on-surface">
              <span className="material-symbols-outlined text-primary text-[16px]">lock</span>
              <span className="font-label-sm text-label-sm font-body-md-medium">Encrypted with AWS KMS</span>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // ==========================================
  // SCREEN 5: SIGN IN
  // ==========================================
  if (currentRoute === "sign-in") {
    return (
      <main className="flex-1 flex flex-col relative w-full min-h-screen bg-surface pt-safe pb-safe max-w-lg mx-auto px-5">
        <header className="flex flex-col items-center justify-center pt-8 pb-6 text-center">
          <div className="relative flex items-center justify-center w-16 h-16 rounded-full bg-surface-container-lowest shadow-sm mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary">
              <span className="material-symbols-outlined text-[24px]">shield_with_heart</span>
            </div>
            <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-primary-container ring-2 ring-surface-container-lowest" />
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="font-headline-sm tracking-wider uppercase text-on-surface text-sm font-bold">
              AEGISCARE 360
            </span>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary-container" />
          </div>
          <div className="mt-4">
            <h1 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface font-bold">Welcome back</h1>
            <p className="font-body-md text-label-lg text-on-surface-variant mt-1">Your family’s peace of mind starts here.</p>
          </div>
        </header>

        <div className="w-full bg-surface-container-lowest rounded-xl shadow-sm p-6 mb-6 border border-surface-container-high/40">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              void handleSignIn(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
            }}
            className="flex flex-col w-full"
          >
            <div className="flex flex-col mb-4">
              <label className="font-label-md text-label-md text-on-surface mb-1.5" htmlFor="login-email">
                Email address
              </label>
              <div className="relative flex items-center w-full">
                <span className="material-symbols-outlined absolute left-3.5 text-outline text-[20px]">mail</span>
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  defaultValue={liveConfig ? "" : "rahul.sharma@example.com"}
                  className="w-full h-[52px] pl-11 pr-4 bg-surface-container-low rounded-xl font-body-md text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary-container outline-none"
                  placeholder="Enter your email"
                  required
                />
              </div>
            </div>

            <div className="flex flex-col mb-2">
              <label className="font-label-md text-label-md text-on-surface mb-1.5" htmlFor="login-pass">
                Password
              </label>
              <div className="relative flex items-center w-full">
                <span className="material-symbols-outlined absolute left-3.5 text-outline text-[20px]">lock</span>
                <input
                  id="login-pass"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  defaultValue={liveConfig ? "" : "••••••••••••"}
                  className="w-full h-[52px] pl-11 pr-12 bg-surface-container-low rounded-xl font-body-md text-on-surface focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary-container outline-none"
                  placeholder="Enter your password"
                  required
                />
              </div>
            </div>

            <div className="flex justify-end mt-1 mb-6">
              <button type="button" className="font-label-md text-label-md text-primary-container hover:underline py-1">
                Forgot password?
              </button>
            </div>

            <button
              type="submit"
              disabled={signingIn}
              className="w-full h-14 bg-primary-container text-on-primary rounded-[14px] font-label-lg text-label-lg flex items-center justify-center shadow-md active:bg-primary transition-all duration-150 disabled:opacity-60"
            >
              {signingIn ? "Signing in…" : "Sign In"}
            </button>
          </form>
        </div>

        <section className="flex flex-col items-center w-full px-2">
          <div className="relative flex py-2 items-center w-full mb-4">
            <div className="flex-grow h-px bg-surface-container-highest" />
            <span className="flex-shrink mx-4 font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider bg-surface px-2">
              New to AegisCare?
            </span>
            <div className="flex-grow h-px bg-surface-container-highest" />
          </div>

          <button
            onClick={() => navigate("create-account")}
            className="w-full h-13 py-3.5 mb-3 rounded-[14px] bg-surface-container-low text-primary-container font-label-lg text-label-lg flex items-center justify-center hover:bg-surface-container active:scale-[0.99] transition-all font-semibold"
          >
            Create account
          </button>

          <button
            onClick={() => {
              setHomeStatus("OK");
              navigate("home");
            }}
            className="flex items-center justify-center gap-1.5 py-2 font-label-md text-label-md text-on-surface-variant hover:text-primary-container transition-colors"
          >
            <span>Explore Live Interactive Demo</span>
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </button>
        </section>

        <footer className="mt-auto mb-4 text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container-low text-on-surface-variant mb-1">
            <span className="material-symbols-outlined text-[14px] text-primary-container">lock_person</span>
            <span className="font-label-sm text-[11px]">Encrypted with AWS KMS</span>
          </div>
          <p className="font-label-sm text-[12px] text-on-surface-variant">Demo data • AegisCare Active Preview</p>
        </footer>
      </main>
    );
  }

  // ==========================================
  // SCREEN 6: CARE PROFILE SETUP
  // ==========================================
  if (currentRoute === "care-profile-setup") {
    return (
      <main className="flex-1 flex flex-col relative w-full min-h-screen bg-surface pt-safe pb-safe max-w-lg mx-auto">
        <header className="h-16 px-margin flex items-center justify-between border-b border-surface-container-high/40">
          <button onClick={goBack} className="w-10 h-10 flex items-center justify-center rounded-full text-on-surface">
            <span className="material-symbols-outlined text-[24px]">arrow_back</span>
          </button>
          <div className="flex flex-col items-center">
            <span className="font-label-sm text-primary uppercase tracking-wide font-bold">AegisCare 360</span>
            <h1 className="font-headline-sm text-headline-sm text-on-surface font-semibold">Care Profile Setup</h1>
          </div>
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white text-xs font-bold">
            R
          </div>
        </header>

        <div className="flex flex-col w-full px-margin pt-4 pb-8 flex-1">
          <div className="flex items-center justify-between mb-2">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-surface-container text-primary font-label-sm font-semibold uppercase">
              Step 1 of 2
            </span>
            <span className="font-label-sm text-on-surface-variant">Profile Context</span>
          </div>

          <div className="w-full bg-surface-container-high h-1.5 rounded-full overflow-hidden flex mb-6">
            <div className="w-1/2 bg-primary h-full rounded-full" />
            <div className="w-1/2 bg-transparent h-full" />
          </div>

          <div className="mb-6">
            <h2 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface font-bold tracking-tight">
              Who are you caring for?
            </h2>
            <p className="font-body-md text-body-md text-on-surface-variant mt-1">
              Let's set up a warm care profile for someone important to you.
            </p>
          </div>

          <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col gap-space-lg border border-surface-container-high/40">
            <div className="flex flex-col items-center justify-center">
              <div className="relative group cursor-pointer">
                <div className="w-[84px] h-[84px] rounded-full bg-surface-container flex items-center justify-center shadow-inner overflow-hidden border-2 border-primary-container/20">
                  <span className="material-symbols-outlined text-[48px] text-primary fill-1">face_4</span>
                </div>
                <div className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-md">
                  <span className="material-symbols-outlined text-[16px]">add_a_photo</span>
                </div>
              </div>
              <button className="mt-2 text-primary font-label-md text-label-md flex items-center gap-1" type="button">
                <span>Add photo</span>
                <span className="text-on-surface-variant text-label-sm font-normal">(optional)</span>
              </button>
            </div>

            <div className="flex flex-col gap-space-md">
              <div className="flex flex-col gap-1.5">
                <label className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface font-semibold flex items-center justify-between">
                  <span>Full Name</span>
                  <span className="text-on-surface-variant font-normal normal-case">Care recipient</span>
                </label>
                <div className="h-[54px] rounded-lg bg-surface-container-low px-3.5 flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[20px] text-on-surface-variant">person</span>
                  <input
                    className="bg-transparent flex-1 text-on-surface font-body-md-medium outline-none"
                    value={seniorName}
                    onChange={(e) => setSeniorName(e.target.value)}
                    placeholder="e.g. Eleanor or Dad"
                    type="text"
                  />
                  <span className="material-symbols-outlined text-[18px] text-primary fill-1">check_circle</span>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface font-semibold flex items-center justify-between">
                  <span>Your Relationship</span>
                  <span className="text-primary font-normal text-label-sm">Essential context</span>
                </label>
                <div className="flex flex-wrap gap-2 pt-1">
                  {["Mother", "Father", "Grandparent", "Spouse", "Other"].map((rel) => {
                    const isSelected = seniorRelation === rel;
                    return (
                      <button
                        key={rel}
                        onClick={() => setSeniorRelation(rel)}
                        type="button"
                        className={`px-3.5 py-1.5 rounded-full font-label-md text-label-md flex items-center gap-1.5 transition-all ${
                          isSelected
                            ? "bg-primary text-on-primary shadow-sm font-semibold"
                            : "bg-surface-container text-on-surface hover:bg-surface-container-high"
                        }`}
                      >
                        {isSelected && <span className="material-symbols-outlined text-[15px]">check</span>}
                        <span>{rel}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="bg-surface-container-low rounded-lg p-3 flex items-start gap-2.5">
                <span className="material-symbols-outlined text-[18px] text-primary mt-0.5 shrink-0 fill-1">
                  privacy_tip
                </span>
                <div className="flex flex-col text-on-surface-variant font-label-sm leading-relaxed">
                  <span className="font-semibold text-on-surface">You control what gets shared</span>
                  <span>Medical history and sensor integrations are entirely optional and can be managed later.</span>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-6 mt-auto flex flex-col gap-space-sm">
            <button
              onClick={() => navigate("trusted-contact")}
              className="w-full h-[54px] rounded-[14px] bg-primary text-on-primary font-label-lg text-label-lg font-semibold shadow-sm flex items-center justify-center gap-2 hover:bg-primary-container active:scale-[0.99] transition-all"
            >
              <span>Continue to Trusted Contacts</span>
              <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ==========================================
  // SCREEN 7: TRUSTED CONTACT & CONSENT
  // ==========================================
  if (currentRoute === "trusted-contact") {
    return (
      <main className="flex-1 flex flex-col relative w-full min-h-screen bg-surface pt-safe pb-safe max-w-lg mx-auto px-margin">
        <header className="h-16 flex items-center justify-between border-b border-surface-container-high/40">
          <button onClick={goBack} className="w-10 h-10 flex items-center justify-center rounded-full text-on-surface">
            <span className="material-symbols-outlined text-[24px]">arrow_back</span>
          </button>
          <span className="font-label-lg text-primary font-bold">AegisCare 360</span>
          <span className="font-label-sm text-on-surface-variant">Step 2 of 2</span>
        </header>

        <div className="flex flex-col w-full pb-8 pt-4">
          <div className="flex flex-col gap-space-xs mb-space-md">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary-fixed/40 text-primary font-label-sm font-semibold uppercase tracking-wide">
                <span className="material-symbols-outlined text-[14px]">shield_with_heart</span>
                Step 2 of 2 • Consent &amp; Emergency Loop
              </span>
              <span className="font-label-sm text-on-surface-variant font-medium">100%</span>
            </div>
            <div className="w-full flex gap-1.5 h-1.5 rounded-full overflow-hidden bg-surface-container-high mt-1">
              <div className="h-full flex-1 bg-primary rounded-full" />
              <div className="h-full flex-1 bg-primary rounded-full" />
            </div>
          </div>

          <div className="flex flex-col gap-1 mb-space-md">
            <h1 className="font-headline-md text-headline-md text-on-surface font-bold tracking-tight">
              Add a trusted contact
            </h1>
            <p className="font-body-md text-body-md text-on-surface-variant">
              Choose someone who can help if you can't respond.
            </p>
          </div>

          <div className="bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-surface-container-high/40 mb-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary-fixed/40 flex items-center justify-center text-primary">
                  <span className="material-symbols-outlined text-[18px]">contact_emergency</span>
                </div>
                <span className="font-label-md text-label-md uppercase tracking-wider text-on-surface font-semibold">
                  Emergency Loop Contact
                </span>
              </div>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-surface-container-high font-label-sm text-on-surface-variant">
                Demo
              </span>
            </div>

            <div className="flex flex-col gap-1.5 mb-4">
              <label className="font-label-sm uppercase tracking-wider text-on-surface font-semibold" htmlFor="tc-name">
                Contact Name
              </label>
              <div className="relative flex items-center bg-surface-container-low rounded-xl px-3.5 py-3.5">
                <span className="material-symbols-outlined text-primary text-[20px] mr-3">person</span>
                <input
                  id="tc-name"
                  type="text"
                  defaultValue="Rohan Sharma"
                  className="w-full bg-transparent text-on-surface font-body-md-medium outline-none"
                  placeholder="Enter full name"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5 mb-4">
              <label className="font-label-sm uppercase tracking-wider text-on-surface font-semibold" htmlFor="tc-phone">
                Phone Number
              </label>
              <div className="relative flex items-center bg-surface-container-low rounded-xl px-3.5 py-3.5">
                <span className="material-symbols-outlined text-primary text-[20px] mr-3">call</span>
                <input
                  id="tc-phone"
                  type="tel"
                  defaultValue="+1 (555) 382-9014"
                  className="w-full bg-transparent text-on-surface font-body-md-medium outline-none"
                  placeholder="+1 (555) 000-0000"
                />
              </div>
            </div>

            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-surface-container-low text-on-surface">
              <span className="material-symbols-outlined text-primary text-[20px] shrink-0 mt-0.5">verified_user</span>
              <p className="font-label-sm text-label-sm text-on-surface-variant leading-relaxed">
                This person will be notified automatically if an emergency fall or suspicious threat is confirmed by the safe-word protocol.
              </p>
            </div>
          </div>

          <div className="bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-surface-container-high/40 mb-6">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center text-primary">
                <span className="material-symbols-outlined text-[18px]">lock</span>
              </div>
              <h2 className="font-headline-sm text-headline-sm text-on-surface font-bold">Your privacy matters</h2>
            </div>
            <p className="font-label-sm text-on-surface-variant leading-relaxed">
              AegisCare 360 only dispatches SMS and alerts during verified incidents. Microphones and audio streams stay on-device until a threat threshold is crossed.
            </p>
          </div>

          <div className="mt-auto flex flex-col gap-3">
            <button
              onClick={() => {
                showToast("Setup complete! Welcome to AegisCare 360.");
                setHomeStatus("OK");
                navigate("home");
              }}
              className="w-full h-14 rounded-xl bg-primary text-on-primary font-label-lg text-label-lg font-semibold flex items-center justify-center gap-2 shadow-sm hover:bg-primary-container active:scale-[0.99] transition-all"
            >
              <span className="material-symbols-outlined text-[20px]">task_alt</span>
              <span>Finish Setup &amp; Enter Dashboard</span>
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ==========================================
  // SCREEN 8: HOME DASHBOARD (OK / VERIFICATION / EMERGENCY / UNKNOWN)
  // ==========================================
  if (currentRoute === "home") {
    return (
      <div className="min-h-screen bg-surface flex flex-col max-w-lg mx-auto">
        {renderTopHeader(seniorName, false, seniorRelation)}

        <main className="flex-1 flex flex-col pt-20 pb-28 px-gutter">
          <div className="flex flex-col gap-space-md">
            {/* Header / Profile Summary Strip */}
            <section className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm border border-surface-container-high/40">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-space-sm min-w-0">
                  <div className="relative w-12 h-12 rounded-full overflow-hidden bg-surface-container-high shrink-0 border-2 border-primary-container/20">
                    <img
                      className="w-full h-full object-cover"
                      alt="Lakshmi portrait"
                      src="/images/senior-home.jpg"
                    />
                    <div
                      className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full ring-2 ring-surface-container-lowest ${
                        homeStatus === "EMERGENCY"
                          ? "bg-error"
                          : homeStatus === "NEEDS_VERIFICATION"
                          ? "bg-tertiary"
                          : homeStatus === "UNKNOWN"
                          ? "bg-outline"
                          : "bg-primary"
                      }`}
                    />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-space-xs">
                      <h2 className="font-label-lg text-label-lg text-on-surface truncate font-semibold">
                        {seniorName}
                      </h2>
                      <span className="font-body-md text-on-surface-variant text-label-sm">· {seniorRelation}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          homeStatus === "EMERGENCY"
                            ? "bg-error animate-pulse"
                            : homeStatus === "NEEDS_VERIFICATION"
                            ? "bg-tertiary animate-pulse"
                            : homeStatus === "UNKNOWN"
                            ? "bg-outline"
                            : "bg-primary animate-pulse"
                        }`}
                      />
                      <span className="font-label-sm text-label-sm text-primary truncate">
                        {homeStatus === "EMERGENCY"
                          ? "Living room fall flagged · Review now"
                          : homeStatus === "NEEDS_VERIFICATION"
                          ? "Safe-word challenged · Action requested"
                          : homeStatus === "UNKNOWN"
                          ? "Hub Offline · Last seen 42m ago"
                          : "All sensors connected · Bedroom hub active"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setHomeVariant(homeVariant === 1 ? 2 : 1)}
                    className="px-2 py-1 rounded-lg bg-surface-container-low text-xs font-semibold text-primary hover:bg-surface-container"
                    title="Toggle variant 1 / variant 2"
                  >
                    V{homeVariant}
                  </button>
                  <button
                    onClick={() => navigate("activity")}
                    aria-label="Sensor health status"
                    className="w-10 h-10 rounded-full bg-surface-container-low flex items-center justify-center text-primary active:scale-95 transition-transform shrink-0"
                  >
                    <span className="material-symbols-outlined text-[20px] fill-1">sensors</span>
                  </button>
                </div>
              </div>
            </section>

            {/* DYNAMIC HERO CARD BY STATUS */}
            {homeStatus === "OK" && (
              <section className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm relative overflow-hidden flex flex-col border border-surface-container-high/40">
                <div className="absolute -top-12 -right-12 w-40 h-40 bg-primary-fixed/25 rounded-full blur-2xl pointer-events-none" />
                <div className="relative z-10 flex flex-col">
                  <div className="inline-flex items-center self-start gap-1.5 px-3 py-1.5 rounded-full bg-surface-container text-primary font-label-md font-semibold text-xs">
                    <span className="material-symbols-outlined text-[18px] fill-1">verified_user</span>
                    <span>STATUS: OK · ALL CLEAR</span>
                  </div>

                  <h1 className="font-headline-md text-headline-md text-on-surface mt-space-md tracking-tight font-bold">
                    {homeVariant === 1 ? "Lakshmi is safe & restful" : "Normal home routine detected"}
                  </h1>

                  <p className="font-body-md text-body-md text-on-surface-variant mt-space-sm leading-relaxed">
                    No scam threats detected today. Movement detected in living room 14 mins ago. Bedside radar and fall sensors fully active.
                  </p>

                  <div className="grid grid-cols-2 gap-space-sm mt-space-md mb-space-lg">
                    <div className="bg-surface-container-low rounded-xl p-space-sm flex items-center gap-space-sm">
                      <div className="w-8 h-8 rounded-lg bg-surface-container-lowest flex items-center justify-center text-primary shrink-0 shadow-sm">
                        <span className="material-symbols-outlined text-[18px]">directions_walk</span>
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="font-label-sm text-xs text-on-surface-variant truncate">Recent Activity</span>
                        <span className="font-label-md text-sm text-on-surface font-semibold truncate">Living Room</span>
                      </div>
                    </div>
                    <div className="bg-surface-container-low rounded-xl p-space-sm flex items-center gap-space-sm">
                      <div className="w-8 h-8 rounded-lg bg-surface-container-lowest flex items-center justify-center text-primary shrink-0 shadow-sm">
                        <span className="material-symbols-outlined text-[18px]">security</span>
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="font-label-sm text-xs text-on-surface-variant truncate">Shield Level</span>
                        <span className="font-label-md text-sm text-on-surface font-semibold truncate">100% Protected</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-space-sm">
                    <button
                      onClick={() => {
                        setSelectedAlertId("alert-fall-1");
                        navigate("voice-bridge");
                      }}
                      className="w-full h-[54px] rounded-[14px] bg-primary-container text-on-primary font-label-lg flex items-center justify-center gap-2 shadow-sm active:bg-primary transition-all font-semibold"
                    >
                      <span className="material-symbols-outlined text-[22px]">record_voice_over</span>
                      <span>Open Voice Bridge to Room</span>
                    </button>
                    <button
                      onClick={() => showToast("Connecting direct call to Lakshmi's phone...")}
                      className="w-full h-[46px] rounded-[14px] bg-surface-container-low text-primary font-label-md flex items-center justify-center gap-2 hover:bg-surface-container transition-colors font-medium"
                    >
                      <span className="material-symbols-outlined text-[18px] fill-1">call</span>
                      <span>Call Lakshmi Directly</span>
                    </button>
                  </div>
                </div>
              </section>
            )}

            {homeStatus === "NEEDS_VERIFICATION" && (
              <section className="relative overflow-hidden rounded-xl bg-surface-container-lowest shadow-sm border-l-4 border-l-tertiary border border-surface-container-high/40 p-5">
                <div className="flex flex-col space-y-space-md">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-space-sm">
                      <div className="w-11 h-11 rounded-full bg-tertiary-fixed/70 flex items-center justify-center text-tertiary shrink-0">
                        <span className="material-symbols-outlined text-[24px] fill-1">error</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed font-label-sm text-xs font-semibold w-fit">
                          <span className="material-symbols-outlined text-[13px]">notification_important</span>
                          <span>Requires attention</span>
                        </span>
                        <h2 className="font-headline-md text-headline-md text-tertiary font-bold mt-0.5">
                          {homeVariant === 1 ? "Needs verification" : "Suspicious call flagged"}
                        </h2>
                      </div>
                    </div>
                  </div>

                  <div className="bg-surface-container-low rounded-lg p-3.5 flex items-start gap-2.5">
                    <span className="material-symbols-outlined text-tertiary text-[20px] mt-0.5 shrink-0">
                      {homeVariant === 1 ? "schedule" : "record_voice_over"}
                    </span>
                    <p className="font-body-md text-body-md text-on-surface leading-snug">
                      {homeVariant === 1
                        ? "A scheduled check-in has passed without response. Take a quick moment to verify Lakshmi's morning routine."
                        : "Intercepted urgent utility impersonation call at 2:14 PM. AI screener held the caller. Safe word challenged."}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 pt-1">
                    <button
                      onClick={() => {
                        if (homeVariant === 1) {
                          navigate("verification-prompt");
                        } else {
                          setSelectedAlertId("alert-scam-1");
                          navigate("alert-details");
                        }
                      }}
                      className="w-full h-14 rounded-xl bg-primary-container text-on-primary font-label-lg font-semibold shadow-sm active:bg-primary transition-all flex items-center justify-center gap-2"
                    >
                      <span>{homeVariant === 1 ? "Check in Now" : "Review Intercepted Call"}</span>
                      <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
                    </button>

                    <button
                      onClick={() => {
                        setHomeStatus("OK");
                        showToast("Flag dismissed as verified trusted contact.");
                      }}
                      className="w-full py-2.5 text-center text-on-surface-variant font-label-md hover:text-on-surface"
                    >
                      Dismiss as Trusted &amp; Resolve
                    </button>
                  </div>
                </div>
              </section>
            )}

            {homeStatus === "EMERGENCY" && (
              <section className="relative overflow-hidden rounded-xl bg-error-container p-6 shadow-md border border-error/30">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-error/15 flex items-center justify-center text-error shrink-0">
                      <span className="material-symbols-outlined text-[28px] fill-1">warning</span>
                    </div>
                    <div>
                      <span className="font-headline-lg-mobile text-headline-lg-mobile text-error font-bold block">
                        Emergency
                      </span>
                      <span className="font-label-sm text-xs text-error/80 mt-0.5 block">
                        Flagged at 9:15 AM · Living Room
                      </span>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-error text-on-error font-label-sm text-xs font-bold shadow-sm shrink-0">
                    <span className="material-symbols-outlined text-[14px]">error</span>
                    <span>High Priority</span>
                  </span>
                </div>

                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-container-lowest/90 mb-3.5">
                  <span className="material-symbols-outlined text-error text-[18px]">radio_button_checked</span>
                  <span className="font-label-md text-sm text-on-surface font-bold">Action Needed Immediately</span>
                </div>

                <p className="font-body-md text-on-surface font-medium leading-relaxed mb-6">
                  A possible fall has been flagged by bedroom motion sensors. Lakshmi did not respond to the automated safe-word voice inquiry.
                </p>

                <div className="flex flex-col gap-2.5">
                  <button
                    onClick={() => {
                      setSelectedAlertId("alert-fall-1");
                      navigate("voice-bridge");
                    }}
                    className="w-full h-14 rounded-xl bg-error hover:bg-error/90 active:scale-[0.99] text-on-error font-label-lg font-bold flex items-center justify-center gap-2 shadow-lg transition-all"
                  >
                    <span className="material-symbols-outlined text-[22px]">phone_in_talk</span>
                    <span>Connect Live Voice Bridge</span>
                  </button>
                  <button
                    onClick={() => {
                      setSelectedAlertId("alert-fall-1");
                      navigate("alert-details");
                    }}
                    className="w-full h-12 rounded-xl bg-surface-container-lowest text-on-surface font-label-md font-semibold flex items-center justify-center gap-2 shadow-sm hover:bg-surface-container-low transition-all"
                  >
                    <span className="material-symbols-outlined text-[18px]">assignment</span>
                    <span>View Incident Details</span>
                  </button>
                </div>
              </section>
            )}

            {homeStatus === "UNKNOWN" && (
              <section className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm border border-surface-container-high/40 flex flex-col gap-space-md">
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container text-on-surface-variant self-start">
                  <span className="material-symbols-outlined text-[18px]">cloud_off</span>
                  <span className="font-label-md text-xs tracking-wider font-semibold">STATUS: UNKNOWN · OFFLINE</span>
                </div>

                <div>
                  <h1 className="font-headline-md text-headline-md text-on-surface font-bold">
                    Home hub disconnected
                  </h1>
                  <p className="font-body-md text-body-md text-on-surface-variant leading-relaxed mt-1">
                    Cannot confirm safety status. Living room Wi-Fi hub has been unreachable since 2:40 PM. Sensors paused.
                  </p>
                </div>

                <div className="rounded-lg bg-surface-container-low p-space-sm flex items-start gap-space-sm">
                  <span className="material-symbols-outlined text-[20px] text-on-surface-variant mt-0.5">info</span>
                  <div className="flex flex-col text-on-surface-variant text-xs">
                    <span className="font-label-md text-on-surface font-semibold">Previous check-in was nominal</span>
                    <span>Vitals and perimeter sensors recorded normal baseline at 2:15 PM today.</span>
                  </div>
                </div>

                <div className="flex flex-col gap-space-sm pt-space-xs">
                  <button
                    onClick={() => showToast("Calling Lakshmi directly on landline...")}
                    className="w-full h-[54px] rounded-[14px] bg-primary-container text-on-primary font-label-lg font-semibold flex items-center justify-center gap-2 shadow-sm"
                  >
                    <span className="material-symbols-outlined text-[20px]">call</span>
                    <span>Call Lakshmi Directly</span>
                  </button>
                  <button
                    onClick={() => {
                      showToast("Pinging Echo Show hub... Connection restored!");
                      setHomeStatus("OK");
                    }}
                    className="w-full h-[50px] rounded-[14px] bg-surface-container-low text-primary-container font-label-md font-semibold flex items-center justify-center gap-2 hover:bg-surface-container"
                  >
                    <span className="material-symbols-outlined text-[20px]">router</span>
                    <span>Ping Hub Again</span>
                  </button>
                </div>
              </section>
            )}

            {/* Latest Events Timeline Block */}
            <section className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm border border-surface-container-high/40 flex flex-col">
              <div className="flex items-center justify-between mb-space-md">
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-primary text-[20px]">history_toggle_off</span>
                  <h3 className="font-label-lg text-label-lg text-on-surface font-semibold">Latest Events</h3>
                </div>
                <button
                  onClick={() => navigate("activity")}
                  className="font-label-sm text-xs text-primary font-semibold hover:underline flex items-center gap-0.5"
                >
                  View all
                  <span className="material-symbols-outlined text-[14px]">chevron_right</span>
                </button>
              </div>

              <div className="flex flex-col space-y-space-md">
                <div
                  onClick={() => {
                    setSelectedAlertId("alert-scam-1");
                    navigate("alert-details");
                  }}
                  className="flex items-start gap-space-sm cursor-pointer group"
                >
                  <div className="w-9 h-9 rounded-full bg-secondary-fixed flex items-center justify-center text-secondary shrink-0 mt-0.5">
                    <span className="material-symbols-outlined text-[18px]">phone_disabled</span>
                  </div>
                  <div className="flex-1 flex flex-col min-w-0">
                    <div className="flex items-center justify-between gap-space-xs">
                      <span className="font-label-md text-on-surface font-semibold truncate group-hover:text-primary">
                        AI Scam Blocker
                      </span>
                      <span className="font-label-sm text-xs text-secondary bg-secondary-fixed/50 px-2 py-0.5 rounded-full shrink-0">
                        11:20 AM
                      </span>
                    </div>
                    <p className="font-body-md text-xs text-on-surface-variant mt-0.5 leading-snug">
                      Grandparent scam intercepted &amp; safe-word challenge invoked.
                    </p>
                  </div>
                </div>

                <div className="w-full h-[1px] bg-surface-container-high" />

                <div
                  onClick={() => {
                    setSelectedAlertId("alert-fall-1");
                    navigate("alert-details");
                  }}
                  className="flex items-start gap-space-sm cursor-pointer group"
                >
                  <div className="w-9 h-9 rounded-full bg-error-container flex items-center justify-center text-error shrink-0 mt-0.5">
                    <span className="material-symbols-outlined text-[18px]">personal_injury</span>
                  </div>
                  <div className="flex-1 flex flex-col min-w-0">
                    <div className="flex items-center justify-between gap-space-xs">
                      <span className="font-label-md text-on-surface font-semibold truncate group-hover:text-error">
                        Possible Fall Flagged
                      </span>
                      <span className="font-label-sm text-xs text-error bg-error-container px-2 py-0.5 rounded-full shrink-0">
                        9:15 AM
                      </span>
                    </div>
                    <p className="font-body-md text-xs text-on-surface-variant mt-0.5 leading-snug">
                      Living room sensor registered sudden movement deceleration.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </main>

        {renderBottomNav("home")}
      </div>
    );
  }

  // ==========================================
  // SCREEN 9: ALERTS LIST
  // ==========================================
  if (currentRoute === "alerts") {
    return (
      <div className="min-h-screen bg-surface flex flex-col max-w-lg mx-auto">
        {renderTopHeader("Alerts", false, "Incident Feed")}

        <main className="flex-1 flex flex-col pt-20 pb-28 px-margin">
          <div className="flex flex-col gap-space-md">
            <section className="bg-surface-container-lowest rounded-2xl p-space-md shadow-sm border border-surface-container-high/40">
              <div className="flex items-start gap-space-md">
                <div className="w-12 h-12 rounded-2xl bg-tertiary-fixed/40 flex items-center justify-center shrink-0 text-tertiary">
                  <span className="material-symbols-outlined text-2xl fill-1">warning</span>
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface font-bold leading-none">
                      {alerts.filter((a) => a.category !== "resolved").length}
                    </span>
                    <h2 className="font-label-lg text-label-lg text-on-surface font-semibold tracking-tight">
                      Need your attention
                    </h2>
                  </div>
                  <p className="font-body-md text-xs text-on-surface-variant mt-1 leading-relaxed">
                    Active notifications synced from EventBridge across caregivers.
                  </p>
                </div>
              </div>
            </section>

            {/* Filter Chips */}
            <div className="flex items-center gap-2 overflow-x-auto py-1 no-scrollbar">
              {[
                { id: "all", label: `All (${alerts.length})` },
                { id: "needs_review", label: "Needs review (2)" },
                { id: "emergency", label: "Emergency (1)" },
                { id: "resolved", label: "Resolved (1)" }
              ].map((chip) => {
                const isActive = alertFilter === chip.id;
                return (
                  <button
                    key={chip.id}
                    onClick={() => setAlertFilter(chip.id as AlertFilter)}
                    className={`inline-flex items-center justify-center h-10 px-4 rounded-full font-label-md text-xs transition-all shrink-0 font-semibold shadow-sm ${
                      isActive
                        ? "bg-primary-container text-on-primary-container"
                        : "bg-surface-container-lowest text-on-surface-variant hover:text-on-surface"
                    }`}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>

            {/* Alert Cards */}
            <div className="space-y-space-md">
              {filteredAlerts.map((alert) => (
                <article
                  key={alert.id}
                  onClick={() => {
                    setSelectedAlertId(alert.id);
                    navigate("alert-details");
                  }}
                  className="bg-surface-container-lowest rounded-2xl p-space-md shadow-sm border border-surface-container-high/40 transition-transform active:scale-[0.99] cursor-pointer flex flex-col gap-3 hover:shadow-md"
                >
                  <div className="flex items-start gap-space-md">
                    <div
                      className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                        alert.priority === "CRITICAL"
                          ? "bg-error-container text-error"
                          : alert.priority === "HIGH"
                          ? "bg-tertiary-fixed text-tertiary"
                          : alert.priority === "RESOLVED"
                          ? "bg-primary-fixed text-primary"
                          : "bg-surface-container text-primary"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[24px] fill-1">{alert.icon}</span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="font-label-lg text-on-surface font-semibold truncate">{alert.title}</h4>
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold shrink-0 ${
                            alert.priority === "CRITICAL"
                              ? "bg-error text-white"
                              : alert.priority === "HIGH"
                              ? "bg-tertiary-fixed text-on-tertiary-fixed"
                              : alert.priority === "RESOLVED"
                              ? "bg-surface-container text-primary"
                              : "bg-surface-container text-on-surface-variant"
                          }`}
                        >
                          {alert.priority}
                        </span>
                      </div>
                      <p className="font-body-md text-xs text-on-surface-variant mt-1 leading-snug">
                        {alert.description}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 mt-1 bg-surface-container-low/50 -mx-space-md -mb-space-md px-space-md py-2.5 rounded-b-2xl">
                    <span className="font-label-sm text-xs text-on-surface-variant flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px] text-outline">schedule</span>
                      {alert.time}
                    </span>
                    <span className="inline-flex items-center gap-1 font-label-md text-xs text-primary font-semibold">
                      <span>View details</span>
                      <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </main>

        {renderBottomNav("alerts")}
      </div>
    );
  }

  // ==========================================
  // SCREEN 10: ALERT DETAILS
  // ==========================================
  if (currentRoute === "alert-details") {
    return (
      <div className="min-h-screen bg-surface flex flex-col max-w-lg mx-auto">
        {renderTopHeader("Incident Review", true, currentAlert.title)}

        <main className="flex-1 flex flex-col pt-20 pb-28 px-margin">
          <div className="flex flex-col gap-space-md">
            {/* Back to Alerts */}
            <div className="flex items-center justify-between">
              <button
                onClick={() => navigate("alerts")}
                className="inline-flex items-center gap-1 text-primary font-label-md text-sm font-semibold hover:underline"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                <span>Back to alerts</span>
              </button>
              <span className="font-label-sm text-xs text-on-surface-variant bg-surface-container px-2.5 py-1 rounded-full">
                Incident #{currentAlert.id.toUpperCase()}
              </span>
            </div>

            {/* Summary Card */}
            <section
              className={`rounded-xl p-5 shadow-sm border ${
                currentAlert.priority === "CRITICAL"
                  ? "bg-error-container/40 border-error/30"
                  : "bg-surface-container-lowest border-surface-container-high/40"
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      currentAlert.priority === "CRITICAL"
                        ? "bg-error text-white"
                        : "bg-tertiary-fixed text-tertiary"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px] fill-1">{currentAlert.icon}</span>
                  </div>
                  <span
                    className={`font-label-md text-xs font-bold uppercase tracking-wider ${
                      currentAlert.priority === "CRITICAL" ? "text-error" : "text-tertiary"
                    }`}
                  >
                    {currentAlert.priority} · {currentAlert.category.replace("_", " ")}
                  </span>
                </div>
                <span className="font-label-sm text-xs font-semibold px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant">
                  {currentAlert.time}
                </span>
              </div>

              <h2 className="font-headline-sm text-headline-sm text-on-surface font-bold leading-tight">
                {currentAlert.title}
              </h2>
              <p className="font-body-md text-sm text-on-surface-variant leading-relaxed mt-1">
                {currentAlert.description}
              </p>
            </section>

            {/* Amazon Bedrock Threat Agent Card (if threat score exists) */}
            {currentAlert.threatScore !== undefined && (
              <section className="rounded-xl p-5 bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-[20px]">smart_toy</span>
                    <h3 className="font-label-lg text-on-surface font-semibold text-sm">
                      Amazon Bedrock Threat Agent Score
                    </h3>
                  </div>
                  <span className="font-label-sm text-xs px-2.5 py-0.5 rounded-full bg-surface-container-high font-mono text-primary font-bold">
                    Score: {currentAlert.threatScore.toFixed(2)}
                  </span>
                </div>

                <div className="w-full bg-surface-container-high h-2.5 rounded-full overflow-hidden mb-3">
                  <div
                    className={`h-full rounded-full ${
                      currentAlert.threatScore > 0.8
                        ? "bg-error"
                        : currentAlert.threatScore > 0.4
                        ? "bg-tertiary"
                        : "bg-primary"
                    }`}
                    style={{ width: `${currentAlert.threatScore * 100}%` }}
                  />
                </div>

                <div className="p-3 bg-surface-container-low rounded-lg text-xs space-y-1.5 mb-3">
                  <div className="font-semibold text-on-surface">Signals Detected:</div>
                  <div className="flex flex-wrap gap-1.5">
                    {currentAlert.signals?.map((sig) => (
                      <span key={sig} className="px-2 py-0.5 rounded bg-surface-container text-on-surface font-mono">
                        {sig}
                      </span>
                    ))}
                  </div>
                </div>

                {currentAlert.transcriptSnippet && (
                  <div className="p-3.5 bg-surface-container-low rounded-lg border-l-2 border-primary-container text-xs text-on-surface space-y-1">
                    <div className="font-semibold text-primary">Transcript Quoted verbatim:</div>
                    <p className="italic font-mono leading-relaxed">"{currentAlert.transcriptSnippet}"</p>
                    {currentAlert.seniorQuote && (
                      <p className="text-on-surface-variant mt-1">{currentAlert.seniorQuote}</p>
                    )}
                  </div>
                )}
              </section>
            )}

            {/* Action Bar */}
            <div className="flex flex-col gap-2.5 pt-2">
              <button
                onClick={() => navigate("voice-bridge")}
                className="w-full h-14 bg-primary text-on-primary rounded-xl font-label-lg font-semibold flex items-center justify-center gap-2 shadow-sm hover:bg-primary-container active:scale-[0.99] transition-all"
              >
                <span className="material-symbols-outlined text-[20px]">phone_in_talk</span>
                <span>Connect Live Emergency Voice Bridge</span>
              </button>

              <button
                onClick={() => showToast(`Calling ${seniorName} on direct line...`)}
                className="w-full h-12 bg-surface-container-low text-primary rounded-xl font-label-md font-semibold flex items-center justify-center gap-2 hover:bg-surface-container transition-all"
              >
                <span className="material-symbols-outlined text-[18px]">call</span>
                <span>Call Directly</span>
              </button>

              <button
                onClick={() => {
                  // Live mode: tell the backend, which marks the incident acknowledged for everyone.
                  const alertId = liveSession?.overview.alerts.find((a) => a.incident_id === currentAlert.id)?.alert_id;
                  if (liveSession && alertId) liveSession.api.acknowledge(alertId, "ACK").catch((err: Error) => showToast(err.message));
                  setAlerts((prev) =>
                    prev.map((a) => (a.id === currentAlert.id ? { ...a, category: "resolved", priority: "RESOLVED" } : a))
                  );
                  setHomeStatus("OK");
                  showToast("Incident marked as reviewed and resolved.");
                  navigate("alerts");
                }}
                className="w-full h-11 border border-surface-container-highest rounded-xl text-on-surface-variant font-label-md text-xs hover:text-on-surface"
              >
                Mark Incident as Reviewed &amp; Resolved
              </button>
            </div>
          </div>
        </main>

        {renderBottomNav("alerts")}
      </div>
    );
  }

  // ==========================================
  // SCREEN 11: ACTIVITY SUMMARY
  // ==========================================
  if (currentRoute === "activity") {
    return (
      <div className="min-h-screen bg-surface flex flex-col max-w-lg mx-auto">
        {renderTopHeader("Activity Summary", true, seniorName)}

        <main className="flex-1 flex flex-col pt-20 pb-28 px-margin">
          <div className="flex flex-col gap-space-md">
            <div>
              <h1 className="font-headline-md text-headline-md text-on-surface font-bold tracking-tight">
                Activity summary
              </h1>
              <p className="font-body-md text-sm text-on-surface-variant mt-0.5">
                A simple view of today’s recorded sensor &amp; call events.
              </p>
            </div>

            {/* Date Selector Control */}
            <div className="w-full bg-surface-container-lowest rounded-full py-2 px-3 shadow-sm border border-surface-container-high/40 flex items-center justify-between">
              <button
                aria-label="Previous day"
                onClick={() => {
                  if (activityDateIndex > 0) setActivityDateIndex(activityDateIndex - 1);
                }}
                className="w-9 h-9 flex items-center justify-center rounded-full text-on-surface-variant hover:text-primary hover:bg-surface-container-low transition-colors"
              >
                <span className="material-symbols-outlined text-[22px]">chevron_left</span>
              </button>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-primary fill-1">calendar_today</span>
                <span className="font-label-md text-sm text-on-surface font-semibold tracking-tight">
                  {activityDates[activityDateIndex]}
                </span>
              </div>
              <button
                aria-label="Next day"
                onClick={() => {
                  if (activityDateIndex < activityDates.length - 1) setActivityDateIndex(activityDateIndex + 1);
                }}
                className="w-9 h-9 flex items-center justify-center rounded-full text-on-surface-variant hover:text-primary hover:bg-surface-container-low transition-colors"
              >
                <span className="material-symbols-outlined text-[22px]">chevron_right</span>
              </button>
            </div>

            {/* Daily Overview Cards */}
            <div className="grid grid-cols-3 gap-2 w-full">
              <div className="bg-surface-container-lowest rounded-xl p-3 shadow-sm border border-surface-container-high/40 flex flex-col justify-between min-h-[110px]">
                <div className="flex items-center justify-between">
                  <div className="w-7 h-7 rounded-lg bg-surface-container-low flex items-center justify-center text-primary">
                    <span className="material-symbols-outlined text-[18px] fill-1">check_circle</span>
                  </div>
                  <span className="font-headline-md text-headline-md text-on-surface font-bold">2</span>
                </div>
                <div className="flex flex-col mt-2">
                  <span className="font-label-md text-xs text-on-surface font-semibold">Check-ins</span>
                  <span className="font-label-sm text-[10px] text-on-surface-variant">1 safe · 1 pending</span>
                </div>
              </div>

              <div className="bg-surface-container-lowest rounded-xl p-3 shadow-sm border border-surface-container-high/40 flex flex-col justify-between min-h-[110px]">
                <div className="flex items-center justify-between">
                  <div className="w-7 h-7 rounded-lg bg-surface-container-low flex items-center justify-center text-secondary">
                    <span className="material-symbols-outlined text-[18px]">motion_sensor_active</span>
                  </div>
                  <span className="font-headline-md text-headline-md text-on-surface font-bold">4</span>
                </div>
                <div className="flex flex-col mt-2">
                  <span className="font-label-md text-xs text-on-surface font-semibold">Sensor Events</span>
                  <span className="font-label-sm text-[10px] text-on-surface-variant">Living room active</span>
                </div>
              </div>

              <div className="bg-surface-container-lowest rounded-xl p-3 shadow-sm border border-surface-container-high/40 flex flex-col justify-between min-h-[110px]">
                <div className="flex items-center justify-between">
                  <div className="w-7 h-7 rounded-lg bg-tertiary-fixed/40 flex items-center justify-center text-tertiary">
                    <span className="material-symbols-outlined text-[18px] fill-1">notifications_active</span>
                  </div>
                  <span className="font-headline-md text-headline-md text-on-surface font-bold">1</span>
                </div>
                <div className="flex flex-col mt-2">
                  <span className="font-label-md text-xs text-on-surface font-semibold">Needs review</span>
                  <span className="font-label-sm text-[10px] text-tertiary font-medium">Scam screened</span>
                </div>
              </div>
            </div>

            {/* Timeline */}
            <div className="w-full bg-surface-container-lowest rounded-xl p-space-md shadow-sm border border-surface-container-high/40 flex flex-col">
              <div className="flex items-center justify-between mb-space-md">
                <span className="font-label-lg text-on-surface font-semibold text-sm">Today’s timeline</span>
                <span className="font-label-sm text-xs px-2.5 py-0.5 rounded-full bg-surface-container text-on-surface-variant font-medium">
                  4 events recorded
                </span>
              </div>

              <div className="flex flex-col relative pl-4 space-y-5">
                <div className="absolute left-2 top-2 bottom-4 w-0.5 bg-surface-container-highest" />

                <div className="relative flex items-start gap-3">
                  <div className="absolute -left-4 top-1 w-4 h-4 rounded-full bg-secondary flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-white" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-label-md text-sm font-semibold text-on-surface">11:20 AM</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-secondary-fixed text-secondary font-medium">
                        Robo-call Shield
                      </span>
                    </div>
                    <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
                      Suspected financial imposter deflected by Bedrock Agent screener.
                    </p>
                  </div>
                </div>

                <div className="relative flex items-start gap-3">
                  <div className="absolute -left-4 top-1 w-4 h-4 rounded-full bg-error flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-white" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-label-md text-sm font-semibold text-on-surface">9:15 AM</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-error-container text-error font-medium">
                        Motion Flagged
                      </span>
                    </div>
                    <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
                      Abrupt movement deceleration logged near coffee table.
                    </p>
                  </div>
                </div>

                <div className="relative flex items-start gap-3">
                  <div className="absolute -left-4 top-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-white" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-label-md text-sm font-semibold text-on-surface">8:10 AM</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-surface-container text-primary font-medium">
                        Kitchen Radar
                      </span>
                    </div>
                    <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
                      Morning breakfast routine detected in kitchen area.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <button
                onClick={() => navigate("alerts")}
                className="w-full h-12 bg-primary text-on-primary rounded-xl font-label-md font-semibold flex items-center justify-center gap-2 shadow-sm"
              >
                <span className="material-symbols-outlined text-[20px]">notifications</span>
                <span>View All Alerts</span>
              </button>
            </div>
          </div>
        </main>

        {renderBottomNav("home")}
      </div>
    );
  }

  // ==========================================
  // SCREEN 12: CARE CIRCLE
  // ==========================================
  if (currentRoute === "care-circle") {
    return (
      <div className="min-h-screen bg-surface flex flex-col max-w-lg mx-auto">
        {renderTopHeader("Care Circle", false, seniorName)}

        <main className="flex-1 flex flex-col pt-20 pb-28 px-margin">
          <div className="flex flex-col gap-space-md">
            {/* Senior Card */}
            <section className="w-full bg-surface-container-lowest rounded-xl p-space-md shadow-sm border border-surface-container-high/40 flex items-center gap-space-md">
              <div className="relative shrink-0">
                <div className="w-16 h-16 rounded-full bg-primary-fixed/40 p-1 flex items-center justify-center">
                  <img
                    className="w-full h-full rounded-full object-cover"
                    alt="Lakshmi"
                    src="/images/senior-avatar.jpg"
                  />
                </div>
                <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-surface-container-lowest flex items-center justify-center shadow-sm">
                  <span className="material-symbols-outlined text-primary text-[15px] fill-1">verified</span>
                </div>
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="font-headline-sm text-headline-sm text-on-surface font-bold truncate">{seniorName}</h2>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-surface-container text-primary-container">
                    {seniorRelation}
                  </span>
                </div>
                <span className="font-label-sm text-xs text-on-surface-variant mt-0.5">
                  Safe word: <strong className="text-primary font-mono" aria-label="hidden">••••••••</strong> (stored as a keyed hash)
                </span>
                <span className="font-label-sm text-xs text-primary mt-1 font-medium flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  Active protection loop enabled
                </span>
              </div>
            </section>

            {/* Trusted Care Circle Members */}
            <section className="flex flex-col w-full">
              <div className="flex items-center justify-between px-1 mb-2.5">
                <div className="flex items-center gap-2">
                  <h3 className="font-label-lg text-on-surface font-bold text-sm">Trusted People</h3>
                  <span className="px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant font-label-sm text-xs">
                    {contacts.length} members
                  </span>
                </div>
                <button
                  onClick={() => setShowAddContactModal(true)}
                  className="text-primary font-label-sm text-xs font-bold hover:underline flex items-center gap-0.5"
                >
                  <span className="material-symbols-outlined text-[14px]">person_add</span>
                  <span>Add Person</span>
                </button>
              </div>

              <div className="flex flex-col gap-3">
                {contacts.map((c) => (
                  <article
                    key={c.id}
                    className="w-full bg-surface-container-lowest rounded-xl p-space-md shadow-sm border border-surface-container-high/40 flex items-center justify-between hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div
                        className={`w-11 h-11 rounded-full font-headline-sm font-bold flex items-center justify-center shrink-0 shadow-sm ${
                          c.isPrimary
                            ? "bg-primary-container text-on-primary"
                            : "bg-surface-container text-primary"
                        }`}
                      >
                        {c.avatarLetter}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-body-md-medium text-on-surface font-semibold text-sm truncate">
                            {c.name}
                          </span>
                          <span className="text-on-surface-variant text-xs">· {c.relationship}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-primary font-medium">{c.role}</span>
                          <span className="text-xs text-outline">•</span>
                          <span className="text-xs text-on-surface-variant font-mono">{c.phone}</span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => showToast(`Calling ${c.name} (${c.phone})...`)}
                      className="w-9 h-9 rounded-full bg-surface-container-low flex items-center justify-center text-primary hover:bg-surface-container"
                    >
                      <span className="material-symbols-outlined text-[18px]">call</span>
                    </button>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </main>

        {/* Add Contact Modal */}
        {showAddContactModal && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-surface rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-surface-container-high">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-headline-sm font-bold text-on-surface">Add Trusted Contact</h3>
                <button onClick={() => setShowAddContactModal(false)} className="text-on-surface-variant">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold uppercase text-on-surface">Name</label>
                  <input
                    type="text"
                    value={newContactName}
                    onChange={(e) => setNewContactName(e.target.value)}
                    placeholder="e.g. Aunt Meera"
                    className="w-full h-11 px-3 mt-1 rounded-lg bg-surface-container-lowest border border-surface-container-high outline-none text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase text-on-surface">Phone</label>
                  <input
                    type="tel"
                    value={newContactPhone}
                    onChange={(e) => setNewContactPhone(e.target.value)}
                    placeholder="+1 (555) 000-0000"
                    className="w-full h-11 px-3 mt-1 rounded-lg bg-surface-container-lowest border border-surface-container-high outline-none text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase text-on-surface">Relationship</label>
                  <select
                    value={newContactRel}
                    onChange={(e) => setNewContactRel(e.target.value)}
                    className="w-full h-11 px-3 mt-1 rounded-lg bg-surface-container-lowest border border-surface-container-high outline-none text-sm"
                  >
                    <option>Family member</option>
                    <option>Neighbor</option>
                    <option>Physician</option>
                    <option>Friend</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-2 mt-5">
                <button
                  onClick={() => setShowAddContactModal(false)}
                  className="flex-1 h-11 rounded-xl bg-surface-container text-on-surface text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (newContactName.trim()) {
                      setContacts((prev) => [
                        ...prev,
                        {
                          id: `contact-${Date.now()}`,
                          name: newContactName,
                          phone: newContactPhone || "+1 (555) 000-0000",
                          role: newContactRel,
                          relationship: newContactRel,
                          isPrimary: false,
                          avatarLetter: newContactName.charAt(0).toUpperCase()
                        }
                      ]);
                      setNewContactName("");
                      setNewContactPhone("");
                      setShowAddContactModal(false);
                      showToast(`Added ${newContactName} to Care Circle!`);
                    }
                  }}
                  className="flex-1 h-11 rounded-xl bg-primary text-on-primary text-sm font-semibold"
                >
                  Save Person
                </button>
              </div>
            </div>
          </div>
        )}

        {renderBottomNav("circle")}
      </div>
    );
  }

  // ==========================================
  // SCREEN 13: SETTINGS
  // ==========================================
  if (currentRoute === "settings") {
    return (
      <div className="min-h-screen bg-surface flex flex-col max-w-lg mx-auto">
        {renderTopHeader("Settings", false, "Preferences")}

        <main className="flex-1 flex flex-col pt-20 pb-28 px-margin">
          <div className="flex flex-col gap-space-lg">
            {/* Active Profile */}
            <section className="bg-surface-container-lowest rounded-2xl shadow-sm p-space-md border border-surface-container-high/40">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-space-md min-w-0">
                  <div className="w-[52px] h-[52px] rounded-full bg-primary-container/15 flex items-center justify-center shrink-0">
                    <span className="font-headline-sm text-primary-container font-semibold">R</span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-space-xs">
                      <h2 className="font-label-lg text-on-surface font-bold truncate">Rahul Sharma</h2>
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-surface-container text-on-surface-variant">
                        Primary
                      </span>
                    </div>
                    <p className="font-label-sm text-xs text-on-surface-variant truncate mt-0.5">
                      Managing {seniorName}’s care profile · 2 Caregivers
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* Demo Controls Card */}
            <section className="w-full">
              <div className="bg-surface-container-low rounded-2xl p-space-md shadow-sm relative overflow-hidden border border-primary-container/20">
                <div className="flex flex-col space-y-space-sm relative z-10">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-space-xs">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary-container">
                        <span className="material-symbols-outlined text-[18px]">science</span>
                      </div>
                      <h3 className="font-headline-sm text-sm text-on-surface font-bold">Hackathon Demo Mode</h3>
                    </div>
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary-container text-on-primary">
                      ACTIVE
                    </span>
                  </div>
                  <p className="font-body-md text-xs text-on-surface-variant">
                    Simulate real scam calls, Bedrock Agent classification, safe-word failures, and living room falls.
                  </p>
                  <button
                    onClick={() => navigate("demo-panel")}
                    className="w-full h-12 rounded-[14px] bg-primary text-on-primary font-label-md font-semibold shadow-sm hover:bg-primary-container flex items-center justify-center gap-2 transition-transform active:scale-[0.99]"
                  >
                    <span className="material-symbols-outlined text-[20px]">smart_toy</span>
                    <span>Open Live Demo Controls</span>
                  </button>
                </div>
              </div>
            </section>

            {/* Preferences */}
            <section className="w-full space-y-space-xs">
              <h3 className="font-label-sm text-xs uppercase tracking-wider text-on-surface-variant font-semibold px-1">
                Preferences &amp; Devices
              </h3>
              <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-surface-container-high/40 overflow-hidden flex flex-col">
                <button
                  onClick={() => navigate("language")}
                  className="w-full flex items-center justify-between p-space-md text-left transition-colors hover:bg-surface-container-low min-h-[52px]"
                >
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-primary-container text-[20px]">translate</span>
                    <span className="font-label-md text-sm text-on-surface">App Language</span>
                  </div>
                  <span className="text-xs text-on-surface-variant font-medium">English / தமிழ்</span>
                </button>
                <div className="h-[1px] w-full bg-surface-container-high/40" />

                <button
                  onClick={() => navigate("care-circle")}
                  className="w-full flex items-center justify-between p-space-md text-left transition-colors hover:bg-surface-container-low min-h-[52px]"
                >
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-primary-container text-[20px]">group</span>
                    <span className="font-label-md text-sm text-on-surface">Care Circle Members</span>
                  </div>
                  <span className="material-symbols-outlined text-[20px] text-outline">chevron_right</span>
                </button>
                <div className="h-[1px] w-full bg-surface-container-high/40" />

                <button
                  onClick={() => showToast("Alexa+ MCP endpoint: http://127.0.0.1:8787/mcp (Bearer Token Active)")}
                  className="w-full flex items-center justify-between p-space-md text-left transition-colors hover:bg-surface-container-low min-h-[52px]"
                >
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-primary-container text-[20px]">link</span>
                    <div className="flex flex-col">
                      <span className="font-label-md text-sm text-on-surface">Alexa+ Streamable HTTP MCP</span>
                      <span className="text-xs text-primary font-mono">Connected · Streamable HTTP</span>
                    </div>
                  </div>
                  <span className="text-xs text-primary bg-primary-fixed/40 px-2 py-0.5 rounded-full font-semibold">
                    Online
                  </span>
                </button>
              </div>
            </section>

            <footer className="text-center pt-2">
              <span className="text-xs text-outline">AegisCare 360 • Prototype v3.4</span>
            </footer>
          </div>
        </main>

        {renderBottomNav("settings")}
      </div>
    );
  }

  // ==========================================
  // SCREEN 14: VERIFICATION PROMPT
  // ==========================================
  if (currentRoute === "verification-prompt") {
    return (
      <main className="flex-1 flex flex-col relative w-full min-h-screen bg-surface pt-safe pb-safe max-w-lg mx-auto px-margin">
        <header className="h-16 flex items-center justify-between border-b border-surface-container-high/40">
          <button onClick={goBack} className="w-10 h-10 flex items-center justify-center rounded-full text-on-surface">
            <span className="material-symbols-outlined text-[24px]">arrow_back</span>
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary-container flex items-center justify-center text-on-primary">
              <span className="material-symbols-outlined text-[18px]">health_and_safety</span>
            </div>
            <span className="font-headline-sm text-sm font-bold text-on-surface">Verification Prompt</span>
          </div>
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-tertiary-fixed text-tertiary font-semibold">
            Action Needed
          </span>
        </header>

        <div className="flex flex-col w-full pb-8 pt-4">
          <div className="w-full bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-surface-container-high/40 relative overflow-hidden mb-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="w-11 h-11 rounded-full bg-tertiary-fixed/40 flex items-center justify-center text-tertiary shrink-0">
                <span className="material-symbols-outlined text-[24px] fill-1">help</span>
              </div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-tertiary-fixed/30 text-tertiary text-xs font-bold">
                <span className="material-symbols-outlined text-[15px]">pending</span>
                <span>NEEDS VERIFICATION</span>
              </div>
            </div>

            <h2 className="font-headline-md text-headline-md text-on-surface mb-2 font-bold leading-tight">
              Can you check on {seniorName}?
            </h2>
            <p className="font-body-md text-sm text-on-surface-variant mb-4 leading-relaxed">
              A scheduled check-in or phone call safe-word challenge hasn't been confirmed. Please verify whether {seniorName} is safe.
            </p>

            <div className="flex items-center gap-2 pt-2 border-t border-surface-container-high text-xs text-on-surface-variant">
              <span className="material-symbols-outlined text-[14px]">schedule</span>
              <span>Event: Today, 9:15 AM · Alexa+ Voice Check-In</span>
            </div>
          </div>

          <div className="flex flex-col gap-3 mb-6">
            <h3 className="font-body-lg text-sm text-on-surface font-semibold px-1">What would you like to do?</h3>

            <button
              onClick={() => {
                setSelectedAlertId("alert-fall-1");
                navigate("voice-bridge");
              }}
              className="w-full text-left bg-primary-container text-on-primary-container rounded-2xl p-4 shadow-sm flex items-center justify-between gap-3 hover:brightness-105"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-xl bg-on-primary-container/15 flex items-center justify-center text-on-primary shrink-0">
                  <span className="material-symbols-outlined text-[26px]">record_voice_over</span>
                </div>
                <div className="flex flex-col">
                  <span className="font-label-lg text-sm text-on-primary font-bold">Connect Voice Bridge</span>
                  <span className="text-xs text-on-primary-container/85">Drop in directly via living room speaker</span>
                </div>
              </div>
              <span className="material-symbols-outlined text-[20px] text-on-primary">chevron_right</span>
            </button>

            <button
              onClick={() => showToast(`Calling ${seniorName} directly...`)}
              className="w-full text-left bg-surface-container-lowest text-on-surface rounded-2xl p-4 shadow-sm border border-surface-container-high/40 flex items-center justify-between gap-3 hover:bg-surface-container-low"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                  <span className="material-symbols-outlined text-[24px]">call</span>
                </div>
                <div className="flex flex-col">
                  <span className="font-label-lg text-sm text-on-surface font-semibold">Direct Phone Call</span>
                  <span className="text-xs text-on-surface-variant">Reach her mobile or landline</span>
                </div>
              </div>
              <span className="material-symbols-outlined text-[20px] text-outline">chevron_right</span>
            </button>

            <button
              onClick={() => {
                setHomeStatus("OK");
                showToast("Status marked verified: All Clear.");
                navigate("home");
              }}
              className="w-full text-left bg-surface-container-lowest text-on-surface rounded-2xl p-4 shadow-sm border border-surface-container-high/40 flex items-center justify-between gap-3 hover:bg-surface-container-low"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-xl bg-primary-fixed/40 flex items-center justify-center text-primary shrink-0">
                  <span className="material-symbols-outlined text-[24px]">task_alt</span>
                </div>
                <div className="flex flex-col">
                  <span className="font-label-lg text-sm text-on-surface font-semibold">Confirm She Is Safe</span>
                  <span className="text-xs text-on-surface-variant">Resets status to normal</span>
                </div>
              </div>
              <span className="material-symbols-outlined text-[20px] text-outline">chevron_right</span>
            </button>
          </div>

          <button
            onClick={() => navigate("home")}
            className="w-full py-2.5 text-center text-on-surface-variant font-label-md text-xs hover:text-on-surface"
          >
            Return to Dashboard
          </button>
        </div>
      </main>
    );
  }

  // ==========================================
  // SCREEN 15: EMERGENCY VOICE BRIDGE
  // ==========================================
  if (currentRoute === "voice-bridge") {
    return (
      <main className="flex-1 flex flex-col relative w-full min-h-screen bg-surface pt-safe pb-safe max-w-lg mx-auto px-margin">
        <header className="h-16 flex items-center justify-between border-b border-surface-container-high/40">
          <button onClick={goBack} className="w-10 h-10 flex items-center justify-center rounded-full text-on-surface">
            <span className="material-symbols-outlined text-[24px]">arrow_back</span>
          </button>
          <div className="flex items-center gap-2">
            <span className="font-headline-sm text-sm font-bold text-on-surface">Voice Bridge Terminal</span>
          </div>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-secondary-fixed text-on-secondary-fixed-variant text-xs font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
            {bridgeConnected ? `CONNECTED (${formatTimer(bridgeTimer)})` : "READY"}
          </span>
        </header>

        <div className="flex flex-col w-full pb-8 pt-4 space-y-space-md">
          {/* Incident Context */}
          <div className="bg-error-container/40 rounded-xl p-space-md shadow-sm border border-error/20 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-error uppercase tracking-wider flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-error animate-pulse" />
                Urgent Voice Link · {seniorName}’s Living Room
              </span>
              <span className="text-xs text-on-surface-variant">Room 102</span>
            </div>
            <h2 className="font-headline-sm text-sm font-bold text-on-surface">
              {currentAlert.title}
            </h2>
            <p className="text-xs text-on-surface-variant leading-snug">
              Direct acoustic channel opened with smart speaker terminal to verify senior response.
            </p>
          </div>

          {/* Centered Graphic Audio Waves */}
          <div className="bg-surface-container-lowest rounded-xl p-6 flex flex-col items-center justify-center relative overflow-hidden shadow-sm border border-surface-container-high/40">
            <div className="relative w-44 h-44 flex items-center justify-center my-2">
              {bridgeConnected && (
                <div className="absolute inset-0 rounded-full bg-primary/10 animate-voice-ripple" />
              )}
              <svg className="absolute inset-0 w-full h-full text-primary-fixed" fill="none" viewBox="0 0 176 176">
                <circle cx="88" cy="88" r="82" stroke="currentColor" strokeDasharray="4 4" strokeWidth="1.5" />
                <circle cx="88" cy="88" r="64" stroke="currentColor" strokeWidth="2" />
                <circle cx="88" cy="88" r="48" stroke="currentColor" strokeWidth="1.5" />
              </svg>

              <div className="relative w-24 h-24 rounded-full bg-surface-container flex items-center justify-center shadow-md">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary-fixed to-primary-container/40 flex items-center justify-center text-primary font-headline-md font-bold text-2xl">
                  {seniorName.charAt(0)}
                </div>
                <div className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-sm">
                  <span className="material-symbols-outlined text-[16px] fill-1">shield_with_heart</span>
                </div>
                <div className="absolute -bottom-1 -left-1 w-7 h-7 rounded-full bg-surface-container-high text-outline flex items-center justify-center shadow-sm">
                  <span className="material-symbols-outlined text-[16px]">
                    {bridgeMuted ? "mic_off" : "mic"}
                  </span>
                </div>
              </div>
            </div>

            {/* Audio Wave Visualizer Bars */}
            {bridgeConnected && (
              <div className="flex items-center gap-1.5 h-10 my-2">
                {[12, 24, 36, 18, 30, 14, 28, 38, 20, 16].map((h, i) => (
                  <div
                    key={i}
                    className="w-1 bg-primary rounded-full transition-all duration-300"
                    style={{
                      height: `${h}px`,
                      animation: `wave-pulse 1.2s ease-in-out infinite ${i * 0.1}s`
                    }}
                  />
                ))}
              </div>
            )}

            <div className="flex flex-col items-center text-center mt-2 space-y-1">
              <span className="text-xs font-semibold text-primary px-3 py-1 rounded-full bg-surface-container-low">
                {bridgeConnected ? "Assistive Speaker Bridge Live" : "Ready to Bridge Call"}
              </span>
              <p className="text-xs text-outline max-w-[260px]">
                {bridgeConnected
                  ? `Active two-way acoustic channel (${formatTimer(bridgeTimer)})`
                  : "Click below to open two-way speaker connection into the room."}
              </p>
            </div>
          </div>

          {/* Live Transcript Stream */}
          <div className="bg-surface-container-lowest rounded-xl p-4 shadow-sm border border-surface-container-high/40">
            <div className="flex items-center justify-between mb-2 pb-1 border-b border-surface-container-high">
              <span className="text-xs font-bold text-on-surface flex items-center gap-1">
                <span className="material-symbols-outlined text-[15px] text-primary">record_voice_over</span>
                Live Speech Stream
              </span>
              <span className="text-[11px] text-outline font-mono">Alexa+ Streamable HTTP</span>
            </div>
            <div className="space-y-2 text-xs">
              <p className="text-primary font-medium">
                <strong>Caregiver (Rahul):</strong> "Mom, are you okay? It's Rahul, I received an alert."
              </p>
              <p className="text-on-surface font-medium">
                <strong>{seniorName}:</strong> "Rahul, I tripped near the nightstand... I can't reach my walker."
              </p>
              <p className="text-on-surface-variant italic">
                <strong>Alexa+:</strong> "[Assisting voice bridge · Family alerted · Emergency keyholders notified]"
              </p>
            </div>
          </div>

          {/* Voice Bridge Controls */}
          <div className="grid grid-cols-3 gap-2 pt-2">
            <button
              onClick={() => {
                setBridgeMuted(!bridgeMuted);
                showToast(bridgeMuted ? "Microphone unmuted" : "Microphone muted");
              }}
              className={`h-12 rounded-xl flex items-center justify-center gap-1.5 text-xs font-semibold shadow-sm transition-colors ${
                bridgeMuted ? "bg-error text-white" : "bg-surface-container text-on-surface"
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">
                {bridgeMuted ? "mic_off" : "mic"}
              </span>
              <span>{bridgeMuted ? "Unmute" : "Mute"}</span>
            </button>

            <button
              onClick={() => {
                setBridgeSpeaker(!bridgeSpeaker);
                showToast(bridgeSpeaker ? "Speaker volume low" : "Speaker amplified");
              }}
              className={`h-12 rounded-xl flex items-center justify-center gap-1.5 text-xs font-semibold shadow-sm transition-colors ${
                bridgeSpeaker ? "bg-surface-container text-on-surface" : "bg-surface-container-high text-outline"
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">
                {bridgeSpeaker ? "volume_up" : "volume_off"}
              </span>
              <span>Speaker</span>
            </button>

            <button
              onClick={() => {
                if (!bridgeConnected) {
                  setBridgeConnected(true);
                  showToast("Voice bridge connected to living room terminal!");
                } else {
                  setBridgeConnected(false);
                  showToast("Voice bridge terminated.");
                }
              }}
              className={`h-12 rounded-xl flex items-center justify-center gap-1.5 text-xs font-semibold shadow-sm transition-colors text-white ${
                bridgeConnected ? "bg-error" : "bg-primary"
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">
                {bridgeConnected ? "call_end" : "phone_in_talk"}
              </span>
              <span>{bridgeConnected ? "End Call" : "Connect"}</span>
            </button>
          </div>

          <button
            onClick={() => navigate("home")}
            className="w-full py-2 text-center text-xs text-on-surface-variant hover:text-on-surface"
          >
            Return to Dashboard
          </button>
        </div>
      </main>
    );
  }

  // ==========================================
  // SCREEN 16: HIDDEN DEMO PANEL
  // ==========================================
  if (currentRoute === "demo-panel") {
    return (
      <main className="flex-1 flex flex-col relative w-full min-h-screen bg-background pt-safe pb-safe max-w-lg mx-auto px-margin">
        <header className="h-16 flex items-center justify-between border-b border-surface-container-high/40">
          <div className="flex items-center gap-space-sm">
            <button onClick={goBack} className="w-10 h-10 flex items-center justify-center rounded-full text-on-surface">
              <span className="material-symbols-outlined text-[24px]">arrow_back</span>
            </button>
            <h1 className="font-headline-sm text-headline-sm text-on-surface font-bold">Demo Controls</h1>
          </div>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-tertiary-fixed text-on-tertiary-fixed font-label-sm text-xs font-bold uppercase tracking-wider">
            <span className="material-symbols-outlined text-[14px]">science</span>
            DEMO MODE
          </span>
        </header>

        <div className="flex flex-col w-full pb-8 pt-4 space-y-space-md">
          {/* Current State Display */}
          <section className="bg-surface-container-lowest rounded-xl p-5 shadow-sm border border-surface-container-high/40">
            <div className="flex items-center justify-between mb-3">
              <span className="font-label-sm text-xs uppercase tracking-wider text-on-surface-variant font-semibold">
                Active Scenario State
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-surface-container text-xs text-primary font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                Live Sync
              </span>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-surface-container-low mb-3">
              <div className="flex items-center gap-space-sm">
                <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-primary text-[22px] fill-1">elderly</span>
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="font-headline-sm text-sm text-on-surface font-semibold truncate">
                    {seniorName} · {seniorRelation}
                  </span>
                  <span className="text-xs text-on-surface-variant">Safe word set (hidden)</span>
                </div>
              </div>
              <span className="material-symbols-outlined text-outline text-[18px]">verified_user</span>
            </div>

            <div
              className={`flex items-start gap-3 p-4 rounded-xl ${
                homeStatus === "EMERGENCY"
                  ? "bg-error-container text-error"
                  : homeStatus === "NEEDS_VERIFICATION"
                  ? "bg-tertiary-fixed/50 text-tertiary"
                  : homeStatus === "UNKNOWN"
                  ? "bg-surface-container-high text-on-surface-variant"
                  : "bg-surface-container-low text-primary"
              }`}
            >
              <div className="w-10 h-10 rounded-full bg-surface-container-lowest flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[24px] fill-1">
                  {homeStatus === "EMERGENCY"
                    ? "warning"
                    : homeStatus === "NEEDS_VERIFICATION"
                    ? "priority_high"
                    : homeStatus === "UNKNOWN"
                    ? "cloud_off"
                    : "check_circle"}
                </span>
              </div>
              <div className="flex flex-col min-w-0">
                <span className="font-bold text-sm tracking-tight">Current Status: {homeStatus}</span>
                <span className="text-xs mt-0.5 text-on-surface">
                  {homeStatus === "EMERGENCY"
                    ? "Critical fall event active. Voice bridge alert dispatched."
                    : homeStatus === "NEEDS_VERIFICATION"
                    ? "Safe-word challenged by Alexa+. Caregiver intervention requested."
                    : homeStatus === "UNKNOWN"
                    ? "Home hub offline. Periodic ping running."
                    : "Senior is calm, safe, and restful."}
                </span>
              </div>
            </div>
          </section>

          {/* Trigger Simulations */}
          <section className="flex flex-col gap-3">
            <h2 className="font-headline-sm text-sm font-bold text-on-surface px-1">
              Trigger a Simulated Care Event
            </h2>

            {/* Button 1: Fall */}
            <div className="bg-surface-container-lowest rounded-xl p-4 shadow-sm border border-surface-container-high/40 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-error-container flex items-center justify-center text-error shrink-0">
                  <span className="material-symbols-outlined text-[20px] fill-1">personal_injury</span>
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="font-bold text-sm text-on-surface">Simulate Possible Fall</span>
                  <span className="text-xs text-on-surface-variant">Triggers Critical Emergency status &amp; Voice Bridge</span>
                </div>
              </div>
              <button
                onClick={() => triggerSimulation("fall")}
                className="px-3.5 py-2 rounded-xl bg-error text-white font-label-md text-xs font-semibold shrink-0"
              >
                Trigger
              </button>
            </div>

            {/* Button 2: Scam Call */}
            <div className="bg-surface-container-lowest rounded-xl p-4 shadow-sm border border-surface-container-high/40 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-tertiary-fixed flex items-center justify-center text-tertiary shrink-0">
                  <span className="material-symbols-outlined text-[20px]">phone_disabled</span>
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="font-bold text-sm text-on-surface">Simulate AI Scam Call</span>
                  <span className="text-xs text-on-surface-variant">Bedrock Threat Agent scores call 0.88, prompts safe word</span>
                </div>
              </div>
              <button
                onClick={() => triggerSimulation("scam")}
                className="px-3.5 py-2 rounded-xl bg-tertiary-container text-white font-label-md text-xs font-semibold shrink-0"
              >
                Trigger
              </button>
            </div>

            {/* Button 3: Missed Check-in */}
            <div className="bg-surface-container-lowest rounded-xl p-4 shadow-sm border border-surface-container-high/40 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center text-primary shrink-0">
                  <span className="material-symbols-outlined text-[20px]">schedule</span>
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="font-bold text-sm text-on-surface">Simulate Missed Check-in</span>
                  <span className="text-xs text-on-surface-variant">8:00 AM wellness check-in unacknowledged</span>
                </div>
              </div>
              <button
                onClick={() => triggerSimulation("checkin")}
                className="px-3.5 py-2 rounded-xl bg-primary text-white font-label-md text-xs font-semibold shrink-0"
              >
                Trigger
              </button>
            </div>

            {/* Button 4: Hub Disconnect */}
            <div className="bg-surface-container-lowest rounded-xl p-4 shadow-sm border border-surface-container-high/40 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center text-outline shrink-0">
                  <span className="material-symbols-outlined text-[20px]">cloud_off</span>
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="font-bold text-sm text-on-surface">Simulate Hub Disconnected</span>
                  <span className="text-xs text-on-surface-variant">Wi-Fi offline diagnostic workflow</span>
                </div>
              </div>
              <button
                onClick={() => triggerSimulation("unknown")}
                className="px-3.5 py-2 rounded-xl bg-outline text-white font-label-md text-xs font-semibold shrink-0"
              >
                Trigger
              </button>
            </div>

            {/* Button 5: Reset All Clear */}
            <button
              onClick={() => triggerSimulation("reset")}
              className="w-full h-12 rounded-xl bg-primary-container text-on-primary font-label-md text-sm font-semibold flex items-center justify-center gap-2 shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px]">check</span>
              <span>Reset State to OK (All Clear)</span>
            </button>
          </section>

          {/* Direct Route Jump Navigation */}
          <section className="bg-surface-container-lowest rounded-xl p-4 shadow-sm border border-surface-container-high/40">
            <span className="font-label-sm text-xs uppercase tracking-wider text-on-surface-variant font-semibold block mb-3">
              Jump to Any Screen Directly
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { r: "welcome", label: "Welcome Screen" },
                { r: "language", label: "Language Selection" },
                { r: "what-we-do", label: "What We Do" },
                { r: "create-account", label: "Create Account" },
                { r: "sign-in", label: "Sign In" },
                { r: "care-profile-setup", label: "Care Profile" },
                { r: "trusted-contact", label: "Trusted Contact" },
                { r: "home", label: "Home Dashboard" },
                { r: "alerts", label: "Alerts Feed" },
                { r: "alert-details", label: "Alert Details" },
                { r: "activity", label: "Activity Summary" },
                { r: "care-circle", label: "Care Circle" },
                { r: "settings", label: "Settings" },
                { r: "verification-prompt", label: "Verification Prompt" },
                { r: "voice-bridge", label: "Emergency Voice Bridge" }
              ].map((item) => (
                <button
                  key={item.r}
                  onClick={() => navigate(item.r as AppRoute)}
                  className="p-2 rounded-lg bg-surface-container-low hover:bg-surface-container text-left text-on-surface truncate font-medium"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>
        </div>
      </main>
    );
  }

  // Fallback return (should never be hit)
  return <div>Loading AegisCare 360...</div>;
}

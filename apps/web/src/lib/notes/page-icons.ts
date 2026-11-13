import {
  Activity, AlarmClock, Archive, Atom, Award, Baby, BadgeCheck, Banknote, BarChart3, Bike, Book, BookMarked, BookOpen, Bookmark,
  Brain, Briefcase, Bug, Building2, Cake, Calculator, Calendar, Camera, Car, ChefHat, CircleCheck, Clapperboard, Clipboard,
  Clock, Cloud, Code, Coffee, Cog, Compass, Cpu, CreditCard, Crown, Database, Dumbbell, Feather, FileText, Film, Flag, Flame,
  FlaskConical, Flower2, Folder, Gamepad2, Gift, GitBranch, Globe, GraduationCap, Hammer, Handshake, Headphones, Heart,
  HeartPulse, Home, Hourglass, Image, Inbox, Key, Landmark, Languages, Laptop, Layers, Leaf, Lightbulb, Link, List, ListChecks,
  Lock, Mail, Map, MapPin, Megaphone, MessageCircle, Mic, Moon, Mountain, Music, Newspaper, NotebookPen, Package, Palette,
  PawPrint, PenTool, Pencil, Phone, PiggyBank, Pizza, Plane, Podcast, Puzzle, Quote, Receipt, Rocket, Scale, School, Search,
  Settings, Shield, ShoppingCart, Smile, Sparkles, Sprout, Star, Stethoscope, Sun, Target, Tent, Terminal, ThumbsUp, Ticket,
  Timer, Train, TreePine, Trophy, Truck, Tv, Umbrella, User, Users, Utensils, Wallet, Wand2, Waves, Wrench, Zap,
  type LucideIcon,
} from "lucide-react";

/*
 * W4 (feedback round 3): page icons are monochrome Lucide line icons in the style of the app icons, never emojis.
 * The value stored in knowledge_items.icon (and the YAML frontmatter `icon`) is the Lucide name in kebab case.
 * A curated set with German search words keeps the bundle small; names outside the set fall back to the type glyph.
 */

export interface PageIcon {
  name: string;
  Icon: LucideIcon;
  /** German (and English) search words. */
  words: string;
}

const I = (name: string, Icon: LucideIcon, words: string): PageIcon => ({ name, Icon, words });

export const PAGE_ICONS: readonly PageIcon[] = [
  I("notebook-pen", NotebookPen, "notiz notizbuch schreiben note"),
  I("file-text", FileText, "datei dokument text file"),
  I("book-open", BookOpen, "buch lesen book"),
  I("book", Book, "buch book"),
  I("book-marked", BookMarked, "buch lesezeichen book"),
  I("bookmark", Bookmark, "lesezeichen merken"),
  I("lightbulb", Lightbulb, "idee einfall glühbirne idea"),
  I("brain", Brain, "gehirn denken wissen brain"),
  I("sparkles", Sparkles, "ki ai magie funkeln"),
  I("star", Star, "stern favorit"),
  I("heart", Heart, "herz liebe"),
  I("smile", Smile, "lächeln gesicht"),
  I("target", Target, "ziel fokus goal"),
  I("flag", Flag, "flagge meilenstein"),
  I("rocket", Rocket, "rakete start projekt launch"),
  I("trophy", Trophy, "pokal erfolg sieg"),
  I("award", Award, "auszeichnung preis"),
  I("crown", Crown, "krone"),
  I("badge-check", BadgeCheck, "geprüft verifiziert"),
  I("circle-check", CircleCheck, "erledigt fertig check"),
  I("list-checks", ListChecks, "aufgaben todo checkliste"),
  I("list", List, "liste"),
  I("clipboard", Clipboard, "zwischenablage protokoll"),
  I("calendar", Calendar, "kalender termin datum"),
  I("clock", Clock, "uhr zeit"),
  I("alarm-clock", AlarmClock, "wecker erinnerung"),
  I("timer", Timer, "timer stoppuhr"),
  I("hourglass", Hourglass, "sanduhr warten"),
  I("briefcase", Briefcase, "arbeit job koffer business"),
  I("building-2", Building2, "firma gebäude unternehmen büro"),
  I("landmark", Landmark, "bank behörde institution"),
  I("handshake", Handshake, "partner deal vertrag"),
  I("users", Users, "team gruppe personen leute"),
  I("user", User, "person kontakt profil"),
  I("baby", Baby, "baby kind familie"),
  I("message-circle", MessageCircle, "nachricht chat gespräch"),
  I("mail", Mail, "mail e-mail brief"),
  I("phone", Phone, "telefon anruf"),
  I("mic", Mic, "mikrofon meeting aufnahme"),
  I("megaphone", Megaphone, "ankündigung marketing"),
  I("newspaper", Newspaper, "zeitung artikel news"),
  I("quote", Quote, "zitat"),
  I("languages", Languages, "sprache übersetzung"),
  I("graduation-cap", GraduationCap, "lernen studium uni kurs"),
  I("school", School, "schule"),
  I("pencil", Pencil, "stift bearbeiten"),
  I("pen-tool", PenTool, "design zeichnen"),
  I("palette", Palette, "farben kunst design"),
  I("feather", Feather, "feder schreiben"),
  I("image", Image, "bild foto"),
  I("camera", Camera, "kamera foto"),
  I("film", Film, "film kino"),
  I("clapperboard", Clapperboard, "film video dreh"),
  I("tv", Tv, "fernsehen serie"),
  I("music", Music, "musik lied"),
  I("headphones", Headphones, "kopfhörer hören audio"),
  I("podcast", Podcast, "podcast audio"),
  I("gamepad-2", Gamepad2, "spiel gaming"),
  I("puzzle", Puzzle, "puzzle rätsel"),
  I("code", Code, "code programmieren entwicklung"),
  I("terminal", Terminal, "terminal konsole"),
  I("git-branch", GitBranch, "git branch version"),
  I("bug", Bug, "fehler bug"),
  I("cpu", Cpu, "prozessor technik hardware"),
  I("laptop", Laptop, "laptop computer"),
  I("database", Database, "datenbank daten"),
  I("cloud", Cloud, "cloud wolke"),
  I("layers", Layers, "ebenen stapel"),
  I("package", Package, "paket lieferung"),
  I("link", Link, "link verknüpfung"),
  I("search", Search, "suche recherche"),
  I("key", Key, "schlüssel zugang"),
  I("lock", Lock, "schloss sicher privat"),
  I("shield", Shield, "schutz sicherheit"),
  I("settings", Settings, "einstellungen"),
  I("cog", Cog, "zahnrad system"),
  I("wrench", Wrench, "werkzeug reparatur tool"),
  I("hammer", Hammer, "hammer bauen"),
  I("wand-2", Wand2, "zauberstab automatik"),
  I("zap", Zap, "blitz energie schnell"),
  I("flame", Flame, "feuer streak heiß"),
  I("activity", Activity, "aktivität puls"),
  I("bar-chart-3", BarChart3, "diagramm statistik auswertung"),
  I("calculator", Calculator, "rechner rechnen"),
  I("scale", Scale, "waage recht balance"),
  I("wallet", Wallet, "geldbörse finanzen"),
  I("banknote", Banknote, "geld geldschein"),
  I("piggy-bank", PiggyBank, "sparen sparschwein"),
  I("credit-card", CreditCard, "kreditkarte bezahlen"),
  I("receipt", Receipt, "beleg quittung rechnung"),
  I("shopping-cart", ShoppingCart, "einkauf warenkorb"),
  I("gift", Gift, "geschenk"),
  I("ticket", Ticket, "ticket karte event"),
  I("heart-pulse", HeartPulse, "gesundheit puls health"),
  I("stethoscope", Stethoscope, "arzt medizin"),
  I("dumbbell", Dumbbell, "sport training fitness"),
  I("bike", Bike, "fahrrad rad"),
  I("mountain", Mountain, "berg wandern"),
  I("tent", Tent, "zelt camping"),
  I("tree-pine", TreePine, "baum wald natur"),
  I("leaf", Leaf, "blatt natur"),
  I("sprout", Sprout, "wachstum pflanze"),
  I("flower-2", Flower2, "blume garten"),
  I("paw-print", PawPrint, "tier haustier hund katze"),
  I("sun", Sun, "sonne tag"),
  I("moon", Moon, "mond nacht"),
  I("umbrella", Umbrella, "schirm regen"),
  I("waves", Waves, "wellen meer wasser"),
  I("globe", Globe, "welt web global"),
  I("compass", Compass, "kompass richtung"),
  I("map", Map, "karte reise"),
  I("map-pin", MapPin, "ort standort"),
  I("plane", Plane, "flug reise urlaub"),
  I("train", Train, "zug bahn"),
  I("car", Car, "auto"),
  I("truck", Truck, "lkw transport"),
  I("home", Home, "zuhause haus"),
  I("chef-hat", ChefHat, "kochen rezept küche"),
  I("utensils", Utensils, "essen besteck rezept"),
  I("pizza", Pizza, "pizza essen"),
  I("coffee", Coffee, "kaffee pause"),
  I("cake", Cake, "kuchen geburtstag"),
  I("flask-conical", FlaskConical, "labor experiment wissenschaft"),
  I("atom", Atom, "atom physik"),
  I("folder", Folder, "ordner"),
  I("archive", Archive, "archiv"),
  I("inbox", Inbox, "eingang inbox"),
  I("thumbs-up", ThumbsUp, "gut daumen"),
];

const BY_NAME = new globalThis.Map(PAGE_ICONS.map((p) => [p.name, p] as const));

/** The icon of a stored name, or null for an unknown / empty name. */
export function pageIcon(name: string | null | undefined): PageIcon | null {
  return name ? (BY_NAME.get(name) ?? null) : null;
}

/** Icons whose name or search words contain every word of the query (case-insensitive). */
export function searchPageIcons(query: string, icons: readonly PageIcon[] = PAGE_ICONS): PageIcon[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...icons];
  return icons.filter((p) => {
    const hay = `${p.name} ${p.words}`;
    return words.every((w) => hay.includes(w));
  });
}

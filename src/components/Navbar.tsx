"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  Database,
  FileCheck2,
  HeartPulse,
  IdCard,
  LayoutDashboard,
  Menu,
  Radio,
  ShieldCheck,
  Stethoscope,
  UserCheck,
  WifiOff,
  X,
} from "lucide-react";
import type { StaffRole, StaffUser } from "@/lib/types";

export interface StaffDemoAccount {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  roleLabel: string;
  shortLabel: string;
  description: string;
  badgeClass: string;
}

export const STAFF_DEMO_ACCOUNTS: StaffDemoAccount[] = [
  {
    id: "lab-1",
    name: "QFB Sofía Méndez",
    email: "sofia.lab@eira.org",
    role: "laboratorio",
    roleLabel: "Laboratorio",
    shortLabel: "QFB Sofía Méndez · Laboratorio",
    description: "Carga de PDF escaneado y asociación verificada",
    badgeClass: "bg-sky-50 text-sky-800 border-sky-200",
  },
  {
    id: "eira-1",
    name: "Lic. Mariana López",
    email: "mariana.admin@eira.org",
    role: "eira_admin",
    roleLabel: "EIRA Admin",
    shortLabel: "Lic. Mariana López · EIRA Admin",
    description: "Cotejo anti-homónimos y Compuerta 1 (Admin)",
    badgeClass: "bg-eira-50 text-eira-700 border-eira-200",
  },
  {
    id: "med-1",
    name: "Dra. Elena Ramírez",
    email: "elena.medica@eira.org",
    role: "medico",
    roleLabel: "Médica",
    shortLabel: "Dra. Elena Ramírez · Médica",
    description: "Compuerta 2: Autorización clínica y modalidad",
    badgeClass: "bg-emerald-50 text-emerald-800 border-emerald-200",
  },
  {
    id: "prom-1",
    name: "Rosa Hernández",
    email: "rosa.promotora@eira.org",
    role: "promotora_kiosco",
    roleLabel: "Promotora Kiosco",
    shortLabel: "Rosa Hernández · Promotora Kiosco",
    description: "Entrega asistida en Kiosco RPi y brigadas LoRa",
    badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
  },
];

export const ROLE_BADGE_MAP: Record<StaffRole, { label: string; className: string }> = {
  laboratorio: {
    label: "Laboratorio",
    className: "bg-sky-100 text-sky-800 border-sky-200",
  },
  eira_admin: {
    label: "EIRA Admin",
    className: "bg-eira-100 text-eira-700 border-eira-200",
  },
  medico: {
    label: "Médica",
    className: "bg-emerald-100 text-emerald-800 border-emerald-200",
  },
  promotora_kiosco: {
    label: "Promotora Kiosco",
    className: "bg-amber-100 text-amber-800 border-amber-200",
  },
};

interface ValkeyInfo {
  mode: "valkey" | "sqlite_ttl_fallback" | string;
  url_configured?: boolean;
}

interface SessionPayload {
  staff?: StaffUser | null;
  staffUser?: StaffUser | null;
  user?: StaffUser | null;
  valkey?: ValkeyInfo | null;
  valkeyInfo?: ValkeyInfo | null;
}

interface NavbarProps {
  onStaffChange?: (staff: StaffUser | null) => void;
}

const NAV_ITEMS = [
  { href: "/", label: "Panel General", icon: LayoutDashboard },
  { href: "/registro", label: "Registro y Expediente", icon: IdCard },
  { href: "/eira", label: "Carga y Revisión EIRA", icon: FileCheck2 },
  { href: "/medico", label: "Autorización Clínica", icon: Stethoscope },
  { href: "/paciente", label: "Portal Paciente", icon: UserCheck },
  { href: "/kiosco", label: "Kiosco RPi Offline", icon: WifiOff },
  { href: "/alertas-loop", label: "Loop Insistente / LoRa", icon: Radio },
] as const;

export function parseStaffFromSession(data: SessionPayload | null | undefined): StaffUser | null {
  if (!data) return null;
  if (data.staff && data.staff.role) return data.staff;
  if (data.staffUser && data.staffUser.role) return data.staffUser;
  if (data.user && data.user.role) return data.user;
  return null;
}

export async function loginStaffDemoAccount(account: StaffDemoAccount): Promise<StaffUser | null> {
  const res = await fetch("/api/auth/staff-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: account.id,
      user_id: account.id,
      role: account.role,
      email: account.email,
    }),
  });

  const payload = (await res.json().catch(() => ({}))) as SessionPayload & { error?: string };
  if (!res.ok) {
    throw new Error(payload.error || "No se pudo cambiar la sesión del personal.");
  }

  const staff =
    parseStaffFromSession(payload) ??
    ({
      id: account.id,
      name: account.name,
      email: account.email,
      role: account.role,
      license_number: account.role === "medico" ? "CED-8472910" : null,
      community: account.role === "promotora_kiosco" ? "Sierra Norte" : null,
    } satisfies StaffUser);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("eira-session-updated", { detail: { staff } }));
  }

  return staff;
}

export default function Navbar({ onStaffChange }: NavbarProps) {
  const pathname = usePathname();
  const [staff, setStaff] = useState<StaffUser | null>(null);
  const [valkeyInfo, setValkeyInfo] = useState<ValkeyInfo | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as SessionPayload;
      let currentStaff = parseStaffFromSession(data);

      // For smooth demo UX on staff pages, auto-initialize default demo staff session once
      // unless user explicitly logged out or is on the unauthenticated Patient Portal.
      const optedOut =
        typeof window !== "undefined" &&
        window.sessionStorage.getItem("eira_staff_logged_out") === "1";
      const isPatientPage = pathname?.startsWith("/paciente");

      if (!currentStaff && !optedOut && !isPatientPage) {
        const defaultAccount =
          pathname?.startsWith("/medico")
            ? STAFF_DEMO_ACCOUNTS.find((a) => a.role === "medico")
            : pathname?.startsWith("/kiosco") || pathname?.startsWith("/registro")
            ? STAFF_DEMO_ACCOUNTS.find((a) => a.role === "promotora_kiosco")
            : STAFF_DEMO_ACCOUNTS.find((a) => a.role === "eira_admin");
        if (defaultAccount) {
          try {
            currentStaff = await loginStaffDemoAccount(defaultAccount);
          } catch {
            // Keep null if auto-login fails
          }
        }
      }

      setStaff(currentStaff);
      setValkeyInfo(data.valkey ?? data.valkeyInfo ?? null);
      onStaffChange?.(currentStaff);
    } catch {
      // Keep graceful UI if API is temporarily unavailable
    } finally {
      setLoadingSession(false);
    }
  }, [onStaffChange, pathname]);

  useEffect(() => {
    void fetchSession();
  }, [fetchSession]);

  useEffect(() => {
    const handleSessionEvent = (event: Event) => {
      const custom = event as CustomEvent<{ staff?: StaffUser | null }>;
      if (custom.detail && "staff" in custom.detail) {
        const updated = custom.detail.staff ?? null;
        setStaff(updated);
        onStaffChange?.(updated);
      } else {
        void fetchSession();
      }
    };

    window.addEventListener("eira-session-updated", handleSessionEvent);
    return () => window.removeEventListener("eira-session-updated", handleSessionEvent);
  }, [fetchSession, onStaffChange]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDropdownOpen(false);
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const handleSelectRole = async (account: StaffDemoAccount) => {
    setSwitchingId(account.id);
    setSwitchError(null);
    try {
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem("eira_staff_logged_out");
      }
      const nextStaff = await loginStaffDemoAccount(account);
      setStaff(nextStaff);
      onStaffChange?.(nextStaff);
      setDropdownOpen(false);
    } catch (err) {
      setSwitchError(err instanceof Error ? err.message : "Error al cambiar rol");
    } finally {
      setSwitchingId(null);
    }
  };

  const handleLogoutStaff = async () => {
    setSwitchingId("logout");
    setSwitchError(null);
    try {
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem("eira_staff_logged_out", "1");
      }
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "staff" }),
      });
      setStaff(null);
      onStaffChange?.(null);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("eira-session-updated", { detail: { staff: null } }));
      }
      setDropdownOpen(false);
    } catch {
      setSwitchError("No se pudo cerrar la sesión.");
    } finally {
      setSwitchingId(null);
    }
  };

  const activeRoleMeta = staff ? ROLE_BADGE_MAP[staff.role] : null;
  const isValkeyDirect = valkeyInfo?.mode === "valkey";

  return (
    <header className="sticky top-0 z-40 border-b border-padi-line bg-white/85 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex min-h-[64px] items-center justify-between gap-3 py-2">
          {/* Brand */}
          <Link href="/" className="flex min-w-0 items-center gap-2 sm:gap-3 group">
            <svg
              viewBox="0 0 150 50"
              role="img"
              aria-label="EIRA"
              className="h-[26px] w-[78px] sm:h-[31px] sm:w-[92px] shrink-0 text-padi-pink"
            >
              <text x="0" y="40" fontFamily="Poppins,sans-serif" fontWeight="300" fontSize="44" letterSpacing="5" fill="currentColor">EIR</text>
              <path d="M111 44L129 8L147 44" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M122 38q7-8 14 0q-7 8-14 0z" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
            </svg>
            <span aria-hidden="true" className="h-7 w-px bg-padi-pale" />
            <span className="text-xl font-extrabold tracking-tight text-padi-berry">PaDi</span>
            <div className="hidden min-w-0 leading-tight sm:block">
              <div className="flex items-center gap-2">
                <span className="truncate text-xs sm:text-sm font-bold tracking-tight text-padi-plum">
                  <span className="sm:hidden">EIRA Seguro</span>
                  <span className="hidden sm:inline">EIRA Resultados Seguros</span>
                </span>
                <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-padi-blush px-2.5 py-0.5 text-[11px] font-bold text-padi-berry border border-padi-pale">
                  <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                  Cero WhatsApp
                </span>
              </div>
              <p className="hidden sm:block text-[11px] text-slate-500 font-medium">
                EIRA Movimiento Rosa A.C. · Custodia Clínica
              </p>
            </div>
          </Link>

          {/* Right Controls: Valkey TTL Store pill + Role Switcher + Mobile Toggle */}
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {/* Valkey / TTL Store status pill */}
            <div
              title={
                isValkeyDirect
                  ? "Valkey (Redis protocol) conectado para OTP y rate-limiting"
                  : "TTL Store compatible con Valkey (respaldo SQLite local con expiración)"
              }
              className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-padi-pale bg-padi-blush px-3 py-1.5 text-xs font-semibold text-padi-berry"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  isValkeyDirect ? "bg-emerald-500" : "bg-teal-500"
                }`}
              />
              <Database className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
              <span>Valkey / TTL Store</span>
            </div>

            {/* Embedded Role Switcher */}
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setDropdownOpen((prev) => !prev)}
                aria-expanded={dropdownOpen}
                aria-haspopup="listbox"
                aria-label={
                  staff
                    ? `Sesión: ${staff.name} (${activeRoleMeta?.label ?? staff.role}). Cambiar rol`
                    : "Sin sesión. Seleccionar rol demo"
                }
                className="inline-flex min-h-[44px] items-center gap-2 rounded-full border-2 border-padi-berry bg-padi-blush px-3 sm:px-4 py-1.5 text-left text-xs sm:text-sm font-semibold text-padi-berry transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-padi-berry/30"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
                  <span className="hidden sm:block font-bold text-padi-berry max-w-[180px] truncate">
                    {loadingSession
                      ? "Verificando sesión..."
                      : staff
                      ? staff.name
                      : "Seleccionar rol demo"}
                  </span>
                  {activeRoleMeta ? (
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${activeRoleMeta.className}`}
                    >
                      {activeRoleMeta.label}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                      Sin sesión
                    </span>
                  )}
                </div>
                <ChevronDown
                  className={`h-4 w-4 text-slate-500 transition-transform ${
                    dropdownOpen ? "rotate-180" : ""
                  }`}
                  aria-hidden="true"
                />
              </button>

              {dropdownOpen && (
                <div
                  role="listbox"
                  aria-label="Cambiar cuenta demo de personal"
                  className="absolute right-0 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-3xl border border-padi-line bg-white p-2.5 shadow-lg z-50"
                >
                  <div className="px-2.5 py-2 border-b border-slate-100 mb-1.5">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Cambio rápido de rol (Demo)
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Autenticación firmada por rol vía <code className="text-eira-700">POST /api/auth/staff-login</code>
                    </p>
                  </div>

                  {switchError && (
                    <div className="mb-2 rounded-lg bg-rose-50 border border-rose-200 px-2.5 py-1.5 text-xs text-rose-700">
                      {switchError}
                    </div>
                  )}

                  <div className="space-y-1">
                    {STAFF_DEMO_ACCOUNTS.map((account) => {
                      const isActive = staff?.id === account.id || staff?.role === account.role;
                      const isSwitching = switchingId === account.id;
                      return (
                        <button
                          key={account.id}
                          type="button"
                          disabled={switchingId !== null}
                          onClick={() => void handleSelectRole(account)}
                          className={`w-full rounded-2xl px-3 py-2 min-h-[44px] text-left transition flex items-start justify-between gap-2 ${
                            isActive
                              ? "bg-padi-blush border border-padi-pale"
                              : "hover:bg-padi-blush border border-transparent"
                          } disabled:opacity-60`}
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-900 truncate">
                              {account.shortLabel}
                            </p>
                            <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                              {account.description}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${account.badgeClass}`}
                          >
                            {isSwitching ? "Cambiando..." : isActive ? "Activo" : account.roleLabel}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {staff && (
                    <div className="mt-2 border-t border-slate-100 pt-2">
                      <button
                        type="button"
                        disabled={switchingId !== null}
                        onClick={() => void handleLogoutStaff()}
                        className="w-full min-h-[44px] rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-60 transition"
                      >
                        {switchingId === "logout"
                          ? "Cerrando sesión..."
                          : "Cerrar sesión de personal (Probar sin sesión)"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Mobile Nav Button */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-label={mobileMenuOpen ? "Cerrar menú" : "Abrir menú"}
              className="lg:hidden inline-flex h-11 w-11 items-center justify-center rounded-full border border-padi-line bg-white text-padi-plum hover:bg-padi-blush"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Desktop Navigation Tabs */}
        <nav aria-label="Navegación principal" className="hidden lg:flex items-center gap-1 mb-2.5 w-fit max-w-full rounded-full border border-padi-line bg-white p-1 shadow overflow-x-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition whitespace-nowrap border ${
                  isActive
                    ? "bg-padi-berry text-white border-padi-berry"
                    : "text-padi-muted border-transparent hover:bg-padi-blush hover:text-padi-plum"
                }`}
              >
                <Icon
                  className={`h-3.5 w-3.5 ${isActive ? "text-white" : "text-padi-muted"}`}
                  aria-hidden="true"
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <nav
            aria-label="Navegación móvil"
            className="lg:hidden border-t border-padi-line py-3 space-y-1.5"
          >
            <div className="flex items-center justify-between px-2 pb-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-padi-pale bg-padi-blush px-2.5 py-1 text-[11px] font-semibold text-padi-berry">
                <span
                  className={`h-2 w-2 rounded-full ${
                    isValkeyDirect ? "bg-emerald-500" : "bg-teal-500"
                  }`}
                />
                Valkey / TTL Store
              </span>
              {staff && (
                <span className="text-[11px] text-slate-500">{staff.email}</span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive =
                  item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex min-h-[44px] items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold border ${
                      isActive
                        ? "bg-padi-berry text-white border-padi-berry"
                        : "text-padi-muted bg-white border-padi-line hover:bg-padi-blush"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>
        )}
      </div>
    </header>
  );
}

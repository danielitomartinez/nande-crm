"use client";

import { useEffect, useState, useCallback, ReactNode, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Bell, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaNotificationProvider({ children }: { children: ReactNode }) {
  const { accountId, user } = useAuth();
  const userId = user?.id;
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>("default");
  const [showNotificationPrompt, setShowNotificationPrompt] = useState(false);
  // Track last notification time to debounce duplicates
  const lastNotifRef = useRef<Map<string, number>>(new Map());

  // 1. Register Service Worker & Check Notification Permission
  useEffect(() => {
    if (typeof window === "undefined") return;

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          console.log("[PWA] Service worker registered:", reg.scope);
        })
        .catch((err) => {
          console.error("[PWA] Service worker registration failed:", err);
        });
    }

    if ("Notification" in window) {
      const current = Notification.permission;
      setNotificationPermission(current);
      if (current === "default") {
        const timer = setTimeout(() => setShowNotificationPrompt(true), 3000);
        return () => clearTimeout(timer);
      }
    }
  }, []);

  // Sync permission state when it changes (user grants/denies in browser settings)
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const interval = setInterval(() => {
      const current = Notification.permission;
      setNotificationPermission((prev) => (prev !== current ? current : prev));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // 2. Capture PWA beforeinstallprompt event
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
      setShowInstallBanner(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", () => {
      setInstallPrompt(null);
      setShowInstallBanner(false);
      console.log("[PWA] App installed successfully");
    });

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
    };
  }, []);

  // Send browser notification with deduplication
  const sendBrowserNotification = useCallback((
    title: string,
    body: string,
    url: string = "/inbox",
    dedupeKey?: string
  ) => {
    if (!("Notification" in window) || Notification.permission !== "granted") return;

    // Debounce: skip if same key fired within last 3 seconds
    if (dedupeKey) {
      const now = Date.now();
      const last = lastNotifRef.current.get(dedupeKey);
      if (last && now - last < 3000) return;
      lastNotifRef.current.set(dedupeKey, now);
    }

    const options: NotificationOptions = {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: dedupeKey || `nande-crm-${Date.now()}`,
      data: { url },
    };

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready
        .then((reg) => reg.showNotification(title, options))
        .catch(() => {
          const n = new Notification(title, options);
          n.onclick = () => { window.focus(); window.location.href = url; };
        });
    } else {
      const n = new Notification(title, options);
      n.onclick = () => { window.focus(); window.location.href = url; };
    }
  }, []);

  // 3. Realtime: Notifications assigned to this user
  // FIX: filter by user_id (not account_id which doesn't exist in notifications for realtime filter)
  useEffect(() => {
    if (!userId || typeof window === "undefined") return;

    const supabase = createClient();
    const notifChannel = supabase
      .channel(`pwa-notifications-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as {
            id?: string;
            title?: string;
            body?: string;
            conversation_id?: string;
          };
          sendBrowserNotification(
            row.title || "Nueva notificacion",
            row.body || "Tienes una nueva tarea asignada en Nande CRM",
            row.conversation_id ? `/inbox?c=${row.conversation_id}` : "/notifications",
            row.id
          );
        }
      )
      .subscribe((status) => console.log("[PWA] Notifications realtime:", status));

    return () => { supabase.removeChannel(notifChannel); };
  }, [userId, sendBrowserNotification]);

  // 4. Realtime: Inbound messages from customers
  // FIX: messages table has NO account_id column — removed broken filter, RLS scopes rows
  // FIX: use sender_type="customer" (not direction="inbound" which doesn't exist in schema)
  useEffect(() => {
    if (!accountId || !userId || typeof window === "undefined") return;

    const supabase = createClient();
    const msgChannel = supabase
      .channel(`pwa-messages-${accountId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          // No account_id column on messages — RLS via conversations membership handles scoping
        },
        (payload) => {
          const msg = payload.new as {
            id?: string;
            sender_type?: string;
            content_text?: string;
            conversation_id?: string;
          };
          // Only notify for customer messages (inbound WhatsApp)
          if (msg.sender_type === "customer") {
            sendBrowserNotification(
              "Nuevo mensaje de cliente",
              msg.content_text || "Archivo recibido",
              `/inbox?c=${msg.conversation_id}`,
              msg.id
            );
          }
        }
      )
      .subscribe((status) => console.log("[PWA] Messages realtime:", status));

    return () => { supabase.removeChannel(msgChannel); };
  }, [accountId, userId, sendBrowserNotification]);

  const handleRequestNotification = async () => {
    if (!("Notification" in window)) return;
    const res = await Notification.requestPermission();
    setNotificationPermission(res);
    setShowNotificationPrompt(false);

    if (res === "granted") {
      sendBrowserNotification(
        "Nande CRM",
        "Notificaciones activadas. Recibiras alertas de mensajes y asignaciones.",
        "/notifications"
      );
    }
  };

  const handleInstallPwa = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setInstallPrompt(null);
      setShowInstallBanner(false);
    }
  };

  return (
    <>
      {children}

      {showNotificationPrompt && notificationPermission === "default" && (
        <div className="fixed bottom-4 right-4 z-50 flex max-w-md items-center gap-3 rounded-2xl border border-primary/30 bg-card/95 p-4 shadow-2xl backdrop-blur-md transition-all animate-in slide-in-from-bottom-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Bell className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-semibold text-foreground">Activar notificaciones?</h4>
            <p className="text-xs text-muted-foreground">
              Recibis alertas cuando te asignen un chat o llegue un mensaje.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleRequestNotification}>Activar</Button>
            <button onClick={() => setShowNotificationPrompt(false)} className="text-muted-foreground hover:text-foreground" aria-label="Cerrar">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {showInstallBanner && installPrompt && (
        <div className="fixed bottom-4 left-4 z-50 flex max-w-md items-center gap-3 rounded-2xl border border-primary/30 bg-card/95 p-4 shadow-2xl backdrop-blur-md transition-all animate-in slide-in-from-bottom-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Download className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-semibold text-foreground">Instalar Nande CRM</h4>
            <p className="text-xs text-muted-foreground">
              Instala la app en tu celular o PC para acceso rapido y notificaciones.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleInstallPwa}>Instalar</Button>
            <button onClick={() => setShowInstallBanner(false)} className="text-muted-foreground hover:text-foreground" aria-label="Cerrar">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
